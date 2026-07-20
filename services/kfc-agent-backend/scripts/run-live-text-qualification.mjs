#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  assertLiveTextQualificationManifestFile,
  assertCleanQualificationSource,
  assertQualificationProviderEnvironment,
  mandatoryLiveTextQualification,
} from './lib/kfc-live-text-qualification.mjs';
import {
  resolveQualificationConcurrency,
  runQualificationJobs,
} from './lib/kfc-qualification-concurrency.mjs';

const backendDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(backendDir, '../..');
const repositoryEnv = join(repositoryRoot, '.env');
if (existsSync(repositoryEnv)) loadEnvFile(repositoryEnv);

const expectedGitSha =
  process.env.KFC_LIVE_TEXT_QUALIFICATION_EXPECTED_SHA?.trim() || undefined;
const openAiBaseUrl = assertQualificationProviderEnvironment(process.env);
// This must happen before creating any proof artifacts. Qualification evidence
// is release evidence, not a snapshot of an uncommitted working tree.
const gitSha = assertCleanQualificationSource(repositoryRoot, expectedGitSha);

const defaultRunId = `${new Date().toISOString().replaceAll(':', '-')}-${gitSha.slice(0, 12)}`;
const manifestPath = resolve(
  process.env.KFC_LIVE_TEXT_QUALIFICATION_ARTIFACT ??
    join(
      backendDir,
      'artifacts/live-text-qualification',
      defaultRunId,
      'manifest.json',
    ),
);
if (existsSync(manifestPath)) {
  throw new Error(`qualification manifest already exists: ${manifestPath}`);
}
const artifactDir = dirname(manifestPath);
const reportsDir = join(artifactDir, 'reports');
const attestationsDir = join(artifactDir, 'attestations');
if (existsSync(artifactDir) && readdirSync(artifactDir).length > 0) {
  throw new Error(
    `qualification artifact directory is not empty: ${artifactDir}`,
  );
}
mkdirSync(reportsDir, { recursive: true });
mkdirSync(attestationsDir, { recursive: true });

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function runVitest(reportPath, environment) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      'npx',
      [
        '--no-install',
        'vitest',
        'run',
        'test/scenarios/live-ai-scenario-replay.test.ts',
        '--reporter=json',
        `--outputFile=${reportPath}`,
      ],
      {
        cwd: backendDir,
        env: environment,
        stdio: 'inherit',
      },
    );
    child.once('error', rejectPromise);
    child.once('exit', (code, signal) => {
      if (code === 0 && signal === null) {
        resolvePromise();
        return;
      }
      rejectPromise(
        new Error(
          `live text replay failed with code=${String(code)} signal=${String(signal)}`,
        ),
      );
    });
  });
}

const jobs = Array.from(
  { length: mandatoryLiveTextQualification.repetitions },
  (_unused, index) => index + 1,
).flatMap((repetition) =>
  mandatoryLiveTextQualification.providers.map((provider) => {
    const verifierProvider = provider === 'openai' ? 'google' : 'openai';
    const executionId = randomUUID();
    return {
      executionId,
      provider,
      verifierProvider,
      repetition,
      reportPath: join(
        reportsDir,
        `${provider}-text-repetition-${repetition}-${executionId}.json`,
      ),
      attestationPath: join(
        attestationsDir,
        `${provider}-text-repetition-${repetition}-${executionId}.json`,
      ),
    };
  }),
);
const concurrency = resolveQualificationConcurrency(
  process.env,
  jobs.length,
);
process.stdout.write(
  `Mandatory text qualification concurrency: total=${concurrency.maximum} ` +
    `openai=${concurrency.providerMaximum.openai} ` +
    `google=${concurrency.providerMaximum.google}\n`,
);
const runs = await runQualificationJobs(
  jobs,
  concurrency,
  async ({
    executionId,
    provider,
    verifierProvider,
    repetition,
    reportPath,
    attestationPath,
  }) => {
    const agent = mandatoryLiveTextQualification.profileByProvider[provider];
    const verifier =
      mandatoryLiveTextQualification.profileByProvider[verifierProvider];
    process.stdout.write(
      `Running mandatory text qualification: provider=${provider} ` +
        `repetition=${repetition}/${mandatoryLiveTextQualification.repetitions}\n`,
    );
    await runVitest(reportPath, {
      ...process.env,
      RUN_LIVE_AI_SCENARIOS: '1',
      KFC_LIVE_QUALIFICATION: '1',
      KFC_AGENT_PROFILE_MODE: 'qualification',
      KFC_LIVE_QUALIFICATION_EXECUTION_ID: executionId,
      KFC_LIVE_QUALIFICATION_REPETITION: String(repetition),
      KFC_LIVE_QUALIFICATION_ATTESTATION_FILE: attestationPath,
      KFC_LIVE_QUALIFICATION_GIT_SHA: gitSha,
      KFC_LIVE_SCENARIO_MODE: 'text',
      KFC_AGENT_PROVIDER: provider,
      KFC_AGENT_MODEL: agent.model,
      OPENAI_BASE_URL: openAiBaseUrl,
      KFC_RESPONSE_VERIFIER_PROVIDER: verifierProvider,
      KFC_RESPONSE_VERIFIER_MODEL: verifier.model,
    });
    assertCleanQualificationSource(repositoryRoot, gitSha);
    const reportBytes = readFileSync(reportPath);
    const attestationBytes = readFileSync(attestationPath);
    const attestation = JSON.parse(attestationBytes.toString('utf8'));
    if (
      !attestation ||
      typeof attestation !== 'object' ||
      typeof attestation.startedAt !== 'string' ||
      typeof attestation.completedAt !== 'string'
    ) {
      throw new Error('live text execution attestation is malformed');
    }
    return {
      executionId,
      provider,
      repetition,
      mode: 'text',
      status: 'PASS',
      scenarioRuns:
        mandatoryLiveTextQualification.scenariosPerExecution,
      turnEvaluations:
        mandatoryLiveTextQualification.turnEvaluationsPerExecution,
      agent,
      verifier,
      report: {
        path: relative(artifactDir, reportPath),
        sha256: sha256(reportBytes),
      },
      attestation: {
        path: relative(artifactDir, attestationPath),
        sha256: sha256(attestationBytes),
      },
      startedAt: attestation.startedAt,
      completedAt: attestation.completedAt,
    };
  },
);

const manifest = {
  schemaVersion: 1,
  artifactKind: 'kfc-live-text-qualification',
  gitSha,
  inventory: {
    version: mandatoryLiveTextQualification.inventoryVersion,
    digest: mandatoryLiveTextQualification.inventoryDigest,
    scenarioCount:
      mandatoryLiveTextQualification.scenariosPerExecution,
    turnCount:
      mandatoryLiveTextQualification.turnEvaluationsPerExecution,
  },
  matrix: {
    mode: 'text',
    providers: mandatoryLiveTextQualification.providers,
    repetitions: mandatoryLiveTextQualification.repetitions,
    totalScenarioRuns:
      mandatoryLiveTextQualification.totalScenarioRuns,
    totalTurnEvaluations:
      mandatoryLiveTextQualification.totalTurnEvaluations,
  },
  runs,
  status: 'PASS',
  completedAt: new Date().toISOString(),
};
const temporaryManifestPath = `${manifestPath}.tmp`;
writeFileSync(
  temporaryManifestPath,
  `${JSON.stringify(manifest, null, 2)}\n`,
  { flag: 'wx' },
);
assertCleanQualificationSource(repositoryRoot, gitSha);
const validated = assertLiveTextQualificationManifestFile(
  temporaryManifestPath,
  gitSha,
);
assertCleanQualificationSource(repositoryRoot, gitSha);
renameSync(temporaryManifestPath, manifestPath);
assertCleanQualificationSource(repositoryRoot, gitSha);
process.stdout.write(
  `QUALIFIED mandatory live text matrix: ` +
    `${validated.manifest.matrix.totalScenarioRuns} scenario runs, ` +
    `${validated.manifest.matrix.totalTurnEvaluations} turn evaluations, ` +
    `manifest=${manifestPath}\n`,
);
