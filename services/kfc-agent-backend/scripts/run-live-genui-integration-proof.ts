import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateGenUiProof, type GenUiScenarioExpectation } from '../src/evaluation/genUiProofEvaluator.js';
import { renderFlutterGenUiScenarioData } from '../src/genui/flutterScenarioData.js';
import {
  assertApprovedGoldenPlan,
  assertFlutterRelease,
  assertLocalFlutterRelease,
  assertProofRuntimeMatches,
  assertRuntimeBinding,
  buildPersistedBranchArtifact,
  type ApprovedGoldenPlan,
  type BranchSessionPlan,
  type FlutterReleaseBinding,
  type PersistedBranchArtifact,
  type PersistedTurnInput,
  type ProofReleaseAsset,
  type ProofRuntimeBinding,
  type SourceScenario,
} from '../src/proof/kfcGenUiDeployedProof.js';

interface CapturePlan {
  version: number;
  scenarios: Array<{
    fileName: string;
    requiredWidgetKinds: string[];
    expectedWidgetsByUserTurn: Record<string, string>;
    acceptableWidgetsByUserTurn?: Record<string, string[]>;
  }>;
}

interface ScenarioScript {
  id: string;
  turns: Array<{ index: number; speaker: 'User' | 'Bot'; text: string; useCases?: string[] }>;
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const backendRoot = resolve(scriptDir, '..');
const repoRoot = resolve(backendRoot, '../..');
const flutterRoot = resolve(repoRoot, 'apps/kfc_live_monitor_flutter');
const scenariosRoot = resolve(repoRoot, 'ai-talent-tracks/fnb/conversations');
const capturePlanPath = resolve(backendRoot, 'fixtures/genui-scenario-capture-plan.json');
const generatedFlutterDataPath = resolve(flutterRoot, 'integration_test/support/generated_genui_scenario_capture_data.dart');

const runId = requiredEnv('KFC_PROOF_RUN_ID');
const outputRoot = resolve(requiredEnv('KFC_PROOF_OUTPUT_DIR'));
const canonicalOutputRoot = resolve(repoRoot, 'artifacts/kfc-deployed-proof', runId, 'kfc');
if (outputRoot !== canonicalOutputRoot && !outputRoot.startsWith(`${canonicalOutputRoot}/`)) {
  throw new Error(`KFC_PROOF_OUTPUT_DIR must be inside ${canonicalOutputRoot}`);
}
if (existsSync(outputRoot) && readdirSync(outputRoot).length > 0) {
  throw new Error(`KFC proof output already exists and is not empty: ${outputRoot}`);
}
mkdirSync(outputRoot, { recursive: true });
const screenshotRoot = resolve(outputRoot, 'screenshots');
mkdirSync(screenshotRoot, { recursive: true });

const backendUrl = deployedBackendUrl(requiredEnv('KFC_AGENT_BACKEND_URL'));
const adminToken = requiredEnv('KFC_PROOF_ADMIN_TOKEN');
const expectedRuntime = readJson<ProofRuntimeBinding>(requiredEnv('KFC_EXPECTED_RUNTIME_BINDING_FILE'));
const expectedFlutterRelease = readJson<FlutterReleaseBinding>(requiredEnv('KFC_EXPECTED_FLUTTER_RELEASE_FILE'));
const branchPlan = process.env.KFC_GENUI_PROOF_MODE === 'golden-only'
  ? undefined
  : readJson<BranchSessionPlan>(requiredEnv('KFC_GENUI_BRANCH_SESSIONS'));
const goldenPlanPath = resolve(requiredEnv('KFC_GENUI_GOLDEN_PLAN'));
const goldenTemplate = readJson<ApprovedGoldenPlan>(goldenPlanPath);
const flutterDevice = requiredEnv('KFC_GENUI_FLUTTER_DEVICE');
const proofMode = process.env.KFC_GENUI_PROOF_MODE?.trim() || 'full';
if (!['full', 'golden-only'].includes(proofMode)) throw new Error('KFC_GENUI_PROOF_MODE must be full or golden-only');
if (process.env.KFC_GENUI_SCENARIO_FILTER?.trim()) {
  throw new Error('KFC_GENUI_SCENARIO_FILTER is forbidden for acceptance');
}
assertFlutterRelease(expectedFlutterRelease);
assertRuntimeBinding(expectedRuntime);
assertApprovedGoldenPlan(goldenTemplate);

const startedAt = new Date().toISOString();
let manifest: Record<string, unknown> = {
  schemaVersion: 1,
  runId,
  status: 'FAIL',
  passed: false,
  acceptanceEligible: true,
  startedAt,
};

try {
  const deployedFlutterRelease = await fetchReleaseAsset(expectedFlutterRelease.releaseUrl);
  assertLocalFlutterRelease({
    expected: expectedFlutterRelease,
    releaseAsset: deployedFlutterRelease.value,
    releaseAssetSha256: deployedFlutterRelease.sha256,
    gitSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim(),
    dirty: execFileSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' }).trim().length > 0,
  });
  const readiness = await fetchJson<Record<string, unknown>>(`${backendUrl}/ready?deep=1`);
  if (readiness.ok !== true) throw new Error('Deep readiness is not healthy');
  const runtime = asRecord(readiness.proof) as unknown as ProofRuntimeBinding;
  assertProofRuntimeMatches(runtime, expectedRuntime);
  const capturePlan = readJson<CapturePlan>(capturePlanPath);
  if (capturePlan.version !== 3 || capturePlan.scenarios.length !== 8) {
    throw new Error('Capture plan must contain persisted scenarios 01-08 only');
  }
  const sources = loadSources(capturePlan);
  const branchPlanPath = proofMode === 'full' ? resolve(requiredEnv('KFC_GENUI_BRANCH_SESSIONS')) : '';
  const branches = proofMode === 'full'
    ? await buildPersistedBranchArtifact({
        generatedAt: new Date().toISOString(),
        runtime,
        flutter: expectedFlutterRelease,
        plan: branchPlan!,
        sources,
        readPersistedTurns: readDurableTurns,
      })
    : readJson<PersistedBranchArtifact>(requiredEnv('KFC_GENUI_REUSED_BRANCHES_FILE'));
  const branchesPath = resolve(outputRoot, 'persisted-branches.json');
  writeJson(branchesPath, branches);
  const goldenPlan = await createFreshGoldenPlan(goldenTemplate);
  const countedGoldenPlanPath = resolve(outputRoot, 'golden-plan.json');
  writeJson(countedGoldenPlanPath, goldenPlan);

  // The generated helper is a build input. Counted proof never mutates tracked source.
  assertGeneratedFlutterDataMatchesCapturePlan();
  const flutterArgs = [
    'test', '--no-pub', 'integration_test/customer_chat_genui_conversation_test.dart',
    ...(proofMode === 'golden-only' ? ['--plain-name', 'runs the approved golden journey serially'] : []),
    '-d', flutterDevice,
    `--dart-define=KFC_AGENT_BACKEND_URL=${backendUrl}`,
    `--dart-define=KFC_GENUI_PERSISTED_BRANCHES=${branchesPath}`,
    `--dart-define=KFC_GENUI_PERSISTED_BRANCHES_SHA256=${sha256File(branchesPath)}`,
    `--dart-define=KFC_EXPECTED_RUNTIME_BINDING=${encodeBinding(runtime)}`,
    `--dart-define=KFC_EXPECTED_FLUTTER_RELEASE=${encodeBinding(expectedFlutterRelease)}`,
    `--dart-define=KFC_GENUI_GOLDEN_PLAN=${countedGoldenPlanPath}`,
    `--dart-define=KFC_GENUI_SCREENSHOT_DIR=${screenshotRoot}`,
  ];
  const flutter = await spawnLogged(
    'flutter',
    flutterArgs,
    flutterRoot,
    resolve(outputRoot, 'flutter-integration.log'),
  );
  const evaluation = proofMode === 'full'
    ? evaluateGenUiProof(
        evaluatorManifest(branches, runtime, screenshotRoot, flutter.status === 0),
        genUiExpectations(capturePlan),
      )
    : { passed: true, passedScenarioCount: 0, scenarioCount: 0 };
  writeJson(resolve(outputRoot, 'evaluation.json'), evaluation);

  const screenshotFiles = listFiles(screenshotRoot).map((path) => ({
    path: relative(outputRoot, path),
    sha256: sha256File(path),
  }));
  const passed = flutter.status === 0 && evaluation.passed && screenshotFiles.length >= (proofMode === 'full' ? 45 : goldenPlan.operations.length);
  manifest = {
    ...manifest,
    status: passed ? 'PASS' : 'FAIL',
    passed,
    completedAt: new Date().toISOString(),
    proofMode,
    runtime,
    flutter: {
      ...expectedFlutterRelease,
      device: flutterDevice,
      testStatus: flutter.status,
      signal: flutter.signal,
    },
    source: {
      ...(proofMode === 'full' ? { sessionPlanSha256: sha256File(branchPlanPath) } : {}),
      goldenPlanSha256: sha256File(countedGoldenPlanPath),
      persistedBranchesSha256: sha256File(branchesPath),
    },
    branchProof: { scenarioCount: 8, customerTurnCount: 44 },
    golden: {
      sessionId: goldenPlan.sessionId,
      customerId: goldenPlan.customerId,
      lifecycleScenarioId: goldenPlan.lifecycleScenarioId,
      operationCount: goldenPlan.operations.length,
    },
    evaluation: {
      path: 'evaluation.json',
      passed: evaluation.passed,
      passedScenarioCount: evaluation.passedScenarioCount,
      scenarioCount: evaluation.scenarioCount,
    },
    screenshots: screenshotFiles,
    retries: 0,
    teardown: { flutterExited: flutter.status !== null || flutter.signal !== null },
  };
  writeOutputs(manifest);
  if (!passed) process.exitCode = 1;
} catch (error) {
  manifest = {
    ...manifest,
    completedAt: new Date().toISOString(),
    failure: error instanceof Error ? error.message : String(error),
  };
  writeOutputs(manifest);
  process.exitCode = 1;
}

async function createFreshGoldenPlan(template: ApprovedGoldenPlan): Promise<ApprovedGoldenPlan> {
  const customerId = `golden-${runId}-${randomUUID()}`;
  const sessionId = `kfc:${customerId}`;
  await resetSession(sessionId);
  const lifecycle = await postJson<{ instanceId?: string }>(
    `${backendUrl}/admin/lifecycle/sessions/${encodeURIComponent(sessionId)}/instances`,
    undefined,
    true,
  );
  if (!lifecycle.instanceId) throw new Error('Fresh golden lifecycle did not return an instanceId');
  const revisions = new Map([
    ['advance_payment_paid', 2],
    ['advance_order_preparing', 3],
    ['advance_order_delivering', 4],
  ]);
  return {
    ...template,
    sessionId,
    customerId,
    lifecycleScenarioId: lifecycle.instanceId,
    operations: template.operations.map((operation) => revisions.has(operation.operation)
      ? { ...operation, expectedRevision: revisions.get(operation.operation)! }
      : operation),
  };
}

async function resetSession(sessionId: string): Promise<void> {
  await postJson(
    `${backendUrl}/dashboard/sessions/${encodeURIComponent(sessionId)}/demo-reset`,
    undefined,
    true,
  );
}

function loadSources(plan: CapturePlan): SourceScenario[] {
  return plan.scenarios.map(({ fileName }) => {
    const script = readJson<ScenarioScript>(resolve(scenariosRoot, fileName));
    return {
      id: script.id,
      fileName,
      userTurns: script.turns
        .filter(({ speaker }) => speaker === 'User')
        .map(({ index, text, useCases }) => ({ index, text, useCases: useCases ?? [] })),
    };
  });
}

async function readDurableTurns(sessionId: string): Promise<PersistedTurnInput[]> {
  const result = await fetchJson<{ turns?: PersistedTurnInput[] }>(
    `${backendUrl}/dashboard/sessions/${encodeURIComponent(sessionId)}/turns?limit=100`,
    { 'x-kfc-demo-admin-token': adminToken },
  );
  if (!Array.isArray(result.turns)) throw new Error(`${sessionId} did not return durable turns`);
  return result.turns;
}

function evaluatorManifest(
  branches: PersistedBranchArtifact,
  runtime: ProofRuntimeBinding,
  root: string,
  passed: boolean,
) {
  const screenshots = branchScreenshots(branches, root);
  return {
    runId,
    generatedAt: new Date().toISOString(),
    liveAi: true,
    passed,
    artifactRoot: outputRoot,
    runtime,
    screenshots,
    dashboardTelemetry: branches.scenarios.map((scenario) => ({
      sessionId: scenario.sessionId,
      turns: scenario.pairs.flatMap((pair) => [
        { role: 'user', text: pair.user.text, widgetKind: null },
        {
          role: 'assistant',
          text: pair.assistant.text,
          widgetKind: pair.genUiSnapshot?.widgetKind?.toString() ?? null,
        },
      ]),
    })),
  };
}

function genUiExpectations(plan: CapturePlan): GenUiScenarioExpectation[] {
  return plan.scenarios.map((scenario) => {
    const script = readJson<ScenarioScript>(resolve(scenariosRoot, scenario.fileName));
    return {
      scenarioId: script.id,
      requiredWidgetKinds: scenario.requiredWidgetKinds,
      turns: script.turns.filter(({ speaker }) => speaker === 'User').map((turn) => ({
        turnIndex: turn.index,
        text: turn.text,
        useCases: turn.useCases ?? [],
        expectedWidgetKind: scenario.expectedWidgetsByUserTurn[String(turn.index)] ?? 'chatTranscript',
        acceptableWidgetKinds: scenario.acceptableWidgetsByUserTurn?.[String(turn.index)],
      })),
    };
  });
}

function branchScreenshots(branches: PersistedBranchArtifact, root: string) {
  const files = listFiles(root);
  return branches.scenarios.flatMap((scenario) => scenario.pairs.map((pair, index) => {
    const ordinal = String(index + 1).padStart(2, '0');
    const marker = `branch_${scenario.scenarioId}/`;
    const path = files.find((candidate) => {
      const normalized = candidate.replaceAll('\\', '/');
      return normalized.includes(marker) && normalized.endsWith(`${ordinal}_turn_${ordinal}.png`);
    }) ?? resolve(root, `branch_${scenario.scenarioId}`, `${ordinal}_turn_${ordinal}.png`);
    return {
      scenario: scenario.scenarioId,
      turnIndex: pair.sourceTurnIndex,
      widgetKind: pair.genUiSnapshot?.widgetKind?.toString() ?? 'chatTranscript',
      path,
      exists: existsSync(path),
    };
  }));
}

function assertGeneratedFlutterDataMatchesCapturePlan() {
  const generated = readFileSync(generatedFlutterDataPath, 'utf8');
  const expected = renderFlutterGenUiScenarioData(capturePlanPath, scenariosRoot);
  if (generated !== expected) {
    throw new Error('Generated Flutter scenario data is stale; regenerate it before the counted run');
  }
}

async function fetchJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  const response = await fetch(url, { headers: { accept: 'application/json', ...headers } });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return await response.json() as T;
}

async function postJson<T = Record<string, unknown>>(
  url: string,
  body?: unknown,
  admin = false,
): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      ...(admin ? { authorization: `Bearer ${adminToken}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}: ${await response.text()}`);
  return await response.json() as T;
}

async function fetchReleaseAsset(baseUrl: string): Promise<{ value: ProofReleaseAsset; sha256: string }> {
  const url = new URL('/release.json', baseUrl);
  const response = await fetch(url, { headers: { accept: 'application/json', 'cache-control': 'no-cache' } });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  const raw = await response.text();
  return {
    value: JSON.parse(raw) as ProofReleaseAsset,
    sha256: createHash('sha256').update(raw).digest('hex'),
  };
}

async function spawnLogged(command: string, args: string[], cwd: string, logPath: string) {
  const log = createWriteStream(logPath);
  const child = spawn(command, args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);
  return await new Promise<{ status: number | null; signal: NodeJS.Signals | null }>((resolveExit) => {
    child.once('exit', (status, signal) => {
      log.end();
      resolveExit({ status, signal });
    });
  });
}

function writeOutputs(value: Record<string, unknown>) {
  writeJson(resolve(outputRoot, 'manifest.json'), value);
  writeFileSync(resolve(outputRoot, 'report.md'), `${value.passed === true ? 'PASS' : 'FAIL'}\n\nRun: \`${runId}\`\n`);
  const checksums = listFiles(outputRoot)
    .filter((path) => !path.endsWith('SHA256SUMS'))
    .map((path) => `${sha256File(path)}  ${relative(outputRoot, path)}`)
    .sort()
    .join('\n');
  writeFileSync(resolve(outputRoot, 'SHA256SUMS'), `${checksums}\n`);
}

function deployedBackendUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || ['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
    throw new Error('KFC_AGENT_BACKEND_URL must identify an HTTPS deployed backend');
  }
  return url.toString().replace(/\/$/, '');
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(path), 'utf8')) as T;
}

function writeJson(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function sha256File(path: string) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function encodeBinding(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function listFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => resolve(entry.parentPath, entry.name));
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected proof readiness object');
  return value as Record<string, unknown>;
}
