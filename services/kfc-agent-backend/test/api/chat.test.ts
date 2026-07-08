import { describe, expect, it } from 'vitest';
import { buildServer } from '../../src/api/server.js';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import { StaticToolPlanner } from '../../src/llm/toolPlanner.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';

describe('chat mock API', () => {
  it('serves dashboard history from injected durable store and event bus', async () => {
    const store = new MemoryStore();
    const dashboard = new DashboardEventBus({
      initialEvents: [
        {
          id: 'event_existing',
          sessionId: 'session_persisted',
          type: 'customer_message_received',
          payload: { text: 'Cho mình Combo Hợp Gu 99K' },
          createdAt: '2026-07-07T00:00:00.000Z',
        },
      ],
    });
    await store.appendTurn({
      sessionId: 'session_persisted',
      channel: 'messenger',
      role: 'user',
      text: 'Cho mình Combo Hợp Gu 99K',
      externalMessageId: 'mid_existing',
      externalUserId: 'psid_existing',
      deliveryStatus: 'received',
    });

    const server = buildServer({ store, dashboard });

    const sessions = await server.inject({ method: 'GET', url: '/dashboard/sessions' });
    expect(sessions.json().sessions).toEqual([
      expect.objectContaining({
        sessionId: 'session_persisted',
        latestEventType: 'customer_message_received',
      }),
    ]);

    const turns = await server.inject({ method: 'GET', url: '/dashboard/sessions/session_persisted/turns' });
    expect(turns.json().turns).toEqual([
      expect.objectContaining({
        role: 'user',
        text: 'Cho mình Combo Hợp Gu 99K',
        externalMessageId: 'mid_existing',
      }),
    ]);
  });

  it('emits monitor-visible message events for a plain chat turn', async () => {
    const server = buildServer();
    await server.inject({
      method: 'POST',
      url: '/chat/mock',
      payload: {
        sessionId: 'plain_session',
        customerId: 'plain_customer',
        channel: 'web_mock',
        text: 'Xin chào KFC',
      },
    });

    const events = await server.inject({ method: 'GET', url: '/dashboard/events/plain_session' });
    expect(events.json().events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'customer_message_received',
          payload: expect.objectContaining({ text: 'Xin chào KFC' }),
        }),
        expect.objectContaining({
          type: 'conversation_turn_created',
          payload: expect.objectContaining({ role: 'assistant' }),
        }),
      ]),
    );

    const sessions = await server.inject({ method: 'GET', url: '/dashboard/sessions' });
    expect(sessions.json().sessions).toEqual([
      expect.objectContaining({ sessionId: 'plain_session', latestEventType: 'conversation_turn_created' }),
    ]);
  });

  it('runs chat through injected AI tool planner and returns tool-backed state', async () => {
    const server = buildServer({
      fixturesRoot: process.cwd(),
      toolPlanner: new StaticToolPlanner([
        {
          intent: 'ordering',
          entities: { itemText: 'Combo Hợp Gu 99K' },
          toolCalls: [
            { toolName: 'searchMenu', arguments: { query: 'Combo Hợp Gu 99K' } },
            { toolName: 'updateCart', arguments: { itemCode: '20751', quantity: 1 } },
          ],
          responseClaims: [],
        },
      ]),
    });
    const response = await server.inject({
      method: 'POST',
      url: '/chat/mock',
      payload: {
        sessionId: 's',
        customerId: 'c',
        channel: 'web_mock',
        text: 'Cho mình Combo Hợp Gu 99K',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().state.toolTrace.map((entry: { toolName: string }) => entry.toolName)).toEqual([
      'searchMenu',
      'updateCart',
    ]);
  });

  it('accepts a planner-backed chat turn and emits dashboard events from verified tool results', async () => {
    const server = buildServer({
      toolPlanner: new StaticToolPlanner([
        {
          intent: 'ordering',
          entities: { itemText: 'Combo Hợp Gu 99K' },
          toolCalls: [
            { toolName: 'searchMenu', arguments: { query: 'Combo Hợp Gu 99K' } },
            { toolName: 'updateCart', arguments: { itemCode: '20751', quantity: 1 } },
          ],
          responseClaims: [],
        },
      ]),
    });
    const response = await server.inject({
      method: 'POST',
      url: '/chat/mock',
      payload: {
        sessionId: 'session_api',
        customerId: 'customer_api',
        channel: 'messenger_mock',
        text: 'Cho mình 1 Combo 99K',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      replyIntent: 'general_reply',
      state: {
        cart: {
          items: [expect.objectContaining({ itemCode: '20751', name: 'Combo Hợp Gu 99K' })],
        },
        toolTrace: [
          expect.objectContaining({ toolName: 'searchMenu', ok: true }),
          expect.objectContaining({ toolName: 'updateCart', ok: true }),
        ],
      },
    });

    const events = await server.inject({ method: 'GET', url: '/dashboard/events/session_api' });
    expect(events.statusCode).toBe(200);
    expect(events.json().events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'session_updated',
          payload: expect.objectContaining({ updateType: 'tool_called', toolName: 'updateCart' }),
        }),
        expect.objectContaining({ type: 'cart_changed' }),
      ]),
    );

    const sessions = await server.inject({ method: 'GET', url: '/dashboard/sessions' });
    expect(sessions.statusCode).toBe(200);
    expect(sessions.json().sessions[0]).toMatchObject({
      sessionId: 'session_api',
      latestEventType: 'conversation_turn_created',
    });

    const turns = await server.inject({ method: 'GET', url: '/dashboard/sessions/session_api/turns' });
    expect(turns.statusCode).toBe(200);
    expect(turns.json().turns.map((turn: { role: string }) => turn.role)).toEqual(['user', 'assistant']);
  });

  it('exposes tool-backed dashboard events for monitor proof', async () => {
    const server = buildServer({
      fixturesRoot: process.cwd(),
      mockClientOptions: {
        fulfillmentQuoteProvider: () => ({
          ok: true,
          value: { feeVnd: 24000, etaMinutes: 35 },
          message: 'quoted',
        }),
      },
      toolPlanner: new StaticToolPlanner([
        {
          intent: 'voucher',
          entities: { voucherText: 'KFC50' },
          toolCalls: [
            { toolName: 'searchMenu', arguments: { query: 'Combo Hợp Gu 99K' } },
            { toolName: 'updateCart', arguments: { itemCode: '20751', quantity: 1 } },
            {
              toolName: 'quoteFulfillment',
              arguments: {
                address: {
                  label: 'Home',
                  line1: 'Big C Đồng Nai',
                  district: 'Biên Hòa',
                  city: 'ĐỒNG NAI',
                },
                method: 'delivery',
                itemCodes: ['20751'],
              },
            },
            { toolName: 'searchPromotions', arguments: { query: 'KFC Voucher' } },
            { toolName: 'answerAllergenQuestion', arguments: { query: 'bắt đầu' } },
            { toolName: 'validateVoucher', arguments: { voucherText: 'KFC50', subtotalVnd: 250000 } },
          ],
          responseClaims: ['promotion'],
        },
      ]),
    });

    await server.inject({
      method: 'POST',
      url: '/chat/mock',
      payload: {
        sessionId: 'dash_tool_session',
        customerId: 'c',
        channel: 'web_mock',
        text: 'Mình có mã KFC50',
      },
    });

    const events = await server.inject({ method: 'GET', url: '/dashboard/events/dash_tool_session' });
    const dashboardEvents = events.json().events;
    expect(events.json().events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'session_updated', payload: expect.objectContaining({ updateType: 'tool_called' }) }),
        expect.objectContaining({
          type: 'session_updated',
          payload: expect.objectContaining({ updateType: 'fulfillment_quoted' }),
        }),
        expect.objectContaining({
          type: 'session_updated',
          payload: expect.objectContaining({ updateType: 'promotion_answered' }),
        }),
        expect.objectContaining({
          type: 'session_updated',
          payload: expect.objectContaining({ updateType: 'content_evidence_found', kind: 'allergen' }),
        }),
        expect.objectContaining({ type: 'voucher_rejected' }),
      ]),
    );

    const emittedUpdateTypes = dashboardEvents
      .filter((event: { type: string }) => event.type === 'session_updated')
      .map((event: { payload: { updateType?: string } }) => event.payload.updateType);
    expect(emittedUpdateTypes).toEqual(
      expect.arrayContaining(['tool_called', 'fulfillment_quoted', 'promotion_answered', 'content_evidence_found']),
    );
  });

  it('does not emit content_evidence_found when allergen question has no evidence', async () => {
    const server = buildServer({
      fixturesRoot: process.cwd(),
      toolPlanner: new StaticToolPlanner([
        {
          intent: 'ordering',
          entities: { itemText: 'Combo Hợp Gu 99K' },
          toolCalls: [{ toolName: 'answerAllergenQuestion', arguments: { query: 'unmatched allergen query' } }],
          responseClaims: [],
        },
      ]),
    });

    await server.inject({
      method: 'POST',
      url: '/chat/mock',
      payload: {
        sessionId: 'dash_tool_session_empty_evidence',
        customerId: 'c',
        channel: 'web_mock',
        text: 'Hỏi tệ dị ứng',
      },
    });

    const events = await server.inject({
      method: 'GET',
      url: '/dashboard/events/dash_tool_session_empty_evidence',
    });
    expect(events.json().events).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({
          type: 'session_updated',
          payload: expect.objectContaining({ updateType: 'content_evidence_found', kind: 'allergen' }),
        }),
      ]),
    );
  });

  it('returns 400 for live channel names on the mock chat route', async () => {
    const server = buildServer();
    const response = await server.inject({
      method: 'POST',
      url: '/chat/mock',
      payload: {
        sessionId: 'session_invalid',
        customerId: 'customer_api',
        channel: 'messenger',
        text: 'Cho mình 1 Combo 99K',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ errorCode: 'invalid_chat_payload' });
  });

  it('returns text composed by the configured response composer', async () => {
    const server = buildServer({
      toolPlanner: new StaticToolPlanner([
        {
          intent: 'ordering',
          entities: { itemText: 'Combo Hợp Gu 99K' },
          toolCalls: [
            { toolName: 'searchMenu', arguments: { query: 'Combo Hợp Gu 99K' } },
            { toolName: 'updateCart', arguments: { itemCode: '20751', quantity: 1 } },
          ],
          responseClaims: [],
        },
      ]),
      responseComposer: {
        async composeResponse() {
          return 'Dạ mình đã thêm Combo 99K vào giỏ. Bạn muốn nhận tại cửa hàng hay giao hàng ạ?';
        },
      },
    });
    const response = await server.inject({
      method: 'POST',
      url: '/chat/mock',
      payload: {
        sessionId: 'session_api_composer',
        customerId: 'customer_api',
        channel: 'messenger_mock',
        text: 'Cho mình 1 Combo 99K',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      responseText: 'Dạ mình đã thêm Combo 99K vào giỏ. Bạn muốn nhận tại cửa hàng hay giao hàng ạ?',
    });
  });

  it('does not eagerly load fixtures for non-chat routes', async () => {
    const server = buildServer({ fixturesRoot: process.cwd() });
    const response = await server.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true });
  });
});
