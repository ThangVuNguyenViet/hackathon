import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DashboardEventBus } from '../dashboard/eventBus.js';
import type { Cart, DashboardEvent, Order } from '../domain/types.js';
import { loadGeneratedFixtures } from '../fixtures/loadFixtures.js';
import { runAgentTurn } from '../graph/buildGraph.js';
import type { ToolPlanner } from '../llm/toolPlanner.js';
import { createMockClients, type MockClientOptions } from '../mock/createMockClients.js';
import type { ToolTraceEntry } from '../ordering/types.js';
import { MemoryStore } from '../persistence/memoryStore.js';
import type { ScenarioScript } from './parser.js';

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
  toolPlanner?: ToolPlanner;
  testFulfillmentQuoteProvider?: MockClientOptions['fulfillmentQuoteProvider'];
}

function defaultFixturesRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '../..');
}

export async function runScenario(script: ScenarioScript, options: RunScenarioOptions = {}): Promise<ScenarioRunResult> {
  const sessionId = `replay_${script.id}`;
  const store = new MemoryStore();
  const dashboard = new DashboardEventBus();
  const fixtures = await loadGeneratedFixtures(options.fixturesRoot ?? defaultFixturesRoot());
  if (fixtures.menuItems.length < 80) {
    throw new Error(`Expected generated menu fixtures, received ${fixtures.menuItems.length}`);
  }
  const clients = createMockClients(
    fixtures,
    options.testFulfillmentQuoteProvider ? { fulfillmentQuoteProvider: options.testFulfillmentQuoteProvider } : undefined,
  );
  const escalationReasons = new Set<string>();
  let currentCart: Cart | undefined;
  let currentOrder: Order | undefined;
  let eventsBeforeFinalUserTurn: DashboardEvent[] = [];
  const toolTrace: ToolTraceEntry[] = [];

  for (const [index, turn] of script.userTurns.entries()) {
    if (index === script.userTurns.length - 1) {
      eventsBeforeFinalUserTurn = dashboard.getEvents(sessionId);
    }
    const output = await runAgentTurn({
      sessionId,
      customerId: 'scenario_customer',
      channel: script.channel,
      text: turn.text,
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
  }

  const dashboardEvents = dashboard.getEvents(sessionId);
  const transcript = await store.listTurns(sessionId);
  return {
    finalState: dashboardEvents.some((event) => event.type === 'handoff_required')
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
