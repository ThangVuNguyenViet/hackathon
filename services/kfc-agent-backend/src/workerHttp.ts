import type { HandlerResponse } from './api/routeHandlers.js';
import { dashboardSessionTarget } from './dashboard/sessionVisibility.js';
import type { AgentMode, DashboardEvent } from './domain/types.js';
import { D1Store } from './persistence/d1Store.js';
import type { ConversationStore } from './persistence/memoryStore.js';
import { authorizeDemoAdminHeaders } from './security/demoAdminAuth.js';
import type { WorkerEnv, WorkerExecutionContext } from './worker.js';

export const ZALO_SITE_VERIFICATION_TOKEN =
  'JUwvDeVE5W07swqXmF5wFpdComBLkX5UCpCm';

export const ZALO_SITE_VERIFICATION_PATH = `/zalo_verifier${ZALO_SITE_VERIFICATION_TOKEN}.html`;

export const workerDashboardSessionDefaultLookbackMs = 24 * 60 * 60 * 1000;

export async function listWorkerDashboardSessions(
  store: D1Store,
  env: WorkerEnv,
): Promise<
  Array<{
    sessionId: string;
    latestEventType: string;
    updatedAt: string;
    agentMode: AgentMode;
    assignedAgentId: string | null;
    controlUpdatedAt: string;
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
  const profiles = new Map(
    (await store.listProfiles()).map((profile) => [
      `${profile.channel}:${profile.externalUserId}`,
      profile,
    ]),
  );
  const updatedSinceMs = Date.now() - workerDashboardSessionDefaultLookbackMs;
  const visibleSummaries = summaries
    .filter(
      (summary) =>
        channelTargetForWorkerSession(summary.sessionId) !== undefined,
    )
    .filter((summary) => Date.parse(summary.updatedAt) >= updatedSinceMs);
  const controls = await store.listSessionControls(
    visibleSummaries.map((summary) => summary.sessionId),
  );
  return Promise.all(
    visibleSummaries.map(async (summary) => {
      const target = channelTargetForWorkerSession(summary.sessionId);
      const profile = target
        ? profiles.get(`${target.channel}:${target.externalUserId}`)
        : undefined;
      const control =
        controls.get(summary.sessionId) ??
        defaultWorkerSessionControl(summary.sessionId);
      return {
        ...summary,
        agentMode: control.agentMode,
        assignedAgentId: control.assignedAgentId,
        controlUpdatedAt: control.updatedAt,
        externalUserId: target?.externalUserId ?? null,
        displayName: profile?.displayName ?? null,
        avatarUrl: profile?.avatarUrl ?? null,
        deeplink: deeplinkForWorkerSession(summary.sessionId, env),
      };
    }),
  );
}

export function defaultWorkerSessionControl(sessionId: string) {
  return {
    sessionId,
    agentMode: 'ai_active' as const,
    assignedAgentId: null,
    updatedAt: new Date(0).toISOString(),
  };
}

export function deeplinkForWorkerSession(
  sessionId: string,
  env: WorkerEnv,
): {
  status: 'available' | 'unavailable';
  url: string | null;
  reason?: string;
} {
  const target = channelTargetForWorkerSession(sessionId);
  if (!target)
    return { status: 'unavailable', url: null, reason: 'Unknown channel' };

  if (target.channel === 'messenger') {
    if (!env.META_INBOX_URL_TEMPLATE)
      return {
        status: 'unavailable',
        url: null,
        reason: 'Missing META_INBOX_URL_TEMPLATE',
      };
    if (!env.META_PAGE_ID)
      return {
        status: 'unavailable',
        url: null,
        reason: 'Missing META_PAGE_ID',
      };
    return {
      status: 'available',
      url: renderWorkerInboxUrlTemplate(env.META_INBOX_URL_TEMPLATE, {
        pageId: env.META_PAGE_ID,
        externalUserId: target.externalUserId,
        sessionId,
      }),
    };
  }

  if (target.channel === 'kfc') {
    return {
      status: 'unavailable',
      url: null,
      reason: 'KFC chat deeplink disabled',
    };
  }

  if (!env.ZALO_INBOX_URL_TEMPLATE)
    return {
      status: 'unavailable',
      url: null,
      reason: 'Missing ZALO_INBOX_URL_TEMPLATE',
    };
  if (!env.ZALO_OA_ID)
    return { status: 'unavailable', url: null, reason: 'Missing ZALO_OA_ID' };
  return {
    status: 'available',
    url: renderWorkerInboxUrlTemplate(env.ZALO_INBOX_URL_TEMPLATE, {
      pageId: env.ZALO_OA_ID,
      externalUserId: target.externalUserId,
      sessionId,
    }),
  };
}

export function renderWorkerInboxUrlTemplate(
  template: string,
  values: { pageId: string; externalUserId: string; sessionId: string },
): string {
  return template
    .replaceAll('{pageId}', encodeURIComponent(values.pageId))
    .replaceAll('{externalUserId}', encodeURIComponent(values.externalUserId))
    .replaceAll('{sessionId}', encodeURIComponent(values.sessionId));
}

export function channelTargetForWorkerSession(
  sessionId: string,
):
  | { channel: 'messenger' | 'zalo' | 'kfc'; externalUserId: string }
  | undefined {
  return dashboardSessionTarget(sessionId);
}

export async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.trim().length === 0) return undefined;
  return JSON.parse(text);
}

export function toResponse(response: HandlerResponse): Response {
  if (response.contentType?.startsWith('text/')) {
    return new Response(String(response.body), {
      status: response.status,
      headers: { ...corsHeaders(), 'Content-Type': response.contentType },
    });
  }
  return json(response.body, response.status);
}

export function customerRunEventResponse(
  store: ConversationStore,
  runId: string,
  after: number,
  signal: AbortSignal,
): Response {
  const encoder = new TextEncoder();
  let stopped = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (value: string) =>
        controller.enqueue(encoder.encode(value));
      const heartbeat = setInterval(() => {
        if (!stopped) write(': heartbeat\n\n');
      }, 10_000);
      const stop = () => {
        if (stopped) return;
        stopped = true;
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* client already disconnected */
        }
      };
      signal.addEventListener('abort', stop, { once: true });
      setTimeout(stop, 25_000);
      write(': connected\n\n');
      void (async () => {
        let cursor = after;
        let pollDelayMs = 100;
        while (!stopped) {
          const [events, run] = await Promise.all([
            store.listCustomerRunEvents(runId, cursor),
            store.getCustomerRun(runId),
          ]);
          for (const event of events) {
            if (stopped) return;
            cursor = event.sequence;
            write(
              `id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
            );
          }
          pollDelayMs =
            events.length > 0 ? 100 : Math.min(pollDelayMs * 2, 1_000);
          if (
            run &&
            ['completed', 'failed', 'cancelled', 'superseded'].includes(
              run.status,
            ) &&
            cursor >= run.nextEventSequence - 1
          ) {
            stop();
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, pollDelayMs));
        }
      })().catch((error) => controller.error(error));
    },
  });
  return new Response(body, {
    status: 200,
    headers: {
      ...corsHeaders(),
      'Cache-Control': 'no-cache, no-transform',
      'Content-Type': 'text/event-stream; charset=utf-8',
      'X-Accel-Buffering': 'no',
    },
  });
}

export async function persistDashboardEvent(
  env: WorkerEnv,
  store: Pick<ConversationStore, 'appendDashboardEvent'>,
  event: DashboardEvent,
): Promise<void> {
  await store.appendDashboardEvent(event);
  if (!env.DASHBOARD_SOCKET) return;
  try {
    await env.DASHBOARD_SOCKET.getByName('operations').fetch(
      'https://dashboard-socket/events',
      {
        method: 'POST',
        body: JSON.stringify(event),
      },
    );
  } catch {
    // Durable event persistence remains authoritative during socket outages.
  }
}

export function scheduleDashboardEvent(
  env: WorkerEnv,
  store: Pick<ConversationStore, 'appendDashboardEvent'>,
  event: DashboardEvent,
  context?: WorkerExecutionContext,
): Promise<void> | void {
  const work = persistDashboardEvent(env, store, event);
  if (!context) return work;
  context.waitUntil(work);
}

export function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      ...corsHeaders(),
      'Cache-Control': 'no-store, no-cache, max-age=0',
      'Content-Type': 'application/json',
    },
  });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function text(value: string, status = 200): Response {
  return new Response(value, {
    status,
    headers: {
      ...corsHeaders(),
      'Cache-Control': 'no-store, no-cache, max-age=0',
      'Content-Type': 'text/plain',
    },
  });
}

export function html(value: string, status = 200): Response {
  return new Response(value, {
    status,
    headers: {
      ...corsHeaders(),
      'Cache-Control': 'no-store, no-cache, max-age=0',
      'Content-Type': 'text/html; charset=utf-8',
    },
  });
}

export function authorizeDemoAdmin(
  request: Request,
  env: WorkerEnv,
): { ok: true } | { ok: false; status: number; errorCode: string } {
  return authorizeDemoAdminHeaders({
    expectedToken: env.KFC_DEMO_ADMIN_TOKEN,
    authorizationHeader: request.headers.get('authorization') ?? undefined,
    tokenHeader: request.headers.get('x-kfc-demo-admin-token') ?? undefined,
  });
}

export function requiresDemoAdmin(pathname: string): boolean {
  return pathname.startsWith('/admin/') || pathname.startsWith('/dashboard/');
}

export function zaloSiteVerificationHtml(): string {
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

export function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers':
      'Content-Type,Authorization,X-KFC-Demo-Admin-Token',
  };
}
