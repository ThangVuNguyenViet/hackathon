import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import worker, { type QueueBinding, type WorkerEnv, type WorkerWebhookJob } from '../../src/worker.js';
import { FakeD1Database } from '../support/fakeD1Database.js';

const liveRequested = process.env.RUN_LIVE_AI_INTERRUPTION === '1';
const openAiApiKey = process.env.OPENAI_API_KEY?.trim();
const openAiToolPlannerModel = process.env.OPENAI_TOOL_PLANNER_MODEL?.trim() || process.env.OPENAI_MODEL?.trim() || 'gpt-4.1-mini';
const openAiResponseModel = process.env.OPENAI_RESPONSE_MODEL?.trim() || 'gpt-4.1-nano';

class FakeQueue implements QueueBinding<WorkerWebhookJob> {
  readonly messages: WorkerWebhookJob[] = [];
  readonly sent: Array<{ message: WorkerWebhookJob; options?: { delaySeconds?: number } }> = [];

  async send(message: WorkerWebhookJob, options?: { delaySeconds?: number }) {
    this.messages.push(message);
    this.sent.push({ message, options });
  }
}

function env(overrides: Partial<WorkerEnv> = {}): WorkerEnv {
  return {
    DB: new FakeD1Database(),
    MESSENGER_VERIFY_TOKEN: 'local_verify',
    META_PAGE_ID: '118976205445198',
    META_APP_SECRET: 'meta_app_secret_local',
    META_PAGE_ACCESS_TOKEN: 'page_token_local',
    META_INBOX_URL_TEMPLATE: 'https://business.facebook.com/latest/inbox/all?asset_id={pageId}&selected_item_id={externalUserId}',
    ZALO_OA_ID: 'oa_local',
    ZALO_ACCESS_TOKEN: 'zalo_token_local',
    ZALO_INBOX_URL_TEMPLATE: 'https://oa.zalo.me/chatv2?oaid={pageId}&uid={externalUserId}',
    KFC_DEMO_ADMIN_TOKEN: 'demo_admin_local',
    KFC_COMMERCE_MODE: 'fixture',
    OPENAI_API_KEY: openAiApiKey ?? '',
    OPENAI_TOOL_PLANNER_MODEL: openAiToolPlannerModel,
    OPENAI_RESPONSE_MODEL: openAiResponseModel,
    ...overrides,
  };
}

function messengerPayload(mid: string, text: string) {
  return {
    object: 'page',
    entry: [
      {
        id: '118976205445198',
        messaging: [
          {
            sender: { id: 'psid_live_interruption' },
            recipient: { id: '118976205445198' },
            timestamp: 1783323124608,
            message: { mid, text },
          },
        ],
      },
    ],
  };
}

async function postMessengerWebhook(workerEnv: WorkerEnv, mid: string, text: string) {
  const body = JSON.stringify(messengerPayload(mid, text));
  const signature = createHmac('sha256', 'meta_app_secret_local').update(body).digest('hex');
  return worker.fetch(
    new Request('https://worker.local/webhooks/messenger', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': `sha256=${signature}`,
      },
      body,
    }),
    workerEnv,
  );
}

if (liveRequested && !openAiApiKey) {
  describe('live OpenAI Worker interruption proof', () => {
    it('requires OPENAI_API_KEY when RUN_LIVE_AI_INTERRUPTION=1', () => {
      throw new Error('Set OPENAI_API_KEY before running RUN_LIVE_AI_INTERRUPTION=1 vitest');
    });
  });
} else {
  const describeLive = liveRequested ? describe : describe.skip;

  describeLive('live OpenAI Worker interruption proof', () => {
    it(
      'coalesces a rapid Messenger burst into one real AI run and one delivered assistant reply',
      async () => {
        const queue = new FakeQueue();
        const db = new FakeD1Database();
        const realFetch = globalThis.fetch.bind(globalThis);
        const openAiResponsesCalls: string[] = [];
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
          const url = String(input);
          if (url.includes('/responses')) {
            openAiResponsesCalls.push(url);
          }
          return realFetch(input, init);
        });
        const messengerTextSends: string[] = [];
        const messengerFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
          if (init?.method === 'POST') {
            const body = JSON.parse(String(init.body ?? '{}')) as { message?: { text?: string }; sender_action?: string };
            if (body.message?.text) {
              messengerTextSends.push(body.message.text);
            }
            return new Response(JSON.stringify({ message_id: `live_reply_${messengerTextSends.length}` }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          return new Response(JSON.stringify({ first_name: 'Live', last_name: 'Customer' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        });
        const workerEnv = env({
          DB: db,
          MESSENGER_WEBHOOK_QUEUE: queue,
          MESSENGER_FETCH: messengerFetch as typeof fetch,
        });

        try {
          const first = await postMessengerWebhook(workerEnv, 'mid_live_ai_1', 'Cho mình 1 Combo 99K');
          const second = await postMessengerWebhook(workerEnv, 'mid_live_ai_2', 'Đổi thành 2 Combo 99K');
          const third = await postMessengerWebhook(workerEnv, 'mid_live_ai_3', 'Thêm 1 Pepsi lon nữa');

          expect(await first.json()).toMatchObject({ received: 1, queued: 1, skippedDuplicates: 0 });
          expect(await second.json()).toMatchObject({ received: 1, queued: 1, skippedDuplicates: 0 });
          expect(await third.json()).toMatchObject({ received: 1, queued: 1, skippedDuplicates: 0 });

          const adminHeaders = { Authorization: 'Bearer demo_admin_local' };
          const pendingSessions = await worker.fetch(new Request('https://worker.local/dashboard/sessions', {
            headers: adminHeaders,
          }), workerEnv);
          const pendingEvents = await worker.fetch(
            new Request('https://worker.local/dashboard/events/messenger%3Apsid_live_interruption', {
              headers: adminHeaders,
            }),
            workerEnv,
          );
          expect(await pendingSessions.json()).toMatchObject({
            sessions: [
              expect.objectContaining({
                sessionId: 'messenger:psid_live_interruption',
                latestEventType: 'agent_run_pending',
              }),
            ],
          });
          expect(await pendingEvents.json()).toMatchObject({
            events: expect.arrayContaining([
              expect.objectContaining({
                type: 'agent_run_pending',
                payload: expect.objectContaining({
                  generation: 3,
                  pendingTurnCount: 3,
                }),
              }),
            ]),
          });

          const ack = vi.fn();
          const queuedMessages = queue.messages.map((body) => ({ body, ack }));
          await worker.queue({ messages: queuedMessages }, workerEnv);
          const deliveredSessions = await worker.fetch(new Request('https://worker.local/dashboard/sessions', {
            headers: adminHeaders,
          }), workerEnv);
          const deliveredEvents = await worker.fetch(
            new Request('https://worker.local/dashboard/events/messenger%3Apsid_live_interruption', {
              headers: adminHeaders,
            }),
            workerEnv,
          );
          const deliveredTurns = await worker.fetch(
            new Request('https://worker.local/dashboard/sessions/messenger%3Apsid_live_interruption/turns', {
              headers: adminHeaders,
            }),
            workerEnv,
          );

          expect(ack).toHaveBeenCalledTimes(queue.messages.length);
          expect(db.tables.agent_runs).toHaveLength(1);
          expect(db.tables.agent_runs[0]).toMatchObject({
            session_id: 'messenger:psid_live_interruption',
            generation: 3,
            status: 'completed',
            delivery_status: 'sent',
            coalesced_input_text:
              '1. Cho mình 1 Combo 99K\n2. Đổi thành 2 Combo 99K\n3. Thêm 1 Pepsi lon nữa',
          });
          expect(db.tables.agent_run_turns).toHaveLength(3);
          expect(db.tables.conversation_turns.filter((turn) => turn.role === 'user')).toHaveLength(3);
          expect(db.tables.conversation_turns.filter((turn) => turn.role === 'assistant')).toHaveLength(1);
          expect(db.tables.webhook_deliveries.map((delivery) => delivery.status)).toEqual([
            'processed',
            'processed',
            'processed',
          ]);
          expect(messengerTextSends).toHaveLength(1);
          expect(messengerTextSends[0]?.trim().length).toBeGreaterThan(0);
          expect(openAiResponsesCalls.length).toBeGreaterThanOrEqual(2);
          expect(await deliveredSessions.json()).toMatchObject({
            sessions: [
              expect.objectContaining({
                sessionId: 'messenger:psid_live_interruption',
                latestEventType: 'agent_run_delivered',
              }),
            ],
          });
          expect(await deliveredEvents.json()).toMatchObject({
            events: expect.arrayContaining([
              expect.objectContaining({ type: 'agent_run_scheduled' }),
              expect.objectContaining({ type: 'agent_run_started' }),
              expect.objectContaining({
                type: 'agent_run_delivered',
                payload: expect.objectContaining({
                  generation: 3,
                  includedTurnCount: 3,
                  deliveryStatus: 'sent',
                }),
              }),
            ]),
          });
          expect(await deliveredTurns.json()).toMatchObject({
            turns: [
              expect.objectContaining({ role: 'user', text: 'Cho mình 1 Combo 99K' }),
              expect.objectContaining({ role: 'user', text: 'Đổi thành 2 Combo 99K' }),
              expect.objectContaining({ role: 'user', text: 'Thêm 1 Pepsi lon nữa' }),
              expect.objectContaining({ role: 'assistant' }),
            ],
          });
        } finally {
          fetchSpy.mockRestore();
        }
      },
      300_000,
    );
  });
}
