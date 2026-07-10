import { describe, expect, it, vi } from 'vitest';
import worker, { type QueueBinding, type WorkerEnv, type WorkerWebhookJob } from '../../src/worker.js';
import { FakeD1Database } from '../support/fakeD1Database.js';

describe('Cloudflare Worker backend', () => {
  class FakeQueue implements QueueBinding<WorkerWebhookJob> {
    readonly messages: WorkerWebhookJob[] = [];
    readonly sent: Array<{ message: WorkerWebhookJob; options?: { delaySeconds?: number } }> = [];
    readonly send = vi.fn(async (message: WorkerWebhookJob, options?: { delaySeconds?: number }) => {
      this.messages.push(message);
      this.sent.push({ message, options });
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

  function zaloPayload(msgId = 'zalo_msg_1', text = 'Cho mình 1 Combo 99K') {
    return {
      event_name: 'user_send_text',
      app_id: 'zalo_app_local',
      sender: { id: 'zalo_user_1', name: 'Zalo Customer' },
      recipient: { id: 'oa_local' },
      message: { msg_id: msgId, text },
      timestamp: 1783323124608,
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

  it('enqueues Messenger webhooks once and processes them from the queue when interruption is disabled', async () => {
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
      KFC_AGENT_INTERRUPTION_ENABLED: '0',
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
    expect(messengerFetch).not.toHaveBeenCalledWith(expect.stringContaining('/conversations?'));

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

  it('records shadow interruption state and claims one run from the latest wakeup without changing legacy queueing', async () => {
    const queue = new FakeQueue();
    const db = new FakeD1Database();
    const workerEnv = env({
      DB: db,
      MESSENGER_WEBHOOK_QUEUE: queue,
      KFC_AGENT_INTERRUPTION_SHADOW: '1',
      KFC_AGENT_INTERRUPTION_ENABLED: '0',
    } as Partial<WorkerEnv>);

    const first = await worker.fetch(
      new Request('https://worker.local/webhooks/messenger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messengerPayload('mid_shadow_1')),
      }),
      workerEnv,
    );
    const second = await worker.fetch(
      new Request('https://worker.local/webhooks/messenger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messengerPayload('mid_shadow_2')),
      }),
      workerEnv,
    );

    expect(await first.json()).toMatchObject({ received: 1, queued: 1 });
    expect(await second.json()).toMatchObject({ received: 1, queued: 1 });
    expect(queue.messages.filter((message) => message.channel === 'messenger')).toHaveLength(2);
    const wakeups = queue.messages.filter((message) => message.channel === 'agent_run_wakeup');
    expect(wakeups).toHaveLength(2);
    expect(queue.sent.filter((entry) => entry.message.channel === 'agent_run_wakeup').map((entry) => entry.options)).toEqual([
      { delaySeconds: 2 },
      { delaySeconds: 2 },
    ]);
    expect(db.tables.pending_customer_turns).toHaveLength(2);
    expect(db.tables.session_agent_state).toEqual([
      expect.objectContaining({ session_id: 'messenger:psid_1', generation: 2 }),
    ]);

    const ack = vi.fn();
    await worker.queue({ messages: wakeups.map((body) => ({ body, ack })) }, workerEnv);

    expect(ack).toHaveBeenCalledTimes(2);
    expect(db.tables.agent_runs).toHaveLength(1);
    expect(db.tables.agent_runs[0]).toMatchObject({
      session_id: 'messenger:psid_1',
      generation: 2,
      status: 'scheduled',
    });
    expect(db.tables.agent_run_turns).toEqual([
      expect.objectContaining({ run_id: db.tables.agent_runs[0]?.id, turn_id: 'pending_mid_shadow_1', sequence: 0 }),
      expect.objectContaining({ run_id: db.tables.agent_runs[0]?.id, turn_id: 'pending_mid_shadow_2', sequence: 1 }),
    ]);
    expect(db.tables.dashboard_events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'agent_run_pending' }),
        expect.objectContaining({ type: 'agent_run_scheduled' }),
      ]),
    );
  });

  it('recovers due shadow interruption runs from the scheduled worker path', async () => {
    const queue = new FakeQueue();
    const db = new FakeD1Database();
    const workerEnv = env({
      DB: db,
      MESSENGER_WEBHOOK_QUEUE: queue,
      KFC_AGENT_INTERRUPTION_SHADOW: '1',
      KFC_AGENT_INTERRUPTION_ENABLED: '0',
    } as Partial<WorkerEnv>);

    const response = await worker.fetch(
      new Request('https://worker.local/webhooks/messenger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messengerPayload('mid_shadow_recovery')),
      }),
      workerEnv,
    );
    expect(await response.json()).toMatchObject({ received: 1, queued: 1 });

    db.tables.session_agent_state[0]!.debounce_deadline_at = '2026-07-10T00:00:00.000Z';

    await worker.scheduled({ scheduledTime: Date.parse('2026-07-10T00:00:05.000Z') }, workerEnv);

    expect(db.tables.agent_runs).toHaveLength(1);
    expect(db.tables.agent_runs[0]).toMatchObject({
      session_id: 'messenger:psid_1',
      generation: 1,
      status: 'scheduled',
    });
    expect(db.tables.dashboard_events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'agent_run_pending' }),
        expect.objectContaining({ type: 'agent_run_scheduled' }),
      ]),
    );
  });

  it('executes one coalesced Messenger run by default', async () => {
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
        return new Response(JSON.stringify({ message_id: `reply_${messengerFetch.mock.calls.length}` }), {
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
      DB: db,
      MESSENGER_WEBHOOK_QUEUE: queue,
      MESSENGER_FETCH: messengerFetch as typeof fetch,
    } as Partial<WorkerEnv>);

    await worker.fetch(
      new Request('https://worker.local/webhooks/messenger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messengerPayload('mid_enabled_1')),
      }),
      workerEnv,
    );
    await worker.fetch(
      new Request('https://worker.local/webhooks/messenger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messengerPayload('mid_enabled_2')),
      }),
      workerEnv,
    );

    const wakeups = queue.messages.filter((message) => message.channel === 'agent_run_wakeup');
    const ack = vi.fn();
    await worker.queue({ messages: wakeups.map((body) => ({ body, ack })) }, workerEnv);

    const textSends = messengerFetch.mock.calls
      .map((call) => JSON.parse(String(call[1]?.body ?? '{}')) as { message?: unknown; sender_action?: string })
      .filter((body) => body.message && !body.sender_action);

    expect(db.tables.agent_runs).toHaveLength(1);
    expect(db.tables.agent_runs[0]).toMatchObject({
      session_id: 'messenger:psid_1',
      generation: 2,
      status: 'completed',
      delivery_status: 'sent',
    });
    expect(db.tables.conversation_turns.filter((turn) => turn.role === 'user')).toHaveLength(2);
    expect(db.tables.conversation_turns.filter((turn) => turn.role === 'assistant')).toHaveLength(1);
    expect(db.tables.webhook_deliveries.map((delivery) => delivery.status)).toEqual(['processed', 'processed']);
    expect(textSends).toHaveLength(1);
  });

  it('surfaces pending Messenger interruption state to dashboard before wakeup processing', async () => {
    const queue = new FakeQueue();
    const db = new FakeD1Database();
    const workerEnv = env({
      DB: db,
      MESSENGER_WEBHOOK_QUEUE: queue,
    } as Partial<WorkerEnv>);

    const response = await worker.fetch(
      new Request('https://worker.local/webhooks/messenger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messengerPayload('mid_pending_dashboard')),
      }),
      workerEnv,
    );
    const sessions = await worker.fetch(new Request('https://worker.local/dashboard/sessions'), workerEnv);
    const events = await worker.fetch(
      new Request('https://worker.local/dashboard/events/messenger%3Apsid_1'),
      workerEnv,
    );

    expect(await response.json()).toMatchObject({ received: 1, queued: 1 });
    expect(await sessions.json()).toMatchObject({
      sessions: [
        expect.objectContaining({
          sessionId: 'messenger:psid_1',
          latestEventType: 'agent_run_pending',
        }),
      ],
    });
    expect(await events.json()).toMatchObject({
      events: [
        expect.objectContaining({
          type: 'agent_run_pending',
          payload: expect.objectContaining({
            generation: 1,
            pendingTurnCount: 1,
            externalMessageId: 'mid_pending_dashboard',
          }),
        }),
      ],
    });
    expect(db.tables.conversation_turns).toHaveLength(0);
  });

  it('coalesces a three-message Messenger burst into one latest-generation run', async () => {
    const queue = new FakeQueue();
    const db = new FakeD1Database();
    const messengerFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ message_id: 'reply_three_message_burst' }), {
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

    await worker.fetch(
      new Request('https://worker.local/webhooks/messenger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messengerPayload('mid_three_1')),
      }),
      workerEnv,
    );
    await worker.fetch(
      new Request('https://worker.local/webhooks/messenger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messengerPayload('mid_three_2')),
      }),
      workerEnv,
    );
    await worker.fetch(
      new Request('https://worker.local/webhooks/messenger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messengerPayload('mid_three_3')),
      }),
      workerEnv,
    );

    const wakeups = queue.messages.filter((message) => message.channel === 'agent_run_wakeup');
    await worker.queue({ messages: wakeups.map((body) => ({ body, ack: vi.fn() })) }, workerEnv);

    expect(db.tables.agent_runs).toHaveLength(1);
    expect(db.tables.agent_runs[0]).toMatchObject({
      generation: 3,
      status: 'completed',
      coalesced_input_text: '1. Cho mình 1 Combo 99K\n2. Cho mình 1 Combo 99K\n3. Cho mình 1 Combo 99K',
    });
    expect(db.tables.agent_run_turns).toHaveLength(3);
    expect(db.tables.conversation_turns.filter((turn) => turn.role === 'assistant')).toHaveLength(1);
  });

  it('does not advance interruption generation for duplicate Messenger webhook retries', async () => {
    const queue = new FakeQueue();
    const db = new FakeD1Database();
    const workerEnv = env({
      DB: db,
      MESSENGER_WEBHOOK_QUEUE: queue,
    });
    const payload = messengerPayload('mid_duplicate_default');

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

    expect(await first.json()).toMatchObject({ queued: 1, skippedDuplicates: 0 });
    expect(await second.json()).toMatchObject({ queued: 0, skippedDuplicates: 1 });
    expect(queue.messages.filter((message) => message.channel === 'agent_run_wakeup')).toHaveLength(1);
    expect(db.tables.pending_customer_turns).toHaveLength(1);
    expect(db.tables.session_agent_state).toEqual([
      expect.objectContaining({ session_id: 'messenger:psid_1', generation: 1 }),
    ]);
  });

  it('marks coalesced Messenger deliveries failed when outbound send fails', async () => {
    const queue = new FakeQueue();
    const db = new FakeD1Database();
    const messengerFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ error: { message: 'send unavailable' } }), {
          status: 500,
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

    await worker.fetch(
      new Request('https://worker.local/webhooks/messenger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messengerPayload('mid_delivery_fail_1')),
      }),
      workerEnv,
    );
    await worker.fetch(
      new Request('https://worker.local/webhooks/messenger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messengerPayload('mid_delivery_fail_2')),
      }),
      workerEnv,
    );

    const wakeups = queue.messages.filter((message) => message.channel === 'agent_run_wakeup');
    await worker.queue({ messages: wakeups.map((body) => ({ body, ack: vi.fn() })) }, workerEnv);

    expect(db.tables.agent_runs).toHaveLength(1);
    expect(db.tables.agent_runs[0]).toMatchObject({
      generation: 2,
      status: 'failed',
      delivery_status: 'failed',
    });
    expect(db.tables.webhook_deliveries.map((delivery) => delivery.status)).toEqual(['failed', 'failed']);
    expect(db.tables.conversation_turns.filter((turn) => turn.role === 'assistant')).toHaveLength(1);
  });

  it('suppresses delivery for a stale claimed Messenger run behind the interruption enabled flag', async () => {
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
        return new Response(JSON.stringify({ message_id: 'reply_should_not_send' }), {
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
      DB: db,
      MESSENGER_WEBHOOK_QUEUE: queue,
      MESSENGER_FETCH: messengerFetch as typeof fetch,
    } as Partial<WorkerEnv>);

    await worker.fetch(
      new Request('https://worker.local/webhooks/messenger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messengerPayload('mid_stale_run_1')),
      }),
      workerEnv,
    );

    const firstWakeup = queue.messages.find((message) => message.channel === 'agent_run_wakeup');
    expect(firstWakeup).toBeDefined();
    db.tables.agent_runs.length = 0;
    await worker.queue({ messages: [{ body: firstWakeup!, ack: vi.fn() }] }, env({
      DB: db,
      MESSENGER_WEBHOOK_QUEUE: queue,
      MESSENGER_FETCH: messengerFetch as typeof fetch,
      KFC_AGENT_INTERRUPTION_SHADOW: '1',
      KFC_AGENT_INTERRUPTION_ENABLED: '0',
    } as Partial<WorkerEnv>));
    expect(db.tables.agent_runs).toHaveLength(1);
    expect(db.tables.agent_runs[0]).toMatchObject({ status: 'scheduled', generation: 1 });

    await worker.fetch(
      new Request('https://worker.local/webhooks/messenger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messengerPayload('mid_stale_run_2')),
      }),
      workerEnv,
    );

    const textSends = messengerFetch.mock.calls
      .map((call) => JSON.parse(String(call[1]?.body ?? '{}')) as { message?: unknown; sender_action?: string })
      .filter((body) => body.message && !body.sender_action);

    expect(db.tables.agent_runs[0]).toMatchObject({
      status: 'superseded',
      delivery_status: 'suppressed',
    });
    expect(db.tables.conversation_turns.filter((turn) => turn.role === 'assistant')).toHaveLength(0);
    expect(textSends).toHaveLength(0);
  });

  it('executes one coalesced Zalo run by default', async () => {
    const queue = new FakeQueue();
    const db = new FakeD1Database();
    const zaloFetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: 0, message_id: `zalo_reply_${zaloFetch.mock.calls.length}` }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const workerEnv = env({
      DB: db,
      MESSENGER_WEBHOOK_QUEUE: queue,
      ZALO_FETCH: zaloFetch as typeof fetch,
    });

    const first = await worker.fetch(
      new Request('https://worker.local/webhooks/zalo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(zaloPayload('zalo_enabled_1', 'Cho mình 1 Combo 99K')),
      }),
      workerEnv,
    );
    const second = await worker.fetch(
      new Request('https://worker.local/webhooks/zalo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(zaloPayload('zalo_enabled_2', 'Đổi thành 2 Combo 99K')),
      }),
      workerEnv,
    );

    const wakeups = queue.messages.filter((message) => message.channel === 'agent_run_wakeup');
    const ack = vi.fn();
    await worker.queue({ messages: wakeups.map((body) => ({ body, ack })) }, workerEnv);

    expect(await first.json()).toMatchObject({ received: 1, queued: 1 });
    expect(await second.json()).toMatchObject({ received: 1, queued: 1 });
    expect(db.tables.agent_runs).toHaveLength(1);
    expect(db.tables.agent_runs[0]).toMatchObject({
      session_id: 'zalo:zalo_user_1',
      channel: 'zalo',
      generation: 2,
      status: 'completed',
      delivery_status: 'sent',
    });
    expect(db.tables.conversation_turns.filter((turn) => turn.role === 'user')).toHaveLength(2);
    expect(db.tables.conversation_turns.filter((turn) => turn.role === 'assistant')).toHaveLength(1);
    expect(db.tables.webhook_deliveries.map((delivery) => delivery.status)).toEqual(['processed', 'processed']);
    expect(zaloFetch).toHaveBeenCalledTimes(1);
  });

  it('keeps unsupported Zalo events on the legacy acknowledgement path by default', async () => {
    const queue = new FakeQueue();
    const db = new FakeD1Database();
    const zaloFetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: 0, message_id: 'zalo_ack_follow_default' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const workerEnv = env({
      DB: db,
      MESSENGER_WEBHOOK_QUEUE: queue,
      ZALO_FETCH: zaloFetch as typeof fetch,
    });

    const response = await worker.fetch(
      new Request('https://worker.local/webhooks/zalo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_name: 'follow',
          sender: { id: 'zalo_user_1', name: 'Zalo Customer' },
          recipient: { id: 'oa_local' },
          timestamp: 1783323124608,
        }),
      }),
      workerEnv,
    );

    await worker.queue({ messages: queue.messages.map((body) => ({ body, ack: vi.fn() })) }, workerEnv);

    expect(await response.json()).toMatchObject({ received: 1, queued: 1 });
    expect(db.tables.agent_runs).toHaveLength(0);
    expect(db.tables.pending_customer_turns).toHaveLength(0);
    expect(db.tables.conversation_turns).toEqual([
      expect.objectContaining({ role: 'user', text: '[Zalo follow]' }),
      expect.objectContaining({ role: 'assistant', delivery_status: 'sent' }),
    ]);
    expect(zaloFetch).toHaveBeenCalledTimes(1);
  });

  it('does not create duplicate Zalo runs for duplicate webhook retries', async () => {
    const queue = new FakeQueue();
    const db = new FakeD1Database();
    const workerEnv = env({
      DB: db,
      MESSENGER_WEBHOOK_QUEUE: queue,
    });
    const payload = zaloPayload('zalo_duplicate_default', 'Cho mình 1 Combo 99K');

    const first = await worker.fetch(
      new Request('https://worker.local/webhooks/zalo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
      workerEnv,
    );
    const second = await worker.fetch(
      new Request('https://worker.local/webhooks/zalo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
      workerEnv,
    );

    expect(await first.json()).toMatchObject({ queued: 1, skippedDuplicates: 0 });
    expect(await second.json()).toMatchObject({ queued: 0, skippedDuplicates: 1 });
    expect(queue.messages.filter((message) => message.channel === 'agent_run_wakeup')).toHaveLength(1);
    expect(db.tables.pending_customer_turns).toHaveLength(1);
    expect(db.tables.session_agent_state).toEqual([
      expect.objectContaining({ session_id: 'zalo:zalo_user_1', generation: 1 }),
    ]);
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
      KFC_AGENT_INTERRUPTION_ENABLED: '0',
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
