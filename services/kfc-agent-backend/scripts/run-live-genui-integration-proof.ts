import { spawn } from 'node:child_process';
import { cpSync, createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildServer } from '../src/api/server.js';
import { buildServerOptionsFromEnv } from '../src/api/serverOptions.js';
import { loadEnv } from '../src/config/env.js';
import { DashboardEventBus } from '../src/dashboard/eventBus.js';
import type { Order } from '../src/domain/types.js';
import { MemoryStore } from '../src/persistence/memoryStore.js';

interface ExpectedScreenshot {
  scenario: string;
  widgetKind: string;
  file: string;
  turnIndex?: number;
  useCases?: string[];
}

interface ProofManifest {
  runId: string;
  passed: boolean;
  screenshots: Array<ExpectedScreenshot & { path: string; exists: boolean }>;
}

interface ScenarioCapturePlan {
  scenarios: Array<{
    fileName: string;
    expectedWidgetsByUserTurn: Record<string, string>;
  }>;
}

interface ScenarioScript {
  id: string;
  title: string;
  turns: Array<{
    index: number;
    speaker: 'User' | 'Bot';
    useCases?: string[];
  }>;
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const backendRoot = resolve(scriptDir, '..');
const repoRoot = resolve(backendRoot, '../..');
const flutterRoot = resolve(repoRoot, 'apps/kfc_live_monitor_flutter');
const scenariosRoot = resolve(repoRoot, 'ai-talent-tracks/fnb/conversations');
const capturePlanPath = resolve(backendRoot, 'fixtures/genui-scenario-capture-plan.json');
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const artifactRoot = resolve(repoRoot, 'artifacts/genui-live-proof', runId, 'integration-test');
const artifactScreenshotRoot = resolve(artifactRoot, 'screenshots');
const flutterDevice = process.env.KFC_GENUI_FLUTTER_DEVICE || 'macos';
let backendUrl = '';
let screenshotRoot = artifactScreenshotRoot;

const dotenvCandidates = dotenvCandidatePaths(repoRoot);
for (const dotenvPath of dotenvCandidates) loadDotEnv(dotenvPath);
if (!process.env.OPENAI_API_KEY?.trim()) {
  throw new Error(`OPENAI_API_KEY is required. Checked: ${dotenvCandidates.join(', ')}`);
}

mkdirSync(artifactRoot, { recursive: true });
mkdirSync(artifactScreenshotRoot, { recursive: true });

const customerChatScreenshots = buildCustomerChatScreenshotsFromCapturePlan(capturePlanPath, scenariosRoot);
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

const env = loadEnv(process.env);
const baseOptions = buildServerOptionsFromEnv(env);
const store = new MemoryStore();
const dashboard = new DashboardEventBus();
const paidRecentOrder = paidOrder('KFC-1024');
const failedPaymentOrder = pendingPaymentOrder('KFC-MOCK-1001');
const server = buildServer({
  ...baseOptions,
  store,
  dashboard,
  mockClientOptions: {
    ...baseOptions.mockClientOptions,
    initialOrders: [paidRecentOrder, failedPaymentOrder],
    recentOrderProvider: (customerId) => {
      if (customerId.includes('08-thanh-toan-loi-va-don-bat-thuong')) {
        return { ok: true, value: failedPaymentOrder, message: 'genui_integration_recent_failed_payment_order' };
      }
      if (customerId.includes('04-sau-khi-dat-don') || customerId.includes('07-ca-nhan-hoa-va-loyalty')) {
        return { ok: true, value: paidRecentOrder, message: 'genui_integration_recent_paid_order' };
      }
      return { ok: true, value: null, message: 'genui_integration_no_recent_order_precondition' };
    },
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

try {
  if (server) {
    await server.listen({ host: '127.0.0.1', port: 0 });
    const address = server.server.address();
    if (!address || typeof address === 'string') throw new Error('Unable to resolve backend address');
    backendUrl = `http://127.0.0.1:${address.port}`;
    logs.push(`backend=${backendUrl}`);
  }
  logs.push(`flutterDevice=${flutterDevice}`);
  logs.push(`artifactScreenshotRoot=${artifactScreenshotRoot}`);

  for (const [index, target] of integrationTargets.entries()) {
    const dartDefines = [...(backendUrl ? [`--dart-define=KFC_AGENT_BACKEND_URL=${backendUrl}`] : [])];
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
  dashboardTelemetry = server ? await collectDashboardTelemetry(server) : [];
} finally {
  await server?.close();
}

const missingScreenshots = expectedScreenshots.filter((entry) => !existsSync(resolve(screenshotRoot, entry.file)));
const passed = integrationStatus === 0 && missingScreenshots.length === 0;
const manifest = {
  runId,
  generatedAt: new Date().toISOString(),
  backendUrl,
  liveAi: true,
  integrationTest: { status: integrationStatus, signal: integrationSignal, device: flutterDevice, targets: integrationRuns },
  artifactRoot,
  screenshots: expectedScreenshots.map((entry) => ({
    ...entry,
    path: resolve(screenshotRoot, entry.file),
    exists: existsSync(resolve(screenshotRoot, entry.file)),
  })),
  missingScreenshots: missingScreenshots.map((entry) => entry.file),
  dashboardTelemetry,
  passed,
  logs,
};

writeFileSync(resolve(artifactRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(resolve(artifactRoot, 'catalog.md'), renderCatalog(manifest));
console.log(JSON.stringify(manifest, null, 2));
if (!passed) process.exitCode = 1;

function buildCustomerChatScreenshotsFromCapturePlan(planPath: string, scenarioRoot: string): ExpectedScreenshot[] {
  const plan = readJson<ScenarioCapturePlan>(planPath);
  const screenshots: ExpectedScreenshot[] = [];

  for (const scenarioPlan of plan.scenarios) {
    const script = readJson<ScenarioScript>(resolve(scenarioRoot, scenarioPlan.fileName));
    let captureIndex = 0;
    for (const turn of script.turns.filter((entry) => entry.speaker === 'User')) {
      captureIndex += 1;
      const expectedWidget = scenarioPlan.expectedWidgetsByUserTurn[String(turn.index)];
      const label = `turn_${String(turn.index).padStart(2, '0')}_${widgetToken(expectedWidget)}`;
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

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function widgetToken(widgetKind: string | undefined): string {
  if (!widgetKind) return 'chat';
  return widgetKind.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`).replace(/^_/, '');
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
  const customerSessions = sessions.filter((session) => session.sessionId?.startsWith('web:kfc-customer-'));
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
