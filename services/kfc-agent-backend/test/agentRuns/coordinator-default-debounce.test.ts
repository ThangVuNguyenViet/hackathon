import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentRunCoordinator } from '../../src/agentRuns/coordinator.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';

describe('AgentRunCoordinator default debounce', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('schedules a channel turn after 500 milliseconds by default', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-25T00:00:00.000Z'));
    const coordinator = new AgentRunCoordinator({
      store: new MemoryStore(),
    });

    const wakeup = await coordinator.recordPendingTurn(
      {
        channel: 'messenger',
        externalUserId: 'customer-1',
        externalThreadId: 'thread-1',
        text: 'Cho mình một combo.',
        eventType: 'message',
        rawEventId: 'message-default-debounce',
        receivedAt: '2026-07-25T00:00:00.000Z',
        shouldRunAgent: true,
      },
      'messenger:default-debounce',
    );

    expect(wakeup.dueAt).toBe('2026-07-25T00:00:00.500Z');
  });
});
