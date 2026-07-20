import {
  isSystemMessage,
} from '@langchain/core/messages';
import { fakeModel } from '@langchain/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { buildDemoAdminServer as buildServer } from '../fixtures/demoAdminServer.js';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import type { AgentTraceSpan, AgentTraceSpanInput, AgentTracer } from '../../src/observability/agentTracing.js';
import {
  isKfcGenUiAttachment,
  kfcGenUiVerifiedStateRevision,
  type KfcGenUiAttachment,
} from '../../src/genui/kfcGenUi.js';
import {
  selectedActionResponseReferenceSchema,
} from '../../src/agent/selectedActionResponseAuthority.js';
import {
  STRUCTURED_RESPONSE_REFERENCE_MESSAGE_ID,
} from '../../src/agent/structuredCustomerAction.js';
import { isRecord } from '../../src/api/routeHandlerContracts.js';
import {
  groundedResponseModelReply,
  groundedResponseVerifierModel,
} from '../fixtures/groundedResponse.js';
import { testAgent } from '../fixtures/testAgent.js';

function sandboxIdentityLifecycle() {
  const unavailable = async (): Promise<never> => {
    throw new Error('Lifecycle mutation is not used by GenUI identity tests');
  };
  return {
    environment: 'sandbox' as const,
    controls: {
      create: unavailable,
      get: unavailable,
      transition: unavailable,
    },
    createInput: unavailable,
    binding: unavailable,
  };
}

function actionableAttachment(input: {
  sessionId: string;
  customerId: string;
  attachmentId?: string;
  expiresAt?: string;
  verifiedState?: Record<string, unknown>;
}): KfcGenUiAttachment {
  const now = new Date();
  const expiresAt = input.expiresAt ?? new Date(now.getTime() + 60_000).toISOString();
  const cart = input.verifiedState?.cart ?? { items: [] };
  return {
    id: input.attachmentId ?? 'attachment_authoritative',
    lifecycleStage: 'cart',
    widgetKind: 'cartBuilder',
    status: 'active',
    title: 'Giỏ hàng',
    data: { cart },
    actions: [
      { id: 'edit_cart', label: 'Sửa giỏ hàng' },
      { id: 'continue_to_fulfillment', label: 'Tiếp tục giao hàng' },
    ],
    expiresAt,
    authority: {
      schemaVersion: 'kfc-genui-v1',
      sessionId: input.sessionId,
      customerId: input.customerId,
      verifiedRevision: kfcGenUiVerifiedStateRevision(
        input.verifiedState ?? {},
      ),
      actionLifecycle: 'one_shot',
      issuedAt: now.toISOString(),
      expiresAt,
    },
  };
}

async function appendAuthenticatedActionState(
  store: MemoryStore,
  sessionId: string,
  customerId: string,
  verifiedState: Record<string, unknown> = {},
): Promise<void> {
  await store.appendEvent(sessionId, 'proof:kfc_preconditions', {
    customerId,
    authenticated: true,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  await store.appendEvent(sessionId, 'graph:verified_state', { verifiedState });
}

describe('KFC chat API', () => {
  it('fails closed when production KFC chat has no configured agent', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    try {
      const server = buildServer();
      const response = await server.inject({
        method: 'POST',
        url: '/chat/kfc/message',
        payload: {
          sessionId: 'kfc:unconfigured_agent',
          customerId: 'unconfigured_agent',
          clientMessageId: 'unconfigured_agent_1',
          text: 'Cho mình xem thực đơn',
        },
      });

      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ errorCode: 'kfc_agent_not_configured' });
    } finally {
      vi.unstubAllEnvs();
    }
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
      ...testAgent(
        fakeModel()
          .respondWithTools([{
            name: 'getMembershipProfile',
            args: {},
          }])
          .respond(groundedResponseModelReply({
            customerText:
              'Please sign in through the official KFC channel before accessing membership details.',
          })),
        groundedResponseVerifierModel(),
      ),
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
    expect(response.json()).not.toHaveProperty('state');
    expect(response.json().responseText).toMatch(/\b(?:sign|log)[ -]?in\b|đăng nhập/iu);
    expect(JSON.stringify(response.json())).not.toContain('loyalty-demo-profile');
  });

  it('keeps smart menu GenUI with concise companion text for first-party KFC chat', async () => {
    const server = buildServer({
      ...testAgent(
        fakeModel()
          .respondWithTools([{
            name: 'searchMenu',
            args: { scope: 'all', query: null },
          }])
          .respond(groundedResponseModelReply({
            customerText: 'Mời bạn chọn món trong danh sách bên dưới.',
            evidenceReferences: [{
              evidenceId: 'menu_search_results',
              claimKinds: ['product'],
            }],
          })),
        groundedResponseVerifierModel({
          evidenceReferences: [{
            evidenceId: 'menu_search_results',
            claimKinds: ['product'],
          }],
        }),
      ),
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

  it('preserves HTTP replay, synchronous intelligence, and deferred monitor contracts', async () => {
    const store = new MemoryStore();
    const dashboard = new DashboardEventBus();
    const deferred: Array<() => Promise<void>> = [];
    let judgeCalls = 0;
    const traceNames: string[] = [];
    const model = fakeModel()
      .respond(groundedResponseModelReply({
        customerText: 'model reply',
      }));
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
      ...testAgent(model, groundedResponseVerifierModel()),
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

    expect(first.statusCode, first.body).toBe(200);
    expect(first.json()).toMatchObject({
      responseText: 'model reply',
      sessionId: payload.sessionId,
      customerId: payload.customerId,
      replayed: false,
    });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({
      responseText: 'model reply',
      replayed: true,
    });
    expect(model.callCount).toBe(1);
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

  it('accepts first-party KFC chat turns and exposes them in monitor sessions', async () => {
    const store = new MemoryStore();
    const findTurn = vi.spyOn(store, 'findTurnByExternalMessage');
    const model = fakeModel()
      .respondWithTools([{
        name: 'searchMenu',
        args: { scope: 'filtered', query: 'Combo Hợp Gu 99K' },
      }])
      .respondWithTools([{
        name: 'updateCart',
        args: {
          changes: [{
            itemCode: '20751',
            quantity: 1,
            modifiers: [],
          }],
        },
      }])
      .respond(groundedResponseModelReply({
        customerText: 'Dạ mình đã thêm Combo 99K vào giỏ KFC.',
        evidenceReferences: [{
          evidenceId: 'cart',
          claimKinds: ['product'],
        }],
      }));
    const responseVerifierModel = groundedResponseVerifierModel({
      evidenceReferences: [{
        evidenceId: 'cart',
        claimKinds: ['product'],
      }],
    });
    const server = buildServer({
      store,
      ...testAgent(model, responseVerifierModel),
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

  it('replays an exact KFC request without running the model twice', async () => {
    const store = new MemoryStore();
    const model = fakeModel()
      .respond(groundedResponseModelReply({
        customerText: 'Một kết quả duy nhất.',
      }));
    const server = buildServer({
      store,
      ...testAgent(model, groundedResponseVerifierModel()),
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
    expect(model.callCount).toBe(1);

    const turns = await server.inject({
      method: 'GET',
      url: '/dashboard/sessions/kfc%3Aidempotent_customer/turns',
    });
    expect(turns.json().turns).toHaveLength(2);
    expect((await store.listEvents(payload.sessionId)).some(
      (event) => event.sourceType === 'kfc_request_completed',
    )).toBe(false);
  });

  it('keeps a private saved address only in the current top-level GenUI', async () => {
    const store = new MemoryStore();
    const sessionId = 'kfc:private_saved_address_response';
    const customerId = 'private_saved_address_response';
    const privateAddress = {
      label: 'Private saved label HTTP Ω',
      line1: 'Private saved street HTTP Ω',
      district: 'Quận 7',
      city: 'Hồ Chí Minh',
    };
    const cart = {
      id: 'private-saved-address-cart',
      items: [{
        itemCode: '41141',
        name: 'Burger Gà Zinger',
        quantity: 1,
        unitPriceVnd: 55_000,
      }],
      subtotalVnd: 55_000,
      discountVnd: 0,
      deliveryFeeVnd: 0,
      totalVnd: 55_000,
      voucherCode: null,
    };
    await appendAuthenticatedActionState(
      store,
      sessionId,
      customerId,
      { cart },
    );
    const complete = vi.spyOn(
      store,
      'completeIrreversibleOperation',
    );
    const model = fakeModel()
      .respondWithTools([{
        name: 'getSavedAddresses',
        args: {},
      }])
      .respond(groundedResponseModelReply({
        customerText: 'Please review the verified delivery option.',
      }));
    const server = buildServer({
      store,
      lifecycle: sandboxIdentityLifecycle(),
      mockClientOptions: {
        savedAddressesProvider: () => ({
          ok: true,
          value: [privateAddress],
          message: 'private saved-address provider prose HTTP Ω',
        }),
      },
      ...testAgent(model, groundedResponseVerifierModel()),
    });
    const payload = {
      sessionId,
      customerId,
      clientMessageId: 'private-saved-address-response-1',
      text: 'Use my saved delivery address',
    };

    const first = await server.inject({
      method: 'POST',
      url: '/chat/kfc/message',
      payload,
    });

    expect(first.statusCode, first.body).toBe(200);
    const firstBody = first.json();
    expect(firstBody).not.toHaveProperty('state');
    expect(isKfcGenUiAttachment(firstBody.genUi)).toBe(true);
    if (!isKfcGenUiAttachment(firstBody.genUi)) {
      throw new Error('expected a current saved-address GenUI');
    }
    expect(firstBody.genUi).toMatchObject({
      widgetKind: 'addressFulfillmentCheck',
      data: {
        address: privateAddress,
        cart,
      },
    });
    expect(firstBody.presentation.genUi.data)
      .not.toHaveProperty('address');
    const savedAddressRef = firstBody.genUi.actions.find(
      ({ id }: { id: string }) => id === 'accept_fulfillment',
    )?.value;
    expect(savedAddressRef).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(
      JSON.stringify(firstBody).split(privateAddress.line1),
    ).toHaveLength(2);

    const durableCompletion = complete.mock.calls.find(
      ([operation]) =>
        operation.operation === 'kfc_synchronous_request',
    )?.[2];
    expect(durableCompletion).toBeDefined();
    const durableBody = durableCompletion?.body;
    expect(isRecord(durableBody)).toBe(true);
    if (!isRecord(durableBody)) {
      throw new Error('expected a durable response body');
    }
    expect(durableBody).not.toHaveProperty('state');
    expect(JSON.stringify(durableBody))
      .not.toContain(privateAddress.line1);
    expect(durableBody).toMatchObject({
      genUi: {
        data: { cart },
        actions: expect.arrayContaining([
          expect.objectContaining({
            id: 'accept_fulfillment',
            value: savedAddressRef,
          }),
        ]),
      },
      presentation: {
        genUi: {
          data: { cart },
        },
      },
    });
    expect(isKfcGenUiAttachment(durableBody.genUi)).toBe(true);
    if (!isKfcGenUiAttachment(durableBody.genUi)) {
      throw new Error('expected a durable saved-address GenUI');
    }
    expect(durableBody.genUi.data).not.toHaveProperty('address');
    expect(isRecord(durableBody.presentation)).toBe(true);
    if (
      !isRecord(durableBody.presentation) ||
      !isKfcGenUiAttachment(durableBody.presentation.genUi)
    ) {
      throw new Error('expected a durable presentation GenUI');
    }
    expect(durableBody.presentation.genUi.data)
      .not.toHaveProperty('address');

    const replay = await server.inject({
      method: 'POST',
      url: '/chat/kfc/message',
      payload,
    });

    expect(replay.statusCode, replay.body).toBe(200);
    const replayBody = replay.json();
    expect(replayBody).toMatchObject({
      replayed: true,
      genUi: {
        data: { cart },
        actions: expect.arrayContaining([
          expect.objectContaining({
            id: 'accept_fulfillment',
            value: savedAddressRef,
          }),
        ]),
      },
      presentation: {
        genUi: {
          data: { cart },
        },
      },
    });
    expect(replayBody).not.toHaveProperty('state');
    expect(replayBody.genUi.data).not.toHaveProperty('address');
    expect(replayBody.presentation.genUi.data)
      .not.toHaveProperty('address');
    expect(JSON.stringify(replayBody))
      .not.toContain(privateAddress.line1);
    expect(model.callCount).toBe(2);
  });

  it('atomically rejects concurrent duplicate and conflicting KFC requests', async () => {
    const store = new MemoryStore();
    let releaseResponse!: () => void;
    let markModelEntered!: () => void;
    const responseReleased = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    const modelEntered = new Promise<void>((resolve) => {
      markModelEntered = resolve;
    });
    const model = fakeModel();
    vi.spyOn(model, 'bindTools').mockReturnValue(model);
    const generate = vi.spyOn(model, '_generate').mockImplementation(async (messages) => {
      markModelEntered();
      await responseReleased;
      return {
        generations: [{
          text: '',
          message: groundedResponseModelReply({
            customerText: 'Một kết quả duy nhất.',
          })(messages),
        }],
      };
    });
    const initialNow = Date.now();
    const now = vi.spyOn(Date, 'now').mockReturnValue(initialNow);
    const reserve = vi.spyOn(store, 'reserveIrreversibleOperation');
    const server = buildServer({
      store,
      ...testAgent(model, groundedResponseVerifierModel()),
    });
    const identity = {
      sessionId: 'kfc:concurrent_idempotent_customer',
      customerId: 'concurrent_idempotent_customer',
      clientMessageId: 'kfc_msg_concurrent_idempotent_1',
    };
    const originalPromise = server.inject({
      method: 'POST',
      url: '/chat/kfc/message',
      payload: { ...identity, text: 'Cho mình xem thực đơn' },
    });

    await modelEntered;
    now.mockReturnValue(initialNow + 31_000);
    try {
      const duplicate = await server.inject({
        method: 'POST',
        url: '/chat/kfc/message',
        payload: { ...identity, text: 'Cho mình xem thực đơn' },
      });
      expect(duplicate.statusCode).toBe(409);
      expect(duplicate.json()).toEqual({ errorCode: 'kfc_request_in_progress' });

      const conflict = await server.inject({
        method: 'POST',
        url: '/chat/kfc/message',
        payload: { ...identity, text: 'Tạo đơn hàng ngay' },
      });
      expect(conflict.statusCode).toBe(409);
      expect(conflict.json()).toMatchObject({ errorCode: 'idempotency_conflict' });
    } finally {
      releaseResponse();
      now.mockRestore();
    }

    const original = await originalPromise;
    const replay = await server.inject({
      method: 'POST',
      url: '/chat/kfc/message',
      payload: { ...identity, text: 'Cho mình xem thực đơn' },
    });
    expect(original.statusCode).toBe(200);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual({ ...original.json(), replayed: true });
    expect(generate).toHaveBeenCalledOnce();
    expect(reserve).toHaveBeenCalledTimes(1);
  });

  it('shares the atomic request fence between streaming and direct KFC routes', async () => {
    const store = new MemoryStore();
    const deferred: Array<() => Promise<void>> = [];
    let releaseResponse!: () => void;
    let markModelEntered!: () => void;
    const responseReleased = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    const modelEntered = new Promise<void>((resolve) => {
      markModelEntered = resolve;
    });
    const model = fakeModel();
    vi.spyOn(model, 'bindTools').mockReturnValue(model);
    const generate = vi.spyOn(model, '_generate').mockImplementation(async (messages) => {
      markModelEntered();
      await responseReleased;
      return {
        generations: [{
          text: '',
          message: groundedResponseModelReply({
            customerText: 'Một kết quả duy nhất.',
          })(messages),
        }],
      };
    });
    const server = buildServer({
      store,
      defer(task) {
        deferred.push(task);
      },
      ...testAgent(model, groundedResponseVerifierModel()),
    });
    const identity = {
      sessionId: 'kfc:stream_direct_customer',
      customerId: 'stream_direct_customer',
      clientMessageId: 'kfc_msg_stream_direct_1',
    };
    const started = await server.inject({
      method: 'POST',
      url: '/chat/kfc/runs',
      payload: {
        schemaVersion: 1,
        ...identity,
        input: { kind: 'text', text: 'Cho mình xem thực đơn' },
      },
    });
    expect(started.statusCode).toBe(202);

    const streamedExecution = deferred[0]!();
    await modelEntered;
    try {
      const direct = await server.inject({
        method: 'POST',
        url: '/chat/kfc/message',
        payload: { ...identity, text: 'Cho mình xem thực đơn' },
      });
      expect(direct.statusCode).toBe(409);
      expect(['idempotency_conflict', 'kfc_request_in_progress'])
        .toContain(direct.json().errorCode);
      expect(generate).toHaveBeenCalledOnce();
    } finally {
      releaseResponse();
    }

    await streamedExecution;
    expect(await store.getCustomerRun(started.json().runId)).toMatchObject({
      status: 'completed',
    });
    expect(generate).toHaveBeenCalledOnce();
  });

  it('rejects conflicting reuse of a KFC client message identity', async () => {
    const model = fakeModel()
      .respond(groundedResponseModelReply({
        customerText: 'Kết quả đầu tiên.',
      }));
    const server = buildServer({
      ...testAgent(model, groundedResponseVerifierModel()),
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
    expect(model.callCount).toBe(1);
  });

  it('completes and replays a suppressed KFC request while human support owns the session', async () => {
    const store = new MemoryStore();
    await store.setSessionControl('kfc:paused_idempotent_customer', {
      agentMode: 'human_paused',
      assignedAgentId: 'agent_1',
    });
    const model = fakeModel()
      .respond(groundedResponseModelReply({
        customerText: 'Không được gọi.',
      }));
    const server = buildServer({
      store,
      ...testAgent(model, groundedResponseVerifierModel()),
    });
    const payload = {
      sessionId: 'kfc:paused_idempotent_customer',
      customerId: 'paused_idempotent_customer',
      clientMessageId: 'kfc_msg_paused_idempotent_1',
      text: 'Có ai đang kiểm tra đơn không?',
    };

    const original = await server.inject({
      method: 'POST',
      url: '/chat/kfc/message',
      payload,
    });
    const replay = await server.inject({
      method: 'POST',
      url: '/chat/kfc/message',
      payload,
    });

    expect(original.statusCode).toBe(200);
    expect(original.json()).toMatchObject({
      responseText: '',
      suppressed: true,
      agentMode: 'human_paused',
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual({ ...original.json(), replayed: true });
    expect(model.callCount).toBe(0);
    expect(await store.listTurns(payload.sessionId)).toHaveLength(1);
    expect((await store.listEvents(payload.sessionId)).filter(
      (event) => event.sourceType === 'assistant_reply_skipped',
    )).toHaveLength(1);
  });

  it('does not persist or consume a trusted GenUI action while human support owns the session', async () => {
    const store = new MemoryStore();
    const sessionId = 'kfc:paused_action_customer';
    const customerId = 'paused_action_customer';
    const verifiedState = {
      cart: {
        id: 'paused-action-cart',
        items: [{
          itemCode: '20751',
          name: 'Verified item',
          quantity: 1,
          unitPriceVnd: 99_000,
        }],
        subtotalVnd: 99_000,
        discountVnd: 0,
        deliveryFeeVnd: 0,
        totalVnd: 99_000,
        voucherCode: null,
      },
    };
    const attachment = actionableAttachment({
      sessionId,
      customerId,
      verifiedState,
    });
    await appendAuthenticatedActionState(
      store,
      sessionId,
      customerId,
      verifiedState,
    );
    await store.appendTurn({
      sessionId,
      channel: 'kfc',
      role: 'assistant',
      text: 'Your cart is ready.',
      externalMessageId: null,
      externalUserId: customerId,
      deliveryStatus: 'sent',
      metadata: { genUi: attachment },
    });
    await store.setSessionControl(sessionId, {
      agentMode: 'human_paused',
      assignedAgentId: 'agent_1',
    });
    const model = fakeModel().respond((messages) => {
      const authorityMessage = messages.find(
        (message) =>
          isSystemMessage(message) &&
          message.id === STRUCTURED_RESPONSE_REFERENCE_MESSAGE_ID,
      );
      if (
        !authorityMessage ||
        typeof authorityMessage.content !== 'string'
      ) {
        throw new Error('structured_action_reference_message_missing');
      }
      const parsed = JSON.parse(authorityMessage.content) as {
        selectedActionResponse?: unknown;
      };
      const selectedActionResponse =
        selectedActionResponseReferenceSchema.parse(
          parsed.selectedActionResponse,
        );
      return groundedResponseModelReply({
        customerText: 'The verified action is ready.',
        selectedActionResponse,
      })(messages);
    });
    const server = buildServer({
      store,
      lifecycle: sandboxIdentityLifecycle(),
      ...testAgent(
        model,
        groundedResponseVerifierModel(),
      ),
    });
    const action = {
      attachmentId: attachment.id,
      actionId: 'edit_cart',
    };

    const paused = await server.inject({
      method: 'POST',
      url: '/chat/kfc/genui-action',
      payload: {
        sessionId,
        customerId,
        clientMessageId: 'paused-action-attempt',
        action,
      },
    });

    expect(paused.statusCode).toBe(409);
    expect(paused.json()).toEqual({
      errorCode: 'trusted_genui_action_requires_ai_active_session',
      agentMode: 'human_paused',
    });
    expect((await store.listTurns(sessionId)).filter(
      (turn) => turn.role === 'user',
    )).toEqual([]);
    expect(model.callCount).toBe(0);

    await store.setSessionControl(sessionId, {
      agentMode: 'ai_active',
      assignedAgentId: null,
    });
    const resumed = await server.inject({
      method: 'POST',
      url: '/chat/kfc/genui-action',
      payload: {
        sessionId,
        customerId,
        clientMessageId: 'paused-action-attempt',
        action,
      },
    });

    expect(resumed.statusCode, resumed.body).toBe(200);
    expect(resumed.json()).toMatchObject({
      responseText: 'The verified action is ready.',
    });
    expect(model.callCount).toBeGreaterThan(0);
  });

  it('releases a failed KFC request reservation for a reconciled retry', async () => {
    const store = new MemoryStore();
    vi.spyOn(store, 'getSessionControl')
      .mockRejectedValueOnce(new Error('transient session-control failure'));
    const model = fakeModel()
      .respond(groundedResponseModelReply({
        customerText: 'Yêu cầu đã được thử lại.',
      }));
    const server = buildServer({
      store,
      ...testAgent(model, groundedResponseVerifierModel()),
    });
    const payload = {
      sessionId: 'kfc:failed_reservation_customer',
      customerId: 'failed_reservation_customer',
      clientMessageId: 'kfc_msg_failed_reservation_1',
      text: 'Cho mình xem thực đơn',
    };

    const failed = await server.inject({
      method: 'POST',
      url: '/chat/kfc/message',
      payload,
    });
    const retried = await server.inject({
      method: 'POST',
      url: '/chat/kfc/message',
      payload,
    });
    const replay = await server.inject({
      method: 'POST',
      url: '/chat/kfc/message',
      payload,
    });

    expect(failed.statusCode).toBe(500);
    expect(retried.statusCode).toBe(200);
    expect(retried.json()).toMatchObject({
      responseText: 'Yêu cầu đã được thử lại.',
      replayed: false,
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual({ ...retried.json(), replayed: true });
    expect(model.callCount).toBe(1);
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
    const store = new MemoryStore();
    await appendAuthenticatedActionState(
      store,
      'kfc:anon_customer_2',
      'anon_customer_2',
    );
    const server = buildServer({
      store,
      lifecycle: sandboxIdentityLifecycle(),
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

  it('binds one-shot GenUI actions to the delivered turn and replays only an exact action', async () => {
    const store = new MemoryStore();
    const sessionId = 'kfc:authority_customer';
    const customerId = 'authority_customer';
    const verifiedState = {
      cart: {
        id: 'cart-authority',
        items: [{
          itemCode: '20751',
          name: 'Combo Hợp Gu 99K',
          quantity: 1,
          unitPriceVnd: 99_000,
        }],
        subtotalVnd: 99_000,
        discountVnd: 0,
        deliveryFeeVnd: 0,
        totalVnd: 99_000,
        voucherCode: null,
      },
    };
    const attachment = actionableAttachment({
      sessionId,
      customerId,
      verifiedState,
    });
    await appendAuthenticatedActionState(
      store,
      sessionId,
      customerId,
      verifiedState,
    );
    await store.appendTurn({
      sessionId,
      channel: 'kfc',
      role: 'assistant',
      text: 'Giỏ hàng của bạn.',
      externalMessageId: null,
      externalUserId: customerId,
      deliveryStatus: 'sent',
      metadata: { genUi: attachment },
    });
    const server = buildServer({
      store,
      lifecycle: sandboxIdentityLifecycle(),
      ...testAgent(
        fakeModel().respond((messages) => {
          const authorityMessage = messages.find(
            (message) =>
              isSystemMessage(message) &&
              message.id ===
                STRUCTURED_RESPONSE_REFERENCE_MESSAGE_ID,
          );
          if (
            !authorityMessage ||
            typeof authorityMessage.content !== 'string'
          ) {
            throw new Error(
              'structured_action_reference_message_missing',
            );
          }
          const parsed = JSON.parse(authorityMessage.content) as {
            selectedActionResponse?: unknown;
          };
          return groundedResponseModelReply({
            customerText: 'Mình đã ghi nhận thao tác.',
            selectedActionResponse:
              selectedActionResponseReferenceSchema.parse(
                parsed.selectedActionResponse,
              ),
          })(messages);
        }),
        groundedResponseVerifierModel(),
      ),
    });
    const payload = {
      sessionId,
      customerId,
      clientMessageId: 'genui-authority-1',
      action: {
        attachmentId: attachment.id,
        actionId: 'continue_to_fulfillment',
      },
    };

    const first = await server.inject({
      method: 'POST',
      url: '/chat/kfc/genui-action',
      payload,
    });
    const exactReplay = await server.inject({
      method: 'POST',
      url: '/chat/kfc/genui-action',
      payload: { ...payload, clientMessageId: 'genui-authority-2' },
    });
    const conflict = await server.inject({
      method: 'POST',
      url: '/chat/kfc/genui-action',
      payload: {
        ...payload,
        clientMessageId: 'genui-authority-3',
        action: {
          attachmentId: attachment.id,
          actionId: 'edit_cart',
        },
      },
    });

    expect(first.statusCode, first.body).toBe(200);
    expect(exactReplay.statusCode).toBe(200);
    expect(exactReplay.json()).toMatchObject({ replayed: true });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ errorCode: 'genui_action_conflict' });
  });

  it('requires server-derived authenticated identity before resolving a delivered GenUI action', async () => {
    const store = new MemoryStore();
    const sessionId = 'kfc:unauthenticated_action';
    const customerId = 'unauthenticated_action';
    const attachment = actionableAttachment({ sessionId, customerId });
    await store.appendEvent(sessionId, 'graph:verified_state', { verifiedState: {} });
    await store.appendTurn({
      sessionId,
      channel: 'kfc',
      role: 'assistant',
      text: 'Giỏ hàng của bạn.',
      externalMessageId: null,
      externalUserId: customerId,
      deliveryStatus: 'sent',
      metadata: { genUi: attachment },
    });
    const server = buildServer({ store, lifecycle: sandboxIdentityLifecycle() });

    const response = await server.inject({
      method: 'POST',
      url: '/chat/kfc/genui-action',
      payload: {
        sessionId,
        customerId,
        clientMessageId: 'unauthenticated-action-1',
        action: { attachmentId: attachment.id, actionId: 'edit_cart' },
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ errorCode: 'authentication_required' });
  });

  it('rejects a delivered GenUI action when current verified commerce state changed', async () => {
    const store = new MemoryStore();
    const sessionId = 'kfc:stale_action_revision';
    const customerId = 'stale_action_revision';
    const attachment = actionableAttachment({ sessionId, customerId });
    await appendAuthenticatedActionState(store, sessionId, customerId, {
      cart: {
        id: 'cart_changed',
        items: [],
        subtotalVnd: 0,
        discountVnd: 0,
        deliveryFeeVnd: 0,
        totalVnd: 0,
        voucherCode: null,
      },
    });
    await store.appendTurn({
      sessionId,
      channel: 'kfc',
      role: 'assistant',
      text: 'Giỏ hàng của bạn.',
      externalMessageId: null,
      externalUserId: customerId,
      deliveryStatus: 'sent',
      metadata: { genUi: attachment },
    });
    const server = buildServer({ store, lifecycle: sandboxIdentityLifecycle() });

    const response = await server.inject({
      method: 'POST',
      url: '/chat/kfc/genui-action',
      payload: {
        sessionId,
        customerId,
        clientMessageId: 'stale-action-revision-1',
        action: { attachmentId: attachment.id, actionId: 'edit_cart' },
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ errorCode: 'stale_action_revision' });
  });

  it('rejects expired or wrong-principal GenUI authority before invoking the agent', async () => {
    const cases = [
      {
        suffix: 'expired',
        attachment: (sessionId: string, customerId: string) => {
          const value = actionableAttachment({
            sessionId,
            customerId,
            expiresAt: new Date(Date.now() - 1_000).toISOString(),
          });
          return {
            ...value,
            authority: {
              ...value.authority!,
              issuedAt: new Date(Date.now() - 60_000).toISOString(),
            },
          };
        },
        errorCode: 'expired_action',
      },
      {
        suffix: 'principal',
        attachment: (sessionId: string, customerId: string) => {
          const value = actionableAttachment({ sessionId, customerId });
          return {
            ...value,
            authority: { ...value.authority!, customerId: 'different_customer' },
          };
        },
        errorCode: 'untrusted_action_authority',
      },
      {
        suffix: 'invalid_dates',
        attachment: (sessionId: string, customerId: string) =>
          actionableAttachment({
            sessionId,
            customerId,
            expiresAt: 'not-a-date',
          }),
        errorCode: 'untrusted_action_authority',
      },
    ];

    for (const testCase of cases) {
      const store = new MemoryStore();
      const customerId = `authority_${testCase.suffix}`;
      const sessionId = `kfc:${customerId}`;
      const attachment = testCase.attachment(sessionId, customerId);
      await appendAuthenticatedActionState(store, sessionId, customerId);
      await store.appendTurn({
        sessionId,
        channel: 'kfc',
        role: 'assistant',
        text: 'Giỏ hàng của bạn.',
        externalMessageId: null,
        externalUserId: customerId,
        deliveryStatus: 'sent',
        metadata: { genUi: attachment },
      });
      const server = buildServer({ store, lifecycle: sandboxIdentityLifecycle() });
      const response = await server.inject({
        method: 'POST',
        url: '/chat/kfc/genui-action',
        payload: {
          sessionId,
          customerId,
          clientMessageId: `genui-${testCase.suffix}`,
          action: {
            attachmentId: attachment.id,
            actionId: 'edit_cart',
          },
        },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ errorCode: testCase.errorCode });
    }
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
    const server = buildServer({
      ...testAgent(
        fakeModel()
          .respond(groundedResponseModelReply({
            customerText:
              'Xin chào, mình có thể hỗ trợ bạn xem menu hoặc đặt món.',
          })),
        groundedResponseVerifierModel(),
      ),
    });
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

  it('runs chat through the injected agent without publishing internal state', async () => {
    const dashboard = new DashboardEventBus();
    const server = buildServer({
      dashboard,
      fixturesRoot: process.cwd(),
      ...testAgent(
        fakeModel()
          .respondWithTools([{
            name: 'searchMenu',
            args: { scope: 'filtered', query: 'Combo Hợp Gu 99K' },
          }])
          .respondWithTools([{
            name: 'updateCart',
            args: {
              changes: [{
                itemCode: '20751',
                quantity: 3,
                modifiers: [],
              }],
            },
          }])
          .respond(groundedResponseModelReply({
            customerText: 'Mình đã cập nhật giỏ hàng.',
            evidenceReferences: [{
              evidenceId: 'cart',
              claimKinds: ['product'],
            }],
          })),
        groundedResponseVerifierModel({
          evidenceReferences: [{
            evidenceId: 'cart',
            claimKinds: ['product'],
          }],
        }),
      ),
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
    expect(response.json()).not.toHaveProperty('state');
    expect(
      dashboard
        .getEvents('kfc:s')
        .filter(
          (event) =>
            event.type === 'session_updated' &&
            event.payload.updateType === 'tool_called',
        )
        .map((event) => event.payload.toolName),
    ).toEqual(['searchMenu', 'updateCart']);
  });

  it('accepts an agent-backed chat turn and emits dashboard events from verified tool results', async () => {
    const server = buildServer({
      readiness: {
        release: {
          gitSha: 'qualified-sha',
          deploymentId: 'worker-qualified-1',
          builtAt: '2026-07-15T00:00:00Z',
          dirty: false,
        },
      },
      ...testAgent(
        fakeModel()
          .respondWithTools([{
            name: 'searchMenu',
            args: { scope: 'filtered', query: 'Combo Hợp Gu 99K' },
          }])
          .respondWithTools([{
            name: 'updateCart',
            args: {
              changes: [{
                itemCode: '20751',
                quantity: 3,
                modifiers: [],
              }],
            },
          }])
          .respond(groundedResponseModelReply({
            customerText: 'Mình đã cập nhật giỏ hàng.',
            evidenceReferences: [{
              evidenceId: 'cart',
              claimKinds: ['product'],
            }],
          })),
        groundedResponseVerifierModel({
          evidenceReferences: [{
            evidenceId: 'cart',
            claimKinds: ['product'],
          }],
        }),
      ),
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
      genUi: {
        data: {
          cart: {
            items: [
              expect.objectContaining({
                itemCode: '20751',
                name: 'Combo Hợp Gu 99K',
              }),
            ],
          },
        },
      },
    });
    expect(response.json()).not.toHaveProperty('state');

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
    expect(turns.json().turns.every((turn: { metadata?: { release?: unknown } }) =>
      JSON.stringify(turn.metadata?.release) === JSON.stringify({
        gitSha: 'qualified-sha',
        deploymentId: 'worker-qualified-1',
        builtAt: '2026-07-15T00:00:00Z',
        dirty: false,
      }),
    )).toBe(true);
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
      ...testAgent(
        fakeModel()
          .respondWithTools([{
            name: 'searchMenu',
            args: { scope: 'filtered', query: 'Combo Hợp Gu 99K' },
          }])
          .respondWithTools([{
            name: 'updateCart',
            args: {
              changes: [{
                itemCode: '20751',
                quantity: 3,
                modifiers: [],
              }],
            },
          }])
          .respondWithTools([{
            name: 'quoteFulfillment',
            args: {
              address: {
                label: null,
                line1: 'Big C Đồng Nai',
                district: 'Biên Hòa',
                city: 'ĐỒNG NAI',
              },
              method: 'delivery',
            },
          }])
          .respondWithTools([
            {
              name: 'searchPromotions',
              args: { scope: 'filtered', query: 'KFC Voucher' },
            },
            {
              name: 'answerAllergenQuestion',
              args: { query: 'phô mai' },
            },
            {
              name: 'validateVoucher',
              args: { voucherText: 'KFC50' },
            },
          ])
          .respond(groundedResponseModelReply({
            customerText: 'Mình đã kiểm tra yêu cầu.',
          })),
        groundedResponseVerifierModel(),
      ),
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

  it('does not eagerly load fixtures for non-chat routes', async () => {
    const server = buildServer({ fixturesRoot: process.cwd() });
    const response = await server.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true });
  });
});
