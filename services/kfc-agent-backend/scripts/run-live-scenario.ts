import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { runAgentTurn } from '../src/agent/kfcAgent.js';
import { createAgentTraceContext } from '../src/agent/agentTraceContext.js';
import {
  createConfiguredAgentChatModel,
  resolveAgentModelProfile,
} from '../src/config/agentModelProfile.js';
import { runModelCapabilityPreflight } from '../src/config/modelCapabilityPreflight.js';
import { loadOptionalEnvFile } from '../src/config/optionalEnvFile.js';
import { DashboardEventBus } from '../src/dashboard/eventBus.js';
import { loadGeneratedFixtures } from '../src/fixtures/loadFixtures.js';
import {
  configuredSecretValues,
  parseLiveScenarioCliArgs,
} from '../src/liveEvidence/liveScenarioCli.js';
import { runLiveScenarioCommandStream } from '../src/liveEvidence/liveScenarioProtocol.js';
import { startLiveScenarioSession } from '../src/liveEvidence/liveScenarioSession.js';
import {
  createEvidenceSanitizer,
  serializeEvidenceJsonLine,
} from '../src/liveEvidence/evidenceRedaction.js';
import { createMockClients } from '../src/mock/createMockClients.js';
import { LangSmithAgentTracer } from '../src/observability/langsmithAgentTracer.js';
import { MemoryStore } from '../src/persistence/memoryStore.js';
import { legacySessionIdOutsidePackNamespace } from '../src/runtime/businessPack.js';
import { loadScenarioScript } from '../src/scenarios/scenarioScript.js';

const serviceRoot = process.cwd();
const repoRoot = resolve(serviceRoot, '../..');
loadOptionalEnvFile(resolve(repoRoot, '.env'));

const configuredSecrets = configuredSecretValues(process.env);
const sanitizeOutput = createEvidenceSanitizer(configuredSecrets);

async function main(): Promise<void> {
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
    configuredSecrets,
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

  let protocolStarted = false;
  try {
    process.stdout.write(
      `${serializeEvidenceJsonLine(
        {
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
        },
        sanitizeOutput,
      )}\n`,
    );
    if (!session.preflightPassed) {
      process.exitCode = 2;
      return;
    }

    const lines = createInterface({
      input: process.stdin,
      crlfDelay: Infinity,
    });
    protocolStarted = true;
    await runLiveScenarioCommandStream({
      session,
      lines,
      sanitize: sanitizeOutput,
      writeLine(line) {
        process.stdout.write(`${line}\n`);
      },
    });
  } catch (error) {
    if (!protocolStarted) {
      await session.recordProtocolError('control_error', safeErrorClass(error));
    }
    await session.interrupt('control_error');
    throw error;
  } finally {
    await session.interrupt('stdin_eof');
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${serializeEvidenceJsonLine(
      {
        type: 'fatal_error',
        errorClass: safeErrorClass(error),
      },
      sanitizeOutput,
    )}\n`,
  );
  process.exitCode = 1;
});

function safeErrorClass(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  return /^[A-Za-z][A-Za-z0-9]{0,63}$/u.test(name) ? name : 'UnknownError';
}
