import { describe, expect, it, vi } from 'vitest';
import worker, { type WorkerEnv, type WorkerWebhookJob } from '../../src/worker.js';
import { D1Store } from '../../src/persistence/d1Store.js';
import { FakeD1Database } from '../support/fakeD1Database.js';

function env(database: FakeD1Database): WorkerEnv {
  return {
    DB: database,
    KFC_AGENT_PROVIDER: 'google',
    GOOGLE_API_KEY: 'worker-google-key',
    KFC_COMMERCE_MODE: 'fixture',
    KFC_CONFIRMATION_SIGNING_KEY_ID: 'worker-primary',
    KFC_CONFIRMATION_SIGNING_SECRET: 'worker-confirmation-secret-more-than-32-bytes',
    KFC_DEMO_ADMIN_TOKEN: 'worker-admin-token',
    MESSENGER_VERIFY_TOKEN: 'worker-verify',
    META_PAGE_ID: 'page-1',
    META_APP_SECRET: 'meta-secret',
    META_PAGE_ACCESS_TOKEN: 'page-token',
    META_INBOX_URL_TEMPLATE: 'https://business.facebook.test/{pageId}/{externalUserId}',
    ZALO_OA_ID: 'oa-worker',
    ZALO_ACCESS_TOKEN: 'zalo-token',
  };
}

describe('maintained Worker platform behavior', () => {
  it('serves health/readiness and protects dashboard administration', async () => {
    const workerEnv = env(new FakeD1Database());
    const [health, ready, denied, allowed] = await Promise.all([
      worker.fetch(new Request('https://worker.test/health'), workerEnv),
      worker.fetch(new Request('https://worker.test/ready'), workerEnv),
      worker.fetch(new Request('https://worker.test/dashboard/sessions'), workerEnv),
      worker.fetch(new Request('https://worker.test/dashboard/sessions', {
        headers: { Authorization: 'Bearer worker-admin-token' },
      }), workerEnv),
    ]);

    expect(health.status).toBe(200);
    expect(ready.status, JSON.stringify(await ready.clone().json())).toBe(200);
    expect(denied.status).toBe(401);
    expect(allowed.status).toBe(200);
  });

  it('processes an inert Zalo queue event into D1 without invoking an agent', async () => {
    const database = new FakeD1Database();
    const ack = vi.fn();
    const body: WorkerWebhookJob = {
      channel: 'zalo_control_event',
      payload: {
        event_name: 'future_event',
        sender: { id: 'zalo-user-1' },
        recipient: { id: 'oa-worker' },
        timestamp: 1783323124608,
      },
      queuedAt: '2026-08-12T00:00:00.000Z',
    };

    await worker.queue({ messages: [{ body, ack }] }, env(database));

    expect(ack).toHaveBeenCalledOnce();
    const store = new D1Store(database);
    await expect(store.listTurns('zalo:zalo-user-1')).resolves.toEqual([
      expect.objectContaining({
        role: 'user',
        text: '[Unsupported Zalo event]',
      }),
    ]);
    expect(database.tables.agent_runs).toEqual([]);
  });

  it('runs scheduled recovery with no due work', async () => {
    const waitUntil = vi.fn();
    await expect(worker.scheduled(
      { scheduledTime: Date.parse('2026-08-12T00:00:00.000Z') },
      env(new FakeD1Database()),
      { waitUntil },
    )).resolves.toBeUndefined();
  });
});
