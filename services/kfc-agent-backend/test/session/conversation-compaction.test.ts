import { describe, expect, it, vi } from 'vitest';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import { scheduleConversationCompaction } from '../../src/session/conversationCompaction.js';

describe('conversation compaction scheduling', () => {
  it('returns immediately and advances only after deferred work runs', async () => {
    const store = new MemoryStore();
    for (const [role, text] of [
      ['user', 'older user'],
      ['assistant', 'older assistant'],
      ['user', 'recent user'],
      ['assistant', 'recent assistant'],
    ] as const) {
      await store.appendTurn({
        sessionId: 'deferred-compaction',
        channel: 'kfc',
        role,
        text,
        externalMessageId: null,
        externalUserId: null,
        deliveryStatus: 'not_applicable',
        metadata: null,
      });
    }
    const deferred: Array<() => Promise<void>> = [];
    const summarize = vi.fn(async () => 'durable compacted history');

    scheduleConversationCompaction({
      store,
      sessionId: 'deferred-compaction',
      tokenBudget: 4,
      countTokens: async (text) => (text.includes('recent') ? 4 : 3),
      summarize,
      deferWork: (task) => deferred.push(task),
    });

    expect(deferred).toHaveLength(1);
    expect(summarize).not.toHaveBeenCalled();
    await expect(
      store.getConversationSummary('deferred-compaction'),
    ).resolves.toBeUndefined();

    await deferred[0]!();

    expect(summarize).toHaveBeenCalledOnce();
    await expect(
      store.getConversationSummary('deferred-compaction'),
    ).resolves.toMatchObject({
      text: 'durable compacted history',
      throughOrdinal: 2,
    });
  });

  it('contains background failures without rejecting the product path', async () => {
    const onError = vi.fn();
    const deferred: Array<() => Promise<void>> = [];
    scheduleConversationCompaction({
      store: {
        async listTurns() {
          throw new Error('storage unavailable');
        },
        async getConversationSummary() {
          return undefined;
        },
        async compareAndSwapConversationSummary() {
          throw new Error('must not run');
        },
      },
      sessionId: 'compaction-failure',
      tokenBudget: 4,
      countTokens: async () => 1,
      summarize: async () => 'unused',
      deferWork: (task) => deferred.push(task),
      onError,
    });

    await expect(deferred[0]!()).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledOnce();
  });
});
