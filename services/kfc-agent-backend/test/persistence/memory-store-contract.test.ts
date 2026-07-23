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
});
