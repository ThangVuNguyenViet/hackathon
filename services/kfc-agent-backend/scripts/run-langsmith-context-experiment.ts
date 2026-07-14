import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Client } from 'langsmith';
import { evaluate } from 'langsmith/evaluation';
import {
  contextEvalDatasetName,
  contextEvalSchemaVersion,
} from '../src/evaluation/contextEvalCases.js';
import { loadGeneratedFixtures } from '../src/fixtures/loadFixtures.js';
import {
  createContextExperimentEvaluator,
  createContextExperimentTarget,
  parseContextExperimentArgs,
  validateContextExperimentPrerequisites,
} from '../src/evaluation/contextLangsmithExperiment.js';

const reportRoot = resolve(
  process.cwd(),
  '../../.scratch/langsmith-context-prompt-optimization-wayfinder/assets/context-eval-runs',
);

function currentCommit(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function scoreValue(score: unknown): number {
  return score === true || score === 1 ? 1 : 0;
}

const options = parseContextExperimentArgs(process.argv.slice(2));
const apiKey = process.env.LANGSMITH_API_KEY;
if (!apiKey?.trim()) {
  validateContextExperimentPrerequisites({ apiKey, datasetExists: true });
}

const client = new Client({ apiKey });
const datasetExists = await client.hasDataset({ datasetName: contextEvalDatasetName });
validateContextExperimentPrerequisites({ apiKey, datasetExists });

const fixtures = await loadGeneratedFixtures(process.cwd());
const experimentResults = await evaluate(
  createContextExperimentTarget({
    fixtures,
    mode: options.mode,
  }),
  {
    data: contextEvalDatasetName,
    client,
    evaluators: [createContextExperimentEvaluator()],
    experimentPrefix: options.experimentPrefix,
    description: 'KFC context relevance evaluation using the native LangSmith experiment API.',
    metadata: {
      datasetName: contextEvalDatasetName,
      schemaVersion: contextEvalSchemaVersion,
      mode: options.mode,
      commit: currentCommit(),
      evaluator: 'deterministic_context_evaluators',
    },
  },
);

const scoreSummary: Record<string, { passed: number; failed: number; total: number }> = {};
let passed = 0;
let failed = 0;

for (const row of experimentResults.results) {
  const evaluationResults = row.evaluationResults.results;
  const overall = evaluationResults.find((result) => result.key === 'context_relevance_pass');
  if (scoreValue(overall?.score ?? overall?.value) === 1) passed += 1;
  else failed += 1;

  for (const result of evaluationResults) {
    const summary = (scoreSummary[result.key] ??= { passed: 0, failed: 0, total: 0 });
    summary.total += 1;
    if (scoreValue(result.score ?? result.value) === 1) summary.passed += 1;
    else summary.failed += 1;
  }
}

const summary = {
  generatedAt: new Date().toISOString(),
  experimentName: experimentResults.experimentName,
  datasetName: contextEvalDatasetName,
  schemaVersion: contextEvalSchemaVersion,
  mode: options.mode,
  caseCount: experimentResults.results.length,
  passed,
  failed,
  scores: scoreSummary,
  commit: currentCommit(),
};

const reportPath = resolve(reportRoot, `context-experiment-${Date.now()}.json`);
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({ ok: failed === 0, ...summary, reportPath }, null, 2));
if (failed > 0) process.exitCode = 1;
