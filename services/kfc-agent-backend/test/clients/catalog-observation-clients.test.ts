import { describe, expect, it, vi } from 'vitest';
import catalogPayload from '../../fixtures/catalog-baselines/kfcvn-generic-menu@2026-07-10.raw.json' with { type: 'json' };
import { fetchCatalogObservation } from '../../src/catalog/catalogObservation.js';
import type {
  CartClient,
  ExternalCallContext,
  OmsClient,
} from '../../src/clients/interfaces.js';
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

const externalCallContext: ExternalCallContext = {
  signal: new AbortController().signal,
  deadlineAt: Date.now() + 10_000,
};

describe('catalog observation clients', () => {
  it('preserves provider mutation identity across catalog revalidation', async () => {
    const pinned = await fetchCatalogObservation({
      environment: 'sandbox',
      sourceUrl: 'https://catalog.example/menu',
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify(catalogPayload), {
          headers: { 'cache-control': 'max-age=300' },
        }),
      ),
    });
    const placeOrder = vi.fn<OmsClient['placeOrder']>().mockResolvedValue({
      ok: true,
      value: order,
      message: 'placed',
    });
    const cancelOrder = vi.fn<OmsClient['cancelOrder']>().mockResolvedValue({
      ok: true,
      value: { ...order, status: 'cancelled' },
      message: 'cancelled',
    });
    const unavailableCart = vi.fn().mockRejectedValue(
      new Error('cart method not used'),
    );
    const clients = createCatalogObservationClients({
      sessionId: 'kfc:customer-1',
      pinned,
      fetchCurrent: async () => pinned,
      cart: {
        createCart: unavailableCart,
        applyChanges: unavailableCart,
        updateCart: unavailableCart,
        previewCart: unavailableCart,
      },
      oms: {
        previewOrder: vi.fn(),
        placeOrder,
        getOrderStatus: vi.fn(),
        cancelOrder,
      },
    });
    const identity = {
      idempotencyKey: 'confirmation:request-1:placeOrder:digest',
      bindingFingerprint: 'a'.repeat(64),
    };
    const input = { preview: order, userConfirmed: true };

    await expect(
      clients.oms.placeOrder(input, externalCallContext, identity),
    ).resolves.toMatchObject({ ok: true });
    expect(placeOrder).toHaveBeenCalledWith(
      input,
      externalCallContext,
      identity,
    );
    const cancellationIdentity = {
      idempotencyKey: 'confirmation:request-2:cancelOrder:digest',
      bindingFingerprint: 'b'.repeat(64),
    };
    await expect(
      clients.oms.cancelOrder(
        order.id,
        externalCallContext,
        cancellationIdentity,
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(cancelOrder).toHaveBeenCalledWith(
      order.id,
      externalCallContext,
      cancellationIdentity,
    );
  });

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
      fetchCurrent: async (receivedContext) => {
        expect(receivedContext).toBe(externalCallContext);
        return drifted;
      },
      cart: providerCart,
      oms: providerOms,
    });

    await expect(
      clients.menu.getItemDetails('41160', externalCallContext),
    ).resolves.toMatchObject({
      ok: true,
      value: { code: '41160', categoryId: '20011', priceVnd: 5_000 },
    });
    await expect(
      clients.menu.getItemDetails('20751', externalCallContext),
    ).resolves.toMatchObject({
      ok: false,
      errorCode: 'item_not_found',
    });
    await expect(
      clients.menu.getModifierOptions('41172', externalCallContext),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        provenance: {
          sourceFile: 'https://catalog.example/menu',
          fixtureMode: 'current_api',
        },
      },
    });
    await expect(
      clients.cart.updateCart(
        cart,
        '41160',
        2,
        undefined,
        externalCallContext,
      ),
    ).resolves.toMatchObject({
      ok: false,
      errorCode: 'catalog_observation_stale',
    });
    await expect(clients.oms.previewOrder(
      {
        cart,
        address: {
          label: 'home',
          line1: '1 Main',
          district: 'D1',
          city: 'HCM',
        },
        storeId: 'store-1',
      },
      externalCallContext,
    )).resolves.toMatchObject({
      ok: false,
      errorCode: 'catalog_observation_stale',
    });
    expect(updateCart).not.toHaveBeenCalled();
    expect(previewOrder).not.toHaveBeenCalled();
  });

  it('passes the exact caller signal to the catalog fetch boundary', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(catalogPayload), {
        headers: { 'cache-control': 'max-age=300' },
      }),
    );

    await fetchCatalogObservation({
      environment: 'sandbox',
      sourceUrl: 'https://catalog.example/menu',
      fetchImpl,
      externalCallContext: {
        signal: controller.signal,
        deadlineAt: Date.now() + 10_000,
      },
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://catalog.example/menu',
      {
        headers: { accept: 'application/json' },
        signal: controller.signal,
      },
    );
  });
});
