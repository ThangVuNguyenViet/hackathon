import { describe, expect, it, vi } from 'vitest';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import { D1Store } from '../../src/persistence/d1Store.js';
import { buildWorkerRouteOptions, type WorkerRouteSurface } from '../../src/workerRouteOptions.js';
import type { WorkerEnv } from '../../src/worker.js';
import { FakeD1Database } from '../support/fakeD1Database.js';

function env(db: FakeD1Database, overrides: Partial<WorkerEnv> = {}): WorkerEnv {
  return {
    DB: db,
    KFC_AGENT_PROVIDER: 'google',
    GOOGLE_API_KEY: 'worker-google-key',
    KFC_COMMERCE_MODE: 'fixture',
    KFC_COMMERCE_ENVIRONMENT: 'sandbox',
    KFC_CONFIRMATION_SIGNING_KEY_ID: 'worker-primary',
    KFC_CONFIRMATION_SIGNING_SECRET: 'worker-confirmation-secret-more-than-32-bytes',
    MESSENGER_VERIFY_TOKEN: 'verify',
    MESSENGER_BUSINESS_ID: 'kfc',
    META_PAGE_ID: 'page-1',
    META_APP_SECRET: 'meta-secret',
    META_PAGE_ACCESS_TOKEN: 'page-token',
    MESSENGER_GRAPH_API_BASE_URL: 'https://graph.test',
    ZALO_OA_ID: 'zalo-oa',
    ZALO_BUSINESS_ID: 'kfc',
    ZALO_ACCESS_TOKEN: 'zalo-token',
    RELEASE_GIT_SHA: 'route-options-sha',
    RELEASE_DEPLOYMENT_ID: 'route-options-deployment',
    RELEASE_BUILT_AT: '2026-08-12T00:00:00.000Z',
    RELEASE_DIRTY: 'false',
    ...overrides,
  };
}

function build(surface: WorkerRouteSurface) {
  const db = new FakeD1Database();
  const messengerFetch = vi.fn(async () => new Response(null, { status: 204 }));
  const zaloFetch = vi.fn(async () => new Response(null, { status: 204 }));
  const workerEnv = env(db, { MESSENGER_FETCH: messengerFetch, ZALO_FETCH: zaloFetch });
  const store = new D1Store(db);
  const dashboard = new DashboardEventBus();
  return {
    ...buildWorkerRouteOptions({ env: workerEnv, store, dashboard, surface }),
    store,
    dashboard,
    messengerFetch,
    zaloFetch,
  };
}

describe('Worker route option parity', () => {
  it('fails closed for an invalid PVCFC provider binding', () => {
    const db = new FakeD1Database();
    const workerEnv = env(db, { PVCFC_ASTRAFLOW_API_KEY: 'pvcfc-key' });
    Reflect.set(workerEnv, 'PVCFC_PUBLIC_DATA_MODE', 'fixtuer');

    expect(() => buildWorkerRouteOptions({
      env: workerEnv,
      store: new D1Store(db),
      dashboard: new DashboardEventBus(),
      surface: { kind: 'queue' },
    })).toThrow('PVCFC_PUBLIC_DATA_MODE must be fixture or api');
  });

  it('preserves the same durable business capabilities across fetch, queue, and scheduled', () => {
    const surfaces: WorkerRouteSurface[] = [
      {
        kind: 'fetch',
        request: new Request('https://worker.test/ready?deep=1'),
        customerRunPaceMs: 0,
        customerRunMaxTextEvents: 3,
      },
      { kind: 'queue' },
      { kind: 'scheduled' },
    ];
    const harnesses = surfaces.map(build);

    for (const harness of harnesses) {
      expect(harness.routeOptions.store).toBe(harness.store);
      expect(harness.routeOptions.dashboard).toBe(harness.dashboard);
      expect(harness.routeOptions.fixtures?.menuItems.length).toBeGreaterThan(0);
      expect(harness.routeOptions.kfcCommerceProvider).toBeDefined();
      expect(harness.routeOptions.automaticRecommendations).toBeDefined();
      expect(harness.routeOptions.agent?.identity).toMatchObject({
        provider: 'google',
        model: 'gemini-3.1-flash-lite',
      });
      expect(harness.routeOptions.messengerFetchImpl).toBe(harness.messengerFetch);
      expect(harness.routeOptions.zaloFetchImpl).toBe(harness.zaloFetch);
      expect(harness.routeOptions).not.toHaveProperty('checkpointer');
    }
    const capabilityKeys = harnesses.map(({ routeOptions }) =>
      Object.keys(routeOptions.kfcCommerceProvider ?? {}).sort());
    expect(capabilityKeys[1]).toEqual(capabilityKeys[0]);
    expect(capabilityKeys[2]).toEqual(capabilityKeys[0]);
  });

  it('adds request-bound readiness and pacing only to fetch', () => {
    const fetchHarness = build({
      kind: 'fetch',
      request: new Request('https://worker.test/ready?deep=1'),
      customerRunPaceMs: 7,
      customerRunMaxTextEvents: 5,
    });
    const queueHarness = build({ kind: 'queue' });

    expect(fetchHarness.routeOptions.messengerHistorySync).toBeDefined();
    expect(fetchHarness.routeOptions.customerRunPaceMs).toBe(7);
    expect(fetchHarness.routeOptions.customerRunMaxTextEvents).toBe(5);
    expect(fetchHarness.routeOptions.readiness?.database).toBeDefined();
    expect(fetchHarness.routeOptions.readiness?.messengerToken).toBeDefined();
    expect(queueHarness.routeOptions.messengerHistorySync).toBeUndefined();
    expect(queueHarness.routeOptions.readiness?.database).toBeUndefined();
    expect(queueHarness.routeOptions.readiness?.messengerToken).toBeUndefined();
  });

  it('does not enable the Messenger deep probe for ordinary fetches', () => {
    const harness = build({
      kind: 'fetch',
      request: new Request('https://worker.test/chat/kfc/message', { method: 'POST' }),
      customerRunPaceMs: 0,
      customerRunMaxTextEvents: 3,
    });
    expect(harness.routeOptions.readiness?.database).toBeDefined();
    expect(harness.routeOptions.readiness?.messengerToken).toBeUndefined();
  });

  it('projects optional TinyFish capability identically across Worker surfaces', () => {
    const db = new FakeD1Database();
    const workerEnv = env(db, {
      PVCFC_PUBLIC_DATA_MODE: 'fixture',
      TINYFISH_API_KEY: 'worker-tinyfish-secret',
    });
    const surfaces: WorkerRouteSurface[] = [
      {
        kind: 'fetch',
        request: new Request('https://worker.test/chat/pvcfc/message'),
        customerRunPaceMs: 0,
        customerRunMaxTextEvents: 3,
      },
      { kind: 'queue' },
      { kind: 'scheduled' },
    ];

    const options = surfaces.map(
      (surface) =>
        buildWorkerRouteOptions({
          env: workerEnv,
          store: new D1Store(db),
          dashboard: new DashboardEventBus(),
          surface,
        }).routeOptions,
    );

    for (const routeOptions of options) {
      expect(routeOptions.pvcfcWebEvidenceClient).toBeDefined();
      expect(routeOptions.kfcWebEvidenceClient).toBe(
        routeOptions.pvcfcWebEvidenceClient,
      );
      expect(routeOptions.readiness?.webSearch).toEqual({
        configured: true,
        provider: 'tinyfish',
        mode: 'search-fetch',
      });
      expect(JSON.stringify(routeOptions.readiness)).not.toContain(
        'worker-tinyfish-secret',
      );
    }
  });
});
