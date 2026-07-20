import {
  isToolMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import {
  END,
  MemorySaver,
  START,
  StateGraph,
} from '@langchain/langgraph';
import { describe, expect, it, vi } from 'vitest';
import {
  issueModelPublicationAuthority,
} from '../../src/agent/modelPublicationAuthority.js';
import {
  buildModelPublicationBundle,
} from '../../src/agent/modelPublicationProjection.js';
import {
  publicationToolTracePrefixDigest,
} from '../../src/agent/agentPublicationRuntime.js';
import {
  KfcAgentState,
  type KfcAgentStateValue,
} from '../../src/agent/agentStateSchema.js';
import {
  executeAgentToolNode,
} from '../../src/agent/agentToolExecutionNode.js';
import {
  runtimeContextSchema,
  type PendingToolCall,
  type SingleAgentRuntimeContext,
} from '../../src/agent/singleAgentRuntime.js';
import type {
  ExternalCallContext,
  ExternalClients,
} from '../../src/clients/interfaces.js';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import type {
  ConversationTurn,
  CustomerAccessScope,
  Order,
  ToolResult,
} from '../../src/domain/types.js';
import type { AgentTurnInput } from '../../src/graph/agentTurnState.js';
import type { AgentGraphState } from '../../src/graph/state.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import {
  createNoopAgentTracer,
  type AgentTraceSpan,
  type AgentTraceSpanInput,
} from '../../src/observability/agentTracing.js';
import type { ToolName } from '../../src/ordering/types.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import {
  controlledCustomerAccess,
} from '../fixtures/controlledCustomerAccess.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';

interface Deferred<Value> {
  promise: Promise<Value>;
  resolve(value: Value): void;
  reject(reason: unknown): void;
}

interface TraceEvent {
  phase: 'start' | 'end' | 'fail';
  name: string;
  payload: Record<string, unknown>;
}

class CaptureSpan implements AgentTraceSpan {
  constructor(
    private readonly name: string,
    private readonly events: TraceEvent[],
  ) {}

  async startSpan(input: AgentTraceSpanInput): Promise<AgentTraceSpan> {
    this.events.push({
      phase: 'start',
      name: input.name,
      payload: input.inputs,
    });
    return new CaptureSpan(input.name, this.events);
  }

  async end(outputs: Record<string, unknown> = {}): Promise<void> {
    this.events.push({
      phase: 'end',
      name: this.name,
      payload: outputs,
    });
  }

  async fail(error: unknown): Promise<void> {
    this.events.push({
      phase: 'fail',
      name: this.name,
      payload: {
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function success<Value>(
  value: Value,
  message: string,
): ToolResult<Value> {
  return { ok: true, value, message, provenance: [] };
}

function currentUserTurn(input: {
  sessionId: string;
  text: string;
}): ConversationTurn {
  return {
    id: `${input.sessionId}-turn`,
    sessionId: input.sessionId,
    channel: 'kfc',
    role: 'user',
    text: input.text,
    externalMessageId: `${input.sessionId}-message`,
    externalUserId: `${input.sessionId}-user`,
    deliveryStatus: 'received',
    metadata: null,
    createdAt: '2026-07-20T00:00:00.000Z',
  };
}

function domainState(input: {
  sessionId: string;
  customerId: string;
  text: string;
  turn: ConversationTurn;
}): AgentGraphState {
  return {
    sessionId: input.sessionId,
    customerId: input.customerId,
    channel: 'kfc',
    latestUserMessage: input.text,
    recentTurns: [input.turn],
    userConfirmedOrder: false,
    escalationReasons: [],
    retrievedEvidence: [],
    toolTrace: [],
  };
}

function recentOrder(): Order {
  return {
    id: 'PRIVATE-ORDER-908',
    cart: {
      id: 'PRIVATE-CART-908',
      items: [],
      subtotalVnd: 0,
      discountVnd: 0,
      deliveryFeeVnd: 0,
      totalVnd: 0,
      voucherCode: null,
    },
    status: 'created',
    paymentStatus: 'pending',
    assignedStoreId: 'KFCVN0318',
    createdAt: '2026-07-20T00:00:00.000Z',
  };
}

function privateReadCalls(): PendingToolCall[] {
  return [
    {
      id: 'private-address-call',
      toolName: 'getSavedAddresses',
      arguments: {},
    },
    {
      id: 'private-order-call',
      toolName: 'getRecentOrder',
      arguments: {},
    },
    {
      id: 'private-favorite-call',
      toolName: 'getFavoriteItems',
      arguments: {},
    },
  ];
}

function publicReadCalls(): PendingToolCall[] {
  return [
    {
      id: 'public-menu-call',
      toolName: 'searchMenu',
      arguments: { scope: 'all', query: null },
    },
    {
      id: 'public-promotion-call',
      toolName: 'searchPromotions',
      arguments: { scope: 'all', query: null },
    },
  ];
}

interface Harness {
  checkpointConfig: {
    configurable: { thread_id: string };
  };
  checkpointer: MemorySaver;
  controller: AbortController;
  durable: AgentGraphState;
  run(): Promise<KfcAgentStateValue>;
  runtime: SingleAgentRuntimeContext;
  store: MemoryStore;
}

class RaceableRunCommitStore extends MemoryStore {
  beforeConditionalCommit?: () => Promise<void>;

  override async appendEventIfRunCurrent(
    input: Parameters<MemoryStore['appendEventIfRunCurrent']>[0],
  ): ReturnType<MemoryStore['appendEventIfRunCurrent']> {
    const hook = this.beforeConditionalCommit;
    this.beforeConditionalCommit = undefined;
    await hook?.();
    return super.appendEventIfRunCurrent(input);
  }
}

async function createHarness(input: {
  calls: PendingToolCall[];
  clients: ExternalClients;
  scopes?: CustomerAccessScope[];
  observeRun?: AgentTurnInput['observeRun'];
  runGuard?: AgentTurnInput['runGuard'];
  deadlineAt?: number;
  store?: MemoryStore;
  activeCustomerRunId?: string;
  turnTrace?: AgentTraceSpan;
}): Promise<Harness> {
  const sessionId = `parallel-node-${crypto.randomUUID()}`;
  const customerId = 'parallel-node-customer';
  const text = 'Read the requested verified provider data';
  const turn = currentUserTurn({ sessionId, text });
  const durable = domainState({
    sessionId,
    customerId,
    text,
    turn,
  });
  const accessContext = controlledCustomerAccess({
    sessionId,
    customerId,
  });
  accessContext.authorizedScopes = input.scopes ?? [
    'customer:read',
    'order:read',
  ];
  const authority = await issueModelPublicationAuthority({
    state: durable,
    currentUserTurn: turn,
    accessContext,
  });
  const bundle = await buildModelPublicationBundle({
    state: durable,
    authority,
  });
  const store = input.store ?? new MemoryStore();
  if (input.activeCustomerRunId) {
    await store.createCustomerRun({
      id: input.activeCustomerRunId,
      schemaVersion: 1,
      sessionId,
      customerId,
      clientMessageId: `${sessionId}-customer-run-message`,
      requestFingerprint: `${sessionId}-customer-run-fingerprint`,
      generation: 1,
      status: 'running',
      phase: 'read_only_tool',
      nextEventSequence: 1,
      clientSchemaVersion: 1,
      acceptedAt: '2026-07-20T00:00:00.000Z',
      startedAt: '2026-07-20T00:00:00.000Z',
      terminalAt: null,
      updatedAt: '2026-07-20T00:00:00.000Z',
    });
  }
  const controller = new AbortController();
  const externalCallContext: ExternalCallContext = {
    signal: controller.signal,
    deadlineAt: input.deadlineAt ?? Date.now() + 30_000,
  };
  const turnTrace =
    input.turnTrace ??
    await createNoopAgentTracer().startTurn({
      name: 'parallel_read_execution_node_test',
      inputs: {},
    });
  const turnInput: AgentTurnInput = {
    sessionId,
    customerId,
    channel: 'kfc',
    text,
    externalMessageId: turn.externalMessageId,
    accessContext,
    clients: input.clients,
    store,
    dashboard: new DashboardEventBus(),
    observeRun: input.observeRun,
    runGuard: input.runGuard,
  };
  const runtime: SingleAgentRuntimeContext = {
    turnInput,
    turnTrace,
    externalCallContext,
    abortExternalCalls: (reason) => controller.abort(reason),
    disposeExternalCalls: () => undefined,
    state: durable,
  };
  const graphInput = {
    messages: [] as BaseMessage[],
    graphTrace: null,
    sessionId,
    customerId,
    channel: 'kfc' as const,
    text,
    externalMessageId: turn.externalMessageId,
    metadata: null,
    domainState: durable,
    currentTurnToolTrace: [],
    currentUserTurn: turn,
    currentTurnId: turn.id,
    turnToolTraceStartIndex: 0,
    turnToolTracePrefixDigest:
      await publicationToolTracePrefixDigest([]),
    modelPublicationAuthority: authority,
    modelPublicationBundle: bundle,
    graphExecutedToolResults: [],
    currentTurnResponseEvidence: [],
    toolEvidenceReceipts: [],
    customerTurnCount: 1,
    turnDeadlineAt: externalCallContext.deadlineAt,
    structuredAction: null,
    structuredActionRevisionValidated: false,
    structuredActionAfterTool: null,
    structuredActionOutcome: null,
    selectedActionResponseAuthority: null,
    selectedActionResponseReference: null,
    providerAttempts: 0,
    providerAttemptEvidence: [],
    providerRetries: 0,
    semanticCorrections: 0,
    advertisedToolNames: input.calls.map(({ toolName }) => toolName),
    ordinaryToolBindingPhase: 'initial',
    closedInitialIndependentToolNames: [],
    consumedToolNames: [],
    pendingToolCalls: input.calls,
    queuedToolCalls: [],
    providerFailure: null,
    validationError: null,
    correctionMessagesNeeded: false,
    approvalDecision: null,
    validatedApprovalActionDigest: null,
    checkpointSafeApproval: null,
    responseText: null,
    responseFactualClaims: null,
    responsePublicationAttestation: null,
    responsePublicationValidated: false,
    output: null,
    failure: null,
  } satisfies KfcAgentStateValue;
  const checkpointer = new MemorySaver();
  const graph = new StateGraph(KfcAgentState, {
    context: runtimeContextSchema,
  })
    .addNode(
      'execute_tools',
      (state, graphRuntime) => executeAgentToolNode({
        state,
        graphRuntime,
        resolveRuntime: async () => runtime,
      }),
    )
    .addEdge(START, 'execute_tools')
    .addEdge('execute_tools', END)
    .compile({ checkpointer });
  const checkpointConfig = {
    configurable: {
      thread_id: `${sessionId}:parallel-read-node`,
    },
  };

  return {
    checkpointConfig,
    checkpointer,
    controller,
    durable,
    run: async () => graph.invoke(graphInput, {
      ...checkpointConfig,
      context: { runtime },
    }),
    runtime,
    store,
  };
}

function toolNames(entries: readonly { toolName: ToolName }[]): ToolName[] {
  return entries.map(({ toolName }) => toolName);
}

async function verifiedStateEvents(store: MemoryStore, sessionId: string) {
  return (await store.listEvents(sessionId)).filter(
    ({ sourceType }) => sourceType === 'graph:verified_state',
  );
}

describe('production agent parallel-read execution node', () => {
  it('overlaps the whole eligible batch, then projects and checkpoints safe receipts in call order', async () => {
    const savedAddresses = deferred<ToolResult<Array<{
      label: string;
      line1: string;
      district: string;
      city: string;
    }>>>();
    const recent = deferred<ToolResult<Order | null>>();
    const favorite = deferred<ToolResult<
      Array<(ReturnType<typeof createTestFixtures>)['menuItems'][number]>
    >>();
    const completions: string[] = [];
    const favoriteItem = {
      ...createTestFixtures().menuItems[0]!,
      name: 'PRIVATE FAVORITE ITEM',
    };
    const savedAddressesProvider = vi.fn(() =>
      savedAddresses.promise.then((result) => {
        completions.push('getSavedAddresses');
        return result;
      }));
    const recentOrderProvider = vi.fn(() =>
      recent.promise.then((result) => {
        completions.push('getRecentOrder');
        return result;
      }));
    const favoriteItemsProvider = vi.fn(() =>
      favorite.promise.then((result) => {
        completions.push('getFavoriteItems');
        return result;
      }));
    const clients = createMockClients(createTestFixtures(), {
      savedAddressesProvider,
      recentOrderProvider,
      favoriteItemsProvider,
    });
    const harness = await createHarness({
      calls: privateReadCalls(),
      clients,
    });
    const pending = harness.run();
    let settled = false;
    void pending.finally(() => {
      settled = true;
    });

    await vi.waitFor(() => {
      expect(savedAddressesProvider).toHaveBeenCalledOnce();
      expect(recentOrderProvider).toHaveBeenCalledOnce();
      expect(favoriteItemsProvider).toHaveBeenCalledOnce();
    });
    expect(settled).toBe(false);

    favorite.resolve(success(
      [favoriteItem],
      'PRIVATE favorite provider prose',
    ));
    recent.resolve(success(
      recentOrder(),
      'PRIVATE order provider prose',
    ));
    await Promise.resolve();
    expect(settled).toBe(false);
    savedAddresses.resolve(success([{
      label: 'Private home',
      line1: 'PRIVATE SAVED ADDRESS 77',
      district: 'District 1',
      city: 'Ho Chi Minh City',
    }], 'PRIVATE address provider prose'));

    const result = await pending;
    expect(completions).toEqual([
      'getFavoriteItems',
      'getRecentOrder',
      'getSavedAddresses',
    ]);
    expect(toolNames(result.currentTurnToolTrace)).toEqual([
      'getSavedAddresses',
      'getRecentOrder',
      'getFavoriteItems',
    ]);
    expect(toolNames(result.currentTurnResponseEvidence)).toEqual([
      'getSavedAddresses',
      'getRecentOrder',
      'getFavoriteItems',
    ]);
    expect(toolNames(result.toolEvidenceReceipts)).toEqual([
      'getSavedAddresses',
      'getRecentOrder',
      'getFavoriteItems',
    ]);

    const toolMessages = result.messages.filter(isToolMessage);
    expect(toolMessages.map(({ name }) => name)).toEqual([
      'getSavedAddresses',
      'getRecentOrder',
      'getFavoriteItems',
    ]);
    expect(toolMessages.map(({ content }) =>
      JSON.parse(String(content)))).toEqual(result.toolEvidenceReceipts);
    expect(JSON.stringify(result.currentTurnResponseEvidence)).toContain(
      'PRIVATE SAVED ADDRESS 77',
    );
    expect(JSON.stringify(result.currentTurnResponseEvidence)).toContain(
      'PRIVATE-ORDER-908',
    );
    expect(JSON.stringify(toolMessages)).not.toContain(
      'PRIVATE SAVED ADDRESS 77',
    );
    expect(JSON.stringify(toolMessages)).not.toContain('PRIVATE-ORDER-908');

    const checkpoint = await harness.checkpointer.getTuple(
      harness.checkpointConfig,
    );
    const checkpointValues = checkpoint?.checkpoint.channel_values;
    expect(checkpointValues?.domainState).toBeUndefined();
    expect(checkpointValues?.currentTurnResponseEvidence).toBeUndefined();
    expect(JSON.stringify(checkpointValues)).not.toContain(
      'PRIVATE SAVED ADDRESS 77',
    );
    expect(JSON.stringify(checkpointValues)).not.toContain(
      'PRIVATE-ORDER-908',
    );
    expect(await verifiedStateEvents(
      harness.store,
      harness.runtime.turnInput.sessionId,
    )).toHaveLength(1);
  });

  it('waits for a successful sibling and retains one typed failure as ordered evidence', async () => {
    const savedAddresses = deferred<ToolResult<Array<{
      label: string;
      line1: string;
      district: string;
      city: string;
    }>>>();
    const recentFailure = vi.fn(async () => ({
      ok: false as const,
      errorCode: 'provider_read_failed',
      message: 'PRIVATE provider failure prose',
      provenance: [],
    }));
    const savedAddressesProvider = vi.fn(() => savedAddresses.promise);
    const clients = createMockClients(createTestFixtures(), {
      savedAddressesProvider,
      recentOrderProvider: recentFailure,
    });
    const harness = await createHarness({
      calls: privateReadCalls().slice(0, 2),
      clients,
    });
    const pending = harness.run();
    let settled = false;
    void pending.finally(() => {
      settled = true;
    });

    await vi.waitFor(() => {
      expect(savedAddressesProvider).toHaveBeenCalledOnce();
      expect(recentFailure).toHaveBeenCalledOnce();
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    savedAddresses.resolve(success([{
      label: 'Private home',
      line1: 'PRIVATE SAVED ADDRESS 88',
      district: 'District 1',
      city: 'Ho Chi Minh City',
    }], 'PRIVATE address provider prose'));

    const result = await pending;
    expect(result.validationError).toBe('tool_execution_failed');
    expect(toolNames(result.currentTurnResponseEvidence)).toEqual([
      'getSavedAddresses',
      'getRecentOrder',
    ]);
    expect(result.currentTurnResponseEvidence[1]?.value).toEqual({
      ok: false,
      errorCode: 'customer_context_provider_failed',
    });
    expect(toolNames(result.toolEvidenceReceipts)).toEqual([
      'getSavedAddresses',
      'getRecentOrder',
    ]);
    const toolMessages = result.messages.filter(isToolMessage);
    expect(toolMessages.map(({ name, status }) => ({ name, status }))).toEqual([
      { name: 'getSavedAddresses', status: 'success' },
      { name: 'getRecentOrder', status: 'error' },
    ]);
    expect(toolMessages.map(({ content }) =>
      JSON.parse(String(content)))).toEqual(result.toolEvidenceReceipts);
    expect(JSON.stringify(toolMessages)).not.toContain(
      'PRIVATE SAVED ADDRESS 88',
    );
    expect(JSON.stringify(toolMessages)).not.toContain(
      'PRIVATE provider failure prose',
    );
  });

  it('settles every started sibling after one throws and performs zero projection or persistence', async () => {
    const clients = createMockClients(createTestFixtures());
    const promotionGate = deferred<void>();
    const originalPromotion =
      clients.promotion.searchPromotions.bind(clients.promotion);
    const searchMenu = vi.spyOn(clients.menu, 'searchMenu')
      .mockRejectedValue(new Error('provider exploded'));
    const searchPromotions = vi.spyOn(
      clients.promotion,
      'searchPromotions',
    ).mockImplementation(async (query, context) => {
      await promotionGate.promise;
      return originalPromotion(query, context);
    });
    const harness = await createHarness({
      calls: publicReadCalls(),
      clients,
      scopes: [],
    });
    const pending = harness.run();
    let settled = false;
    void pending.finally(() => {
      settled = true;
    });

    await vi.waitFor(() => {
      expect(searchMenu).toHaveBeenCalledOnce();
      expect(searchPromotions).toHaveBeenCalledOnce();
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(harness.durable.toolTrace).toEqual([]);
    expect(await verifiedStateEvents(
      harness.store,
      harness.runtime.turnInput.sessionId,
    )).toEqual([]);

    promotionGate.resolve();
    const result = await pending;
    expect(result.failure).toBe('agent_tool_execution_failed');
    expect(result.currentTurnToolTrace).toEqual([]);
    expect(result.currentTurnResponseEvidence).toEqual([]);
    expect(result.toolEvidenceReceipts).toEqual([]);
    expect(result.messages).toEqual([]);
    expect(harness.durable.toolTrace).toEqual([]);
    expect(await verifiedStateEvents(
      harness.store,
      harness.runtime.turnInput.sessionId,
    )).toEqual([]);
  });

  it.each([
    [
      'supersession cancellation',
      new DOMException('Superseded', 'AbortError'),
      'customer_run_cancelled',
    ],
    [
      'deadline cancellation',
      new DOMException('Deadline exceeded', 'TimeoutError'),
      'agent_turn_deadline_exceeded',
    ],
  ] as const)(
    '%s dispatches the whole batch but performs zero projection or persistence',
    async (_label, reason, expectedFailure) => {
      const clients = createMockClients(createTestFixtures());
      const providerGate = deferred<void>();
      const originalMenu = clients.menu.searchMenu.bind(clients.menu);
      const originalPromotion =
        clients.promotion.searchPromotions.bind(clients.promotion);
      const searchMenu = vi.spyOn(clients.menu, 'searchMenu')
        .mockImplementation(async (query, context) => {
          await providerGate.promise;
          return originalMenu(query, context);
        });
      const searchPromotions = vi.spyOn(
        clients.promotion,
        'searchPromotions',
      ).mockImplementation(async (query, context) => {
        await providerGate.promise;
        return originalPromotion(query, context);
      });
      const harness = await createHarness({
        calls: publicReadCalls(),
        clients,
        scopes: [],
      });
      const pending = harness.run();

      await vi.waitFor(() => {
        expect(searchMenu).toHaveBeenCalledOnce();
        expect(searchPromotions).toHaveBeenCalledOnce();
      });
      harness.controller.abort(reason);

      const result = await pending;
      expect(result.failure).toBe(expectedFailure);
      expect(result.currentTurnToolTrace).toEqual([]);
      expect(result.currentTurnResponseEvidence).toEqual([]);
      expect(result.toolEvidenceReceipts).toEqual([]);
      expect(result.messages).toEqual([]);
      expect(harness.durable.toolTrace).toEqual([]);
      expect(await verifiedStateEvents(
        harness.store,
        harness.runtime.turnInput.sessionId,
      )).toEqual([]);

      providerGate.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(harness.durable.toolTrace).toEqual([]);
      expect(await verifiedStateEvents(
        harness.store,
        harness.runtime.turnInput.sessionId,
      )).toEqual([]);
    },
  );

  it('observes and rechecks run ownership before any parallel provider read starts', async () => {
    let current = true;
    const clients = createMockClients(createTestFixtures());
    const searchMenu = vi.spyOn(clients.menu, 'searchMenu');
    const searchPromotions = vi.spyOn(
      clients.promotion,
      'searchPromotions',
    );
    const observeRun = vi.fn<NonNullable<AgentTurnInput['observeRun']>>(
      async ({ kind }) => {
        if (kind === 'tool') current = false;
      },
    );
    const harness = await createHarness({
      calls: publicReadCalls(),
      clients,
      scopes: [],
      observeRun,
      runGuard: {
        isCurrent: vi.fn(async () => current),
      },
    });

    const result = await harness.run();

    expect(observeRun).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'tool',
    }));
    expect(result.failure).toBe('customer_run_cancelled');
    expect(searchMenu).not.toHaveBeenCalled();
    expect(searchPromotions).not.toHaveBeenCalled();
    expect(harness.controller.signal.aborted).toBe(true);
    expect(result.currentTurnToolTrace).toEqual([]);
    expect(result.currentTurnResponseEvidence).toEqual([]);
    expect(await verifiedStateEvents(
      harness.store,
      harness.runtime.turnInput.sessionId,
    )).toEqual([]);
  });

  it('atomically rejects a run superseded while the conditional snapshot append is pending', async () => {
    const runId = 'customer-run-parallel-commit-race';
    const store = new RaceableRunCommitStore();
    const harness = await createHarness({
      calls: publicReadCalls(),
      clients: createMockClients(createTestFixtures()),
      scopes: [],
      store,
      activeCustomerRunId: runId,
      runGuard: {
        isCurrent: vi.fn(async () => true),
        commitFence: {
          kind: 'customer_run',
          runId,
          sessionAuthorityGeneration: 0,
        },
      },
    });
    store.beforeConditionalCommit = async () => {
      await store.updateCustomerRun(runId, {
        status: 'superseded',
        terminalAt: '2026-07-20T00:00:01.000Z',
      });
    };

    const result = await harness.run();

    expect(result.failure).toBe('customer_run_cancelled');
    expect(harness.controller.signal.aborted).toBe(true);
    expect(result.currentTurnToolTrace).toEqual([]);
    expect(result.currentTurnResponseEvidence).toEqual([]);
    expect(result.toolEvidenceReceipts).toEqual([]);
    expect(result.messages).toEqual([]);
    expect(harness.durable.toolTrace).toEqual([]);
    expect(await verifiedStateEvents(
      store,
      harness.runtime.turnInput.sessionId,
    )).toEqual([]);
  });

  it('fails closed instead of degrading an owned run to check-then-write persistence', async () => {
    const harness = await createHarness({
      calls: publicReadCalls(),
      clients: createMockClients(createTestFixtures()),
      scopes: [],
      runGuard: {
        isCurrent: vi.fn(async () => true),
      },
    });

    const result = await harness.run();

    expect(result.failure).toBe('agent_tool_execution_failed');
    expect(result.currentTurnToolTrace).toEqual([]);
    expect(result.currentTurnResponseEvidence).toEqual([]);
    expect(result.toolEvidenceReceipts).toEqual([]);
    expect(result.messages).toEqual([]);
    expect(await verifiedStateEvents(
      harness.store,
      harness.runtime.turnInput.sessionId,
    )).toEqual([]);
  });

  it('keeps a successful commit authoritative when post-commit telemetry fails', async () => {
    const observeRun = vi.fn<NonNullable<AgentTurnInput['observeRun']>>(
      async (observation) => {
        if (observation.kind === 'verified_state') {
          throw new Error('telemetry unavailable');
        }
      },
    );
    const harness = await createHarness({
      calls: publicReadCalls(),
      clients: createMockClients(createTestFixtures()),
      scopes: [],
      observeRun,
    });

    const result = await harness.run();

    expect(result.failure).toBeNull();
    expect(toolNames(result.currentTurnToolTrace)).toEqual([
      'searchMenu',
      'searchPromotions',
    ]);
    expect(await verifiedStateEvents(
      harness.store,
      harness.runtime.turnInput.sessionId,
    )).toHaveLength(1);
    expect(observeRun).toHaveBeenCalledWith({ kind: 'verified_state' });
  });

  it('rejects expired private publication authority after provider completion with zero durable snapshot', async () => {
    const runId = 'customer-run-private-authority-expiry';
    let expireAuthority = () => undefined;
    const clients = createMockClients(createTestFixtures(), {
      recentOrderProvider: vi.fn(async () => {
        const result = success(
          recentOrder(),
          'PRIVATE order provider prose',
        );
        await Promise.resolve();
        expireAuthority();
        return result;
      }),
    });
    const harness = await createHarness({
      calls: privateReadCalls().slice(1, 2),
      clients,
      activeCustomerRunId: runId,
      runGuard: {
        isCurrent: vi.fn(async () => true),
        commitFence: {
          kind: 'customer_run',
          runId,
          sessionAuthorityGeneration: 0,
        },
      },
    });
    expireAuthority = () => {
      const evidence =
        harness.runtime.turnInput.accessContext?.authenticationEvidence;
      if (evidence?.state !== 'verified') {
        throw new Error('test_authenticated_access_missing');
      }
      evidence.expiresAt = '2020-01-01T00:00:00.000Z';
    };

    const result = await harness.run();

    expect(result.failure).toBe('agent_tool_execution_failed');
    expect(result.currentTurnToolTrace).toEqual([]);
    expect(result.currentTurnResponseEvidence).toEqual([]);
    expect(result.toolEvidenceReceipts).toEqual([]);
    expect(result.messages).toEqual([]);
    expect(harness.durable.toolTrace).toEqual([]);
    expect(await verifiedStateEvents(
      harness.store,
      harness.runtime.turnInput.sessionId,
    )).toEqual([]);
  });

  it('sanitizes private child and parent spans when a provider aborts its parallel read', async () => {
    const orderId = 'PRIVATE-PARALLEL-FAIL-ORDER-ID-80c9ba';
    const providerMessage =
      'PRIVATE-PARALLEL-FAIL-PROVIDER-MESSAGE-c3a1ac';
    const sourceUrl =
      'https://private.invalid/PRIVATE-PARALLEL-FAIL-URL-aacb8c';
    const events: TraceEvent[] = [];
    let abortExternalCalls: (reason: unknown) => void = () => {
      throw new Error('parallel_abort_hook_missing');
    };
    const savedAddressesProvider = vi.fn(async () => success(
      [],
      'saved_addresses_observed',
    ));
    const recentOrderProvider = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
      const error =
        new Error(`${providerMessage}:${orderId}:${sourceUrl}`);
      abortExternalCalls(error);
      throw error;
    });
    const clients = createMockClients(createTestFixtures(), {
      savedAddressesProvider,
      recentOrderProvider,
    });
    const harness = await createHarness({
      calls: privateReadCalls().slice(0, 2),
      clients,
      turnTrace: new CaptureSpan(
        'parallel_read_execution_node_test',
        events,
      ),
    });
    abortExternalCalls = harness.runtime.abortExternalCalls;

    const result = await harness.run();

    await vi.waitFor(() => {
      expect(events).toContainEqual({
        phase: 'fail',
        name: 'agent_parallel_provider_read',
        payload: { message: 'recent_order_lookup_failed' },
      });
    });
    expect(savedAddressesProvider).toHaveBeenCalledOnce();
    expect(recentOrderProvider).toHaveBeenCalledOnce();
    await vi.waitFor(() => {
      expect(events).toContainEqual(expect.objectContaining({
        phase: 'end',
        name: 'agent_parallel_provider_read',
        payload: expect.objectContaining({
          toolName: 'getSavedAddresses',
          executionOutcome: 'success',
        }),
      }));
    });
    expect(result.failure).toBe('customer_run_cancelled');
    expect(events).toContainEqual({
      phase: 'fail',
      name: 'agent_parallel_provider_reads',
      payload: { message: 'private_tool_batch_failed' },
    });
    const privateFailureEvents = events.filter(({ name, phase, payload }) =>
      phase === 'fail' &&
      (
        name === 'agent_parallel_provider_reads' ||
        payload.message === 'recent_order_lookup_failed'
      ));
    const serializedFailures = JSON.stringify(privateFailureEvents);
    expect(serializedFailures).not.toContain(orderId);
    expect(serializedFailures).not.toContain(providerMessage);
    expect(serializedFailures).not.toContain(sourceUrl);
  });
});
