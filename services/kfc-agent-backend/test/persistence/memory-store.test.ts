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

  it('reserves webhook deliveries once and records final status', async () => {
    const store = new MemoryStore();

    const first = await store.reserveWebhookDelivery({
      channel: 'messenger',
      externalEventId: 'mid_1',
      externalThreadId: 'psid_1',
      externalUserId: 'psid_1',
      sessionId: 'messenger:psid_1',
      receivedAt: '2026-07-08T08:00:00.000Z',
      payload: { message: { mid: 'mid_1' } },
    });
    const second = await store.reserveWebhookDelivery({
      channel: 'messenger',
      externalEventId: 'mid_1',
      externalThreadId: 'psid_1',
      externalUserId: 'psid_1',
      sessionId: 'messenger:psid_1',
      receivedAt: '2026-07-08T08:00:01.000Z',
      payload: { message: { mid: 'mid_1' } },
    });

    expect(first.reserved).toBe(true);
    expect(first.delivery).toMatchObject({ status: 'received' });
    expect(second.reserved).toBe(false);
    expect(second.delivery).toMatchObject({ status: 'received' });

    await store.markWebhookDeliveryProcessed('messenger', 'mid_1');
    expect(await store.getWebhookDelivery('messenger', 'mid_1')).toMatchObject({ status: 'processed' });

    await store.markWebhookDeliveryFailed('messenger', 'mid_1', 'send failed');
    expect(await store.getWebhookDelivery('messenger', 'mid_1')).toMatchObject({
      status: 'failed',
      lastError: 'send failed',
    });
  });
});

describe('DashboardEventBus', () => {
  it('hydrates existing events and persists newly emitted events', () => {
    const persistedEvents: unknown[] = [];
    const bus = new DashboardEventBus({
      initialEvents: [
        {
          id: 'event_existing',
          sessionId: 'session_1',
          type: 'customer_message_received',
          payload: { text: 'Cho mình Combo Hợp Gu 99K' },
          createdAt: '2026-07-07T00:00:00.000Z',
        },
      ],
      persistEvent(event) {
        persistedEvents.push(event);
      },
    });

    bus.emitEvent({
      id: 'event_new',
      sessionId: 'session_1',
      type: 'assistant_reply_sent',
      payload: { deliveryStatus: 'sent' },
      createdAt: '2026-07-07T00:00:01.000Z',
    });

    expect(bus.getEvents('session_1').map((event) => event.id)).toEqual(['event_existing', 'event_new']);
    expect(persistedEvents).toEqual([expect.objectContaining({ id: 'event_new' })]);
  });

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

  it('notifies dashboard stream subscribers and supports unsubscribe', () => {
    const bus = new DashboardEventBus();
    const received: string[] = [];
    const unsubscribe = bus.subscribe((event) => {
      received.push(event.id);
    });

    bus.emitEvent({
      id: 'event_1',
      sessionId: 'session_1',
      type: 'cart_changed',
      payload: { totalVnd: 99000 },
      createdAt: '2026-07-07T00:00:00.000Z',
    });
    unsubscribe();
    bus.emitEvent({
      id: 'event_2',
      sessionId: 'session_1',
      type: 'order_created',
      payload: { orderId: 'KFC-MOCK-1001' },
      createdAt: '2026-07-07T00:00:01.000Z',
    });

    expect(received).toEqual(['event_1']);
  });
});
