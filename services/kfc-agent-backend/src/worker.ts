import { createRouteHandlers, type HandlerResponse } from './api/routeHandlers.js';
import { buildServerOptionsFromEnv } from './api/serverOptions.js';
import type { ConversationEvent } from './channels/conversationEvent.js';
import {
  createMessengerHistoryClient,
  MessengerHistorySyncCoordinator,
  MessengerHistorySyncService,
} from './channels/messengerHistory.js';
import { normalizeMessengerWebhook, verifyMessengerChallenge } from './channels/messenger.js';
import { normalizeZaloWebhook } from './channels/zalo.js';
import { DashboardEventBus } from './dashboard/eventBus.js';
import { loadBundledGeneratedFixtures } from './fixtures/bundledFixtures.js';
import { D1Store, type D1DatabaseLike } from './persistence/d1Store.js';
import { sessionIdForConversationEvent } from './session/sessionContext.js';

export interface QueueBinding<T> {
  send(message: T): Promise<void>;
}

export interface WorkerQueueMessage<T> {
  body: T;
  ack?(): void;
  retry?(): void;
}

export interface WorkerQueueBatch<T> {
  messages: Array<WorkerQueueMessage<T>>;
}

export interface MessengerWebhookJob {
  channel?: 'messenger';
  event: ConversationEvent;
  sessionId: string;
  queuedAt: string;
}

export interface ZaloWebhookJob {
  channel: 'zalo';
  payload: unknown;
  queuedAt: string;
}

export type WorkerWebhookJob = MessengerWebhookJob | ZaloWebhookJob;

export interface WorkerEnv {
  DB: D1DatabaseLike;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  OPENAI_TOOL_PLANNER_MODEL?: string;
  OPENAI_RESPONSE_MODEL?: string;
  OPENAI_BASE_URL?: string;
  LANGSMITH_API_KEY?: string;
  LANGSMITH_PROJECT?: string;
  MESSENGER_VERIFY_TOKEN?: string;
  META_PAGE_ID?: string;
  META_PAGE_ACCESS_TOKEN?: string;
  META_INBOX_URL_TEMPLATE?: string;
  MESSENGER_GRAPH_API_BASE_URL?: string;
  MESSENGER_WEBHOOK_QUEUE?: QueueBinding<WorkerWebhookJob>;
  ZALO_OA_ID?: string;
  ZALO_ACCESS_TOKEN?: string;
  ZALO_INBOX_URL_TEMPLATE?: string;
  ZALO_REFRESH_TOKEN?: string;
  ZALO_APP_ID?: string;
  ZALO_APP_SECRET?: string;
  ZALO_API_BASE_URL?: string;
  MESSENGER_FETCH?: typeof fetch;
  ZALO_FETCH?: typeof fetch;
}

const ZALO_SITE_VERIFICATION_TOKEN = 'JUwvDeVE5W07swqXmF5wFpdComBLkX5UCpCm';
const ZALO_SITE_VERIFICATION_PATH = `/zalo_verifier${ZALO_SITE_VERIFICATION_TOKEN}.html`;
const workerDashboardSessionDefaultLookbackMs = 4 * 60 * 60 * 1000;

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const url = new URL(request.url);
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === ZALO_SITE_VERIFICATION_PATH)) {
      return html(zaloSiteVerificationHtml());
    }
    if (request.method === 'GET' && url.pathname === '/health') {
      return json({ ok: true, service: 'kfc-agent-backend' });
    }
    if (request.method === 'GET' && url.pathname === '/webhooks/messenger') {
      const result = verifyMessengerChallenge(
        Object.fromEntries(url.searchParams.entries()),
        env.MESSENGER_VERIFY_TOKEN ?? '',
      );
      return text(result.body, result.statusCode);
    }
    if (url.pathname === '/dashboard/stream') {
      return json({ errorCode: 'worker_sse_not_supported', message: 'Use dashboard polling endpoints for Worker demo.' }, 501);
    }
    if (request.method === 'POST' && url.pathname === '/webhooks/zalo' && env.MESSENGER_WEBHOOK_QUEUE) {
      return toResponse(await enqueueZaloWebhook(request, env));
    }

    const store = new D1Store(env.DB);
    await store.initialize();
    if (request.method === 'POST' && url.pathname === '/webhooks/messenger') {
      return toResponse(await enqueueMessengerWebhook(request, env, store));
    }
    if (request.method === 'GET' && url.pathname === '/dashboard/sessions') {
      const dashboard = new DashboardEventBus({
        persistEvent: (event) => store.appendDashboardEvent(event),
      });
      await syncWorkerMessengerHistory(store, dashboard, env);
      return json({ sessions: await listWorkerDashboardSessions(store, env) });
    }

    const fastEventsMatch = url.pathname.match(/^\/dashboard\/events\/([^/]+)$/);
    if (request.method === 'GET' && fastEventsMatch) {
      return json({ events: await store.listDashboardEvents(decodeURIComponent(fastEventsMatch[1])) });
    }

    const shouldLoadDashboardEvents =
      request.method === 'GET' &&
      (url.pathname === '/dashboard/sessions' ||
        /^\/dashboard\/events\/([^/]+)$/.test(url.pathname));
    const dashboard = new DashboardEventBus({
      initialEvents: shouldLoadDashboardEvents ? await store.listDashboardEvents() : undefined,
      persistEvent: (event) => store.appendDashboardEvent(event),
    });
    const messengerHistorySync = createWorkerMessengerHistorySync(store, dashboard, env);
    const options = buildServerOptionsFromEnv({
      PORT: 0,
      DATABASE_URL: 'd1://DB',
      OPENAI_API_KEY: env.OPENAI_API_KEY ?? '',
      OPENAI_MODEL: env.OPENAI_MODEL ?? 'gpt-4.1',
      OPENAI_TOOL_PLANNER_MODEL: env.OPENAI_TOOL_PLANNER_MODEL ?? 'gpt-4.1-mini',
      OPENAI_RESPONSE_MODEL: env.OPENAI_RESPONSE_MODEL ?? 'gpt-4.1-mini',
      OPENAI_BASE_URL: env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
      LANGSMITH_API_KEY: env.LANGSMITH_API_KEY ?? '',
      LANGSMITH_PROJECT: env.LANGSMITH_PROJECT ?? 'kfc-agent-backend-worker',
      MESSENGER_VERIFY_TOKEN: env.MESSENGER_VERIFY_TOKEN ?? '',
      META_PAGE_ID: env.META_PAGE_ID ?? '',
      META_PAGE_ACCESS_TOKEN: env.META_PAGE_ACCESS_TOKEN ?? '',
      META_INBOX_URL_TEMPLATE: env.META_INBOX_URL_TEMPLATE ?? '',
      MESSENGER_GRAPH_API_BASE_URL: env.MESSENGER_GRAPH_API_BASE_URL ?? '',
      ZALO_OA_ID: env.ZALO_OA_ID ?? '',
      ZALO_ACCESS_TOKEN: env.ZALO_ACCESS_TOKEN ?? '',
      ZALO_INBOX_URL_TEMPLATE: env.ZALO_INBOX_URL_TEMPLATE ?? '',
      ZALO_REFRESH_TOKEN: env.ZALO_REFRESH_TOKEN ?? '',
      ZALO_APP_ID: env.ZALO_APP_ID ?? '',
      ZALO_APP_SECRET: env.ZALO_APP_SECRET ?? '',
      ZALO_API_BASE_URL: env.ZALO_API_BASE_URL ?? '',
    });
    const handlers = createRouteHandlers({
      ...options,
      fixtures: loadBundledGeneratedFixtures(),
      store,
      dashboard,
      messengerHistorySync,
      messengerFetchImpl: env.MESSENGER_FETCH ?? fetch,
      zaloFetchImpl: env.ZALO_FETCH ?? fetch,
      readiness: {
        database: async () => {
          await env.DB.prepare('SELECT 1').first();
          return { ok: true };
        },
        messengerToken:
          request.method === 'GET' && url.pathname === '/ready' && url.searchParams.get('deep') === '1'
            ? () => checkMessengerToken(env)
            : undefined,
        openAiConfigured: Boolean(env.OPENAI_API_KEY),
        openAiRequired: false,
        zaloRequired: false,
      },
    });

    if (request.method === 'GET' && url.pathname === '/ready') return toResponse(await handlers.ready());
    if (request.method === 'POST' && url.pathname === '/webhooks/zalo') {
      return toResponse(await handlers.zaloWebhook(await readJson(request)));
    }
    if (request.method === 'POST' && url.pathname === '/chat/mock') {
      return toResponse(await handlers.chatMock(await readJson(request)));
    }
    if (request.method === 'POST' && url.pathname === '/chat/genui-action') {
      return toResponse(await handlers.chatGenUiAction(await readJson(request)));
    }
    if (request.method === 'GET' && url.pathname === '/dashboard/sessions') {
      return toResponse(await handlers.dashboardSessions());
    }

    const turnsMatch = url.pathname.match(/^\/dashboard\/sessions\/([^/]+)\/turns$/);
    if (request.method === 'GET' && turnsMatch) {
      return toResponse(await handlers.dashboardTurns(decodeURIComponent(turnsMatch[1])));
    }
    const humanJoinMatch = url.pathname.match(/^\/dashboard\/sessions\/([^/]+)\/human-join$/);
    if (request.method === 'POST' && humanJoinMatch) {
      return toResponse(await handlers.dashboardHumanJoin(decodeURIComponent(humanJoinMatch[1]), await readJson(request)));
    }
    const humanMessageMatch = url.pathname.match(/^\/dashboard\/sessions\/([^/]+)\/human-message$/);
    if (request.method === 'POST' && humanMessageMatch) {
      return toResponse(await handlers.dashboardHumanMessage(decodeURIComponent(humanMessageMatch[1]), await readJson(request)));
    }
    const resumeAiMatch = url.pathname.match(/^\/dashboard\/sessions\/([^/]+)\/resume-ai$/);
    if (request.method === 'POST' && resumeAiMatch) {
      return toResponse(await handlers.dashboardResumeAi(decodeURIComponent(resumeAiMatch[1]), await readJson(request)));
    }
    const eventsMatch = url.pathname.match(/^\/dashboard\/events\/([^/]+)$/);
    if (request.method === 'GET' && eventsMatch) {
      return toResponse(handlers.dashboardEvents(decodeURIComponent(eventsMatch[1])));
    }

    return json({ errorCode: 'not_found' }, 404);
  },
  async queue(batch: WorkerQueueBatch<WorkerWebhookJob>, env: WorkerEnv): Promise<void> {
    const store = new D1Store(env.DB);
    await store.initialize();
    const dashboard = new DashboardEventBus({
      persistEvent: (event) => store.appendDashboardEvent(event),
    });
    const options = buildServerOptionsFromEnv({
      PORT: 0,
      DATABASE_URL: 'd1://DB',
      OPENAI_API_KEY: env.OPENAI_API_KEY ?? '',
      OPENAI_MODEL: env.OPENAI_MODEL ?? 'gpt-4.1',
      OPENAI_TOOL_PLANNER_MODEL: env.OPENAI_TOOL_PLANNER_MODEL ?? 'gpt-4.1-mini',
      OPENAI_RESPONSE_MODEL: env.OPENAI_RESPONSE_MODEL ?? 'gpt-4.1-mini',
      OPENAI_BASE_URL: env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
      LANGSMITH_API_KEY: env.LANGSMITH_API_KEY ?? '',
      LANGSMITH_PROJECT: env.LANGSMITH_PROJECT ?? 'kfc-agent-backend-worker',
      MESSENGER_VERIFY_TOKEN: env.MESSENGER_VERIFY_TOKEN ?? '',
      META_PAGE_ID: env.META_PAGE_ID ?? '',
      META_PAGE_ACCESS_TOKEN: env.META_PAGE_ACCESS_TOKEN ?? '',
      META_INBOX_URL_TEMPLATE: env.META_INBOX_URL_TEMPLATE ?? '',
      MESSENGER_GRAPH_API_BASE_URL: env.MESSENGER_GRAPH_API_BASE_URL ?? '',
      ZALO_OA_ID: env.ZALO_OA_ID ?? '',
      ZALO_ACCESS_TOKEN: env.ZALO_ACCESS_TOKEN ?? '',
      ZALO_INBOX_URL_TEMPLATE: env.ZALO_INBOX_URL_TEMPLATE ?? '',
      ZALO_REFRESH_TOKEN: env.ZALO_REFRESH_TOKEN ?? '',
      ZALO_APP_ID: env.ZALO_APP_ID ?? '',
      ZALO_APP_SECRET: env.ZALO_APP_SECRET ?? '',
      ZALO_API_BASE_URL: env.ZALO_API_BASE_URL ?? '',
    });
    const handlers = createRouteHandlers({
      ...options,
      fixtures: loadBundledGeneratedFixtures(),
      store,
      dashboard,
      messengerFetchImpl: env.MESSENGER_FETCH ?? fetch,
      zaloFetchImpl: env.ZALO_FETCH ?? fetch,
    });

    for (const message of batch.messages) {
      if (message.body.channel === 'zalo') {
        console.log('zalo_queue_processing_started', { queuedAt: message.body.queuedAt });
        const result = await handlers.zaloWebhook(message.body.payload);
        console.log('zalo_queue_processing_finished', { status: result.status });
        message.ack?.();
        continue;
      }

      console.log('messenger_queue_processing_started', {
        rawEventId: message.body.event.rawEventId,
        sessionId: message.body.sessionId,
      });
      const result = await handlers.processMessengerEvent(message.body.event);
      console.log('messenger_queue_processing_finished', {
        rawEventId: message.body.event.rawEventId,
        sessionId: message.body.sessionId,
        status: result.status,
        errorCode: result.errorCode,
      });
      message.ack?.();
    }
  },
};

async function enqueueMessengerWebhook(
  request: Request,
  env: WorkerEnv,
  store: D1Store,
): Promise<HandlerResponse> {
  if (!env.MESSENGER_WEBHOOK_QUEUE) {
    return { status: 503, body: { errorCode: 'messenger_webhook_queue_not_configured' } };
  }

  const events = normalizeMessengerWebhook(await readJson(request), env.META_PAGE_ID ?? '');
  const stats = { received: events.length, queued: 0, skippedDuplicates: 0, failed: 0 };
  console.log('messenger_webhook_received', { received: events.length });
  if (events.length === 0) return { status: 200, body: stats };

  for (const event of events) {
    const sessionId = sessionIdForConversationEvent(event);
    if (await store.findTurnByExternalMessage(sessionId, event.rawEventId)) {
      stats.skippedDuplicates += 1;
      console.log('messenger_webhook_duplicate_skipped', { rawEventId: event.rawEventId, sessionId });
      continue;
    }

    const reservation = await store.reserveWebhookDelivery({
      channel: 'messenger',
      externalEventId: event.rawEventId,
      externalThreadId: event.externalThreadId,
      externalUserId: event.externalUserId,
      sessionId,
      receivedAt: event.receivedAt,
      payload: {
        eventType: event.eventType,
        text: event.text,
        receivedAt: event.receivedAt,
      },
    });
    if (!reservation.reserved) {
      stats.skippedDuplicates += 1;
      console.log('messenger_webhook_duplicate_skipped', { rawEventId: event.rawEventId, sessionId });
      continue;
    }

    try {
      await env.MESSENGER_WEBHOOK_QUEUE.send({
        channel: 'messenger',
        event,
        sessionId,
        queuedAt: new Date().toISOString(),
      });
      stats.queued += 1;
      console.log('messenger_webhook_queued', { rawEventId: event.rawEventId, sessionId });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Messenger queue send failed';
      await store.markWebhookDeliveryFailed(
        'messenger',
        event.rawEventId,
        message,
      );
      stats.failed += 1;
      console.error('messenger_webhook_queue_failed', { rawEventId: event.rawEventId, sessionId, message });
    }
  }

  return { status: 200, body: stats };
}

function createWorkerMessengerHistorySync(
  store: D1Store,
  dashboard: DashboardEventBus,
  env: WorkerEnv,
): MessengerHistorySyncCoordinator | undefined {
  if (!env.META_PAGE_ID || !env.META_PAGE_ACCESS_TOKEN) return undefined;
  return new MessengerHistorySyncCoordinator(
    new MessengerHistorySyncService({
      pageId: env.META_PAGE_ID,
      store,
      dashboard,
      client: createMessengerHistoryClient({
        pageId: env.META_PAGE_ID,
        pageAccessToken: env.META_PAGE_ACCESS_TOKEN,
        graphApiBaseUrl: env.MESSENGER_GRAPH_API_BASE_URL || undefined,
        fetchImpl: env.MESSENGER_FETCH ?? fetch,
      }),
    }),
  );
}

async function syncWorkerMessengerHistory(
  store: D1Store,
  dashboard: DashboardEventBus,
  env: WorkerEnv,
): Promise<void> {
  const sync = createWorkerMessengerHistorySync(store, dashboard, env);
  if (!sync) return;
  await sync.sync({
    since: new Date(Date.now() - workerDashboardSessionDefaultLookbackMs).toISOString(),
  });
}

async function enqueueZaloWebhook(
  request: Request,
  env: WorkerEnv,
): Promise<HandlerResponse> {
  if (!env.MESSENGER_WEBHOOK_QUEUE) {
    return { status: 503, body: { errorCode: 'zalo_webhook_queue_not_configured' } };
  }

  const body = await readJson(request).catch(() => undefined);
  if (body === undefined) {
    return { status: 200, body: { received: 0, queued: 0, skippedDuplicates: 0, failed: 0 } };
  }

  let received = 0;
  try {
    received = normalizeZaloWebhook(body, env.ZALO_OA_ID ?? '').length;
  } catch {
    return { status: 200, body: { received: 0, queued: 0, skippedDuplicates: 0, failed: 0 } };
  }
  if (received === 0) {
    return { status: 200, body: { received: 0, queued: 0, skippedDuplicates: 0, failed: 0 } };
  }

  await env.MESSENGER_WEBHOOK_QUEUE.send({
    channel: 'zalo',
    payload: body,
    queuedAt: new Date().toISOString(),
  });
  return { status: 200, body: { received, queued: received, skippedDuplicates: 0, failed: 0 } };
}

async function listWorkerDashboardSessions(store: D1Store, env: WorkerEnv): Promise<
  Array<{
    sessionId: string;
    latestEventType: string;
    updatedAt: string;
    externalUserId: string | null;
    displayName: string | null;
    avatarUrl: string | null;
    deeplink: {
      status: 'available' | 'unavailable';
      url: string | null;
      reason?: string;
    };
  }>
> {
  const summaries = await store.listDashboardSessionSummaries();
  const updatedSinceMs = Date.now() - workerDashboardSessionDefaultLookbackMs;
  return Promise.all(
    summaries.filter((summary) => Date.parse(summary.updatedAt) >= updatedSinceMs).map(async (summary) => {
      const target = channelTargetForWorkerSession(summary.sessionId);
      const profile = target ? await store.getProfile(target.channel, target.externalUserId) : undefined;
      return {
        ...summary,
        externalUserId: target?.externalUserId ?? null,
        displayName: profile?.displayName ?? null,
        avatarUrl: profile?.avatarUrl ?? null,
        deeplink: deeplinkForWorkerSession(summary.sessionId, env),
      };
    }),
  );
}

function deeplinkForWorkerSession(
  sessionId: string,
  env: WorkerEnv,
): {
  status: 'available' | 'unavailable';
  url: string | null;
  reason?: string;
} {
  const target = channelTargetForWorkerSession(sessionId);
  if (!target) return { status: 'unavailable', url: null, reason: 'Unknown channel' };

  if (target.channel === 'messenger') {
    if (!env.META_INBOX_URL_TEMPLATE) return { status: 'unavailable', url: null, reason: 'Missing META_INBOX_URL_TEMPLATE' };
    if (!env.META_PAGE_ID) return { status: 'unavailable', url: null, reason: 'Missing META_PAGE_ID' };
    return {
      status: 'available',
      url: renderWorkerInboxUrlTemplate(env.META_INBOX_URL_TEMPLATE, {
        pageId: env.META_PAGE_ID,
        externalUserId: target.externalUserId,
        sessionId,
      }),
    };
  }

  if (!env.ZALO_INBOX_URL_TEMPLATE) return { status: 'unavailable', url: null, reason: 'Missing ZALO_INBOX_URL_TEMPLATE' };
  if (!env.ZALO_OA_ID) return { status: 'unavailable', url: null, reason: 'Missing ZALO_OA_ID' };
  return {
    status: 'available',
    url: renderWorkerInboxUrlTemplate(env.ZALO_INBOX_URL_TEMPLATE, {
      pageId: env.ZALO_OA_ID,
      externalUserId: target.externalUserId,
      sessionId,
    }),
  };
}

function renderWorkerInboxUrlTemplate(
  template: string,
  values: { pageId: string; externalUserId: string; sessionId: string },
): string {
  return template
    .replaceAll('{pageId}', encodeURIComponent(values.pageId))
    .replaceAll('{externalUserId}', encodeURIComponent(values.externalUserId))
    .replaceAll('{sessionId}', encodeURIComponent(values.sessionId));
}

function channelTargetForWorkerSession(sessionId: string): { channel: 'messenger' | 'zalo'; externalUserId: string } | undefined {
  const separatorIndex = sessionId.indexOf(':');
  if (separatorIndex === -1) return undefined;
  const channel = sessionId.slice(0, separatorIndex);
  const externalUserId = sessionId.slice(separatorIndex + 1);
  if (!externalUserId) return undefined;
  if (channel === 'messenger' || channel === 'zalo') return { channel, externalUserId };
  return undefined;
}

async function checkMessengerToken(env: WorkerEnv): Promise<{ ok: boolean; required: boolean; configured: boolean; message?: string }> {
  const token = env.META_PAGE_ACCESS_TOKEN ?? '';
  if (!token) {
    return { ok: false, required: true, configured: false, message: 'META_PAGE_ACCESS_TOKEN is not configured' };
  }

  const baseUrl = (env.MESSENGER_GRAPH_API_BASE_URL || 'https://graph.facebook.com').replace(/\/$/, '');
  const pageId = env.META_PAGE_ID ?? '';
  const endpoint = new URL(`${baseUrl}/${pageId}/subscribed_apps`);
  endpoint.searchParams.set('access_token', token);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await (env.MESSENGER_FETCH ?? fetch)(endpoint, { signal: controller.signal });
    const body = (await response.json().catch(() => ({}))) as {
      data?: unknown[];
      error?: { message?: string; code?: number; error_subcode?: number };
    };
    if (response.ok && Array.isArray(body.data)) return { ok: true, required: true, configured: true };
    return {
      ok: false,
      required: true,
      configured: true,
      message: body.error?.message ?? `Messenger token check failed with HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      required: true,
      configured: true,
      message: error instanceof Error ? error.message : 'Messenger token check failed',
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.trim().length === 0) return undefined;
  return JSON.parse(text);
}

function toResponse(response: HandlerResponse): Response {
  if (response.contentType?.startsWith('text/')) {
    return new Response(String(response.body), {
      status: response.status,
      headers: { ...corsHeaders(), 'Content-Type': response.contentType },
    });
  }
  return json(response.body, response.status);
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
  });
}

function text(value: string, status = 200): Response {
  return new Response(value, {
    status,
    headers: { ...corsHeaders(), 'Content-Type': 'text/plain' },
  });
}

function html(value: string, status = 200): Response {
  return new Response(value, {
    status,
    headers: { ...corsHeaders(), 'Content-Type': 'text/html; charset=utf-8' },
  });
}

function zaloSiteVerificationHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="zalo-platform-site-verification" content="${ZALO_SITE_VERIFICATION_TOKEN}">
    <title>Zalo Site Verification</title>
  </head>
  <body>Zalo site verification</body>
</html>`;
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  };
}
