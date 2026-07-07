import { describe, expect, it } from 'vitest';
import { createMockClients } from '../../src/mock/createMockClients.js';
import type { GeneratedFixtures } from '../../src/fixtures/schema.js';

const fixtures: GeneratedFixtures = {
  menuItems: [
    {
      code: 'HOPGU',
      category: 'Hot Deals',
      name: 'Combo 99K',
      description: '3 Fried Chicken + 1 Shrimp Burger',
      priceVnd: 99000,
      originalPriceVnd: null,
      imageUrl: 'https://static.kfcvietnam.com.vn/images/items/lg/HOPGU.jpg?v=LNN7PL',
      available: true,
      provenance: {
        sourceFile: 'crawl.json',
        okfConceptId: 'menu/items/HOPGU',
        fixtureMode: 'public_crawl_seed',
      },
    },
  ],
};

describe('mock clients', () => {
  it('searches menu and builds priced carts', async () => {
    const clients = createMockClients(fixtures);
    const search = await clients.menu.searchMenu('combo');
    expect(search.ok).toBe(true);
    expect(search.value?.[0]?.code).toBe('HOPGU');

    const cart = await clients.cart.createCart('session_1');
    const updated = await clients.cart.updateCart(cart.value!, 'HOPGU', 2);
    expect(updated.value?.subtotalVnd).toBe(198000);
  });

  it('rejects order placement without explicit confirmation', async () => {
    const clients = createMockClients(fixtures);
    const cart = (await clients.cart.createCart('session_1')).value!;
    const updated = (await clients.cart.updateCart(cart, 'HOPGU', 1)).value!;
    const preview = (
      await clients.oms.previewOrder({
        cart: updated,
        address: { label: 'Home', line1: '23 Nguyen Huu Tho', district: 'Quan 7', city: 'Ho Chi Minh' },
        storeId: 'store_mock',
      })
    ).value!;

    const placed = await clients.oms.placeOrder({ preview, userConfirmed: false });
    expect(placed.ok).toBe(false);
    expect(placed.errorCode).toBe('confirmation_required');
  });

  it('does not fake channel delivery unless explicit channel clients are injected', async () => {
    const clients = createMockClients(fixtures);
    const sent = await clients.messenger.sendText('psid_1', 'Xin chao');
    expect(sent.ok).toBe(false);
    expect(sent.errorCode).toBe('channel_client_not_configured');

    const injected = createMockClients(fixtures, {
      channelClients: {
        messenger: {
          async sendText() {
            return { ok: true, value: { messageId: 'live_messenger_message' }, message: 'sent' };
          },
        },
        zalo: {
          async sendText() {
            return { ok: true, value: { messageId: 'live_zalo_message' }, message: 'sent' };
          },
        },
      },
    });

    expect((await injected.messenger.sendText('psid_1', 'Xin chao')).value?.messageId).toBe('live_messenger_message');
  });
});
