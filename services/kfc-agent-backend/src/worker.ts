export { DashboardSocket } from './workerDashboardSocket.js';
import type { SanityClient } from '@sanity/client';
import { initializeWorkerStore } from './workerStore.js';
import {
  checkWorkerReadiness,
  type WorkerAgentReadiness,
} from './workerReadiness.js';
import {
  backfillWorkerMessengerProfiles,
  enqueueMessengerWebhook,
  enqueueZaloWebhook,
  staleDeliveryRecoveryOptionsFromUrl,
  syncWorkerMessengerHistory,
} from './workerMessaging.js';
import {
  authorizeDemoAdmin,
  corsHeaders,
  customerRunEventResponse,
  html,
  isRecord,
  json,
  readJson,
  requiresDemoAdmin,
  scheduleDashboardEvent,
  text,
  toResponse,
  ZALO_SITE_VERIFICATION_PATH,
  zaloSiteVerificationHtml,
} from './workerHttp.js';
import { workerSessionResetHook } from './workerLifecycle.js';
import {
  createRouteHandlers,
  type HandlerResponse,
  type RouteHandlers,
} from './api/routeHandlers.js';
import {
  invalidRecommendationJsonResponse,
  recommendationJsonResponse,
} from './api/routeRecommendationHandlers.js';
import {
  isAgentTraceFlushTask,
  type AgentTracer,
} from './observability/agentTracing.js';
import { authorizeDemoAdminHeaders } from './security/demoAdminAuth.js';
import {
  AgentRunCoordinator,
  type AgentRunWakeupJob,
} from './agentRuns/coordinator.js';
import {
  createMessengerHistoryClient,
  MessengerHistorySyncCoordinator,
  MessengerHistorySyncService,
} from './channels/messengerHistory.js';
import {
  createMessengerClient,
  normalizeMessengerWebhook,
  verifyMessengerChallenge,
} from './channels/messenger.js';
import { normalizeZaloWebhook } from './channels/zalo.js';
import { DashboardEventBus } from './dashboard/eventBus.js';
import { dashboardSessionTarget } from './dashboard/sessionVisibility.js';
import type { AgentMode, DashboardEvent } from './domain/types.js';
import { D1Store, type D1DatabaseLike } from './persistence/d1Store.js';
import type { ConversationStore } from './persistence/memoryStore.js';
import { sessionIdForConversationEvent } from './session/sessionContext.js';
import { fetchCatalogObservation } from './catalog/catalogObservation.js';
import { resolveAgentModelProfile } from './config/agentModelProfile.js';
import type { AgentModelCandidateId } from './config/agentModelProfile.js';
import { resolveMonitorModelProfile } from './config/monitorModelProfile.js';
import {
  D1LifecycleRepository,
  LifecycleError,
  SandboxLifecycleControls,
  lifecycleBinding,
} from './commerce/lifecycleProvider.js';
import { buildWorkerRouteOptions } from './workerRouteOptions.js';
import type { MessengerIngressClaim } from './security/messengerIngressClaim.js';
import { verifyQueuedMessengerIngress } from './workerMessengerIngress.js';
import { startDeferredWork } from './runtime/deferredWork.js';

export interface QueueBinding<T> {
  send(message: T, options?: { delaySeconds?: number }): Promise<void>;
}

export interface DurableObjectStubLike {
  fetch(request: Request | string, init?: RequestInit): Promise<Response>;
}

export interface DurableObjectNamespaceLike {
  getByName(name: string): DurableObjectStubLike;
}

export interface WorkerQueueMessage<T> {
  body: T;
  ack?(): void;
  retry?(): void;
}

export interface WorkerQueueBatch<T> {
  messages: Array<WorkerQueueMessage<T>>;
}

export interface WorkerScheduledController {
  scheduledTime: number;
}

export interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

// Timers scheduled after a Worker response may be clamped to one second.
// D1/SSE delivery already yields between durable event writes, so adding an
// artificial delay here can exhaust waitUntil before the run is terminal.
const WORKER_CUSTOMER_RUN_PACE_MS = 0;
const WORKER_CUSTOMER_RUN_MAX_TEXT_EVENTS = 3;

function backgroundErrorClass(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  return /^[A-Za-z][A-Za-z0-9]{0,63}$/u.test(name) ? name : 'UnknownError';
}

export function scheduleAgentBackground(
  context: WorkerExecutionContext | undefined,
  tasks: Array<() => Promise<void>>,
  tracer?: AgentTracer,
): void {
  if (tasks.length === 0 && !tracer) return;
  const traceFlushScheduled = tasks.some(isAgentTraceFlushTask);
  const work = startDeferredWork(async () => {
    for (const task of tasks) await task();
    if (!traceFlushScheduled) await tracer?.flush();
  }).catch((error) => {
    console.error('agent_background_failed', {
      errorClass: backgroundErrorClass(error),
    });
  });
  if (context) context.waitUntil(work);
  else void work;
}

export interface MessengerWebhookJob {
  channel: 'messenger_control_event';
  sessionId: string;
  externalMessageId: string;
  messengerIngressClaim: MessengerIngressClaim;
  queuedAt: string;
}

export interface ZaloWebhookJob {
  channel: 'zalo_control_event';
  payload: unknown;
  queuedAt: string;
}

export type MessengerAgentRunWakeupJob = AgentRunWakeupJob & {
  messengerExternalMessageId: string;
  messengerIngressClaim: MessengerIngressClaim;
};

export type WorkerWebhookJob =
  | MessengerWebhookJob
  | ZaloWebhookJob
  | AgentRunWakeupJob
  | MessengerAgentRunWakeupJob;

export interface WorkerEnv {
  DB: D1DatabaseLike;
  KFC_AGENT_CANDIDATE?: AgentModelCandidateId;
  KFC_MONITOR_CANDIDATE?: AgentModelCandidateId;
  OPENAI_API_KEY?: string;
  OPENCODE_API_KEY?: string;
  GOOGLE_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_GEO_CANARY_TOKEN?: string;
  LANGSMITH_API_KEY?: string;
  LANGSMITH_PROJECT?: string;
  LANGSMITH_ENDPOINT?: string;
  LANGSMITH_TRACING_SAMPLING_RATE?: string;
  KFC_SHOWCASE_DATASET?: string;
  MESSENGER_VERIFY_TOKEN?: string;
  META_PAGE_ID?: string;
  META_APP_SECRET?: string;
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
  KFC_DEMO_ADMIN_TOKEN?: string;
  KFC_RECOMMENDATION_SHADOW_URL?: string;
  KFC_RECOMMENDATION_SHADOW_MODEL_REVISION?: string;
  KFC_RECOMMENDATION_OUTPUT_MODE?: 'baseline' | 'learned_technical';
  SANITY_PROJECT_ID?: string;
  SANITY_DATASET?: string;
  SANITY_API_VERSION?: string;
  SANITY_READ_TOKEN?: string;
  /** Test-only injection seam; Cloudflare runtime uses the configured client. */
  SANITY_CLIENT?: SanityClient;
  RELEASE_GIT_SHA?: string;
  RELEASE_DEPLOYMENT_ID?: string;
  RELEASE_BUILT_AT?: string;
  RELEASE_DIRTY?: string;
  CF_VERSION_METADATA?: { id: string; tag: string; timestamp: string };
  DASHBOARD_SOCKET?: DurableObjectNamespaceLike;
}

function openAiDiagnosticEnv(env: WorkerEnv, request?: Request) {
  const placement = request?.headers.get('cf-placement') ?? '';
  const placedExecutionColo = /(?:^|[-_])([A-Z0-9]{3})$/.exec(placement)?.[1];
  const edgeColo = request
    ? (request as Request & { cf?: { colo?: string } }).cf?.colo
    : undefined;
  return {
    OPENAI_DIAGNOSTIC_WORKER_RELEASE:
      env.CF_VERSION_METADATA?.id ?? env.RELEASE_GIT_SHA ?? '',
    OPENAI_DIAGNOSTIC_EXECUTION_COLO: placedExecutionColo ?? '',
    OPENAI_DIAGNOSTIC_EDGE_COLO: edgeColo ?? '',
    OPENAI_DIAGNOSTIC_PLACEMENT: placement,
  };
}

function workerAgentReadiness(env: WorkerEnv): WorkerAgentReadiness {
  const agentCandidateId = env.KFC_AGENT_CANDIDATE ?? 'openai-gpt-4.1-mini';
  const credentialConfigured = (
    credentialEnv: 'OPENAI_API_KEY' | 'OPENCODE_API_KEY' | 'GOOGLE_API_KEY',
  ) => Boolean(env[credentialEnv]?.trim());
  let agentReadiness: WorkerAgentReadiness;
  try {
    const identity = resolveAgentModelProfile({
      candidateId: agentCandidateId,
    });
    agentReadiness = {
      identity,
      configured: credentialConfigured(identity.credentialEnv),
    };
  } catch {
    agentReadiness = {
      configured: false,
      configurationError: true,
    };
  }
  let monitor: WorkerAgentReadiness['monitor'];
  try {
    const monitorIdentity = resolveMonitorModelProfile({
      agentCandidateId,
      candidateId: env.KFC_MONITOR_CANDIDATE,
    });
    monitor = {
      identity: monitorIdentity,
      configured: credentialConfigured(monitorIdentity.credentialEnv),
    };
  } catch {
    monitor = {
      configured: false,
      configurationError: true,
    };
  }
  return {
    ...agentReadiness,
    monitor,
  };
}

export async function dispatchWorkerRecommendationRoute(
  request: Request,
  handlers: Pick<
    RouteHandlers,
    | 'recommendationDecide'
    | 'recommendationImpression'
    | 'recommendationOutcome'
    | 'recommendationInspection'
    | 'recommendationOrderFlowState'
  >,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  const readRecommendationJson = async (): Promise<
    { ok: true; body: unknown } | { ok: false; response: Response }
  > => {
    const mediaType = request.headers
      .get('content-type')
      ?.split(';', 1)[0]
      ?.trim()
      .toLowerCase();
    if (mediaType !== 'application/json') {
      const response = invalidRecommendationJsonResponse(
        request.method,
        url.pathname,
      );
      if (response) return { ok: false, response: toResponse(response) };
    }
    try {
      return { ok: true, body: await readJson(request) };
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      const response = invalidRecommendationJsonResponse(
        request.method,
        url.pathname,
      );
      if (!response) throw error;
      return { ok: false, response: toResponse(response) };
    }
  };

  if (
    request.method === 'POST' &&
    url.pathname === '/v1/recommendations/decide'
  ) {
    const body = await readRecommendationJson();
    return body.ok
      ? toResponse(await handlers.recommendationDecide(body.body))
      : body.response;
  }
  const recommendationImpressionMatch = url.pathname.match(
    /^\/v1\/recommendations\/([^/]+)\/impressions$/u,
  );
  if (request.method === 'POST' && recommendationImpressionMatch) {
    const body = await readRecommendationJson();
    return body.ok
      ? toResponse(
          await handlers.recommendationImpression(
            decodeURIComponent(recommendationImpressionMatch[1]!),
            body.body,
          ),
        )
      : body.response;
  }
  const recommendationOutcomeMatch = url.pathname.match(
    /^\/v1\/recommendations\/([^/]+)\/outcomes$/u,
  );
  if (request.method === 'POST' && recommendationOutcomeMatch) {
    const body = await readRecommendationJson();
    return body.ok
      ? toResponse(
          await handlers.recommendationOutcome(
            decodeURIComponent(recommendationOutcomeMatch[1]!),
            body.body,
          ),
        )
      : body.response;
  }
  const recommendationInspectionMatch = url.pathname.match(
    /^\/admin\/recommendations\/([^/]+)\/inspection$/u,
  );
  if (request.method === 'GET' && recommendationInspectionMatch) {
    return toResponse(
      await handlers.recommendationInspection(
        decodeURIComponent(recommendationInspectionMatch[1]!),
      ),
    );
  }
  const recommendationOrderFlowMatch = url.pathname.match(
    /^\/admin\/recommendations\/order-flows\/([^/]+)\/state$/u,
  );
  if (request.method === 'GET' && recommendationOrderFlowMatch) {
    return toResponse(
      await handlers.recommendationOrderFlowState(
        decodeURIComponent(recommendationOrderFlowMatch[1]!),
      ),
    );
  }
  return undefined;
}

export default {
  async fetch(
    request: Request,
    env: WorkerEnv,
    context?: WorkerExecutionContext,
  ): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const url = new URL(request.url);
    if (requiresDemoAdmin(url.pathname)) {
      const auth = authorizeDemoAdmin(request, env);
      if (!auth.ok) {
        if (url.pathname.startsWith('/admin/recommendations/')) {
          return toResponse(
            recommendationJsonResponse({
              status: auth.status,
              body: { errorCode: auth.errorCode },
            }),
          );
        }
        return json({ errorCode: auth.errorCode }, auth.status);
      }
    }
    if (
      request.method === 'GET' &&
      (url.pathname === '/' || url.pathname === ZALO_SITE_VERIFICATION_PATH)
    ) {
      return html(zaloSiteVerificationHtml());
    }
    if (request.method === 'GET' && url.pathname === '/health') {
      const diagnostics = openAiDiagnosticEnv(env, request);
      return json({
        ok: true,
        service: 'kfc-agent-backend',
        workerVersionId: env.CF_VERSION_METADATA?.id,
        workerReleaseGitSha: env.RELEASE_GIT_SHA,
        executionColo:
          diagnostics.OPENAI_DIAGNOSTIC_EXECUTION_COLO || undefined,
        edgeColo: diagnostics.OPENAI_DIAGNOSTIC_EDGE_COLO || undefined,
        placement: diagnostics.OPENAI_DIAGNOSTIC_PLACEMENT || undefined,
      });
    }
    if (request.method === 'GET' && url.pathname === '/webhooks/messenger') {
      const result = verifyMessengerChallenge(
        Object.fromEntries(url.searchParams.entries()),
        env.MESSENGER_VERIFY_TOKEN ?? '',
      );
      return text(result.body, result.statusCode);
    }
    if (request.method === 'GET' && url.pathname === '/dashboard/socket') {
      if (!env.DASHBOARD_SOCKET) {
        return json({ errorCode: 'dashboard_socket_unavailable' }, 503);
      }
      return env.DASHBOARD_SOCKET.getByName('operations').fetch(request);
    }
    if (url.pathname === '/dashboard/stream') {
      return json(
        {
          errorCode: 'worker_sse_not_supported',
          message: 'Use the /dashboard/socket WebSocket endpoint.',
        },
        501,
      );
    }
    if (
      request.method === 'POST' &&
      url.pathname === '/webhooks/zalo' &&
      env.MESSENGER_WEBHOOK_QUEUE
    ) {
      return toResponse(await enqueueZaloWebhook(request, env, context));
    }

    const store = new D1Store(env.DB, workerSessionResetHook(env));
    await initializeWorkerStore(store, env.DB);
    if (request.method === 'GET' && url.pathname === '/ready') {
      const readiness = await checkWorkerReadiness(
        env,
        url.searchParams.get('deep') === '1',
        workerAgentReadiness(env),
      );
      return json(readiness, readiness.ok ? 200 : 503);
    }
    if (request.method === 'POST' && url.pathname === '/webhooks/messenger') {
      return toResponse(
        await enqueueMessengerWebhook(request, env, store, context),
      );
    }
    const fastEventsMatch = url.pathname.match(
      /^\/dashboard\/events\/([^/]+)$/,
    );
    if (request.method === 'GET' && fastEventsMatch) {
      return json({
        events: await store.listDashboardEvents(
          decodeURIComponent(fastEventsMatch[1]),
        ),
      });
    }

    const fastTurnsMatch = url.pathname.match(
      /^\/dashboard\/sessions\/([^/]+)\/turns$/,
    );
    if (request.method === 'GET' && fastTurnsMatch) {
      const sessionId = decodeURIComponent(fastTurnsMatch[1]);
      const requestedLimit = Number(url.searchParams.get('limit') ?? 10);
      const turnLimit = Number.isFinite(requestedLimit)
        ? Math.min(100, Math.max(1, Math.floor(requestedLimit)))
        : 10;
      let turns = await store.listRecentTurns(sessionId, turnLimit);
      if (
        turns.length === 0 &&
        sessionId.startsWith('messenger:') &&
        url.searchParams.get('sync') === '1'
      ) {
        const dashboard = new DashboardEventBus({
          persistEvent: (event) =>
            scheduleDashboardEvent(env, store, event, context),
        });
        try {
          await syncWorkerMessengerHistory(store, dashboard, env);
          turns = await store.listRecentTurns(sessionId, turnLimit);
        } catch (error) {
          console.warn('worker_dashboard_turns_history_sync_failed', {
            sessionId,
            message:
              error instanceof Error
                ? error.message
                : 'Messenger history sync failed',
          });
        }
      }
      return json({ turns });
    }

    const fastControlMatch = url.pathname.match(
      /^\/dashboard\/sessions\/([^/]+)\/control$/,
    );
    if (request.method === 'GET' && fastControlMatch) {
      return json(
        await store.getSessionControl(decodeURIComponent(fastControlMatch[1])),
      );
    }

    const demoResetMatch = url.pathname.match(
      /^\/dashboard\/sessions\/([^/]+)\/demo-reset$/,
    );
    if (request.method === 'POST' && demoResetMatch) {
      const auth = authorizeDemoAdmin(request, env);
      if (!auth.ok) return json({ errorCode: auth.errorCode }, auth.status);
      return json(
        await store.resetSession(decodeURIComponent(demoResetMatch[1])),
      );
    }

    const shouldLoadDashboardEvents =
      request.method === 'GET' &&
      (url.pathname === '/dashboard/sessions' ||
        /^\/dashboard\/events\/([^/]+)$/.test(url.pathname));
    const dashboard = new DashboardEventBus({
      initialEvents: shouldLoadDashboardEvents
        ? await store.listDashboardEvents()
        : undefined,
      persistEvent: (event) =>
        scheduleDashboardEvent(env, store, event, context),
    });
    const { routeOptions: options, deferredAgentTasks } =
      buildWorkerRouteOptions({
        env,
        store,
        dashboard,
        surface: {
          kind: 'fetch',
          request,
          customerRunPaceMs: WORKER_CUSTOMER_RUN_PACE_MS,
          customerRunMaxTextEvents: WORKER_CUSTOMER_RUN_MAX_TEXT_EVENTS,
        },
      });
    const handlers = createRouteHandlers(options);
    const respondWithAgentBackground = (result: HandlerResponse): Response => {
      scheduleAgentBackground(context, deferredAgentTasks, options.agentTracer);
      return toResponse(result);
    };

    const recommendationResponse = await dispatchWorkerRecommendationRoute(
      request,
      handlers,
    );
    if (recommendationResponse) return recommendationResponse;
    const lifecycleCreateMatch = url.pathname.match(
      /^\/admin\/lifecycle\/sessions\/([^/]+)\/instances$/,
    );
    if (request.method === 'POST' && lifecycleCreateMatch) {
      return toResponse(
        await handlers.lifecycleCreate(
          decodeURIComponent(lifecycleCreateMatch[1]!),
        ),
      );
    }
    const lifecycleInstanceMatch = url.pathname.match(
      /^\/admin\/lifecycle\/instances\/([^/]+)$/,
    );
    if (request.method === 'GET' && lifecycleInstanceMatch) {
      return toResponse(
        await handlers.lifecycleGet(
          decodeURIComponent(lifecycleInstanceMatch[1]!),
        ),
      );
    }
    const lifecycleEventMatch = url.pathname.match(
      /^\/admin\/lifecycle\/instances\/([^/]+)\/events$/,
    );
    if (request.method === 'POST' && lifecycleEventMatch) {
      return toResponse(
        await handlers.lifecycleEvent(
          decodeURIComponent(lifecycleEventMatch[1]!),
          await readJson(request),
        ),
      );
    }
    const messengerProofMatch = url.pathname.match(
      /^\/admin\/proof\/messenger\/sessions\/([^/]+)\/envelope$/,
    );
    if (request.method === 'GET' && messengerProofMatch) {
      const sessionId = decodeURIComponent(messengerProofMatch[1]!);
      if (!sessionId.startsWith('messenger:'))
        return json({ errorCode: 'invalid_messenger_session' }, 400);
      return toResponse(await handlers.messengerProofEnvelope(sessionId));
    }
    const kfcProofMatch = url.pathname.match(
      /^\/admin\/proof\/kfc\/sessions\/([^/]+)\/envelope$/,
    );
    if (request.method === 'GET' && kfcProofMatch) {
      const sessionId = decodeURIComponent(kfcProofMatch[1]!);
      if (!sessionId.startsWith('kfc:'))
        return json({ errorCode: 'invalid_kfc_session' }, 400);
      return toResponse(await handlers.kfcProofEnvelope(sessionId));
    }
    const kfcProofPreconditionsMatch = url.pathname.match(
      /^\/admin\/proof\/kfc\/sessions\/([^/]+)\/preconditions$/,
    );
    if (request.method === 'POST' && kfcProofPreconditionsMatch) {
      const sessionId = decodeURIComponent(kfcProofPreconditionsMatch[1]!);
      if (!sessionId.startsWith('kfc:'))
        return json({ errorCode: 'invalid_kfc_session' }, 400);
      return toResponse(
        await handlers.kfcProofPreconditions(
          sessionId,
          await readJson(request),
        ),
      );
    }
    if (request.method === 'POST' && url.pathname === '/webhooks/zalo') {
      return respondWithAgentBackground(
        await handlers.zaloWebhook(await readJson(request)),
      );
    }
    if (request.method === 'GET' && url.pathname === '/showcase/scenarios') {
      return toResponse(await handlers.showcaseCatalog());
    }
    if (request.method === 'POST' && url.pathname === '/chat/kfc/message') {
      const body = await readJson(request);
      return respondWithAgentBackground(await handlers.chatKfcMessage(body));
    }
    if (
      request.method === 'POST' &&
      url.pathname === '/chat/kfc/genui-action'
    ) {
      return respondWithAgentBackground(
        await handlers.chatKfcGenUiAction(await readJson(request)),
      );
    }
    if (request.method === 'POST' && url.pathname === '/chat/kfc/runs') {
      const body = await readJson(request);
      return respondWithAgentBackground(await handlers.chatKfcStartRun(body));
    }
    const customerRunCancelMatch = url.pathname.match(
      /^\/chat\/kfc\/runs\/([^/]+)\/cancel$/,
    );
    if (request.method === 'POST' && customerRunCancelMatch) {
      return toResponse(
        await handlers.chatKfcCancelRun(
          decodeURIComponent(customerRunCancelMatch[1]!),
        ),
      );
    }
    const customerRunEventsMatch = url.pathname.match(
      /^\/chat\/kfc\/runs\/([^/]+)\/events$/,
    );
    if (request.method === 'GET' && customerRunEventsMatch) {
      const runId = decodeURIComponent(customerRunEventsMatch[1]!);
      const run = await store.getCustomerRun(runId);
      if (!run) return json({ errorCode: 'run_not_found' }, 404);
      const after = Number(url.searchParams.get('after') ?? '0');
      if (!Number.isInteger(after) || after < 0)
        return json({ errorCode: 'invalid_cursor' }, 400);
      return customerRunEventResponse(store, runId, after, request.signal);
    }
    if (
      request.method === 'POST' &&
      url.pathname === '/admin/messenger/sync-history'
    ) {
      return toResponse(
        await handlers.messengerHistorySync(await readJson(request)),
      );
    }
    const kfcUpdatesMatch = url.pathname.match(
      /^\/chat\/kfc\/sessions\/([^/]+)\/updates$/,
    );
    if (request.method === 'GET' && kfcUpdatesMatch) {
      return toResponse(
        await handlers.chatKfcSessionUpdates(
          decodeURIComponent(kfcUpdatesMatch[1]!),
          url.searchParams.get('after') ?? undefined,
        ),
      );
    }
    if (
      request.method === 'GET' &&
      url.pathname === '/admin/messenger/sync-history/status'
    ) {
      return toResponse(handlers.messengerHistorySyncStatus());
    }
    if (
      request.method === 'POST' &&
      url.pathname === '/admin/messenger/recover-stale-deliveries'
    ) {
      const auth = authorizeDemoAdmin(request, env);
      if (!auth.ok) return json({ errorCode: auth.errorCode }, auth.status);
      return respondWithAgentBackground(
        await handlers.recoverStaleMessengerDeliveries(
          staleDeliveryRecoveryOptionsFromUrl(url),
        ),
      );
    }
    if (
      request.method === 'POST' &&
      url.pathname === '/admin/messenger/backfill-profiles'
    ) {
      return toResponse(await backfillWorkerMessengerProfiles(store, env));
    }
    if (request.method === 'GET' && url.pathname === '/dashboard/sessions') {
      return respondWithAgentBackground(await handlers.dashboardSessions());
    }

    const turnsMatch = url.pathname.match(
      /^\/dashboard\/sessions\/([^/]+)\/turns$/,
    );
    if (request.method === 'GET' && turnsMatch) {
      return toResponse(
        await handlers.dashboardTurns(decodeURIComponent(turnsMatch[1])),
      );
    }
    const humanJoinMatch = url.pathname.match(
      /^\/dashboard\/sessions\/([^/]+)\/human-join$/,
    );
    if (request.method === 'POST' && humanJoinMatch) {
      return respondWithAgentBackground(
        await handlers.dashboardHumanJoin(
          decodeURIComponent(humanJoinMatch[1]),
          await readJson(request),
        ),
      );
    }
    const humanMessageMatch = url.pathname.match(
      /^\/dashboard\/sessions\/([^/]+)\/human-message$/,
    );
    if (request.method === 'POST' && humanMessageMatch) {
      return respondWithAgentBackground(
        await handlers.dashboardHumanMessage(
          decodeURIComponent(humanMessageMatch[1]),
          await readJson(request),
        ),
      );
    }
    const resumeAiMatch = url.pathname.match(
      /^\/dashboard\/sessions\/([^/]+)\/resume-ai$/,
    );
    if (request.method === 'POST' && resumeAiMatch) {
      return respondWithAgentBackground(
        await handlers.dashboardResumeAi(
          decodeURIComponent(resumeAiMatch[1]),
          await readJson(request),
        ),
      );
    }
    const eventsMatch = url.pathname.match(/^\/dashboard\/events\/([^/]+)$/);
    if (request.method === 'GET' && eventsMatch) {
      return toResponse(
        handlers.dashboardEvents(decodeURIComponent(eventsMatch[1])),
      );
    }

    return json({ errorCode: 'not_found' }, 404);
  },
  async queue(
    batch: WorkerQueueBatch<WorkerWebhookJob>,
    env: WorkerEnv,
    context?: WorkerExecutionContext,
  ): Promise<void> {
    const store = new D1Store(env.DB, workerSessionResetHook(env));
    await initializeWorkerStore(store, env.DB);
    const dashboard = new DashboardEventBus({
      persistEvent: (event) =>
        scheduleDashboardEvent(env, store, event, context),
    });
    const { routeOptions: options, deferredAgentTasks } =
      buildWorkerRouteOptions({
        env,
        store,
        dashboard,
        surface: { kind: 'queue' },
      });
    const handlers = createRouteHandlers(options);

    for (const message of batch.messages) {
      if (message.body.channel === 'agent_run_wakeup') {
        const waitMs = Date.parse(message.body.dueAt) - Date.now();
        if (waitMs > 0)
          await new Promise((resolve) =>
            setTimeout(resolve, Math.min(waitMs, 2_000)),
          );
        const coordinator = new AgentRunCoordinator({ store, dashboard });
        const result = await coordinator.claimWakeupRun(message.body);
        let verifiedIngress;
        if (
          'messengerIngressClaim' in message.body &&
          'messengerExternalMessageId' in message.body &&
          env.META_APP_SECRET
        ) {
          const delivery = await store.getWebhookDelivery(
            'messenger',
            message.body.messengerExternalMessageId,
          );
          const verified = delivery
            ? await verifyQueuedMessengerIngress({
                claim: message.body.messengerIngressClaim,
                delivery,
                expectedExternalMessageId:
                  message.body.messengerExternalMessageId,
                expectedSessionId: message.body.sessionId,
                expectedQueueBinding: {
                  kind: 'agent_run_wakeup',
                  generation: message.body.generation,
                },
                appSecret: env.META_APP_SECRET,
              })
            : undefined;
          if (verified) verifiedIngress = [verified.verifiedIngress];
          else {
            console.warn('messenger_ingress_claim_rejected', {
              sessionId: message.body.sessionId,
              externalMessageId: message.body.messengerExternalMessageId,
            });
          }
        }
        if (result.dispatch && result.runId) {
          await handlers.processMessengerAgentRun(
            result.runId,
            verifiedIngress,
          );
        }
        console.log('agent_run_wakeup_processed', {
          sessionId: message.body.sessionId,
          generation: message.body.generation,
          claimed: result.claimed,
          dispatch: result.dispatch,
          reason: result.reason,
        });
        message.ack?.();
        continue;
      }

      if (message.body.channel === 'zalo_control_event') {
        console.log('zalo_queue_processing_started', {
          queuedAt: message.body.queuedAt,
        });
        const result = await handlers.zaloWebhook(message.body.payload);
        console.log('zalo_queue_processing_finished', {
          status: result.status,
        });
        message.ack?.();
        continue;
      }

      if (message.body.channel !== 'messenger_control_event') {
        message.ack?.();
        continue;
      }
      console.log('messenger_queue_processing_started', {
        rawEventId: message.body.externalMessageId,
        sessionId: message.body.sessionId,
      });
      const delivery = await store.getWebhookDelivery(
        'messenger',
        message.body.externalMessageId,
      );
      const verified =
        delivery && env.META_APP_SECRET
          ? await verifyQueuedMessengerIngress({
              claim: message.body.messengerIngressClaim,
              delivery,
              expectedExternalMessageId: message.body.externalMessageId,
              expectedSessionId: message.body.sessionId,
              expectedQueueBinding: { kind: 'messenger_control_event' },
              appSecret: env.META_APP_SECRET,
            })
          : undefined;
      if (!verified) {
        if (delivery) {
          await store.markWebhookDeliveryFailed(
            'messenger',
            message.body.externalMessageId,
            'messenger_ingress_claim_invalid',
          );
        }
        console.warn('messenger_ingress_claim_rejected', {
          sessionId: message.body.sessionId,
          externalMessageId: message.body.externalMessageId,
        });
        message.ack?.();
        continue;
      }
      const result = await handlers.processMessengerEvent(verified.event);
      console.log('messenger_queue_processing_finished', {
        rawEventId: message.body.externalMessageId,
        sessionId: message.body.sessionId,
        status: result.status,
        errorCode: result.errorCode,
      });
      message.ack?.();
    }
    scheduleAgentBackground(context, deferredAgentTasks, options.agentTracer);
  },
  async scheduled(
    controller: WorkerScheduledController,
    env: WorkerEnv,
    context?: WorkerExecutionContext,
  ): Promise<void> {
    const store = new D1Store(env.DB, workerSessionResetHook(env));
    await initializeWorkerStore(store, env.DB);
    const dashboard = new DashboardEventBus({
      persistEvent: (event) =>
        scheduleDashboardEvent(env, store, event, context),
    });
    const { routeOptions: options, deferredAgentTasks } =
      buildWorkerRouteOptions({
        env,
        store,
        dashboard,
        surface: { kind: 'scheduled' },
      });
    const handlers = createRouteHandlers(options);
    const staleDeliveryRecovery =
      await handlers.recoverStaleMessengerDeliveries();
    console.log(
      'messenger_stale_delivery_recovery_finished',
      staleDeliveryRecovery.body,
    );

    const coordinator = new AgentRunCoordinator({ store, dashboard });
    const results = await coordinator.claimDueRuns(
      new Date(controller.scheduledTime).toISOString(),
    );
    for (const result of results) {
      if (result.dispatch && result.runId) {
        await handlers.processMessengerAgentRun(result.runId);
      }
    }
    console.log('agent_run_recovery_processed', {
      scheduledTime: new Date(controller.scheduledTime).toISOString(),
      dueSessions: results.length,
      claimed: results.filter((result) => result.claimed).length,
    });
    scheduleAgentBackground(context, deferredAgentTasks, options.agentTracer);
  },
};
