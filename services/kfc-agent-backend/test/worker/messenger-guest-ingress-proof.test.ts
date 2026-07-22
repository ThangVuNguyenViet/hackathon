import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import worker, {
  type WorkerEnv,
  type WorkerWebhookJob,
} from '../../src/worker.js';
import { FakeD1Database } from '../support/fakeD1Database.js';

const appSecret = 'worker-messenger-guest-ingress-secret';

class CapturingQueue {
  readonly messages: WorkerWebhookJob[] = [];

  async send(message: WorkerWebhookJob): Promise<void> {
    this.messages.push(structuredClone(message));
  }
}

function signedRequest(rawBody: string, signature?: string) {
  return new Request(
    'https://worker.local/webhooks/messenger',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256':
          signature ??
          `sha256=${createHmac('sha256', appSecret)
            .update(rawBody)
            .digest('hex')}`,
      },
      body: rawBody,
    },
  );
}

function environment(queue: CapturingQueue): WorkerEnv {
  return {
    DB: new FakeD1Database(),
    META_APP_SECRET: appSecret,
    META_PAGE_ID: 'worker-page',
    META_PAGE_ACCESS_TOKEN: 'worker-page-token',
    MESSENGER_WEBHOOK_QUEUE: queue,
  };
}

describe('Worker Messenger guest ingress proof', () => {
  it('queues bounded raw signed proof for re-verification in the execution isolate', async () => {
    const queue = new CapturingQueue();
    const rawBody = JSON.stringify({
      object: 'page',
      entry: [{
        id: 'worker-page',
        time: 1_784_505_600_000,
        messaging: [{
          sender: { id: 'worker-guest' },
          recipient: { id: 'worker-page' },
          timestamp: 1_784_505_600_000,
          message: {
            mid: 'mid-worker-guest',
            text: 'Xác nhận đặt đơn',
          },
        }],
      }],
    });

    const response = await worker.fetch(
      signedRequest(rawBody),
      environment(queue),
    );

    expect(response.status).toBe(200);
    expect(queue.messages).toHaveLength(1);
    expect(queue.messages[0]).toMatchObject({
      channel: 'agent_run_wakeup',
      messengerIngressProof: {
        schemaVersion: 'kfc-messenger-ingress-proof-v1',
        rawBodyBytes: Array.from(new TextEncoder().encode(rawBody)),
        signatureHeader: expect.stringMatching(/^sha256=[a-f0-9]{64}$/u),
      },
    });
    expect(JSON.stringify(queue.messages[0])).not.toContain(appSecret);
  });

  it('queues nothing for a tampered signature', async () => {
    const queue = new CapturingQueue();
    const rawBody = JSON.stringify({
      object: 'page',
      entry: [{
        id: 'worker-page',
        messaging: [{
          sender: { id: 'worker-guest-tampered' },
          recipient: { id: 'worker-page' },
          message: {
            mid: 'mid-worker-guest-tampered',
            text: 'Xác nhận đặt đơn',
          },
        }],
      }],
    });

    const response = await worker.fetch(
      signedRequest(rawBody, `sha256=${'0'.repeat(64)}`),
      environment(queue),
    );

    expect(response.status).toBe(401);
    expect(queue.messages).toEqual([]);
  });
});
