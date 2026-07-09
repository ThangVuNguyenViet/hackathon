import { describe, expect, it, vi } from 'vitest';
import worker, { type WorkerEnv } from '../../src/worker.js';
import { FakeD1Database } from '../support/fakeD1Database.js';

describe('Cloudflare Worker backend', () => {
  function env(overrides: Partial<WorkerEnv> = {}): WorkerEnv {
    return {
      DB: new FakeD1Database(),
      MESSENGER_VERIFY_TOKEN: 'local_verify',
      META_PAGE_ID: '118976205445198',
      META_PAGE_ACCESS_TOKEN: 'page_token_local',
      OPENAI_API_KEY: '',
      ...overrides,
    };
  }

  it('serves health, readiness, and Messenger verification through fetch', async () => {
    const workerEnv = env();
    const health = await worker.fetch(new Request('https://worker.local/health'), workerEnv);
    const ready = await worker.fetch(new Request('https://worker.local/ready'), workerEnv);
    const verify = await worker.fetch(
      new Request(
        'https://worker.local/webhooks/messenger?hub.mode=subscribe&hub.verify_token=local_verify&hub.challenge=CHALLENGE_123',
      ),
      workerEnv,
    );

    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true, service: 'kfc-agent-backend' });
    expect(ready.status).toBe(200);
    expect(await ready.json()).toMatchObject({
      ok: true,
      checks: {
        database: { ok: true },
        fixtures: { ok: true },
        messenger: { ok: true },
      },
    });
    expect(verify.status).toBe(200);
    expect(await verify.text()).toBe('CHALLENGE_123');
  });

  it('processes Messenger webhooks once and exposes polling dashboard APIs', async () => {
    const workerEnv = env({
      MESSENGER_FETCH: vi.fn(async () =>
        new Response(JSON.stringify({ message_id: 'reply_1' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ) as typeof fetch,
    });
    const payload = {
      object: 'page',
      entry: [
        {
          id: '118976205445198',
          messaging: [
            {
              sender: { id: 'psid_1' },
              recipient: { id: '118976205445198' },
              timestamp: 1783323124608,
              message: { mid: 'mid_1', text: 'Cho mình 1 Combo 99K' },
            },
          ],
        },
      ],
    };

    const first = await worker.fetch(
      new Request('https://worker.local/webhooks/messenger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
      workerEnv,
    );
    const second = await worker.fetch(
      new Request('https://worker.local/webhooks/messenger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
      workerEnv,
    );
    const turns = await worker.fetch(new Request('https://worker.local/dashboard/sessions/messenger%3Apsid_1/turns'), workerEnv);
    const stream = await worker.fetch(new Request('https://worker.local/dashboard/stream'), workerEnv);

    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ received: 1, processed: 1, skippedDuplicates: 0, failed: 0 });
    expect(await second.json()).toMatchObject({ received: 1, processed: 0, skippedDuplicates: 1, failed: 0 });
    expect(await turns.json()).toMatchObject({
      turns: [expect.objectContaining({ role: 'user' }), expect.objectContaining({ role: 'assistant' })],
    });
    expect(stream.status).toBe(501);
  });
});
