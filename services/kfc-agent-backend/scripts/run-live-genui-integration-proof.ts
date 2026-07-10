import { spawn } from 'node:child_process';
import { cpSync, createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildServer } from '../src/api/server.js';
import { buildServerOptionsFromEnv } from '../src/api/serverOptions.js';
import { loadEnv } from '../src/config/env.js';
import { DashboardEventBus } from '../src/dashboard/eventBus.js';
import type { Order } from '../src/domain/types.js';
import type { ToolPlanner, ToolPlannerOutput } from '../src/llm/toolPlanner.js';
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
const artifactRoot = resolve(repoRoot, 'artifacts/genui-live-proof', runId, 'integration-test');
const artifactScreenshotRoot = resolve(artifactRoot, 'screenshots');
const flutterDevice = process.env.KFC_GENUI_FLUTTER_DEVICE || 'macos';
const useLiveBackend = process.env.KFC_GENUI_USE_LIVE_BACKEND === '1';
let backendUrl = '';
let screenshotRoot = artifactScreenshotRoot;

if (useLiveBackend) loadDotEnv(resolve(repoRoot, '.env'));
if (useLiveBackend && !process.env.OPENAI_API_KEY?.trim()) {
  throw new Error(`OPENAI_API_KEY is required. Expected it in ${resolve(repoRoot, '.env')}`);
}

mkdirSync(artifactRoot, { recursive: true });
mkdirSync(artifactScreenshotRoot, { recursive: true });

const customerChatScreenshots: ExpectedScreenshot[] = [
  ['ordering_to_checkout', 'smartMenuPicker', 'customer_chat_genui_conversation_ordering/01_menu_suggestion_chat.png'],
  ['ordering_to_checkout', 'cartBuilder', 'customer_chat_genui_conversation_ordering/02_cart_builder_chat.png'],
  ['ordering_to_checkout', 'addressFulfillmentCheck', 'customer_chat_genui_conversation_ordering/03_fulfillment_check_chat.png'],
  ['ordering_to_checkout', 'orderReviewConfirm', 'customer_chat_genui_conversation_ordering/04_order_review_chat.png'],
  ['ordering_to_checkout', 'paymentOrderStatus', 'customer_chat_genui_conversation_ordering/05_payment_status_chat.png'],
  ['post_payment_order_tracking', 'orderTrackingStatus', 'customer_chat_genui_conversation_tracking/01_paid_order_tracking_chat.png'],
  ['support_path', 'supportHandoff', 'customer_chat_genui_conversation_support/01_support_handoff_chat.png'],
].map(([scenario, widgetKind, file]) => ({ scenario, widgetKind, file }));

const liveMonitorScreenshots: ExpectedScreenshot[] = [
  ['live_monitor_primary_screen', 'sessionCard', 'live_monitor_primary_screen/01_primary_monitor_grid.png'],
  ['live_monitor_history_polling', 'persistedHistory', 'live_monitor_history_polling/01_persisted_history.png'],
  ['live_monitor_history_polling', 'refreshedHistory', 'live_monitor_history_polling/02_refreshed_history.png'],
  ['live_monitor_channel_parity', 'zaloHistory', 'live_monitor_channel_parity/01_zalo_history.png'],
  ['live_monitor_channel_parity', 'messengerDisplayName', 'live_monitor_channel_parity/02_messenger_display_name.png'],
  ['live_monitor_angry_handoff', 'needsHuman', 'live_monitor_angry_handoff/01_needs_human.png'],
  ['live_monitor_angry_handoff', 'humanJoined', 'live_monitor_angry_handoff/02_human_joined.png'],
  ['live_monitor_angry_handoff', 'aiHandling', 'live_monitor_angry_handoff/03_ai_handling.png'],
].map(([scenario, widgetKind, file]) => ({ scenario, widgetKind, file }));

const expectedScreenshots = useLiveBackend
  ? customerChatScreenshots
  : [...customerChatScreenshots, ...liveMonitorScreenshots];

let integrationStatus: number | null = null;
let integrationSignal: NodeJS.Signals | null = null;
const integrationTargets = useLiveBackend
  ? ['integration_test/customer_chat_genui_conversation_test.dart']
  : [
      'integration_test/customer_chat_genui_conversation_test.dart',
      'integration_test/live_monitor_conversation_test.dart',
    ];
const integrationRuns: Array<{
  target: string;
  status: number | null;
  signal: NodeJS.Signals | null;
}> = [];
const logs: string[] = [];
let dashboardTelemetry: unknown[] = [];

const env = useLiveBackend ? loadEnv(process.env) : null;
const baseOptions = env ? buildServerOptionsFromEnv(env) : null;
const store = new MemoryStore();
const dashboard = new DashboardEventBus();
const commonMockClientOptions = {
  recentOrderProvider: () => ({ ok: true as const, value: null, message: 'genui_integration_no_recent_order_fixture' }),
  orderStatusProvider: (orderId: string) =>
    orderId === 'KFC-1024' || orderId === 'KFC-MOCK-1001'
      ? { ok: true as const, value: paidOrder(orderId), message: 'genui_integration_order_fixture' }
      : { ok: false as const, errorCode: 'order_not_found', message: `Order ${orderId} was not found` },
  fulfillmentQuoteProvider: () => ({
    ok: true as const,
    value: { feeVnd: 18000, etaMinutes: 25 },
    message: 'genui_integration_fulfillment_quote_fixture',
  }),
  paymentStatusProvider: () => ({
    ok: true as const,
    value: { status: 'paid' as const },
    message: 'genui_integration_paid_fixture',
  }),
};
const fixtureToolPlanner: ToolPlanner = {
  async plan(input) {
    const latestUserMessage = input.state.latestUserMessage.toLowerCase();
    const output = (
      intent: ToolPlannerOutput['intent'],
      toolCalls: ToolPlannerOutput['toolCalls'],
      extra?: Partial<ToolPlannerOutput>,
    ): ToolPlannerOutput => ({
      intent,
      entities: {},
      toolCalls,
      responseClaims: [],
      ...extra,
    });
    if (
      latestUserMessage.includes('gặp nhân viên') ||
      latestUserMessage.includes('khiếu nại')
    ) {
      return output(
        'handoff',
        [
          {
            toolName: 'handoff',
            arguments: { reasons: ['customer_requested_human'] },
          },
        ],
      );
    }
    if (
      latestUserMessage.includes('theo dõi') ||
      latestUserMessage.includes('đã thanh toán') ||
      latestUserMessage.includes('kfc-1024')
    ) {
      return output(
        'order_status',
        [
          { toolName: 'getOrderStatus', arguments: { orderId: 'KFC-1024' } },
          { toolName: 'checkPaymentStatus', arguments: { orderId: 'KFC-1024' } },
        ],
        { responseClaims: ['payment_success'] },
      );
    }
    if (
      latestUserMessage.includes('giao tới') ||
      latestUserMessage.includes('phạm văn thuận')
    ) {
      return output('ordering', [
        {
          toolName: 'quoteFulfillment',
          arguments: {
            address: {
              label: 'Nhà',
              line1: 'Số 121 đường Phạm Văn Thuận, P.Tân Tiến',
              district: 'Biên Hòa',
              city: 'Đồng Nai',
            },
            method: 'delivery',
            itemCodes: ['20751'],
          },
        },
      ]);
    }
    if (latestUserMessage.includes('giao đến địa chỉ này')) {
      return output('ordering', [], {
        directResponse: 'Bạn kiểm tra lần cuối trước khi đặt đơn.',
      });
    }
    if (
      latestUserMessage.includes('thêm combo hợp gu') ||
      latestUserMessage.includes('thêm pepsi')
    ) {
      return output('cart_edit', [
        {
          toolName: 'updateCart',
          arguments: { itemCode: '20751', quantity: 1 },
        },
      ]);
    }
    if (
      latestUserMessage.includes('gợi ý') ||
      latestUserMessage.includes('combo hợp gu')
    ) {
      return output('ordering', [
        { toolName: 'searchMenu', arguments: { query: 'Combo Hợp Gu 99K' } },
      ]);
    }
    return output('unclear', []);
  },
};
const server = buildServer(
  useLiveBackend && baseOptions
    ? {
        ...baseOptions,
        store,
        dashboard,
        mockClientOptions: {
          ...baseOptions.mockClientOptions,
          ...commonMockClientOptions,
        },
        readiness: {
          database: async () => ({ ok: true }),
          openAiConfigured: true,
          openAiRequired: true,
        },
      }
    : {
        store,
        dashboard,
        messengerVerifyToken: 'local_verify',
        metaPageId: '118976205445198',
        messengerPageAccessToken: 'page_token_local',
        metaInboxUrlTemplate:
          'https://business.facebook.com/latest/inbox/all?asset_id={pageId}&selected_item_id={externalUserId}&session={sessionId}',
        messengerGraphApiBaseUrl: 'https://graph.local',
        messengerFetchImpl: fixtureMessengerFetch,
        zaloOaId: 'oa_local',
        zaloAccessToken: 'zalo_token_local',
        zaloInboxUrlTemplate:
          'https://oa.zalo.me/chatv2?oaid={pageId}&uid={externalUserId}&session={sessionId}',
        zaloApiBaseUrl: 'https://zalo.local',
        zaloFetchImpl: fixtureZaloFetch,
        mockClientOptions: commonMockClientOptions,
        toolPlanner: fixtureToolPlanner,
        readiness: {
          database: async () => ({ ok: true }),
          openAiConfigured: false,
          openAiRequired: false,
        },
      },
);

try {
  if (server) {
    await server.listen({ host: '127.0.0.1', port: 0 });
    const address = server.server.address();
    if (!address || typeof address === 'string') throw new Error('Unable to resolve backend address');
    backendUrl = `http://127.0.0.1:${address.port}`;
    logs.push(`backend=${backendUrl}`);
  } else {
    logs.push('backend=fixture');
  }
  logs.push(`flutterDevice=${flutterDevice}`);
  logs.push(`artifactScreenshotRoot=${artifactScreenshotRoot}`);

  for (const [index, target] of integrationTargets.entries()) {
    const dartDefines = [
      ...(backendUrl ? [`--dart-define=KFC_AGENT_BACKEND_URL=${backendUrl}`] : []),
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
  liveAi: useLiveBackend,
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

async function fixtureMessengerFetch(
  url: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
): Promise<Response> {
  const body = parseJsonBody(init);
  if (typeof body.sender_action === 'string') {
    return jsonResponse({ recipient_id: 'fixture_psid' });
  }
  if (String(url).includes('/messenger_monitor_')) {
    return jsonResponse({
      first_name: 'Nguyen',
      last_name: 'An',
      profile_pic: 'https://graph.local/nguyen-an.jpg',
    });
  }
  return jsonResponse({ message_id: `messenger_reply_${Date.now()}` });
}

async function fixtureZaloFetch(): Promise<Response> {
  return jsonResponse({ error: 0, message_id: `zalo_reply_${Date.now()}` });
}

function parseJsonBody(init?: Parameters<typeof fetch>[1]): Record<string, unknown> {
  const body = init?.body;
  if (typeof body !== 'string') return {};
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
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
