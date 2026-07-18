export { DashboardSocket } from './workerDashboardSocket.js';
import { initializeWorkerStore, workerCheckpointer } from './workerStore.js';
import { checkMessengerToken, checkWorkerReadiness } from './workerReadiness.js';
import { backfillWorkerMessengerProfiles, createWorkerMessengerHistorySync, enqueueMessengerWebhook, enqueueZaloWebhook, staleDeliveryRecoveryOptionsFromUrl, syncWorkerMessengerHistory } from './workerMessaging.js';
import { authorizeDemoAdmin, corsHeaders, customerRunEventResponse, html, isRecord, json, listWorkerDashboardSessions, readJson, requiresDemoAdmin, scheduleDashboardEvent, text, toResponse, ZALO_SITE_VERIFICATION_PATH, zaloSiteVerificationHtml } from './workerHttp.js';
import { workerLifecycleOptions, workerSessionResetHook } from './workerLifecycle.js';
import {
  createRouteHandlers,
  type HandlerResponse,
} from "./api/routeHandlers.js";
import { buildServerOptionsFromEnv } from "./api/serverOptions.js";
import type { AgentTracer } from "./observability/agentTracing.js";
import { authorizeDemoAdminHeaders } from "./security/demoAdminAuth.js";
import { verifyMetaWebhookSignature } from "./security/webhookAuthenticity.js";
import {
  AgentRunCoordinator,
  type AgentRunWakeupJob,
} from "./agentRuns/coordinator.js";
import type { ConversationEvent } from "./channels/conversationEvent.js";
import {
  createMessengerHistoryClient,
  MessengerHistorySyncCoordinator,
  MessengerHistorySyncService,
} from "./channels/messengerHistory.js";
import {
  createMessengerClient,
  normalizeMessengerWebhook,
  verifyMessengerChallenge,
} from "./channels/messenger.js";
import { normalizeZaloWebhook } from "./channels/zalo.js";
import { DashboardEventBus } from "./dashboard/eventBus.js";
import { dashboardSessionTarget } from "./dashboard/sessionVisibility.js";
import type { AgentMode, DashboardEvent } from "./domain/types.js";
import { loadBundledGeneratedFixtures } from "./fixtures/bundledFixtures.js";
import { createMockClients } from "./mock/createMockClients.js";
import { D1Store, type D1DatabaseLike } from "./persistence/d1Store.js";
import { D1CheckpointSaver } from "./persistence/d1CheckpointSaver.js";
import type { ConversationStore } from "./persistence/memoryStore.js";
import { sessionIdForConversationEvent } from "./session/sessionContext.js";
import { OpenAISmallTalkRouter } from "./llm/smallTalkRouter.js";
import { fetchCatalogObservation } from "./catalog/catalogObservation.js";
import {
  D1LifecycleRepository,
  LifecycleError,
  SandboxLifecycleControls,
  lifecycleBinding,
} from "./commerce/lifecycleProvider.js";

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
export const WORKER_CUSTOMER_RUN_PACE_MS = 0;
export const WORKER_CUSTOMER_RUN_MAX_TEXT_EVENTS = 3;

export function scheduleAgentBackground(
  context: WorkerExecutionContext | undefined,
  tasks: Array<() => Promise<void>>,
  tracer?: AgentTracer,
): void {
  if (tasks.length === 0 && !tracer) return;
  const work = (async () => {
    for (const task of tasks) await task();
    await tracer?.flush();
  })().catch((error) => {
    console.error("agent_background_failed", {
      message: error instanceof Error ? error.message : String(error),
    });
  });
  if (context) context.waitUntil(work);
  else void work;
}

export interface MessengerWebhookJob {
  channel: "messenger_control_event";
  event: ConversationEvent;
  sessionId: string;
  queuedAt: string;
}

export interface ZaloWebhookJob {
  channel: "zalo_control_event";
  payload: unknown;
  queuedAt: string;
}

export type WorkerWebhookJob =
  MessengerWebhookJob | ZaloWebhookJob | AgentRunWakeupJob;

export interface WorkerEnv {
  DB: D1DatabaseLike;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  OPENAI_TOOL_PLANNER_MODEL?: string;
  OPENAI_TOOL_PLANNER_FAST_MODEL?: string;
  OPENAI_TOOL_PLANNER_STATUS_MODEL?: string;
  OPENAI_TOOL_PLANNER_TIMEOUT_MS?: string;
  TOOL_PLANNER_PROVIDER?: "openai" | "vertex";
  TOOL_PLANNER_MODEL?: string;
  TOOL_PLANNER_FAST_MODEL?: string;
  TOOL_PLANNER_STATUS_MODEL?: string;
  VERTEX_SERVICE_ACCOUNT_JSON?: string;
  VERTEX_LOCATION?: string;
  OPENAI_RESPONSE_MODEL?: string;
  OPENAI_SMALL_TALK_ROUTER_MODEL?: string;
  OPENAI_SMALL_TALK_ROUTER_TIMEOUT_MS?: string;
  OPENAI_MONITOR_JUDGE_MODEL?: string;
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
  KFC_COMMERCE_MODE?: "fixture" | "gateway";
  KFC_COMMERCE_ENVIRONMENT?: "production" | "sandbox";
  KFC_MENU_API_URL?: string;
  CATALOG_TTL_SECONDS?: string;
  KFC_COMMERCE_GATEWAY_BASE_URL?: string;
  KFC_COMMERCE_GATEWAY_TOKEN?: string;
  KFC_POS_MODE?: "disabled" | "http";
  KFC_POS_BASE_URL?: string;
  KFC_POS_TOKEN?: string;
  MESSENGER_FETCH?: typeof fetch;
  ZALO_FETCH?: typeof fetch;
  KFC_DEMO_ADMIN_TOKEN?: string;
  RELEASE_GIT_SHA?: string;
  RELEASE_DEPLOYMENT_ID?: string;
  RELEASE_BUILT_AT?: string;
  RELEASE_DIRTY?: string;
  CF_VERSION_METADATA?: { id: string; tag: string; timestamp: string };
  DASHBOARD_SOCKET?: DurableObjectNamespaceLike;
}

function openAiDiagnosticEnv(env: WorkerEnv, request?: Request) {
  const placement = request?.headers.get("cf-placement") ?? "";
  const placedExecutionColo = /(?:^|[-_])([A-Z0-9]{3})$/.exec(placement)?.[1];
  const edgeColo = request
    ? (request as Request & { cf?: { colo?: string } }).cf?.colo
    : undefined;
  return {
    OPENAI_DIAGNOSTIC_WORKER_RELEASE:
      env.CF_VERSION_METADATA?.id ?? env.RELEASE_GIT_SHA ?? "",
    OPENAI_DIAGNOSTIC_EXECUTION_COLO: placedExecutionColo ?? "",
    OPENAI_DIAGNOSTIC_EDGE_COLO: edgeColo ?? "",
    OPENAI_DIAGNOSTIC_PLACEMENT: placement,
  };
}

function workerModelEnv(env: WorkerEnv) {
  return {
    OPENAI_API_KEY: env.OPENAI_API_KEY ?? "",
    OPENAI_MODEL: env.OPENAI_MODEL ?? "gpt-4.1-mini",
    OPENAI_TOOL_PLANNER_MODEL: env.OPENAI_TOOL_PLANNER_MODEL ?? "gpt-4.1-mini",
    OPENAI_TOOL_PLANNER_FAST_MODEL: env.OPENAI_TOOL_PLANNER_FAST_MODEL ?? "gpt-4.1-mini",
    OPENAI_TOOL_PLANNER_STATUS_MODEL: env.OPENAI_TOOL_PLANNER_STATUS_MODEL ?? "gpt-4.1-nano",
    OPENAI_TOOL_PLANNER_TIMEOUT_MS: Number(env.OPENAI_TOOL_PLANNER_TIMEOUT_MS ?? "8000"),
    TOOL_PLANNER_PROVIDER: env.TOOL_PLANNER_PROVIDER ?? "openai",
    TOOL_PLANNER_MODEL: env.TOOL_PLANNER_MODEL ?? "google/gemini-3.1-flash-lite",
    TOOL_PLANNER_FAST_MODEL: env.TOOL_PLANNER_FAST_MODEL ?? "google/gemini-3.1-flash-lite",
    TOOL_PLANNER_STATUS_MODEL: env.TOOL_PLANNER_STATUS_MODEL ?? "google/gemini-3.1-flash-lite",
    VERTEX_SERVICE_ACCOUNT_JSON: env.VERTEX_SERVICE_ACCOUNT_JSON ?? "",
    VERTEX_LOCATION: env.VERTEX_LOCATION ?? "global",
    OPENAI_RESPONSE_MODEL: env.OPENAI_RESPONSE_MODEL ?? "gpt-4.1-nano",
    OPENAI_SMALL_TALK_ROUTER_MODEL: env.OPENAI_SMALL_TALK_ROUTER_MODEL ?? "gpt-4.1-mini",
    OPENAI_SMALL_TALK_ROUTER_TIMEOUT_MS: Number(env.OPENAI_SMALL_TALK_ROUTER_TIMEOUT_MS ?? "2500"),
    OPENAI_MONITOR_JUDGE_MODEL: env.OPENAI_MONITOR_JUDGE_MODEL ?? "gpt-4.1-nano",
    OPENAI_BASE_URL: env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
  } as const;
}

export default {
  async fetch(
    request: Request,
    env: WorkerEnv,
    context?: WorkerExecutionContext,
  ): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/diagnostics/openai-geo-canary") {
      if (!env.OPENAI_GEO_CANARY_TOKEN) return json({ errorCode: "not_found" }, 404);
      if (request.headers.get("authorization") !== `Bearer ${env.OPENAI_GEO_CANARY_TOKEN}`) {
        return json({ errorCode: "unauthorized" }, 401);
      }
      if (!env.OPENAI_API_KEY) return json({ errorCode: "openai_not_configured" }, 503);
      const diagnostics = openAiDiagnosticEnv(env, request);
      const router = new OpenAISmallTalkRouter({
        apiKey: env.OPENAI_API_KEY,
        model: env.OPENAI_SMALL_TALK_ROUTER_MODEL ?? "gpt-4.1-mini",
        baseUrl: env.OPENAI_BASE_URL,
        timeoutMs: 20_000,
        diagnosticContext: {
          workerRelease: diagnostics.OPENAI_DIAGNOSTIC_WORKER_RELEASE,
          executionColo: diagnostics.OPENAI_DIAGNOSTIC_EXECUTION_COLO,
          edgeColo: diagnostics.OPENAI_DIAGNOSTIC_EDGE_COLO,
          placement: diagnostics.OPENAI_DIAGNOSTIC_PLACEMENT,
        },
      });
      try {
        const result = await router.route({
          latestUserMessage: "Hello",
          channel: "kfc",
          hasStructuredAction: false,
        });
        return json({ ok: result.decision === "handle_social", model: router.model });
      } catch (error) {
        return json({
          ok: false,
          errorName: error instanceof Error ? error.name : "UnknownError",
        }, 502);
      }
    }
    if (requiresDemoAdmin(url.pathname) && !(url.pathname.startsWith("/admin/lifecycle/") && env.KFC_COMMERCE_ENVIRONMENT !== "sandbox")) {
      const auth = authorizeDemoAdmin(request, env);
      if (!auth.ok) return json({ errorCode: auth.errorCode }, auth.status);
    }
    if (
      request.method === "GET" &&
      (url.pathname === "/" || url.pathname === ZALO_SITE_VERIFICATION_PATH)
    ) {
      return html(zaloSiteVerificationHtml());
    }
    if (request.method === "GET" && url.pathname === "/health") {
      const diagnostics = openAiDiagnosticEnv(env, request);
      return json({
        ok: true,
        service: "kfc-agent-backend",
        workerVersionId: env.CF_VERSION_METADATA?.id,
        workerReleaseGitSha: env.RELEASE_GIT_SHA,
        executionColo: diagnostics.OPENAI_DIAGNOSTIC_EXECUTION_COLO || undefined,
        edgeColo: diagnostics.OPENAI_DIAGNOSTIC_EDGE_COLO || undefined,
        placement: diagnostics.OPENAI_DIAGNOSTIC_PLACEMENT || undefined,
      });
    }
    if (request.method === "GET" && url.pathname === "/webhooks/messenger") {
      const result = verifyMessengerChallenge(
        Object.fromEntries(url.searchParams.entries()),
        env.MESSENGER_VERIFY_TOKEN ?? "",
      );
      return text(result.body, result.statusCode);
    }
    if (request.method === "GET" && url.pathname === "/dashboard/socket") {
      if (!env.DASHBOARD_SOCKET) {
        return json({ errorCode: "dashboard_socket_unavailable" }, 503);
      }
      return env.DASHBOARD_SOCKET.getByName("operations").fetch(request);
    }
    if (url.pathname === "/dashboard/stream") {
      return json(
        {
          errorCode: "worker_sse_not_supported",
          message: "Use the /dashboard/socket WebSocket endpoint.",
        },
        501,
      );
    }
    if (
      request.method === "POST" &&
      url.pathname === "/webhooks/zalo" &&
      env.MESSENGER_WEBHOOK_QUEUE
    ) {
      return toResponse(await enqueueZaloWebhook(request, env, context));
    }

    const store = new D1Store(env.DB, workerSessionResetHook(env));
    await initializeWorkerStore(store, env.DB);
    if (request.method === "GET" && url.pathname === "/ready") {
      const readiness = await checkWorkerReadiness(
        env,
        url.searchParams.get("deep") === "1",
      );
      return json(readiness, readiness.ok ? 200 : 503);
    }
    if (request.method === "POST" && url.pathname === "/webhooks/messenger") {
      return toResponse(
        await enqueueMessengerWebhook(request, env, store, context),
      );
    }
    if (request.method === "GET" && url.pathname === "/dashboard/sessions") {
      return json({ sessions: await listWorkerDashboardSessions(store, env) });
    }
    const fastEventsMatch = url.pathname.match(
      /^\/dashboard\/events\/([^/]+)$/,
    );
    if (request.method === "GET" && fastEventsMatch) {
      return json({
        events: await store.listDashboardEvents(
          decodeURIComponent(fastEventsMatch[1]),
        ),
      });
    }

    const fastTurnsMatch = url.pathname.match(
      /^\/dashboard\/sessions\/([^/]+)\/turns$/,
    );
    if (request.method === "GET" && fastTurnsMatch) {
      const sessionId = decodeURIComponent(fastTurnsMatch[1]);
      const requestedLimit = Number(url.searchParams.get("limit") ?? 10);
      const turnLimit = Number.isFinite(requestedLimit)
        ? Math.min(100, Math.max(1, Math.floor(requestedLimit)))
        : 10;
      let turns = await store.listRecentTurns(sessionId, turnLimit);
      if (
        turns.length === 0 &&
        sessionId.startsWith("messenger:") &&
        url.searchParams.get("sync") === "1"
      ) {
        const dashboard = new DashboardEventBus({
          persistEvent: (event) =>
            scheduleDashboardEvent(env, store, event, context),
        });
        try {
          await syncWorkerMessengerHistory(store, dashboard, env);
          turns = await store.listRecentTurns(sessionId, turnLimit);
        } catch (error) {
          console.warn("worker_dashboard_turns_history_sync_failed", {
            sessionId,
            message:
              error instanceof Error
                ? error.message
                : "Messenger history sync failed",
          });
        }
      }
      return json({ turns });
    }

    const fastControlMatch = url.pathname.match(
      /^\/dashboard\/sessions\/([^/]+)\/control$/,
    );
    if (request.method === "GET" && fastControlMatch) {
      return json(
        await store.getSessionControl(decodeURIComponent(fastControlMatch[1])),
      );
    }

    const demoResetMatch = url.pathname.match(
      /^\/dashboard\/sessions\/([^/]+)\/demo-reset$/,
    );
    if (request.method === "POST" && demoResetMatch) {
      const auth = authorizeDemoAdmin(request, env);
      if (!auth.ok) return json({ errorCode: auth.errorCode }, auth.status);
      return json(
        await store.resetSession(decodeURIComponent(demoResetMatch[1])),
      );
    }

    const shouldLoadDashboardEvents =
      request.method === "GET" &&
      (url.pathname === "/dashboard/sessions" ||
        /^\/dashboard\/events\/([^/]+)$/.test(url.pathname));
    const dashboard = new DashboardEventBus({
      initialEvents: shouldLoadDashboardEvents
        ? await store.listDashboardEvents()
        : undefined,
      persistEvent: (event) =>
        scheduleDashboardEvent(env, store, event, context),
    });
    const messengerHistorySync = createWorkerMessengerHistorySync(
      store,
      dashboard,
      env,
    );
    const options = buildServerOptionsFromEnv({
      PORT: 0,
      DATABASE_URL: "d1://DB",
      ...workerModelEnv(env),
      ...openAiDiagnosticEnv(env, request),
      LANGSMITH_API_KEY: env.LANGSMITH_API_KEY ?? "",
      LANGSMITH_PROJECT: env.LANGSMITH_PROJECT ?? "kfc-agent-backend-worker",
      LANGSMITH_ENDPOINT: env.LANGSMITH_ENDPOINT ?? "https://api.smith.langchain.com",
      LANGSMITH_TRACING_SAMPLING_RATE: Number(env.LANGSMITH_TRACING_SAMPLING_RATE ?? "1"),
      KFC_SHOWCASE_DATASET: env.KFC_SHOWCASE_DATASET ?? "kfc-showcase-scenarios-v1",
      RELEASE_GIT_SHA: env.RELEASE_GIT_SHA ?? "unknown",
      RELEASE_DEPLOYMENT_ID: env.RELEASE_DEPLOYMENT_ID ?? "unknown",
      RELEASE_BUILT_AT: env.RELEASE_BUILT_AT ?? "",
      RELEASE_DIRTY: env.RELEASE_DIRTY ?? "",
      MESSENGER_VERIFY_TOKEN: env.MESSENGER_VERIFY_TOKEN ?? "",
      META_PAGE_ID: env.META_PAGE_ID ?? "",
      META_APP_SECRET: env.META_APP_SECRET ?? "",
      META_PAGE_ACCESS_TOKEN: env.META_PAGE_ACCESS_TOKEN ?? "",
      META_INBOX_URL_TEMPLATE: env.META_INBOX_URL_TEMPLATE ?? "",
      MESSENGER_GRAPH_API_BASE_URL: env.MESSENGER_GRAPH_API_BASE_URL ?? "",
      ZALO_OA_ID: env.ZALO_OA_ID ?? "",
      ZALO_ACCESS_TOKEN: env.ZALO_ACCESS_TOKEN ?? "",
      ZALO_INBOX_URL_TEMPLATE: env.ZALO_INBOX_URL_TEMPLATE ?? "",
      ZALO_REFRESH_TOKEN: env.ZALO_REFRESH_TOKEN ?? "",
      ZALO_APP_ID: env.ZALO_APP_ID ?? "",
      ZALO_APP_SECRET: env.ZALO_APP_SECRET ?? "",
      ZALO_API_BASE_URL: env.ZALO_API_BASE_URL ?? "",
      KFC_COMMERCE_MODE: env.KFC_COMMERCE_MODE ?? "gateway",
      KFC_COMMERCE_ENVIRONMENT: env.KFC_COMMERCE_ENVIRONMENT,
      KFC_MENU_API_URL: env.KFC_MENU_API_URL,
      CATALOG_TTL_SECONDS: env.CATALOG_TTL_SECONDS ? Number(env.CATALOG_TTL_SECONDS) : undefined,
      KFC_COMMERCE_GATEWAY_BASE_URL: env.KFC_COMMERCE_GATEWAY_BASE_URL ?? "",
      KFC_COMMERCE_GATEWAY_TOKEN: env.KFC_COMMERCE_GATEWAY_TOKEN ?? "",
      KFC_POS_MODE: env.KFC_POS_MODE ?? "disabled",
      KFC_POS_BASE_URL: env.KFC_POS_BASE_URL ?? "",
      KFC_POS_TOKEN: env.KFC_POS_TOKEN ?? "",
      KFC_DEMO_ADMIN_TOKEN: env.KFC_DEMO_ADMIN_TOKEN ?? "",
    });
    const deferredAgentTasks: Array<() => Promise<void>> = [];
    const fixtures = loadBundledGeneratedFixtures();
    const provider = createMockClients(fixtures);
    const handlers = createRouteHandlers({
      ...options,
      checkpointer: workerCheckpointer(env.DB),
      fixtures,
      kfcCommerceProvider: options.kfcCommerceProvider ?? {
        cart: provider.cart,
        inventory: provider.inventory,
        storeLocator: provider.storeLocator,
        fulfillment: provider.fulfillment,
      },
      store,
      dashboard,
      messengerHistorySync,
      lifecycle: workerLifecycleOptions(env, store),
      messengerFetchImpl: env.MESSENGER_FETCH ?? fetch,
      zaloFetchImpl: env.ZALO_FETCH ?? fetch,
      defer: (task) => deferredAgentTasks.push(task),
      customerRunPaceMs: WORKER_CUSTOMER_RUN_PACE_MS,
      customerRunMaxTextEvents: WORKER_CUSTOMER_RUN_MAX_TEXT_EVENTS,
      readiness: {
        database: async () => {
          await env.DB.prepare("SELECT 1").first();
          return { ok: true };
        },
        messengerToken:
          request.method === "GET" &&
          url.pathname === "/ready" &&
          url.searchParams.get("deep") === "1"
            ? () => checkMessengerToken(env)
            : undefined,
        openAiConfigured: Boolean(env.OPENAI_API_KEY),
        openAiRequired: false,
        plannerConfigured: env.TOOL_PLANNER_PROVIDER === "vertex"
          ? Boolean(env.VERTEX_SERVICE_ACCOUNT_JSON)
          : Boolean(env.OPENAI_API_KEY),
        plannerProvider: env.TOOL_PLANNER_PROVIDER ?? "openai",
        zaloRequired: false,
      },
    });

    const lifecycleCreateMatch = url.pathname.match(/^\/admin\/lifecycle\/sessions\/([^/]+)\/instances$/);
    if (request.method === "POST" && lifecycleCreateMatch) {
      return toResponse(await handlers.lifecycleCreate(decodeURIComponent(lifecycleCreateMatch[1]!)));
    }
    const lifecycleInstanceMatch = url.pathname.match(/^\/admin\/lifecycle\/instances\/([^/]+)$/);
    if (request.method === "GET" && lifecycleInstanceMatch) {
      return toResponse(await handlers.lifecycleGet(decodeURIComponent(lifecycleInstanceMatch[1]!)));
    }
    const lifecycleEventMatch = url.pathname.match(/^\/admin\/lifecycle\/instances\/([^/]+)\/events$/);
    if (request.method === "POST" && lifecycleEventMatch) {
      return toResponse(await handlers.lifecycleEvent(decodeURIComponent(lifecycleEventMatch[1]!), await readJson(request)));
    }
    const messengerProofMatch = url.pathname.match(/^\/admin\/proof\/messenger\/sessions\/([^/]+)\/envelope$/);
    if (request.method === "GET" && messengerProofMatch) {
      const sessionId = decodeURIComponent(messengerProofMatch[1]!);
      if (!sessionId.startsWith("messenger:")) return json({ errorCode: "invalid_messenger_session" }, 400);
      return toResponse(await handlers.messengerProofEnvelope(sessionId));
    }
    const kfcProofMatch = url.pathname.match(/^\/admin\/proof\/kfc\/sessions\/([^/]+)\/envelope$/);
    if (request.method === "GET" && kfcProofMatch) {
      const sessionId = decodeURIComponent(kfcProofMatch[1]!);
      if (!sessionId.startsWith("kfc:")) return json({ errorCode: "invalid_kfc_session" }, 400);
      return toResponse(await handlers.kfcProofEnvelope(sessionId));
    }
    const kfcProofPreconditionsMatch = url.pathname.match(/^\/admin\/proof\/kfc\/sessions\/([^/]+)\/preconditions$/);
    if (request.method === "POST" && kfcProofPreconditionsMatch) {
      const sessionId = decodeURIComponent(kfcProofPreconditionsMatch[1]!);
      if (!sessionId.startsWith("kfc:")) return json({ errorCode: "invalid_kfc_session" }, 400);
      return toResponse(await handlers.kfcProofPreconditions(sessionId, await readJson(request)));
    }
    if (request.method === "POST" && url.pathname === "/webhooks/zalo") {
      const result = await handlers.zaloWebhook(await readJson(request));
      scheduleAgentBackground(context, deferredAgentTasks, options.agentTracer);
      return toResponse(result);
    }
    if (request.method === "GET" && url.pathname === "/showcase/scenarios") {
      return toResponse(await handlers.showcaseCatalog());
    }
    if (request.method === "POST" && url.pathname === "/showcase/results") {
      return toResponse(await handlers.showcaseComplete(await readJson(request)));
    }
    if (request.method === "POST" && url.pathname === "/chat/kfc/message") {
      const body = await readJson(request);
      const result = await handlers.chatKfcMessage(body);
      scheduleAgentBackground(context, deferredAgentTasks, options.agentTracer);
      return toResponse(result);
    }
    if (
      request.method === "POST" &&
      url.pathname === "/chat/kfc/genui-action"
    ) {
      const result = await handlers.chatKfcGenUiAction(
        await readJson(request),
      );
      scheduleAgentBackground(context, deferredAgentTasks, options.agentTracer);
      return toResponse(result);
    }
    if (request.method === "POST" && url.pathname === "/chat/kfc/confirmations/resume") {
      const result = await handlers.confirmationResume(await readJson(request));
      scheduleAgentBackground(context, deferredAgentTasks, options.agentTracer);
      return toResponse(result);
    }
    if (request.method === "POST" && url.pathname === "/chat/kfc/runs") {
      const body = await readJson(request);
      const result = await handlers.chatKfcStartRun(body);
      scheduleAgentBackground(context, deferredAgentTasks, options.agentTracer);
      return toResponse(result);
    }
    const customerRunCancelMatch = url.pathname.match(/^\/chat\/kfc\/runs\/([^/]+)\/cancel$/);
    if (request.method === "POST" && customerRunCancelMatch) {
      return toResponse(await handlers.chatKfcCancelRun(decodeURIComponent(customerRunCancelMatch[1]!)));
    }
    const customerRunEventsMatch = url.pathname.match(/^\/chat\/kfc\/runs\/([^/]+)\/events$/);
    if (request.method === "GET" && customerRunEventsMatch) {
      const runId = decodeURIComponent(customerRunEventsMatch[1]!);
      const run = await store.getCustomerRun(runId);
      if (!run) return json({ errorCode: "run_not_found" }, 404);
      const after = Number(url.searchParams.get("after") ?? "0");
      if (!Number.isInteger(after) || after < 0) return json({ errorCode: "invalid_cursor" }, 400);
      return customerRunEventResponse(store, runId, after, request.signal);
    }
    if (
      request.method === "POST" &&
      url.pathname === "/admin/messenger/sync-history"
    ) {
      return toResponse(
        await handlers.messengerHistorySync(await readJson(request)),
      );
    }
    const kfcUpdatesMatch = url.pathname.match(
      /^\/chat\/kfc\/sessions\/([^/]+)\/updates$/,
    );
    if (request.method === "GET" && kfcUpdatesMatch) {
      return toResponse(
        await handlers.chatKfcSessionUpdates(
          decodeURIComponent(kfcUpdatesMatch[1]!),
          url.searchParams.get("after") ?? undefined,
        ),
      );
    }
    if (
      request.method === "GET" &&
      url.pathname === "/admin/messenger/sync-history/status"
    ) {
      return toResponse(handlers.messengerHistorySyncStatus());
    }
    if (
      request.method === "POST" &&
      url.pathname === "/admin/messenger/recover-stale-deliveries"
    ) {
      const auth = authorizeDemoAdmin(request, env);
      if (!auth.ok) return json({ errorCode: auth.errorCode }, auth.status);
      return toResponse(
        await handlers.recoverStaleMessengerDeliveries(
          staleDeliveryRecoveryOptionsFromUrl(url),
        ),
      );
    }
    if (
      request.method === "POST" &&
      url.pathname === "/admin/messenger/backfill-profiles"
    ) {
      return toResponse(await backfillWorkerMessengerProfiles(store, env));
    }
    if (request.method === "GET" && url.pathname === "/dashboard/sessions") {
      return toResponse(await handlers.dashboardSessions());
    }

    const turnsMatch = url.pathname.match(
      /^\/dashboard\/sessions\/([^/]+)\/turns$/,
    );
    if (request.method === "GET" && turnsMatch) {
      return toResponse(
        await handlers.dashboardTurns(decodeURIComponent(turnsMatch[1])),
      );
    }
    const humanJoinMatch = url.pathname.match(
      /^\/dashboard\/sessions\/([^/]+)\/human-join$/,
    );
    if (request.method === "POST" && humanJoinMatch) {
      return toResponse(
        await handlers.dashboardHumanJoin(
          decodeURIComponent(humanJoinMatch[1]),
          await readJson(request),
        ),
      );
    }
    const humanMessageMatch = url.pathname.match(
      /^\/dashboard\/sessions\/([^/]+)\/human-message$/,
    );
    if (request.method === "POST" && humanMessageMatch) {
      return toResponse(
        await handlers.dashboardHumanMessage(
          decodeURIComponent(humanMessageMatch[1]),
          await readJson(request),
        ),
      );
    }
    const resumeAiMatch = url.pathname.match(
      /^\/dashboard\/sessions\/([^/]+)\/resume-ai$/,
    );
    if (request.method === "POST" && resumeAiMatch) {
      return toResponse(
        await handlers.dashboardResumeAi(
          decodeURIComponent(resumeAiMatch[1]),
          await readJson(request),
        ),
      );
    }
    const eventsMatch = url.pathname.match(/^\/dashboard\/events\/([^/]+)$/);
    if (request.method === "GET" && eventsMatch) {
      return toResponse(
        handlers.dashboardEvents(decodeURIComponent(eventsMatch[1])),
      );
    }

    return json({ errorCode: "not_found" }, 404);
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
    const options = buildServerOptionsFromEnv({
      PORT: 0,
      DATABASE_URL: "d1://DB",
      ...workerModelEnv(env),
      ...openAiDiagnosticEnv(env),
      LANGSMITH_API_KEY: env.LANGSMITH_API_KEY ?? "",
      LANGSMITH_PROJECT: env.LANGSMITH_PROJECT ?? "kfc-agent-backend-worker",
      LANGSMITH_ENDPOINT: env.LANGSMITH_ENDPOINT ?? "https://api.smith.langchain.com",
      LANGSMITH_TRACING_SAMPLING_RATE: Number(env.LANGSMITH_TRACING_SAMPLING_RATE ?? "1"),
      KFC_SHOWCASE_DATASET: env.KFC_SHOWCASE_DATASET ?? "kfc-showcase-scenarios-v1",
      RELEASE_GIT_SHA: env.RELEASE_GIT_SHA ?? "unknown",
      RELEASE_DEPLOYMENT_ID: env.RELEASE_DEPLOYMENT_ID ?? "unknown",
      RELEASE_BUILT_AT: env.RELEASE_BUILT_AT ?? "",
      RELEASE_DIRTY: env.RELEASE_DIRTY ?? "",
      MESSENGER_VERIFY_TOKEN: env.MESSENGER_VERIFY_TOKEN ?? "",
      META_PAGE_ID: env.META_PAGE_ID ?? "",
      META_APP_SECRET: env.META_APP_SECRET ?? "",
      META_PAGE_ACCESS_TOKEN: env.META_PAGE_ACCESS_TOKEN ?? "",
      META_INBOX_URL_TEMPLATE: env.META_INBOX_URL_TEMPLATE ?? "",
      MESSENGER_GRAPH_API_BASE_URL: env.MESSENGER_GRAPH_API_BASE_URL ?? "",
      ZALO_OA_ID: env.ZALO_OA_ID ?? "",
      ZALO_ACCESS_TOKEN: env.ZALO_ACCESS_TOKEN ?? "",
      ZALO_INBOX_URL_TEMPLATE: env.ZALO_INBOX_URL_TEMPLATE ?? "",
      ZALO_REFRESH_TOKEN: env.ZALO_REFRESH_TOKEN ?? "",
      ZALO_APP_ID: env.ZALO_APP_ID ?? "",
      ZALO_APP_SECRET: env.ZALO_APP_SECRET ?? "",
      ZALO_API_BASE_URL: env.ZALO_API_BASE_URL ?? "",
      KFC_COMMERCE_MODE: env.KFC_COMMERCE_MODE ?? "gateway",
      KFC_COMMERCE_ENVIRONMENT: env.KFC_COMMERCE_ENVIRONMENT,
      KFC_MENU_API_URL: env.KFC_MENU_API_URL,
      CATALOG_TTL_SECONDS: env.CATALOG_TTL_SECONDS ? Number(env.CATALOG_TTL_SECONDS) : undefined,
      KFC_COMMERCE_GATEWAY_BASE_URL: env.KFC_COMMERCE_GATEWAY_BASE_URL ?? "",
      KFC_COMMERCE_GATEWAY_TOKEN: env.KFC_COMMERCE_GATEWAY_TOKEN ?? "",
      KFC_POS_MODE: env.KFC_POS_MODE ?? "disabled",
      KFC_POS_BASE_URL: env.KFC_POS_BASE_URL ?? "",
      KFC_POS_TOKEN: env.KFC_POS_TOKEN ?? "",
      KFC_DEMO_ADMIN_TOKEN: env.KFC_DEMO_ADMIN_TOKEN ?? "",
    });
    const deferredAgentTasks: Array<() => Promise<void>> = [];
    const handlers = createRouteHandlers({
      ...options,
      checkpointer: workerCheckpointer(env.DB),
      fixtures: loadBundledGeneratedFixtures(),
      store,
      dashboard,
      messengerFetchImpl: env.MESSENGER_FETCH ?? fetch,
      zaloFetchImpl: env.ZALO_FETCH ?? fetch,
      defer: (task) => deferredAgentTasks.push(task),
    });

    for (const message of batch.messages) {
      if (message.body.channel === "agent_run_wakeup") {
        const waitMs = Date.parse(message.body.dueAt) - Date.now();
        if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(waitMs, 2_000)));
        const coordinator = new AgentRunCoordinator({ store, dashboard });
        const result = await coordinator.claimWakeupRun(message.body);
        if (result.claimed && result.runId) {
          await handlers.processMessengerAgentRun(result.runId);
        }
        console.log("agent_run_wakeup_processed", {
          sessionId: message.body.sessionId,
          generation: message.body.generation,
          claimed: result.claimed,
          reason: result.reason,
        });
        message.ack?.();
        continue;
      }

      if (message.body.channel === "zalo_control_event") {
        console.log("zalo_queue_processing_started", {
          queuedAt: message.body.queuedAt,
        });
        const result = await handlers.zaloWebhook(message.body.payload);
        console.log("zalo_queue_processing_finished", {
          status: result.status,
        });
        message.ack?.();
        continue;
      }

      if (message.body.channel !== "messenger_control_event") {
        message.ack?.();
        continue;
      }
      console.log("messenger_queue_processing_started", {
        rawEventId: message.body.event.rawEventId,
        sessionId: message.body.sessionId,
      });
      const result = await handlers.processMessengerEvent(message.body.event);
      console.log("messenger_queue_processing_finished", {
        rawEventId: message.body.event.rawEventId,
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
    const options = buildServerOptionsFromEnv({
      PORT: 0,
      DATABASE_URL: "d1://DB",
      ...workerModelEnv(env),
      ...openAiDiagnosticEnv(env),
      LANGSMITH_API_KEY: env.LANGSMITH_API_KEY ?? "",
      LANGSMITH_PROJECT: env.LANGSMITH_PROJECT ?? "kfc-agent-backend-worker",
      LANGSMITH_ENDPOINT: env.LANGSMITH_ENDPOINT ?? "https://api.smith.langchain.com",
      LANGSMITH_TRACING_SAMPLING_RATE: Number(env.LANGSMITH_TRACING_SAMPLING_RATE ?? "1"),
      KFC_SHOWCASE_DATASET: env.KFC_SHOWCASE_DATASET ?? "kfc-showcase-scenarios-v1",
      RELEASE_GIT_SHA: env.RELEASE_GIT_SHA ?? "unknown",
      RELEASE_DEPLOYMENT_ID: env.RELEASE_DEPLOYMENT_ID ?? "unknown",
      RELEASE_BUILT_AT: env.RELEASE_BUILT_AT ?? "",
      RELEASE_DIRTY: env.RELEASE_DIRTY ?? "",
      MESSENGER_VERIFY_TOKEN: env.MESSENGER_VERIFY_TOKEN ?? "",
      META_PAGE_ID: env.META_PAGE_ID ?? "",
      META_APP_SECRET: env.META_APP_SECRET ?? "",
      META_PAGE_ACCESS_TOKEN: env.META_PAGE_ACCESS_TOKEN ?? "",
      META_INBOX_URL_TEMPLATE: env.META_INBOX_URL_TEMPLATE ?? "",
      MESSENGER_GRAPH_API_BASE_URL: env.MESSENGER_GRAPH_API_BASE_URL ?? "",
      ZALO_OA_ID: env.ZALO_OA_ID ?? "",
      ZALO_ACCESS_TOKEN: env.ZALO_ACCESS_TOKEN ?? "",
      ZALO_INBOX_URL_TEMPLATE: env.ZALO_INBOX_URL_TEMPLATE ?? "",
      ZALO_REFRESH_TOKEN: env.ZALO_REFRESH_TOKEN ?? "",
      ZALO_APP_ID: env.ZALO_APP_ID ?? "",
      ZALO_APP_SECRET: env.ZALO_APP_SECRET ?? "",
      ZALO_API_BASE_URL: env.ZALO_API_BASE_URL ?? "",
      KFC_COMMERCE_MODE: env.KFC_COMMERCE_MODE ?? "gateway",
      KFC_COMMERCE_ENVIRONMENT: env.KFC_COMMERCE_ENVIRONMENT,
      KFC_MENU_API_URL: env.KFC_MENU_API_URL,
      CATALOG_TTL_SECONDS: env.CATALOG_TTL_SECONDS ? Number(env.CATALOG_TTL_SECONDS) : undefined,
      KFC_COMMERCE_GATEWAY_BASE_URL: env.KFC_COMMERCE_GATEWAY_BASE_URL ?? "",
      KFC_COMMERCE_GATEWAY_TOKEN: env.KFC_COMMERCE_GATEWAY_TOKEN ?? "",
      KFC_POS_MODE: env.KFC_POS_MODE ?? "disabled",
      KFC_POS_BASE_URL: env.KFC_POS_BASE_URL ?? "",
      KFC_POS_TOKEN: env.KFC_POS_TOKEN ?? "",
      KFC_DEMO_ADMIN_TOKEN: env.KFC_DEMO_ADMIN_TOKEN ?? "",
    });
    const deferredAgentTasks: Array<() => Promise<void>> = [];
    const handlers = createRouteHandlers({
      ...options,
      checkpointer: workerCheckpointer(env.DB),
      fixtures: loadBundledGeneratedFixtures(),
      store,
      dashboard,
      messengerFetchImpl: env.MESSENGER_FETCH ?? fetch,
      zaloFetchImpl: env.ZALO_FETCH ?? fetch,
      defer: (task) => deferredAgentTasks.push(task),
    });
    const staleDeliveryRecovery =
      await handlers.recoverStaleMessengerDeliveries();
    console.log(
      "messenger_stale_delivery_recovery_finished",
      staleDeliveryRecovery.body,
    );

    const coordinator = new AgentRunCoordinator({ store, dashboard });
    const results = await coordinator.claimDueRuns(
      new Date(controller.scheduledTime).toISOString(),
    );
    for (const result of results) {
      if (result.claimed && result.runId) {
        await handlers.processMessengerAgentRun(result.runId);
      }
    }
    console.log("agent_run_recovery_processed", {
      scheduledTime: new Date(controller.scheduledTime).toISOString(),
      dueSessions: results.length,
      claimed: results.filter((result) => result.claimed).length,
    });
    scheduleAgentBackground(context, deferredAgentTasks, options.agentTracer);
  },
};
