import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
}

interface ProofManifest {
  runId: string;
  passed: boolean;
  screenshots: Array<ExpectedScreenshot & { path: string; exists: boolean }>;
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const backendRoot = resolve(scriptDir, '..');
const repoRoot = resolve(backendRoot, '../..');
const flutterRoot = resolve(repoRoot, 'apps/kfc_live_monitor_flutter');
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const artifactRoot = resolve(repoRoot, 'artifacts/genui-live-proof', runId, 'patrol');
const screenshotRoot = resolve(artifactRoot, 'screenshots');
const patrolDevice = process.env.KFC_GENUI_PATROL_DEVICE || 'E4646BAE-1B86-40D0-8E9F-F3812E9F9F00';
let backendUrl = '';

loadDotEnv(resolve(repoRoot, '.env'));
if (!process.env.OPENAI_API_KEY?.trim()) {
  throw new Error(`OPENAI_API_KEY is required. Expected it in ${resolve(repoRoot, '.env')}`);
}

mkdirSync(artifactRoot, { recursive: true });
mkdirSync(screenshotRoot, { recursive: true });

const expectedScreenshots: ExpectedScreenshot[] = [
  ['ordering_to_checkout', 'smartMenuPicker', 'customer_chat_genui_conversation_ordering/01_menu_suggestion_chat.png'],
  ['ordering_to_checkout', 'cartBuilder', 'customer_chat_genui_conversation_ordering/02_cart_builder_chat.png'],
  ['ordering_to_checkout', 'addressFulfillmentCheck', 'customer_chat_genui_conversation_ordering/03_fulfillment_check_chat.png'],
  ['ordering_to_checkout', 'orderReviewConfirm', 'customer_chat_genui_conversation_ordering/04_order_review_chat.png'],
  ['ordering_to_checkout', 'paymentOrderStatus', 'customer_chat_genui_conversation_ordering/05_payment_status_chat.png'],
  ['post_payment_order_tracking', 'orderTrackingStatus', 'customer_chat_genui_conversation_tracking/01_paid_order_tracking_chat.png'],
  ['support_path', 'supportHandoff', 'customer_chat_genui_conversation_support/01_support_handoff_chat.png'],
].map(([scenario, widgetKind, file]) => ({ scenario, widgetKind, file }));

let sidecar: ChildProcessWithoutNullStreams | undefined;
let patrolStatus: number | null = null;
let patrolSignal: NodeJS.Signals | null = null;
const logs: string[] = [];
let dashboardTelemetry: unknown[] = [];

const env = loadEnv(process.env);
const baseOptions = buildServerOptionsFromEnv(env);
const store = new MemoryStore();
const dashboard = new DashboardEventBus();
const server = buildServer({
  ...baseOptions,
  store,
  dashboard,
  mockClientOptions: {
    ...baseOptions.mockClientOptions,
    initialOrders: [paidOrder('KFC-1024'), paidOrder('KFC-MOCK-1001')],
    paymentStatusProvider: () => ({
      ok: true,
      value: { status: 'paid' as const },
      message: 'live_genui_patrol_paid_fixture',
    }),
  },
  readiness: {
    database: async () => ({ ok: true }),
    openAiConfigured: true,
    openAiRequired: true,
  },
});

try {
  bootSimulatorIfNeeded(patrolDevice);
  await server.listen({ host: '127.0.0.1', port: 0 });
  const address = server.server.address();
  if (!address || typeof address === 'string') throw new Error('Unable to resolve backend address');
  backendUrl = `http://127.0.0.1:${address.port}`;
  logs.push(`backend=${backendUrl}`);

  sidecar = await spawnReady(
    'dart',
    ['run', 'tool/patrol_screenshot_sidecar.dart', screenshotRoot],
    flutterRoot,
    /Patrol screenshot sidecar listening/,
    'screenshot-sidecar.log',
  );

  const patrolResult = await spawnLogged(
    'patrol',
    [
      'test',
      '--target=patrol_test/customer_chat_genui_conversation_test.dart',
      '--device',
      patrolDevice,
      '--dart-define',
      `KFC_AGENT_BACKEND_URL=${backendUrl}`,
      '--dart-define',
      'PATROL_SCREENSHOT_SERVER_URL=http://127.0.0.1:18083/screenshot',
      '--no-label',
    ],
    flutterRoot,
    'patrol.log',
  );
  patrolStatus = patrolResult.status;
  patrolSignal = patrolResult.signal;
  dashboardTelemetry = await collectDashboardTelemetry();
} finally {
  if (sidecar && !sidecar.killed) sidecar.kill('SIGTERM');
  await server.close();
}

const missingScreenshots = expectedScreenshots.filter((entry) => !existsSync(resolve(screenshotRoot, entry.file)));
const passed = patrolStatus === 0 && missingScreenshots.length === 0;
const manifest = {
  runId,
  generatedAt: new Date().toISOString(),
  backendUrl,
  liveAi: true,
  patrol: { status: patrolStatus, signal: patrolSignal },
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

function bootSimulatorIfNeeded(deviceId: string): void {
  if (!/^[0-9A-F-]{36}$/i.test(deviceId)) return;
  try {
    execFileSync('xcrun', ['simctl', 'boot', deviceId], { stdio: 'ignore' });
  } catch {
    // Already booted is fine; Patrol will report a real device error if this is unavailable.
  }
  try {
    execFileSync('open', ['-a', 'Simulator', '--args', '-CurrentDeviceUDID', deviceId], { stdio: 'ignore' });
  } catch {
    // Opening Simulator is best-effort; booting the device is the important part.
  }
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

function paidOrder(id: string): Order {
  return {
    id,
    status: 'preparing',
    paymentStatus: 'paid',
    assignedStoreId: 'store_kfc_nguyen_thi_minh_khai',
    createdAt: '2026-07-09T09:00:00.000Z',
    cart: {
      id: `cart_${id}`,
      items: [{ itemCode: '20751', name: 'Combo Hợp Gu 99K', quantity: 1, unitPriceVnd: 99000 }],
      subtotalVnd: 99000,
      discountVnd: 0,
      deliveryFeeVnd: 18000,
      totalVnd: 117000,
      voucherCode: null,
    },
  };
}

async function spawnReady(
  command: string,
  args: string[],
  cwd: string,
  readyPattern: RegExp,
  logName: string,
): Promise<ChildProcessWithoutNullStreams> {
  const child = spawn(command, args, { cwd, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.end();
  const logStream = createWriteStream(resolve(artifactRoot, logName));
  return await new Promise((resolveReady, rejectReady) => {
    const timer = setTimeout(() => rejectReady(new Error(`${command} ${args.join(' ')} did not become ready`)), 30_000);
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      process.stdout.write(text);
      logStream.write(text);
      if (readyPattern.test(text)) {
        clearTimeout(timer);
        resolveReady(child);
      }
    });
    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk);
      logStream.write(chunk);
    });
    child.once('exit', (code, signal) => {
      logStream.end();
      clearTimeout(timer);
      rejectReady(new Error(`${command} exited before ready: code=${code} signal=${signal}`));
    });
  });
}

async function spawnLogged(
  command: string,
  args: string[],
  cwd: string,
  logName: string,
): Promise<{ status: number | null; signal: NodeJS.Signals | null }> {
  const logStream = createWriteStream(resolve(artifactRoot, logName));
  const child = spawn(command, args, { cwd, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.end();
  child.stdout.on('data', (chunk) => {
    process.stdout.write(chunk);
    logStream.write(chunk);
  });
  child.stderr.on('data', (chunk) => {
    process.stderr.write(chunk);
    logStream.write(chunk);
  });
  return await new Promise((resolveExit) => {
    child.once('exit', (status, signal) => {
      logStream.end();
      resolveExit({ status, signal });
    });
  });
}

async function collectDashboardTelemetry(): Promise<unknown[]> {
  const sessionsResponse = await server.inject({ method: 'GET', url: '/dashboard/sessions' });
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
        server.inject({ method: 'GET', url: `/dashboard/events/${encodedSessionId}` }),
        server.inject({ method: 'GET', url: `/dashboard/sessions/${encodedSessionId}/turns` }),
      ]);
      const events =
        eventsResponse.statusCode === 200
          ? ((eventsResponse.json() as { events?: Array<Record<string, unknown>> }).events ?? [])
          : [];
      const turns =
        turnsResponse.statusCode === 200
          ? ((turnsResponse.json() as { turns?: Array<Record<string, unknown>> }).turns ?? [])
          : [];

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
  const lines = ['# Live GenUI Patrol Conversation Screenshots', '', `Run ID: ${manifest.runId}`, `Passed: ${manifest.passed ? 'yes' : 'no'}`, ''];
  for (const screenshot of manifest.screenshots) {
    lines.push(`## ${screenshot.scenario} / ${screenshot.widgetKind}`, '', `Path: \`${screenshot.path}\``, '');
    lines.push(screenshot.exists ? `![${screenshot.widgetKind}](${relative(artifactRoot, screenshot.path)})` : 'Missing screenshot.');
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}
