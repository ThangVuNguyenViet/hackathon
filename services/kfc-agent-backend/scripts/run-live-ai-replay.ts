import { join } from 'node:path';
import { loadEnv } from '../src/config/env.js';
import { OpenAIToolPlanner } from '../src/llm/toolPlanner.js';
import { parseScenarioFile } from '../src/scenarios/parser.js';
import { runScenario } from '../src/scenarios/runner.js';

const env = loadEnv();
if (!env.OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY is required for live AI replay');
}

const scenarioFile = process.argv[2] ?? '../../ai-talent-tracks/fnb/conversations/01-dat-mon-ro-rang-giao-hang.md';
const script = await parseScenarioFile(join(process.cwd(), scenarioFile));
const result = await runScenario(script, {
  toolPlanner: new OpenAIToolPlanner({
    apiKey: env.OPENAI_API_KEY,
    model: process.env.OPENAI_TOOL_PLANNER_MODEL ?? 'gpt-4.1-mini',
  }),
});

console.log(
  JSON.stringify(
    {
      finalState: result.finalState,
      toolTrace: result.toolTrace.map((entry) => ({
        toolName: entry.toolName,
        ok: entry.ok,
        resultSummary: entry.resultSummary,
      })),
      dashboardEvents: result.dashboardEvents.map((event) => ({ type: event.type, payload: event.payload })),
      order: result.order,
    },
    null,
    2,
  ),
);
