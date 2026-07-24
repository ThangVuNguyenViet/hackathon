import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { runAgentTurn } from '../src/agent/kfcAgent.js';
import { createAgentTraceContext } from '../src/agent/agentTraceContext.js';
import {
  createConfiguredAgentChatModel,
  resolveAgentModelProfile,
} from '../src/config/agentModelProfile.js';
import { runModelCapabilityPreflight } from '../src/config/modelCapabilityPreflight.js';
import { DashboardEventBus } from '../src/dashboard/eventBus.js';
import { loadGeneratedFixtures } from '../src/fixtures/loadFixtures.js';
import { parseLiveScenarioCliArgs } from '../src/liveEvidence/liveScenarioCli.js';
import { runLiveScenarioCommandStream } from '../src/liveEvidence/liveScenarioProtocol.js';
import { startLiveScenarioSession } from '../src/liveEvidence/liveScenarioSession.js';
import { createMockClients } from '../src/mock/createMockClients.js';
import { LangSmithAgentTracer } from '../src/observability/langsmithAgentTracer.js';
import { MemoryStore } from '../src/persistence/memoryStore.js';
import { legacySessionIdOutsidePackNamespace } from '../src/runtime/businessPack.js';
import { loadScenarioScript } from '../src/scenarios/scenarioScript.js';

async function main(): Promise<void> {
  const serviceRoot = process.cwd();
  const repoRoot = resolve(serviceRoot, '../..');
  const args = parseLiveScenarioCliArgs(process.argv.slice(2), repoRoot);
  const profile = resolveAgentModelProfile({
    candidateId: args.candidateId,
  });
  const binding = createConfiguredAgentChatModel({
    profile,
    openAiApiKey: process.env.OPENAI_API_KEY,
    openAiBaseUrl: process.env.OPENAI_BASE_URL,
    openCodeApiKey: process.env.OPENCODE_API_KEY,
    googleApiKey: process.env.GOOGLE_API_KEY,
  });
  const narrative = await loadScenarioScript(args.scenarioPath);
  const clients = createMockClients(await loadGeneratedFixtures(serviceRoot));
  const store = new MemoryStore();
  const dashboard = new DashboardEventBus();
  const tracer = process.env.LANGSMITH_API_KEY?.trim()
    ? new LangSmithAgentTracer({
        projectName:
          process.env.LANGSMITH_PROJECT?.trim() ||
          'kfc-agent-live-qualification',
        apiKey: process.env.LANGSMITH_API_KEY.trim(),
        apiUrl: process.env.LANGSMITH_ENDPOINT?.trim() || undefined,
        samplingRate: 1,
      })
    : undefined;
  const traceContext = createAgentTraceContext({
    scenarioId: narrative.id,
    probeRunId: args.runId,
  });
  const externalSessionId = `live-${args.runId}`;

  const session = await startLiveScenarioSession({
    artifactsRoot: args.artifactsRoot,
    runId: args.runId,
    attempt: args.attempt,
    correlation: {
      externalSessionId,
      durableSessionId: legacySessionIdOutsidePackNamespace(externalSessionId),
    },
    scenarioPath: args.scenarioPath,
    identity: binding.identity,
    runPreflight: () => runModelCapabilityPreflight(binding),
    executeTurn: async ({ text, recordToolEvent }) => {
      const deferredTraceTasks: Array<() => Promise<void>> = [];
      const output = await runAgentTurn({
        sessionId: externalSessionId,
        customerId: 'synthetic-live-role-player',
        channel: narrative.channel,
        text,
        clients,
        store,
        dashboard,
        agentModel: binding.model,
        agentModelIdentity: binding.identity,
        traceContext,
        tracer,
        recordLocalToolEvidence: recordToolEvent,
        deferTrace(task) {
          deferredTraceTasks.push(task);
        },
      });
      await Promise.allSettled(deferredTraceTasks.map((task) => task()));
      return { responseText: output.responseText };
    },
  });

  process.stdout.write(
    `${JSON.stringify({
      type: session.preflightPassed ? 'session_ready' : 'preflight_failed',
      runId: args.runId,
      attempt: args.attempt,
      runDirectory: session.runDirectory,
      model: session.identity,
      scenario: session.scenario,
      protocol: {
        user: { type: 'user', text: '<improvised customer message>' },
        finish: { type: 'finish', note: '<optional reviewer note>' },
      },
    })}\n`,
  );
  if (!session.preflightPassed) {
    process.exitCode = 2;
    return;
  }

  const lines = createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });
  await runLiveScenarioCommandStream({
    session,
    lines,
    writeLine(line) {
      process.stdout.write(`${line}\n`);
    },
  });
}

void main().catch((error: unknown) => {
  const errorClass =
    error instanceof Error && /^[A-Za-z][A-Za-z0-9]{0,63}$/u.test(error.name)
      ? error.name
      : 'UnknownError';
  process.stderr.write(
    `${JSON.stringify({ type: 'fatal_error', errorClass })}\n`,
  );
  process.exitCode = 1;
});
