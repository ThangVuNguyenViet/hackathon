import { describe, expect, it } from 'vitest';
import { D1Store } from '../../src/persistence/d1Store.js';
import { FakeD1Database } from '../support/fakeD1Database.js';

describe('D1Store', () => {
  it('upgrades an old conversation_turns schema before metadata writes', async () => {
    const db = new FakeD1Database();
    db.defineTable('conversation_turns', [
      'id',
      'session_id',
      'channel',
      'role',
      'text',
      'external_message_id',
      'external_user_id',
      'delivery_status',
      'created_at',
    ]);
    const store = new D1Store(db);

    await store.initialize();

    expect(db.hasColumn('conversation_turns', 'metadata')).toBe(true);
    expect(db.hasTable('conversation_profiles')).toBe(true);

    await store.appendTurn({
      sessionId: 'messenger:legacy_user',
      channel: 'messenger',
      role: 'user',
      text: 'legacy schema image',
      externalMessageId: 'mid_legacy_1',
      externalUserId: 'legacy_user',
      deliveryStatus: 'received',
      metadata: {
        platformEventName: 'message',
        attachments: [{ type: 'image', url: 'https://legacy.local/image.jpg' }],
      },
    });

    await expect(store.listTurns('messenger:legacy_user')).resolves.toEqual([
      expect.objectContaining({
        externalMessageId: 'mid_legacy_1',
        metadata: {
          platformEventName: 'message',
          attachments: [{ type: 'image', url: 'https://legacy.local/image.jpg' }],
        },
      }),
    ]);
  });

  it('persists profile rows and turn metadata in D1', async () => {
    const db = new FakeD1Database();
    const store = new D1Store(db);
    await store.initialize();

    await store.upsertProfile({
      channel: 'zalo',
      externalUserId: 'zalo_user_1',
      displayName: 'Tran Binh',
      avatarUrl: null,
      profileSource: 'zalo_webhook',
      profileUpdatedAt: '2026-07-09T00:00:00.000Z',
    });
    await store.appendTurn({
      sessionId: 'zalo:zalo_user_1',
      channel: 'zalo',
      role: 'user',
      text: '[Zalo image]',
      externalMessageId: 'zalo_image_1',
      externalUserId: 'zalo_user_1',
      deliveryStatus: 'received',
      metadata: {
        platformEventName: 'user_send_image',
        attachments: [{ type: 'image', url: 'https://zalo.local/image.jpg' }],
      },
    });

    expect(await store.getProfile('zalo', 'zalo_user_1')).toMatchObject({
      displayName: 'Tran Binh',
      profileSource: 'zalo_webhook',
    });
    expect((await store.listTurns('zalo:zalo_user_1'))[0]).toMatchObject({
      metadata: {
        platformEventName: 'user_send_image',
        attachments: [{ type: 'image', url: 'https://zalo.local/image.jpg' }],
      },
    });
  });

  it('returns the existing turn when appending a duplicate external message id', async () => {
    const db = new FakeD1Database();
    const store = new D1Store(db);
    await store.initialize();

    const first = await store.appendTurn({
      sessionId: 'messenger:psid_1',
      channel: 'messenger',
      role: 'user',
      text: 'first delivery',
      externalMessageId: 'mid_duplicate',
      externalUserId: 'psid_1',
      deliveryStatus: 'received',
      metadata: null,
    });
    const second = await store.appendTurn({
      sessionId: 'messenger:psid_1',
      channel: 'messenger',
      role: 'user',
      text: 'retried delivery',
      externalMessageId: 'mid_duplicate',
      externalUserId: 'psid_1',
      deliveryStatus: 'received',
      metadata: null,
    });

    expect(second).toEqual(first);
    expect(await store.listTurns('messenger:psid_1')).toHaveLength(1);
  });

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
      metadata: null,
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

  it('initializes repeatedly without failing', async () => {
    const db = new FakeD1Database();
    const store = new D1Store(db);

    await store.initialize();
    await store.initialize();

    await expect(
      store.appendTurn({
        sessionId: 'messenger:psid_repeat',
        channel: 'messenger',
        role: 'user',
        text: 'repeat init',
        externalMessageId: 'mid_repeat',
        externalUserId: 'psid_repeat',
        deliveryStatus: 'received',
        metadata: null,
      }),
    ).resolves.toMatchObject({
      sessionId: 'messenger:psid_repeat',
      externalMessageId: 'mid_repeat',
      metadata: null,
    });
  });
});
