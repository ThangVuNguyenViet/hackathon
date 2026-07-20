#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const profileByProvider = Object.freeze({
  openai: Object.freeze({
    provider: 'openai',
    model: 'gpt-4.1-mini',
    profile: 'openai-gpt-4.1-mini-qualification',
  }),
  google: Object.freeze({
    provider: 'google',
    model: 'gemini-3.1-flash-lite',
    profile:
      'google-gemini-3.1-flash-lite-thinking-high-qualification',
  }),
});

export const officialOpenAiQualificationBaseUrl =
  'https://api.openai.com/v1';

const scenarioTurnIndexes = Object.freeze({
  '01-dat-mon-ro-rang-giao-hang.json': Object.freeze([1, 3, 5, 7, 9, 11]),
  '02-tu-van-combo-va-upsell.json': Object.freeze([1, 3, 5, 7, 9]),
  '03-ton-kho-dia-chi-va-cua-hang.json': Object.freeze([1, 3, 5, 7, 9]),
  '04-sau-khi-dat-don.json': Object.freeze([1, 3, 5, 7, 9, 11, 13, 15]),
  '05-khieu-nai-va-human-handoff.json': Object.freeze([1, 3, 5, 7, 9]),
  '06-ngon-ngu-tu-nhien-va-an-toan.json': Object.freeze([1, 3, 5, 7, 9, 11]),
  '07-ca-nhan-hoa-va-loyalty.json': Object.freeze([1, 3, 5, 7, 9]),
  '08-thanh-toan-loi-va-don-bat-thuong.json': Object.freeze([1, 3, 5, 7]),
  '09-phuong-thuc-thanh-toan.json': Object.freeze([1, 3]),
});

export const mandatoryLiveTextQualification = Object.freeze({
  inventoryVersion: '2026-07-20.1',
  inventoryDigest:
    '9684774444e7b844fab12de0da5b9530035aa8f8cf5b5c275fbebd68e2cb76d5',
  providers: Object.freeze(['openai', 'google']),
  repetitions: 3,
  mode: 'text',
  scenariosPerExecution: 9,
  turnEvaluationsPerExecution: 46,
  totalScenarioRuns: 54,
  totalTurnEvaluations: 276,
  scenarioFiles: Object.freeze([
    '01-dat-mon-ro-rang-giao-hang.json',
    '02-tu-van-combo-va-upsell.json',
    '03-ton-kho-dia-chi-va-cua-hang.json',
    '04-sau-khi-dat-don.json',
    '05-khieu-nai-va-human-handoff.json',
    '06-ngon-ngu-tu-nhien-va-an-toan.json',
    '07-ca-nhan-hoa-va-loyalty.json',
    '08-thanh-toan-loi-va-don-bat-thuong.json',
    '09-phuong-thuc-thanh-toan.json',
  ]),
  scenarioTurnIndexes,
  profileByProvider,
});

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function assertExactKeys(value, expected, label) {
  const keys = Object.keys(value).sort();
  const required = [...expected].sort();
  if (JSON.stringify(keys) !== JSON.stringify(required)) {
    throw new Error(`${label} has an invalid shape`);
  }
}

function assertIsoTimestamp(value, label) {
  if (
    typeof value !== 'string' ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new Error(`${label} must be a canonical ISO timestamp`);
  }
  return Date.parse(value);
}

function expectedMatrixKeys() {
  return mandatoryLiveTextQualification.providers.flatMap((provider) =>
    Array.from(
      { length: mandatoryLiveTextQualification.repetitions },
      (_unused, index) => `${provider}:${index + 1}`,
    ),
  );
}

function assertIdentity(value, expected, label) {
  const identity = assertObject(value, label);
  assertExactKeys(identity, ['model', 'profile', 'provider'], label);
  if (
    identity.provider !== expected.provider ||
    identity.model !== expected.model ||
    identity.profile !== expected.profile
  ) {
    throw new Error(`${label} does not match the repository-pinned profile`);
  }
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

function assertVitestReport(report, run) {
  const provider = run.provider;
  const value = assertObject(report, `${provider} Vitest report`);
  const expected = mandatoryLiveTextQualification.scenariosPerExecution;
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
  const passedTitles = assertions.map((assertion) => {
    const candidate = assertObject(assertion, `${provider} assertion`);
    return candidate.title;
  });
  const expectedSuiteName = qualificationSuiteName(
    provider,
    run.executionId,
    run.repetition,
  );
  const expectedTitles = mandatoryLiveTextQualification.scenarioFiles.map(
    (fileName) => `${fileName} [text]`,
  );
  if (
    assertions.length !== expected ||
    assertions.some((assertion) => {
      const candidate = assertObject(assertion, `${provider} assertion`);
      return candidate.status !== 'passed' ||
        !Array.isArray(candidate.ancestorTitles) ||
        JSON.stringify(candidate.ancestorTitles) !==
          JSON.stringify([expectedSuiteName]);
    }) ||
    JSON.stringify([...passedTitles].sort()) !==
      JSON.stringify([...expectedTitles].sort()) ||
    new Set(passedTitles).size !== expected
  ) {
    throw new Error(
      `${provider} report must contain all exact unique canonical text scenarios`,
    );
  }
}

function assertExecutionAttestation(attestation, run, expectedGitSha) {
  const value = assertObject(attestation, 'live text execution attestation');
  assertExactKeys(
    value,
    [
      'agent',
      'artifactKind',
      'completedAt',
      'executionId',
      'gitSha',
      'inventory',
      'mode',
      'provider',
      'repetition',
      'scenarios',
      'schemaVersion',
      'startedAt',
      'status',
      'verifier',
    ],
    'live text execution attestation',
  );
  if (
    value.schemaVersion !== 1 ||
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
  const verifierProvider =
    run.provider === 'openai' ? 'google' : 'openai';
  assertIdentity(
    value.agent,
    profileByProvider[run.provider],
    'execution attestation agent',
  );
  assertIdentity(
    value.verifier,
    profileByProvider[verifierProvider],
    'execution attestation verifier',
  );
  const inventory = assertObject(
    value.inventory,
    'execution attestation inventory',
  );
  assertExactKeys(
    inventory,
    ['digest', 'scenarioCount', 'turnCount', 'version'],
    'execution attestation inventory',
  );
  if (
    inventory.version !== mandatoryLiveTextQualification.inventoryVersion ||
    inventory.digest !== mandatoryLiveTextQualification.inventoryDigest ||
    inventory.scenarioCount !==
      mandatoryLiveTextQualification.scenariosPerExecution ||
    inventory.turnCount !==
      mandatoryLiveTextQualification.turnEvaluationsPerExecution
  ) {
    throw new Error('execution attestation inventory mismatch');
  }
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
      ['fileName', 'status', 'turns'],
      'execution attestation scenario',
    );
    if (
      typeof scenario.fileName !== 'string' ||
      scenario.status !== 'PASS' ||
      !Array.isArray(scenario.turns)
    ) {
      throw new Error('execution attestation scenario is ineligible');
    }
    const expectedTurnIds = (
      scenarioTurnIndexes[scenario.fileName] ?? []
    ).map((turnIndex) => `${scenario.fileName}#${turnIndex}`);
    const actualTurnIds = scenario.turns.map((rawTurn) => {
      const turn = assertObject(rawTurn, 'execution attestation turn');
      assertExactKeys(
        turn,
        ['id', 'status'],
        'execution attestation turn',
      );
      if (typeof turn.id !== 'string' || turn.status !== 'PASS') {
        throw new Error('execution attestation turn is ineligible');
      }
      return turn.id;
    });
    if (JSON.stringify(actualTurnIds) !== JSON.stringify(expectedTurnIds)) {
      throw new Error(
        `execution attestation turns mismatch for ${scenario.fileName}`,
      );
    }
    turnCount += actualTurnIds.length;
    scenarioFiles.push(scenario.fileName);
  }
  if (
    JSON.stringify([...scenarioFiles].sort()) !==
      JSON.stringify([...mandatoryLiveTextQualification.scenarioFiles].sort()) ||
    new Set(scenarioFiles).size !==
      mandatoryLiveTextQualification.scenariosPerExecution ||
    turnCount !== mandatoryLiveTextQualification.turnEvaluationsPerExecution
  ) {
    throw new Error(
      'execution attestation lacks the exact 9-scenario/46-turn inventory',
    );
  }
}

export function assertCleanQualificationSource(
  repositoryRoot,
  expectedGitSha,
) {
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
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
    },
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

export function assertLiveTextQualificationManifest(
  manifest,
  options,
) {
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
    value.schemaVersion !== 1 ||
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

  const inventory = assertObject(value.inventory, 'qualification inventory');
  assertExactKeys(
    inventory,
    ['digest', 'scenarioCount', 'turnCount', 'version'],
    'qualification inventory',
  );
  if (
    inventory.version !== mandatoryLiveTextQualification.inventoryVersion ||
    inventory.digest !== mandatoryLiveTextQualification.inventoryDigest ||
    inventory.scenarioCount !==
      mandatoryLiveTextQualification.scenariosPerExecution ||
    inventory.turnCount !==
      mandatoryLiveTextQualification.turnEvaluationsPerExecution
  ) {
    throw new Error('live text qualification inventory is not canonical');
  }

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
    matrix.totalScenarioRuns !==
      mandatoryLiveTextQualification.totalScenarioRuns ||
    matrix.totalTurnEvaluations !==
      mandatoryLiveTextQualification.totalTurnEvaluations
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
        'provider',
        'report',
        'repetition',
        'scenarioRuns',
        'startedAt',
        'status',
        'turnEvaluations',
        'verifier',
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
      run.scenarioRuns !==
        mandatoryLiveTextQualification.scenariosPerExecution ||
      run.turnEvaluations !==
        mandatoryLiveTextQualification.turnEvaluationsPerExecution
    ) {
      throw new Error(`qualification run ${index + 1} is ineligible`);
    }
    const verifierProvider =
      run.provider === 'openai' ? 'google' : 'openai';
    assertIdentity(
      run.agent,
      profileByProvider[run.provider],
      `qualification run ${index + 1} agent`,
    );
    assertIdentity(
      run.verifier,
      profileByProvider[verifierProvider],
      `qualification run ${index + 1} verifier`,
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
    assertVitestReport(JSON.parse(reportBytes.toString('utf8')), run);

    const attestation = assertObject(
      run.attestation,
      `qualification run ${index + 1} attestation`,
    );
    assertExactKeys(
      attestation,
      ['path', 'sha256'],
      `qualification run ${index + 1} attestation`,
    );
    const absoluteAttestationPath = artifactPathFrom(
      options.manifestPath,
      attestation.path,
      'qualification attestation',
    );
    const relativeAttestationPath = relative(
      dirname(resolve(options.manifestPath)),
      absoluteAttestationPath,
    );
    if (
      attestationPaths.has(relativeAttestationPath) ||
      typeof attestation.sha256 !== 'string' ||
      !/^[0-9a-f]{64}$/u.test(attestation.sha256)
    ) {
      throw new Error(
        'qualification attestation identity is invalid or duplicated',
      );
    }
    attestationPaths.add(relativeAttestationPath);
    const attestationBytes = readFileSync(absoluteAttestationPath);
    if (sha256(attestationBytes) !== attestation.sha256) {
      throw new Error('qualification attestation digest mismatch');
    }
    assertExecutionAttestation(
      JSON.parse(attestationBytes.toString('utf8')),
      run,
      value.gitSha,
    );
    executionIds.add(run.executionId);
    reportDigests.add(report.sha256);
    attestationDigests.add(attestation.sha256);
    actualKeys.push(`${run.provider}:${run.repetition}`);
  }
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    throw new Error('live text qualification matrix is incomplete or reordered');
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
    {
      expectedGitSha,
      manifestPath: absoluteManifestPath,
    },
  );
  return {
    manifest,
    manifestSha256: sha256(bytes),
  };
}

const invokedPath = process.argv[1]
  ? resolve(process.argv[1])
  : undefined;
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
