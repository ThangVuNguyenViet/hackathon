import { describe, expect, it } from 'vitest';
import {
  CLOUDFLARE_QUEUE_MAX_MESSAGE_BYTES,
  sendBoundedWorkerQueueMessage,
  WORKER_QUEUE_METADATA_HEADROOM_BYTES,
  WORKER_QUEUE_MAX_MESSAGE_BYTES,
} from '../../src/workerQueueEnvelope.js';

describe('Cloudflare queue payload bound', () => {
  it('reserves explicit platform metadata headroom', () => {
    expect(WORKER_QUEUE_METADATA_HEADROOM_BYTES).toBeGreaterThan(0);
    expect(WORKER_QUEUE_MAX_MESSAGE_BYTES).toBe(
      CLOUDFLARE_QUEUE_MAX_MESSAGE_BYTES -
        WORKER_QUEUE_METADATA_HEADROOM_BYTES,
    );
  });

  it('sends a body at the exact application boundary', async () => {
    const sent: unknown[] = [];
    const queue = {
      async send(message: unknown) {
        sent.push(message);
      },
    };
    const exactBoundaryBody = 'x'.repeat(WORKER_QUEUE_MAX_MESSAGE_BYTES - 2);

    await sendBoundedWorkerQueueMessage(queue, exactBoundaryBody);

    expect(sent).toEqual([exactBoundaryBody]);
  });

  it('rejects one byte beyond the application boundary before Queue.send', async () => {
    const sent: unknown[] = [];
    const queue = {
      async send(message: unknown) {
        sent.push(message);
      },
    };
    const oversizedBody = 'x'.repeat(WORKER_QUEUE_MAX_MESSAGE_BYTES - 1);

    await expect(
      sendBoundedWorkerQueueMessage(queue, oversizedBody),
    ).rejects.toThrow(
      'worker_queue_payload_too_large',
    );
    expect(sent).toEqual([]);
  });
});
