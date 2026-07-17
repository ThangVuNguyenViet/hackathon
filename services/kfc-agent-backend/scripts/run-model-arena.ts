import { createHash } from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  arenaCandidates,
  missingArenaCredentials,
  requestCostUsd,
  type ArenaCandidate,
  type PlannerRequestEvent,
} from '../src/evaluation/modelArena.js';

type Phase = 'smoke' | 'qualify' | 'full';

interface RunRecord {
  candidateId: string;
  phase: 'smoke' | 'qualify';
  repetition: number;
  passed: number;
  failed: number;
  total: number;
  exitCode: number;
  tests: Array<{ name: string; status: string }>;
  requests: PlannerRequestEvent[];
  costUsd: number;
  p95RequestLatencyMs?: number;
  artifactDir: string;
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

const missing = missingArenaCredentials(selectedCandidates);
if (missing.length > 0) {
  throw new Error(`Missing arena credentials: ${missing.join(', ')}`);
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

function json(path: string): any {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function percentile95(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.95) - 1];
}

function collectTests(report: any): Array<{ name: string; status: string }> {
  const suites = Array.isArray(report?.testResults) ? report.testResults : [];
  return suites.flatMap((suite: any) =>
    (Array.isArray(suite.assertionResults) ? suite.assertionResults : []).map((test: any) => ({
      name: [...(test.ancestorTitles ?? []), test.title].filter(Boolean).join(' > '),
      status: String(test.status ?? 'unknown'),
    })),
  );
}

function runCandidate(candidate: ArenaCandidate, phase: 'smoke' | 'qualify', repetition: number): RunRecord {
  const artifactDir = join(outputRoot, 'runs', candidate.id, phase, String(repetition));
  const reportPath = join(artifactDir, 'vitest.json');
  const requestsPath = join(artifactDir, 'requests.jsonl');
  const logPath = join(artifactDir, 'run.log');
  const recordPath = join(artifactDir, 'record.json');
  mkdirSync(artifactDir, { recursive: true });
  if (existsSync(recordPath)) return json(recordPath) as RunRecord;

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
      KFC_ARENA_MODE: 'genui',
      KFC_ARENA_SCENARIOS: smoke ? '01,06,08' : '',
      KFC_ARENA_INCLUDE_MODIFIER: smoke ? '1' : '0',
      KFC_ARENA_OUTPUT: requestsPath,
    },
  });
  writeFileSync(logPath, `${result.stdout ?? ''}${result.stderr ?? ''}`);
  const report = existsSync(reportPath) ? json(reportPath) : {};
  const tests = collectTests(report).filter(({ status }) => status !== 'pending');
  const requests = existsSync(requestsPath)
    ? readFileSync(requestsPath, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as PlannerRequestEvent)
    : [];
  const record: RunRecord = {
    candidateId: candidate.id,
    phase,
    repetition,
    passed: tests.filter(({ status }) => status === 'passed').length,
    failed: tests.filter(({ status }) => status === 'failed').length,
    total: tests.length,
    exitCode: result.status ?? 1,
    tests,
    requests,
    costUsd: requests.reduce((total, event) => total + requestCostUsd(event, candidate.price), 0),
    p95RequestLatencyMs: percentile95(requests.map(({ latencyMs }) => latencyMs)),
    artifactDir,
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
  retryPolicy: 'three attempts for network errors; all attempts retained in telemetry',
  concurrency: 2,
  redaction: 'No prompts, credentials, private identifiers, or raw provider bodies are persisted.',
}, null, 2)}\n`);

const records: RunRecord[] = [];
let survivors = [...selectedCandidates];
if (requestedPhase === 'smoke' || requestedPhase === 'full') {
  for (const candidate of shuffled(selectedCandidates, seed)) records.push(runCandidate(candidate, 'smoke', 1));
  survivors = selectedCandidates.filter((candidate) => {
    const run = records.find((record) => record.candidateId === candidate.id && record.phase === 'smoke');
    return run?.exitCode === 0 && run.failed === 0 && run.requests.every((event) =>
      event.outcome === 'success' && event.rawJsonValid && event.rawSchemaValid && event.normalizedSchemaValid,
    );
  });
}

if (requestedPhase === 'qualify' || requestedPhase === 'full') {
  for (let repetition = 1; repetition <= 3; repetition += 1) {
    for (const candidate of shuffled(survivors, seed + repetition)) {
      records.push(runCandidate(candidate, 'qualify', repetition));
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
  qualificationRecords.filter(({ candidateId }) => candidateId === 'openai-gpt-4.1')
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
  const rawContractPass = requests.length > 0 && requests.every((event) =>
    event.outcome === 'success' && event.rawJsonValid && event.rawSchemaValid && event.normalizedSchemaValid,
  );
  const reliabilityPass = total === 27 && passed >= 25 && [...perScenario.values()].every((count) => count >= 2);
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
const control = summaries.find(({ candidateId }) => candidateId === 'openai-gpt-4.1');
const arenaValid = control?.rawContractPass === true && control.reliabilityPass && control.latencyPass;
const provisionalWinner = arenaValid ? eligible[0]?.candidateId : undefined;
const reviewPath = join(outputRoot, 'review-results.json');
const productionPath = join(outputRoot, 'production-validation.json');
if (!existsSync(reviewPath)) writeFileSync(reviewPath, `${JSON.stringify({
  status: 'pending', requiredReviewers: 2, blindedCandidateIds: [], controlPreferredByMajority: null,
}, null, 2)}\n`);
if (!existsSync(productionPath)) writeFileSync(productionPath, `${JSON.stringify({
  status: 'pending', governanceApproved: false, shadowTurns: 0, canaryPercent: 10, canaryTurns: 0,
  criticalViolations: 0, schemaRegressions: 0, errorRateDeltaPercentagePoints: null,
  p95RatioToControl: null, totalModelSavingsPercent: null,
}, null, 2)}\n`);
const review = json(reviewPath);
const production = json(productionPath);
const productionPassed = production.status === 'passed' && production.governanceApproved === true &&
  production.shadowTurns >= 100 && production.canaryPercent === 10 && production.canaryTurns >= 100 &&
  production.criticalViolations === 0 && production.schemaRegressions === 0 &&
  production.errorRateDeltaPercentagePoints <= 1 && production.p95RatioToControl <= 1.25 &&
  production.totalModelSavingsPercent >= 25;
const finalWinner = provisionalWinner && review.status === 'passed' && review.controlPreferredByMajority === false && productionPassed
  ? provisionalWinner
  : 'openai-gpt-4.1';
const summary = { phase: requestedPhase, seed, arenaValid, survivors: survivors.map(({ id }) => id), summaries, provisionalWinner, finalWinner };
writeFileSync(join(outputRoot, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
writeFileSync(join(outputRoot, 'summary.csv'), [
  'candidate,productionEligible,passed,total,costUsd,effectiveCostPerPassUsd,p95RequestLatencyMs,rawContractPass,reliabilityPass,latencyPass,eligible',
  ...summaries.map((item) => [item.candidateId, item.productionEligible, item.passed, item.total, item.costUsd,
    item.effectiveCostPerPassUsd ?? '', item.p95RequestLatencyMs ?? '', item.rawContractPass,
    item.reliabilityPass, item.latencyPass, item.eligible].join(',')),
].join('\n') + '\n');

writeFileSync(join(outputRoot, 'decision.md'), `# Model arena decision\n\n` +
  `Final winner: **${finalWinner}${finalWinner === 'openai-gpt-4.1' ? ' (incumbent)' : ''}**.\n\n` +
  (provisionalWinner
    ? `Offline provisional winner: **${provisionalWinner}**. It cannot replace the incumbent until blinded review, governance, 100 shadow turns, 100 turns at a 10% canary, and at least 25% measured total-model savings pass.\n`
    : `No challenger has completed every offline hard gate.\n`) +
  `\nEvidence: [manifest](./manifest.json), [summary](./summary.json), [reviews](./review-results.json), [production validation](./production-validation.json).\n`);

console.log(JSON.stringify({ outputRoot, provisionalWinner, finalWinner, survivors: summary.survivors }, null, 2));
