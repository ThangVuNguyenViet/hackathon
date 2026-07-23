import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectLatestPassingRuns, type ProofRunSummary } from '../src/evaluation/genUiProofCatalog.js';
import {
  assertRuntimeBinding,
  type ProofRuntimeBinding,
} from '../src/proof/kfcGenUiDeployedProof.js';

interface CapturePlan {
  scenarios: Array<{ fileName: string }>;
}

interface ProofManifest {
  runId: string;
  generatedAt: string;
  passed: boolean;
  runtime: ProofRuntimeBinding;
  screenshots: ProofRunSummary['screenshots'];
}

interface ProofEvaluation {
  passed: boolean;
  scenarios: Array<{ scenarioId: string; failures: string[]; scores: Record<string, number> }>;
}

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(backendRoot, '../..');
const proofRoot = resolve(repoRoot, 'artifacts/genui-live-proof');
const plan = readJson<CapturePlan>(resolve(backendRoot, 'fixtures/genui-scenario-capture-plan.json'));
const requiredScenarioIds = plan.scenarios.map((scenario) => scenario.fileName.replace(/\.json$/, ''));
const outputRoot = resolve(proofRoot, 'consolidated');
const screenshotRoot = resolve(outputRoot, 'screenshots');

const candidates = readdirSync(proofRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== 'consolidated')
  .flatMap((entry) => loadPassingRuns(resolve(proofRoot, entry.name, 'integration-test')));
const selected = selectLatestPassingRuns(candidates, requiredScenarioIds);

mkdirSync(screenshotRoot, { recursive: true });
const scenarios = selected.map((run) => {
  const copiedScreenshots = run.screenshots
    .filter((screenshot) => screenshot.exists && existsSync(screenshot.path))
    .map((screenshot, index) => {
      const scenarioRoot = resolve(screenshotRoot, run.scenarioId);
      mkdirSync(scenarioRoot, { recursive: true });
      const destination = resolve(scenarioRoot, `${String(index + 1).padStart(2, '0')}_${basename(screenshot.path)}`);
      cpSync(screenshot.path, destination);
      return { ...screenshot, path: destination };
    });
  return { ...run, screenshots: copiedScreenshots };
});

const screenshotCount = scenarios.reduce((total, scenario) => total + scenario.screenshots.length, 0);
const consolidated = {
  schemaVersion: 'kfc-genui-consolidated-proof-v1',
  generatedAt: new Date().toISOString(),
  passed: scenarios.length === requiredScenarioIds.length,
  scenarioCount: scenarios.length,
  screenshotCount,
  runtime: selected[0]?.runtime,
  scenarios,
};
writeFileSync(resolve(outputRoot, 'manifest.json'), `${JSON.stringify(consolidated, null, 2)}\n`);
writeFileSync(resolve(outputRoot, 'catalog.md'), renderCatalog(consolidated));
console.log(JSON.stringify({ ...consolidated, scenarios: scenarios.map(({ scenarioId, runId, screenshots }) => ({ scenarioId, runId, screenshotCount: screenshots.length })) }, null, 2));

function loadPassingRuns(integrationRoot: string): ProofRunSummary[] {
  const manifestPath = resolve(integrationRoot, 'manifest.json');
  const evaluationPath = resolve(integrationRoot, 'genui-evaluation.json');
  if (!existsSync(manifestPath) || !existsSync(evaluationPath)) return [];
  const manifest = readJson<ProofManifest>(manifestPath);
  const evaluation = readJson<ProofEvaluation>(evaluationPath);
  if (!manifest.passed || !evaluation.passed) return [];
  assertRuntimeBinding(manifest.runtime);
  return evaluation.scenarios
    .filter((scenario) => scenario.failures.length === 0)
    .map((scenario) => ({
      runId: manifest.runId,
      generatedAt: manifest.generatedAt,
      scenarioId: scenario.scenarioId,
      manifestPath,
      evaluationPath,
      runtime: manifest.runtime,
      screenshots: manifest.screenshots.filter((screenshot) => screenshot.path.includes(scenario.scenarioId)),
    }));
}

function renderCatalog(bundle: typeof consolidated): string {
  const lines = [
    '# KFC Live GenUI Conversation Proof',
    '',
    `Generated: ${bundle.generatedAt}`,
    `Scenarios: ${bundle.scenarioCount}/${requiredScenarioIds.length}`,
    `Screenshots: ${bundle.screenshotCount}`,
    '',
  ];
  for (const scenario of bundle.scenarios) {
    lines.push(`## ${scenario.scenarioId}`, '', `Run: \`${scenario.runId}\``, '');
    for (const screenshot of scenario.screenshots) {
      const label = `Turn ${screenshot.turnIndex ?? 'action'} - ${screenshot.widgetKind}`;
      lines.push(`### ${label}`, '', `![${label}](${relative(outputRoot, screenshot.path)})`, '');
    }
  }
  return `${lines.join('\n')}\n`;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}
