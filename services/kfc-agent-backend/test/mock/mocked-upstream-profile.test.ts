import { describe, expect, it } from 'vitest';
import type { Order } from '../../src/domain/types.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import {
  applyMockedUpstreamFixtureOverrides,
  mockedUpstreamApiProfileSchema,
  mockedUpstreamClientOptions,
} from '../../src/mock/mockedUpstreamProfile.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';

function externalCallContext() {
  return {
    signal: new AbortController().signal,
    deadlineAt: Date.now() + 10_000,
  };
}

function seededOrder(): Order {
  const estimateObservedAt = Date.now();
  return {
    id: 'ORDER-TRACKING-1',
    status: 'preparing',
    paymentStatus: 'paid',
    assignedStoreId: 'KFCVN0001',
    createdAt: '2026-07-14T00:00:00.000Z',
    deliveryEstimate: {
      kind: 'remaining_delivery_window',
      minMinutes: 25,
      maxMinutes: 30,
      observedAt: new Date(estimateObservedAt).toISOString(),
      expiresAt: new Date(estimateObservedAt + 5 * 60_000).toISOString(),
      providerRevision: 'mock-oms:ORDER-TRACKING-1:status-v2',
    },
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
        categoryId: 'fixture-category',
        priceVnd: 50_000, originalPriceVnd: null, imageUrl: '', available: true,
      }],
      orders: [order],
      recentOrderId: order.id,
      paymentStatuses: { [order.id]: 'paid' },
    });
    const options = mockedUpstreamClientOptions(profile);

    expect(await options.savedAddressesProvider?.('customer', externalCallContext()))
      .toMatchObject({ ok: true, value: profile.savedAddresses });
    const recentOrder =
      await options.recentOrderProvider?.('customer', externalCallContext());
    expect(recentOrder).toMatchObject({
      ok: true,
      value: {
        id: order.id,
        status: order.status,
      },
    });
    expect(recentOrder?.value).not.toHaveProperty('deliveryEstimate');
    expect(await options.orderStatusProvider?.(order.id, externalCallContext()))
      .toMatchObject({ ok: true, value: order });
    expect(await options.paymentStatusProvider?.(order.id, externalCallContext()))
      .toMatchObject({ ok: true, value: { status: 'paid' } });
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

  it('rejects missing or empty provider-owned menu category identity', () => {
    const menuItem = {
      ...createTestFixtures().menuItems[0]!,
      categoryId: '',
    };
    const {
      categoryId: _categoryId,
      ...missingCategoryId
    } = menuItem;
    void _categoryId;

    expect(mockedUpstreamApiProfileSchema.safeParse({
      menuItems: [menuItem],
    }).success).toBe(false);
    expect(mockedUpstreamApiProfileSchema.safeParse({
      menuItems: [missingCategoryId],
    }).success).toBe(false);
  });

  it.each([
    { minMinutes: 0 },
    { maxMinutes: 1_441 },
    { minMinutes: 31, maxMinutes: 30 },
    { observedAt: 'not-an-instant' },
    { expiresAt: 'not-an-instant' },
    {
      observedAt: '2026-07-14T00:05:00.000Z',
      expiresAt: '2026-07-14T00:05:00.000Z',
    },
    { providerRevision: '   ' },
  ])('rejects malformed provider ETA before exposing any mock client ($#)', (patch) => {
    const order = seededOrder();
    const parsed = mockedUpstreamApiProfileSchema.safeParse({
      orders: [{
        ...order,
        deliveryEstimate: {
          ...order.deliveryEstimate,
          ...patch,
        },
      }],
    });

    expect(parsed.success).toBe(false);
  });

  it('removes expired mock-provider ETA without discarding current order status', async () => {
    const order = seededOrder();
    order.deliveryEstimate = {
      ...order.deliveryEstimate!,
      observedAt: '2026-07-14T00:00:00.000Z',
      expiresAt: '2026-07-14T00:05:00.000Z',
      providerRevision: 'mock-oms:ORDER-TRACKING-1:expired',
    };
    const profile = mockedUpstreamApiProfileSchema.parse({ orders: [order] });
    const clients = createMockClients(
      createTestFixtures(),
      mockedUpstreamClientOptions(profile),
    );

    const result = await clients.oms.getOrderStatus(
      order.id,
      externalCallContext(),
    );

    expect(result).toMatchObject({
      ok: true,
      value: { id: order.id, status: order.status },
    });
    expect(result.value?.deliveryEstimate).toBeUndefined();
  });
});
