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
      KFC_DEMO_ADMIN_TOKEN: 'demo_admin_local',
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

  class ThrowOnDashboardEventScanD1Database extends FakeD1Database {
    override prepare(query: string) {
      if (query.includes('FROM dashboard_events') && !query.includes('WHERE session_id = ?')) {
        throw new Error('dashboard event scan should not run for fast Worker endpoints');
      }
      return super.prepare(query);
    }
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

  it('serves Worker readiness without loading dashboard route dependencies', async () => {
    const workerEnv = env({
      MESSENGER_FETCH: vi.fn(async () => {
        throw new Error('Messenger fetch should not run for shallow readiness');
      }) as typeof fetch,
    });

    const ready = await worker.fetch(new Request('https://worker.local/ready'), workerEnv);

    expect(ready.status).toBe(200);
    expect(await ready.json()).toMatchObject({
      ok: true,
      checks: {
        database: { ok: true },
        messenger: { ok: true, configured: true, required: true },
        zalo: { ok: true, configured: true, required: false },
        openai: { ok: true, configured: false, required: false },
      },
    });
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

  it('serves Worker readiness as JSON without loading dashboard event history', async () => {
    const workerEnv = env({ DB: new ThrowOnDashboardEventScanD1Database() });

    const response = await worker.fetch(new Request('https://worker.local/ready'), workerEnv);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toMatchObject({
      ok: true,
      checks: {
        database: { ok: true },
        fixtures: { ok: true },
        messenger: { ok: true, configured: true, required: true },
      },
    });
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
      new Request('https://worker.local/dashboard/sessions/messenger%3Apsid_1/turns?sync=1'),
      workerEnv,
    );
    expect(messengerFetch).toHaveBeenCalledWith(expect.stringContaining('/conversations?'));

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
      turns: expect.arrayContaining([
        expect.objectContaining({ role: 'user' }),
        expect.objectContaining({ role: 'assistant' }),
      ]),
    });
    expect(
      messengerFetch.mock.calls
        .map((call) => JSON.parse(String(call[1]?.body ?? '{}')) as { sender_action?: string })
        .filter((body) => body.sender_action)
        .map((body) => body.sender_action),
    ).toEqual(['mark_seen', 'typing_on', 'typing_off']);
    expect(stream.status).toBe(501);
  });

  it('recovers stale queued Messenger deliveries when the queue consumer did not run', async () => {
    const queue = new FakeQueue();
    const db = new FakeD1Database();
    const messengerFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body ?? '{}')) as { sender_action?: string };
        if (body.sender_action) {
          return new Response(JSON.stringify({ recipient_id: 'psid_1' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ message_id: 'reply_recovered' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ first_name: 'Recovered', last_name: 'Customer' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const workerEnv = env({
      DB: db,
      MESSENGER_WEBHOOK_QUEUE: queue,
      MESSENGER_FETCH: messengerFetch as typeof fetch,
    });

    const webhook = await worker.fetch(
      new Request('https://worker.local/webhooks/messenger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messengerPayload('mid_stale_1')),
      }),
      workerEnv,
    );
    const turnsBeforeRecovery = await worker.fetch(
      new Request('https://worker.local/dashboard/sessions/messenger%3Apsid_1/turns'),
      workerEnv,
    );

    const recovery = await worker.fetch(
      new Request('https://worker.local/admin/messenger/recover-stale-deliveries?olderThanMs=0&limit=5', {
        method: 'POST',
        headers: { 'X-KFC-Demo-Admin-Token': 'demo_admin_local' },
      }),
      workerEnv,
    );
    const recoveryAgain = await worker.fetch(
      new Request('https://worker.local/admin/messenger/recover-stale-deliveries?olderThanMs=0&limit=5', {
        method: 'POST',
        headers: { 'X-KFC-Demo-Admin-Token': 'demo_admin_local' },
      }),
      workerEnv,
    );
    const turnsAfterRecovery = await worker.fetch(
      new Request('https://worker.local/dashboard/sessions/messenger%3Apsid_1/turns'),
      workerEnv,
    );

    expect(webhook.status).toBe(200);
    expect(await webhook.json()).toMatchObject({ received: 1, queued: 1, skippedDuplicates: 0, failed: 0 });
    expect(await turnsBeforeRecovery.json()).toMatchObject({ turns: [] });
    expect(recovery.status).toBe(200);
    expect(await recovery.json()).toMatchObject({ scanned: 1, processed: 1, failed: 0, skipped: 0 });
    expect(await recoveryAgain.json()).toMatchObject({ scanned: 0, processed: 0, failed: 0, skipped: 0 });
    expect(await turnsAfterRecovery.json()).toMatchObject({
      turns: expect.arrayContaining([
        expect.objectContaining({ role: 'user', externalMessageId: 'mid_stale_1' }),
        expect.objectContaining({ role: 'assistant', deliveryStatus: 'sent', externalMessageId: 'reply_recovered' }),
      ]),
    });
    expect(db.tables.webhook_deliveries).toContainEqual(
      expect.objectContaining({
        external_event_id: 'mid_stale_1',
        status: 'processed',
      }),
    );
  });

  it('recovers stale queued Messenger deliveries from the scheduled Worker path', async () => {
    const queue = new FakeQueue();
    const db = new FakeD1Database();
    const messengerFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body ?? '{}')) as { sender_action?: string };
        if (body.sender_action) {
          return new Response(JSON.stringify({ recipient_id: 'psid_1' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ message_id: 'reply_scheduled_recovery' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ first_name: 'Scheduled', last_name: 'Customer' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const workerEnv = env({
      DB: db,
      MESSENGER_WEBHOOK_QUEUE: queue,
      MESSENGER_FETCH: messengerFetch as typeof fetch,
    });

    await worker.fetch(
      new Request('https://worker.local/webhooks/messenger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messengerPayload('mid_scheduled_stale_1')),
      }),
      workerEnv,
    );

    await (worker as typeof worker & { scheduled(controller: unknown, env: WorkerEnv): Promise<void> }).scheduled({}, workerEnv);

    expect(db.tables.webhook_deliveries).toContainEqual(
      expect.objectContaining({
        external_event_id: 'mid_scheduled_stale_1',
        status: 'processed',
      }),
    );
    expect(db.tables.conversation_turns).toContainEqual(
      expect.objectContaining({
        role: 'assistant',
        external_message_id: 'reply_scheduled_recovery',
      }),
    );
  });

  it('exposes session control and resumes a paused Worker session without loading the full agent runtime', async () => {
    const workerEnv = env({ DB: new ThrowOnDashboardEventScanD1Database() });

    const join = await worker.fetch(
      new Request('https://worker.local/dashboard/sessions/messenger%3Apsid_1/human-join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: 'agent_1' }),
      }),
      workerEnv,
    );
    const paused = await worker.fetch(
      new Request('https://worker.local/dashboard/sessions/messenger%3Apsid_1/control'),
      workerEnv,
    );
    const resume = await worker.fetch(
      new Request('https://worker.local/dashboard/sessions/messenger%3Apsid_1/resume-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: 'agent_1' }),
      }),
      workerEnv,
    );
    const active = await worker.fetch(
      new Request('https://worker.local/dashboard/sessions/messenger%3Apsid_1/control'),
      workerEnv,
    );

    expect(join.status).toBe(200);
    expect(paused.status).toBe(200);
    expect(await paused.json()).toMatchObject({ sessionId: 'messenger:psid_1', agentMode: 'human_paused' });
    expect(resume.status).toBe(200);
    expect(await resume.json()).toMatchObject({ sessionId: 'messenger:psid_1', agentMode: 'ai_active', assignedAgentId: null });
    expect(active.status).toBe(200);
    expect(await active.json()).toMatchObject({ sessionId: 'messenger:psid_1', agentMode: 'ai_active' });
  });

  it('resets a single demo session behind the Worker admin token', async () => {
    const db = new FakeD1Database();
    const workerEnv = env({ DB: db });

    const pause = await worker.fetch(
      new Request('https://worker.local/dashboard/sessions/messenger%3Apsid_1/human-join', {
        method: 'POST',
        body: JSON.stringify({ agentId: 'agent_1' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      workerEnv,
    );
    await db
      .prepare(
        `INSERT INTO conversation_turns (
          id, session_id, channel, role, text, external_message_id, external_user_id, delivery_status, metadata, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        'turn_reset_1',
        'messenger:psid_1',
        'messenger',
        'user',
        'Cho mình 1 Combo 99K',
        'mid_reset_1',
        'psid_1',
        'delivered',
        null,
        '2026-07-07T00:00:00.000Z',
      )
      .run();
    await db
      .prepare(
        `INSERT INTO webhook_deliveries (
          channel, external_event_id, external_thread_id, external_user_id, session_id, status, payload, received_at, processed_at, failed_at, last_error, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        'messenger',
        'mid_reset_1',
        'psid_1',
        'psid_1',
        'messenger:psid_1',
        'processed',
        '{}',
        '2026-07-07T00:00:00.000Z',
        '2026-07-07T00:00:00.000Z',
        null,
        null,
        '2026-07-07T00:00:00.000Z',
        '2026-07-07T00:00:00.000Z',
      )
      .run();
    const unauthorized = await worker.fetch(
      new Request('https://worker.local/dashboard/sessions/messenger%3Apsid_1/demo-reset', {
        method: 'POST',
        headers: { Authorization: 'Bearer wrong' },
      }),
      workerEnv,
    );
    const reset = await worker.fetch(
      new Request('https://worker.local/dashboard/sessions/messenger%3Apsid_1/demo-reset', {
        method: 'POST',
        headers: { Authorization: 'Bearer demo_admin_local' },
      }),
      workerEnv,
    );
    const turns = await worker.fetch(new Request('https://worker.local/dashboard/sessions/messenger%3Apsid_1/turns'), workerEnv);
    const control = await worker.fetch(new Request('https://worker.local/dashboard/sessions/messenger%3Apsid_1/control'), workerEnv);

    expect(pause.status).toBe(200);
    expect(unauthorized.status).toBe(401);
    expect(reset.status).toBe(200);
    expect(await reset.json()).toMatchObject({ sessionId: 'messenger:psid_1', agentMode: 'ai_active' });
    expect(await turns.json()).toMatchObject({ turns: [] });
    expect(await control.json()).toMatchObject({ sessionId: 'messenger:psid_1', agentMode: 'ai_active', assignedAgentId: null });
    expect(db.tables.webhook_deliveries).toHaveLength(1);
  });

  it('serves dashboard turns as JSON without loading the full agent runtime', async () => {
    const db = new ThrowOnDashboardEventScanD1Database();
    const workerEnv = env({ DB: db });
    const ready = await worker.fetch(new Request('https://worker.local/ready'), workerEnv);
    expect(ready.status).toBe(200);
    await db
      .prepare(
        `INSERT INTO conversation_turns (
          id, session_id, channel, role, text, external_message_id, external_user_id, delivery_status, metadata, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        'turn_fast_1',
        'messenger:psid_1',
        'messenger',
        'user',
        'Cho mình 1 Combo 99K',
        'mid_fast_turns',
        'psid_1',
        'received',
        null,
        '2026-07-09T00:00:00.000Z',
      )
      .run();

    const response = await worker.fetch(
      new Request('https://worker.local/dashboard/sessions/messenger%3Apsid_1/turns'),
      workerEnv,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toMatchObject({
      turns: [expect.objectContaining({ role: 'user', text: 'Cho mình 1 Combo 99K' })],
    });
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

  it('serves dashboard sessions from bounded D1 summaries with profile deeplinks', async () => {
    const db = new FakeD1Database();
    const workerEnv = env({
      DB: db,
      MESSENGER_FETCH: vi.fn(async () =>
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    });
    const storeReady = await worker.fetch(new Request('https://worker.local/ready'), workerEnv);
    expect(storeReady.status).toBe(200);

    await db
      .prepare(
        `INSERT OR IGNORE INTO dashboard_events (id, session_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .bind('dash_1', 'zalo:zalo_user_1', 'customer_message_received', '{}', new Date().toISOString())
      .run();
    await db
      .prepare(
        `INSERT OR IGNORE INTO dashboard_events (id, session_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .bind('dash_2', 'zalo:zalo_user_1', 'assistant_reply_sent', '{}', new Date().toISOString())
      .run();
    await db
      .prepare(
        `INSERT INTO conversation_profiles (channel, external_user_id, display_name, avatar_url, profile_source, profile_updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(channel, external_user_id) DO UPDATE SET
           display_name = excluded.display_name,
           avatar_url = excluded.avatar_url,
           profile_source = excluded.profile_source,
           profile_updated_at = excluded.profile_updated_at`,
      )
      .bind('zalo', 'zalo_user_1', 'Tran Binh', 'https://zalo.local/b.jpg', 'zalo_webhook', '2026-07-09T00:00:01.000Z')
      .run();

    const response = await worker.fetch(new Request('https://worker.local/dashboard/sessions'), workerEnv);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      sessions: [
        {
          sessionId: 'zalo:zalo_user_1',
          latestEventType: 'assistant_reply_sent',
          externalUserId: 'zalo_user_1',
          displayName: 'Tran Binh',
          avatarUrl: 'https://zalo.local/b.jpg',
          deeplink: {
            status: 'available',
            url: 'https://oa.zalo.me/chatv2?oaid=oa_local&uid=zalo_user_1',
          },
        },
      ],
    });
  });

  it('serves Worker dashboard sessions without blocking on Messenger history sync', async () => {
    const db = new FakeD1Database();
    const messengerFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/conversations?')) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 'conv_1',
                participants: { data: [{ id: '118976205445198' }, { id: 'psid_history' }] },
                messages: {
                  data: [
                    {
                      id: 'mid_history',
                      message: 'Cho mình xem lại đơn cũ',
                      from: { id: 'psid_history' },
                      to: { data: [{ id: '118976205445198' }] },
                      created_time: new Date().toISOString(),
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const workerEnv = env({ DB: db, MESSENGER_FETCH: messengerFetch });

    const response = await worker.fetch(new Request('https://worker.local/dashboard/sessions'), workerEnv);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ sessions: [] });
    expect(messengerFetch).not.toHaveBeenCalled();
  });

  it('supports dashboard human takeover controls through Worker fetch', async () => {
    const db = new FakeD1Database();
    const workerEnv = env({
      DB: db,
      MESSENGER_FETCH: vi.fn(async () =>
        new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    });
    await worker.fetch(new Request('https://worker.local/ready'), workerEnv);

    const join = await worker.fetch(
      new Request('https://worker.local/dashboard/sessions/messenger%3Apsid_1/human-join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: 'monitor_agent_local' }),
      }),
      workerEnv,
    );
    const events = await worker.fetch(new Request('https://worker.local/dashboard/events/messenger%3Apsid_1'), workerEnv);
    const sessions = await worker.fetch(new Request('https://worker.local/dashboard/sessions'), workerEnv);

    expect(join.status).toBe(200);
    expect(await join.json()).toMatchObject({
      sessionId: 'messenger:psid_1',
      agentMode: 'human_paused',
      assignedAgentId: 'monitor_agent_local',
    });
    expect((await events.json()).events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'session_updated',
          payload: expect.objectContaining({
            updateType: 'human_joined',
            agentMode: 'human_paused',
            agentId: 'monitor_agent_local',
          }),
        }),
      ]),
    );
    expect(await sessions.json()).toMatchObject({
      sessions: [
        expect.objectContaining({
          sessionId: 'messenger:psid_1',
          latestEventType: 'session_updated',
          agentMode: 'human_paused',
          assignedAgentId: 'monitor_agent_local',
        }),
      ],
    });
  });

  it('resumes AI for the latest unanswered paused Messenger turn through Worker fetch', async () => {
    const db = new FakeD1Database();
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
        return new Response(JSON.stringify({ message_id: 'reply_after_resume' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ first_name: 'Demo', last_name: 'Customer' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const workerEnv = env({
      DB: db,
      MESSENGER_WEBHOOK_QUEUE: queue,
      MESSENGER_FETCH: messengerFetch as typeof fetch,
    });
    await worker.fetch(new Request('https://worker.local/ready'), workerEnv);

    await worker.fetch(
      new Request('https://worker.local/dashboard/sessions/messenger%3Apsid_1/human-join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: 'monitor_agent_local' }),
      }),
      workerEnv,
    );
    const inbound = await worker.fetch(
      new Request('https://worker.local/webhooks/messenger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messengerPayload('mid_paused_worker')),
      }),
      workerEnv,
    );
    const ack = vi.fn();
    await worker.queue({ messages: queue.messages.map((body) => ({ body, ack })) }, workerEnv);

    const beforeResume = await worker.fetch(
      new Request('https://worker.local/dashboard/sessions/messenger%3Apsid_1/turns'),
      workerEnv,
    );
    const resume = await worker.fetch(
      new Request('https://worker.local/dashboard/sessions/messenger%3Apsid_1/resume-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: 'monitor_agent_local' }),
      }),
      workerEnv,
    );
    const afterResume = await worker.fetch(
      new Request('https://worker.local/dashboard/sessions/messenger%3Apsid_1/turns'),
      workerEnv,
    );

    expect(inbound.status).toBe(200);
    expect(await inbound.json()).toMatchObject({ received: 1, queued: 1, skippedDuplicates: 0, failed: 0 });
    expect(await beforeResume.json()).toMatchObject({
      turns: [expect.objectContaining({ role: 'user', externalMessageId: 'mid_paused_worker' })],
    });
    expect(resume.status).toBe(200);
    expect(await resume.json()).toMatchObject({ agentMode: 'ai_active', recoveredUnanswered: true });
    expect(await afterResume.json()).toMatchObject({
      turns: [
        expect.objectContaining({ role: 'user', externalMessageId: 'mid_paused_worker' }),
        expect.objectContaining({ role: 'assistant', deliveryStatus: 'sent', externalMessageId: 'reply_after_resume' }),
      ],
    });
  });

  it('serves bounded Worker dashboard turns newest-last', async () => {
    const db = new FakeD1Database();
    const workerEnv = env({ DB: db });
    await worker.fetch(new Request('https://worker.local/ready'), workerEnv);

    for (let index = 0; index < 14; index += 1) {
      await db
        .prepare(
          `INSERT INTO conversation_turns (
            id, session_id, channel, role, text, external_message_id, external_user_id, delivery_status, metadata, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          `turn_${index}`,
          'messenger:psid_many',
          'messenger',
          index % 2 === 0 ? 'user' : 'assistant',
          `Turn ${index}`,
          `mid_${index}`,
          'psid_many',
          'received',
          null,
          `2026-07-09T00:00:${String(index).padStart(2, '0')}.000Z`,
        )
        .run();
    }

    const response = await worker.fetch(
      new Request('https://worker.local/dashboard/sessions/messenger%3Apsid_many/turns'),
      workerEnv,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { turns: Array<{ text: string }> };
    expect(body.turns.map((turn) => turn.text)).toEqual([
      'Turn 4',
      'Turn 5',
      'Turn 6',
      'Turn 7',
      'Turn 8',
      'Turn 9',
      'Turn 10',
      'Turn 11',
      'Turn 12',
      'Turn 13',
    ]);
  });
});
