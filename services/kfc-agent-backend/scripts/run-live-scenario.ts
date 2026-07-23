import { readdir } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import {
  createAgentChatModel,
  resolveAgentModelProfile,
  type AgentProvider,
} from '../src/config/agentModelProfile.js';
import { runScenario } from '../src/scenarios/runner.js';
import { loadScenarioScript } from '../src/scenarios/scenarioScript.js';
import { liveScenarioFixtures } from '../src/scenarios/liveScenarioFixtures.js';

function agentProvider(value: string | undefined): AgentProvider {
  if (!value || value === 'openai') return 'openai';
  if (value === 'google') return 'google';
  throw new Error(`Unsupported KFC agent provider: ${value}`);
}

const provider = agentProvider(process.env.KFC_AGENT_PROVIDER);
const profile = resolveAgentModelProfile({
  provider,
  model: process.env.KFC_AGENT_MODEL,
});
const model = createAgentChatModel({
  profile,
  openAiApiKey: process.env.OPENAI_API_KEY,
  openAiBaseUrl: process.env.OPENAI_BASE_URL,
  googleApiKey: process.env.GOOGLE_API_KEY,
});
const responseProfile =
  process.env.KFC_RESPONSE_PROFILE === 'social' ? 'social' : 'genui';

const scenarioRoot = resolve('../../ai-talent-tracks/fnb/conversations');
const requestedScenario = process.argv[2];
const scenarioPaths = requestedScenario
  ? [resolve(requestedScenario)]
  : (await readdir(scenarioRoot))
      .filter((name) => name.endsWith('.json'))
      .sort()
      .map((name) => resolve(scenarioRoot, name));

console.log(`Model: ${profile.provider}/${profile.model}`);
console.log(`Response profile: ${responseProfile}`);
console.log(`Scenarios: ${scenarioPaths.length}`);

for (const scenarioPath of scenarioPaths) {
  const scenario = await loadScenarioScript(scenarioPath);
  const result = await runScenario(scenario, {
    agentModel: model,
    responseProfileOverride: responseProfile,
    ...liveScenarioFixtures(basename(scenarioPath)),
    ...(responseProfile === 'genui' ? { channelOverride: 'kfc' } : {}),
  });

  console.log('');
  console.log(`Scenario: ${basename(scenarioPath)} — ${scenario.title}`);
  console.log('Preconditions:');
  for (const precondition of result.preconditions) {
    console.log(`- ${precondition}`);
  }
  for (const turn of result.turnEvidence) {
    const tools =
      result.toolTraceByTurn
        .find((entry) => entry.turnIndex === turn.turnIndex)
        ?.entries.map((entry) => entry.toolName) ?? [];
    console.log('');
    console.log(`User: ${turn.input}`);
    console.log(`Assistant: ${turn.assistantText}`);
    console.log(`Tools: ${tools.length > 0 ? tools.join(', ') : 'none'}`);
    console.log(`Time: ${(turn.durationMs / 1_000).toFixed(2)}s`);
    if (turn.genUi) console.log(`GenUI: ${turn.genUi.widgetKind}`);
  }
}
