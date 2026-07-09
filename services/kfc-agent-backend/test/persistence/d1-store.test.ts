import { describe, expect, it } from 'vitest';
import { D1Store } from '../../src/persistence/d1Store.js';
import { FakeD1Database } from '../support/fakeD1Database.js';

describe('D1Store', () => {
  it('stores transcript turns, dashboard events, and webhook delivery state', async () => {
    const db = new FakeD1Database();
    const store = new D1Store(db);

    await store.initialize();
    const turn = await store.appendTurn({
      sessionId: 'messenger:psid_1',
      channel: 'messenger',
      role: 'user',
      text: 'Cho mình 1 Combo 99K',
      externalMessageId: 'mid_1',
      externalUserId: 'psid_1',
      deliveryStatus: 'received',
    });
    await store.appendDashboardEvent({
      id: 'dash_1',
      sessionId: 'messenger:psid_1',
      type: 'customer_message_received',
      payload: { text: 'Cho mình 1 Combo 99K' },
      createdAt: '2026-07-08T00:00:00.000Z',
    });
    const reserved = await store.reserveWebhookDelivery({
      channel: 'messenger',
      externalEventId: 'mid_1',
      externalThreadId: 'psid_1',
      externalUserId: 'psid_1',
      sessionId: 'messenger:psid_1',
      receivedAt: '2026-07-08T00:00:00.000Z',
      payload: { message: { mid: 'mid_1' } },
    });
    const duplicate = await store.reserveWebhookDelivery({
      channel: 'messenger',
      externalEventId: 'mid_1',
      externalThreadId: 'psid_1',
      externalUserId: 'psid_1',
      sessionId: 'messenger:psid_1',
      receivedAt: '2026-07-08T00:00:01.000Z',
      payload: { message: { mid: 'mid_1' } },
    });

    expect(turn).toMatchObject({ externalMessageId: 'mid_1', role: 'user' });
    expect(await store.findTurnByExternalMessage('messenger:psid_1', 'mid_1')).toMatchObject({ id: turn.id });
    expect(await store.listTurns('messenger:psid_1')).toHaveLength(1);
    expect(await store.listDashboardEvents()).toEqual([
      expect.objectContaining({ id: 'dash_1', payload: { text: 'Cho mình 1 Combo 99K' } }),
    ]);
    expect(reserved.reserved).toBe(true);
    expect(duplicate.reserved).toBe(false);

    await store.markWebhookDeliveryProcessed('messenger', 'mid_1');
    expect(await store.getWebhookDelivery('messenger', 'mid_1')).toMatchObject({ status: 'processed' });
  });
});
