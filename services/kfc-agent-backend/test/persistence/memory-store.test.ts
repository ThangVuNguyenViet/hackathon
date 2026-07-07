import { describe, expect, it } from 'vitest';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';

describe('MemoryStore', () => {
  it('stores full transcript and returns bounded long-range evidence', async () => {
    const store = new MemoryStore();
    await store.appendTurn({
      sessionId: 'session_1',
      channel: 'messenger',
      role: 'user',
      text: 'Giao tới 123 Nguyễn Trãi, Quận 5',
      externalMessageId: 'mid_address',
      externalUserId: 'psid_1',
      deliveryStatus: 'received',
    });
    await store.appendTurn({
      sessionId: 'session_1',
      channel: 'messenger',
      role: 'assistant',
      text: 'Mình đã lưu địa chỉ.',
      externalMessageId: null,
      externalUserId: 'psid_1',
      deliveryStatus: 'sent',
    });
    await store.appendTurn({
      sessionId: 'session_1',
      channel: 'messenger',
      role: 'user',
      text: 'Giao tới chỗ cũ nha',
      externalMessageId: 'mid_old_place',
      externalUserId: 'psid_1',
      deliveryStatus: 'received',
    });

    const results = await store.searchHistory('session_1', 'chỗ cũ');
    expect(results[0]).toMatchObject({
      sourceType: 'conversation_turn:user',
      confidence: 0.9,
    });
    expect(results[0]?.payload).toMatchObject({ text: 'Giao tới 123 Nguyễn Trãi, Quận 5' });
    expect(await store.listTurns('session_1')).toHaveLength(3);
  });
});

describe('DashboardEventBus', () => {
  it('records emitted events for replay assertions', () => {
    const bus = new DashboardEventBus();
    bus.emitEvent({
      id: 'event_1',
      sessionId: 'session_1',
      type: 'cart_changed',
      payload: { totalVnd: 99000 },
      createdAt: '2026-07-07T00:00:00.000Z',
    });

    expect(bus.getEvents('session_1')).toHaveLength(1);
  });
});
