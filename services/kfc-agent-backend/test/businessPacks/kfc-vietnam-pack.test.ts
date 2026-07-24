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
      agentModel: {} as BaseChatModel,
      agentModelIdentity: {
        candidateId: 'openai-gpt-4.1-mini',
        provider: 'openai',
        model: 'gpt-4.1-mini',
        profile: 'openai:gpt-4.1-mini:responses',
        transport: 'openai_responses',
      } as const,
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
        agentModel: new FakeListChatModel({
          responses: ['Xin chào! Tôi có thể giúp gì cho bạn?'],
        }),
        tracer,
        deferTrace(task) {
          deferred.push(task);
        },
      });

      expect(output.responseText).toBe('Xin chào! Tôi có thể giúp gì cho bạn?');
      expect(deferred).toHaveLength(1);
      await expect(deferred[0]!()).resolves.toBeUndefined();
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
      agentModel: {} as BaseChatModel,
    };

    const output = await kfcVietnamPack.run(
      input,
      async ({ model, systemPrompt, messages, tools }) => {
        expect(model).toBe(input.agentModel);
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
      agentModel: new FakeListChatModel({
        responses: ['Xin chào! Tôi có thể giúp gì cho bạn?'],
      }),
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
      agentModel: new FakeListChatModel({ responses: ['Xin chào!'] }),
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
      agentModel: {} as BaseChatModel,
    };
    let authoritativeCart: unknown;

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
          maxPriceVnd: null,
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
          maxPriceVnd: null,
          partySize: null,
          modifierQueries: ['không cay'],
        },
        'search-2',
      );
      const cartResult = await invoke(
        'updateCart',
        {},
        'cart-1',
      );
      authoritativeCart = cartResult.value as
        Record<string, unknown> | undefined;

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
    expect(output.state.cart).toEqual(authoritativeCart);
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
      agentModel: {} as BaseChatModel,
    };

    await expect(
      kfcVietnamPack.run(input, async ({ systemPrompt, tools }) => {
        expect(systemPrompt).toContain(
          'câu hỏi về khả năng đáp ứng, giá, tồn kho hoặc tư vấn cũng không cấp quyền thay đổi giỏ',
        );
        const selected = tools.find(
          (candidate) => candidate.name === 'updateCart',
        );
        if (!selected) throw new Error('Missing updateCart');
        const result = JSON.parse(
          toolOutputText(
            await selected.invoke({
              type: 'tool_call',
              name: 'updateCart',
              args: {},
              id: 'advisory-cart-1',
            }),
          ),
        ) as { ok: boolean; errorCode?: string };
        expect(result).toMatchObject({
          ok: false,
          errorCode: 'explicit_cart_mutation_required',
        });
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
      agentModel: {} as BaseChatModel,
    };

    await kfcVietnamPack.run(input, async ({ tools }) => {
      const selected = tools.find(
        (candidate) => candidate.name === 'updateCart',
      );
      if (!selected) throw new Error('Missing updateCart');
      const result = JSON.parse(
        toolOutputText(
          await selected.invoke({
            type: 'tool_call',
            name: 'updateCart',
            args: {},
            id: 'explicit-cart-1',
          }),
        ),
      ) as { ok: boolean; errorCode?: string };
      expect(result).toMatchObject({
        ok: false,
        errorCode: 'explicit_cart_mutation_required',
      });
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
      agentModel: {} as BaseChatModel,
    };

    await kfcVietnamPack.run(input, async ({ tools }) => {
      const selected = tools.find(
        (candidate) => candidate.name === 'updateCart',
      );
      if (!selected) throw new Error('Missing updateCart');
      await expect(
        selected.invoke({
          type: 'tool_call',
          name: 'updateCart',
          args: {
            changes: [{ itemCode, quantity: 5, modifiers: [] }],
          },
          id: 'trusted-cart-widened',
        }),
      ).rejects.toThrow('Received tool input did not match expected schema');
      const result = JSON.parse(
        toolOutputText(
          await selected.invoke({
            type: 'tool_call',
            name: 'updateCart',
            args: {},
            id: 'trusted-cart-1',
          }),
        ),
      ) as { ok: boolean };
      expect(result.ok).toBe(true);
      return 'Đã cập nhật giỏ.';
    });

    expect(applyChanges).toHaveBeenCalledOnce();
    expect(applyChanges.mock.calls[0]?.[1]).toEqual([
      { itemCode, quantity: 1 },
    ]);
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
      agentModel: {} as BaseChatModel,
    };

    await kfcVietnamPack.run(input, async ({ tools }) => {
      const selected = tools.find(
        (candidate) => candidate.name === 'updateCart',
      );
      if (!selected) throw new Error('Missing updateCart');
      const result = JSON.parse(
        toolOutputText(
          await selected.invoke({
            type: 'tool_call',
            name: 'updateCart',
            args: {},
            id: 'non-cart-action-1',
          }),
        ),
      ) as { ok: boolean; errorCode?: string };
      expect(result).toMatchObject({
        ok: false,
        errorCode: 'explicit_cart_mutation_required',
      });
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
        agentModel: {} as BaseChatModel,
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
                maxPriceVnd: null,
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
        agentModel: new FakeListChatModel({ responses: ['   '] }),
      }),
    ).rejects.toThrow('kfc_agent_model_response_empty');
  });
});
