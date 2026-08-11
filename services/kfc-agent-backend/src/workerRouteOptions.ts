import type { RouteOptions } from './api/routeHandlerContracts.js';
import { buildServerOptionsFromEnv } from './api/serverOptions.js';
import { checkMessengerToken } from './workerReadiness.js';
import {
  createWorkerMessengerHistorySync,
  workerMessengerFetch,
} from './workerMessaging.js';
import { workerLifecycleOptions } from './workerLifecycle.js';
import { loadBundledGeneratedFixtures } from './fixtures/bundledFixtures.js';
import { createMockClients } from './mock/createMockClients.js';
import { createMockAutomaticRecommendationHttpRuntime } from './recommendations/serving/mock-runtime.js';
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
    KFC_AGENT_PROFILE_MODE: env.KFC_AGENT_PROFILE_MODE ?? 'production',
    KFC_AGENT_PROVIDER: env.KFC_AGENT_PROVIDER ?? 'google',
    KFC_AGENT_MODEL: env.KFC_AGENT_MODEL ?? '',
    KFC_MONITOR_PROVIDER: env.KFC_MONITOR_PROVIDER,
    KFC_MONITOR_MODEL: env.KFC_MONITOR_MODEL ?? '',
    KFC_CONFIRMATION_SIGNING_KEY_ID:
      env.KFC_CONFIRMATION_SIGNING_KEY_ID ?? 'primary',
    KFC_CONFIRMATION_SIGNING_SECRET:
      env.KFC_CONFIRMATION_SIGNING_SECRET ?? '',
    KFC_CONFIRMATION_PREVIOUS_SIGNING_KEYS:
      env.KFC_CONFIRMATION_PREVIOUS_SIGNING_KEYS ?? '',
    OPENAI_API_KEY: env.OPENAI_API_KEY ?? '',
    GOOGLE_API_KEY: env.GOOGLE_API_KEY ?? '',
    OPENAI_BASE_URL: env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
    PVCFC_ASTRAFLOW_API_KEY: env.PVCFC_ASTRAFLOW_API_KEY ?? '',
    PVCFC_ASTRAFLOW_BASE_URL:
      env.PVCFC_ASTRAFLOW_BASE_URL ?? 'https://api-sg.umodelverse.ai/v1',
    PVCFC_ASTRAFLOW_MODEL: env.PVCFC_ASTRAFLOW_MODEL ?? 'gpt-5.6-luna',
    PVCFC_PUBLIC_DATA_MODE: env.PVCFC_PUBLIC_DATA_MODE,
  } as const;
}

function openAiDiagnosticEnv(env: WorkerEnv, request?: Request) {
  const placement = request?.headers.get('cf-placement') ?? '';
  const placedExecutionColo =
    /(?:^|[-_])([A-Z0-9]{3})$/.exec(placement)?.[1];
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
    DATABASE_URL: 'd1://DB',
    ...workerModelEnv(env),
    ...openAiDiagnosticEnv(env, request),
    LANGSMITH_API_KEY: env.LANGSMITH_API_KEY ?? '',
    LANGSMITH_PROJECT:
      env.LANGSMITH_PROJECT ?? 'kfc-agent-backend-worker',
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
    MESSENGER_GRAPH_API_BASE_URL:
      env.MESSENGER_GRAPH_API_BASE_URL ?? '',
    ZALO_OA_ID: env.ZALO_OA_ID ?? '',
    ZALO_ACCESS_TOKEN: env.ZALO_ACCESS_TOKEN ?? '',
    ZALO_INBOX_URL_TEMPLATE: env.ZALO_INBOX_URL_TEMPLATE ?? '',
    ZALO_REFRESH_TOKEN: env.ZALO_REFRESH_TOKEN ?? '',
    ZALO_APP_ID: env.ZALO_APP_ID ?? '',
    ZALO_APP_SECRET: env.ZALO_APP_SECRET ?? '',
    ZALO_API_BASE_URL: env.ZALO_API_BASE_URL ?? '',
    KFC_COMMERCE_MODE: 'fixture',
    KFC_COMMERCE_ENVIRONMENT: env.KFC_COMMERCE_ENVIRONMENT,
    KFC_MENU_API_URL: env.KFC_MENU_API_URL,
    CATALOG_TTL_SECONDS: env.CATALOG_TTL_SECONDS
      ? Number(env.CATALOG_TTL_SECONDS)
      : undefined,
    KFC_COMMERCE_GATEWAY_BASE_URL: '',
    KFC_COMMERCE_GATEWAY_TOKEN: '',
    KFC_POS_MODE: env.KFC_POS_MODE ?? 'disabled',
    KFC_POS_BASE_URL: env.KFC_POS_BASE_URL ?? '',
    KFC_POS_TOKEN: env.KFC_POS_TOKEN ?? '',
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
    agentConfigured: options.readiness?.agentConfigured ?? false,
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
  const fixtureProvider = createMockClients(fixtures);
  const automaticRecommendations =
    createMockAutomaticRecommendationHttpRuntime(fixtures);
  const automaticRecommendationStoreId =
    fixtures.stores[0]?.storeId ?? 'fixture-store';

  const routeOptions: RouteOptions = {
    ...options,
    fixtures,
    kfcCommerceProvider: options.kfcCommerceProvider ?? {
      cart: fixtureProvider.cart,
      inventory: fixtureProvider.inventory,
      storeLocator: fixtureProvider.storeLocator,
      fulfillment: fixtureProvider.fulfillment,
    },
    automaticRecommendations,
    automaticRecommendationContext: (sessionId) => ({
      storeId: automaticRecommendationStoreId,
      fulfilmentMode: 'pickup',
      locale: 'vi-VN',
      orderingJourneyRef: `chat:${sessionId}:ordering-journey`,
      opportunityRef: `chat:${sessionId}:automatic-recommendation`,
    }),
    store,
    dashboard,
    lifecycle: workerLifecycleOptions(env, store),
    messengerFetchImpl: workerMessengerFetch(env),
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
    routeOptions.customerRunMaxTextEvents =
      surface.customerRunMaxTextEvents;
    routeOptions.readiness = fetchReadiness(
      env,
      options.readiness,
      surface.request,
      options,
    );
  }

  return { routeOptions, deferredAgentTasks };
}
