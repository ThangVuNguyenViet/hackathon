import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { Callbacks } from '@langchain/core/callbacks/manager';
import { FakeListChatModel } from '@langchain/core/utils/testing';
import { describe, expect, it, vi } from 'vitest';
import { createAgentTraceContext } from '../../src/agent/agentTraceContext.js';
import {
  KFC_AGENT_INSTRUCTIONS,
  kfcVietnamPack,
} from '../../src/businessPacks/kfcVietnam/kfcVietnamPack.js';
import { runAgentTurn } from '../../src/agent/kfcAgent.js';
import { buildVerifiedStateSnapshot } from '../../src/agent/verifiedState.js';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import { loadGeneratedFixtures } from '../../src/fixtures/loadFixtures.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import {
  createPackStateEnvelope,
  validatePackStateEnvelope,
} from '../../src/runtime/businessPack.js';
import type {
  AgentTraceSpan,
  AgentTracer,
} from '../../src/observability/agentTracing.js';
import { buildVerifiedCollectionSnapshot } from '../../src/ordering/verifiedCollections.js';
import {
  scheduleAgentBackground,
  type WorkerExecutionContext,
} from '../../src/worker.js';
import { configuredTestAgent } from '../support/configured-agent-model.js';

function toolOutputText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (
    typeof value === 'object' &&
    value !== null &&
    'content' in value &&
    typeof value.content === 'string'
  ) {
    return value.content;
  }
  throw new Error('Unexpected tool output');
}

describe('KFC Vietnam business pack compatibility', () => {
  it('allows trusted demo turns to switch models while preserving history and provenance', async () => {
    const store = new MemoryStore();
    const clients = createMockClients(
      await loadGeneratedFixtures(process.cwd()),
    );
    const dashboard = new DashboardEventBus();
    const openAi = configuredTestAgent(
      new FakeListChatModel({ responses: ['Phản hồi OpenAI'] }),
    );
    const qwen = configuredTestAgent(
      new FakeListChatModel({ responses: ['Phản hồi Qwen'] }),
      'qwen3.7-max',
    );

    await runAgentTurn({
      sessionId: 'session-kfc-model-switch',
      customerId: 'customer-1',
      channel: 'kfc',
      text: 'Lượt đầu',
      clients,
      store,
      dashboard,
      agentModelBinding: openAi,
    });
    await runAgentTurn({
      sessionId: 'session-kfc-model-switch',
      customerId: 'customer-1',
      channel: 'kfc',
      text: 'Lượt tiếp theo',
      clients,
      store,
      dashboard,
      agentModelBinding: qwen,
    });

    const turns = await store.listTurns('session-kfc-model-switch');
    expect(turns.map((turn) => turn.text)).toEqual([
      'Lượt đầu',
      'Phản hồi OpenAI',
      'Lượt tiếp theo',
      'Phản hồi Qwen',
    ]);
    expect(
      turns
        .filter((turn) => turn.role === 'assistant')
        .map((turn) => turn.metadata?.agentModel?.candidateId),
    ).toEqual(['openai-gpt-4.1-mini', 'qwen3.7-max']);
  });

  it('rejects a model without a trusted configured binding before transcript work', async () => {
    const store = new MemoryStore();
    const input = {
      sessionId: 'session-kfc-unbound-model',
      customerId: 'customer-1',
      channel: 'kfc' as const,
      text: 'Xin chào',
      clients: createMockClients(await loadGeneratedFixtures(process.cwd())),
      store,
      dashboard: new DashboardEventBus(),
      agentModel: {} as BaseChatModel,
    };

    await expect(
      kfcVietnamPack.run(input, async () => 'must not run'),
    ).rejects.toThrow('agent_model_binding_untrusted');
    await expect(store.listTurns(input.sessionId)).resolves.toEqual([]);
  });

  it('rejects a raw unrelated identity before transcript work', async () => {
    const store = new MemoryStore();
    const input = {
      sessionId: 'session-kfc-raw-identity',
      customerId: 'customer-1',
      channel: 'kfc' as const,
      text: 'Xin chào',
      clients: createMockClients(await loadGeneratedFixtures(process.cwd())),
      store,
      dashboard: new DashboardEventBus(),
      agentModel: {} as BaseChatModel,
      agentModelIdentity: {
        candidateId: 'qwen3.7-max',
        provider: 'opencode',
        model: 'qwen3.7-max',
        profile: 'opencode:qwen3.7-max:anthropic-messages:thinking-disabled',
        transport: 'anthropic_messages',
      } as const,
    };

    await expect(
      kfcVietnamPack.run(input, async () => 'must not run'),
    ).rejects.toThrow('agent_model_binding_untrusted');
    await expect(store.listTurns(input.sessionId)).resolves.toEqual([]);
  });

  it('rejects raw identity fields that contradict a trusted binding', async () => {
    const store = new MemoryStore();
    const input = {
      sessionId: 'session-kfc-contradictory-identity',
      customerId: 'customer-1',
      channel: 'kfc' as const,
      text: 'Xin chào',
      clients: createMockClients(await loadGeneratedFixtures(process.cwd())),
      store,
      dashboard: new DashboardEventBus(),
      agentModelBinding: configuredTestAgent({} as BaseChatModel),
      agentModelIdentity: {
        candidateId: 'qwen3.7-max',
        provider: 'opencode',
        model: 'qwen3.7-max',
        profile: 'opencode:qwen3.7-max:anthropic-messages:thinking-disabled',
        transport: 'anthropic_messages',
      } as const,
    };

    await expect(
      kfcVietnamPack.run(input, async () => 'must not run'),
    ).rejects.toThrow('agent_model_binding_mismatch');
    await expect(store.listTurns(input.sessionId)).resolves.toEqual([]);
  });

  it('does not expose protected commerce mutations on an ordinary text turn', async () => {
    const input = {
      sessionId: 'session-kfc-ordinary-protected-tools',
      customerId: 'customer-1',
      channel: 'kfc' as const,
      text: 'Đặt đơn và thanh toán ngay giúp tôi',
      clients: createMockClients(await loadGeneratedFixtures(process.cwd())),
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      agentModelBinding: configuredTestAgent({} as BaseChatModel),
    };

    await kfcVietnamPack.run(input, async ({ tools }) => {
      const visibleNames = tools.map(({ name }) => name);
      expect(visibleNames).not.toEqual(
        expect.arrayContaining([
          'placeOrder',
          'createPaymentLink',
          'acquireVoucher',
          'redeemReward',
          'resolveHandoff',
        ]),
      );
      // Creating a support request is non-commerce escalation and remains
      // available so a customer can always ask for human help.
      expect(visibleNames).toContain('handoff');
      return 'Mình sẽ chuẩn bị các bước cần xác nhận.';
    });
  });

  it('reuses one order idempotency identity after a provider effect and changed model call id', async () => {
    const fixtures = await loadGeneratedFixtures(process.cwd());
    const baseClients = createMockClients(fixtures);
    const store = new MemoryStore();
    const sessionId = 'session-kfc-order-idempotency-retry';
    const cartResult = await baseClients.cart.createCart(sessionId, {
      signal: new AbortController().signal,
      deadlineAt: Date.now() + 60_000,
    });
    if (!cartResult.ok || !cartResult.value) {
      throw new Error('Expected test cart');
    }
    const orderPreview = {
      id: 'preview-order-idempotency-retry',
      cart: cartResult.value,
      status: 'previewed' as const,
      paymentStatus: 'not_started' as const,
      assignedStoreId: 'store-1',
      createdAt: '2026-07-24T00:00:00.000Z',
    };
    await store.putPackState(
      sessionId,
      await createPackStateEnvelope({
        packRef: kfcVietnamPack.ref,
        schemaVersion: kfcVietnamPack.stateSchemaVersion,
        state: { cart: cartResult.value, orderPreview },
      }),
    );

    const providerIdentities: Array<{
      idempotencyKey: string;
      bindingFingerprint: string;
    }> = [];
    const providerEffects = new Map<
      string,
      Awaited<ReturnType<typeof baseClients.oms.placeOrder>>
    >();
    const clients = {
      ...baseClients,
      oms: {
        ...baseClients.oms,
        async placeOrder(
          order: Parameters<typeof baseClients.oms.placeOrder>[0],
          context: Parameters<typeof baseClients.oms.placeOrder>[1],
          identity: Parameters<typeof baseClients.oms.placeOrder>[2],
        ) {
          providerIdentities.push(identity);
          const prior = providerEffects.get(identity.idempotencyKey);
          if (prior) return prior;
          const result = await baseClients.oms.placeOrder(
            order,
            context,
            identity,
          );
          providerEffects.set(identity.idempotencyKey, result);
          return result;
        },
      },
    };
    const input = {
      sessionId,
      customerId: 'customer-1',
      channel: 'kfc' as const,
      text: '',
      trustedCustomerAction: {
        source: 'kfc_genui_action' as const,
        assistantTurnId: 'assistant-order-idempotency-retry',
        attachmentId: 'attachment-order-idempotency-retry',
        actionDigest: '3'.repeat(64),
        verifiedRevision: '4'.repeat(64),
        lifecycle: 'one_shot' as const,
        command: { kind: 'confirm_order' as const },
      },
      clients,
      store,
      dashboard: new DashboardEventBus(),
      agentModelBinding: configuredTestAgent({} as BaseChatModel),
    };
    const invokeOrder = async (
      tools: Parameters<Parameters<typeof kfcVietnamPack.run>[1]>[0]['tools'],
      callId: string,
    ) => {
      const placeOrder = tools.find(({ name }) => name === 'placeOrder');
      if (!placeOrder) throw new Error('Missing placeOrder');
      return JSON.parse(
        toolOutputText(
          await placeOrder.invoke({
            type: 'tool_call',
            name: 'placeOrder',
            args: {},
            id: callId,
          }),
        ),
      ) as { ok: boolean };
    };

    await expect(
      kfcVietnamPack.run(
        {
          ...input,
          runGuard: {
            commitFence: {
              kind: 'agent_run',
              runId: 'run-before-crash',
              generation: 1,
              sessionAuthorityGeneration: 1,
              executionAttempt: 1,
              executionLeaseToken: 'lease-before-crash',
            } as const,
            async isCurrent() {
              return true;
            },
          },
        },
        async ({ tools }) => {
          expect(
            await invokeOrder(tools, 'model-call-before-crash'),
          ).toMatchObject({ ok: true });
          expect(
            await invokeOrder(tools, 'model-call-duplicate-same-action'),
          ).toMatchObject({
            ok: false,
            errorCode: 'trusted_action_already_consumed',
          });
          throw new Error('simulated_crash_after_provider_effect');
        },
      ),
    ).rejects.toThrow('simulated_crash_after_provider_effect');
    await expect(
      kfcVietnamPack.run(
        {
          ...input,
          runGuard: {
            commitFence: {
              kind: 'agent_run',
              runId: 'changed-run-on-retry',
              generation: 2,
              sessionAuthorityGeneration: 2,
              executionAttempt: 1,
              executionLeaseToken: 'changed-lease-on-retry',
            } as const,
            async isCurrent() {
              return true;
            },
          },
        },
        async ({ tools }) => {
          expect(
            await invokeOrder(tools, 'different-model-call-on-retry'),
          ).toMatchObject({ ok: true });
          return 'Đơn hàng đã được tạo.';
        },
      ),
    ).rejects.toThrow('customer_run_cancelled');

    expect(providerIdentities).toHaveLength(2);
    expect(providerIdentities[1]).toEqual(providerIdentities[0]);
    expect(providerEffects).toHaveLength(1);
  });

  it('derives payment arguments from trusted selection and reuses identity after a crash', async () => {
    const fixtures = await loadGeneratedFixtures(process.cwd());
    const baseClients = createMockClients(fixtures);
    const store = new MemoryStore();
    const sessionId = 'session-kfc-payment-idempotency-retry';
    const externalCallContext = {
      signal: new AbortController().signal,
      deadlineAt: Date.now() + 60_000,
    };
    const cart = await baseClients.cart.createCart(
      sessionId,
      externalCallContext,
    );
    if (!cart.ok || !cart.value) throw new Error('Expected test cart');
    const methods = await baseClients.payment.listMethods(
      {},
      externalCallContext,
    );
    if (!methods.ok || !methods.value)
      throw new Error('Expected payment methods');
    const snapshot = await buildVerifiedCollectionSnapshot({
      items: methods.value,
      scope: { scope: 'all' },
      providerRevision: 'payment-methods-revision',
    });
    const selected = methods.value.find(
      ({ supported, supportStatus }) =>
        supported && supportStatus === 'listed_supported',
    );
    if (!selected) throw new Error('Expected supported payment method');
    const order = {
      id: 'KFC-PAYMENT-IDEMPOTENCY-ORDER',
      cart: cart.value,
      status: 'created' as const,
      paymentStatus: 'pending' as const,
      assignedStoreId: 'store-1',
      createdAt: '2026-07-24T00:00:00.000Z',
    };
    await store.putPackState(
      sessionId,
      await createPackStateEnvelope({
        packRef: kfcVietnamPack.ref,
        schemaVersion: kfcVietnamPack.stateSchemaVersion,
        state: {
          cart: cart.value,
          order,
          verifiedCollections: {
            listPaymentMethods: { [snapshot.key]: snapshot },
          },
          activeCollectionKeys: { listPaymentMethods: snapshot.key },
        },
      }),
    );

    const identities: Array<{
      idempotencyKey: string;
      bindingFingerprint: string;
    }> = [];
    const providerEffects = new Map<
      string,
      Awaited<ReturnType<typeof baseClients.payment.createPaymentLink>>
    >();
    const clients = {
      ...baseClients,
      payment: {
        ...baseClients.payment,
        async createPaymentLink(
          paymentOrder: Parameters<
            typeof baseClients.payment.createPaymentLink
          >[0],
          methodId: Parameters<typeof baseClients.payment.createPaymentLink>[1],
          context: Parameters<typeof baseClients.payment.createPaymentLink>[2],
          identity: Parameters<typeof baseClients.payment.createPaymentLink>[3],
        ) {
          expect(methodId).toBe(selected.methodId);
          identities.push(identity);
          const prior = providerEffects.get(identity.idempotencyKey);
          if (prior) return prior;
          const result = await baseClients.payment.createPaymentLink(
            paymentOrder,
            methodId,
            context,
            identity,
          );
          providerEffects.set(identity.idempotencyKey, result);
          return result;
        },
      },
    };
    const input = {
      sessionId,
      customerId: 'customer-1',
      channel: 'kfc' as const,
      externalMessageId: 'message-payment-idempotency-retry',
      text: '',
      trustedCustomerAction: {
        source: 'kfc_genui_action' as const,
        assistantTurnId: 'assistant-payment-idempotency-retry',
        attachmentId: 'attachment-payment-idempotency-retry',
        actionDigest: '5'.repeat(64),
        verifiedRevision: '6'.repeat(64),
        lifecycle: 'one_shot' as const,
        command: {
          kind: 'select_payment_method' as const,
          selection: {
            methodId: selected.methodId,
            collectionKey: snapshot.key,
            collectionRevision: snapshot.revision,
            providerRevision: snapshot.providerRevision,
          },
        },
      },
      clients,
      store,
      dashboard: new DashboardEventBus(),
      agentModelBinding: configuredTestAgent({} as BaseChatModel),
    };
    const invokePayment = async (
      tools: Parameters<Parameters<typeof kfcVietnamPack.run>[1]>[0]['tools'],
      callId: string,
    ) => {
      const payment = tools.find(({ name }) => name === 'createPaymentLink');
      if (!payment) throw new Error('Missing createPaymentLink');
      return JSON.parse(
        toolOutputText(
          await payment.invoke({
            type: 'tool_call',
            name: 'createPaymentLink',
            args: {},
            id: callId,
          }),
        ),
      ) as { ok: boolean };
    };

    await expect(
      kfcVietnamPack.run(input, async ({ tools }) => {
        expect(
          await invokePayment(tools, 'payment-call-before-crash'),
        ).toMatchObject({ ok: true });
        throw new Error('simulated_crash_after_payment_effect');
      }),
    ).rejects.toThrow('simulated_crash_after_payment_effect');
    await kfcVietnamPack.run(input, async ({ tools }) => {
      expect(
        await invokePayment(tools, 'changed-payment-call-on-retry'),
      ).toMatchObject({ ok: true });
      return 'Liên kết thanh toán đã sẵn sàng.';
    });

    expect(identities).toHaveLength(2);
    expect(identities[1]).toEqual(identities[0]);
    expect(providerEffects).toHaveLength(1);
  });

  it('does not expose payment mutation for a stale trusted selection', async () => {
    const input = {
      sessionId: 'session-kfc-stale-payment-selection',
      customerId: 'customer-1',
      channel: 'kfc' as const,
      text: '',
      trustedCustomerAction: {
        source: 'kfc_genui_action' as const,
        assistantTurnId: 'assistant-stale-payment',
        attachmentId: 'attachment-stale-payment',
        actionDigest: '7'.repeat(64),
        verifiedRevision: '8'.repeat(64),
        lifecycle: 'one_shot' as const,
        command: {
          kind: 'select_payment_method' as const,
          selection: {
            methodId: 'stale-method',
            collectionKey: 'stale-collection',
            collectionRevision: 'stale-revision',
            providerRevision: 'stale-provider-revision',
          },
        },
      },
      clients: createMockClients(await loadGeneratedFixtures(process.cwd())),
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      agentModelBinding: configuredTestAgent({} as BaseChatModel),
    };

    await kfcVietnamPack.run(input, async ({ tools }) => {
      expect(tools.some(({ name }) => name === 'createPaymentLink')).toBe(
        false,
      );
      return 'Phương thức thanh toán đã hết hiệu lực, vui lòng chọn lại.';
    });
  });

  it('supplies trusted turn correlation and callback runtime to the kernel invocation', async () => {
    const roots: Array<{
      inputs: Record<string, unknown>;
      metadata?: Record<string, unknown>;
      tags?: string[];
    }> = [];
    const callbacks = [] as unknown as Callbacks;
    const activeContext = async <T>(operation: () => Promise<T>): Promise<T> =>
      operation();
    const span: AgentTraceSpan = {
      async startSpan() {
        return span;
      },
      async end() {},
      async fail() {},
      async langchainCallbacks() {
        return callbacks;
      },
      withActiveTrace: activeContext,
    };
    const tracer: AgentTracer = {
      async startTurn(input) {
        roots.push(input);
        return span;
      },
      async flush() {},
    };
    const store = new MemoryStore();
    const runId = 'customer-run-7';
    const input = {
      sessionId: 'session-kfc-trace',
      customerId: 'customer-1',
      channel: 'kfc' as const,
      text: 'Private customer message',
      clients: createMockClients(await loadGeneratedFixtures(process.cwd())),
      store,
      dashboard: new DashboardEventBus(),
      agentModelBinding: configuredTestAgent({} as BaseChatModel),
      traceContext: createAgentTraceContext({
        scenarioId: 'scenario-03',
        probeRunId: 'probe-7',
      }),
      runGuard: {
        async isCurrent() {
          return true;
        },
        commitFence: {
          kind: 'customer_run' as const,
          runId,
          sessionAuthorityGeneration: 1,
        },
      },
      tracer,
    };

    await expect(
      kfcVietnamPack.run(input, async (invocation) => {
        expect(invocation.runtime?.callbacks).toBe(callbacks);
        expect(invocation.runtime?.runWithContext).toBeTypeOf('function');
        throw new Error('stop-before-persistence');
      }),
    ).rejects.toThrow('stop-before-persistence');

    const userTurn = (await store.listTurns(input.sessionId)).find(
      ({ role }) => role === 'user',
    );
    expect(roots).toEqual([
      {
        name: 'kfc_agent_turn',
        inputs: {
          messageCharacterCount: input.text.length,
          structuredAction: false,
        },
        metadata: {
          session_id: input.sessionId,
          run_id: runId,
          turn_id: userTurn?.id,
          pack_id: 'kfc-vietnam',
          pack_version: '1.0.0',
          candidate: 'openai-gpt-4.1-mini',
          profile: 'openai:gpt-4.1-mini:responses',
          transport: 'openai_responses',
          response_profile: 'genui',
          channel: 'kfc',
          scenarioId: 'scenario-03',
          probeRunId: 'probe-7',
        },
        tags: [
          'pack:kfc-vietnam',
          'pack-version:1.0.0',
          'candidate:openai-gpt-4.1-mini',
          'transport:openai_responses',
          'profile:genui',
          'channel:kfc',
        ],
      },
    ]);
    expect(JSON.stringify(roots)).not.toContain(input.text);
  });

  it('keeps callback, active-context, and quota failures off the product path', async () => {
    const privateFailure = 'Authorization: Bearer trace-secret';
    const diagnostics = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const deferred: Array<() => Promise<void>> = [];
    const failedSpan: AgentTraceSpan = {
      async startSpan() {
        return failedSpan;
      },
      async end() {},
      async fail() {},
      async langchainCallbacks() {
        throw new Error(privateFailure);
      },
      async withActiveTrace() {
        throw new Error(privateFailure);
      },
    };
    const tracer: AgentTracer = {
      async startTurn() {
        return failedSpan;
      },
      async flush() {
        throw new Error(privateFailure);
      },
    };

    try {
      const output = await runAgentTurn({
        sessionId: 'session-kfc-trace-failure',
        customerId: 'customer-1',
        channel: 'messenger_mock',
        text: 'Xin chào',
        clients: createMockClients(await loadGeneratedFixtures(process.cwd())),
        store: new MemoryStore(),
        dashboard: new DashboardEventBus(),
        agentModelBinding: configuredTestAgent(
          new FakeListChatModel({
            responses: ['Xin chào! Tôi có thể giúp gì cho bạn?'],
          }),
        ),
        tracer,
        deferWork(task) {
          deferred.push(task);
        },
      });

      expect(output.responseText).toBe('Xin chào! Tôi có thể giúp gì cho bạn?');
      expect(deferred).toHaveLength(2);
      await expect(Promise.all(deferred.map((task) => task()))).resolves.toEqual(
        [undefined, undefined],
      );
      expect(diagnostics).toHaveBeenCalledWith(
        'agent_trace_callbacks_failed',
        expect.any(Object),
      );
      expect(diagnostics).toHaveBeenCalledWith(
        'agent_trace_active_context_failed',
        expect.any(Object),
      );
      expect(diagnostics).toHaveBeenCalledWith(
        'agent_trace_flush_failed',
        expect.any(Object),
      );
      expect(JSON.stringify(diagnostics.mock.calls)).not.toContain(
        privateFailure,
      );
    } finally {
      diagnostics.mockRestore();
    }
  });

  it('flushes one completed turn only once at the Worker background boundary', async () => {
    const deferred: Array<() => Promise<void>> = [];
    const flush = vi.fn(async () => undefined);
    const span: AgentTraceSpan = {
      async startSpan() {
        return span;
      },
      async end() {},
      async fail() {},
    };
    const tracer: AgentTracer = {
      async startTurn() {
        return span;
      },
      flush,
    };

    await runAgentTurn({
      sessionId: 'session-kfc-single-trace-flush',
      customerId: 'customer-1',
      channel: 'messenger_mock',
      text: 'Xin chào',
      clients: createMockClients(await loadGeneratedFixtures(process.cwd())),
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      agentModelBinding: configuredTestAgent(
        new FakeListChatModel({ responses: ['Xin chào!'] }),
      ),
      tracer,
      deferWork(task) {
        deferred.push(task);
      },
    });

    let background: Promise<unknown> | undefined;
    const context: WorkerExecutionContext = {
      waitUntil(promise) {
        background = promise;
      },
    };
    scheduleAgentBackground(context, deferred, tracer);
    await background;

    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('rejects correctly bound malformed KFC state and accepts a valid partial state', async () => {
    const malformed = await createPackStateEnvelope({
      packRef: kfcVietnamPack.ref,
      schemaVersion: kfcVietnamPack.stateSchemaVersion,
      state: { cart: 'corrupt' },
    });
    const valid = await createPackStateEnvelope({
      packRef: kfcVietnamPack.ref,
      schemaVersion: kfcVietnamPack.stateSchemaVersion,
      state: {
        cart: {
          id: 'cart-1',
          items: [],
          subtotalVnd: 0,
          discountVnd: 0,
          deliveryFeeVnd: 0,
          totalVnd: 0,
          voucherCode: null,
        },
      },
    });
    const unknownShape = await createPackStateEnvelope({
      packRef: kfcVietnamPack.ref,
      schemaVersion: kfcVietnamPack.stateSchemaVersion,
      state: { unrecognizedAuthority: {} },
    });

    await expect(
      validatePackStateEnvelope(malformed, {
        packRef: kfcVietnamPack.ref,
        schemaVersion: kfcVietnamPack.stateSchemaVersion,
        parseState: kfcVietnamPack.parseState,
      }),
    ).rejects.toThrow('kfc_pack_state_invalid');
    await expect(
      validatePackStateEnvelope(valid, {
        packRef: kfcVietnamPack.ref,
        schemaVersion: kfcVietnamPack.stateSchemaVersion,
        parseState: kfcVietnamPack.parseState,
      }),
    ).resolves.toEqual(valid.state);
    await expect(
      validatePackStateEnvelope(unknownShape, {
        packRef: kfcVietnamPack.ref,
        schemaVersion: kfcVietnamPack.stateSchemaVersion,
        parseState: kfcVietnamPack.parseState,
      }),
    ).rejects.toThrow('kfc_pack_state_invalid');
  });

  it('preserves the KFC prompt, tools, verified-state snapshot, and final presentation', async () => {
    const store = new MemoryStore();
    const input = {
      sessionId: 'session-kfc-pack',
      customerId: 'customer-1',
      channel: 'kfc' as const,
      text: 'Cho tôi xem thực đơn',
      clients: createMockClients(await loadGeneratedFixtures(process.cwd())),
      store,
      dashboard: new DashboardEventBus(),
      agentModelBinding: configuredTestAgent({} as BaseChatModel),
    };

    const output = await kfcVietnamPack.run(
      input,
      async ({ model, systemPrompt, messages, tools }) => {
        expect(model).toBe(input.agentModelBinding.model);
        expect(systemPrompt).toContain(KFC_AGENT_INSTRUCTIONS);
        expect(messages.at(-1)?.content).toBe(input.text);
        expect(tools.map((tool) => tool.name)).toContain('searchMenu');
        return 'Đây là thực đơn KFC.';
      },
    );

    expect(output.responseText).toBe('Đây là thực đơn KFC.');
    expect(output.presentation).toMatchObject({
      profile: 'genui',
      text: 'Đây là thực đơn KFC.',
    });
    expect(
      (await store.listTurns(input.sessionId)).map((turn) => turn.role),
    ).toEqual(['user', 'assistant']);
    expect(
      await store.getPackState(input.sessionId, kfcVietnamPack.ref),
    ).toBeDefined();
    expect(() =>
      kfcVietnamPack.parseState(buildVerifiedStateSnapshot(output.state)),
    ).not.toThrow();
  });

  it('keeps runAgentTurn as a compatibility facade over the in-process kernel', async () => {
    const store = new MemoryStore();
    const output = await runAgentTurn({
      sessionId: 'session-kfc-facade',
      customerId: 'customer-1',
      channel: 'messenger_mock',
      text: 'Xin chào',
      clients: createMockClients(await loadGeneratedFixtures(process.cwd())),
      store,
      dashboard: new DashboardEventBus(),
      agentModelBinding: configuredTestAgent(
        new FakeListChatModel({
          responses: ['Xin chào! Tôi có thể giúp gì cho bạn?'],
        }),
      ),
    });

    expect(output.responseText).toBe('Xin chào! Tôi có thể giúp gì cho bạn?');
    expect(output.presentation.profile).toBe('social');
    expect((await store.listTurns('session-kfc-facade')).at(-1)).toMatchObject({
      role: 'assistant',
      text: output.responseText,
    });
  });

  it('keeps route-owned run fences, transcript, pack state, and dashboard on one KFC durable session', async () => {
    const sessionId = 'messenger:route-customer';
    const store = new MemoryStore();
    const dashboard = new DashboardEventBus();
    const run = await store.createCustomerRun({
      id: 'customer-run-route-proof',
      schemaVersion: 1,
      sessionId,
      customerId: 'route-customer',
      clientMessageId: 'route-message-1',
      requestFingerprint: 'route-fingerprint',
      generation: 1,
      status: 'accepted',
      phase: 'queued',
      nextEventSequence: 1,
      clientSchemaVersion: 1,
      acceptedAt: '2026-07-24T00:00:00.000Z',
      startedAt: null,
      terminalAt: null,
      updatedAt: '2026-07-24T00:00:00.000Z',
    });
    const commitFence = {
      kind: 'customer_run' as const,
      runId: run.id,
      sessionAuthorityGeneration: run.sessionAuthorityGeneration,
    };

    const output = await runAgentTurn({
      sessionId,
      customerId: 'route-customer',
      channel: 'messenger_mock',
      text: 'Xin chào',
      clients: createMockClients(await loadGeneratedFixtures(process.cwd())),
      store,
      dashboard,
      agentModelBinding: configuredTestAgent(
        new FakeListChatModel({ responses: ['Xin chào!'] }),
      ),
      runGuard: {
        commitFence,
        isCurrent: () =>
          store.isRunCommitFenceCurrent({ sessionId, fence: commitFence }),
      },
    });

    expect(output.suppressed).not.toBe(true);
    expect((await store.listTurns(sessionId)).at(-1)).toMatchObject({
      role: 'assistant',
      text: 'Xin chào!',
    });
    expect(
      await store.getPackState(sessionId, kfcVietnamPack.ref),
    ).toBeDefined();
    expect(dashboard.getEvents(sessionId).length).toBeGreaterThan(0);
    expect(
      dashboard
        .getEvents(sessionId)
        .every((event) => event.sessionId === sessionId),
    ).toBe(true);
    expect(dashboard.getEvents(`pack:${sessionId}`)).toEqual([]);
  });

  it('supports multiple complete menu reads and one authoritative batched cart update in the same tool loop', async () => {
    const fixtures = await loadGeneratedFixtures(process.cwd());
    const baseClients = createMockClients(fixtures);
    const cartCalls: Array<{
      priorCartId: string;
      changes: Array<{ itemCode: string; quantity: number }>;
    }> = [];
    const clients = {
      ...baseClients,
      cart: {
        ...baseClients.cart,
        async applyChanges(
          cart: Parameters<typeof baseClients.cart.applyChanges>[0],
          changes: Parameters<typeof baseClients.cart.applyChanges>[1],
          context: Parameters<typeof baseClients.cart.applyChanges>[2],
        ) {
          cartCalls.push({
            priorCartId: cart.id,
            changes: changes.map(({ itemCode, quantity }) => ({
              itemCode,
              quantity,
            })),
          });
          return baseClients.cart.applyChanges(cart, changes, context);
        },
      },
    };
    const store = new MemoryStore();
    const input = {
      sessionId: 'session-kfc-tool-lifecycle',
      customerId: 'customer-1',
      channel: 'kfc' as const,
      text: '',
      trustedCustomerAction: {
        source: 'kfc_genui_action' as const,
        assistantTurnId: 'assistant-turn-batch',
        attachmentId: 'attachment-batch',
        actionDigest: '1'.repeat(64),
        verifiedRevision: '2'.repeat(64),
        lifecycle: 'one_shot' as const,
        command: {
          kind: 'cart_batch_update' as const,
          items: [
            { itemCode: '20751', quantity: 1 },
            { itemCode: '20752', quantity: 2 },
          ],
        },
      },
      clients,
      store,
      dashboard: new DashboardEventBus(),
      agentModelBinding: configuredTestAgent({} as BaseChatModel),
    };
    const output = await kfcVietnamPack.run(input, async ({ tools }) => {
      const invoke = async (
        name: string,
        args: Record<string, unknown>,
        id: string,
      ) => {
        const selected = tools.find((candidate) => candidate.name === name);
        if (!selected) throw new Error(`Missing tool ${name}`);
        return JSON.parse(
          toolOutputText(
            await selected.invoke({
              type: 'tool_call',
              name,
              args,
              id,
            }),
          ),
        ) as Record<string, unknown>;
      };

      const firstSearch = await invoke(
        'searchMenu',
        {
          mode: 'search',
          queries: ['20751', '20752'],
          category: null,
          minPriceVnd: null,
          maxPriceVnd: null,
          maxPriceExclusiveVnd: null,
          partySize: null,
          modifierQueries: [],
        },
        'search-1',
      );
      const secondSearch = await invoke(
        'searchMenu',
        {
          mode: 'search',
          queries: ['gà'],
          category: null,
          minPriceVnd: null,
          maxPriceVnd: null,
          maxPriceExclusiveVnd: null,
          partySize: null,
          modifierQueries: ['không cay'],
        },
        'search-2',
      );
      expect(
        tools.some((candidate) => candidate.name === 'updateCart'),
      ).toBe(false);

      expect(firstSearch.value).toMatchObject({
        returned: 2,
        total: 2,
        complete: true,
      });
      expect(secondSearch.value).toMatchObject({
        complete: true,
      });
      expect(
        (secondSearch.value as { returned: number }).returned,
      ).toBeGreaterThan(0);
      return 'Đã cập nhật giỏ hàng.';
    });

    expect(cartCalls).toEqual([
      {
        priorCartId: 'cart_session-kfc-tool-lifecycle',
        changes: [
          { itemCode: '20751', quantity: 1 },
          { itemCode: '20752', quantity: 2 },
        ],
      },
    ]);
    expect(output.state.cart?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ itemCode: '20751', quantity: 1 }),
        expect.objectContaining({ itemCode: '20752', quantity: 2 }),
      ]),
    );
    expect(
      Object.keys(output.state.verifiedCollections?.searchMenu ?? {}),
    ).toHaveLength(2);
    expect(() =>
      kfcVietnamPack.parseState(buildVerifiedStateSnapshot(output.state)),
    ).not.toThrow();
  });

  it('rejects a cart mutation bound to an exact advisory user turn', async () => {
    const fixtures = await loadGeneratedFixtures(process.cwd());
    const baseClients = createMockClients(fixtures);
    const applyChanges = vi.fn(baseClients.cart.applyChanges);
    const input = {
      sessionId: 'session-kfc-advisory-cart',
      customerId: 'customer-1',
      channel: 'kfc' as const,
      text: 'Bên bạn có làm được 200 combo không, tổng giá khoảng bao nhiêu?',
      clients: {
        ...baseClients,
        cart: {
          ...baseClients.cart,
          applyChanges,
        },
      },
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      agentModelBinding: configuredTestAgent({} as BaseChatModel),
    };

    await expect(
      kfcVietnamPack.run(input, async ({ systemPrompt, tools }) => {
        expect(systemPrompt).toContain(
          'câu hỏi về khả năng đáp ứng, giá, tồn kho hoặc tư vấn cũng không cấp quyền thay đổi giỏ',
        );
        expect(tools.some((candidate) => candidate.name === 'updateCart')).toBe(
          false,
        );
        return 'Mình sẽ kiểm tra khả năng đáp ứng và báo giá, chưa thay đổi giỏ.';
      }),
    ).resolves.toMatchObject({
      responseText:
        'Mình sẽ kiểm tra khả năng đáp ứng và báo giá, chưa thay đổi giỏ.',
    });

    expect(applyChanges).not.toHaveBeenCalled();
  });

  it('rejects plain-text cart mutation even when the current request is explicit', async () => {
    const fixtures = await loadGeneratedFixtures(process.cwd());
    const baseClients = createMockClients(fixtures);
    const applyChanges = vi.fn(baseClients.cart.applyChanges);
    const itemCode = fixtures.menuItems[0]!.code;
    const currentRequest = `Thêm 2 phần ${itemCode} vào giỏ giúp tôi`;
    const input = {
      sessionId: 'session-kfc-explicit-cart',
      customerId: 'customer-1',
      channel: 'kfc' as const,
      text: currentRequest,
      clients: {
        ...baseClients,
        cart: {
          ...baseClients.cart,
          applyChanges,
        },
      },
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      agentModelBinding: configuredTestAgent({} as BaseChatModel),
    };

    await kfcVietnamPack.run(input, async ({ tools }) => {
      expect(tools.some((candidate) => candidate.name === 'updateCart')).toBe(
        false,
      );
      return 'Mình đã chuẩn bị thay đổi để bạn xác nhận.';
    });

    expect(applyChanges).not.toHaveBeenCalled();
  });

  it('derives an authorized GenUI cart change from the typed command', async () => {
    const fixtures = await loadGeneratedFixtures(process.cwd());
    const baseClients = createMockClients(fixtures);
    const applyChanges = vi.fn(baseClients.cart.applyChanges);
    const itemCode = fixtures.menuItems[0]!.code;
    const input = {
      sessionId: 'session-kfc-trusted-cart',
      customerId: 'customer-1',
      channel: 'kfc' as const,
      text: '',
      trustedCustomerAction: {
        source: 'kfc_genui_action' as const,
        assistantTurnId: 'assistant-turn-1',
        attachmentId: 'attachment-1',
        actionDigest: 'a'.repeat(64),
        verifiedRevision: 'b'.repeat(64),
        lifecycle: 'one_shot' as const,
        command: {
          kind: 'cart_update' as const,
          itemCode,
          quantity: 1,
        },
      },
      clients: {
        ...baseClients,
        cart: {
          ...baseClients.cart,
          applyChanges,
        },
      },
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      agentModelBinding: configuredTestAgent({} as BaseChatModel),
    };

    await kfcVietnamPack.run(input, async ({ tools }) => {
      expect(
        tools.some((candidate) => candidate.name === 'updateCart'),
      ).toBe(false);
      return 'Đã cập nhật giỏ.';
    });

    expect(applyChanges).toHaveBeenCalledOnce();
    expect(applyChanges.mock.calls[0]?.[1]).toEqual([
      { itemCode, quantity: 1 },
    ]);
  });

  it('commits one multi-group modifier draft with one updateCart mutation', async () => {
    const fixtures = await loadGeneratedFixtures(process.cwd());
    const menuModifier = fixtures.menuModifiers.find(
      (candidate) =>
        candidate.modifierGroups.length >= 2 &&
        candidate.modifierGroups[0]?.options[0]?.modifierGroups.length,
    );
    if (!menuModifier) throw new Error('Expected nested modifier fixture');
    const baseClients = createMockClients(fixtures);
    const sessionId = 'session-kfc-atomic-modifier';
    const context = {
      signal: new AbortController().signal,
      deadlineAt: Date.now() + 60_000,
    };
    const created = await baseClients.cart.createCart(sessionId, context);
    if (!created.ok || !created.value) throw new Error('Expected test cart');
    const seeded = await baseClients.cart.applyChanges(
      created.value,
      [{ itemCode: menuModifier.itemCode, quantity: 1 }],
      context,
    );
    if (!seeded.ok || !seeded.value) throw new Error('Expected seeded cart');
    const store = new MemoryStore();
    await store.putPackState(
      sessionId,
      await createPackStateEnvelope({
        packRef: kfcVietnamPack.ref,
        schemaVersion: kfcVietnamPack.stateSchemaVersion,
        state: {
          cart: seeded.value,
          menuModifierOptions: menuModifier,
        },
      }),
    );
    const firstGroup = menuModifier.modifierGroups[0]!;
    const firstOption = firstGroup.options[0]!;
    const nestedGroup = firstOption.modifierGroups[0]!;
    const secondGroup = menuModifier.modifierGroups[1]!;
    const selections = [
      {
        groupId: firstGroup.groupId,
        modifierId: firstOption.modifierId,
      },
      {
        groupId: nestedGroup.groupId,
        modifierId: nestedGroup.options[0]!.modifierId,
      },
      {
        groupId: secondGroup.groupId,
        modifierId: secondGroup.options[0]!.modifierId,
      },
    ];
    const applyChanges = vi.fn(baseClients.cart.applyChanges);
    const input = {
      sessionId,
      customerId: 'customer-1',
      channel: 'kfc' as const,
      text: '',
      trustedCustomerAction: {
        source: 'kfc_genui_action' as const,
        assistantTurnId: 'assistant-turn-atomic-modifier',
        attachmentId: 'attachment-atomic-modifier',
        actionDigest: '1'.repeat(64),
        verifiedRevision: '2'.repeat(64),
        lifecycle: 'one_shot' as const,
        command: {
          kind: 'modifier_batch_selection' as const,
          itemCode: menuModifier.itemCode,
          selections,
        },
      },
      clients: {
        ...baseClients,
        cart: {
          ...baseClients.cart,
          applyChanges,
        },
      },
      store,
      dashboard: new DashboardEventBus(),
      agentModelBinding: configuredTestAgent({} as BaseChatModel),
    };

    await kfcVietnamPack.run(input, async ({ tools }) => {
      expect(
        tools.some((candidate) => candidate.name === 'updateCart'),
      ).toBe(false);
      return 'Đã áp dụng tùy chọn.';
    });

    expect(applyChanges).toHaveBeenCalledOnce();
    expect(applyChanges.mock.calls[0]?.[1]).toEqual([
      {
        itemCode: menuModifier.itemCode,
        quantity: 1,
        modifiers: selections,
      },
    ]);
  });

  it('keeps the executor fail closed when a visible cart action cannot bind to current state', async () => {
    const fixtures = await loadGeneratedFixtures(process.cwd());
    const baseClients = createMockClients(fixtures);
    const applyChanges = vi.fn(baseClients.cart.applyChanges);
    const input = {
      sessionId: 'session-kfc-unbound-modifier',
      customerId: 'customer-1',
      channel: 'kfc' as const,
      text: '',
      trustedCustomerAction: {
        source: 'kfc_genui_action' as const,
        assistantTurnId: 'assistant-turn-unbound',
        attachmentId: 'attachment-unbound',
        actionDigest: 'e'.repeat(64),
        verifiedRevision: 'f'.repeat(64),
        lifecycle: 'one_shot' as const,
        command: {
          kind: 'modifier_selection' as const,
          itemCode: fixtures.menuItems[0]!.code,
          groupId: 'group-not-in-cart',
          modifierId: 'modifier-not-in-cart',
        },
      },
      clients: {
        ...baseClients,
        cart: {
          ...baseClients.cart,
          applyChanges,
        },
      },
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      agentModelBinding: configuredTestAgent({} as BaseChatModel),
    };

    const output = await kfcVietnamPack.run(input, async ({ tools }) => {
      expect(
        tools.some((candidate) => candidate.name === 'updateCart'),
      ).toBe(false);
      return 'Không thể áp dụng lựa chọn này vào giỏ hiện tại.';
    });

    expect(applyChanges).not.toHaveBeenCalled();
    expect(output.state.toolTrace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ toolName: 'updateCart', ok: false }),
      ]),
    );
  });

  it('rejects a cart write under a trusted non-cart action', async () => {
    const fixtures = await loadGeneratedFixtures(process.cwd());
    const baseClients = createMockClients(fixtures);
    const applyChanges = vi.fn(baseClients.cart.applyChanges);
    const input = {
      sessionId: 'session-kfc-non-cart-action',
      customerId: 'customer-1',
      channel: 'kfc' as const,
      text: '',
      trustedCustomerAction: {
        source: 'kfc_genui_action' as const,
        assistantTurnId: 'assistant-turn-2',
        attachmentId: 'attachment-2',
        actionDigest: 'c'.repeat(64),
        verifiedRevision: 'd'.repeat(64),
        lifecycle: 'one_shot' as const,
        command: { kind: 'edit_cart' as const },
      },
      clients: {
        ...baseClients,
        cart: {
          ...baseClients.cart,
          applyChanges,
        },
      },
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      agentModelBinding: configuredTestAgent({} as BaseChatModel),
    };

    await kfcVietnamPack.run(input, async ({ tools }) => {
      expect(tools.some((candidate) => candidate.name === 'updateCart')).toBe(
        false,
      );
      return 'Bạn muốn sửa giỏ thế nào?';
    });

    expect(applyChanges).not.toHaveBeenCalled();
  });

  it('preserves an upstream incomplete menu collection in KFC verified state', async () => {
    const fixtures = await loadGeneratedFixtures(process.cwd());
    const baseClients = createMockClients(fixtures);
    const context = {
      signal: new AbortController().signal,
      deadlineAt: Date.now() + 60_000,
    };
    const upstream = await baseClients.menu.searchMenu('', context);
    if (!upstream.ok || !upstream.value) {
      throw new Error('Expected fixture menu');
    }
    const partialCollection = {
      items: upstream.value.items.slice(0, 2),
      total: upstream.value.total,
      returned: 2,
      complete: false,
      scope: { scope: 'all' as const },
      cursor: 'menu-page-2',
    };
    const clients = {
      ...baseClients,
      menu: {
        ...baseClients.menu,
        async searchMenu() {
          return {
            ok: true as const,
            value: partialCollection,
            message: 'partial_menu',
          };
        },
      },
    };

    const output = await kfcVietnamPack.run(
      {
        sessionId: 'session-kfc-partial-menu',
        customerId: 'customer-1',
        channel: 'kfc',
        text: 'Cho tôi xem thực đơn',
        clients,
        store: new MemoryStore(),
        dashboard: new DashboardEventBus(),
        agentModelBinding: configuredTestAgent({} as BaseChatModel),
      },
      async ({ tools }) => {
        const search = tools.find(
          (candidate) => candidate.name === 'searchMenu',
        );
        if (!search) throw new Error('Missing searchMenu');
        const result = JSON.parse(
          toolOutputText(
            await search.invoke({
              type: 'tool_call',
              name: 'searchMenu',
              args: {
                mode: 'full',
                queries: [],
                category: null,
                minPriceVnd: null,
                maxPriceVnd: null,
                maxPriceExclusiveVnd: null,
                partySize: null,
                modifierQueries: [],
              },
              id: 'partial-search',
            }),
          ),
        ) as {
          value: {
            total: number;
            returned: number;
            complete: boolean;
            cursor?: string;
          };
        };
        expect(result.value).toMatchObject({
          total: partialCollection.total,
          returned: 2,
          complete: false,
          cursor: 'menu-page-2',
        });
        return 'Đây là phần dữ liệu thực đơn hiện có.';
      },
    );

    expect(output.state.activeMenuCollection?.result).toMatchObject({
      total: partialCollection.total,
      returned: 2,
      complete: false,
      cursor: 'menu-page-2',
    });
    expect(() =>
      kfcVietnamPack.parseState(buildVerifiedStateSnapshot(output.state)),
    ).not.toThrow();
  });

  it('preserves the KFC empty-model-response error contract', async () => {
    await expect(
      runAgentTurn({
        sessionId: 'session-kfc-empty-response',
        customerId: 'customer-1',
        channel: 'messenger_mock',
        text: 'Xin chào',
        clients: createMockClients(await loadGeneratedFixtures(process.cwd())),
        store: new MemoryStore(),
        dashboard: new DashboardEventBus(),
        agentModelBinding: configuredTestAgent(
          new FakeListChatModel({ responses: ['   '] }),
        ),
      }),
    ).rejects.toThrow('kfc_agent_model_response_empty');
  });
});
