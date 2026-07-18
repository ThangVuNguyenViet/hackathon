import { createHash } from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import {
  arenaCandidates,
  missingArenaCredentials,
  requestCostUsd,
  type ArenaCandidate,
  type PlannerRequestEvent,
} from '../src/evaluation/modelArena.js';

type Phase = 'smoke' | 'qualify' | 'full';
type LiveMode = 'genui' | 'text';

interface RunRecord {
  candidateId: string;
  phase: 'smoke' | 'qualify';
  repetition: number;
  mode: LiveMode;
  passed: number;
  failed: number;
  total: number;
  exitCode: number;
  tests: Array<{ name: string; status: string }>;
  requests: PlannerRequestEvent[];
  costUsd: number;
  p95RequestLatencyMs?: number;
  artifactDir: string;
  langsmith: {
    project: string;
    endpoint: string;
    traceRunId: string;
    evidencePath: string;
    rootRuns: Array<{ id: string; traceId: string }>;
  };
}

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

const requestedPhase = (argument('phase') ?? process.argv.slice(2).find((value) => !value.startsWith('--')) ?? 'full') as Phase;
if (!['smoke', 'qualify', 'full'].includes(requestedPhase)) {
  throw new Error('Usage: npm run eval:model-arena -- [smoke|qualify|full] [--candidates=id,id] [--output=path] [--seed=number]');
}
const requestedCandidateIds = argument('candidates')?.split(',').map((value) => value.trim()).filter(Boolean);
const selectedCandidates = requestedCandidateIds?.length
  ? requestedCandidateIds.map((id) => {
      const candidate = arenaCandidates.find((entry) => entry.id === id);
      if (!candidate) throw new Error(`Unknown arena candidate: ${id}`);
      return candidate;
    })
  : [...arenaCandidates];

const backendRoot = process.cwd();
const repoRoot = resolve(backendRoot, '../..');
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const outputRoot = resolve(argument('output') ?? join(repoRoot, 'artifacts/model-arena', runId));
const seed = Number(argument('seed') ?? 20260716);
if (!Number.isSafeInteger(seed)) throw new Error('--seed must be an integer');

const missing = [
  ...missingArenaCredentials(selectedCandidates),
  ...[
    ['LANGSMITH_API_KEY', process.env.LANGSMITH_API_KEY],
    ['LANGSMITH_PROJECT', process.env.LANGSMITH_PROJECT],
    ['LANGSMITH_ENDPOINT', process.env.LANGSMITH_ENDPOINT],
  ].filter(([, value]) => !value?.trim()).map(([name]) => name!),
];
if (missing.length > 0) {
  throw new Error(`Missing arena credentials or observability configuration: ${[...new Set(missing)].join(', ')}`);
}

function fileHash(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
}

function shuffled<T>(values: readonly T[], inputSeed: number): T[] {
  let state = inputSeed >>> 0;
  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const selected = Math.floor(random() * (index + 1));
    [result[index], result[selected]] = [result[selected]!, result[index]!];
  }
  return result;
}

function json(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

function percentile95(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1];
}

function corePlannerRequests(requests: readonly PlannerRequestEvent[]): PlannerRequestEvent[] {
  const core = requests.filter(({ component, networkErrorType }) =>
    component === 'tool planning' && networkErrorType !== 'superseded'
  );
  const finalByRequest = new Map<string, PlannerRequestEvent>();
  core.forEach((event, index) => {
    const key = event.requestId ?? `unidentified:${index}`;
    const current = finalByRequest.get(key);
    if (!current || event.attempt >= current.attempt) finalByRequest.set(key, event);
  });
  return [...finalByRequest.values()];
}

function collectTests(report: unknown): Array<{ name: string; status: string }> {
  if (!report || typeof report !== 'object' || !('testResults' in report) || !Array.isArray(report.testResults)) return [];
  return report.testResults.flatMap((suite) => {
    if (!suite || typeof suite !== 'object' || !('assertionResults' in suite) || !Array.isArray(suite.assertionResults)) {
      return [];
    }
    return suite.assertionResults.flatMap((test: unknown) => {
      if (!test || typeof test !== 'object') return [];
      const ancestorTitles = 'ancestorTitles' in test && Array.isArray(test.ancestorTitles)
        ? test.ancestorTitles
        : [];
      const title = 'title' in test ? test.title : undefined;
      const status = 'status' in test ? test.status : undefined;
      return [{
        name: [...ancestorTitles, title].filter(Boolean).join(' > '),
        status: String(status ?? 'unknown'),
      }];
    });
  });
}

function runCandidate(
  candidate: ArenaCandidate,
  phase: 'smoke' | 'qualify',
  repetition: number,
  mode: LiveMode,
): RunRecord {
  const artifactDir = join(outputRoot, 'runs', candidate.id, phase, mode, String(repetition));
  const reportPath = join(artifactDir, 'vitest.json');
  const requestsPath = join(artifactDir, 'requests.jsonl');
  const langsmithPath = join(artifactDir, 'langsmith.json');
  const logPath = join(artifactDir, 'run.log');
  const recordPath = join(artifactDir, 'record.json');
  const traceRunId = `${runId}:${candidate.id}:${phase}:${mode}:${repetition}`;
  mkdirSync(artifactDir, { recursive: true });
  if (existsSync(recordPath)) {
    const existing = json(recordPath) as Partial<RunRecord>;
    if (existing.langsmith?.traceRunId && existing.langsmith.rootRuns?.length && existsSync(langsmithPath)) {
      return existing as RunRecord;
    }
    throw new Error(`Existing arena record lacks required LangSmith evidence: ${recordPath}`);
  }

  const smoke = phase === 'smoke';
  const result = spawnSync('npx', [
    'vitest', 'run', 'test/scenarios/live-ai-scenario-replay.test.ts',
    '--maxConcurrency=2', '--reporter=json', `--outputFile=${reportPath}`,
  ], {
    cwd: backendRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      RUN_LIVE_AI_SCENARIOS: '1',
      KFC_ARENA_CANDIDATE: candidate.id,
      KFC_ARENA_MODE: mode,
      KFC_ARENA_SCENARIOS: smoke ? '01,06,08' : '',
      KFC_ARENA_INCLUDE_MODIFIER: smoke ? '1' : '0',
      KFC_ARENA_OUTPUT: requestsPath,
      KFC_ARENA_TRACE_RUN_ID: traceRunId,
    },
  });
  writeFileSync(logPath, `${result.stdout ?? ''}${result.stderr ?? ''}`);
  const report = existsSync(reportPath) ? json(reportPath) : {};
  const allTests = collectTests(report).filter(({ status }) => status !== 'pending');
  const tests = phase === 'qualify'
    ? allTests.filter(({ name }) => name.includes('satisfies planner and'))
    : allTests;
  const requests = existsSync(requestsPath)
    ? readFileSync(requestsPath, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as PlannerRequestEvent)
    : [];
  if (!existsSync(langsmithPath)) {
    throw new Error(`Arena run did not retain LangSmith evidence: ${langsmithPath}`);
  }
  const langsmith = json(langsmithPath) as {
    project: string;
    endpoint: string;
    traceRunId: string;
    rootRuns?: Array<{ id: string; traceId: string }>;
  };
  if (langsmith.traceRunId !== traceRunId || !langsmith.rootRuns?.length) {
    throw new Error(`Arena LangSmith correlation mismatch for ${artifactDir}`);
  }
  const record: RunRecord = {
    candidateId: candidate.id,
    phase,
    repetition,
    mode,
    passed: tests.filter(({ status }) => status === 'passed').length,
    failed: tests.filter(({ status }) => status === 'failed').length,
    total: tests.length,
    exitCode: result.status ?? 1,
    tests,
    requests,
    costUsd: requests.reduce((total, event) => total + requestCostUsd(event, candidate.price), 0),
    p95RequestLatencyMs: percentile95(requests.map(({ latencyMs }) => latencyMs)),
    artifactDir,
    langsmith: {
      project: langsmith.project,
      endpoint: langsmith.endpoint,
      traceRunId,
      evidencePath: langsmithPath,
      rootRuns: langsmith.rootRuns,
    },
  };
  writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

mkdirSync(outputRoot, { recursive: true });
writeFileSync(join(outputRoot, 'manifest.json'), `${JSON.stringify({
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  phase: requestedPhase,
  seed,
  gitSha: git(['rev-parse', 'HEAD']),
  gitStatus: git(['status', '--short']),
  hashes: {
    scenarioLedger: fileHash(join(backendRoot, 'test/scenarios/scenarioCoverageLedger.ts')),
    scenarioRunner: fileHash(join(backendRoot, 'src/scenarios/runner.ts')),
    planner: fileHash(join(backendRoot, 'src/llm/toolPlanner.ts')),
  },
  candidates: selectedCandidates,
  retryPolicy: 'three attempts for transient network errors; aborted and superseded requests are not retried',
  concurrency: 2,
  redaction: 'No prompts, credentials, private identifiers, or raw provider bodies are persisted.',
  observability: {
    required: true,
    provider: 'LangSmith',
    project: process.env.LANGSMITH_PROJECT,
    endpoint: process.env.LANGSMITH_ENDPOINT,
    correlationMetadataKey: 'probeRunId',
  },
}, null, 2)}\n`);

const records: RunRecord[] = [];
let survivors = [...selectedCandidates];
if (requestedPhase === 'smoke' || requestedPhase === 'full') {
  for (const candidate of shuffled(selectedCandidates, seed)) {
    records.push(runCandidate(candidate, 'smoke', 1, 'genui'));
  }
  survivors = selectedCandidates.filter((candidate) => {
    const run = records.find((record) => record.candidateId === candidate.id && record.phase === 'smoke');
    const requests = corePlannerRequests(run?.requests ?? []);
    return run?.exitCode === 0 && run.failed === 0 && requests.length > 0 && requests.every((event) =>
      event.outcome === 'success' && event.rawJsonValid && event.rawSchemaValid && event.normalizedSchemaValid,
    );
  });
}

if (requestedPhase === 'qualify' || requestedPhase === 'full') {
  for (let repetition = 1; repetition <= 3; repetition += 1) {
    for (const mode of ['genui', 'text'] as const) {
      for (const candidate of shuffled(survivors, seed + repetition)) {
        records.push(runCandidate(candidate, 'qualify', repetition, mode));
      }
    }
  }
}

interface CandidateSummary {
  candidateId: string;
  productionEligible: boolean;
  passed: number;
  failed: number;
  total: number;
  costUsd: number;
  effectiveCostPerPassUsd: number | null;
  p95RequestLatencyMs?: number;
  rawContractPass: boolean;
  reliabilityPass: boolean;
  latencyPass: boolean;
  eligible: boolean;
}

const qualificationRecords = records.filter(({ phase }) => phase === 'qualify');
const controlP95 = percentile95(
  qualificationRecords.filter(({ candidateId }) => candidateId === 'openai-gpt-4.1-mini')
    .flatMap(({ requests }) => requests.map(({ latencyMs }) => latencyMs)),
);
const summaries: CandidateSummary[] = selectedCandidates.map((candidate) => {
  const candidateRecords = qualificationRecords.filter(({ candidateId }) => candidateId === candidate.id);
  const requests = candidateRecords.flatMap(({ requests }) => requests);
  const passed = candidateRecords.reduce((total, record) => total + record.passed, 0);
  const failed = candidateRecords.reduce((total, record) => total + record.failed, 0);
  const total = candidateRecords.reduce((sum, record) => sum + record.total, 0);
  const costUsd = candidateRecords.reduce((sum, record) => sum + record.costUsd, 0);
  const p95RequestLatencyMs = percentile95(requests.map(({ latencyMs }) => latencyMs));
  const perScenario = new Map<string, number>();
  for (const record of candidateRecords) {
    for (const test of record.tests.filter(({ status }) => status === 'passed')) {
      const scenario = test.name.match(/(\d\d-[^ >]+)/)?.[1] ?? test.name;
      perScenario.set(scenario, (perScenario.get(scenario) ?? 0) + 1);
    }
  }
  const coreRequests = corePlannerRequests(requests);
  const rawContractPass = coreRequests.length > 0 && coreRequests.every((event) =>
    event.outcome === 'success' && event.rawJsonValid && event.rawSchemaValid && event.normalizedSchemaValid,
  );
  const reliabilityPass =
    candidateRecords.length === 6 &&
    candidateRecords.every(({ exitCode }) => exitCode === 0) &&
    total === 54 &&
    passed === 54 &&
    [...perScenario.values()].every((count) => count === 6);
  const latencyPass = p95RequestLatencyMs !== undefined && controlP95 !== undefined && p95RequestLatencyMs <= controlP95 * 1.25;
  return {
    candidateId: candidate.id,
    productionEligible: candidate.productionEligible,
    passed, failed, total, costUsd,
    effectiveCostPerPassUsd: passed > 0 ? costUsd / passed : null,
    p95RequestLatencyMs,
    rawContractPass, reliabilityPass, latencyPass,
    eligible: candidate.productionEligible && rawContractPass && reliabilityPass && latencyPass,
  };
});

const eligible = summaries.filter(({ eligible }) => eligible).sort((a, b) =>
  (a.effectiveCostPerPassUsd ?? Infinity) - (b.effectiveCostPerPassUsd ?? Infinity),
);
const control = summaries.find(({ candidateId }) => candidateId === 'openai-gpt-4.1-mini');
const arenaValid = control?.rawContractPass === true && control.reliabilityPass && control.latencyPass;
const provisionalWinner = arenaValid ? eligible[0]?.candidateId : undefined;
const reviewPath = join(outputRoot, 'review-results.json');
const productionPath = join(outputRoot, 'production-validation.json');
const reviewSchema = z.object({
  status: z.string(),
  controlPreferredByMajority: z.boolean().nullable(),
}).passthrough();
const productionSchema = z.object({
  status: z.string(),
  governanceApproved: z.boolean(),
  shadowTurns: z.number(),
  canaryPercent: z.number(),
  canaryTurns: z.number(),
  criticalViolations: z.number(),
  schemaRegressions: z.number(),
  errorRateDeltaPercentagePoints: z.number().nullable(),
  p95RatioToControl: z.number().nullable(),
  totalModelSavingsPercent: z.number().nullable(),
}).passthrough();
if (!existsSync(reviewPath)) writeFileSync(reviewPath, `${JSON.stringify({
  status: 'pending', requiredReviewers: 2, blindedCandidateIds: [], controlPreferredByMajority: null,
}, null, 2)}\n`);
if (!existsSync(productionPath)) writeFileSync(productionPath, `${JSON.stringify({
  status: 'pending', governanceApproved: false, shadowTurns: 0, canaryPercent: 10, canaryTurns: 0,
  criticalViolations: 0, schemaRegressions: 0, errorRateDeltaPercentagePoints: null,
  p95RatioToControl: null, totalModelSavingsPercent: null,
}, null, 2)}\n`);
const review = reviewSchema.parse(json(reviewPath));
const production = productionSchema.parse(json(productionPath));
const productionPassed = production.status === 'passed' && production.governanceApproved === true &&
  production.shadowTurns >= 100 && production.canaryPercent === 10 && production.canaryTurns >= 100 &&
  production.criticalViolations === 0 && production.schemaRegressions === 0 &&
  production.errorRateDeltaPercentagePoints !== null && production.errorRateDeltaPercentagePoints <= 1 &&
  production.p95RatioToControl !== null && production.p95RatioToControl <= 1.25 &&
  production.totalModelSavingsPercent !== null && production.totalModelSavingsPercent >= 25;
const finalWinner = provisionalWinner && review.status === 'passed' && review.controlPreferredByMajority === false && productionPassed
  ? provisionalWinner
  : 'openai-gpt-4.1-mini';
const summary = { phase: requestedPhase, seed, arenaValid, survivors: survivors.map(({ id }) => id), summaries, provisionalWinner, finalWinner };
writeFileSync(join(outputRoot, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
writeFileSync(join(outputRoot, 'summary.csv'), [
  'candidate,productionEligible,passed,total,costUsd,effectiveCostPerPassUsd,p95RequestLatencyMs,rawContractPass,reliabilityPass,latencyPass,eligible',
  ...summaries.map((item) => [item.candidateId, item.productionEligible, item.passed, item.total, item.costUsd,
    item.effectiveCostPerPassUsd ?? '', item.p95RequestLatencyMs ?? '', item.rawContractPass,
    item.reliabilityPass, item.latencyPass, item.eligible].join(',')),
].join('\n') + '\n');

writeFileSync(join(outputRoot, 'decision.md'), `# Model arena decision\n\n` +
  `Final winner: **${finalWinner}${finalWinner === 'openai-gpt-4.1-mini' ? ' (incumbent)' : ''}**.\n\n` +
  (provisionalWinner
    ? `Offline provisional winner: **${provisionalWinner}**. It cannot replace the incumbent until blinded review, governance, 100 shadow turns, 100 turns at a 10% canary, and at least 25% measured total-model savings pass.\n`
    : `No challenger has completed every offline hard gate.\n`) +
  `\nEvidence: [manifest](./manifest.json), [summary](./summary.json), [reviews](./review-results.json), [production validation](./production-validation.json).\n`);

console.log(JSON.stringify({ outputRoot, provisionalWinner, finalWinner, survivors: summary.survivors }, null, 2));
