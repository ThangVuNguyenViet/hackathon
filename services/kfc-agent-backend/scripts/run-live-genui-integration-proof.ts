import { spawn } from 'node:child_process';
import { cpSync, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import { Client } from 'langsmith';
import { buildServer } from '../src/api/server.js';
import { buildServerOptionsFromEnv } from '../src/api/serverOptions.js';
import { loadEnv } from '../src/config/env.js';
import { DashboardEventBus } from '../src/dashboard/eventBus.js';
import type { Order } from '../src/domain/types.js';
import { syncFlutterGenUiScenarioData } from '../src/genui/flutterScenarioData.js';
import { loadGeneratedFixtures } from '../src/fixtures/loadFixtures.js';
import { MemoryStore } from '../src/persistence/memoryStore.js';
import type { MockedUpstreamApiProfile } from '../src/mock/mockedUpstreamProfile.js';
import { liveScenarioFixtures } from '../test/scenarios/liveScenarioFixtures.js';

interface ExpectedScreenshot {
  scenario: string;
  widgetKind: string;
  file: string;
  turnIndex?: number;
  useCases?: string[];
  captureType?: 'userTurn' | 'genuiAction';
  actionId?: string;
}

interface ProofManifest {
  runId: string;
  passed: boolean;
  screenshots: Array<ExpectedScreenshot & { path: string; exists: boolean }>;
}

interface ScenarioCapturePlan {
  scenarios: Array<{
    fileName: string;
    requiredWidgetKinds: string[];
    expectedWidgetsByUserTurn: Record<string, string>;
  }>;
}

interface ScenarioScript {
  id: string;
  title: string;
  acceptance?: {
    noCartMutationBeforeUserTurn?: number;
    cartAfterUserTurn?: Record<string, {
      includedItems: Array<{ itemCode: string; quantity: number; unitPriceVnd?: number }>;
      totalVnd: number;
    }>;
    assistantAfterUserTurnContains?: Record<string, string[]>;
    finalCart?: {
      includedItems: Array<{ itemCode: string; quantity: number; unitPriceVnd?: number }>;
      excludedItemCodes: string[];
      totalVnd: number;
    };
  };
  turns: Array<{
    index: number;
    speaker: 'User' | 'Bot';
    text: string;
    useCases?: string[];
  }>;
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const backendRoot = resolve(scriptDir, '..');
const repoRoot = resolve(backendRoot, '../..');
const flutterRoot = resolve(repoRoot, 'apps/kfc_live_monitor_flutter');
const scenariosRoot = resolve(repoRoot, 'ai-talent-tracks/fnb/conversations');
const capturePlanPath = resolve(backendRoot, 'fixtures/genui-scenario-capture-plan.json');
const flutterScenarioDataPath = resolve(
  flutterRoot,
  'integration_test/support/generated_genui_scenario_capture_data.dart',
);
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const artifactRoot = resolve(repoRoot, 'artifacts/genui-live-proof', runId, 'integration-test');
const artifactScreenshotRoot = resolve(artifactRoot, 'screenshots');
const flutterDevice = process.env.KFC_GENUI_FLUTTER_DEVICE || 'macos';
const scenarioFilter = process.env.KFC_GENUI_SCENARIO_FILTER?.trim() ?? '';
const externalBackendUrl = process.env.KFC_AGENT_BACKEND_URL?.trim().replace(/\/$/, '') ?? '';
let backendUrl = externalBackendUrl;
let screenshotRoot = artifactScreenshotRoot;

const revalidateManifestPath = process.env.KFC_GENUI_REVALIDATE_MANIFEST?.trim();
if (revalidateManifestPath) {
  const sourcePath = resolve(revalidateManifestPath);
  const source = readJson<Record<string, unknown>>(sourcePath);
  const telemetry = Array.isArray(source.dashboardTelemetry) ? source.dashboardTelemetry : [];
  const screenshots = Array.isArray(source.screenshots)
    ? source.screenshots.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object'))
    : [];
  const missingScreenshots = screenshots
    .filter((entry) => entry.captureType !== 'genuiAction')
    .filter((entry) => typeof entry.path !== 'string' || !existsSync(entry.path))
    .map((entry) => String(entry.file ?? entry.path ?? 'unknown'));
  const acceptanceFailures = validateScenarioTelemetry(
    capturePlanPath,
    scenariosRoot,
    scenarioFilter,
    telemetry,
  );
  const integrationTest = source.integrationTest && typeof source.integrationTest === 'object'
    ? source.integrationTest as Record<string, unknown>
    : {};
  const passed = integrationTest.status === 0 && missingScreenshots.length === 0 && acceptanceFailures.length === 0;
  const revalidated = {
    ...source,
    revalidatedAt: new Date().toISOString(),
    revalidatedFrom: sourcePath,
    missingScreenshots,
    acceptanceFailures,
    passed,
    logs: [...(Array.isArray(source.logs) ? source.logs : []), `revalidatedFrom=${sourcePath}`],
  };
  const outputPath = resolve(dirname(sourcePath), 'revalidated-manifest.json');
  writeFileSync(outputPath, `${JSON.stringify(revalidated, null, 2)}\n`);
  console.log(JSON.stringify({ outputPath, passed, missingScreenshots, acceptanceFailures }, null, 2));
  process.exit(passed ? 0 : 1);
}

const dotenvCandidates = dotenvCandidatePaths(repoRoot);
for (const dotenvPath of dotenvCandidates) loadDotEnv(dotenvPath);
if (!process.env.OPENAI_API_KEY?.trim()) {
  throw new Error(`OPENAI_API_KEY is required. Checked: ${dotenvCandidates.join(', ')}`);
}

mkdirSync(artifactRoot, { recursive: true });
mkdirSync(artifactScreenshotRoot, { recursive: true });
syncFlutterGenUiScenarioData(capturePlanPath, scenariosRoot, flutterScenarioDataPath);

const customerChatScreenshots = buildCustomerChatScreenshotsFromCapturePlan(
  capturePlanPath,
  scenariosRoot,
  scenarioFilter,
);
if (customerChatScreenshots.length === 0) {
  throw new Error(`No GenUI scenarios matched KFC_GENUI_SCENARIO_FILTER=${scenarioFilter || '(empty)'}`);
}
const expectedScreenshots = customerChatScreenshots;

let integrationStatus: number | null = null;
let integrationSignal: NodeJS.Signals | null = null;
const integrationTargets = ['integration_test/customer_chat_genui_conversation_test.dart'];
const integrationRuns: Array<{
  target: string;
  status: number | null;
  signal: NodeJS.Signals | null;
}> = [];
const logs: string[] = [];
let dashboardTelemetry: unknown[] = [];
const existingExternalSessionIds = externalBackendUrl
  ? await listExternalIntegrationSessionIds(externalBackendUrl)
  : new Set<string>();

const env = loadEnv(process.env);
const baseOptions = buildServerOptionsFromEnv(env);
const store = new MemoryStore();
const dashboard = new DashboardEventBus();
const paidRecentOrder = paidOrder('KFC-1024');
const failedPaymentOrder = pendingPaymentOrder('KFC-MOCK-1001');
const loadedFixtures = await loadGeneratedFixtures(backendRoot);
const loyaltyScenarioFixtures = liveScenarioFixtures('07-ca-nhan-hoa-va-loyalty.json');
const deliveryScenarioFixtures = liveScenarioFixtures('03-ton-kho-dia-chi-va-cua-hang.json');
const integrationFixtures = loyaltyScenarioFixtures.transformFixtures?.(loadedFixtures) ?? loadedFixtures;
const loyaltyFavoriteItems = loyaltyScenarioFixtures.initialVerifiedState?.customerContext?.favorites ?? [];
const loyaltyRecentOrder = loyaltyScenarioFixtures.initialVerifiedState?.customerContext?.recentOrders[0] ?? paidRecentOrder;
const deliverySavedAddresses = deliveryScenarioFixtures.initialVerifiedState?.customerContext?.savedAddresses ?? [];
const overriddenMenuItems = integrationFixtures.menuItems.filter((item) => {
  const original = loadedFixtures.menuItems.find((candidate) => candidate.code === item.code);
  return !original || JSON.stringify(original) !== JSON.stringify(item);
});
const overriddenMenuModifiers = integrationFixtures.menuModifiers.filter((modifier) => {
  const original = loadedFixtures.menuModifiers.find((candidate) => candidate.itemCode === modifier.itemCode);
  return !original || JSON.stringify(original) !== JSON.stringify(modifier);
});
const mockedProfileFor = (customerId: string, turnIndex: number): MockedUpstreamApiProfile | undefined => {
  if (customerId.includes('03-ton-kho-dia-chi-va-cua-hang')) {
    return {
      savedAddresses: deliverySavedAddresses,
      ...(deliveryScenarioFixtures.mockedUpstreamApiForTurn?.(turnIndex) ?? {}),
    };
  }
  if (customerId.includes('04-sau-khi-dat-don')) {
    return {
      orders: [paidRecentOrder],
      recentOrderId: paidRecentOrder.id,
      paymentStatuses: { [paidRecentOrder.id]: 'paid' },
    };
  }
  if (customerId.includes('07-ca-nhan-hoa-va-loyalty')) {
    return {
      orders: [loyaltyRecentOrder],
      recentOrderId: loyaltyRecentOrder.id,
      favoriteItems: loyaltyFavoriteItems,
      menuItems: overriddenMenuItems,
      menuModifiers: overriddenMenuModifiers,
      paymentStatuses: { [loyaltyRecentOrder.id]: 'paid' },
    };
  }
  if (customerId.includes('08-thanh-toan-loi-va-don-bat-thuong')) {
    return {
      orders: [failedPaymentOrder],
      recentOrderId: failedPaymentOrder.id,
      paymentFailureOrderIds: [failedPaymentOrder.id],
    };
  }
  return undefined;
};
const server = externalBackendUrl ? undefined : buildServer({
  ...baseOptions,
  fixtures: integrationFixtures,
  store,
  dashboard,
  mockClientOptions: {
    ...baseOptions.mockClientOptions,
    initialOrders: [paidRecentOrder, failedPaymentOrder],
    recentOrderProvider: (customerId) => {
      if (customerId.includes('08-thanh-toan-loi-va-don-bat-thuong')) {
        return { ok: true, value: failedPaymentOrder, message: 'genui_integration_recent_failed_payment_order' };
      }
      if (customerId.includes('07-ca-nhan-hoa-va-loyalty')) {
        return { ok: true, value: loyaltyRecentOrder, message: 'genui_integration_recent_loyalty_order' };
      }
      if (customerId.includes('04-sau-khi-dat-don')) {
        return { ok: true, value: paidRecentOrder, message: 'genui_integration_recent_paid_order' };
      }
      return { ok: true, value: null, message: 'genui_integration_no_recent_order_precondition' };
    },
    favoriteItemsProvider: (customerId) => ({
      ok: true,
      value: customerId.includes('07-ca-nhan-hoa-va-loyalty') ? loyaltyFavoriteItems : [],
      message: customerId.includes('07-ca-nhan-hoa-va-loyalty')
        ? 'genui_integration_loyalty_favorites'
        : 'genui_integration_no_favorites',
    }),
    savedAddressesProvider: (customerId) => ({
      ok: true,
      value: customerId.includes('03-ton-kho-dia-chi-va-cua-hang') ? deliverySavedAddresses : [],
      message: customerId.includes('03-ton-kho-dia-chi-va-cua-hang')
        ? 'genui_integration_delivery_saved_addresses'
        : 'genui_integration_no_saved_addresses',
    }),
    orderStatusProvider: (orderId) => {
      if (orderId === paidRecentOrder.id) return { ok: true, value: paidRecentOrder, message: 'genui_integration_paid_order' };
      if (orderId === failedPaymentOrder.id) {
        return { ok: true, value: failedPaymentOrder, message: 'genui_integration_failed_payment_order' };
      }
      return { ok: false, errorCode: 'order_not_found', message: `Order ${orderId} was not found` };
    },
    paymentStatusProvider: (orderId) => {
      if (orderId === failedPaymentOrder.id) {
        return {
          ok: false,
          errorCode: 'payment_failed',
          message: 'genui_integration_payment_failed',
        };
      }
      return {
        ok: true,
        value: { status: 'paid' },
        message: 'genui_integration_payment_paid',
      };
    },
  },
  readiness: {
    database: async () => ({ ok: true }),
    openAiConfigured: true,
    openAiRequired: true,
  },
});
const externalProofProxy = externalBackendUrl
  ? buildExternalProofProxy({
      targetBaseUrl: externalBackendUrl,
      adminToken: requiredProofAdminToken(),
      mockedProfileFor,
    })
  : undefined;

try {
  if (externalProofProxy) {
    await externalProofProxy.listen({ host: '127.0.0.1', port: 0 });
    const address = externalProofProxy.server.address();
    if (!address || typeof address === 'string') throw new Error('Unable to resolve external proof proxy address');
    backendUrl = `http://127.0.0.1:${address.port}`;
    logs.push(`externalBackend=${externalBackendUrl}`);
    logs.push(`externalProofProxy=${backendUrl}`);
  } else if (server) {
    await server.listen({ host: '127.0.0.1', port: 0 });
    const address = server.server.address();
    if (!address || typeof address === 'string') throw new Error('Unable to resolve backend address');
    backendUrl = `http://127.0.0.1:${address.port}`;
    logs.push(`backend=${backendUrl}`);
  }
  logs.push(`flutterDevice=${flutterDevice}`);
  logs.push(`artifactScreenshotRoot=${artifactScreenshotRoot}`);
  if (scenarioFilter) logs.push(`scenarioFilter=${scenarioFilter}`);

  for (const [index, target] of integrationTargets.entries()) {
    const dartDefines = [
      ...(backendUrl ? [`--dart-define=KFC_AGENT_BACKEND_URL=${backendUrl}`] : []),
      ...(scenarioFilter ? [`--dart-define=KFC_GENUI_SCENARIO_FILTER=${scenarioFilter}`] : []),
    ];
    const integrationResult = await spawnLogged(
      'flutter',
      ['test', '--no-pub', target, '-d', flutterDevice, ...dartDefines],
      flutterRoot,
      `integration-test-${index + 1}.log`,
    );
    integrationRuns.push({
      target,
      status: integrationResult.status,
      signal: integrationResult.signal,
    });
    if (integrationStatus === null || integrationStatus === 0) {
      integrationStatus = integrationResult.status;
      integrationSignal = integrationResult.signal;
    }
    const runScreenshotRoot = screenshotRootFromLog(integrationResult.output) ?? artifactScreenshotRoot;
    if (existsSync(runScreenshotRoot) && runScreenshotRoot !== artifactScreenshotRoot) {
      cpSync(runScreenshotRoot, artifactScreenshotRoot, { recursive: true });
      screenshotRoot = artifactScreenshotRoot;
    }
  }
  dashboardTelemetry = server
    ? await collectDashboardTelemetry(server)
    : await collectDashboardTelemetryFromUrl(externalBackendUrl, existingExternalSessionIds);
} finally {
  await externalProofProxy?.close();
  await server?.close();
}

const missingScreenshots = expectedScreenshots.filter((entry) => !existsSync(resolve(screenshotRoot, entry.file)));
const actionScreenshots = discoverActionScreenshots(screenshotRoot);
const traceUrls = await collectLangSmithTraceUrls(env, dashboardTelemetry).catch((error) => {
  logs.push(`langsmithTraceLookup=${error instanceof Error ? error.message : String(error)}`);
  return [];
});
const acceptanceFailures = validateScenarioTelemetry(
  capturePlanPath,
  scenariosRoot,
  scenarioFilter,
  dashboardTelemetry,
);
const passed = integrationStatus === 0 && missingScreenshots.length === 0 && acceptanceFailures.length === 0;
const manifest = {
  runId,
  generatedAt: new Date().toISOString(),
  backendUrl: externalBackendUrl || backendUrl,
  ...(externalBackendUrl ? { integrationProxyUrl: backendUrl } : {}),
  liveAi: true,
  integrationTest: { status: integrationStatus, signal: integrationSignal, device: flutterDevice, targets: integrationRuns },
  artifactRoot,
  screenshots: [
    ...expectedScreenshots.map((entry) => ({
      ...entry,
      captureType: entry.captureType ?? 'userTurn',
      path: resolve(screenshotRoot, entry.file),
      exists: existsSync(resolve(screenshotRoot, entry.file)),
    })),
    ...actionScreenshots,
  ],
  missingScreenshots: missingScreenshots.map((entry) => entry.file),
  acceptanceFailures,
  dashboardTelemetry,
  traceUrls,
  passed,
  logs,
};

writeFileSync(resolve(artifactRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(resolve(artifactRoot, 'catalog.md'), renderCatalog(manifest));
console.log(JSON.stringify(manifest, null, 2));
if (!passed) process.exitCode = 1;

function buildCustomerChatScreenshotsFromCapturePlan(
  planPath: string,
  scenarioRoot: string,
  filter: string,
): ExpectedScreenshot[] {
  const plan = readJson<ScenarioCapturePlan>(planPath);
  const screenshots: ExpectedScreenshot[] = [];

  for (const scenarioPlan of plan.scenarios) {
    if (filter && !scenarioPlan.fileName.includes(filter)) continue;
    const script = readJson<ScenarioScript>(resolve(scenarioRoot, scenarioPlan.fileName));
    let captureIndex = 0;
    for (const turn of script.turns.filter((entry) => entry.speaker === 'User')) {
      captureIndex += 1;
      const expectedWidget = scenarioPlan.expectedWidgetsByUserTurn[String(turn.index)];
      const label = `turn_${String(turn.index).padStart(2, '0')}`;
      screenshots.push({
        scenario: script.id,
        turnIndex: turn.index,
        useCases: turn.useCases ?? [],
        widgetKind: expectedWidget ?? 'chatTranscript',
        file: `customer_chat_scenario_${script.id}/${String(captureIndex).padStart(2, '0')}_${safeLabel(label)}.png`,
      });
    }
  }

  return screenshots;
}

function discoverActionScreenshots(root: string): Array<ExpectedScreenshot & { path: string; exists: boolean }> {
  if (!existsSync(root)) return [];
  return readdirSync(root, { recursive: true })
    .map((entry) => String(entry))
    .filter((entry) => /(^|\/)action_[^/]+\.png$/.test(entry))
    .sort()
    .map((file) => {
      const normalized = file.replaceAll('\\', '/');
      const directory = normalized.split('/')[0] ?? '';
      const scenario = directory.replace(/^customer_chat_scenario_/, '');
      const name = normalized.split('/').at(-1) ?? normalized;
      const actionMatch = /_((?:accept_fulfillment|continue_to_fulfillment|confirm_order))_([a-zA-Z]+)\.png$/.exec(name);
      return {
        scenario,
        widgetKind: actionMatch?.[2] ?? 'unknown',
        captureType: 'genuiAction' as const,
        actionId: actionMatch?.[1],
        file: normalized,
        path: resolve(root, normalized),
        exists: true,
      };
    });
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function validateScenarioTelemetry(
  planPath: string,
  scenarioRoot: string,
  filter: string,
  telemetry: unknown[],
): string[] {
  const failures: string[] = [];
  const plan = readJson<ScenarioCapturePlan>(planPath);
  for (const entry of plan.scenarios.filter((scenario) => !filter || scenario.fileName.includes(filter))) {
    const script = readJson<ScenarioScript>(resolve(scenarioRoot, entry.fileName));
    const session = telemetry
      .filter((candidate): candidate is Record<string, unknown> => Boolean(candidate && typeof candidate === 'object'))
      .find((candidate) => String(candidate.sessionId ?? '').includes(script.id));
    if (!session || !Array.isArray(session.turns)) {
      failures.push(`${script.id}: telemetry session missing`);
      continue;
    }
    const turns = session.turns.filter((turn): turn is Record<string, unknown> => Boolean(turn && typeof turn === 'object'));
    const scriptedUserTurns = script.turns.filter((turn) => turn.speaker === 'User');
    const assistantAfterScriptedTurn = new Map<number, Record<string, unknown>>();
    let telemetryOffset = 0;
    for (const scriptedTurn of scriptedUserTurns) {
      const matchedUserOffset = turns.findIndex(
        (turn, index) => index >= telemetryOffset && turn.role === 'user' && turn.text === scriptedTurn.text,
      );
      if (matchedUserOffset < 0) {
        failures.push(`${script.id}: replayed user turn ${scriptedTurn.index} does not match source JSON`);
        continue;
      }
      const assistantOffset = turns.findIndex(
        (turn, index) => index > matchedUserOffset && turn.role === 'assistant',
      );
      if (assistantOffset >= 0) assistantAfterScriptedTurn.set(scriptedTurn.index, turns[assistantOffset]);
      telemetryOffset = matchedUserOffset + 1;
    }
    for (const scriptedTurn of scriptedUserTurns) {
      const expectedWidget = entry.expectedWidgetsByUserTurn[String(scriptedTurn.index)];
      if (!expectedWidget) continue;
      const actualWidget = assistantAfterScriptedTurn.get(scriptedTurn.index)?.widgetKind ?? 'chatTranscript';
      if (actualWidget !== expectedWidget) {
        failures.push(`${script.id}: turn ${scriptedTurn.index} widget ${String(actualWidget)} != ${expectedWidget}`);
      }
    }

    const acceptance = script.acceptance;
    if (!acceptance) continue;
    if (acceptance.noCartMutationBeforeUserTurn !== undefined) {
      const earlyCarts = scriptedUserTurns
        .filter((turn) => turn.index < acceptance.noCartMutationBeforeUserTurn!)
        .map((turn) => assistantAfterScriptedTurn.get(turn.index))
        .filter((turn): turn is Record<string, unknown> => Boolean(turn))
        .map(cartFromTelemetryTurn)
        .filter((cart): cart is Record<string, unknown> => Boolean(cart));
      if (earlyCarts.some((cart) => Array.isArray(cart.items) && cart.items.length > 0)) {
        failures.push(`${script.id}: cart mutated before user turn ${acceptance.noCartMutationBeforeUserTurn}`);
      }
    }
    for (const [userTurnIndex, expectedCart] of Object.entries(acceptance.cartAfterUserTurn ?? {})) {
      const assistant = assistantAfterScriptedTurn.get(Number(userTurnIndex));
      const cart = assistant ? cartFromTelemetryTurn(assistant) : undefined;
      const cartItems = cart && Array.isArray(cart.items)
        ? cart.items.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
        : [];
      for (const expected of expectedCart.includedItems) {
        const actual = cartItems.find((item) => item.itemCode === expected.itemCode);
        if (!actual || actual.quantity !== expected.quantity) {
          failures.push(`${script.id}: cart after turn ${userTurnIndex} missing ${expected.quantity} x ${expected.itemCode}`);
        }
      }
      if (!cart || cart.totalVnd !== expectedCart.totalVnd) {
        failures.push(`${script.id}: cart total after turn ${userTurnIndex} is not ${expectedCart.totalVnd}`);
      }
    }
    for (const [userTurnIndex, fragments] of Object.entries(acceptance.assistantAfterUserTurnContains ?? {})) {
      const assistantText = String(assistantAfterScriptedTurn.get(Number(userTurnIndex))?.text ?? '');
      for (const fragment of fragments) {
        if (!assistantText.includes(fragment)) {
          failures.push(`${script.id}: assistant after turn ${userTurnIndex} omitted ${fragment}`);
        }
      }
    }
    if (acceptance.finalCart) {
      const finalCart = [...turns].reverse().map(cartFromTelemetryTurn).find(Boolean);
      if (!finalCart) {
        failures.push(`${script.id}: final cart missing`);
        continue;
      }
      const finalItems = Array.isArray(finalCart.items)
        ? finalCart.items.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
        : [];
      for (const expected of acceptance.finalCart.includedItems) {
        const actual = finalItems.find((item) => item.itemCode === expected.itemCode);
        if (!actual || actual.quantity !== expected.quantity ||
            (expected.unitPriceVnd !== undefined && actual.unitPriceVnd !== expected.unitPriceVnd)) {
          failures.push(`${script.id}: final cart missing ${expected.quantity} x ${expected.itemCode}`);
        }
      }
      if (acceptance.finalCart.excludedItemCodes.some((code) => finalItems.some((item) => item.itemCode === code))) {
        failures.push(`${script.id}: final cart retains excluded individual items`);
      }
      if (finalCart.totalVnd !== acceptance.finalCart.totalVnd) {
        failures.push(`${script.id}: final total ${String(finalCart.totalVnd)} != ${acceptance.finalCart.totalVnd}`);
      }
    }
  }
  return failures;
}

function cartFromTelemetryTurn(turn: Record<string, unknown>): Record<string, unknown> | undefined {
  if (turn.cart && typeof turn.cart === 'object') return turn.cart as Record<string, unknown>;
  const metadata = turn.metadata;
  if (!metadata || typeof metadata !== 'object') return undefined;
  const genUi = (metadata as Record<string, unknown>).genUi;
  if (!genUi || typeof genUi !== 'object') return undefined;
  const data = (genUi as Record<string, unknown>).data;
  if (!data || typeof data !== 'object') return undefined;
  const cart = (data as Record<string, unknown>).cart;
  return cart && typeof cart === 'object' ? cart as Record<string, unknown> : undefined;
}

async function collectLangSmithTraceUrls(
  appEnv: ReturnType<typeof loadEnv>,
  telemetry: unknown[],
): Promise<Array<{ sessionId: string; runId: string; url: string }>> {
  if (!appEnv.LANGSMITH_API_KEY) return [];
  const sessionIds = telemetry
    .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object'))
    .map((entry) => String(entry.sessionId ?? ''))
    .filter(Boolean);
  if (sessionIds.length === 0) return [];
  const client = new Client({ apiKey: appEnv.LANGSMITH_API_KEY, apiUrl: appEnv.LANGSMITH_ENDPOINT });
  const traces: Array<{ sessionId: string; runId: string; url: string }> = [];
  for (let attempt = 1; attempt <= 3 && traces.length === 0; attempt += 1) {
    for await (const run of client.listRuns({ projectName: appEnv.LANGSMITH_PROJECT, executionOrder: 1, limit: 100 })) {
      const sessionId = typeof run.inputs?.sessionId === 'string' ? run.inputs.sessionId : '';
      if (!sessionIds.includes(sessionId)) continue;
      traces.push({ sessionId, runId: run.id, url: await client.getRunUrl({ runId: run.id }) });
    }
    if (traces.length === 0 && attempt < 3) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 1000));
    }
  }
  return traces.sort((left, right) => left.sessionId.localeCompare(right.sessionId));
}

function safeLabel(label: string): string {
  const safe = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  return safe || 'screen';
}

function loadDotEnv(path: string): void {
  if (!existsSync(path)) return;
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue.replace(/^['"]|['"]$/g, '');
  }
}

function dotenvCandidatePaths(root: string): string[] {
  const candidates = [resolve(root, '.env')];
  const marker = '/.worktrees/';
  const markerIndex = root.indexOf(marker);
  if (markerIndex >= 0) {
    candidates.push(resolve(root.slice(0, markerIndex), '.env'));
  }
  return [...new Set(candidates)];
}

function paidOrder(id: string): Order {
       return {
    id,
    status: 'preparing',
    paymentStatus: 'paid',
    assignedStoreId: 'store_kfc_nguyen_thi_minh_khai',
    createdAt: '2026-07-09T09:00:00.000Z',
    cart: {
      id: `cart_${id}`,
      items: [
        {
          itemCode: '20751',
          name: 'Combo Hợp Gu 99K',
          quantity: 1,
          unitPriceVnd: 99000,
        },
        {
          itemCode: '41074',
          name: 'Pepsi (Tiêu Chuẩn)',
          quantity: 1,
          unitPriceVnd: 13000,
        },
      ],
      subtotalVnd: 112000,
      discountVnd: 0,
      deliveryFeeVnd: 18000,
      totalVnd: 130000,
      voucherCode: null,
    },
  };
}

function pendingPaymentOrder(id: string): Order {
  return {
    ...paidOrder(id),
    status: 'created',
    paymentStatus: 'pending',
  };
}

async function spawnLogged(
  command: string,
  args: string[],
  cwd: string,
  logName: string,
): Promise<{ status: number | null; signal: NodeJS.Signals | null; output: string }> {
  const logStream = createWriteStream(resolve(artifactRoot, logName));
  const child = spawn(command, args, { cwd, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '';
  child.stdin.end();
  child.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    output += text;
    process.stdout.write(text);
    logStream.write(text);
  });
  child.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    output += text;
    process.stderr.write(text);
    logStream.write(text);
  });
  return await new Promise((resolveExit) => {
    child.once('exit', (status, signal) => {
      logStream.end();
      resolveExit({ status, signal, output });
    });
  });
}

function screenshotRootFromLog(output: string): string | null {
  const match = /KFC_GENUI_SCREENSHOT_DIR=(.+)/.exec(output);
  return match?.[1]?.trim() || null;
}

async function collectDashboardTelemetry(activeServer: NonNullable<typeof server>): Promise<unknown[]> {
  const sessionsResponse = await activeServer.inject({ method: 'GET', url: '/dashboard/sessions' });
  if (sessionsResponse.statusCode !== 200) {
    return [{ error: `dashboard sessions failed: ${sessionsResponse.statusCode}` }];
  }

  const sessions = (sessionsResponse.json() as { sessions?: Array<{ sessionId?: string }> }).sessions ?? [];
  const customerSessions = sessions.filter((session) => session.sessionId?.startsWith('kfc:anon_customer_integration_'));
  return await Promise.all(
    customerSessions.map(async (session) => {
      const sessionId = session.sessionId ?? '';
      const encodedSessionId = encodeURIComponent(sessionId);
      const [eventsResponse, turnsResponse] = await Promise.all([
        activeServer.inject({ method: 'GET', url: `/dashboard/events/${encodedSessionId}` }),
        activeServer.inject({ method: 'GET', url: `/dashboard/sessions/${encodedSessionId}/turns` }),
      ]);
      const events =
        eventsResponse.statusCode === 200 ? ((eventsResponse.json() as { events?: Array<Record<string, unknown>> }).events ?? []) : [];
      const turns =
        turnsResponse.statusCode === 200 ? ((turnsResponse.json() as { turns?: Array<Record<string, unknown>> }).turns ?? []) : [];

      return {
        sessionId,
         turns: turns.map((turn) => ({
          role: turn.role,
          text: turn.text,
           widgetKind:
            turn.metadata &&
            typeof turn.metadata === 'object' &&
            'genUi' in turn.metadata &&
            turn.metadata.genUi &&
            typeof turn.metadata.genUi === 'object' &&
            'widgetKind' in turn.metadata.genUi
              ? turn.metadata.genUi.widgetKind
               : null,
           cart:
             turn.metadata && typeof turn.metadata === 'object' &&
             'genUi' in turn.metadata && turn.metadata.genUi && typeof turn.metadata.genUi === 'object' &&
             'data' in turn.metadata.genUi && turn.metadata.genUi.data && typeof turn.metadata.genUi.data === 'object' &&
             'cart' in turn.metadata.genUi.data
               ? turn.metadata.genUi.data.cart
               : null,
         })),
        events: events
          .filter((event) => event.type === 'conversation_turn_created' || event.type === 'tool_executed')
          .slice(-20)
          .map((event) => ({
            type: event.type,
            payload: event.payload,
          })),
      };
    }),
  );
}

async function listExternalIntegrationSessionIds(baseUrl: string): Promise<Set<string>> {
  const sessionsResponse = await fetchWithRetry(`${baseUrl}/dashboard/sessions`, {
    headers: { 'Cache-Control': 'no-cache' },
  });
  if (!sessionsResponse.ok) {
    throw new Error(`Deployed dashboard sessions failed: ${sessionsResponse.status}`);
  }
  const sessionsBody = (await sessionsResponse.json()) as { sessions?: Array<{ sessionId?: unknown }> };
  return new Set(
    (sessionsBody.sessions ?? [])
    .map((session) => session.sessionId)
    .filter(
      (sessionId): sessionId is string =>
        typeof sessionId === 'string' && sessionId.includes('anon_customer_integration_'),
    ),
  );
}

async function collectDashboardTelemetryFromUrl(
  baseUrl: string,
  excludedSessionIds: ReadonlySet<string>,
): Promise<unknown[]> {
  const sessionIds = [...await listExternalIntegrationSessionIds(baseUrl)]
    .filter((sessionId) => !excludedSessionIds.has(sessionId));

  return Promise.all(
    sessionIds.map(async (sessionId) => {
      const response = await fetchWithRetry(
        `${baseUrl}/dashboard/sessions/${encodeURIComponent(sessionId)}/turns?limit=100`,
        { headers: { 'Cache-Control': 'no-cache' } },
      );
      if (!response.ok) {
        throw new Error(`Deployed dashboard turns failed for ${sessionId}: ${response.status}`);
      }
      const body = (await response.json()) as { turns?: unknown[]; events?: unknown[] };
      return {
        sessionId,
        turns: (body.turns ?? []).map(normalizeTelemetryTurn),
        events: body.events ?? [],
      };
    }),
  );
}

function normalizeTelemetryTurn(turn: unknown): Record<string, unknown> {
  if (!turn || typeof turn !== 'object') return { role: 'unknown', text: '', widgetKind: null };
  const record = turn as Record<string, unknown>;
  return {
    ...record,
    widgetKind: widgetKindFromTurn(record),
  };
}

function widgetKindFromTurn(turn: Record<string, unknown>): string | null {
  const metadata = turn.metadata;
  if (!metadata || typeof metadata !== 'object') return null;
  const genUi = (metadata as Record<string, unknown>).genUi;
  if (!genUi || typeof genUi !== 'object') return null;
  const widgetKind = (genUi as Record<string, unknown>).widgetKind;
  return typeof widgetKind === 'string' ? widgetKind : null;
}

function requiredProofAdminToken(): string {
  const token = process.env.KFC_DEMO_ADMIN_TOKEN?.trim();
  if (!token) {
    throw new Error('KFC_DEMO_ADMIN_TOKEN is required for an external GenUI proof with explicit mocked upstream profiles');
  }
  return token;
}

function buildExternalProofProxy(input: {
  targetBaseUrl: string;
  adminToken: string;
  mockedProfileFor: (customerId: string, turnIndex: number) => MockedUpstreamApiProfile | undefined;
}): FastifyInstance {
  const proxy = Fastify({ logger: false });
  const latestTurnIndexBySession = new Map<string, number>();

  proxy.all('/*', async (request, reply) => {
    const targetUrl = new URL(request.raw.url ?? '/', input.targetBaseUrl);
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (value === undefined || ['host', 'content-length', 'connection'].includes(name.toLowerCase())) continue;
      headers.set(name, Array.isArray(value) ? value.join(', ') : value);
    }

    let body = request.body;
    if (
      request.method === 'POST' &&
      targetUrl.pathname === '/chat/kfc/runs' &&
      isRecord(body) &&
      typeof body.sessionId === 'string' &&
      typeof body.customerId === 'string' &&
      isRecord(body.input)
    ) {
      const previousTurnIndex = latestTurnIndexBySession.get(body.sessionId) ?? -1;
      const turnIndex = body.input.kind === 'text' ? previousTurnIndex + 2 : Math.max(previousTurnIndex, 1);
      if (body.input.kind === 'text') latestTurnIndexBySession.set(body.sessionId, turnIndex);
      const profile = input.mockedProfileFor(body.customerId, turnIndex);
      if (profile) {
        body = {
          ...body,
          metadata: {
            ...(isRecord(body.metadata) ? body.metadata : {}),
            mockedUpstreamApi: profile,
          },
        };
        headers.set('x-kfc-demo-admin-token', input.adminToken);
      }
    }

    const upstream = await fetch(targetUrl, {
      method: request.method,
      headers,
      ...(request.method === 'GET' || request.method === 'HEAD'
        ? {}
        : {
            body: body === undefined
              ? undefined
              : typeof body === 'string'
                ? body
                : body instanceof Uint8Array
                  ? body as unknown as BodyInit
                : JSON.stringify(body),
          }),
    });
    reply.code(upstream.status);
    for (const [name, value] of upstream.headers.entries()) {
      if (['content-length', 'content-encoding', 'transfer-encoding', 'connection'].includes(name.toLowerCase())) continue;
      reply.header(name, value);
    }
    if (!upstream.body) return reply.send();
    return reply.send(Readable.from(upstream.body as unknown as AsyncIterable<Uint8Array>));
  });
  return proxy;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function fetchWithRetry(input: string, init?: RequestInit): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(input, init);
      if (![502, 503, 504].includes(response.status) || attempt === 3) return response;
      lastError = new Error(`retryable HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
      if (attempt === 3) throw error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500 * attempt));
  }
  throw lastError;
}

function renderCatalog(manifest: ProofManifest): string {
  const lines = [
    '# Live GenUI Integration Test Conversation Screenshots',
    '',
    `Run ID: ${manifest.runId}`,
    `Passed: ${manifest.passed ? 'yes' : 'no'}`,
    '',
  ];
  for (const screenshot of manifest.screenshots) {
    lines.push(`## ${screenshot.scenario} / ${screenshot.widgetKind}`, '', `Path: \`${screenshot.path}\``, '');
    lines.push(screenshot.exists ? `![${screenshot.widgetKind}](${relative(artifactRoot, screenshot.path)})` : 'Missing screenshot.');
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}
