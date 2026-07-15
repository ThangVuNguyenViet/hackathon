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
import { D1Store, type D1DatabaseLike } from "./persistence/d1Store.js";
import { D1CheckpointSaver } from "./persistence/d1CheckpointSaver.js";
import type { ConversationStore } from "./persistence/memoryStore.js";
import { sessionIdForConversationEvent } from "./session/sessionContext.js";
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

interface DashboardSocketState {
  acceptWebSocket(socket: WebSocket): void;
  getWebSockets(): Array<{ send(message: string): void }>;
}

declare const WebSocketPair: {
  new (): { 0: WebSocket; 1: WebSocket };
};

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
  OPENAI_TOOL_PLANNER_TIMEOUT_MS?: string;
  OPENAI_RESPONSE_MODEL?: string;
  OPENAI_SMALL_TALK_ROUTER_MODEL?: string;
  OPENAI_SMALL_TALK_ROUTER_TIMEOUT_MS?: string;
  OPENAI_MONITOR_JUDGE_MODEL?: string;
  OPENAI_BASE_URL?: string;
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
  RELEASE_BUILT_AT?: string;
  RELEASE_DIRTY?: string;
  DASHBOARD_SOCKET?: DurableObjectNamespaceLike;
}

export class DashboardSocket {
  constructor(
    private readonly state: DashboardSocketState,
    _env: unknown,
  ) {}

  async fetch(request: Request): Promise<Response> {
    if (request.method === "POST") {
      const event = await request.text();
      for (const socket of this.state.getWebSockets()) {
        try {
          socket.send(event);
        } catch {
          // A disconnected monitor must not prevent delivery to other clients.
        }
      }
      return new Response(null, { status: 202 });
    }

    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);
    return new Response(null, {
      status: 101,
      webSocket: client,
    } as ResponseInit);
  }
}

const ZALO_SITE_VERIFICATION_TOKEN = "JUwvDeVE5W07swqXmF5wFpdComBLkX5UCpCm";
const ZALO_SITE_VERIFICATION_PATH = `/zalo_verifier${ZALO_SITE_VERIFICATION_TOKEN}.html`;
const workerDashboardSessionDefaultLookbackMs = 24 * 60 * 60 * 1000;
let d1InitializationPromise: Promise<void> | undefined;
let d1InitializationDatabase: D1DatabaseLike | undefined;
const d1CheckpointSavers = new WeakMap<object, D1CheckpointSaver>();

function workerCheckpointer(db: D1DatabaseLike): D1CheckpointSaver {
  let saver = d1CheckpointSavers.get(db as object);
  if (!saver) {
    saver = new D1CheckpointSaver(db);
    d1CheckpointSavers.set(db as object, saver);
  }
  return saver;
}

function initializeWorkerStore(store: D1Store, db: D1DatabaseLike) {
  const shouldResetForTestDatabase =
    db.constructor?.name === "FakeD1Database" && d1InitializationDatabase !== db;
  if (!d1InitializationPromise || shouldResetForTestDatabase) {
    d1InitializationDatabase = db;
    d1InitializationPromise = store.initialize().catch((error) => {
      d1InitializationPromise = undefined;
      d1InitializationDatabase = undefined;
      throw error;
    });
  }
  return d1InitializationPromise;
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
    if (requiresDemoAdmin(url.pathname)) {
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
      return json({ ok: true, service: "kfc-agent-backend" });
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

    const store = new D1Store(env.DB);
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
      OPENAI_API_KEY: env.OPENAI_API_KEY ?? "",
      OPENAI_MODEL: env.OPENAI_MODEL ?? "gpt-4.1",
      OPENAI_TOOL_PLANNER_MODEL:
        env.OPENAI_TOOL_PLANNER_MODEL ?? "gpt-4.1",
      OPENAI_TOOL_PLANNER_TIMEOUT_MS: Number(
        env.OPENAI_TOOL_PLANNER_TIMEOUT_MS ?? "8000",
      ),
      OPENAI_RESPONSE_MODEL: env.OPENAI_RESPONSE_MODEL ?? "gpt-4.1-nano",
      OPENAI_SMALL_TALK_ROUTER_MODEL:
        env.OPENAI_SMALL_TALK_ROUTER_MODEL ?? "gpt-4.1-mini",
      OPENAI_SMALL_TALK_ROUTER_TIMEOUT_MS: Number(
        env.OPENAI_SMALL_TALK_ROUTER_TIMEOUT_MS ?? "2500",
      ),
      OPENAI_MONITOR_JUDGE_MODEL:
        env.OPENAI_MONITOR_JUDGE_MODEL ?? "gpt-4.1-nano",
      OPENAI_BASE_URL: env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
      LANGSMITH_API_KEY: env.LANGSMITH_API_KEY ?? "",
      LANGSMITH_PROJECT: env.LANGSMITH_PROJECT ?? "kfc-agent-backend-worker",
      LANGSMITH_ENDPOINT: env.LANGSMITH_ENDPOINT ?? "https://api.smith.langchain.com",
      LANGSMITH_TRACING_SAMPLING_RATE: Number(env.LANGSMITH_TRACING_SAMPLING_RATE ?? "1"),
      KFC_SHOWCASE_DATASET: env.KFC_SHOWCASE_DATASET ?? "kfc-showcase-scenarios-v1",
      RELEASE_GIT_SHA: env.RELEASE_GIT_SHA ?? "unknown",
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
      if (isRecord(body) && isRecord(body.metadata) && isRecord(body.metadata.mockedUpstreamApi)) {
        const auth = authorizeDemoAdmin(request, env);
        if (!auth.ok) return json({ errorCode: auth.errorCode }, auth.status);
        body.metadata = { ...body.metadata, mockedUpstreamAuthorized: true };
      }
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
    if (request.method === "POST" && url.pathname === "/chat/kfc/runs") {
      const body = await readJson(request);
      if (isRecord(body) && isRecord(body.metadata) && isRecord(body.metadata.mockedUpstreamApi)) {
        const auth = authorizeDemoAdmin(request, env);
        if (!auth.ok) return json({ errorCode: auth.errorCode }, auth.status);
        body.metadata = { ...body.metadata, mockedUpstreamAuthorized: true };
      }
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
    const store = new D1Store(env.DB);
    await initializeWorkerStore(store, env.DB);
    const dashboard = new DashboardEventBus({
      persistEvent: (event) =>
        scheduleDashboardEvent(env, store, event, context),
    });
    const options = buildServerOptionsFromEnv({
      PORT: 0,
      DATABASE_URL: "d1://DB",
      OPENAI_API_KEY: env.OPENAI_API_KEY ?? "",
      OPENAI_MODEL: env.OPENAI_MODEL ?? "gpt-4.1",
      OPENAI_TOOL_PLANNER_MODEL:
        env.OPENAI_TOOL_PLANNER_MODEL ?? "gpt-4.1",
      OPENAI_TOOL_PLANNER_TIMEOUT_MS: Number(
        env.OPENAI_TOOL_PLANNER_TIMEOUT_MS ?? "8000",
      ),
      OPENAI_RESPONSE_MODEL: env.OPENAI_RESPONSE_MODEL ?? "gpt-4.1-nano",
      OPENAI_SMALL_TALK_ROUTER_MODEL:
        env.OPENAI_SMALL_TALK_ROUTER_MODEL ?? "gpt-4.1-mini",
      OPENAI_SMALL_TALK_ROUTER_TIMEOUT_MS: Number(
        env.OPENAI_SMALL_TALK_ROUTER_TIMEOUT_MS ?? "2500",
      ),
      OPENAI_MONITOR_JUDGE_MODEL:
        env.OPENAI_MONITOR_JUDGE_MODEL ?? "gpt-4.1-nano",
      OPENAI_BASE_URL: env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
      LANGSMITH_API_KEY: env.LANGSMITH_API_KEY ?? "",
      LANGSMITH_PROJECT: env.LANGSMITH_PROJECT ?? "kfc-agent-backend-worker",
      LANGSMITH_ENDPOINT: env.LANGSMITH_ENDPOINT ?? "https://api.smith.langchain.com",
      LANGSMITH_TRACING_SAMPLING_RATE: Number(env.LANGSMITH_TRACING_SAMPLING_RATE ?? "1"),
      KFC_SHOWCASE_DATASET: env.KFC_SHOWCASE_DATASET ?? "kfc-showcase-scenarios-v1",
      RELEASE_GIT_SHA: env.RELEASE_GIT_SHA ?? "unknown",
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
    const store = new D1Store(env.DB);
    await initializeWorkerStore(store, env.DB);
    const dashboard = new DashboardEventBus({
      persistEvent: (event) =>
        scheduleDashboardEvent(env, store, event, context),
    });
    const options = buildServerOptionsFromEnv({
      PORT: 0,
      DATABASE_URL: "d1://DB",
      OPENAI_API_KEY: env.OPENAI_API_KEY ?? "",
      OPENAI_MODEL: env.OPENAI_MODEL ?? "gpt-4.1",
      OPENAI_TOOL_PLANNER_MODEL:
        env.OPENAI_TOOL_PLANNER_MODEL ?? "gpt-4.1",
      OPENAI_TOOL_PLANNER_TIMEOUT_MS: Number(
        env.OPENAI_TOOL_PLANNER_TIMEOUT_MS ?? "8000",
      ),
      OPENAI_RESPONSE_MODEL: env.OPENAI_RESPONSE_MODEL ?? "gpt-4.1-nano",
      OPENAI_SMALL_TALK_ROUTER_MODEL:
        env.OPENAI_SMALL_TALK_ROUTER_MODEL ?? "gpt-4.1-mini",
      OPENAI_SMALL_TALK_ROUTER_TIMEOUT_MS: Number(
        env.OPENAI_SMALL_TALK_ROUTER_TIMEOUT_MS ?? "2500",
      ),
      OPENAI_MONITOR_JUDGE_MODEL:
        env.OPENAI_MONITOR_JUDGE_MODEL ?? "gpt-4.1-nano",
      OPENAI_BASE_URL: env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
      LANGSMITH_API_KEY: env.LANGSMITH_API_KEY ?? "",
      LANGSMITH_PROJECT: env.LANGSMITH_PROJECT ?? "kfc-agent-backend-worker",
      LANGSMITH_ENDPOINT: env.LANGSMITH_ENDPOINT ?? "https://api.smith.langchain.com",
      LANGSMITH_TRACING_SAMPLING_RATE: Number(env.LANGSMITH_TRACING_SAMPLING_RATE ?? "1"),
      KFC_SHOWCASE_DATASET: env.KFC_SHOWCASE_DATASET ?? "kfc-showcase-scenarios-v1",
      RELEASE_GIT_SHA: env.RELEASE_GIT_SHA ?? "unknown",
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

async function enqueueMessengerWebhook(
  request: Request,
  env: WorkerEnv,
  store: D1Store,
  context?: WorkerExecutionContext,
): Promise<HandlerResponse> {
  if (!env.MESSENGER_WEBHOOK_QUEUE) {
    return {
      status: 503,
      body: { errorCode: "messenger_webhook_queue_not_configured" },
    };
  }

  if (!env.META_APP_SECRET) {
    return {
      status: 503,
      body: { errorCode: "messenger_webhook_authenticity_not_configured" },
    };
  }
  const rawBody = new Uint8Array(await request.arrayBuffer());
  if (!await verifyMetaWebhookSignature({
    rawBody,
    signatureHeader: request.headers.get("x-hub-signature-256"),
    appSecret: env.META_APP_SECRET,
  })) {
    return {
      status: 401,
      body: { errorCode: "invalid_messenger_webhook_signature" },
    };
  }

  const events = normalizeMessengerWebhook(
    JSON.parse(new TextDecoder().decode(rawBody)),
    env.META_PAGE_ID ?? "",
  );
  const stats = {
    received: events.length,
    queued: 0,
    skippedDuplicates: 0,
    failed: 0,
  };
  console.log("messenger_webhook_received", { received: events.length });
  if (events.length === 0) return { status: 200, body: stats };
  const dashboard = new DashboardEventBus({
    persistEvent: (event) =>
      scheduleDashboardEvent(env, store, event, context),
  });

  for (const event of events) {
    const sessionId = sessionIdForConversationEvent(event);
    if (await store.findTurnByExternalMessage(sessionId, event.rawEventId)) {
      stats.skippedDuplicates += 1;
      console.log("messenger_webhook_duplicate_skipped", {
        rawEventId: event.rawEventId,
        sessionId,
      });
      continue;
    }

    const reservation = await store.reserveWebhookDelivery({
      channel: "messenger",
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
      console.log("messenger_webhook_duplicate_skipped", {
        rawEventId: event.rawEventId,
        sessionId,
      });
      continue;
    }

    try {
      const humanPaused =
        (await store.getSessionControl(sessionId)).agentMode === "human_paused";
      if (!humanPaused) {
        scheduleImmediateMessengerTyping(env, event, context);
        const coordinator = new AgentRunCoordinator({ store, dashboard });
        const wakeup = await coordinator.recordPendingTurn(event, sessionId);
        await env.MESSENGER_WEBHOOK_QUEUE.send(wakeup, { delaySeconds: 0 });
        console.log("agent_run_wakeup_queued", {
          rawEventId: event.rawEventId,
          sessionId,
          generation: wakeup.generation,
          dueAt: wakeup.dueAt,
        });
      } else {
        await env.MESSENGER_WEBHOOK_QUEUE.send({
          channel: "messenger_control_event",
          event,
          sessionId,
          queuedAt: new Date().toISOString(),
        });
      }
      stats.queued += 1;
      console.log("messenger_webhook_queued", {
        rawEventId: event.rawEventId,
        sessionId,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Messenger queue send failed";
      await store.markWebhookDeliveryFailed(
        "messenger",
        event.rawEventId,
        message,
      );
      stats.failed += 1;
      console.error("messenger_webhook_queue_failed", {
        rawEventId: event.rawEventId,
        sessionId,
        message,
      });
    }
  }

  return { status: 200, body: stats };
}

function scheduleImmediateMessengerTyping(
  env: WorkerEnv,
  event: ConversationEvent,
  context?: WorkerExecutionContext,
): void {
  const messenger = createMessengerClient({
    pageAccessToken: env.META_PAGE_ACCESS_TOKEN,
    graphApiBaseUrl: env.MESSENGER_GRAPH_API_BASE_URL,
    fetchImpl: env.MESSENGER_FETCH ?? fetch,
  });
  const task = (async () => {
    const seen = await messenger.sendSenderAction(
      event.externalUserId,
      "mark_seen",
    );
    if (!seen.ok) {
      console.warn("messenger_immediate_mark_seen_failed", {
        rawEventId: event.rawEventId,
        errorCode: seen.errorCode,
        message: seen.message,
      });
    }
    const typing = await messenger.sendSenderAction(
      event.externalUserId,
      "typing_on",
    );
    if (!typing.ok) {
      console.warn("messenger_immediate_typing_failed", {
        rawEventId: event.rawEventId,
        errorCode: typing.errorCode,
        message: typing.message,
      });
    }
  })();
  if (context) context.waitUntil(task);
  else void task;
}

function staleDeliveryRecoveryOptionsFromUrl(url: URL): {
  olderThanMs?: number;
  limit?: number;
} {
  return {
    olderThanMs: numberSearchParam(url, "olderThanMs"),
    limit: numberSearchParam(url, "limit"),
  };
}

function numberSearchParam(url: URL, name: string): number | undefined {
  const value = url.searchParams.get(name);
  if (value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function checkWorkerReadiness(
  env: WorkerEnv,
  deep: boolean,
): Promise<{
  ok: boolean;
  service: string;
  checks: Record<
    string,
    {
      ok: boolean;
      required?: boolean;
      configured?: boolean;
      message?: string;
      langsmith?: {
        configured: boolean;
        project: string;
        endpoint: string;
        samplingRate: number;
      };
    }
  >;
  release: {
    gitSha: string;
    releaseBuiltAt: string;
    dirty: boolean;
  };
  proof?: Record<string, unknown>;
  timestamp: string;
}> {
  const database = await runWorkerReadinessCheck(async () => {
    await env.DB.prepare("SELECT 1").first();
    return { ok: true };
  });
  const fixtures = await runWorkerReadinessCheck(async () => {
    const generated = loadBundledGeneratedFixtures();
    return {
      ok: generated.menuItems.length > 0 && generated.stores.length > 0,
    };
  });
  const messenger = checkWorkerMessengerConfig(env);
  const zalo = checkWorkerZaloConfig(env);
  const openai = {
    ok: true,
    required: false,
    configured: Boolean(env.OPENAI_API_KEY),
  };
  const configuredSamplingRate = Number(
    env.LANGSMITH_TRACING_SAMPLING_RATE ?? "1",
  );
  const observability = {
    ok: true,
    langsmith: {
      configured: Boolean(
        env.LANGSMITH_API_KEY &&
          env.LANGSMITH_PROJECT &&
          env.LANGSMITH_ENDPOINT,
      ),
      project: env.LANGSMITH_PROJECT ?? "kfc-agent-backend-worker",
      endpoint:
        env.LANGSMITH_ENDPOINT ?? "https://api.smith.langchain.com",
      samplingRate: Number.isFinite(configuredSamplingRate)
        ? configuredSamplingRate
        : 1,
    },
  };
  const checks: Record<
    string,
    {
      ok: boolean;
      required?: boolean;
      configured?: boolean;
      message?: string;
      langsmith?: {
        configured: boolean;
        project: string;
        endpoint: string;
        samplingRate: number;
      };
    }
  > = {
    database,
    fixtures,
    messenger,
    zalo,
    openai,
    observability,
  };
  if (deep) {
    checks.messengerToken = await checkMessengerToken(env);
  }
  let catalogObservation: Awaited<ReturnType<typeof fetchCatalogObservation>> | undefined;
  if (env.KFC_COMMERCE_MODE === "gateway" || !env.KFC_COMMERCE_MODE) {
    checks.commerceGateway = await checkWorkerCommerceGateway(env, deep);
    const catalogCheck = await runWorkerReadinessCheck(async () => {
      if (!env.KFC_COMMERCE_ENVIRONMENT || !env.KFC_MENU_API_URL) {
        return { ok: false, configured: false, message: "Missing KFC_COMMERCE_ENVIRONMENT or KFC_MENU_API_URL" };
      }
      if (!deep) return { ok: true, configured: true };
      catalogObservation = await fetchCatalogObservation({
        environment: env.KFC_COMMERCE_ENVIRONMENT,
        sourceUrl: env.KFC_MENU_API_URL,
        fallbackTtlSeconds: env.CATALOG_TTL_SECONDS ? Number(env.CATALOG_TTL_SECONDS) : 300,
      });
      return { ok: catalogObservation.itemCount > 0, configured: true };
    });
    checks.catalog = catalogCheck;
  }
  if (deep) {
    checks.graphCheckpoint = await runWorkerReadinessCheck(async () => {
      await env.DB.prepare("SELECT checkpoint_id FROM langgraph_checkpoints LIMIT 1").first();
      return { ok: true, configured: true };
    });
    checks.lifecycle = env.KFC_COMMERCE_ENVIRONMENT === "sandbox"
      ? await runWorkerReadinessCheck(async () => {
          await env.DB.prepare("SELECT instance_id FROM commerce_lifecycle_instances LIMIT 1").first();
          return { ok: true, configured: true };
        })
      : { ok: true, configured: false, message: "Lifecycle proof controls are not registered in production" };
  }
  return {
    ok: Object.values(checks).every((check) => check.ok),
    service: "kfc-agent-backend",
    checks,
    release: {
      gitSha: env.RELEASE_GIT_SHA ?? "unknown",
      releaseBuiltAt: env.RELEASE_BUILT_AT ?? "unknown",
      dirty: env.RELEASE_DIRTY !== "false",
    },
    ...(deep ? {
      proof: {
        deployment: { gitSha: env.RELEASE_GIT_SHA ?? "unknown", builtAt: env.RELEASE_BUILT_AT ?? "unknown" },
        commerceEnvironment: env.KFC_COMMERCE_ENVIRONMENT ?? null,
        providerFingerprint: catalogObservation?.providerFingerprint ?? null,
        catalogObservation: catalogObservation ? {
          id: catalogObservation.id,
          sha256: catalogObservation.sha256,
          observedAt: catalogObservation.observedAt,
          expiresAt: catalogObservation.expiresAt ?? null,
          itemCount: catalogObservation.itemCount,
          modifierTreeCount: catalogObservation.modifierTreeCount,
        } : null,
        lifecycle: { provider: env.KFC_COMMERCE_ENVIRONMENT === "sandbox" ? "d1" : null, controlsRegistered: env.KFC_COMMERCE_ENVIRONMENT === "sandbox" },
        graph: { runtime: "langgraph-stategraph-v1", checkpoint: "d1-v1" },
        versions: {
          plannerModel: env.OPENAI_TOOL_PLANNER_MODEL ?? "gpt-4.1",
          responseModel: env.OPENAI_RESPONSE_MODEL ?? "gpt-4.1-nano",
          prompt: "tool-planner-v1",
          toolCatalog: "typed-commerce-tools-v1",
          ranker: "deterministic-safety-rerank-v1",
          ledger: "kfc-scenario-ledger-v1",
        },
      },
    } : {}),
    timestamp: new Date().toISOString(),
  };
}

async function checkWorkerCommerceGateway(env: WorkerEnv, deep: boolean) {
  const baseUrl = env.KFC_COMMERCE_GATEWAY_BASE_URL;
  const token = env.KFC_COMMERCE_GATEWAY_TOKEN;
  const environment = env.KFC_COMMERCE_ENVIRONMENT;
  if (!baseUrl || !token || !environment) {
    return { ok: false, configured: false, message: "Missing commerce gateway configuration" };
  }
  if (!deep) return { ok: true, configured: true };
  return runWorkerReadinessCheck(async () => {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/ready`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const payload = await response.json() as { ok?: boolean; capabilities?: unknown[] };
    const capabilities = new Set((payload.capabilities ?? []).filter((value): value is string => typeof value === "string"));
    const missing = ["orders", "payment"].filter((capability) => !capabilities.has(capability));
    return { ok: response.ok && payload.ok === true && missing.length === 0, configured: true, message: missing.length ? `Missing gateway capabilities: ${missing.join(", ")}` : undefined };
  });
}

async function runWorkerReadinessCheck(
  check: () => Promise<{
    ok: boolean;
    required?: boolean;
    configured?: boolean;
    message?: string;
  }>,
): Promise<{
  ok: boolean;
  required?: boolean;
  configured?: boolean;
  message?: string;
}> {
  try {
    return await check();
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : "Readiness check failed",
    };
  }
}

function checkWorkerMessengerConfig(env: WorkerEnv): {
  ok: boolean;
  required: true;
  configured: boolean;
  message?: string;
} {
  const missing = [
    !env.MESSENGER_VERIFY_TOKEN ? "MESSENGER_VERIFY_TOKEN" : undefined,
    !env.META_PAGE_ID ? "META_PAGE_ID" : undefined,
    !env.META_APP_SECRET ? "META_APP_SECRET" : undefined,
    !env.META_PAGE_ACCESS_TOKEN ? "META_PAGE_ACCESS_TOKEN" : undefined,
    !env.META_INBOX_URL_TEMPLATE ? "META_INBOX_URL_TEMPLATE" : undefined,
  ].filter((value): value is string => Boolean(value));
  const configured = missing.length === 0;
  return {
    ok: configured,
    required: true,
    configured,
    message: configured ? undefined : `Missing ${missing.join(", ")}`,
  };
}

function checkWorkerZaloConfig(env: WorkerEnv): {
  ok: boolean;
  required: false;
  configured: boolean;
  message?: string;
} {
  const missing = [
    !env.ZALO_OA_ID ? "ZALO_OA_ID" : undefined,
    !env.ZALO_ACCESS_TOKEN ? "ZALO_ACCESS_TOKEN" : undefined,
    !env.ZALO_INBOX_URL_TEMPLATE ? "ZALO_INBOX_URL_TEMPLATE" : undefined,
  ].filter((value): value is string => Boolean(value));
  const configured = missing.length === 0;
  return {
    ok: true,
    required: false,
    configured,
    message: configured ? undefined : `Missing ${missing.join(", ")}`,
  };
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
    since: new Date(
      Date.now() - workerDashboardSessionDefaultLookbackMs,
    ).toISOString(),
  });
}

async function backfillWorkerMessengerProfiles(
  store: D1Store,
  env: WorkerEnv,
): Promise<
  HandlerResponse<{
    scanned: number;
    updated: number;
    skipped: number;
    failed: number;
    profiles: Array<{
      sessionId: string;
      externalUserId: string;
      displayName: string | null;
      status: "updated" | "skipped" | "failed";
    }>;
  }>
> {
  if (!env.META_PAGE_ID || !env.META_PAGE_ACCESS_TOKEN) {
    return {
      status: 503,
      body: { scanned: 0, updated: 0, skipped: 0, failed: 0, profiles: [] },
    };
  }

  const client = createMessengerHistoryClient({
    pageId: env.META_PAGE_ID,
    pageAccessToken: env.META_PAGE_ACCESS_TOKEN,
    graphApiBaseUrl: env.MESSENGER_GRAPH_API_BASE_URL || undefined,
    fetchImpl: env.MESSENGER_FETCH ?? fetch,
  });
  const existingProfiles = new Map(
    (await store.listProfiles()).map((profile) => [
      `${profile.channel}:${profile.externalUserId}`,
      profile,
    ]),
  );
  const messengerTargets = (
    await store.listDashboardSessionSummaries()
  ).flatMap((summary) => {
    const target = dashboardSessionTarget(summary.sessionId);
    return target?.channel === "messenger"
      ? [
          {
            sessionId: summary.sessionId,
            externalUserId: target.externalUserId,
          },
        ]
      : [];
  });
  let conversationProfiles:
    | Awaited<ReturnType<NonNullable<typeof client.fetchConversationProfiles>>>
    | undefined;
  const result = {
    scanned: messengerTargets.length,
    updated: 0,
    skipped: 0,
    failed: 0,
    profiles: [] as Array<{
      sessionId: string;
      externalUserId: string;
      displayName: string | null;
      status: "updated" | "skipped" | "failed";
    }>,
  };

  for (const target of messengerTargets) {
    const existing = existingProfiles.get(`messenger:${target.externalUserId}`);
    if (existing?.displayName || existing?.avatarUrl) {
      result.skipped += 1;
      result.profiles.push({
        ...target,
        displayName: existing.displayName,
        status: "skipped",
      });
      continue;
    }

    try {
      let profile = await client.fetchProfile?.(target.externalUserId);
      if (!profile) {
        conversationProfiles ??=
          (await client.fetchConversationProfiles?.()) ?? new Map();
        profile = conversationProfiles.get(target.externalUserId);
      }
      if (!profile) {
        result.failed += 1;
        result.profiles.push({
          ...target,
          displayName: null,
          status: "failed",
        });
        continue;
      }
      await store.upsertProfile({
        channel: "messenger",
        externalUserId: target.externalUserId,
        displayName: profile.displayName,
        avatarUrl: profile.avatarUrl,
        profileSource: profile.profileSource,
        profileUpdatedAt: new Date().toISOString(),
      });
      result.updated += 1;
      result.profiles.push({
        ...target,
        displayName: profile.displayName,
        status: "updated",
      });
    } catch {
      try {
        conversationProfiles ??=
          (await client.fetchConversationProfiles?.()) ?? new Map();
        const conversationProfile = conversationProfiles.get(
          target.externalUserId,
        );
        if (conversationProfile) {
          await store.upsertProfile({
            channel: "messenger",
            externalUserId: target.externalUserId,
            displayName: conversationProfile.displayName,
            avatarUrl: conversationProfile.avatarUrl,
            profileSource: conversationProfile.profileSource,
            profileUpdatedAt: new Date().toISOString(),
          });
          result.updated += 1;
          result.profiles.push({
            ...target,
            displayName: conversationProfile.displayName,
            status: "updated",
          });
          continue;
        }
      } catch {
        // Fall through and record the individual profile as failed.
      }
      result.failed += 1;
      result.profiles.push({ ...target, displayName: null, status: "failed" });
    }
  }

  return { status: 200, body: result };
}

async function enqueueZaloWebhook(
  request: Request,
  env: WorkerEnv,
  context?: WorkerExecutionContext,
): Promise<HandlerResponse> {
  if (!env.MESSENGER_WEBHOOK_QUEUE) {
    return {
      status: 503,
      body: { errorCode: "zalo_webhook_queue_not_configured" },
    };
  }

  const body = await readJson(request).catch(() => undefined);
  if (body === undefined) {
    return {
      status: 200,
      body: { received: 0, queued: 0, skippedDuplicates: 0, failed: 0 },
    };
  }

  let events: ReturnType<typeof normalizeZaloWebhook> = [];
  try {
    events = normalizeZaloWebhook(body, env.ZALO_OA_ID ?? "");
  } catch {
    return {
      status: 200,
      body: { received: 0, queued: 0, skippedDuplicates: 0, failed: 0 },
    };
  }
  if (events.length === 0) {
    return {
      status: 200,
      body: { received: 0, queued: 0, skippedDuplicates: 0, failed: 0 },
    };
  }

  const store = new D1Store(env.DB);
  await initializeWorkerStore(store, env.DB);
  const dashboard = new DashboardEventBus({
    persistEvent: (event) =>
      scheduleDashboardEvent(env, store, event, context),
  });
  const stats = {
    received: events.length,
    queued: 0,
    skippedDuplicates: 0,
    failed: 0,
  };
  for (const event of events) {
    const sessionId = sessionIdForConversationEvent(event);
    const processAsControlEvent =
      !event.shouldRunAgent ||
      (await store.getSessionControl(sessionId)).agentMode === "human_paused";
    if (!processAsControlEvent) {
      if (await store.findTurnByExternalMessage(sessionId, event.rawEventId)) {
        stats.skippedDuplicates += 1;
        continue;
      }
      const reservation = await store.reserveWebhookDelivery({
        channel: "zalo",
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
        continue;
      }

      const coordinator = new AgentRunCoordinator({ store, dashboard });
      const wakeup = await coordinator.recordPendingTurn(event, sessionId);
      await env.MESSENGER_WEBHOOK_QUEUE.send(wakeup, { delaySeconds: 0 });
    } else {
      await env.MESSENGER_WEBHOOK_QUEUE.send({
        channel: "zalo_control_event",
        payload: body,
        queuedAt: new Date().toISOString(),
      });
    }
    stats.queued += 1;
  }
  return { status: 200, body: stats };
}

async function listWorkerDashboardSessions(
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
      status: "available" | "unavailable";
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
    visibleSummaries
      .map(async (summary) => {
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

function defaultWorkerSessionControl(sessionId: string) {
  return {
    sessionId,
    agentMode: "ai_active" as const,
    assignedAgentId: null,
    updatedAt: new Date(0).toISOString(),
  };
}

function deeplinkForWorkerSession(
  sessionId: string,
  env: WorkerEnv,
): {
  status: "available" | "unavailable";
  url: string | null;
  reason?: string;
} {
  const target = channelTargetForWorkerSession(sessionId);
  if (!target)
    return { status: "unavailable", url: null, reason: "Unknown channel" };

  if (target.channel === "messenger") {
    if (!env.META_INBOX_URL_TEMPLATE)
      return {
        status: "unavailable",
        url: null,
        reason: "Missing META_INBOX_URL_TEMPLATE",
      };
    if (!env.META_PAGE_ID)
      return {
        status: "unavailable",
        url: null,
        reason: "Missing META_PAGE_ID",
      };
    return {
      status: "available",
      url: renderWorkerInboxUrlTemplate(env.META_INBOX_URL_TEMPLATE, {
        pageId: env.META_PAGE_ID,
        externalUserId: target.externalUserId,
        sessionId,
      }),
    };
  }

  if (target.channel === "kfc") {
    return {
      status: "unavailable",
      url: null,
      reason: "KFC chat deeplink disabled",
    };
  }

  if (!env.ZALO_INBOX_URL_TEMPLATE)
    return {
      status: "unavailable",
      url: null,
      reason: "Missing ZALO_INBOX_URL_TEMPLATE",
    };
  if (!env.ZALO_OA_ID)
    return { status: "unavailable", url: null, reason: "Missing ZALO_OA_ID" };
  return {
    status: "available",
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
    .replaceAll("{pageId}", encodeURIComponent(values.pageId))
    .replaceAll("{externalUserId}", encodeURIComponent(values.externalUserId))
    .replaceAll("{sessionId}", encodeURIComponent(values.sessionId));
}

function channelTargetForWorkerSession(
  sessionId: string,
):
  | { channel: "messenger" | "zalo" | "kfc"; externalUserId: string }
  | undefined {
  return dashboardSessionTarget(sessionId);
}

async function checkMessengerToken(env: WorkerEnv): Promise<{
  ok: boolean;
  required: boolean;
  configured: boolean;
  message?: string;
}> {
  const token = env.META_PAGE_ACCESS_TOKEN ?? "";
  if (!token) {
    return {
      ok: false,
      required: true,
      configured: false,
      message: "META_PAGE_ACCESS_TOKEN is not configured",
    };
  }

  const baseUrl = (
    env.MESSENGER_GRAPH_API_BASE_URL || "https://graph.facebook.com"
  ).replace(/\/$/, "");
  const pageId = env.META_PAGE_ID ?? "";
  const endpoint = new URL(`${baseUrl}/${pageId}/subscribed_apps`);
  endpoint.searchParams.set("access_token", token);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await (env.MESSENGER_FETCH ?? fetch)(endpoint, {
      signal: controller.signal,
    });
    const body = (await response.json().catch(() => ({}))) as {
      data?: unknown[];
      error?: { message?: string; code?: number; error_subcode?: number };
    };
    if (response.ok && Array.isArray(body.data))
      return { ok: true, required: true, configured: true };
    return {
      ok: false,
      required: true,
      configured: true,
      message:
        body.error?.message ??
        `Messenger token check failed with HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      required: true,
      configured: true,
      message:
        error instanceof Error ? error.message : "Messenger token check failed",
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
  if (response.contentType?.startsWith("text/")) {
    return new Response(String(response.body), {
      status: response.status,
      headers: { ...corsHeaders(), "Content-Type": response.contentType },
    });
  }
  return json(response.body, response.status);
}

function customerRunEventResponse(
  store: ConversationStore,
  runId: string,
  after: number,
  signal: AbortSignal,
): Response {
  const encoder = new TextEncoder();
  let stopped = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (value: string) => controller.enqueue(encoder.encode(value));
      const heartbeat = setInterval(() => {
        if (!stopped) write(": heartbeat\n\n");
      }, 10_000);
      const stop = () => {
        if (stopped) return;
        stopped = true;
        clearInterval(heartbeat);
        try { controller.close(); } catch { /* client already disconnected */ }
      };
      signal.addEventListener("abort", stop, { once: true });
      setTimeout(stop, 25_000);
      write(": connected\n\n");
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
            write(`id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
          }
          pollDelayMs = events.length > 0
            ? 100
            : Math.min(pollDelayMs * 2, 1_000);
          if (
            run &&
            ["completed", "failed", "cancelled", "superseded"].includes(run.status) &&
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
      "Cache-Control": "no-cache, no-transform",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}

async function persistDashboardEvent(
  env: WorkerEnv,
  store: D1Store,
  event: DashboardEvent,
): Promise<void> {
  await store.appendDashboardEvent(event);
  if (!env.DASHBOARD_SOCKET) return;
  try {
    await env.DASHBOARD_SOCKET.getByName("operations").fetch(
      "https://dashboard-socket/events",
      {
        method: "POST",
        body: JSON.stringify(event),
      },
    );
  } catch {
    // Durable event persistence remains authoritative during socket outages.
  }
}

function scheduleDashboardEvent(
  env: WorkerEnv,
  store: D1Store,
  event: DashboardEvent,
  context?: WorkerExecutionContext,
): Promise<void> | void {
  const work = persistDashboardEvent(env, store, event);
  if (!context) return work;
  context.waitUntil(work);
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      ...corsHeaders(),
      "Cache-Control": "no-store, no-cache, max-age=0",
      "Content-Type": "application/json",
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: string, status = 200): Response {
  return new Response(value, {
    status,
    headers: {
      ...corsHeaders(),
      "Cache-Control": "no-store, no-cache, max-age=0",
      "Content-Type": "text/plain",
    },
  });
}

function html(value: string, status = 200): Response {
  return new Response(value, {
    status,
    headers: {
      ...corsHeaders(),
      "Cache-Control": "no-store, no-cache, max-age=0",
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}

function authorizeDemoAdmin(
  request: Request,
  env: WorkerEnv,
): { ok: true } | { ok: false; status: number; errorCode: string } {
  return authorizeDemoAdminHeaders({
    expectedToken: env.KFC_DEMO_ADMIN_TOKEN,
    authorizationHeader: request.headers.get("authorization") ?? undefined,
    tokenHeader: request.headers.get("x-kfc-demo-admin-token") ?? undefined,
  });
}

function workerLifecycleOptions(env: WorkerEnv, store: D1Store) {
  if (env.KFC_COMMERCE_ENVIRONMENT !== "sandbox" || !env.KFC_MENU_API_URL) return undefined;
  const repository = new D1LifecycleRepository(env.DB);
  const controls = new SandboxLifecycleControls(repository);
  return {
    environment: "sandbox" as const,
    controls,
    async createInput(sessionId: string) {
      const observation = await fetchCatalogObservation({
        environment: "sandbox",
        sourceUrl: env.KFC_MENU_API_URL!,
        fallbackTtlSeconds: env.CATALOG_TTL_SECONDS ? Number(env.CATALOG_TTL_SECONDS) : 300,
      });
      await store.appendEvent(sessionId, "catalog_observation_pinned", { observation });
      const customerBinding = await workerBindingHash(`customer:${sessionId.startsWith("kfc:") ? sessionId.slice(4) : sessionId}`);
      const sessionBinding = await workerBindingHash(`session:${sessionId}`);
      const logicalTime = Date.now();
      return {
        environment: "sandbox" as const,
        scenarioDefinitionVersion: "kfc-genui-proof-v1",
        releaseId: env.RELEASE_GIT_SHA ?? "unknown",
        catalogObservationId: observation.id,
        catalogHash: observation.sha256,
        customerBinding,
        sessionBinding,
        paymentPolicy: "prepaid" as const,
        fulfillmentPolicy: "delivery" as const,
        logicalTime,
        expiresAt: logicalTime + 60 * 60 * 1000,
      };
    },
    async binding(instanceId: string) {
      const instance = await repository.get("sandbox", instanceId);
      if (!instance) throw new LifecycleError("not_found", "Lifecycle instance not found");
      return lifecycleBinding(instance);
    },
  };
}

async function workerBindingHash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function requiresDemoAdmin(pathname: string): boolean {
  return pathname.startsWith("/admin/") ||
    pathname.startsWith("/dashboard/") ||
    /^\/chat\/kfc\/runs\/[^/]+\/(?:cancel|events)$/.test(pathname) ||
    /^\/chat\/kfc\/sessions\/[^/]+\/updates$/.test(pathname);
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
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type,Authorization,X-KFC-Demo-Admin-Token",
  };
}
