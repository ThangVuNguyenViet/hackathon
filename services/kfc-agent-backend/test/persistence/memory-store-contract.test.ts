import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import { createPackStateEnvelope } from '../../src/runtime/businessPack.js';

describe('MemoryStore conversation contract', () => {
  it('keeps canonical transcript sessions isolated', async () => {
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

  it('atomically publishes an unguarded assistant turn with typed state', async () => {
    const store = new MemoryStore();
    const envelope = await createPackStateEnvelope({
      packRef: { packId: 'kfc-vietnam', version: '1.0.0' },
      schemaVersion: '1',
      state: { cartId: 'cart-a' },
    });

    const result = await store.commitAssistantTurn({
      packState: { sessionId: 'session-a', envelope },
      assistantTurn: {
        sessionId: 'session-a',
        channel: 'kfc',
        role: 'assistant',
        text: 'Ready',
        externalMessageId: null,
        externalUserId: 'customer-a',
        deliveryStatus: 'pending',
        metadata: null,
      },
    });

    expect(result.turn.ordinal).toBe(1);
    expect(await store.listTurns('session-a')).toEqual([result.turn]);
    expect(
      await store.getPackState('session-a', envelope.packRef),
    ).toEqual(envelope);
  });

  it('does not advance compatibility or pack state when assistant publication fails', async () => {
    const store = new MemoryStore();
    const envelope = await createPackStateEnvelope({
      packRef: { packId: 'kfc-vietnam', version: '1.0.0' },
      schemaVersion: '1',
      state: { cartId: 'cart-a' },
    });

    await expect(
      store.commitAssistantTurn({
        packState: { sessionId: 'session-a', envelope },
        assistantTurn: {
          sessionId: 'session-a',
          channel: 'kfc',
          role: 'user',
          text: 'injected invalid assistant publication',
          externalMessageId: null,
          externalUserId: 'customer-a',
          deliveryStatus: 'pending',
          metadata: null,
        },
      }),
    ).rejects.toThrow('agent_turn_commit_shape_invalid');

    expect(await store.listTurns('session-a')).toEqual([]);
    expect(
      await store.getPackState('session-a', envelope.packRef),
    ).toBeUndefined();
  });
});
