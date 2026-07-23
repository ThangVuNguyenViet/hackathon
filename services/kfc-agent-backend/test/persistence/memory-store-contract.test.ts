import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../../src/persistence/memoryStore.js';

describe('MemoryStore conversation contract', () => {
  it('keeps sessions isolated and records a product turn with its audit event', async () => {
    const store = new MemoryStore();
    const first = await store.appendTurn({
      sessionId: 'session-a',
      channel: 'kfc',
      role: 'user',
      text: 'Xin chào',
      externalMessageId: 'message-a',
      externalUserId: 'customer-a',
      deliveryStatus: 'received',
      metadata: null,
    });
    await store.appendTurn({
      sessionId: 'session-b',
      channel: 'kfc',
      role: 'user',
      text: 'Một phiên khác',
      externalMessageId: 'message-b',
      externalUserId: 'customer-b',
      deliveryStatus: 'received',
      metadata: null,
    });

    expect(await store.listTurns('session-a')).toEqual([first]);
    expect(first.ordinal).toBe(1);
    expect(await store.listEvents('session-a')).toMatchObject([
      {
        sessionId: 'session-a',
        sourceType: 'conversation_turn:user',
        payload: {
          text: 'Xin chào',
          externalMessageId: 'message-a',
        },
      },
    ]);
  });

  it('allocates monotonic per-session ordinals under concurrent appends', async () => {
    const store = new MemoryStore();
    const append = (sessionId: string, index: number) =>
      store.appendTurn({
        sessionId,
        channel: 'kfc',
        role: index % 2 === 0 ? 'user' : 'assistant',
        text: `turn-${index}`,
        externalMessageId: null,
        externalUserId: 'customer-a',
        deliveryStatus: 'received',
        metadata: null,
      });

    await Promise.all([
      ...Array.from({ length: 20 }, (_, index) => append('session-a', index)),
      ...Array.from({ length: 3 }, (_, index) => append('session-b', index)),
    ]);

    expect(
      (await store.listTurns('session-a')).map((turn) => turn.ordinal),
    ).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
    expect(
      (await store.listTurns('session-b')).map((turn) => turn.ordinal),
    ).toEqual([1, 2, 3]);
  });

  it('uses CAS watermarks for summaries without replacing a newer summary', async () => {
    const store = new MemoryStore();
    const first = await store.compareAndSwapConversationSummary({
      sessionId: 'session-a',
      expectedRevision: null,
      expectedThroughOrdinal: 0,
      text: 'First exchange.',
      throughOrdinal: 2,
      updatedAt: '2026-07-01T00:00:00.000Z',
    });
    const replay = await store.compareAndSwapConversationSummary({
      sessionId: 'session-a',
      expectedRevision: null,
      expectedThroughOrdinal: 0,
      text: 'First exchange.',
      throughOrdinal: 2,
      updatedAt: '2026-07-01T00:00:00.000Z',
    });
    const stale = await store.compareAndSwapConversationSummary({
      sessionId: 'session-a',
      expectedRevision: null,
      expectedThroughOrdinal: 0,
      text: 'Stale replacement.',
      throughOrdinal: 4,
      updatedAt: '2026-07-02T00:00:00.000Z',
    });

    expect(first).toMatchObject({
      status: 'committed',
      summary: { schemaVersion: 1, revision: 1, throughOrdinal: 2 },
    });
    expect(replay).toMatchObject({ status: 'unchanged' });
    expect(stale).toMatchObject({ status: 'stale' });
    expect(await store.getConversationSummary('session-a')).toMatchObject({
      text: 'First exchange.',
      revision: 1,
      throughOrdinal: 2,
    });
  });
});
