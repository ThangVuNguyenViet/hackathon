/** Cloudflare's documented maximum for one Queue message. */
export const CLOUDFLARE_QUEUE_MAX_MESSAGE_BYTES = 128_000;
/**
 * Reserved for Queue serialization/metadata drift so an application payload
 * accepted locally remains below the platform ceiling.
 */
export const WORKER_QUEUE_METADATA_HEADROOM_BYTES = 8_000;
export const WORKER_QUEUE_MAX_MESSAGE_BYTES =
  CLOUDFLARE_QUEUE_MAX_MESSAGE_BYTES - WORKER_QUEUE_METADATA_HEADROOM_BYTES;

export function workerQueuePayloadByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export function assertWorkerQueuePayloadFits(value: unknown): void {
  if (workerQueuePayloadByteLength(value) > WORKER_QUEUE_MAX_MESSAGE_BYTES) {
    throw new Error('worker_queue_payload_too_large');
  }
}

export async function sendBoundedWorkerQueueMessage<T>(
  queue: {
    send(message: T, options?: { delaySeconds?: number }): Promise<void>;
  },
  message: T,
  options?: { delaySeconds?: number },
): Promise<void> {
  assertWorkerQueuePayloadFits(message);
  await queue.send(message, options);
}
