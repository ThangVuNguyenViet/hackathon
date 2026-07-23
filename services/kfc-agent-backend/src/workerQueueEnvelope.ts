export const WORKER_QUEUE_MAX_MESSAGE_BYTES = 128_000;

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
