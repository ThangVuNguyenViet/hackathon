import { describe, expect, it } from 'vitest';
import { buildServer } from '../../src/api/server.js';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import { StaticToolPlanner } from '../../src/llm/toolPlanner.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';

describe('chat mock API', () => {
  it('accepts first-party KFC chat turns and exposes them in monitor sessions', async () => {
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
          return 'Dạ mình đã thêm Combo 99K vào giỏ KFC.';
        },
      },
    });

    const response = await server.inject({
      method: 'POST',
      url: '/chat/kfc/message',
      payload: {
        sessionId: 'kfc:anon_customer_1',
        customerId: 'anon_customer_1',
        clientMessageId: 'kfc_msg_1',
        text: 'Cho mình 1 Combo 99K',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      sessionId: 'kfc:anon_customer_1',
      customerId: 'anon_customer_1',
      userTurnId: expect.any(String),
      assistantTurnId: expect.any(String),
      responseText: 'Dạ mình đã thêm Combo 99K vào giỏ KFC.',
    });

    const turns = await server.inject({
      method: 'GET',
      url: '/dashboard/sessions/kfc%3Aanon_customer_1/turns',
    });
    expect(turns.json().turns).toEqual([
      expect.objectContaining({
        role: 'user',
        channel: 'kfc',
        externalMessageId: 'kfc_msg_1',
        externalUserId: 'anon_customer_1',
        deliveryStatus: 'received',
      }),
      expect.objectContaining({
        role: 'assistant',
        channel: 'kfc',
        deliveryStatus: 'sent',
        text: 'Dạ mình đã thêm Combo 99K vào giỏ KFC.',
      }),
    ]);

    const sessions = await server.inject({ method: 'GET', url: '/dashboard/sessions' });
    expect(sessions.json().sessions).toEqual([
      expect.objectContaining({
        sessionId: 'kfc:anon_customer_1',
        externalUserId: 'anon_customer_1',
        displayName: null,
        deeplink: expect.objectContaining({
          status: 'unavailable',
          reason: 'KFC chat deeplink disabled',
        }),
      }),
    ]);
  });

  it('rejects KFC chat payloads that try to supply a channel', async () => {
    const server = buildServer();
    const response = await server.inject({
      method: 'POST',
      url: '/chat/kfc/message',
      payload: {
        sessionId: 'kfc:anon_customer_1',
        customerId: 'anon_customer_1',
        clientMessageId: 'kfc_msg_1',
        channel: 'web_mock',
        text: 'Cho mình 1 Combo 99K',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ errorCode: 'invalid_kfc_chat_payload' });
  });

  it('accepts KFC GenUI actions as first-party customer turns', async () => {
    const server = buildServer({
      responseComposer: {
        async composeResponse() {
          return 'Mình đã ghi nhận thao tác trong KFC chat.';
        },
      },
    });

    const response = await server.inject({
      method: 'POST',
      url: '/chat/kfc/genui-action',
      payload: {
        sessionId: 'kfc:anon_customer_2',
        customerId: 'anon_customer_2',
        clientMessageId: 'kfc_action_1',
        action: {
          attachmentId: 'attachment_1',
          actionId: 'confirm_order',
          value: 'confirm',
          payload: { orderId: 'order_1' },
        },
      },
    });

    expect(response.statusCode).toBe(200);
    const turns = await server.inject({
      method: 'GET',
      url: '/dashboard/sessions/kfc%3Aanon_customer_2/turns',
    });
    expect(turns.json().turns[0]).toMatchObject({
      role: 'user',
      channel: 'kfc',
      externalMessageId: 'kfc_action_1',
      metadata: {
        rawEvent: {
          source: 'kfc_genui_action',
          genUiAction: expect.objectContaining({ actionId: 'confirm_order' }),
        },
      },
    });
  });

  it('serves dashboard history from injected durable store and event bus', async () => {
    const store = new MemoryStore();
    const dashboard = new DashboardEventBus({
      initialEvents: [
        {
          id: 'event_existing',
          sessionId: 'messenger:psid_existing',
          type: 'customer_message_received',
          payload: { text: 'Cho mình Combo Hợp Gu 99K' },
          createdAt: new Date().toISOString(),
        },
      ],
    });
    await store.appendTurn({
      sessionId: 'messenger:psid_existing',
      channel: 'messenger',
      role: 'user',
      text: 'Cho mình Combo Hợp Gu 99K',
      externalMessageId: 'mid_existing',
      externalUserId: 'psid_existing',
      deliveryStatus: 'received',
      metadata: null,
    });

    const server = buildServer({ store, dashboard });

    const sessions = await server.inject({ method: 'GET', url: '/dashboard/sessions' });
    expect(sessions.json().sessions).toEqual([
      expect.objectContaining({
        sessionId: 'messenger:psid_existing',
        latestEventType: 'customer_message_received',
      }),
    ]);

    const turns = await server.inject({ method: 'GET', url: '/dashboard/sessions/messenger%3Apsid_existing/turns' });
    expect(turns.json().turns).toEqual([
      expect.objectContaining({
        role: 'user',
        text: 'Cho mình Combo Hợp Gu 99K',
        externalMessageId: 'mid_existing',
      }),
    ]);
  });

  it('defaults dashboard sessions to activity from the last four hours', async () => {
    const now = Date.now();
    const dashboard = new DashboardEventBus({
      initialEvents: [
        {
          id: 'event_old',
          sessionId: 'messenger:session_old',
          type: 'customer_message_received',
          payload: {},
          createdAt: new Date(now - 4 * 60 * 60 * 1000 - 1).toISOString(),
        },
        {
          id: 'event_recent',
          sessionId: 'messenger:session_recent',
          type: 'assistant_reply_sent',
          payload: {},
          createdAt: new Date(now).toISOString(),
        },
      ],
    });
    const server = buildServer({ dashboard });

    const sessions = await server.inject({ method: 'GET', url: '/dashboard/sessions' });

    expect(sessions.json().sessions.map((session: { sessionId: string }) => session.sessionId)).toEqual([
      'messenger:session_recent',
    ]);
  });

  it('emits dashboard events but hides mock chat turns from operator sessions', async () => {
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
    expect(sessions.json().sessions).toEqual([]);
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
            { toolName: 'updateCart', arguments: { itemCode: '20751', quantity: 3 } },
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
            { toolName: 'updateCart', arguments: { itemCode: '20751', quantity: 3 } },
          ],
          responseClaims: [],
        },
      ]),
    });
    const response = await server.inject({
      method: 'POST',
      url: '/chat/mock',
      payload: {
        sessionId: 'web:customer_api',
        customerId: 'customer_api',
        channel: 'web_mock',
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

    const events = await server.inject({ method: 'GET', url: '/dashboard/events/web%3Acustomer_api' });
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
    expect(sessions.json().sessions).toEqual([]);

    const turns = await server.inject({ method: 'GET', url: '/dashboard/sessions/web%3Acustomer_api/turns' });
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
            { toolName: 'updateCart', arguments: { itemCode: '20751', quantity: 3 } },
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
          payload: expect.objectContaining({ updateType: 'tool_called', toolName: 'updateCart', boundary: 'pos' }),
        }),
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
        expect.objectContaining({ type: 'voucher_applied' }),
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

  it('returns 400 for live and mocked Messenger channel names on the mock chat route', async () => {
    const server = buildServer();
    for (const channel of ['messenger', 'messenger_mock', 'zalo_mock']) {
      const response = await server.inject({
        method: 'POST',
        url: '/chat/mock',
        payload: {
          sessionId: 'session_invalid',
          customerId: 'customer_api',
          channel,
          text: 'Cho mình 1 Combo 99K',
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ errorCode: 'invalid_chat_payload' });
    }
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
        channel: 'web_mock',
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
