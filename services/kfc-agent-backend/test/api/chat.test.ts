import { describe, expect, it, vi } from 'vitest';
import { buildDemoAdminServer as buildServer } from '../fixtures/demoAdminServer.js';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import { StaticToolPlanner } from '../../src/llm/toolPlanner.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import type { AgentTraceSpan, AgentTraceSpanInput, AgentTracer } from '../../src/observability/agentTracing.js';

describe('KFC chat API', () => {
  it('rejects caller-supplied mocked upstream profiles on the Node HTTP route', async () => {
    const server = buildServer();

    const response = await server.inject({
      method: 'POST',
      url: '/chat/kfc/message',
      payload: {
        sessionId: 'kfc:mock_profile_customer',
        customerId: 'mock_profile_customer',
        clientMessageId: 'mock_profile_1',
        text: 'Đặt món giúp tôi',
        metadata: {
          mockedUpstreamAuthorized: true,
          mockedUpstreamApi: { unavailableItemCodes: ['41141'] },
        },
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ errorCode: 'mocked_upstream_profile_not_authorized' });
  });

  it('rejects caller-selected customer IDs that do not match the KFC session', async () => {
    const server = buildServer();

    const message = await server.inject({
      method: 'POST',
      url: '/chat/kfc/message',
      payload: {
        sessionId: 'kfc:customer_1',
        customerId: 'customer_2',
        clientMessageId: 'mismatched_message',
        text: 'show my rewards',
      },
    });
    const action = await server.inject({
      method: 'POST',
      url: '/chat/kfc/genui-action',
      payload: {
        sessionId: 'kfc:customer_1',
        customerId: 'customer_2',
        clientMessageId: 'mismatched_action',
        action: { attachmentId: 'attachment_1', actionId: 'confirm' },
      },
    });

    expect(message.statusCode).toBe(400);
    expect(message.json()).toMatchObject({ errorCode: 'invalid_kfc_chat_payload' });
    expect(action.statusCode).toBe(400);
    expect(action.json()).toMatchObject({ errorCode: 'invalid_kfc_genui_action_payload' });
  });

  it('does not expose membership data from a public route without trusted KFC authentication', async () => {
    const server = buildServer({
      toolPlanner: new StaticToolPlanner([{
        intent: 'voucher',
        contextPolicy: { membership: 'active' },
        entities: {},
        toolCalls: [{ toolName: 'getMembershipProfile', arguments: {} }],
        responseClaims: [],
      }]),
    });

    const response = await server.inject({
      method: 'POST',
      url: '/chat/kfc/message',
      payload: {
        sessionId: 'kfc:public_member_request',
        customerId: 'public_member_request',
        clientMessageId: 'public_member_request_1',
        text: 'Điểm thành viên của tôi là bao nhiêu?',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().state.toolTrace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolName: 'getMembershipProfile',
          ok: false,
          resultSummary: 'authentication_required',
        }),
      ]),
    );
    expect(response.json().responseText).toContain('đăng nhập qua kênh KFC chính thức');
    expect(JSON.stringify(response.json())).not.toContain('loyalty-demo-profile');
  });

  it('keeps smart menu GenUI with concise companion text for first-party KFC chat', async () => {
    const server = buildServer({
      toolPlanner: new StaticToolPlanner([
        {
          intent: 'ordering',
          entities: {},
          toolCalls: [{ toolName: 'searchMenu', arguments: { query: '' } }],
          responseClaims: [],
        },
      ]),
      responseComposer: {
        async composeResponse() {
          return 'Mời bạn chọn món trong danh sách bên dưới.';
        },
      },
    });

    const response = await server.inject({
      method: 'POST',
      url: '/chat/kfc/message',
      payload: {
        sessionId: 'kfc:menu_customer',
        customerId: 'menu_customer',
        clientMessageId: 'kfc_menu_1',
        text: 'cho tôi xem món ăn',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      responseText: 'Mời bạn chọn món trong danh sách bên dưới.',
      genUi: { widgetKind: 'smartMenuPicker' },
      presentation: {
        text: 'Mời bạn chọn món trong danh sách bên dưới.',
        genUi: { widgetKind: 'smartMenuPicker' },
      },
    });
  });

  it('flushes pending agent traces when the HTTP server closes', async () => {
    const flush = vi.fn(async () => undefined);
    const span: AgentTraceSpan = {
      async startSpan() { return span; },
      async end() {},
      async fail() {},
    };
    const server = buildServer({
      agentTracer: {
        async startTurn() { return span; },
        flush,
      },
    });

    await server.close();

    expect(flush).toHaveBeenCalledOnce();
  });

  it('preserves social HTTP replay, synchronous intelligence, and deferred monitor contracts', async () => {
    const store = new MemoryStore();
    const dashboard = new DashboardEventBus();
    const deferred: Array<() => Promise<void>> = [];
    let judgeCalls = 0;
    const traceNames: string[] = [];
    const route = vi.fn(async () => ({
      decision: 'handle_social' as const,
      responseText: 'model social reply',
    }));
    const plan = vi.fn(async () => ({
      intent: 'unclear' as const,
      contextPolicy: {},
      entities: {},
      toolCalls: [],
      responseClaims: [],
    }));
    const composeResponse = vi.fn(async () => 'composer reply');
    const span: AgentTraceSpan = {
      async startSpan() {
        return span;
      },
      async end() {},
      async fail() {},
    };
    const agentTracer: AgentTracer = {
      async startTurn(input: Omit<AgentTraceSpanInput, 'runType'>) {
        traceNames.push(input.name);
        return span;
      },
      async flush() {},
    };
    const server = buildServer({
      store,
      dashboard,
      agentTracer,
      defer(task) {
        deferred.push(task);
      },
      smallTalkRouter: { route },
      toolPlanner: { supportsMultiStep: false, plan },
      responseComposer: { composeResponse },
      monitorJudge: {
        async judge(input) {
          judgeCalls += 1;
          return {
            ...input.deterministicFallback,
            contextSummary: 'Khách vừa bắt đầu hội thoại và đang chờ hỗ trợ.',
            source: 'ai_monitor_judge',
            model: 'gpt-test',
            promptVersion: 'monitor-judge-v1',
          };
        },
      },
    });

    const payload = {
      sessionId: 'kfc:deferred_monitor_customer',
      customerId: 'deferred_monitor_customer',
      clientMessageId: 'kfc_deferred_monitor_1',
      text: 'social router input',
    };
    const first = await server.inject({
      method: 'POST',
      url: '/chat/kfc/message',
      payload,
    });
    const second = await server.inject({ method: 'POST', url: '/chat/kfc/message', payload });

    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({
      responseText: 'model social reply',
      sessionId: payload.sessionId,
      customerId: payload.customerId,
      replayed: false,
    });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ responseText: 'model social reply', replayed: true });
    expect(route).toHaveBeenCalledTimes(1);
    expect(plan).not.toHaveBeenCalled();
    expect(composeResponse).not.toHaveBeenCalled();
    expect(judgeCalls).toBe(0);
    expect(traceNames).toEqual(['agent_turn']);
    expect(deferred).toHaveLength(1);
    const synchronousIntelligence = dashboard
      .getEvents(payload.sessionId)
      .filter((event) => event.type === 'session_intelligence_updated')
      .map((event) => event.payload.sessionIntelligence);
    expect(synchronousIntelligence).toEqual([expect.objectContaining({ source: 'runtime_rule_fallback' })]);

    await deferred[0]!();

    expect(judgeCalls).toBe(1);
    expect(traceNames).toEqual(['agent_turn', 'post_turn_monitor']);
    expect(
      dashboard
        .getEvents(payload.sessionId)
        .filter((event) => event.type === 'session_intelligence_updated')
        .map((event) => event.payload.sessionIntelligence),
    ).toEqual([
      expect.objectContaining({ source: 'runtime_rule_fallback' }),
      expect.objectContaining({ source: 'ai_monitor_judge' }),
    ]);
  });

  it('fails open from a social router error without changing the KFC HTTP success contract', async () => {
    const store = new MemoryStore();
    const plan = vi.fn(async () => ({
      intent: 'unclear' as const,
      contextPolicy: {},
      entities: {},
      toolCalls: [],
      responseClaims: [],
      directResponse: 'planner reply',
    }));
    const server = buildServer({
      store,
      smallTalkRouter: {
        async route() {
          throw new Error('router unavailable');
        },
      },
      toolPlanner: { supportsMultiStep: false, plan },
    });

    const response = await server.inject({
      method: 'POST',
      url: '/chat/kfc/message',
      payload: {
        sessionId: 'kfc:router_failure_customer',
        customerId: 'router_failure_customer',
        clientMessageId: 'kfc_router_failure_1',
        text: 'planner input',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ responseText: 'planner reply' });
    expect(plan).toHaveBeenCalledTimes(1);
    expect(
      (await store.listEvents('kfc:router_failure_customer')).filter(
        (event) => event.sourceType === 'llm:small_talk_router_failed',
      ),
    ).toEqual([
      expect.objectContaining({ payload: { message: 'router unavailable' } }),
    ]);
  });

  it('accepts first-party KFC chat turns and exposes them in monitor sessions', async () => {
    const store = new MemoryStore();
    const findTurn = vi.spyOn(store, 'findTurnByExternalMessage');
    const server = buildServer({
      store,
      toolPlanner: new StaticToolPlanner([
        {
          intent: 'ordering',
          entities: { itemText: 'Combo Hợp Gu 99K', cartMutationConfirmed: true },
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
    expect(findTurn).toHaveBeenCalledTimes(1);
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

  it('replays an exact KFC request without running response composition twice', async () => {
    const composeResponse = vi.fn(async () => 'Một kết quả duy nhất.');
    const server = buildServer({
      toolPlanner: new StaticToolPlanner([{
        intent: 'unclear',
        entities: {},
        toolCalls: [],
        responseClaims: [],
      }]),
      responseComposer: { composeResponse },
    });
    const payload = {
      sessionId: 'kfc:idempotent_customer',
      customerId: 'idempotent_customer',
      clientMessageId: 'kfc_msg_idempotent_1',
      text: 'Cho mình xem thực đơn',
    };

    const original = await server.inject({ method: 'POST', url: '/chat/kfc/message', payload });
    const replay = await server.inject({ method: 'POST', url: '/chat/kfc/message', payload });

    expect(original.statusCode).toBe(200);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual({ ...original.json(), replayed: true });
    expect(composeResponse).toHaveBeenCalledTimes(1);

    const turns = await server.inject({
      method: 'GET',
      url: '/dashboard/sessions/kfc%3Aidempotent_customer/turns',
    });
    expect(turns.json().turns).toHaveLength(2);
  });

  it('rejects conflicting reuse of a KFC client message identity', async () => {
    const composeResponse = vi.fn(async () => 'Kết quả đầu tiên.');
    const server = buildServer({
      toolPlanner: new StaticToolPlanner([{
        intent: 'unclear',
        entities: {},
        toolCalls: [],
        responseClaims: [],
      }]),
      responseComposer: { composeResponse },
    });
    const identity = {
      sessionId: 'kfc:conflict_customer',
      customerId: 'conflict_customer',
      clientMessageId: 'kfc_msg_conflict_1',
    };

    const original = await server.inject({
      method: 'POST',
      url: '/chat/kfc/message',
      payload: { ...identity, text: 'Cho mình xem thực đơn' },
    });
    const conflict = await server.inject({
      method: 'POST',
      url: '/chat/kfc/message',
      payload: { ...identity, text: 'Tạo đơn hàng ngay' },
    });

    expect(original.statusCode).toBe(200);
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ errorCode: 'idempotency_conflict' });
    expect(composeResponse).toHaveBeenCalledTimes(1);
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
        channel: 'messenger',
        text: 'Cho mình 1 Combo 99K',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ errorCode: 'invalid_kfc_chat_payload' });
  });

  it('rejects KFC GenUI actions for attachments that were not delivered in the session', async () => {
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

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ errorCode: 'action_not_found' });
    const turns = await server.inject({
      method: 'GET',
      url: '/dashboard/sessions/kfc%3Aanon_customer_2/turns',
    });
    expect(turns.json().turns).toEqual([]);
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

  it('defaults dashboard sessions to activity from the last 24 hours', async () => {
    const now = Date.now();
    const dashboard = new DashboardEventBus({
      initialEvents: [
        {
          id: 'event_old',
          sessionId: 'messenger:session_old',
          type: 'customer_message_received',
          payload: {},
          createdAt: new Date(now - 24 * 60 * 60 * 1000 - 1).toISOString(),
        },
        {
          id: 'event_within_day',
          sessionId: 'messenger:session_within_day',
          type: 'customer_message_received',
          payload: {},
          createdAt: new Date(now - 20 * 60 * 60 * 1000).toISOString(),
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
      'messenger:session_within_day',
    ]);
  });

  it('emits dashboard events and exposes KFC chat turns to operator sessions', async () => {
    const server = buildServer();
    await server.inject({
      method: 'POST',
      url: '/chat/kfc/message',
      payload: {
        sessionId: 'kfc:plain_session',
        customerId: 'plain_session',
        clientMessageId: 'kfc_test_message',
        text: 'Xin chào KFC',
      },
    });

    const events = await server.inject({ method: 'GET', url: '/dashboard/events/kfc%3Aplain_session' });
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
      expect.objectContaining({ sessionId: 'kfc:plain_session' }),
    ]);
  });

  it('runs chat through injected AI tool planner and returns tool-backed state', async () => {
    const server = buildServer({
      fixturesRoot: process.cwd(),
      toolPlanner: new StaticToolPlanner([
        {
          intent: 'ordering',
          entities: { itemText: 'Combo Hợp Gu 99K', cartMutationConfirmed: true },
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
      url: '/chat/kfc/message',
      payload: {
        sessionId: 'kfc:s',
        customerId: 's',
        clientMessageId: 'kfc_test_message',
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
          entities: { itemText: 'Combo Hợp Gu 99K', cartMutationConfirmed: true },
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
      url: '/chat/kfc/message',
      payload: {
        sessionId: 'kfc:customer_api',
        customerId: 'customer_api',
        clientMessageId: 'kfc_test_message',
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

    const events = await server.inject({ method: 'GET', url: '/dashboard/events/kfc%3Acustomer_api' });
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
    expect(sessions.json().sessions).toEqual([
      expect.objectContaining({ sessionId: 'kfc:customer_api' }),
    ]);

    const turns = await server.inject({ method: 'GET', url: '/dashboard/sessions/kfc%3Acustomer_api/turns' });
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
          entities: {
            voucherText: 'KFC50',
            cartMutationConfirmed: true,
            addressDraft: {
              line1: 'Big C Đồng Nai',
              district: 'Biên Hòa',
              city: 'ĐỒNG NAI',
            },
          },
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
      url: '/chat/kfc/message',
      payload: {
        sessionId: 'kfc:dash_tool_session',
        customerId: 'dash_tool_session',
        clientMessageId: 'kfc_test_message',
        text: 'Đặt 3 Combo Hợp Gu 99K giao tới Big C Đồng Nai, Biên Hòa, ĐỒNG NAI và áp mã KFC50',
      },
    });

    const events = await server.inject({ method: 'GET', url: '/dashboard/events/kfc%3Adash_tool_session' });
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
      url: '/chat/kfc/message',
      payload: {
        sessionId: 'kfc:dash_tool_session_empty_evidence',
        customerId: 'dash_tool_session_empty_evidence',
        clientMessageId: 'kfc_test_message',
        text: 'Hỏi tệ dị ứng',
      },
    });

    const events = await server.inject({
      method: 'GET',
      url: '/dashboard/events/kfc%3Adash_tool_session_empty_evidence',
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

  it('returns 400 when KFC ingress receives a transport channel field', async () => {
    const server = buildServer();
    for (const channel of ['messenger', 'messenger_mock', 'zalo_mock']) {
      const response = await server.inject({
        method: 'POST',
        url: '/chat/kfc/message',
        payload: {
          sessionId: 'kfc:session_invalid',
          customerId: 'session_invalid',
          clientMessageId: `invalid_${channel}`,
          channel,
          text: 'Cho mình 1 Combo 99K',
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ errorCode: 'invalid_kfc_chat_payload' });
    }
  });

  it('returns text composed by the configured response composer', async () => {
    const server = buildServer({
      toolPlanner: new StaticToolPlanner([
        {
          intent: 'ordering',
          entities: { itemText: 'Combo Hợp Gu 99K', cartMutationConfirmed: true },
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
      url: '/chat/kfc/message',
      payload: {
        sessionId: 'kfc:session_api_composer',
        customerId: 'session_api_composer',
        clientMessageId: 'kfc_test_message',
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
