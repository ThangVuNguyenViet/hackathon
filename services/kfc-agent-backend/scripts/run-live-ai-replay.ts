import { resolve } from 'node:path';
import { buildServer } from '../src/api/server.js';
import { buildServerOptionsFromEnv } from '../src/api/serverOptions.js';
import { loadEnv } from '../src/config/env.js';
import { OpenAIToolPlanner } from '../src/llm/toolPlanner.js';
import { evaluateLiveScenarioProof } from '../src/proof/liveScenarioProof.js';
import { loadScenarioScript } from '../src/scenarios/scenarioScript.js';

interface KfcChatResponse {
  state?: Record<string, unknown>;
}

const env = loadEnv();
if (!env.OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY is required for live AI replay');
}

const scenarioArg = process.argv[2] ?? '../../ai-talent-tracks/fnb/conversations/01-dat-mon-ro-rang-giao-hang.json';
const scenarioPath = resolve(process.cwd(), scenarioArg);
const script = await loadScenarioScript(scenarioPath);

const options = buildServerOptionsFromEnv(env);
options.toolPlanner ??= new OpenAIToolPlanner({
  apiKey: env.OPENAI_API_KEY,
  model: env.OPENAI_MODEL,
  baseUrl: env.OPENAI_BASE_URL,
});

const server = buildServer(options);
const sessionId = `kfc:live_replay_${script.id}`;
const customerId = 'scenario_customer';

try {
  let finalReply: KfcChatResponse | undefined;

  for (const turn of script.userTurns) {
    const response = await server.inject({
      method: 'POST',
      url: '/chat/kfc/message',
      payload: {
        sessionId,
        customerId,
        clientMessageId: `live_replay_${script.id}_${turn.index}`,
        text: turn.text,
      },
    });

    if (response.statusCode !== 200) {
      throw new Error(`Chat replay failed at turn ${turn.index}: ${response.statusCode} ${response.body}`);
    }

    finalReply = response.json() as KfcChatResponse;
  }

  const [eventsResponse, turnsResponse, sessionsResponse] = await Promise.all([
    server.inject({ method: 'GET', url: `/dashboard/events/${sessionId}` }),
    server.inject({ method: 'GET', url: `/dashboard/sessions/${sessionId}/turns` }),
    server.inject({ method: 'GET', url: '/dashboard/sessions' }),
  ]);

  if (eventsResponse.statusCode !== 200) {
    throw new Error(`Dashboard events fetch failed: ${eventsResponse.statusCode} ${eventsResponse.body}`);
  }
  if (turnsResponse.statusCode !== 200) {
    throw new Error(`Dashboard turns fetch failed: ${turnsResponse.statusCode} ${turnsResponse.body}`);
  }
  if (sessionsResponse.statusCode !== 200) {
    throw new Error(`Dashboard sessions fetch failed: ${sessionsResponse.statusCode} ${sessionsResponse.body}`);
  }

  const finalState = finalReply?.state ?? null;
  const sessionSummary =
    ((sessionsResponse.json() as { sessions?: Array<Record<string, unknown>> }).sessions ?? []).find(
      (session) => session.sessionId === sessionId,
    ) ?? null;

  const dashboardEvents = (eventsResponse.json() as { events?: unknown[] }).events ?? [];
  const transcript = (turnsResponse.json() as { turns?: unknown[] }).turns ?? [];
  const proof = evaluateLiveScenarioProof({
    script,
    sessionId,
    workerUrl: 'local-server-inject',
    endpointChecks: [
      { name: 'dashboard:events', ok: eventsResponse.statusCode === 200, status: eventsResponse.statusCode },
      { name: 'dashboard:turns', ok: turnsResponse.statusCode === 200, status: turnsResponse.statusCode },
      { name: 'dashboard:sessions', ok: sessionsResponse.statusCode === 200, status: sessionsResponse.statusCode },
    ],
    sessionControl: null,
    turns: transcript as Parameters<typeof evaluateLiveScenarioProof>[0]['turns'],
    dashboardEvents: dashboardEvents as Parameters<typeof evaluateLiveScenarioProof>[0]['dashboardEvents'],
  });

  console.log(
    JSON.stringify(
      {
        scenarioPath,
        sessionId,
        customerId,
        channel: script.channel,
        finalState,
        toolTrace: Array.isArray(finalState?.toolTrace) ? finalState.toolTrace : [],
        dashboardEvents,
        order:
          finalState && typeof finalState === 'object' && 'order' in finalState
            ? (finalState as { order?: unknown }).order ?? null
            : null,
        transcript,
        sessionSummary,
        proof,
      },
      null,
      2,
    ),
  );
  if (!proof.ok) process.exitCode = 1;
} finally {
  await server.close();
}
