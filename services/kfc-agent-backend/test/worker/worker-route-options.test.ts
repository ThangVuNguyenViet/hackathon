import { describe, expect, it, vi } from 'vitest';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import { D1Store } from '../../src/persistence/d1Store.js';
import {
  buildWorkerRouteOptions,
  type BuiltWorkerRouteOptions,
  type WorkerRouteSurface,
} from '../../src/workerRouteOptions.js';
import type { WorkerEnv } from '../../src/worker.js';
import { FakeD1Database } from '../support/fakeD1Database.js';

interface WorkerRouteHarness {
  built: BuiltWorkerRouteOptions;
  dashboard: DashboardEventBus;
  env: WorkerEnv;
  messengerFetch: typeof fetch;
  store: D1Store;
  zaloFetch: typeof fetch;
}

function workerEnv(
  db: FakeD1Database,
  overrides: Partial<WorkerEnv> = {},
): WorkerEnv {
  return {
    DB: db,
    KFC_AGENT_PROVIDER: 'google',
    GOOGLE_API_KEY: 'google_agent_test_key',
    OPENAI_API_KEY: 'openai_unused_test_key',
    LANGSMITH_API_KEY: 'langsmith_test_key',
    LANGSMITH_PROJECT: 'worker-route-options-test',
    LANGSMITH_ENDPOINT: 'https://smith.example.test',
    LANGSMITH_TRACING_SAMPLING_RATE: '1',
    KFC_CONFIRMATION_SIGNING_KEY_ID: 'worker-primary',
    KFC_CONFIRMATION_SIGNING_SECRET:
      'worker-confirmation-signing-secret-0001',
    KFC_CONFIRMATION_PREVIOUS_SIGNING_KEYS: JSON.stringify([
      {
        keyId: 'worker-previous',
        secret: 'worker-confirmation-signing-secret-0000',
      },
    ]),
    MESSENGER_VERIFY_TOKEN: 'messenger_verify',
    META_PAGE_ID: 'page_1',
    META_PAGE_ACCESS_TOKEN: 'page_access_token',
    MESSENGER_GRAPH_API_BASE_URL: 'https://graph.example.test',
    ZALO_OA_ID: 'zalo_oa_1',
    ZALO_ACCESS_TOKEN: 'zalo_access_token',
    ZALO_API_BASE_URL: 'https://zalo.example.test',
    KFC_COMMERCE_MODE: 'gateway',
    KFC_COMMERCE_ENVIRONMENT: 'sandbox',
    KFC_MENU_API_URL: 'https://menu.example.test/catalog',
    CATALOG_TTL_SECONDS: '600',
    KFC_COMMERCE_GATEWAY_BASE_URL:
      'https://commerce.example.test',
    KFC_COMMERCE_GATEWAY_TOKEN: 'commerce_gateway_token',
    KFC_POS_MODE: 'disabled',
    RELEASE_GIT_SHA: 'worker-route-options-sha',
    RELEASE_DEPLOYMENT_ID: 'worker-route-options-deployment',
    RELEASE_BUILT_AT: '2026-07-20T00:00:00.000Z',
    RELEASE_DIRTY: 'false',
    ...overrides,
  };
}

function buildHarness(surface: WorkerRouteSurface): WorkerRouteHarness {
  const db = new FakeD1Database();
  const messengerFetch = vi.fn(
    async () => new Response(null, { status: 204 }),
  );
  const zaloFetch = vi.fn(
    async () => new Response(null, { status: 204 }),
  );
  const env = workerEnv(db, {
    MESSENGER_FETCH: messengerFetch,
    ZALO_FETCH: zaloFetch,
  });
  const store = new D1Store(db);
  const dashboard = new DashboardEventBus();
  return {
    built: buildWorkerRouteOptions({
      env,
      store,
      dashboard,
      surface,
    }),
    dashboard,
    env,
    messengerFetch,
    store,
    zaloFetch,
  };
}

function expectCommonWorkerCapabilities(
  harness: WorkerRouteHarness,
): void {
  const { routeOptions } = harness.built;
  expect(routeOptions.store).toBe(harness.store);
  expect(routeOptions.dashboard).toBe(harness.dashboard);
  expect(routeOptions.checkpointer).toBeDefined();
  expect(routeOptions.fixtures?.menuItems.length).toBeGreaterThan(0);
  expect(routeOptions.messengerFetchImpl).toBe(harness.messengerFetch);
  expect(routeOptions.messengerPageAccessToken).toBe('page_access_token');
  expect(routeOptions.zaloFetchImpl).toBe(harness.zaloFetch);

  expect(routeOptions.agent?.identity).toMatchObject({
    provider: 'google',
    model: 'gemini-3.1-flash-lite',
  });
  expect(routeOptions.monitorJudge).toBeDefined();
  expect(routeOptions.agentTracer).toBeDefined();

  expect(routeOptions.kfcCommerceGateway).toBeDefined();
  expect(routeOptions.kfcCommerceProvider).toBeDefined();
  expect(typeof routeOptions.kfcCommerceProvider?.cart.createCart)
    .toBe('function');
  expect(typeof routeOptions.kfcCommerceProvider?.inventory.checkInventory)
    .toBe('function');
  expect(typeof routeOptions.kfcCommerceProvider?.storeLocator.findStores)
    .toBe('function');
  expect(
    typeof routeOptions.kfcCommerceProvider?.fulfillment.quoteFulfillment,
  ).toBe('function');

  expect(routeOptions.lifecycle?.environment).toBe('sandbox');
  expect(typeof routeOptions.lifecycle?.controls.create).toBe('function');
  expect(typeof routeOptions.lifecycle?.activeForSession).toBe('function');
  expect(routeOptions.catalog).toEqual({
    environment: 'sandbox',
    sourceUrl: 'https://menu.example.test/catalog',
    fallbackTtlSeconds: 600,
  });
  expect(routeOptions.readiness?.commerce).toMatchObject({
    mode: 'gateway',
    baseUrl: 'https://commerce.example.test',
    token: 'commerce_gateway_token',
  });
  expect(routeOptions.readiness?.runtime).toMatchObject({
    agentProfileMode: 'production',
    commerceEnvironment: 'sandbox',
  });
  expect(routeOptions.readiness?.release).toEqual({
    gitSha: 'worker-route-options-sha',
    deploymentId: 'worker-route-options-deployment',
    builtAt: '2026-07-20T00:00:00.000Z',
    dirty: false,
  });
  expect(routeOptions.confirmationApprovalKeyRing).toMatchObject({
    activeKeyId: 'worker-primary',
  });
  expect(
    routeOptions.confirmationApprovalKeyRing?.keys.has('worker-primary'),
  ).toBe(true);
  expect(
    routeOptions.confirmationApprovalKeyRing?.keys.has('worker-previous'),
  ).toBe(true);
}

describe('Worker route option parity', () => {
  it('fails closed for a misspelled raw PVCFC public-data binding', () => {
    const db = new FakeD1Database();
    const env = workerEnv(db, {
      PVCFC_ASTRAFLOW_API_KEY: 'pvcfc-astraflow-key',
    });
    Reflect.set(env, 'PVCFC_PUBLIC_DATA_MODE', 'fixtuer');

    expect(() =>
      buildWorkerRouteOptions({
        env,
        store: new D1Store(db),
        dashboard: new DashboardEventBus(),
        surface: { kind: 'queue' },
      }),
    ).toThrow('PVCFC_PUBLIC_DATA_MODE must be fixture or api');
  });

  it('provides the same durable commerce/runtime capabilities to fetch, queue, and scheduled surfaces', () => {
    const fetchHarness = buildHarness({
      kind: 'fetch',
      request: new Request('https://worker.local/ready?deep=1'),
      customerRunPaceMs: 0,
      customerRunMaxTextEvents: 3,
    });
    const queueHarness = buildHarness({ kind: 'queue' });
    const scheduledHarness = buildHarness({ kind: 'scheduled' });

    for (const harness of [
      fetchHarness,
      queueHarness,
      scheduledHarness,
    ]) {
      expectCommonWorkerCapabilities(harness);
      const deferredTask = vi.fn(async () => undefined);
      harness.built.routeOptions.defer?.(deferredTask);
      expect(harness.built.deferredAgentTasks).toEqual([deferredTask]);
    }

    const capabilityKeys = (harness: WorkerRouteHarness) =>
      Object.keys(
        harness.built.routeOptions.kfcCommerceProvider ?? {},
      ).sort();
    expect(capabilityKeys(queueHarness)).toEqual(
      capabilityKeys(fetchHarness),
    );
    expect(capabilityKeys(scheduledHarness)).toEqual(
      capabilityKeys(fetchHarness),
    );

    const sameRuntimeQueue = buildWorkerRouteOptions({
      env: fetchHarness.env,
      store: fetchHarness.store,
      dashboard: fetchHarness.dashboard,
      surface: { kind: 'queue' },
    });
    expect(sameRuntimeQueue.routeOptions.checkpointer).toBe(
      fetchHarness.built.routeOptions.checkpointer,
    );
  });

  it('layers only request-bound history, pacing, and deep readiness onto fetch', () => {
    const fetchHarness = buildHarness({
      kind: 'fetch',
      request: new Request('https://worker.local/ready?deep=1'),
      customerRunPaceMs: 7,
      customerRunMaxTextEvents: 5,
    });
    const queueHarness = buildHarness({ kind: 'queue' });
    const scheduledHarness = buildHarness({ kind: 'scheduled' });

    expect(fetchHarness.built.routeOptions.messengerHistorySync)
      .toBeDefined();
    expect(fetchHarness.built.routeOptions.customerRunPaceMs).toBe(7);
    expect(
      fetchHarness.built.routeOptions.customerRunMaxTextEvents,
    ).toBe(5);
    expect(fetchHarness.built.routeOptions.readiness?.database)
      .toBeDefined();
    expect(fetchHarness.built.routeOptions.readiness?.messengerToken)
      .toBeDefined();

    for (const harness of [queueHarness, scheduledHarness]) {
      expect(harness.built.routeOptions.messengerHistorySync)
        .toBeUndefined();
      expect(harness.built.routeOptions.customerRunPaceMs)
        .toBeUndefined();
      expect(harness.built.routeOptions.customerRunMaxTextEvents)
        .toBeUndefined();
      expect(harness.built.routeOptions.readiness?.database)
        .toBeUndefined();
      expect(harness.built.routeOptions.readiness?.messengerToken)
        .toBeUndefined();
      expect(harness.built.routeOptions.readiness?.commerce?.mode)
        .toBe('gateway');
    }
  });

  it('does not enable the Messenger token probe for ordinary fetch requests', () => {
    const harness = buildHarness({
      kind: 'fetch',
      request: new Request('https://worker.local/chat/kfc/message', {
        method: 'POST',
      }),
      customerRunPaceMs: 0,
      customerRunMaxTextEvents: 3,
    });

    expect(harness.built.routeOptions.readiness?.database).toBeDefined();
    expect(harness.built.routeOptions.readiness?.messengerToken)
      .toBeUndefined();
  });
});
