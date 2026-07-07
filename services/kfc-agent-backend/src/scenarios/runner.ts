import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DashboardEventBus } from '../dashboard/eventBus.js';
import type { DashboardEvent } from '../domain/types.js';
import { loadGeneratedFixtures } from '../fixtures/loadFixtures.js';
import { runAgentTurn } from '../graph/buildGraph.js';
import { createMockClients } from '../mock/createMockClients.js';
import { MemoryStore } from '../persistence/memoryStore.js';
import type { ScenarioScript } from './parser.js';

export interface ScenarioRunResult {
  finalState: string;
  coveredUseCases: string[];
  dashboardEvents: DashboardEvent[];
  escalationReasons: string[];
}

export interface RunScenarioOptions {
  fixturesRoot?: string;
}

function defaultFixturesRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '../..');
}

export async function runScenario(script: ScenarioScript, options: RunScenarioOptions = {}): Promise<ScenarioRunResult> {
  const sessionId = `scenario_${script.id}`;
  const store = new MemoryStore();
  const dashboard = new DashboardEventBus();
  const fixtures = await loadGeneratedFixtures(options.fixturesRoot ?? defaultFixturesRoot());
  if (fixtures.menuItems.length !== 120) {
    throw new Error(`Expected 120 generated menu fixtures, received ${fixtures.menuItems.length}`);
  }
  const clients = createMockClients(fixtures);
  const escalationReasons = new Set<string>();

  for (const turn of script.userTurns) {
    const output = await runAgentTurn({
      sessionId,
      customerId: 'scenario_customer',
      channel: script.channel,
      text: turn.text,
      clients,
      store,
      dashboard,
    });
    for (const reason of output.state.escalationReasons) {
      escalationReasons.add(reason);
    }
  }

  const dashboardEvents = dashboard.getEvents(sessionId);
  return {
    finalState: dashboardEvents.some((event) => event.type === 'handoff_required')
      ? 'human_review_required'
      : script.finalState,
    coveredUseCases: script.useCases,
    dashboardEvents,
    escalationReasons: [...escalationReasons],
  };
}
