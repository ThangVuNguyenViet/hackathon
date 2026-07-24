import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { D1Store } from '../../src/persistence/d1Store.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import type { ConversationStore } from '../../src/persistence/contracts.js';
import type { WorkerEnv, WorkerWebhookJob } from '../../src/worker.js';
import { enqueueMessengerWebhook } from '../../src/workerMessaging.js';
import { workerQueuePayloadByteLength } from '../../src/workerQueueEnvelope.js';
import { SqliteD1Database } from '../support/sqlite-d1.js';

const pageId = 'page-123';
const appSecret = 'meta-app-secret';

describe('Messenger queue ingress', () => {
  it('accepts a large signed HTTP body with a small relevant event and queues a compact job', async () => {
    const body = JSON.stringify({
      object: 'page',
      padding: 'x'.repeat(900_000),
      entry: [
        {
          id: pageId,
          time: Date.now(),
          messaging: [
            {
              sender: { id: 'customer-123' },
              recipient: { id: pageId },
              timestamp: Date.now(),
              message: { mid: 'message-456', text: 'Cho tôi một phần gà' },
            },
          ],
        },
      ],
    });
    const { database, store, sent, env } = await testHarness();
    try {
      const response = await enqueueMessengerWebhook(
        signedRequest(body),
        env,
        store,
      );

      expect(response).toMatchObject({
        status: 200,
        body: { received: 1, queued: 1, failed: 0 },
      });
      expect(sent).toHaveLength(1);
      expect(workerQueuePayloadByteLength(sent[0])).toBeLessThan(4_096);
      expect(JSON.stringify(sent[0])).not.toContain('padding');
      expectDeeplyAbsent(sent[0], [
        'rawBodyBytes',
        'signature',
        'signatureHeader',
        'rawEvent',
        'payload',
      ]);
      const delivery = await store.getWebhookDelivery(
        'messenger',
        'message-456',
      );
      expect(delivery?.payload).toEqual({
        eventType: 'message',
        text: 'Cho tôi một phần gà',
        receivedAt: delivery?.receivedAt,
      });
    } finally {
      database.close();
    }
  });

  it('queues paused control work as identifiers and a compact claim', async () => {
    const timestamp = Date.now();
    const body = JSON.stringify({
      object: 'page',
      entry: [
        {
          id: pageId,
          time: timestamp,
          messaging: [
            {
              sender: { id: 'paused-customer' },
              recipient: { id: pageId },
              timestamp,
              postback: { mid: 'postback-789', payload: 'CONFIRM_ORDER' },
            },
          ],
        },
      ],
    });
    const { database, store, sent, env } = await testHarness('d1');
    try {
      await store.setSessionControl('messenger:paused-customer', {
        agentMode: 'human_paused',
        assignedAgentId: 'agent-1',
      });

      const response = await enqueueMessengerWebhook(
        signedRequest(body),
        env,
        store,
      );

      expect(response).toMatchObject({
        status: 200,
        body: { received: 1, queued: 1, failed: 0 },
      });
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({
        channel: 'messenger_control_event',
        sessionId: 'messenger:paused-customer',
        externalMessageId: 'postback-789',
        messengerIngressClaim: {
          schemaVersion: 'kfc-messenger-ingress-claim-v1',
          queueBinding: { kind: 'messenger_control_event' },
        },
      });
      expectDeeplyAbsent(sent[0], [
        'event',
        'rawBodyBytes',
        'signature',
        'signatureHeader',
        'rawEvent',
        'payload',
      ]);
      const delivery = await store.getWebhookDelivery(
        'messenger',
        'postback-789',
      );
      expect(delivery?.payload).toEqual({
        eventType: 'postback',
        text: 'CONFIRM_ORDER',
        receivedAt: new Date(timestamp).toISOString(),
      });
    } finally {
      database.close();
    }
  });

  it('keeps webhook reservation idempotency when the signed request is retried', async () => {
    const timestamp = Date.now();
    const body = JSON.stringify({
      object: 'page',
      entry: [
        {
          id: pageId,
          time: timestamp,
          messaging: [
            {
              sender: { id: 'retry-customer' },
              recipient: { id: pageId },
              timestamp,
              message: { mid: 'retry-message', text: 'Xin chào' },
            },
          ],
        },
      ],
    });
    const { database, store, sent, env } = await testHarness();
    try {
      const first = await enqueueMessengerWebhook(
        signedRequest(body),
        env,
        store,
      );
      const retry = await enqueueMessengerWebhook(
        signedRequest(body),
        env,
        store,
      );

      expect(first.body).toMatchObject({ queued: 1 });
      expect(retry.body).toMatchObject({
        queued: 0,
        skippedDuplicates: 1,
      });
      expect(sent).toHaveLength(1);
      expect(
        await store.listWebhookDeliveries('messenger:retry-customer'),
      ).toHaveLength(1);
    } finally {
      database.close();
    }
  });
});

async function testHarness(): Promise<{
  database: SqliteD1Database;
  store: ConversationStore;
  sent: WorkerWebhookJob[];
  env: WorkerEnv;
}>;
async function testHarness(storeKind: 'd1'): Promise<{
  database: SqliteD1Database;
  store: ConversationStore;
  sent: WorkerWebhookJob[];
  env: WorkerEnv;
}>;
async function testHarness(storeKind: 'memory' | 'd1' = 'memory'): Promise<{
  database: SqliteD1Database;
  store: ConversationStore;
  sent: WorkerWebhookJob[];
  env: WorkerEnv;
}> {
  const database = new SqliteD1Database();
  const store: ConversationStore =
    storeKind === 'd1' ? new D1Store(database) : new MemoryStore();
  if (store instanceof D1Store) await store.initialize();
  const sent: WorkerWebhookJob[] = [];
  return {
    database,
    store,
    sent,
    env: {
      DB: database,
      META_APP_SECRET: appSecret,
      META_PAGE_ID: pageId,
      MESSENGER_WEBHOOK_QUEUE: {
        async send(message) {
          sent.push(message);
        },
      },
    },
  };
}

function signedRequest(body: string): Request {
  return new Request('https://example.test/webhooks/messenger', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': `sha256=${hmacHex(body)}`,
    },
    body,
  });
}

function hmacHex(body: string): string {
  return createHmac('sha256', appSecret).update(body).digest('hex');
}

function expectDeeplyAbsent(value: unknown, forbiddenKeys: string[]): void {
  if (!value || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    expect(forbiddenKeys).not.toContain(key);
    expectDeeplyAbsent(entry, forbiddenKeys);
  }
}
