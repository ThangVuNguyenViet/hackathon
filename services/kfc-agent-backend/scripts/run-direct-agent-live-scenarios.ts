import { resolve } from 'node:path';
import OpenAI from 'openai';
import type { OpenAIClient } from '@kfc/openai-agents-runtime';
import { KfcDirectTurnService } from '../src/agent/kfcDirectTurnService.js';
import { OpenAiKfcAgent } from '../src/agent/openAiKfcAgent.js';
import type { CustomerAccessContext } from '../src/domain/types.js';
import {
  DIRECT_AGENT_MANUAL_REGRESSION_BANK,
  loadCanonicalDirectAgentScenarios,
  redactedDirectScenarioProgress,
  runDirectAgentScenarioCollection,
  writeDirectAgentTranscriptArtifacts,
} from '../src/evaluation/directAgentLiveScenarios.js';
import { loadGeneratedFixtures } from '../src/fixtures/loadFixtures.js';
import { createMockClients } from '../src/mock/createMockClients.js';
import { MemoryStore } from '../src/persistence/memoryStore.js';

function exitWithRedactedFailure(): never {
  process.stderr.write(
    `${JSON.stringify({ completed: false, error: 'direct_live_scenario_failed' })}\n`,
  );
  process.exit(1);
}

process.on('uncaughtException', exitWithRedactedFailure);
process.on('unhandledRejection', exitWithRedactedFailure);

const liveOptIn = process.env.RUN_LIVE_DIRECT_AGENT_SCENARIOS === '1';
if (!liveOptIn) {
  throw new Error(
    'Live direct-agent scenarios are disabled. Set RUN_LIVE_DIRECT_AGENT_SCENARIOS=1 explicitly.',
  );
}

const apiKey = process.env.OPENAI_API_KEY?.trim();
if (!apiKey) throw new Error('OPENAI_API_KEY is required');

const backendRoot = process.cwd();
const repositoryRoot = resolve(backendRoot, '../..');
const conversationsRoot = resolve(
  repositoryRoot,
  'ai-talent-tracks/fnb/conversations',
);
const fixtures = await loadGeneratedFixtures(backendRoot);
const store = new MemoryStore();
const clientBySession = new Map<string, ReturnType<typeof createMockClients>>();
const model = process.env.KFC_AGENT_MODEL?.trim() || 'gpt-4.1-mini';
const openAiClient = new OpenAI({
  apiKey,
  ...(process.env.OPENAI_BASE_URL?.trim()
    ? { baseURL: process.env.OPENAI_BASE_URL.trim() }
    : {}),
});
const openAiAgent = new OpenAiKfcAgent({
  // The isolated SDK runtime owns its own nominal OpenAI client type.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  client: openAiClient as unknown as OpenAIClient,
  model,
});

function fixtureAccessContext(
  sessionId: string,
  customerId: string,
): CustomerAccessContext {
  const now = new Date();
  return {
    tenantScope: 'kfc-vietnam',
    customerSurface: 'kfc-app-chat',
    sessionRef: sessionId,
    surfaceSubjectRef: 'not-applicable',
    kfcSubjectRef: customerId,
    authenticationState: 'authenticated',
    membershipState: 'member',
    channelAccountLinkState: 'not-applicable',
    subjectBindingState: 'verified',
    authenticationEvidence: {
      state: 'verified',
      method: 'direct-live-fixture-session',
      issuer: 'kfc-agent-backend',
      audience: 'kfc-agent-backend',
      authenticatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
      evidenceRef: sessionId,
    },
    authorizedScopes: [
      'customer:read',
      'membership:read',
      'membership:write',
      'order:read',
      'order:write',
      'payment:read',
      'payment:write',
      'handoff:write',
    ],
  };
}

const service = new KfcDirectTurnService({
  store,
  openAiAgent,
  getFixtures: async () => fixtures,
  createClients: async (sessionId) => {
    const existing = clientBySession.get(sessionId);
    if (existing) return existing;
    const clients = createMockClients(fixtures);
    clientBySession.set(sessionId, clients);
    return clients;
  },
  getAccessContext: async (sessionId, customerId) =>
    fixtureAccessContext(sessionId, customerId),
});

const canonical = await loadCanonicalDirectAgentScenarios(conversationsRoot);
const selectedSet = process.env.KFC_DIRECT_LIVE_SCENARIO_SET?.trim() || 'all';
const scenarios =
  selectedSet === 'canonical'
    ? canonical
    : selectedSet === 'manual'
      ? DIRECT_AGENT_MANUAL_REGRESSION_BANK
      : selectedSet === 'all'
        ? [...canonical, ...DIRECT_AGENT_MANUAL_REGRESSION_BANK]
        : (() => {
            throw new Error(
              'KFC_DIRECT_LIVE_SCENARIO_SET must be canonical, manual, or all',
            );
          })();

const generatedAt = new Date().toISOString();
const artifact = await runDirectAgentScenarioCollection({
  service,
  scenarios,
  model,
  generatedAt,
  onTurn: (turn) => {
    // Machine progress is deliberately content-free; the durable transcript
    // artifact contains the explicitly requested customer-visible conversation.
    process.stdout.write(
      `${JSON.stringify(redactedDirectScenarioProgress(turn))}\n`,
    );
  },
});
const outputDirectory =
  process.env.KFC_DIRECT_LIVE_OUTPUT_DIR?.trim() ||
  resolve(
    backendRoot,
    '.artifacts/direct-agent-live',
    generatedAt.replaceAll(/[:.]/gu, '-'),
  );
const paths = await writeDirectAgentTranscriptArtifacts({
  artifact,
  outputDirectory,
});

process.stdout.write(
  `${JSON.stringify({
    completed: true,
    runtime: artifact.runtime,
    model: artifact.model,
    scenarioCount: artifact.scenarios.length,
    jsonPath: paths.jsonPath,
    markdownPath: paths.markdownPath,
  })}\n`,
);
