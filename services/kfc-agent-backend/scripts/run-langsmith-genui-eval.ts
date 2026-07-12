import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, RunTree } from 'langsmith';
import {
  evaluateGenUiProof,
  type GenUiProofManifest,
  type GenUiProofEvaluation,
  type GenUiScenarioExpectation,
} from '../src/evaluation/genUiProofEvaluator.js';

interface CapturePlan {
  scenarios: Array<{
    fileName: string;
    requiredWidgetKinds: string[];
    expectedWidgetsByUserTurn: Record<string, string>;
    acceptableWidgetsByUserTurn?: Record<string, string[]> | undefined;
  }>;
}

interface ScenarioScript {
  id: string;
  title: string;
  turns: Array<{
    index: number;
    speaker: 'User' | 'Bot';
    text: string;
    useCases?: string[] | undefined;
  }>;
}

interface CliOptions {
  manifestPath?: string | undefined;
  seedOnly: boolean;
}

const schemaVersion = 'kfc-genui-eval-v1';
const datasetName = 'kfc-genui-conversation-proof-v1';
const scriptDir = dirname(fileURLToPath(import.meta.url));
const backendRoot = resolve(scriptDir, '..');
const repoRoot = resolve(backendRoot, '../..');
const capturePlanPath = resolve(backendRoot, 'fixtures/genui-scenario-capture-plan.json');
const scenariosRoot = resolve(repoRoot, 'ai-talent-tracks/fnb/conversations');
const artifactRoot = resolve(repoRoot, 'artifacts/genui-live-proof');
const projectName = process.env["LANGSMITH_PROJECT"] ?? 'kfc-genui-live-proof';

const options = parseArgs(process.argv.slice(2));
const expectations = loadExpectations();
const client = process.env["LANGSMITH_API_KEY"]?.trim() ? new Client() : undefined;

if (options.seedOnly) {
  if (!client) throw new Error('LANGSMITH_API_KEY is required to seed the GenUI dataset');
  const seed = await seedDataset(client, expectations);
  console.log(JSON.stringify({ ok: true, action: 'seed', datasetName, ...seed }, null, 2));
  process.exit(0);
}

const manifestPath = resolve(options.manifestPath ?? latestManifestPath());
const manifest = readJson<GenUiProofManifest>(manifestPath);
const evaluation = evaluateGenUiProof(manifest, expectations);
const evaluationPath = resolve(manifest.artifactRoot, 'genui-evaluation.json');
writeFileSync(evaluationPath, `${JSON.stringify(evaluation, null, 2)}\n`, 'utf8');

if (client) await emitLangSmithEvaluation(client, evaluation, manifestPath, evaluationPath);

console.log(
  JSON.stringify(
    {
      ok: evaluation.passed,
      datasetName,
      schemaVersion,
      manifestPath,
      evaluationPath,
      scenarioCount: evaluation.scenarioCount,
      passedScenarioCount: evaluation.passedScenarioCount,
      langsmithTracing: Boolean(client),
    },
    null,
    2,
  ),
);

if (!evaluation.passed) process.exitCode = 1;

function parseArgs(args: string[]): CliOptions {
  const parsed: CliOptions = { seedOnly: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--seed-only') parsed.seedOnly = true;
    else if (arg === '--manifest') parsed.manifestPath = args[++index];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function loadExpectations(): GenUiScenarioExpectation[] {
  const plan = readJson<CapturePlan>(capturePlanPath);
  return plan.scenarios.map((scenarioPlan) => {
    const script = readJson<ScenarioScript>(resolve(scenariosRoot, scenarioPlan.fileName));
    return {
      scenarioId: script.id,
      requiredWidgetKinds: scenarioPlan.requiredWidgetKinds,
      turns: script.turns
        .filter((turn) => turn.speaker === 'User')
        .map((turn) => ({
          turnIndex: turn.index,
          text: turn.text,
          useCases: turn.useCases ?? [],
          expectedWidgetKind: scenarioPlan.expectedWidgetsByUserTurn[String(turn.index)] ?? 'chatTranscript',
          acceptableWidgetKinds: scenarioPlan.acceptableWidgetsByUserTurn?.[String(turn.index)],
        })),
    };
  });
}

function latestManifestPath(): string {
  if (!existsSync(artifactRoot)) throw new Error(`GenUI artifact root does not exist: ${artifactRoot}`);
  const manifests = readdirSync(artifactRoot, { recursive: true })
    .map((entry) => resolve(artifactRoot, String(entry)))
    .filter((path) => path.endsWith('/integration-test/manifest.json') && existsSync(path))
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);
  const latest = manifests[0];
  if (!latest) throw new Error(`No GenUI proof manifest found under ${artifactRoot}`);
  return latest;
}

async function seedDataset(
  langsmith: Client,
  scenarios: GenUiScenarioExpectation[],
): Promise<{ datasetUrl: string | null; created: string[]; skipped: string[] }> {
  const dataset = (await langsmith.hasDataset({ datasetName }))
    ? await langsmith.readDataset({ datasetName })
    : await langsmith.createDataset(datasetName, {
        description: 'KFC live customer-chat GenUI lifecycle expectations.',
        dataType: 'kv',
        metadata: { schemaVersion, owner: 'kfc-agent-backend' },
      });
  const existing = new Set<string>();
  for await (const example of langsmith.listExamples({ datasetId: dataset.id })) {
    const metadata = example.metadata as Record<string, unknown> | undefined;
    if (typeof metadata?.["scenarioId"] === 'string') existing.add(metadata["scenarioId"]);
  }

  const created: string[] = [];
  const skipped: string[] = [];
  for (const scenario of scenarios) {
    if (existing.has(scenario.scenarioId)) {
      skipped.push(scenario.scenarioId);
      continue;
    }
    await langsmith.createExample({
      dataset_id: dataset.id,
      inputs: { scenarioId: scenario.scenarioId, turns: scenario.turns },
      outputs: { requiredWidgetKinds: scenario.requiredWidgetKinds },
      metadata: { schemaVersion, scenarioId: scenario.scenarioId },
      split: 'golden',
    });
    created.push(scenario.scenarioId);
  }

  return {
    datasetUrl: await langsmith.getDatasetUrl({ datasetId: dataset.id }).catch(() => null),
    created,
    skipped,
  };
}

async function emitLangSmithEvaluation(
  langsmith: Client,
  evaluation: GenUiProofEvaluation,
  manifestPath: string,
  evaluationPath: string,
): Promise<void> {
  const commit = currentCommit();
  const root = new RunTree({
    name: `kfc-genui-proof-${evaluation.runId}`,
    run_type: 'chain',
    project_name: projectName,
    inputs: { runId: evaluation.runId, manifestPath },
    outputs: {
      passed: evaluation.passed,
      scenarioCount: evaluation.scenarioCount,
      passedScenarioCount: evaluation.passedScenarioCount,
    },
    metadata: {
      schemaVersion,
      datasetName,
      commit,
      manifestPath,
      evaluationPath,
      artifactRoot: evaluation.artifactRoot,
      plannerModel: process.env["OPENAI_TOOL_PLANNER_MODEL"],
      responseModel: process.env["OPENAI_RESPONSE_MODEL"],
    },
    tags: ['kfc-genui-proof', `commit:${commit}`, `schema:${schemaVersion}`],
  });
  await root.postRun();

  for (const scenario of evaluation.scenarios) {
    const child = root.createChild({
      name: `eval:genui:${scenario.scenarioId}`,
      run_type: 'chain',
      inputs: {
        scenarioId: scenario.scenarioId,
        expectedWidgetKinds: scenario.expectedWidgetKinds,
      },
      outputs: {
        scores: scenario.scores,
        failures: scenario.failures,
        observedWidgetKinds: scenario.observedWidgetKinds,
      },
      metadata: {
        schemaVersion,
        scenarioId: scenario.scenarioId,
        useCases: scenario.useCases,
        artifactPaths: scenario.artifactPaths,
      },
      tags: [
        'kfc-genui-proof',
        `scenario:${scenario.scenarioId}`,
        ...scenario.useCases.map((useCase) => `use-case:${useCase}`),
      ],
    });
    await child.postRun();
    await child.end({ scores: scenario.scores, failures: scenario.failures });
    await child.patchRun();
  }

  await root.end({
    passed: evaluation.passed,
    scenarioCount: evaluation.scenarioCount,
    passedScenarioCount: evaluation.passedScenarioCount,
    evaluationPath,
  });
  await root.patchRun();
  await langsmith.awaitPendingTraceBatches();
}

function currentCommit(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}
