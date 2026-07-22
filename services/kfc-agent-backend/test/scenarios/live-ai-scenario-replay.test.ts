import { writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import {
  createAgentChatModel,
  resolveAgentModelProfile,
  type AgentModelIdentity,
  type AgentProfileMode,
  type AgentProvider,
} from '../../src/config/agentModelProfile.js';
import { LIVE_QUALITY_INVENTORY_VERSION } from '../../src/evaluation/liveQualityContracts.js';
import {
  buildLiveQualityDatasetCases,
  liveQualityInventoryDigest,
} from '../../src/evaluation/liveQualityDataset.js';
import { createLiveQualityExperimentEvaluator } from '../../src/evaluation/liveQualityEvaluators.js';
import {
  assertFocusedLiveScenarioCanaryPreconditions,
  assertLiveAdvisoryScenarioPreconditions,
  oppositeAgentProvider,
  resolveFocusedLiveScenarioTurn,
  resolveLiveAgentProvider,
  resolveLiveOutcomeJudgeProvider,
  selectedLiveScenarioCases,
  shouldJudgeLiveAdvisoryScenarioRun,
} from '../../src/evaluation/liveScenarioSelection.js';
import { projectStateGraphScenarioRun } from '../../src/evaluation/liveQualityStateGraph.js';
import {
  judgeOutcome,
  type OutcomeJudgment,
} from '../../src/evaluation/outcomeJudge.js';
import { createSemanticResponseJudge } from '../../src/evaluation/semanticResponseJudge.js';
import { LangSmithAgentTracer } from '../../src/observability/langsmithAgentTracer.js';
import { runScenario } from '../../src/scenarios/runner.js';
import { loadScenarioScript } from '../../src/scenarios/scenarioScript.js';
import {
  assertCleanQualificationSource,
  assertQualificationProviderEnvironment,
  qualificationSuiteName,
} from '../../scripts/lib/kfc-live-text-qualification.mjs';
import {
  controlledRetryCanaryRequested,
  forceFirstBoundInvokeRetryableFailure,
} from '../support/controlledRetryCanary.js';
import { controlledScenarioCustomerAccess } from './controlledScenarioCustomerAccess.js';
import { liveScenarioCases } from './scenarioCoverageLedger.js';
import { liveScenarioFixtures } from './liveScenarioFixtures.js';
import { buildScenarioOutcomeEvidence } from './scenarioOutcomeEvidence.js';

const liveRequested = process.env.RUN_LIVE_AI_SCENARIOS === '1';
const qualificationRequested = process.env.KFC_LIVE_QUALIFICATION === '1';
const advisoryCanaryRequested = process.env.KFC_LIVE_ADVISORY_CANARY === '1';
const forceFirstRetryCanary = controlledRetryCanaryRequested({
  forceFirstRetry: process.env.KFC_LIVE_FORCE_FIRST_RETRY,
  liveRequested,
  qualificationRequested,
});
if (qualificationRequested && !liveRequested) {
  throw new Error('KFC live qualification requires RUN_LIVE_AI_SCENARIOS=1');
}
const configuredProfileMode =
  process.env.KFC_AGENT_PROFILE_MODE?.trim() || 'production';
if (
  configuredProfileMode !== 'production' &&
  configuredProfileMode !== 'qualification'
) {
  throw new Error('KFC_AGENT_PROFILE_MODE must be production or qualification');
}
const agentProfileMode: AgentProfileMode = configuredProfileMode;
if (qualificationRequested && agentProfileMode !== 'qualification') {
  throw new Error(
    'KFC live qualification requires KFC_AGENT_PROFILE_MODE=qualification',
  );
}
const serviceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const scenariosRoot = resolve(
  serviceRoot,
  '../../ai-talent-tracks/fnb/conversations',
);
const focusedTurn = resolveFocusedLiveScenarioTurn(
  liveScenarioCases,
  process.env.KFC_LIVE_FOCUSED_TURN_ID,
);
assertFocusedLiveScenarioCanaryPreconditions({
  focusedTurn,
  forceFirstRetryCanary,
});
if (focusedTurn && qualificationRequested) {
  throw new Error('focused live turn cannot run during qualification');
}
const selectedModes = selectedLiveScenarioCases(
  liveScenarioCases,
  process.env.KFC_LIVE_SCENARIO_MODE,
);
if (
  focusedTurn &&
  (selectedModes.length !== liveScenarioCases.length ||
    selectedModes.some(({ mode }) => mode !== 'text'))
) {
  throw new Error('focused live turn requires KFC_LIVE_SCENARIO_MODE=text');
}
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
if (focusedTurn && highRiskRepetitions !== 1) {
  throw new Error(
    'focused live turn requires KFC_LIVE_HIGH_RISK_REPETITIONS=1',
  );
}
if (
  focusedTurn &&
  focusedTurn.scenarioCase.turnExpectations[0]?.id !==
    focusedTurn.expectation.id
) {
  throw new Error(
    'focused live turn must be the first turn in its canonical scenario',
  );
}
const selectedCases = focusedTurn
  ? [{ scenarioCase: focusedTurn.scenarioCase, mode: 'text' as const }]
  : selectedModes;
const qualificationRepositoryRoot = resolve(serviceRoot, '../..');
const liveQualityDatasetCases = buildLiveQualityDatasetCases({
  inventoryVersion: LIVE_QUALITY_INVENTORY_VERSION,
  scenarioCases: liveScenarioCases,
});
const qualificationInventoryDigest = qualificationRequested
  ? liveQualityInventoryDigest(liveQualityDatasetCases)
  : undefined;
if (qualificationRequested) {
  assertQualificationProviderEnvironment(process.env);
}
const selectedCaseRows = selectedCases
  .filter(
    ({ scenarioCase, mode }) =>
      highRiskRepetitions === 1 ||
      (mode === 'text' &&
        scenarioCase.turnExpectations.some(({ id }) =>
          highRiskTurnIds.has(id),
        )),
  )
  .flatMap(({ scenarioCase, mode }) =>
    Array.from(
      { length: highRiskRepetitions },
      (_, index) =>
        [scenarioCase.fileName, mode, index + 1, scenarioCase] as const,
    ),
  );
const agentProvider = resolveLiveAgentProvider(process.env.KFC_AGENT_PROVIDER);
assertLiveAdvisoryScenarioPreconditions({
  advisoryRequested: liveRequested && advisoryCanaryRequested,
  focusedTurn,
  forceFirstRetryCanary,
});
const outcomeJudgeProvider = resolveLiveOutcomeJudgeProvider({
  agentProvider,
  qualificationRequested,
  rawProvider: process.env.KFC_LIVE_OUTCOME_JUDGE_PROVIDER,
});
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
  (!qualificationExecutionId ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      qualificationExecutionId,
    ) ||
    !Number.isInteger(qualificationRepetition) ||
    qualificationRepetition! < 1 ||
    qualificationRepetition! > 3 ||
    !qualificationAttestationPath ||
    !isAbsolute(qualificationAttestationPath) ||
    !/^[0-9a-f]{40}$/u.test(qualificationGitSha ?? ''))
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
const liveTraceFlushHookTimeoutMs = 10 * 60_000;
const liveTracer = liveRequested
  ? new LangSmithAgentTracer({
      projectName: requiredEnvironment('LANGSMITH_PROJECT'),
      apiKey: requiredEnvironment('LANGSMITH_API_KEY'),
      ...(process.env.LANGSMITH_ENDPOINT?.trim()
        ? { apiUrl: process.env.LANGSMITH_ENDPOINT.trim() }
        : {}),
      samplingRate: 1,
    })
  : undefined;
const qualificationStartedAt = new Date().toISOString();
const qualifiedTurnsByScenario = new Map<
  string,
  Array<{ id: string; durationMs: number }>
>();

export type LiveAdvisoryOutcomeStatus =
  | 'blocking_failure'
  | 'warning'
  | 'evidence_only'
  | 'inconclusive'
  | 'not_run'
  | 'passed';

export interface LiveAdvisoryOutcomeRecord {
  scenarioFile: string;
  execution: 'completed' | 'deferred' | 'not_run';
  status: LiveAdvisoryOutcomeStatus;
  attempts: number;
  confirmationTriggered: boolean;
  confirmationTrigger?:
    'core_semantic_miss' | 'high_risk_safety_or_availability_miss';
  initial?: OutcomeJudgment;
  final?: OutcomeJudgment;
  infrastructureExhausted: boolean;
  error?: string;
}

export const advisoryOutcomeRecords = new Map<
  string,
  LiveAdvisoryOutcomeRecord
>();

function advisoryConfirmationTrigger(input: {
  role: 'core' | 'supporting';
  judgment: OutcomeJudgment;
}): LiveAdvisoryOutcomeRecord['confirmationTrigger'] | undefined {
  const highRiskMiss = [
    ...input.judgment.safetyIssues,
    ...input.judgment.missedExpectations,
  ].some((issue) =>
    /(?:allerg|safety|safe|availability|unavailable|dị ứng|an toàn|còn hàng)/iu.test(
      issue,
    ),
  );
  if (highRiskMiss) return 'high_risk_safety_or_availability_miss';
  if (
    input.role === 'core' &&
    !input.judgment.passed &&
    input.judgment.missedExpectations.length > 0
  ) {
    return 'core_semantic_miss';
  }
  return undefined;
}

function advisoryOutcomeStatus(input: {
  passed: boolean;
  policy: 'warning' | 'evidence_only' | 'blocking';
}): LiveAdvisoryOutcomeStatus {
  if (input.passed) return 'passed';
  if (input.policy === 'blocking') return 'blocking_failure';
  return input.policy;
}

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

function profileForSelectedExecution() {
  const agentProfile = resolveAgentModelProfile({
    provider: agentProvider,
    model: process.env.KFC_AGENT_MODEL,
    mode: agentProfileMode,
  });
  if (
    highRiskRepetitions > 1 &&
    ((agentProfile.provider === 'openai' &&
      agentProfile.model !== 'gpt-5-mini-2025-08-07') ||
      (agentProfile.provider === 'google' &&
        agentProfile.model !== 'gemini-3.1-flash-lite'))
  ) {
    throw new Error(
      'high-risk diagnostics permit only the approved affordable agent models',
    );
  }
  return agentProfile;
}

function agentModelForSelectedExecution() {
  const agentModel = createAgentChatModel({
    profile: profileForSelectedExecution(),
    ...providerCredentials(agentProvider),
  });
  return forceFirstRetryCanary
    ? forceFirstBoundInvokeRetryableFailure(agentModel)
    : agentModel;
}

function outcomeJudgeModelForSelectedExecution() {
  return createAgentChatModel({
    profile: resolveAgentModelProfile({
      provider: outcomeJudgeProvider,
      mode: agentProfileMode,
    }),
    ...providerCredentials(outcomeJudgeProvider),
  });
}

async function recordAdvisoryOutcome(input: {
  scenarioCase: (typeof liveScenarioCases)[number];
  script: Awaited<ReturnType<typeof loadScenarioScript>>;
  result: Awaited<ReturnType<typeof runScenario>>;
}): Promise<LiveAdvisoryOutcomeRecord> {
  const advisory = input.scenarioCase.advisory;
  if (!advisory) throw new Error('advisory metadata is required');
  if (agentProvider !== 'openai') {
    throw new Error('advisory outcome judgment requires the OpenAI canary');
  }
  const evidence = buildScenarioOutcomeEvidence(
    input.script,
    input.result,
    advisory,
  );
  const model = createAgentChatModel({
    profile: resolveAgentModelProfile({
      provider: 'openai',
      mode: agentProfileMode,
    }),
    ...providerCredentials('openai'),
  });
  let initial: OutcomeJudgment;
  try {
    initial = await judgeOutcome(evidence, { model });
  } catch (error) {
    return {
      scenarioFile: input.scenarioCase.fileName,
      execution: 'completed',
      status: 'inconclusive',
      attempts: 1,
      confirmationTriggered: false,
      infrastructureExhausted: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  const trigger = advisoryConfirmationTrigger({
    role: advisory.role,
    judgment: initial,
  });
  if (!trigger) {
    return {
      scenarioFile: input.scenarioCase.fileName,
      execution: 'completed',
      status: advisoryOutcomeStatus({
        passed: initial.passed,
        policy: advisory.judgmentPolicy,
      }),
      attempts: 1,
      confirmationTriggered: false,
      initial,
      final: initial,
      infrastructureExhausted: false,
    };
  }
  try {
    const final = await judgeOutcome(evidence, { model });
    return {
      scenarioFile: input.scenarioCase.fileName,
      execution: 'completed',
      status: advisoryOutcomeStatus({
        passed: final.passed,
        policy: advisory.judgmentPolicy,
      }),
      attempts: 2,
      confirmationTriggered: true,
      confirmationTrigger: trigger,
      initial,
      final,
      infrastructureExhausted: false,
    };
  } catch (error) {
    return {
      scenarioFile: input.scenarioCase.fileName,
      execution: 'completed',
      status: 'inconclusive',
      attempts: 2,
      confirmationTriggered: true,
      confirmationTrigger: trigger,
      initial,
      infrastructureExhausted: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

type AttestedAdvisoryStatus = 'passed' | 'warning' | 'inconclusive' | 'not_run';

function redactAdvisoryText(value: string): string {
  return value
    .replace(/\bsk-(?:proj-)?[a-z0-9_-]{6,}\b/giu, '[REDACTED]')
    .replace(/\bbearer\s+[a-z0-9._~+/=-]+\b/giu, 'Bearer [REDACTED]')
    .replace(
      /\b(api[ _-]?key|access[ _-]?token|refresh[ _-]?token|password|secret|(?:customer|user|order|session|conversation|message|external)[ _-]?(?:id|identifier))\b(["']?\s*(?:(?::|=)\s*|\s+is\s+))(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\S+)/giu,
      '$1$2[REDACTED]',
    );
}

function attestedOutcomeJudgment(judgment: OutcomeJudgment | undefined) {
  if (!judgment) return null;
  return {
    passed: judgment.passed,
    score: judgment.score,
    achievedOutcome: redactAdvisoryText(judgment.achievedOutcome),
    missedExpectations: judgment.missedExpectations.map(redactAdvisoryText),
    safetyIssues: judgment.safetyIssues.map(redactAdvisoryText),
    rationale: redactAdvisoryText(judgment.rationale),
  };
}

function attestedAdvisoryStatus(
  status: LiveAdvisoryOutcomeStatus,
): AttestedAdvisoryStatus {
  if (status === 'blocking_failure') {
    throw new Error(
      'blocking advisory outcome cannot produce a PASS attestation',
    );
  }
  return status === 'evidence_only' ? 'warning' : status;
}

function advisoryAttestationRecord(
  scenarioCase: (typeof liveScenarioCases)[number],
) {
  const advisory = scenarioCase.advisory;
  if (!advisory) {
    return {
      criterionIds: [],
      policy: 'not_applicable' as const,
      execution: 'not_run' as const,
      status: 'not_run' as const,
      outcomeJudgment: null,
      semanticConfirmation: {
        attempts: 0,
        triggered: false,
        trigger: null,
        finalStatus: 'not_run' as const,
      },
      infrastructureExhausted: false,
      infrastructureError: null,
    };
  }
  const outcome = advisoryOutcomeRecords.get(scenarioCase.fileName);
  if (agentProvider === 'google') {
    if (
      !outcome ||
      outcome.execution !== 'deferred' ||
      outcome.status !== 'not_run'
    ) {
      throw new Error(
        `Google advisory ${scenarioCase.fileName} must be explicitly deferred`,
      );
    }
    return {
      criterionIds: advisory.criteria.map(({ id }) => id),
      policy: advisory.judgmentPolicy,
      execution: outcome.execution,
      status: outcome.status,
      outcomeJudgment: null,
      semanticConfirmation: {
        attempts: outcome.attempts,
        triggered: outcome.confirmationTriggered,
        trigger: outcome.confirmationTrigger ?? null,
        finalStatus: outcome.status,
      },
      infrastructureExhausted: outcome.infrastructureExhausted,
      infrastructureError: outcome.error
        ? redactAdvisoryText(outcome.error)
        : null,
    };
  }
  if (!outcome || outcome.execution !== 'completed') {
    throw new Error(
      `applicable OpenAI advisory ${scenarioCase.fileName} was not executed`,
    );
  }
  const status = attestedAdvisoryStatus(outcome.status);
  return {
    criterionIds: advisory.criteria.map(({ id }) => id),
    policy: advisory.judgmentPolicy,
    execution: outcome.execution,
    status,
    outcomeJudgment:
      status === 'inconclusive'
        ? null
        : attestedOutcomeJudgment(outcome.final ?? outcome.initial),
    semanticConfirmation: {
      attempts: outcome.attempts,
      triggered: outcome.confirmationTriggered,
      trigger: outcome.confirmationTrigger ?? null,
      finalStatus: status,
    },
    infrastructureExhausted: outcome.infrastructureExhausted,
    infrastructureError: outcome.error
      ? redactAdvisoryText(outcome.error)
      : null,
  };
}

afterAll(async () => {
  await liveTracer?.flush();
  if (!qualificationRequested) return;
  assertCleanQualificationSource(
    qualificationRepositoryRoot,
    qualificationGitSha,
  );
  const scenarios = liveScenarioCases.map((scenarioCase) => ({
    fileName: scenarioCase.fileName,
    status: 'PASS' as const,
    advisory: advisoryAttestationRecord(scenarioCase),
    turns: (qualifiedTurnsByScenario.get(scenarioCase.fileName) ?? []).map(
      ({ id, durationMs }) => ({
        id,
        status: 'PASS' as const,
        durationMs,
        softTargetMs: 10_000,
        strictCutoffMs: 30_000,
      }),
    ),
  }));
  const turnCount = scenarios.reduce(
    (total, scenario) => total + scenario.turns.length,
    0,
  );
  const configuredScenarioFiles = new Set(
    liveScenarioCases.map(({ fileName }) => fileName),
  );
  const selectedScenarioFiles = new Set(
    selectedCases.map(({ scenarioCase }) => scenarioCase.fileName),
  );
  const configuredTurnCount = liveScenarioCases.reduce(
    (total, scenarioCase) => total + scenarioCase.turnExpectations.length,
    0,
  );
  if (
    selectedCases.some(({ mode }) => mode !== 'text') ||
    selectedScenarioFiles.size !== configuredScenarioFiles.size ||
    [...configuredScenarioFiles].some(
      (fileName) => !selectedScenarioFiles.has(fileName),
    ) ||
    scenarios.some(
      (scenario) =>
        scenario.turns.length === 0 ||
        scenario.turns.some(
          ({ id }, index) =>
            id !==
            liveScenarioCases.find(
              ({ fileName }) => fileName === scenario.fileName,
            )?.turnExpectations[index]?.id,
        ),
    ) ||
    turnCount !== configuredTurnCount
  ) {
    throw new Error(
      'live qualification attestation requires all canonical text turns to pass',
    );
  }
  const agentProfile = profileForSelectedExecution();
  const outcomeJudgeProfile = resolveAgentModelProfile({
    provider: oppositeAgentProvider(agentProvider),
    mode: agentProfileMode,
  });
  const profileIdentity = (profile: AgentModelIdentity) => ({
    provider: profile.provider,
    model: profile.model,
    profile: profile.profile,
  });
  const attestation = {
    schemaVersion: 3,
    artifactKind: 'kfc-live-text-execution-attestation',
    executionId: qualificationExecutionId,
    gitSha: qualificationGitSha,
    provider: agentProvider,
    repetition: qualificationRepetition,
    mode: 'text',
    agent: profileIdentity(agentProfile),
    outcomeJudge: profileIdentity(outcomeJudgeProfile),
    inventory: {
      version: LIVE_QUALITY_INVENTORY_VERSION,
      digest: qualificationInventoryDigest,
      scenarioCount: scenarios.length,
      turnCount,
    },
    advisoryCalibration: {
      status: 'draft',
      reviewStatus: 'human_review_required',
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
}, liveTraceFlushHookTimeoutMs);

describe.runIf(liveRequested)(selectedSuiteName, () => {
  it.each(selectedCaseRows)(
    '%s [%s] repetition %d',
    async (_fileName, mode, diagnosticRepetition, scenarioCase) => {
      const agentModel = agentModelForSelectedExecution();

      const script = await loadScenarioScript(
        join(scenariosRoot, scenarioCase.fileName),
      );
      const focusedScript = (() => {
        if (!focusedTurn) return script;
        const canonicalUserTurn = script.userTurns.find(
          ({ index }) => index === focusedTurn.expectation.turnIndex,
        );
        if (!canonicalUserTurn) {
          throw new Error('focused live turn is missing from canonical script');
        }
        return {
          ...script,
          userTurns: [canonicalUserTurn],
        };
      })();
      const fixtures = liveScenarioFixtures(scenarioCase.fileName);
      const channel = mode === 'genui' ? 'kfc' : 'messenger_mock';
      const result = await runScenario(focusedScript, {
        agentModel,
        ...(liveTracer ? { tracer: liveTracer } : {}),
        accessContext: scenarioCase.requiresCustomerAccess
          ? controlledScenarioCustomerAccess({
              sessionId: `replay_${script.id}`,
              customerId: 'scenario_customer',
              channel,
            })
          : undefined,
        channelOverride: channel,
        initialVerifiedState: fixtures.initialVerifiedState,
        mockClientOptions: fixtures.mockClientOptions,
        mockedUpstreamApiForTurn: fixtures.mockedUpstreamApiForTurn,
        transformFixtures: fixtures.transformFixtures,
        turnDeadlineMs: 30_000,
        traceRunId:
          `live-quality:${agentProvider}:${scenarioCase.fileName}:${mode}` +
          (qualificationRequested
            ? `:${qualificationExecutionId}:${qualificationRepetition}`
            : `:diagnostic:${diagnosticRepetition}`),
        autoApproveConfirmations:
          scenarioCase.requiresCustomerAccess === true
            ? ({ turnIndex, capability }) =>
                scenarioCase.turnExpectations
                  .find((expectation) => expectation.turnIndex === turnIndex)
                  ?.claims.required.some(
                    (claim) =>
                      claim.kind === 'grounded_tool_outcome' &&
                      claim.expectedOk === true &&
                      claim.anyOf.some((toolName) => toolName === capability),
                  ) === true
            : false,
        confirmationSigningSecret:
          scenarioCase.requiresCustomerAccess === true
            ? 'live-quality-test-confirmation-signing-secret-v1'
            : undefined,
      });
      const outputs = projectStateGraphScenarioRun(result, mode);
      const evaluator = focusedTurn
        ? undefined
        : createLiveQualityExperimentEvaluator(liveQualityDatasetCases, {
            semanticJudge: createSemanticResponseJudge(
              outcomeJudgeModelForSelectedExecution(),
            ),
          });

      if (focusedTurn) {
        expect(outputs).toHaveLength(1);
        const output = outputs[0];
        if (!output) {
          throw new Error('focused live turn evidence is incomplete');
        }
        expect(output.executedTools.map(({ toolName }) => toolName)).toEqual([
          'getRecentOrder',
        ]);
        expect(output.stateAfter).toEqual(output.stateBefore);
        expect(output.responseText.trim().length).toBeGreaterThan(0);
        expect(output.durationMs).toBeLessThanOrEqual(30_000);
      } else {
        if (!evaluator) {
          throw new Error('canonical live evaluator is unavailable');
        }
        expect(outputs).toHaveLength(scenarioCase.turnExpectations.length);
        const issues = (
          await Promise.all(
            scenarioCase.turnExpectations.map(async (expectation, index) => {
              const output = outputs[index];
              if (!output) return [`${expectation.id}: missing output`];
              const scores = await evaluator({
                inputs: { caseId: `${expectation.id}:${mode}` },
                outputs: { ...output },
              });
              return scores.flatMap(({ key, score, comment }) =>
                score === 1 || key === 'latency'
                  ? []
                  : [`${expectation.id}:${key}: ${comment ?? 'failed'}`],
              );
            }),
          )
        ).flat();
        expect(issues, issues.join('\n')).toEqual([]);
      }
      if (
        scenarioCase.advisory &&
        mode === 'text' &&
        diagnosticRepetition === 1 &&
        (advisoryCanaryRequested || qualificationRequested) &&
        !focusedTurn
      ) {
        const record = shouldJudgeLiveAdvisoryScenarioRun({
          scenarioCase,
          agentProvider,
          mode,
          diagnosticRepetition,
          focusedTurn,
        })
          ? await recordAdvisoryOutcome({
              scenarioCase,
              script,
              result,
            })
          : {
              scenarioFile: scenarioCase.fileName,
              execution:
                agentProvider === 'google'
                  ? ('deferred' as const)
                  : ('not_run' as const),
              status:
                agentProvider === 'google'
                  ? ('not_run' as const)
                  : ('inconclusive' as const),
              attempts: 0,
              confirmationTriggered: false,
              infrastructureExhausted: false,
            };
        advisoryOutcomeRecords.set(scenarioCase.fileName, record);
        expect(record.status).not.toBe('blocking_failure');
      }

      if (
        scenarioCase.fileName === '08-thanh-toan-loi-va-don-bat-thuong.json'
      ) {
        const repeatedCheck = outputs[1];
        expect(
          repeatedCheck?.executedTools.filter(
            ({ toolName }) => toolName === 'checkPaymentStatus',
          ),
        ).toHaveLength(1);
        expect(repeatedCheck?.observations).toContainEqual({
          kind: 'payment_status_refreshed',
          toolName: 'checkPaymentStatus',
          privateArgumentsDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
          status: 'failed',
        });
        expect(JSON.stringify(repeatedCheck?.observations)).not.toContain(
          'KFC-MOCK-1001',
        );
        expect(repeatedCheck?.stateAfter.paymentAttempt).toEqual(
          repeatedCheck?.stateBefore.paymentAttempt,
        );
      }
      if (qualificationRequested) {
        qualifiedTurnsByScenario.set(
          scenarioCase.fileName,
          scenarioCase.turnExpectations.map(({ id }, index) => ({
            id,
            durationMs: outputs[index]!.durationMs,
          })),
        );
      }
    },
    20 * 60_000,
  );
});
