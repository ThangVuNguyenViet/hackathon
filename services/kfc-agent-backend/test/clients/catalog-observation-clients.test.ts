import { describe, expect, it, vi } from 'vitest';
import catalogPayload from '../../fixtures/catalog-baselines/kfcvn-generic-menu@2026-07-10.raw.json' with { type: 'json' };
import { fetchCatalogObservation } from '../../src/catalog/catalogObservation.js';
import type { CartClient, OmsClient } from '../../src/clients/interfaces.js';
import { createCatalogObservationClients } from '../../src/clients/catalogObservationClients.js';
import type { Cart, Order } from '../../src/domain/types.js';

const cart: Cart = {
  id: 'cart-1',
  items: [{ itemCode: '41160', name: 'Pepsi', quantity: 1, unitPriceVnd: 5_000 }],
  subtotalVnd: 5_000,
  discountVnd: 0,
  deliveryFeeVnd: 0,
  totalVnd: 5_000,
  voucherCode: null,
};

const order: Order = {
  id: 'preview-1',
  cart,
  status: 'previewed',
  paymentStatus: 'pending',
  assignedStoreId: 'store-1',
  createdAt: '2026-07-14T00:00:00.000Z',
};

describe('catalog observation clients', () => {
  it('uses current API authority and fails closed before provider mutation on relevant drift', async () => {
    const pinned = await fetchCatalogObservation({
      environment: 'sandbox',
      sourceUrl: 'https://catalog.example/menu',
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(catalogPayload), {
        headers: { 'cache-control': 'max-age=300' },
      })),
    });
    const updateCart = vi.fn<CartClient['updateCart']>().mockResolvedValue({ ok: true, value: cart, message: 'updated' });
    const previewOrder = vi.fn<OmsClient['previewOrder']>().mockResolvedValue({ ok: true, value: order, message: 'previewed' });
    const providerCart: CartClient = {
      createCart: vi.fn().mockResolvedValue({ ok: true, value: cart, message: 'created' }),
      applyChanges: vi.fn().mockResolvedValue({ ok: true, value: cart, message: 'updated' }),
      updateCart,
      previewCart: vi.fn().mockResolvedValue({ ok: true, value: cart, message: 'previewed' }),
    };
    const providerOms: OmsClient = {
      previewOrder,
      placeOrder: vi.fn().mockResolvedValue({ ok: true, value: order, message: 'placed' }),
      getOrderStatus: vi.fn().mockResolvedValue({ ok: true, value: order, message: 'status' }),
      cancelOrder: vi.fn().mockResolvedValue({ ok: true, value: order, message: 'cancelled' }),
    };
    const drifted = {
      ...pinned,
      id: `${pinned.id}:drifted`,
      items: pinned.items.map((item) => item.itemCode === '41160' ? { ...item, priceVnd: 7_000 } : item),
    };
    const clients = createCatalogObservationClients({
      sessionId: 'kfc:customer-1',
      pinned,
      fetchCurrent: async () => drifted,
      cart: providerCart,
      oms: providerOms,
    });

    await expect(clients.menu.getItemDetails('41160')).resolves.toMatchObject({
      ok: true,
      value: { code: '41160', priceVnd: 5_000 },
    });
    await expect(clients.menu.getItemDetails('20751')).resolves.toMatchObject({
      ok: false,
      errorCode: 'item_not_found',
    });
    await expect(clients.menu.getModifierOptions('41172')).resolves.toMatchObject({
      ok: true,
      value: {
        provenance: {
          sourceFile: 'https://catalog.example/menu',
          fixtureMode: 'current_api',
        },
      },
    });
    await expect(clients.cart.updateCart(cart, '41160', 2)).resolves.toMatchObject({
      ok: false,
      errorCode: 'catalog_observation_stale',
    });
    await expect(clients.oms.previewOrder({ cart, address: { label: 'home', line1: '1 Main', district: 'D1', city: 'HCM' }, storeId: 'store-1' })).resolves.toMatchObject({
      ok: false,
      errorCode: 'catalog_observation_stale',
    });
    expect(updateCart).not.toHaveBeenCalled();
    expect(previewOrder).not.toHaveBeenCalled();
  });
});
