import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Client, RunTree } from 'langsmith';
import {
  contextEvalCases,
  contextEvalDatasetName,
  contextEvalSchemaVersion,
  type ContextEvalCase,
} from '../src/evaluation/contextEvalCases.js';
import { evaluateContextCase } from '../src/evaluation/contextEvalRunner.js';
import { loadGeneratedFixtures } from '../src/fixtures/loadFixtures.js';

interface CliOptions {
  seedOnly: boolean;
  caseId?: string | undefined;
  category?: ContextEvalCase['inputs']['caseCategory'] | undefined;
  mode: 'deterministic' | 'live';
  experimentPrefix: string;
}

const projectName = process.env["LANGSMITH_PROJECT"] ?? 'kfc-agent-backend-local';
const reportRoot = resolve(
  process.cwd(),
  '../../.scratch/langsmith-context-prompt-optimization-wayfinder/assets/context-eval-runs',
);

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    seedOnly: false,
    mode: 'deterministic',
    experimentPrefix: 'context-eval',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--seed-only':
        options.seedOnly = true;
        break;
      case '--case':
        options.caseId = argv[++index];
        break;
      case '--category':
        options.category = argv[++index] as CliOptions['category'];
        break;
      case '--mode': {
        const mode = argv[++index];
        if (mode !== 'deterministic' && mode !== 'live') throw new Error(`Unsupported mode: ${mode}`);
        options.mode = mode;
        break;
      }
      case '--experiment-prefix':
        options.experimentPrefix = argv[++index] ?? options.experimentPrefix;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function selectedCases(options: CliOptions): ContextEvalCase[] {
  return contextEvalCases.filter((testCase) => {
    if (options.caseId && testCase.inputs.caseId !== options.caseId) return false;
    if (options.category && testCase.inputs.caseCategory !== options.category) return false;
    return true;
  });
}

function requireLangSmithApiKey(): void {
  if (!process.env["LANGSMITH_API_KEY"]?.trim()) {
    throw new Error('LANGSMITH_API_KEY is required for dataset seeding');
  }
}

async function ensureDataset(client: Client): Promise<{ datasetId: string; datasetUrl: string | null }> {
  const exists = await client.hasDataset({ datasetName: contextEvalDatasetName });
  const dataset = exists
    ? await client.readDataset({ datasetName: contextEvalDatasetName })
    : await client.createDataset(contextEvalDatasetName, {
        description: 'KFC chatbot golden cases for latest-message context relevance.',
        dataType: 'kv',
        metadata: {
          schemaVersion: contextEvalSchemaVersion,
          owner: 'kfc-agent-backend',
        },
      });
  const datasetUrl = await client.getDatasetUrl({ datasetId: dataset.id }).catch(() => null);
  return { datasetId: dataset.id, datasetUrl };
}

async function seedDataset(client: Client, cases: ContextEvalCase[]): Promise<{
  datasetId: string;
  datasetUrl: string | null;
  created: string[];
  skipped: string[];
}> {
  const { datasetId, datasetUrl } = await ensureDataset(client);
  const existingCaseIds = new Set<string>();

  for await (const example of client.listExamples({ datasetId })) {
    const metadata = example.metadata as Record<string, unknown> | undefined;
    if (typeof metadata?.["caseId"] === 'string') existingCaseIds.add(metadata["caseId"]);
  }

  const created: string[] = [];
  const skipped: string[] = [];
  for (const testCase of cases) {
    if (existingCaseIds.has(testCase.inputs.caseId)) {
      skipped.push(testCase.inputs.caseId);
      continue;
    }

    await client.createExample({
      dataset_id: datasetId,
      inputs: testCase.inputs,
      outputs: testCase.outputs,
      metadata: {
        schemaVersion: contextEvalSchemaVersion,
        caseId: testCase.inputs.caseId,
        caseCategory: testCase.inputs.caseCategory,
        contextPolicy: testCase.outputs.contextPolicy,
      },
      split: 'golden',
    });
    created.push(testCase.inputs.caseId);
  }

  return { datasetId, datasetUrl, created, skipped };
}

async function emitLangSmithEvalRun(input: {
  client: Client;
  result: Awaited<ReturnType<typeof evaluateContextCase>>;
  options: CliOptions;
  reportPath: string;
}): Promise<void> {
  const rootRun = new RunTree({
    name: `${input.options.experimentPrefix}-${input.options.mode}-${input.result.caseId}`,
    run_type: 'chain',
    project_name: projectName,
    inputs: {
      caseId: input.result.caseId,
      caseCategory: input.result.caseCategory,
      mode: input.options.mode,
    },
    outputs: {
      responseText: input.result.responseText,
      scores: input.result.scores,
    },
    metadata: {
      schemaVersion: contextEvalSchemaVersion,
      datasetName: contextEvalDatasetName,
      caseId: input.result.caseId,
      caseCategory: input.result.caseCategory,
      mode: input.options.mode,
      reportPath: input.reportPath,
    },
    tags: [
      'kfc-context-eval',
      `ctx-category:${input.result.caseCategory}`,
      `ctx-mode:${input.options.mode}`,
    ],
  });
  await rootRun.postRun();

  const evalRun = rootRun.createChild({
    name: `eval:context_relevance:${input.result.caseId}`,
    run_type: 'chain',
    inputs: { caseId: input.result.caseId },
    outputs: input.result.scores,
    metadata: {
      component: 'deterministic_context_evaluators',
      schemaVersion: contextEvalSchemaVersion,
    },
    tags: ['kfc-context-eval', 'deterministic-evaluator'],
  });
  await evalRun.postRun();
  await evalRun.end(input.result.scores);
  await evalRun.patchRun();
  await rootRun.end({ responseText: input.result.responseText, scores: input.result.scores, reportPath: input.reportPath });
  await rootRun.patchRun();
  await input.client.awaitPendingTraceBatches();
}

const options = parseArgs(process.argv.slice(2));
const cases = selectedCases(options);
if (cases.length === 0) {
  throw new Error('No context eval cases matched the provided filters');
}

const client = process.env["LANGSMITH_API_KEY"]?.trim() ? new Client() : undefined;

if (options.seedOnly) {
  requireLangSmithApiKey();
  const seedResult = await seedDataset(client ?? new Client(), cases);
  console.log(
    JSON.stringify(
      {
        ok: true,
        action: 'seed',
        datasetName: contextEvalDatasetName,
        datasetUrl: seedResult.datasetUrl,
        created: seedResult.created,
        skipped: seedResult.skipped,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const fixtures = await loadGeneratedFixtures(process.cwd());
const results = [];
const generatedAt = new Date().toISOString();
const reportPath = resolve(reportRoot, `context-eval-${Date.now()}.json`);

for (const testCase of cases) {
  const result = await evaluateContextCase({
    testCase,
    fixtures,
    mode: options.mode,
  });
  results.push(result);
}

const summary = {
  generatedAt,
  schemaVersion: contextEvalSchemaVersion,
  datasetName: contextEvalDatasetName,
  mode: options.mode,
  caseCount: results.length,
  passed: results.filter((result) => result.scores.context_relevance_pass).length,
  failed: results.filter((result) => !result.scores.context_relevance_pass).length,
  results,
};

await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

if (client) {
  for (const result of results) {
    await emitLangSmithEvalRun({ client, result, options, reportPath });
  }
}

console.log(
  JSON.stringify(
    {
      ok: summary.failed === 0,
      datasetName: contextEvalDatasetName,
      mode: options.mode,
      caseCount: summary.caseCount,
      passed: summary.passed,
      failed: summary.failed,
      reportPath,
      langsmithTracing: Boolean(client),
    },
    null,
    2,
  ),
);

if (summary.failed > 0) process.exit(1);
