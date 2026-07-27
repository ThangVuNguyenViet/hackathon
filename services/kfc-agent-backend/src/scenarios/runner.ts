import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemorySaver } from '@langchain/langgraph';
import { DashboardEventBus } from '../dashboard/eventBus.js';
import type { Cart, Channel, CustomerAccessContext, DashboardEvent, Order } from '../domain/types.js';
import { loadGeneratedFixtures } from '../fixtures/loadFixtures.js';
import type { GeneratedFixtures } from '../fixtures/schema.js';
import type { KfcGenUiAttachment } from '../genui/kfcGenUi.js';
import { runAgentTurn } from '../graph/buildGraph.js';
import type { AgentGraphState } from '../graph/state.js';
import type { ContextPolicyDirective } from '../graph/contextPolicy.js';
import type { ResponseComposer } from '../llm/responseComposer.js';
import type { ToolPlanner } from '../llm/toolPlanner.js';
import {
  createMockClients,
  type MockClientOptions,
  type MockedUpstreamApiProfile,
} from '../mock/createMockClients.js';
import type { ToolTraceEntry } from '../ordering/types.js';
import type {
  AgentTraceApplicability,
  AgentTracer,
} from '../observability/agentTracing.js';
import { MemoryStore, type StoredEvent } from '../persistence/memoryStore.js';
import type { ScenarioScript } from './scenarioScript.js';

export interface ScenarioRunResult {
  finalState: string;
  coveredUseCases: string[];
  dashboardEvents: DashboardEvent[];
  escalationReasons: string[];
  transcript: Awaited<ReturnType<MemoryStore['listTurns']>>;
  eventsBeforeFinalUserTurn: DashboardEvent[];
  toolTrace: ToolTraceEntry[];
  toolTraceByTurn: Array<{ turnIndex: number; entries: ToolTraceEntry[] }>;
  turnEvidence: ScenarioTurnEvidence[];
  persistedEvents: StoredEvent[];
  finalAgentState?: AgentGraphState;
  cart?: Cart;
  order?: Order;
}

export interface ScenarioTurnEvidence {
  turnIndex: number;
  input: string;
  durationMs: number;
  transcriptRevisionBefore: number;
  transcriptRevisionAfter: number;
  eventRevisionBefore: number;
  eventRevisionAfter: number;
  eventIdsBefore: string[];
  eventIds: string[];
  eventIdsAfter: string[];
  checkpointId: string | null;
  checkpointNamespace: string | null;
  checkpointThreadId: string;
  checkpointVerified: boolean;
  assistantText: string;
  genUi?: KfcGenUiAttachment;
  stateBefore: Partial<Pick<AgentGraphState, 'cart' | 'address' | 'fulfillment' | 'order' | 'paymentAttempt' | 'handoff' | 'menuSearchResults' | 'promotionContext' | 'customerContext' | 'paymentMethodEvidence' | 'contentEvidence' | 'invoiceRequest'>>;
  stateAfter: Partial<Pick<AgentGraphState, 'cart' | 'address' | 'fulfillment' | 'order' | 'paymentAttempt' | 'handoff' | 'menuSearchResults' | 'promotionContext' | 'customerContext' | 'paymentMethodEvidence' | 'contentEvidence' | 'invoiceRequest'>>;
}

export interface RunScenarioOptions {
  accessContext?: CustomerAccessContext;
  channelOverride?: Channel;
  fixturesRoot?: string;
  initialVerifiedState?: Partial<AgentGraphState>;
  mockClientOptions?: MockClientOptions;
  responseComposer?: ResponseComposer;
  toolPlanner?: ToolPlanner;
  tracer?: AgentTracer;
  traceRunId?: string;
  traceApplicabilityForTurn?: (turnIndex: number) => AgentTraceApplicability;
  turnDeadlineMs?: number;
  testFulfillmentQuoteProvider?: MockClientOptions['fulfillmentQuoteProvider'];
  mockedUpstreamApiForTurn?: (turnIndex: number) => MockedUpstreamApiProfile | undefined;
  contextPolicy?: ContextPolicyDirective;
  transformFixtures?: (fixtures: GeneratedFixtures) => GeneratedFixtures;
}

function defaultFixturesRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '../..');
}

export async function runScenario(script: ScenarioScript, options: RunScenarioOptions = {}): Promise<ScenarioRunResult> {
  const sessionId = `replay_${script.id}`;
  const store = new MemoryStore();
  const dashboard = new DashboardEventBus();
  const loadedFixtures = await loadGeneratedFixtures(options.fixturesRoot ?? defaultFixturesRoot());
  const fixtures = options.transformFixtures?.(loadedFixtures) ?? loadedFixtures;
  if (fixtures.menuItems.length < 80) {
    throw new Error(`Expected generated menu fixtures, received ${fixtures.menuItems.length}`);
  }
  const mockClientOptions: MockClientOptions = { ...(options.mockClientOptions ?? {}) };
  let currentMockedUpstreamApi: MockedUpstreamApiProfile | undefined;
  if (options.mockedUpstreamApiForTurn) {
    mockClientOptions.mockedUpstreamApiProvider = () => currentMockedUpstreamApi;
  }
  if (options.testFulfillmentQuoteProvider) {
    mockClientOptions.fulfillmentQuoteProvider = options.testFulfillmentQuoteProvider;
  }
  const clients = createMockClients(fixtures, mockClientOptions);
  const escalationReasons = new Set<string>();
  let currentCart: Cart | undefined;
  let currentOrder: Order | undefined;
  let currentHandoff: AgentGraphState['handoff'];
  let finalAgentState: AgentGraphState | undefined;
  let eventsBeforeFinalUserTurn: DashboardEvent[] = [];
  const toolTrace: ToolTraceEntry[] = [];
  const toolTraceByTurn: Array<{ turnIndex: number; entries: ToolTraceEntry[] }> = [];
  const turnEvidence: ScenarioTurnEvidence[] = [];
  let priorStateToolTrace: ToolTraceEntry[] = [];
  const checkpointer = new MemorySaver();

  if (options.initialVerifiedState) {
    await store.appendEvent(sessionId, 'graph:verified_state', {
      verifiedState: options.initialVerifiedState,
    });
  }

  for (const [index, turn] of script.userTurns.entries()) {
    const externalMessageId = `${script.id}:${turn.index}`;
    const transcriptRevisionBefore = (await store.listTurns(sessionId)).length;
    const eventsBefore = await store.listEvents(sessionId);
    const eventRevisionBefore = eventsBefore.length;
    const stateBefore = selectEvidenceState(finalAgentState);
    const startedAt = performance.now();
    currentMockedUpstreamApi = options.mockedUpstreamApiForTurn?.(turn.index);
    if (index === script.userTurns.length - 1) {
      eventsBeforeFinalUserTurn = dashboard.getEvents(sessionId);
    }
    const output = await runAgentTurn({
      sessionId,
      customerId: 'scenario_customer',
      channel: options.channelOverride ?? script.channel,
      text: turn.text,
      externalMessageId,
      accessContext: options.accessContext,
      metadata: {
        rawEvent: {
          scenarioId: script.id,
          ...(options.traceRunId ? { probeRunId: options.traceRunId } : {}),
          ...(options.traceApplicabilityForTurn
            ? { traceApplicability: options.traceApplicabilityForTurn(turn.index) }
            : {}),
          ...(options.contextPolicy ? { contextPolicy: options.contextPolicy } : {}),
        },
      },
      clients,
      store,
      dashboard,
      responseComposer: options.responseComposer,
      toolPlanner: options.toolPlanner,
      tracer: options.tracer,
      turnDeadlineMs: options.turnDeadlineMs,
      checkpointer,
    });
    const durationMs = performance.now() - startedAt;
    const outputTrace = output.state.toolTrace ?? [];
    finalAgentState = output.state;
    const continuesPriorTrace =
      outputTrace.length >= priorStateToolTrace.length &&
      priorStateToolTrace.every((entry, traceIndex) =>
        JSON.stringify(entry) === JSON.stringify(outputTrace[traceIndex]),
      );
    const currentTurnEntries = continuesPriorTrace
      ? outputTrace.slice(priorStateToolTrace.length)
      : outputTrace;
    toolTrace.push(...currentTurnEntries);
    toolTraceByTurn.push({ turnIndex: turn.index, entries: currentTurnEntries });
    priorStateToolTrace = outputTrace;
    for (const reason of output.state.escalationReasons) {
      escalationReasons.add(reason);
    }
    if (output.state.cart) currentCart = output.state.cart;
    if (output.state.order) currentOrder = output.state.order;
    currentHandoff = output.state.handoff;
    const turnsAfter = await store.listTurns(sessionId);
    const eventsAfter = await store.listEvents(sessionId);
    const checkpoint = await checkpointer.getTuple({
      configurable: { thread_id: sessionId, checkpoint_ns: `run:${externalMessageId}` },
    });
    const storedCheckpoint = Object.entries(checkpointer.storage[sessionId] ?? {})
      .flatMap(([checkpointNamespace, byId]) => Object.keys(byId).map((checkpointId) => ({ checkpointNamespace, checkpointId })))
      .sort((left, right) => right.checkpointId.localeCompare(left.checkpointId))[0];
    const checkpointId = checkpoint?.checkpoint.id ?? storedCheckpoint?.checkpointId ?? null;
    const checkpointNamespace =
      checkpoint?.config.configurable?.checkpoint_ns ?? storedCheckpoint?.checkpointNamespace ?? null;
    const verifiedCheckpoint = checkpointId && checkpointNamespace
      ? await checkpointer.getTuple({
          configurable: {
            thread_id: sessionId,
            checkpoint_ns: checkpointNamespace,
            checkpoint_id: checkpointId,
          },
        })
      : undefined;
    const assistantTurn = [...turnsAfter].reverse().find((candidate) => candidate.role === 'assistant');
    turnEvidence.push({
      turnIndex: turn.index,
      input: turn.text,
      durationMs,
      transcriptRevisionBefore,
      transcriptRevisionAfter: turnsAfter.length,
      eventRevisionBefore,
      eventRevisionAfter: eventsAfter.length,
      eventIdsBefore: eventsBefore.map(({ id }) => id),
      eventIds: eventsAfter.slice(eventRevisionBefore).map(({ id }) => id),
      eventIdsAfter: eventsAfter.map(({ id }) => id),
      checkpointId,
      checkpointNamespace,
      checkpointThreadId: sessionId,
      checkpointVerified:
        (
          verifiedCheckpoint?.checkpoint.id === checkpointId &&
          verifiedCheckpoint.config.configurable?.thread_id === sessionId
        ) ||
        (
          storedCheckpoint?.checkpointId === checkpointId &&
          storedCheckpoint.checkpointNamespace === checkpointNamespace
        ),
      assistantText: assistantTurn?.text ?? '',
      genUi: assistantTurn?.metadata?.genUi,
      stateBefore,
      stateAfter: selectEvidenceState(output.state),
    });
  }

  const dashboardEvents = dashboard.getEvents(sessionId);
  const transcript = await store.listTurns(sessionId);
  const persistedEvents = await store.listEvents(sessionId);
  return {
    finalState: currentHandoff
      ? script.id === '05-khieu-nai-va-human-handoff'
        ? 'human_handoff_created'
        : 'human_review_required'
      : script.finalState,
    coveredUseCases: script.useCases,
    dashboardEvents,
    escalationReasons: [...escalationReasons],
    transcript,
    eventsBeforeFinalUserTurn,
    toolTrace,
    toolTraceByTurn,
    turnEvidence,
    persistedEvents,
    finalAgentState,
    cart: currentCart,
    order: currentOrder,
  };
}

function selectEvidenceState(state: AgentGraphState | undefined): ScenarioTurnEvidence['stateBefore'] {
  if (!state) return {};
  return {
    cart: state.cart,
    address: state.address,
    fulfillment: state.fulfillment,
    order: state.order,
    paymentAttempt: state.paymentAttempt,
    handoff: state.handoff,
    menuSearchResults: state.menuSearchResults,
    promotionContext: state.promotionContext,
    customerContext: state.customerContext,
    paymentMethodEvidence: state.paymentMethodEvidence,
    contentEvidence: state.contentEvidence,
    invoiceRequest: state.invoiceRequest,
  };
}
