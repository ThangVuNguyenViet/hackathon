import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DashboardEventBus } from '../dashboard/eventBus.js';
import type { Cart, DashboardEvent, Order } from '../domain/types.js';
import { loadGeneratedFixtures } from '../fixtures/loadFixtures.js';
import type { GeneratedFixtures } from '../fixtures/schema.js';
import { runAgentTurn } from '../graph/buildGraph.js';
import type { AgentGraphState } from '../graph/state.js';
import type { ContextPolicyDirective } from '../graph/contextPolicy.js';
import type { ToolPlanner } from '../llm/toolPlanner.js';
import { createMockClients, type MockClientOptions } from '../mock/createMockClients.js';
import type { ToolTraceEntry } from '../ordering/types.js';
import { MemoryStore } from '../persistence/memoryStore.js';
import type { ScenarioScript } from './scenarioScript.js';

export interface ScenarioRunResult {
  finalState: string;
  coveredUseCases: string[];
  dashboardEvents: DashboardEvent[];
  escalationReasons: string[];
  transcript: Awaited<ReturnType<MemoryStore['listTurns']>>;
  eventsBeforeFinalUserTurn: DashboardEvent[];
  toolTrace: ToolTraceEntry[];
  cart?: Cart;
  order?: Order;
}

export interface RunScenarioOptions {
  fixturesRoot?: string;
  initialVerifiedState?: Partial<AgentGraphState>;
  mockClientOptions?: MockClientOptions;
  toolPlanner?: ToolPlanner;
  testFulfillmentQuoteProvider?: MockClientOptions['fulfillmentQuoteProvider'];
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
  if (options.testFulfillmentQuoteProvider) {
    mockClientOptions.fulfillmentQuoteProvider = options.testFulfillmentQuoteProvider;
  }
  const clients = createMockClients(fixtures, mockClientOptions);
  const escalationReasons = new Set<string>();
  let currentCart: Cart | undefined;
  let currentOrder: Order | undefined;
  let currentHandoff: AgentGraphState['handoff'];
  let eventsBeforeFinalUserTurn: DashboardEvent[] = [];
  const toolTrace: ToolTraceEntry[] = [];

  if (options.initialVerifiedState) {
    await store.appendEvent(sessionId, 'graph:verified_state', {
      verifiedState: options.initialVerifiedState,
    });
  }

  for (const [index, turn] of script.userTurns.entries()) {
    if (index === script.userTurns.length - 1) {
      eventsBeforeFinalUserTurn = dashboard.getEvents(sessionId);
    }
    const output = await runAgentTurn({
      sessionId,
      customerId: 'scenario_customer',
      channel: script.channel,
      text: turn.text,
      metadata: options.contextPolicy ? { rawEvent: { contextPolicy: options.contextPolicy } } : undefined,
      clients,
      store,
      dashboard,
      toolPlanner: options.toolPlanner,
    });
    const outputTrace = output.state.toolTrace ?? [];
    toolTrace.push(...outputTrace.slice(toolTrace.length));
    for (const reason of output.state.escalationReasons) {
      escalationReasons.add(reason);
    }
    if (output.state.cart) currentCart = output.state.cart;
    if (output.state.order) currentOrder = output.state.order;
    currentHandoff = output.state.handoff;
  }

  const dashboardEvents = dashboard.getEvents(sessionId);
  const transcript = await store.listTurns(sessionId);
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
    cart: currentCart,
    order: currentOrder,
  };
}
