import type { AppEnv } from '../config/env.js';

export interface ScenarioTraceResult {
  scenarioId: string;
  useCases: string[];
  finalState: string;
}

export interface TraceRecorder {
  mode: 'noop' | 'langsmith';
  recordScenarioResult(result: ScenarioTraceResult): Promise<void>;
}

export function createTraceRecorder(env: Pick<AppEnv, 'LANGSMITH_API_KEY' | 'LANGSMITH_PROJECT'>): TraceRecorder {
  if (!env.LANGSMITH_API_KEY) {
    return {
      mode: 'noop',
      async recordScenarioResult() {
        return undefined;
      },
    };
  }

  return {
    mode: 'langsmith',
    async recordScenarioResult(result) {
      process.env.LANGSMITH_API_KEY = env.LANGSMITH_API_KEY;
      process.env.LANGSMITH_PROJECT = env.LANGSMITH_PROJECT;
      console.info(JSON.stringify({ type: 'langsmith_scenario_result', ...result }));
    },
  };
}
