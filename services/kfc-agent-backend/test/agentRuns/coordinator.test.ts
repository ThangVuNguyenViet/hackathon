import { describe, expect, it } from 'vitest';
import { AgentRunCoordinator } from '../../src/agentRuns/coordinator.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';

describe('AgentRunCoordinator', () => {
  it('lets only one worker claim a session generation', async () => {
    const store = new MemoryStore();
    const coordinator = new AgentRunCoordinator({ store, options: { debounceWindowMs: 0 } });
    const wakeup = await coordinator.recordPendingTurn({
      channel: 'messenger',
      externalUserId: 'customer-1',
      externalThreadId: 'thread-1',
      text: 'Cho mình một combo.',
      eventType: 'message',
      rawEventId: 'message-1',
      receivedAt: '2026-07-16T00:00:00.000Z',
      shouldRunAgent: true,
    }, 'messenger:customer-1');

    const results = await Promise.all([
      coordinator.claimWakeupRun(wakeup),
      coordinator.claimWakeupRun(wakeup),
    ]);

    expect(results.filter((result) => result.claimed)).toHaveLength(1);
    expect(results.filter((result) => result.reason === 'already_claimed')).toHaveLength(1);
    expect(new Set(results.map((result) => result.runId)).size).toBe(1);
    await expect(store.listAgentRuns('messenger:customer-1')).resolves.toHaveLength(1);
  });
});
