import { describe, expect, it, vi } from 'vitest';
import worker, { type MessengerWebhookJob, type QueueBinding, type WorkerEnv } from '../../src/worker.js';
import { FakeD1Database } from '../support/fakeD1Database.js';

describe('Cloudflare Worker backend', () => {
  class FakeQueue implements QueueBinding<MessengerWebhookJob> {
    readonly messages: MessengerWebhookJob[] = [];
    readonly send = vi.fn(async (message: MessengerWebhookJob) => {
      this.messages.push(message);
    });
  }

  function env(overrides: Partial<WorkerEnv> = {}): WorkerEnv {
    return {
      DB: new FakeD1Database(),
      MESSENGER_VERIFY_TOKEN: 'local_verify',
      META_PAGE_ID: '118976205445198',
      META_PAGE_ACCESS_TOKEN: 'page_token_local',
      META_INBOX_URL_TEMPLATE: 'https://business.facebook.com/latest/inbox/all?asset_id={pageId}&selected_item_id={externalUserId}',
      ZALO_OA_ID: 'oa_local',
      ZALO_ACCESS_TOKEN: 'zalo_token_local',
      ZALO_INBOX_URL_TEMPLATE: 'https://oa.zalo.me/chatv2?oaid={pageId}&uid={externalUserId}',
      OPENAI_API_KEY: '',
      ...overrides,
    };
  }

  function messengerPayload(mid = 'mid_1') {
    return {
      object: 'page',
      entry: [
        {
          id: '118976205445198',
          messaging: [
            {
              sender: { id: 'psid_1' },
              recipient: { id: '118976205445198' },
              timestamp: 1783323124608,
              message: { mid, text: 'Cho mình 1 Combo 99K' },
            },
          ],
        },
      ],
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

  it('serves Messenger verification without touching D1', async () => {
    const workerEnv = env({
      DB: {
        prepare() {
          throw new Error('D1 should not be initialized for verification');
        },
      },
    });

    const verify = await worker.fetch(
      new Request(
        'https://worker.local/webhooks/messenger?hub.mode=subscribe&hub.verify_token=local_verify&hub.challenge=FAST_PATH',
      ),
      workerEnv,
    );

    expect(verify.status).toBe(200);
    expect(await verify.text()).toBe('FAST_PATH');
  });

  it('uses a permission-compatible Messenger token check for deep readiness', async () => {
    const messengerFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toContain('/118976205445198/subscribed_apps');
      return new Response(JSON.stringify({ data: [{ id: '1066574476058659' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;
    const workerEnv = env({ MESSENGER_FETCH: messengerFetch });

    const response = await worker.fetch(new Request('https://worker.local/ready?deep=1'), workerEnv);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      checks: {
        messengerToken: { ok: true, configured: true, required: true },
        zalo: { ok: true, configured: true, required: false },
      },
    });
    expect(messengerFetch).toHaveBeenCalledTimes(1);
  });

  it('enqueues Messenger webhooks once and processes them from the queue', async () => {
    const queue = new FakeQueue();
    const messengerFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body ?? '{}')) as { sender_action?: string };
        if (body.sender_action) {
          return new Response(JSON.stringify({ recipient_id: 'psid_1' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ message_id: 'reply_1' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ first_name: 'Demo', last_name: 'Customer', profile_pic: 'https://example.test/a.png' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const workerEnv = env({
      MESSENGER_WEBHOOK_QUEUE: queue,
      MESSENGER_FETCH: messengerFetch as typeof fetch,
    });
    const payload = messengerPayload();

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
    const turnsBeforeQueue = await worker.fetch(
      new Request('https://worker.local/dashboard/sessions/messenger%3Apsid_1/turns'),
      workerEnv,
    );
    expect(messengerFetch).not.toHaveBeenCalled();

    const ack = vi.fn();
    await worker.queue({ messages: queue.messages.map((body) => ({ body, ack })) }, workerEnv);

    const turns = await worker.fetch(new Request('https://worker.local/dashboard/sessions/messenger%3Apsid_1/turns'), workerEnv);
    const stream = await worker.fetch(new Request('https://worker.local/dashboard/stream'), workerEnv);

    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ received: 1, queued: 1, skippedDuplicates: 0, failed: 0 });
    expect(await second.json()).toMatchObject({ received: 1, queued: 0, skippedDuplicates: 1, failed: 0 });
    expect(queue.send).toHaveBeenCalledTimes(1);
    expect(await turnsBeforeQueue.json()).toMatchObject({ turns: [] });
    expect(ack).toHaveBeenCalledTimes(1);
    expect(await turns.json()).toMatchObject({
      turns: [expect.objectContaining({ role: 'user' }), expect.objectContaining({ role: 'assistant' })],
    });
    expect(
      messengerFetch.mock.calls
        .map((call) => JSON.parse(String(call[1]?.body ?? '{}')) as { sender_action?: string })
        .filter((body) => body.sender_action)
        .map((body) => body.sender_action),
    ).toEqual(['mark_seen', 'typing_on', 'typing_off']);
    expect(stream.status).toBe(501);
  });

  it('returns 503 when the Messenger queue binding is missing', async () => {
    const workerEnv = env();

    const response = await worker.fetch(
      new Request('https://worker.local/webhooks/messenger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messengerPayload()),
      }),
      workerEnv,
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ errorCode: 'messenger_webhook_queue_not_configured' });
  });

  it('stores expired Messenger token failures from the queue without throwing', async () => {
    const queue = new FakeQueue();
    const db = new FakeD1Database();
    const workerEnv = env({
      DB: db,
      MESSENGER_WEBHOOK_QUEUE: queue,
      MESSENGER_FETCH: vi.fn(async () =>
        new Response(
          JSON.stringify({
            error: {
              message: 'Error validating access token: Session has expired',
              code: 190,
              error_subcode: 463,
            },
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        ),
      ) as typeof fetch,
    });

    const response = await worker.fetch(
      new Request('https://worker.local/webhooks/messenger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messengerPayload('mid_expired_token')),
      }),
      workerEnv,
    );
    const ack = vi.fn();

    await worker.queue({ messages: queue.messages.map((body) => ({ body, ack })) }, workerEnv);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ received: 1, queued: 1, failed: 0 });
    expect(ack).toHaveBeenCalledTimes(1);
    expect(db.tables.webhook_deliveries).toContainEqual(
      expect.objectContaining({
        external_event_id: 'mid_expired_token',
        status: 'failed',
        last_error: 'Error validating access token: Session has expired',
      }),
    );
  });
});
