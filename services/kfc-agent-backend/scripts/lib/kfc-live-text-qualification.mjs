#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertExactKeys,
  assertIdentity,
  assertInventory,
  assertIsoTimestamp,
  assertObject,
  assertSafeText,
} from './kfc-live-text-qualification-validation.mjs';

const profileByProvider = Object.freeze({
  openai: Object.freeze({
    provider: 'openai',
    model: 'gpt-5-mini-2025-08-07',
    profile: 'openai-gpt-5-mini-2025-08-07-reasoning-low-verbosity-low',
  }),
  google: Object.freeze({
    provider: 'google',
    model: 'gemini-3.1-flash-lite',
    profile: 'google-gemini-3.1-flash-lite-thinking-high-qualification',
  }),
});

export const officialOpenAiQualificationBaseUrl = 'https://api.openai.com/v1';

export const mandatoryLiveTextQualification = Object.freeze({
  providers: Object.freeze(['openai', 'google']),
  repetitions: 3,
  mode: 'text',
  profileByProvider,
});

const advisoryPolicies = new Set([
  'warning',
  'evidence_only',
  'not_applicable',
]);
const advisoryStatuses = new Set([
  'passed',
  'warning',
  'inconclusive',
  'not_run',
]);
const advisoryCriteriaByScenario = Object.freeze({
  '02-tu-van-combo-va-upsell.json': Object.freeze({
    policy: 'warning',
    criterionIds: Object.freeze([
      'advisory.02.group-budget-recommendation',
      'advisory.02.complete-menu-discovery',
      'advisory.02.value-consent-arithmetic',
    ]),
  }),
  '03-ton-kho-dia-chi-va-cua-hang.json': Object.freeze({
    policy: 'warning',
    criterionIds: Object.freeze(['advisory.03.unavailable-item-boundary']),
  }),
  '06-ngon-ngu-tu-nhien-va-an-toan.json': Object.freeze({
    policy: 'evidence_only',
    criterionIds: Object.freeze(['advisory.06.ordinary-dietary-preference']),
  }),
  '07-ca-nhan-hoa-va-loyalty.json': Object.freeze({
    policy: 'evidence_only',
    criterionIds: Object.freeze(['advisory.07.personalization-confirmation']),
  }),
  '10-so-sanh-mon-va-giai-thich.json': Object.freeze({
    policy: 'warning',
    criterionIds: Object.freeze([
      'advisory.10.verified-comparison',
      'advisory.10.non-spicy-recommendation',
    ]),
  }),
  '11-khau-vi-va-di-ung.json': Object.freeze({
    policy: 'warning',
    criterionIds: Object.freeze([
      'advisory.11.preference-evidence',
      'advisory.11.allergen-safety-boundary',
    ]),
  }),
});
const confirmationTriggers = new Set([
  'core_semantic_miss',
  'high_risk_safety_or_availability_miss',
]);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function expectedMatrixKeys() {
  return Array.from(
    { length: mandatoryLiveTextQualification.repetitions },
    (_unused, index) => index + 1,
  ).flatMap((repetition) =>
    mandatoryLiveTextQualification.providers.map(
      (provider) => `${provider}:${repetition}`,
    ),
  );
}

const executionIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function artifactPathFrom(manifestPath, artifactPath, label) {
  if (
    typeof artifactPath !== 'string' ||
    !artifactPath ||
    isAbsolute(artifactPath)
  ) {
    throw new Error(`${label} path must be relative`);
  }
  const base = resolve(dirname(manifestPath));
  const candidate = resolve(base, artifactPath);
  if (candidate !== base && !candidate.startsWith(`${base}${sep}`)) {
    throw new Error(`${label} escapes the artifact directory`);
  }
  return candidate;
}

export function qualificationSuiteName(provider, executionId, repetition) {
  return (
    `selected StateGraph live scenario replay ` +
    `[provider=${provider}] [execution=${executionId}] ` +
    `[repetition=${repetition}]`
  );
}

function assertOutcomeJudgment(value, label) {
  const judgment = assertObject(value, label);
  assertExactKeys(
    judgment,
    [
      'achievedOutcome',
      'missedExpectations',
      'passed',
      'rationale',
      'safetyIssues',
      'score',
    ],
    label,
  );
  if (
    typeof judgment.passed !== 'boolean' ||
    !Number.isInteger(judgment.score) ||
    judgment.score < 0 ||
    judgment.score > 100 ||
    !Array.isArray(judgment.missedExpectations) ||
    !Array.isArray(judgment.safetyIssues)
  ) {
    throw new Error(`${label} is invalid`);
  }
  assertSafeText(judgment.achievedOutcome, `${label} achievedOutcome`);
  assertSafeText(judgment.rationale, `${label} rationale`);
  for (const [index, text] of judgment.missedExpectations.entries()) {
    assertSafeText(text, `${label} missedExpectations ${index + 1}`);
  }
  for (const [index, text] of judgment.safetyIssues.entries()) {
    assertSafeText(text, `${label} safetyIssues ${index + 1}`);
  }
  return judgment;
}

function assertAdvisoryRecord(value, label, scenarioFile, provider) {
  const advisory = assertObject(value, label);
  assertExactKeys(
    advisory,
    [
      'criterionIds',
      'execution',
      'infrastructureError',
      'infrastructureExhausted',
      'outcomeJudgment',
      'policy',
      'semanticConfirmation',
      'status',
    ],
    label,
  );
  if (
    !Array.isArray(advisory.criterionIds) ||
    !advisoryPolicies.has(advisory.policy) ||
    !advisoryStatuses.has(advisory.status) ||
    !['completed', 'deferred', 'not_run'].includes(advisory.execution) ||
    typeof advisory.infrastructureExhausted !== 'boolean' ||
    (advisory.infrastructureError !== null &&
      typeof advisory.infrastructureError !== 'string')
  ) {
    throw new Error(
      `${label} advisory policy, status, or execution is invalid`,
    );
  }
  if (
    advisory.criterionIds.some(
      (id) =>
        typeof id !== 'string' || !/^advisory\.\d{2}\.[a-z0-9-]+$/u.test(id),
    ) ||
    new Set(advisory.criterionIds).size !== advisory.criterionIds.length
  ) {
    throw new Error(`${label} advisory criterion IDs are invalid`);
  }
  const expectedAdvisory = advisoryCriteriaByScenario[scenarioFile];
  if (
    expectedAdvisory
      ? advisory.policy !== expectedAdvisory.policy ||
        JSON.stringify(advisory.criterionIds) !==
          JSON.stringify(expectedAdvisory.criterionIds)
      : advisory.policy !== 'not_applicable' ||
        advisory.criterionIds.length !== 0
  ) {
    throw new Error(
      `${label} advisory criteria do not match the stable catalog`,
    );
  }

  const confirmation = assertObject(
    advisory.semanticConfirmation,
    `${label} semantic confirmation`,
  );
  assertExactKeys(
    confirmation,
    ['attempts', 'finalStatus', 'trigger', 'triggered'],
    `${label} semantic confirmation`,
  );
  if (
    !Number.isInteger(confirmation.attempts) ||
    confirmation.attempts < 0 ||
    confirmation.attempts > 2 ||
    typeof confirmation.triggered !== 'boolean' ||
    confirmation.finalStatus !== advisory.status ||
    (confirmation.triggered
      ? confirmation.attempts !== 2 ||
        !confirmationTriggers.has(confirmation.trigger)
      : confirmation.trigger !== null || confirmation.attempts > 1)
  ) {
    throw new Error(`${label} semantic confirmation is incoherent`);
  }

  if (advisory.policy === 'not_applicable') {
    if (
      advisory.execution !== 'not_run' ||
      advisory.status !== 'not_run' ||
      advisory.outcomeJudgment !== null ||
      advisory.infrastructureExhausted ||
      advisory.infrastructureError !== null ||
      confirmation.attempts !== 0
    ) {
      throw new Error(`${label} not-applicable advisory record is invalid`);
    }
    return;
  }
  if (provider === 'google') {
    if (
      advisory.execution !== 'deferred' ||
      advisory.status !== 'not_run' ||
      advisory.outcomeJudgment !== null ||
      advisory.infrastructureExhausted ||
      advisory.infrastructureError !== null ||
      confirmation.attempts !== 0
    ) {
      throw new Error(`${label} deferred Gemini advisory record is invalid`);
    }
    return;
  }
  if (advisory.execution !== 'completed' || advisory.status === 'not_run') {
    throw new Error(
      `${label} applicable OpenAI advisory execution is required`,
    );
  }
  if (advisory.status === 'inconclusive') {
    if (
      advisory.outcomeJudgment !== null ||
      !advisory.infrastructureExhausted ||
      typeof advisory.infrastructureError !== 'string' ||
      confirmation.attempts < 1
    ) {
      throw new Error(
        `${label} inconclusive infrastructure evidence is invalid`,
      );
    }
    assertSafeText(
      advisory.infrastructureError,
      `${label} infrastructure error`,
    );
    return;
  }
  if (
    advisory.infrastructureExhausted ||
    advisory.infrastructureError !== null ||
    confirmation.attempts < 1
  ) {
    throw new Error(`${label} advisory execution state is invalid`);
  }
  const judgment = assertOutcomeJudgment(
    advisory.outcomeJudgment,
    `${label} outcome judgment`,
  );
  if (advisory.status === 'passed') {
    if (
      !judgment.passed ||
      judgment.score <= 0 ||
      judgment.missedExpectations.length !== 0 ||
      judgment.safetyIssues.length !== 0
    ) {
      throw new Error(`${label} passed advisory judgment is contradictory`);
    }
    return;
  }
  if (
    advisory.status !== 'warning' ||
    judgment.passed ||
    judgment.score >= 100
  ) {
    throw new Error(`${label} warning advisory judgment is contradictory`);
  }
}

function assertExecutionAttestation(attestation, run, expectedGitSha) {
  const value = assertObject(attestation, 'live text execution attestation');
  assertExactKeys(
    value,
    [
      'advisoryCalibration',
      'agent',
      'artifactKind',
      'completedAt',
      'executionId',
      'gitSha',
      'inventory',
      'mode',
      'outcomeJudge',
      'provider',
      'repetition',
      'scenarios',
      'schemaVersion',
      'startedAt',
      'status',
    ],
    'live text execution attestation',
  );
  if (
    value.schemaVersion !== 3 ||
    value.artifactKind !== 'kfc-live-text-execution-attestation' ||
    value.status !== 'PASS' ||
    value.executionId !== run.executionId ||
    value.gitSha !== expectedGitSha ||
    value.provider !== run.provider ||
    value.repetition !== run.repetition ||
    value.mode !== 'text' ||
    value.startedAt !== run.startedAt ||
    value.completedAt !== run.completedAt
  ) {
    throw new Error('live text execution attestation identity mismatch');
  }
  assertIdentity(
    value.agent,
    profileByProvider[run.provider],
    'execution attestation agent',
  );
  const outcomeJudgeProvider = run.provider === 'openai' ? 'google' : 'openai';
  assertIdentity(
    value.outcomeJudge,
    profileByProvider[outcomeJudgeProvider],
    'execution attestation outcome judge',
  );
  const calibration = assertObject(
    value.advisoryCalibration,
    'execution attestation advisory calibration',
  );
  assertExactKeys(
    calibration,
    ['reviewStatus', 'status'],
    'execution attestation advisory calibration',
  );
  if (
    calibration.status !== 'draft' ||
    calibration.reviewStatus !== 'human_review_required'
  ) {
    throw new Error(
      'advisory calibration must remain draft and human_review_required',
    );
  }

  const inventory = assertInventory(
    value.inventory,
    'execution attestation inventory',
  );
  if (!Array.isArray(value.scenarios)) {
    throw new Error('execution attestation scenarios must be an array');
  }
  const scenarioFiles = [];
  let turnCount = 0;
  for (const rawScenario of value.scenarios) {
    const scenario = assertObject(
      rawScenario,
      'execution attestation scenario',
    );
    assertExactKeys(
      scenario,
      ['advisory', 'fileName', 'status', 'turns'],
      'execution attestation scenario',
    );
    if (
      typeof scenario.fileName !== 'string' ||
      !scenario.fileName.endsWith('.json') ||
      scenario.status !== 'PASS' ||
      !Array.isArray(scenario.turns) ||
      scenario.turns.length === 0
    ) {
      throw new Error(
        'execution attestation scenario hard status is ineligible',
      );
    }
    assertAdvisoryRecord(
      scenario.advisory,
      `execution attestation advisory ${scenario.fileName}`,
      scenario.fileName,
      run.provider,
    );
    for (const rawTurn of scenario.turns) {
      const turn = assertObject(rawTurn, 'execution attestation turn');
      assertExactKeys(
        turn,
        ['durationMs', 'id', 'softTargetMs', 'status', 'strictCutoffMs'],
        'execution attestation turn',
      );
      if (
        typeof turn.id !== 'string' ||
        !turn.id.startsWith(`${scenario.fileName}#`) ||
        turn.status !== 'PASS' ||
        !Number.isFinite(turn.durationMs) ||
        turn.durationMs < 0 ||
        turn.softTargetMs !== 10_000 ||
        turn.strictCutoffMs !== 30_000 ||
        turn.durationMs > turn.strictCutoffMs
      ) {
        throw new Error(
          'execution attestation turn duration, target, cutoff, or hard status is ineligible',
        );
      }
    }
    turnCount += scenario.turns.length;
    scenarioFiles.push(scenario.fileName);
  }
  if (
    new Set(scenarioFiles).size !== scenarioFiles.length ||
    scenarioFiles.length !== inventory.scenarioCount ||
    turnCount !== inventory.turnCount ||
    run.scenarioRuns !== inventory.scenarioCount ||
    run.turnEvaluations !== inventory.turnCount
  ) {
    throw new Error('execution attestation inventory source binding mismatch');
  }
  return { inventory, scenarioFiles };
}

function assertVitestReport(report, run, expectedScenarioFiles) {
  const provider = run.provider;
  const value = assertObject(report, `${provider} Vitest report`);
  const expected = expectedScenarioFiles.length;
  if (
    value.success !== true ||
    value.numTotalTests !== expected ||
    value.numPassedTests !== expected ||
    value.numFailedTests !== 0 ||
    value.numPendingTests !== 0 ||
    value.numTodoTests !== 0
  ) {
    throw new Error(
      `${provider} text replay report is not an exact ${expected}/${expected} pass`,
    );
  }
  if (!Array.isArray(value.testResults)) {
    throw new Error(`${provider} text replay report lacks test results`);
  }
  const assertions = value.testResults.flatMap((result) => {
    const candidate = assertObject(result, `${provider} test result`);
    if (!Array.isArray(candidate.assertionResults)) {
      throw new Error(`${provider} test result lacks assertion results`);
    }
    return candidate.assertionResults;
  });
  const expectedSuiteName = qualificationSuiteName(
    provider,
    run.executionId,
    run.repetition,
  );
  const passedTitles = assertions.map((assertion) => {
    const candidate = assertObject(assertion, `${provider} assertion`);
    if (
      candidate.status !== 'passed' ||
      !Array.isArray(candidate.ancestorTitles) ||
      JSON.stringify(candidate.ancestorTitles) !==
        JSON.stringify([expectedSuiteName])
    ) {
      throw new Error(
        `${provider} report contains ineligible assertion evidence`,
      );
    }
    return candidate.title;
  });
  const expectedTitles = expectedScenarioFiles.map(
    (fileName) => `${fileName} [text]`,
  );
  if (
    assertions.length !== expected ||
    JSON.stringify([...passedTitles].sort()) !==
      JSON.stringify([...expectedTitles].sort()) ||
    new Set(passedTitles).size !== expected
  ) {
    throw new Error(
      `${provider} report must contain all exact unique attested text scenarios`,
    );
  }
}

export function assertCleanQualificationSource(repositoryRoot, expectedGitSha) {
  const gitSha = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  }).trim();
  if (
    !/^[0-9a-f]{40}$/u.test(gitSha) ||
    (expectedGitSha !== undefined && gitSha !== expectedGitSha)
  ) {
    throw new Error('qualification source SHA mismatch');
  }
  const status = execFileSync(
    'git',
    ['status', '--porcelain=v1', '--untracked-files=all'],
    { cwd: repositoryRoot, encoding: 'utf8' },
  ).trim();
  if (status) {
    throw new Error('mandatory live qualification requires a clean checkout');
  }
  return gitSha;
}

export function assertQualificationProviderEnvironment(environment) {
  const configuredBaseUrl =
    typeof environment.OPENAI_BASE_URL === 'string'
      ? environment.OPENAI_BASE_URL.trim()
      : '';
  if (!configuredBaseUrl) return officialOpenAiQualificationBaseUrl;
  let parsed;
  try {
    parsed = new URL(configuredBaseUrl);
  } catch {
    throw new Error(
      'mandatory live qualification requires the official OpenAI endpoint',
    );
  }
  const normalizedPath = parsed.pathname.replace(/\/+$/u, '');
  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname !== 'api.openai.com' ||
    parsed.port ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    normalizedPath !== '/v1'
  ) {
    throw new Error(
      'mandatory live qualification requires the official OpenAI endpoint',
    );
  }
  return officialOpenAiQualificationBaseUrl;
}

export function assertQualificationEvidenceIsNotAdvisoryCalibrationDraft(
  value,
) {
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    value.artifact_kind === 'kfc-advisory-outcome-calibration'
  ) {
    throw new Error(
      'Advisory calibration draft is not qualification or release evidence',
    );
  }
}

export function assertLiveTextQualificationManifest(manifest, options) {
  assertQualificationEvidenceIsNotAdvisoryCalibrationDraft(manifest);
  const value = assertObject(manifest, 'live text qualification manifest');
  assertExactKeys(
    value,
    [
      'artifactKind',
      'completedAt',
      'gitSha',
      'inventory',
      'matrix',
      'runs',
      'schemaVersion',
      'status',
    ],
    'live text qualification manifest',
  );
  if (
    value.schemaVersion !== 3 ||
    value.artifactKind !== 'kfc-live-text-qualification' ||
    value.status !== 'PASS'
  ) {
    throw new Error('live text qualification manifest is not a PASS artifact');
  }
  if (
    typeof value.gitSha !== 'string' ||
    !/^[0-9a-f]{40}$/u.test(value.gitSha) ||
    value.gitSha !== options.expectedGitSha
  ) {
    throw new Error('live text qualification is not bound to the expected SHA');
  }

  const inventory = assertInventory(value.inventory, 'qualification inventory');
  const matrix = assertObject(value.matrix, 'qualification matrix');
  assertExactKeys(
    matrix,
    [
      'mode',
      'providers',
      'repetitions',
      'totalScenarioRuns',
      'totalTurnEvaluations',
    ],
    'qualification matrix',
  );
  if (
    matrix.mode !== mandatoryLiveTextQualification.mode ||
    JSON.stringify(matrix.providers) !==
      JSON.stringify(mandatoryLiveTextQualification.providers) ||
    matrix.repetitions !== mandatoryLiveTextQualification.repetitions ||
    !Number.isInteger(matrix.totalScenarioRuns) ||
    !Number.isInteger(matrix.totalTurnEvaluations)
  ) {
    throw new Error(
      'mandatory qualification must be OpenAI and Google text mode x3',
    );
  }

  if (!Array.isArray(value.runs)) {
    throw new Error('qualification runs must be an array');
  }
  const expectedKeys = expectedMatrixKeys();
  const actualKeys = [];
  const reportPaths = new Set();
  const reportDigests = new Set();
  const attestationPaths = new Set();
  const attestationDigests = new Set();
  const executionIds = new Set();
  let latestCompletion = 0;
  let totalScenarioRuns = 0;
  let totalTurnEvaluations = 0;
  for (const [index, rawRun] of value.runs.entries()) {
    const run = assertObject(rawRun, `qualification run ${index + 1}`);
    assertExactKeys(
      run,
      [
        'agent',
        'attestation',
        'completedAt',
        'executionId',
        'mode',
        'outcomeJudge',
        'provider',
        'report',
        'repetition',
        'scenarioRuns',
        'startedAt',
        'status',
        'turnEvaluations',
      ],
      `qualification run ${index + 1}`,
    );
    if (
      !mandatoryLiveTextQualification.providers.includes(run.provider) ||
      typeof run.executionId !== 'string' ||
      !executionIdPattern.test(run.executionId) ||
      !Number.isInteger(run.repetition) ||
      run.repetition < 1 ||
      run.repetition > mandatoryLiveTextQualification.repetitions ||
      run.mode !== mandatoryLiveTextQualification.mode ||
      run.status !== 'PASS' ||
      !Number.isInteger(run.scenarioRuns) ||
      run.scenarioRuns < 1 ||
      !Number.isInteger(run.turnEvaluations) ||
      run.turnEvaluations < 1
    ) {
      throw new Error(`qualification run ${index + 1} is ineligible`);
    }
    assertIdentity(
      run.agent,
      profileByProvider[run.provider],
      `qualification run ${index + 1} agent`,
    );
    const outcomeJudgeProvider =
      run.provider === 'openai' ? 'google' : 'openai';
    assertIdentity(
      run.outcomeJudge,
      profileByProvider[outcomeJudgeProvider],
      `qualification run ${index + 1} outcome judge`,
    );
    const startedAt = assertIsoTimestamp(
      run.startedAt,
      `qualification run ${index + 1} startedAt`,
    );
    const completedAt = assertIsoTimestamp(
      run.completedAt,
      `qualification run ${index + 1} completedAt`,
    );
    if (completedAt < startedAt) {
      throw new Error(`qualification run ${index + 1} ends before it starts`);
    }
    latestCompletion = Math.max(latestCompletion, completedAt);

    const attestationReference = assertObject(
      run.attestation,
      `qualification run ${index + 1} attestation`,
    );
    assertExactKeys(
      attestationReference,
      ['path', 'sha256'],
      `qualification run ${index + 1} attestation`,
    );
    const absoluteAttestationPath = artifactPathFrom(
      options.manifestPath,
      attestationReference.path,
      'qualification attestation',
    );
    const relativeAttestationPath = relative(
      dirname(resolve(options.manifestPath)),
      absoluteAttestationPath,
    );
    if (
      attestationPaths.has(relativeAttestationPath) ||
      typeof attestationReference.sha256 !== 'string' ||
      !/^[0-9a-f]{64}$/u.test(attestationReference.sha256)
    ) {
      throw new Error(
        'qualification attestation identity is invalid or duplicated',
      );
    }
    attestationPaths.add(relativeAttestationPath);
    const attestationBytes = readFileSync(absoluteAttestationPath);
    if (sha256(attestationBytes) !== attestationReference.sha256) {
      throw new Error('qualification attestation digest mismatch');
    }
    const attested = assertExecutionAttestation(
      JSON.parse(attestationBytes.toString('utf8')),
      run,
      value.gitSha,
    );
    if (
      attested.inventory.version !== inventory.version ||
      attested.inventory.digest !== inventory.digest ||
      attested.inventory.scenarioCount !== inventory.scenarioCount ||
      attested.inventory.turnCount !== inventory.turnCount
    ) {
      throw new Error('qualification inventory source binding mismatch');
    }

    const report = assertObject(
      run.report,
      `qualification run ${index + 1} report`,
    );
    assertExactKeys(
      report,
      ['path', 'sha256'],
      `qualification run ${index + 1} report`,
    );
    const absoluteReportPath = artifactPathFrom(
      options.manifestPath,
      report.path,
      'qualification report',
    );
    const relativeReportPath = relative(
      dirname(resolve(options.manifestPath)),
      absoluteReportPath,
    );
    if (
      reportPaths.has(relativeReportPath) ||
      typeof report.sha256 !== 'string' ||
      !/^[0-9a-f]{64}$/u.test(report.sha256)
    ) {
      throw new Error('qualification report identity is invalid or duplicated');
    }
    reportPaths.add(relativeReportPath);
    const reportBytes = readFileSync(absoluteReportPath);
    if (sha256(reportBytes) !== report.sha256) {
      throw new Error('qualification report digest mismatch');
    }
    assertVitestReport(
      JSON.parse(reportBytes.toString('utf8')),
      run,
      attested.scenarioFiles,
    );

    executionIds.add(run.executionId);
    reportDigests.add(report.sha256);
    attestationDigests.add(attestationReference.sha256);
    actualKeys.push(`${run.provider}:${run.repetition}`);
    totalScenarioRuns += run.scenarioRuns;
    totalTurnEvaluations += run.turnEvaluations;
  }
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    throw new Error(
      'live text qualification matrix is incomplete or reordered',
    );
  }
  if (
    executionIds.size !== expectedKeys.length ||
    reportDigests.size !== expectedKeys.length ||
    attestationDigests.size !== expectedKeys.length
  ) {
    throw new Error(
      'each qualification matrix execution requires distinct bound evidence',
    );
  }
  if (
    matrix.totalScenarioRuns !== totalScenarioRuns ||
    matrix.totalTurnEvaluations !== totalTurnEvaluations
  ) {
    throw new Error(
      'qualification matrix totals do not match attested evidence',
    );
  }
  const completedAt = assertIsoTimestamp(
    value.completedAt,
    'qualification completedAt',
  );
  if (completedAt < latestCompletion) {
    throw new Error('qualification completedAt precedes a matrix execution');
  }
  return value;
}

export function assertLiveTextQualificationManifestFile(
  manifestPath,
  expectedGitSha,
) {
  const absoluteManifestPath = resolve(manifestPath);
  const bytes = readFileSync(absoluteManifestPath);
  const manifest = assertLiveTextQualificationManifest(
    JSON.parse(bytes.toString('utf8')),
    { expectedGitSha, manifestPath: absoluteManifestPath },
  );
  return { manifest, manifestSha256: sha256(bytes) };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const [command, manifestPath, expectedGitSha] = process.argv.slice(2);
  if (command !== 'validate' || !manifestPath || !expectedGitSha) {
    throw new Error(
      'Usage: kfc-live-text-qualification.mjs validate <manifest> <git-sha>',
    );
  }
  const result = assertLiveTextQualificationManifestFile(
    manifestPath,
    expectedGitSha,
  );
  process.stdout.write(
    `${JSON.stringify({
      status: result.manifest.status,
      scenarioRuns: result.manifest.matrix.totalScenarioRuns,
      turnEvaluations: result.manifest.matrix.totalTurnEvaluations,
      manifestSha256: result.manifestSha256,
    })}\n`,
  );
}
