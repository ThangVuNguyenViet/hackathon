import { describe, expect, it, vi } from 'vitest';
import {
  CustomerRunCoordinator,
  type CustomerRunCoordinatorOptions,
} from '../../src/customerRuns/runtime.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';

const request = {
  schemaVersion: 1 as const,
  sessionId: 'kfc:customer_1',
  customerId: 'customer_1',
  clientMessageId: 'message_1',
  input: { kind: 'text' as const, text: 'Cho mình một combo gà' },
};

describe('CustomerRunCoordinator', () => {
  it('recovers an accepted queued run when its exact start is replayed', async () => {
    const store = new MemoryStore();
    const deferred: Array<() => Promise<void>> = [];
    const execute = vi.fn(async () => ({ responseText: 'Đã phục hồi.' }));
    const options: CustomerRunCoordinatorOptions & {
      replayRecoveryDelayMs: number;
    } = {
      store,
      defer: (task) => deferred.push(task),
      execute,
      paceMs: 0,
      replayRecoveryDelayMs: 0,
    };
    const coordinator = new CustomerRunCoordinator(options);

    const first = await coordinator.start(request);
    deferred.shift();
    const replay = await coordinator.start(request);

    expect(replay.body).toMatchObject({
      runId: first.body.runId,
      replayed: true,
    });
    expect(deferred).toHaveLength(1);
    await deferred[0]!();
    expect(execute).toHaveBeenCalledTimes(1);
    await expect(store.getCustomerRun(first.body.runId as string)).resolves
      .toMatchObject({ status: 'completed' });
  });
});
