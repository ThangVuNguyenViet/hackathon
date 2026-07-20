import { writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import {
  afterAll,
  describe,
  expect,
  it,
} from 'vitest';
import {
  createAgentChatModel,
  resolveAgentModelProfile,
  resolveResponseVerifierModelProfile,
  type AgentModelIdentity,
  type AgentProfileMode,
  type AgentProvider,
} from '../../src/config/agentModelProfile.js';
import {
  LIVE_QUALITY_CANONICAL_INVENTORY_DIGEST,
  LIVE_QUALITY_EXPECTED_SCENARIO_COUNT,
  LIVE_QUALITY_EXPECTED_TURN_COUNT,
  LIVE_QUALITY_INVENTORY_VERSION,
} from '../../src/evaluation/liveQualityContracts.js';
import {
  buildLiveQualityDatasetCases,
  liveQualityInventoryDigest,
} from '../../src/evaluation/liveQualityDataset.js';
import {
  createLiveQualityExperimentEvaluator,
} from '../../src/evaluation/liveQualityEvaluators.js';
import {
  oppositeAgentProvider,
  resolveLiveAgentProvider,
  selectedLiveScenarioCases,
} from '../../src/evaluation/liveScenarioSelection.js';
import { projectStateGraphScenarioRun } from '../../src/evaluation/liveQualityStateGraph.js';
import {
  createSemanticResponseJudge,
} from '../../src/evaluation/semanticResponseJudge.js';
import { LangSmithAgentTracer } from '../../src/observability/langsmithAgentTracer.js';
import { runScenario } from '../../src/scenarios/runner.js';
import { loadScenarioScript } from '../../src/scenarios/scenarioScript.js';
import {
  assertCleanQualificationSource,
  assertQualificationProviderEnvironment,
  qualificationSuiteName,
} from '../../scripts/lib/kfc-live-text-qualification.mjs';
import { controlledCustomerAccess } from '../fixtures/controlledCustomerAccess.js';
import { liveScenarioCases } from './scenarioCoverageLedger.js';
import { liveScenarioFixtures } from './liveScenarioFixtures.js';

const liveRequested = process.env.RUN_LIVE_AI_SCENARIOS === '1';
const qualificationRequested = process.env.KFC_LIVE_QUALIFICATION === '1';
if (qualificationRequested && !liveRequested) {
  throw new Error('KFC live qualification requires RUN_LIVE_AI_SCENARIOS=1');
}
const configuredProfileMode =
  process.env.KFC_AGENT_PROFILE_MODE?.trim() || 'production';
if (
  configuredProfileMode !== 'production' &&
  configuredProfileMode !== 'qualification'
) {
  throw new Error(
    'KFC_AGENT_PROFILE_MODE must be production or qualification',
  );
}
const agentProfileMode: AgentProfileMode = configuredProfileMode;
if (qualificationRequested && agentProfileMode !== 'qualification') {
  throw new Error(
    'KFC live qualification requires KFC_AGENT_PROFILE_MODE=qualification',
  );
}
const scenariosRoot = join(
  process.cwd(),
  '../../ai-talent-tracks/fnb/conversations',
);
const selectedCases = selectedLiveScenarioCases(
  liveScenarioCases,
  process.env.KFC_LIVE_SCENARIO_MODE,
);
const highRiskTurnIds = new Set([
  '01-dat-mon-ro-rang-giao-hang.json#11',
  '02-tu-van-combo-va-upsell.json#3',
  '03-ton-kho-dia-chi-va-cua-hang.json#1',
  '04-sau-khi-dat-don.json#11',
  '05-khieu-nai-va-human-handoff.json#1',
  '06-ngon-ngu-tu-nhien-va-an-toan.json#5',
  '06-ngon-ngu-tu-nhien-va-an-toan.json#7',
  '06-ngon-ngu-tu-nhien-va-an-toan.json#11',
  '07-ca-nhan-hoa-va-loyalty.json#7',
  '08-thanh-toan-loi-va-don-bat-thuong.json#1',
]);
const highRiskRepetitions = process.env.KFC_LIVE_HIGH_RISK_REPETITIONS
  ? Number(process.env.KFC_LIVE_HIGH_RISK_REPETITIONS)
  : 1;
if (![1, 3].includes(highRiskRepetitions)) {
  throw new Error(
    'KFC_LIVE_HIGH_RISK_REPETITIONS must be 1 or the controlled value 3',
  );
}
const qualificationRepositoryRoot = resolve(process.cwd(), '../..');
const liveQualityDatasetCases = buildLiveQualityDatasetCases({
  inventoryVersion: LIVE_QUALITY_INVENTORY_VERSION,
  scenarioCases: liveScenarioCases,
});
const qualificationInventoryDigest = qualificationRequested
  ? liveQualityInventoryDigest(liveQualityDatasetCases)
  : undefined;
if (
  qualificationRequested &&
  qualificationInventoryDigest !== LIVE_QUALITY_CANONICAL_INVENTORY_DIGEST
) {
  throw new Error(
    'live qualification ledger does not match the canonical inventory digest',
  );
}
if (qualificationRequested) {
  assertQualificationProviderEnvironment(process.env);
}
const selectedCaseRows = selectedCases
  .filter(({ scenarioCase, mode }) =>
    highRiskRepetitions === 1 ||
    (
      mode === 'text' &&
      scenarioCase.turnExpectations.some(({ id }) =>
        highRiskTurnIds.has(id))
    ))
  .flatMap(({ scenarioCase, mode }) =>
    Array.from({ length: highRiskRepetitions }, (_, index) =>
      [
        scenarioCase.fileName,
        mode,
        scenarioCase,
        index + 1,
      ] as const));
const agentProvider = resolveLiveAgentProvider(
  process.env.KFC_AGENT_PROVIDER,
);
const qualificationExecutionId = qualificationRequested
  ? requiredEnvironment('KFC_LIVE_QUALIFICATION_EXECUTION_ID')
  : undefined;
const qualificationRepetition = qualificationRequested
  ? Number(requiredEnvironment('KFC_LIVE_QUALIFICATION_REPETITION'))
  : undefined;
const qualificationAttestationPath = qualificationRequested
  ? requiredEnvironment('KFC_LIVE_QUALIFICATION_ATTESTATION_FILE')
  : undefined;
const qualificationGitSha = qualificationRequested
  ? requiredEnvironment('KFC_LIVE_QUALIFICATION_GIT_SHA')
  : undefined;
if (
  qualificationRequested &&
  (
    !qualificationExecutionId ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
      .test(qualificationExecutionId) ||
    !Number.isInteger(qualificationRepetition) ||
    qualificationRepetition! < 1 ||
    qualificationRepetition! > 3 ||
    !qualificationAttestationPath ||
    !isAbsolute(qualificationAttestationPath) ||
    !/^[0-9a-f]{40}$/u.test(qualificationGitSha ?? '')
  )
) {
  throw new Error('KFC live qualification execution identity is invalid');
}
const selectedSuiteName = qualificationRequested
  ? qualificationSuiteName(
      agentProvider,
      qualificationExecutionId!,
      qualificationRepetition!,
    )
  : 'selected StateGraph live scenario replay';
const qualificationStartedAt = new Date().toISOString();
const qualifiedTurnIdsByScenario = new Map<string, string[]>();

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for live scenario replay`);
  return value;
}

function providerCredentials(provider: AgentProvider): {
  openAiApiKey?: string;
  openAiBaseUrl?: string;
  googleApiKey?: string;
} {
  return provider === 'openai'
    ? {
        openAiApiKey: requiredEnvironment('OPENAI_API_KEY'),
        openAiBaseUrl: process.env.OPENAI_BASE_URL,
      }
    : {
        googleApiKey: requiredEnvironment('GOOGLE_API_KEY'),
      };
}

function profilesForSelectedExecution() {
  const verifierProvider = oppositeAgentProvider(agentProvider);
  const configuredVerifierProvider =
    process.env.KFC_RESPONSE_VERIFIER_PROVIDER?.trim();
  if (
    configuredVerifierProvider &&
    configuredVerifierProvider !== verifierProvider
  ) {
    throw new Error(
      `KFC_RESPONSE_VERIFIER_PROVIDER must be ${verifierProvider} ` +
      `when KFC_AGENT_PROVIDER is ${agentProvider}`,
    );
  }
  const agentProfile = resolveAgentModelProfile({
    provider: agentProvider,
    model: process.env.KFC_AGENT_MODEL,
    mode: agentProfileMode,
  });
  const verifierProfile = resolveResponseVerifierModelProfile({
    agentProvider,
    provider: verifierProvider,
    model: process.env.KFC_RESPONSE_VERIFIER_MODEL,
    mode: agentProfileMode,
  });
  if (!verifierProfile) {
    throw new Error('live_response_verifier_missing');
  }
  if (
    highRiskRepetitions > 1 &&
    (
      (
        agentProfile.provider === 'openai' &&
        agentProfile.model !== 'gpt-4.1-mini'
      ) ||
      (
        agentProfile.provider === 'google' &&
        agentProfile.model !== 'gemini-3.1-flash-lite'
      )
    )
  ) {
    throw new Error(
      'high-risk diagnostics permit only the approved affordable agent models',
    );
  }
  return { agentProfile, verifierProfile, verifierProvider };
}

function modelsForSelectedExecution() {
  const { agentProfile, verifierProfile, verifierProvider } =
    profilesForSelectedExecution();
  return {
    agentModel: createAgentChatModel({
      profile: agentProfile,
      ...providerCredentials(agentProvider),
    }),
    responseVerifierModel: createAgentChatModel({
      profile: verifierProfile,
      role: 'response_verifier',
      ...providerCredentials(verifierProvider),
    }),
    verifierProvider,
  };
}

const tracer = liveRequested
  ? new LangSmithAgentTracer({
      apiKey: requiredEnvironment('LANGSMITH_API_KEY'),
      apiUrl: requiredEnvironment('LANGSMITH_ENDPOINT'),
      projectName: requiredEnvironment('LANGSMITH_PROJECT'),
      samplingRate: 1,
    })
  : undefined;

afterAll(async () => {
  await tracer?.flush();
  if (!qualificationRequested) return;
  assertCleanQualificationSource(
    qualificationRepositoryRoot,
    qualificationGitSha,
  );
  const scenarios = liveScenarioCases.map((scenarioCase) => ({
    fileName: scenarioCase.fileName,
    status: 'PASS' as const,
    turns: (qualifiedTurnIdsByScenario.get(scenarioCase.fileName) ?? [])
      .map((id) => ({ id, status: 'PASS' as const })),
  }));
  const turnCount = scenarios.reduce(
    (total, scenario) => total + scenario.turns.length,
    0,
  );
  if (
    selectedCases.length !== LIVE_QUALITY_EXPECTED_SCENARIO_COUNT ||
    selectedCases.some(({ mode }) => mode !== 'text') ||
    scenarios.some((scenario) =>
      scenario.turns.length === 0 ||
      scenario.turns.some(
        ({ id }, index) =>
          id !== liveScenarioCases
            .find(({ fileName }) => fileName === scenario.fileName)
            ?.turnExpectations[index]?.id,
      )) ||
    turnCount !== LIVE_QUALITY_EXPECTED_TURN_COUNT
  ) {
    throw new Error(
      'live qualification attestation requires all canonical text turns to pass',
    );
  }
  const { agentProfile, verifierProfile } = profilesForSelectedExecution();
  const profileIdentity = (
    profile: AgentModelIdentity,
  ) => ({
    provider: profile.provider,
    model: profile.model,
    profile: profile.profile,
  });
  const attestation = {
    schemaVersion: 1,
    artifactKind: 'kfc-live-text-execution-attestation',
    executionId: qualificationExecutionId,
    gitSha: qualificationGitSha,
    provider: agentProvider,
    repetition: qualificationRepetition,
    mode: 'text',
    agent: profileIdentity(agentProfile),
    verifier: profileIdentity(verifierProfile),
    inventory: {
      version: LIVE_QUALITY_INVENTORY_VERSION,
      digest: qualificationInventoryDigest,
      scenarioCount: LIVE_QUALITY_EXPECTED_SCENARIO_COUNT,
      turnCount: LIVE_QUALITY_EXPECTED_TURN_COUNT,
    },
    scenarios,
    status: 'PASS',
    startedAt: qualificationStartedAt,
    completedAt: new Date().toISOString(),
  };
  assertCleanQualificationSource(
    qualificationRepositoryRoot,
    qualificationGitSha,
  );
  writeFileSync(
    qualificationAttestationPath!,
    `${JSON.stringify(attestation, null, 2)}\n`,
    { flag: 'wx' },
  );
});

describe.runIf(liveRequested)(
  selectedSuiteName,
  () => {
    it.concurrent.each(selectedCaseRows)(
      '%s [%s] repetition %d',
      async (_fileName, mode, scenarioCase, diagnosticRepetition) => {
        // Instantiate the author/verifier pair inside each selected execution.
        // This keeps every case independently bound to the exact opposite
        // provider instead of sharing a hidden global model role.
        const {
          agentModel,
          responseVerifierModel,
          verifierProvider,
        } = modelsForSelectedExecution();
        expect(verifierProvider).toBe(oppositeAgentProvider(agentProvider));

        const script = await loadScenarioScript(
          join(scenariosRoot, scenarioCase.fileName),
        );
        const fixtures = liveScenarioFixtures(scenarioCase.fileName);
        const channel = mode === 'genui' ? 'kfc' : 'messenger_mock';
        const result = await runScenario(script, {
          agentModel,
          responseVerifierModel,
          accessContext: scenarioCase.requiresCustomerAccess
            ? controlledCustomerAccess({
                sessionId: `replay_${script.id}`,
                customerId: 'scenario_customer',
                channel,
              })
            : undefined,
          channelOverride: channel,
          initialVerifiedState: fixtures.initialVerifiedState,
          mockClientOptions: fixtures.mockClientOptions,
          mockedUpstreamApiForTurn: fixtures.mockedUpstreamApiForTurn,
          tracer,
          transformFixtures: fixtures.transformFixtures,
          traceRunId:
            `live-quality:${agentProvider}:${scenarioCase.fileName}:${mode}` +
            (qualificationRequested
              ? `:${qualificationExecutionId}:${qualificationRepetition}`
              : `:diagnostic:${diagnosticRepetition}`),
          autoApproveConfirmations:
            scenarioCase.requiresCustomerAccess === true
              ? ({ turnIndex, capability }) =>
                  scenarioCase.turnExpectations
                    .find((expectation) =>
                      expectation.turnIndex === turnIndex)
                    ?.claims.required.some(
                      (claim) =>
                        claim.kind === 'grounded_tool_outcome' &&
                        claim.expectedOk === true &&
                        claim.anyOf.some(
                          (toolName) => toolName === capability,
                        ),
                    ) === true
              : false,
          confirmationSigningSecret:
            scenarioCase.requiresCustomerAccess === true
              ? 'live-quality-test-confirmation-signing-secret-v1'
              : undefined,
        });
        const outputs = projectStateGraphScenarioRun(result, mode);
        const evaluator = createLiveQualityExperimentEvaluator(
          liveQualityDatasetCases,
          {
            semanticJudge: createSemanticResponseJudge(
              responseVerifierModel,
            ),
          },
        );

        expect(outputs).toHaveLength(scenarioCase.turnExpectations.length);
        const issues = (await Promise.all(
          scenarioCase.turnExpectations.map(
            async (expectation, index) => {
            const output = outputs[index];
            if (!output) return [`${expectation.id}: missing output`];
              const scores = await evaluator({
                inputs: { caseId: `${expectation.id}:${mode}` },
                outputs: output as unknown as Record<string, unknown>,
              });
              return scores.flatMap(({ key, score, comment }) =>
                score === 1
                  ? []
                  : [
                      `${expectation.id}:${key}: ${
                        comment ?? 'failed'
                      }`,
                    ]);
            },
          ),
        )).flat();
        expect(issues, issues.join('\n')).toEqual([]);

        if (
          scenarioCase.fileName ===
          '08-thanh-toan-loi-va-don-bat-thuong.json'
        ) {
          const repeatedCheck = outputs[1];
          expect(repeatedCheck?.executedTools.filter(
            ({ toolName }) => toolName === 'checkPaymentStatus',
          )).toHaveLength(1);
          expect(repeatedCheck?.observations).toContainEqual({
            kind: 'payment_status_refreshed',
            toolName: 'checkPaymentStatus',
            privateArgumentsDigest:
              expect.stringMatching(/^[0-9a-f]{64}$/u),
            status: 'failed',
          });
          expect(JSON.stringify(repeatedCheck?.observations))
            .not.toContain('KFC-MOCK-1001');
          expect(repeatedCheck?.stateAfter.paymentAttempt)
            .toEqual(repeatedCheck?.stateBefore.paymentAttempt);
        }
        if (qualificationRequested) {
          qualifiedTurnIdsByScenario.set(
            scenarioCase.fileName,
            scenarioCase.turnExpectations.map(({ id }) => id),
          );
        }
      },
      20 * 60_000,
    );
  },
);
