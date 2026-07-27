import type { RouteOptions } from './api/routeHandlerContracts.js';
import { buildServerOptionsFromEnv } from './api/serverOptions.js';
import { checkMessengerToken } from './workerReadiness.js';
import { createWorkerMessengerHistorySync } from './workerMessaging.js';
import { loadBundledGeneratedFixtures } from './fixtures/bundledFixtures.js';
import type { DashboardEventBus } from './dashboard/eventBus.js';
import type { D1Store } from './persistence/d1Store.js';
import type { WorkerEnv } from './worker.js';

export type WorkerRouteSurface =
  | {
      kind: 'fetch';
      request: Request;
      customerRunPaceMs: number;
      customerRunMaxTextEvents: number;
    }
  | {
      kind: 'queue' | 'scheduled';
    };

export interface BuildWorkerRouteOptionsInput {
  env: WorkerEnv;
  store: D1Store;
  dashboard: DashboardEventBus;
  surface: WorkerRouteSurface;
}

export interface BuiltWorkerRouteOptions {
  routeOptions: RouteOptions;
  deferredAgentTasks: Array<() => Promise<void>>;
}

function workerModelEnv(env: WorkerEnv) {
  return {
    KFC_AGENT_CANDIDATE: env.KFC_AGENT_CANDIDATE ?? 'openai-gpt-4.1-mini',
    KFC_MONITOR_CANDIDATE: env.KFC_MONITOR_CANDIDATE,
    OPENAI_API_KEY: env.OPENAI_API_KEY ?? '',
    OPENCODE_API_KEY: env.OPENCODE_API_KEY ?? '',
    GOOGLE_API_KEY: env.GOOGLE_API_KEY ?? '',
    OPENAI_BASE_URL: env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
  } as const;
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

function buildBaseWorkerRouteOptions(
  env: WorkerEnv,
  request?: Request,
): RouteOptions {
  return buildServerOptionsFromEnv({
    PORT: 0,
    ...workerModelEnv(env),
    ...openAiDiagnosticEnv(env, request),
    LANGSMITH_API_KEY: env.LANGSMITH_API_KEY ?? '',
    LANGSMITH_PROJECT: env.LANGSMITH_PROJECT ?? 'kfc-agent-backend-worker',
    LANGSMITH_ENDPOINT:
      env.LANGSMITH_ENDPOINT ?? 'https://api.smith.langchain.com',
    LANGSMITH_TRACING_SAMPLING_RATE: Number(
      env.LANGSMITH_TRACING_SAMPLING_RATE ?? '1',
    ),
    KFC_SHOWCASE_DATASET:
      env.KFC_SHOWCASE_DATASET ?? 'kfc-showcase-scenarios-v1',
    RELEASE_GIT_SHA: env.RELEASE_GIT_SHA ?? 'unknown',
    RELEASE_DEPLOYMENT_ID: env.RELEASE_DEPLOYMENT_ID ?? 'unknown',
    RELEASE_BUILT_AT: env.RELEASE_BUILT_AT ?? '',
    RELEASE_DIRTY: env.RELEASE_DIRTY ?? '',
    MESSENGER_VERIFY_TOKEN: env.MESSENGER_VERIFY_TOKEN ?? '',
    META_PAGE_ID: env.META_PAGE_ID ?? '',
    META_APP_SECRET: env.META_APP_SECRET ?? '',
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
    KFC_DEMO_ADMIN_TOKEN: env.KFC_DEMO_ADMIN_TOKEN ?? '',
  });
}

function fetchReadiness(
  env: WorkerEnv,
  base: RouteOptions['readiness'],
  request: Request,
  options: RouteOptions,
): RouteOptions['readiness'] {
  const url = new URL(request.url);
  return {
    ...base,
    database: async () => {
      await env.DB.prepare('SELECT 1').first();
      return { ok: true };
    },
    messengerToken:
      request.method === 'GET' &&
      url.pathname === '/ready' &&
      url.searchParams.get('deep') === '1'
        ? () => checkMessengerToken(env)
        : undefined,
    openAiConfigured: Boolean(env.OPENAI_API_KEY),
    openAiRequired: false,
    agentConfigured: options.agent !== undefined,
    monitorConfigured: options.monitorJudge !== undefined,
    zaloRequired: false,
  };
}

export function buildWorkerRouteOptions(
  input: BuildWorkerRouteOptionsInput,
): BuiltWorkerRouteOptions {
  const { env, store, dashboard, surface } = input;
  const request = surface.kind === 'fetch' ? surface.request : undefined;
  const options = buildBaseWorkerRouteOptions(env, request);
  const deferredAgentTasks: Array<() => Promise<void>> = [];
  const fixtures = loadBundledGeneratedFixtures();

  const routeOptions: RouteOptions = {
    ...options,
    recommendations: options.recommendations,
    fixtures,
    store,
    dashboard,
    messengerFetchImpl: env.MESSENGER_FETCH ?? fetch,
    zaloFetchImpl: env.ZALO_FETCH ?? fetch,
    defer: (task) => deferredAgentTasks.push(task),
  };

  if (surface.kind === 'fetch') {
    routeOptions.messengerHistorySync = createWorkerMessengerHistorySync(
      store,
      dashboard,
      env,
    );
    routeOptions.customerRunPaceMs = surface.customerRunPaceMs;
    routeOptions.customerRunMaxTextEvents = surface.customerRunMaxTextEvents;
    routeOptions.readiness = fetchReadiness(
      env,
      options.readiness,
      surface.request,
      options,
    );
  }

  return { routeOptions, deferredAgentTasks };
}
