import { describe, expect, it } from 'vitest';
import {
  assertWorkerQueuePayloadFits,
  WORKER_QUEUE_MAX_MESSAGE_BYTES,
} from '../../src/workerQueueEnvelope.js';

describe('Cloudflare queue payload bound', () => {
  it('accepts a compact normalized job', () => {
    expect(() =>
      assertWorkerQueuePayloadFits({
        channel: 'messenger_control_event',
        event: { text: 'hello' },
      }),
    ).not.toThrow();
  });

  it('rejects an expanded raw-body array before Queue.send', () => {
    const expandedRawBody = {
      messengerIngressProof: {
        rawBodyBytes: Array.from({ length: WORKER_QUEUE_MAX_MESSAGE_BYTES }, () =>
          255,
        ),
      },
    };

    expect(() => assertWorkerQueuePayloadFits(expandedRawBody)).toThrow(
      'worker_queue_payload_too_large',
    );
  });
});
