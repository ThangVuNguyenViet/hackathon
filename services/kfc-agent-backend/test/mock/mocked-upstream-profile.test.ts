import { describe, expect, it } from 'vitest';
import type { Order } from '../../src/domain/types.js';
import {
  applyMockedUpstreamFixtureOverrides,
  mockedUpstreamApiProfileSchema,
  mockedUpstreamClientOptions,
} from '../../src/mock/mockedUpstreamProfile.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';

function seededOrder(): Order {
  return {
    id: 'ORDER-TRACKING-1',
    status: 'preparing',
    paymentStatus: 'paid',
    assignedStoreId: 'KFCVN0001',
    createdAt: '2026-07-14T00:00:00.000Z',
    cart: {
      id: 'cart-order-tracking-1',
      items: [{ itemCode: 'item_1', name: 'Fixture item', quantity: 1, unitPriceVnd: 50_000 }],
      subtotalVnd: 50_000,
      discountVnd: 0,
      deliveryFeeVnd: 18_000,
      totalVnd: 68_000,
      voucherCode: null,
    },
  };
}

describe('authorized mocked upstream profile', () => {
  it('provides explicit customer commerce evidence without anonymous defaults', async () => {
    const order = seededOrder();
    const profile = mockedUpstreamApiProfileSchema.parse({
      savedAddresses: [{ label: 'Nhà', line1: '10 Test', district: 'Quận 1', city: 'Hồ Chí Minh' }],
      favoriteItems: [{
        code: 'item_1', category: 'Fixture', name: 'Fixture item', description: 'Fixture evidence',
        priceVnd: 50_000, originalPriceVnd: null, imageUrl: '', available: true,
      }],
      orders: [order],
      recentOrderId: order.id,
      paymentStatuses: { [order.id]: 'paid' },
    });
    const options = mockedUpstreamClientOptions(profile);

    expect(await options.savedAddressesProvider?.('customer')).toMatchObject({ ok: true, value: profile.savedAddresses });
    expect(await options.recentOrderProvider?.('customer')).toMatchObject({ ok: true, value: order });
    expect(await options.orderStatusProvider?.(order.id)).toMatchObject({ ok: true, value: order });
    expect(await options.paymentStatusProvider?.(order.id)).toMatchObject({ ok: true, value: { status: 'paid' } });
  });

  it('merges explicit menu and modifier API overrides by catalog identity', () => {
    const fixtures = createTestFixtures();
    const menuItem = { ...fixtures.menuItems[0]!, name: 'Updated upstream item' };
    const menuModifier = { ...fixtures.menuModifiers[0]!, name: 'Updated upstream modifier' };
    const merged = applyMockedUpstreamFixtureOverrides(fixtures, {
      menuItems: [menuItem],
      menuModifiers: [menuModifier],
    });

    expect(merged.menuItems.find((item) => item.code === menuItem.code)?.name).toBe('Updated upstream item');
    expect(merged.menuModifiers.find((modifier) => modifier.itemCode === menuModifier.itemCode)?.name)
      .toBe('Updated upstream modifier');
  });
});
