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
import type { AutomaticRecommendationHttpRuntime } from '../../src/recommendations/serving/http-runtime.js';

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
  it('fails closed instead of using the legacy chat ranking without a release client', async () => {
    const pinned = await fetchCatalogObservation({
      environment: 'sandbox',
      sourceUrl: 'https://catalog.example/menu',
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify(catalogPayload), {
          headers: { 'cache-control': 'max-age=300' },
        }),
      ),
    });
    const clients = createCatalogObservationClients({
      sessionId: 'kfc:customer-1',
      pinned,
      fetchCurrent: async () => pinned,
      cart: {
        createCart: vi.fn(),
        applyChanges: vi.fn(),
        updateCart: vi.fn(),
        previewCart: vi.fn(),
      },
      oms: {
        previewOrder: vi.fn(),
        placeOrder: vi.fn(),
        getOrderStatus: vi.fn(),
        cancelOrder: vi.fn(),
      },
    });

    await expect(
      clients.recommendation.recommendAddOns(cart, externalCallContext),
    ).resolves.toMatchObject({
      ok: false,
      errorCode: 'recommendation_runtime_unavailable',
    });
  });

  it('adapts the shared release response and persists a chat journey before mutation', async () => {
    const pinned = await fetchCatalogObservation({
      environment: 'sandbox',
      sourceUrl: 'https://catalog.example/menu',
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify(catalogPayload), {
          headers: { 'cache-control': 'max-age=300' },
        }),
      ),
    });
    const providerApplyChanges = vi.fn<CartClient['applyChanges']>().mockResolvedValue({
      ok: true,
      value: cart,
      message: 'updated',
    });
    const decide = vi.fn(
      async (
        _type: 'smart_cross_sell',
        request: { requestId: string; cart: { revision: string } },
      ) => {
        return {
          schemaVersion: 'kfc-automatic-recommendation-v1',
          requestId: request.requestId,
          recommendationId: 'rec:chat:1',
          recommendationType: 'smart_cross_sell',
          status: 'recommended',
          emptyReason: null,
          cartRevision: request.cart.revision,
          catalogRevision: pinned.id,
          expiresAt: '2026-08-08T10:00:00.000+00:00',
          model: {
            bundleId: 'bundle-1',
            bundleDigest: 'a'.repeat(64),
            modelRevision: 'model-1',
            calibratorRevision: 'calibrator-1',
            featureSchemaDigest: 'b'.repeat(64),
            thresholdRevision: 'threshold-1',
            composerContractDigest: 'c'.repeat(64),
            qualificationRunId: 'run-1',
            qualificationEvidenceDigest: 'd'.repeat(64),
          },
          proposals: [
            {
              actionId: 'action:41172',
              action: {
                type: 'add_product',
                sellableItemId: '41172',
                quantity: 1,
                priceImpact: { amount: 159000, currency: 'VND' },
              },
              display: {
                name: 'XoZonZa5CO_159',
                imageUrl: null,
                priceImpact: { amount: 159000, currency: 'VND' },
              },
              reasonCodes: ['completes_your_meal'],
            },
          ],
          counts: { potential: 1, eligible: 1, scored: 1, displayed: 1 },
        };
      },
    );
    const recordImpression = vi.fn<AutomaticRecommendationHttpRuntime['recordImpression']>()
      .mockResolvedValue(undefined);
    const record = vi.fn().mockResolvedValue(undefined);
    const revalidateCartChange = vi.fn().mockResolvedValue({
      ok: true,
      value: true,
      message: 'revalidated',
    });
    const providerCart: CartClient = {
      createCart: vi.fn(),
      applyChanges: providerApplyChanges,
      updateCart: vi.fn(),
      previewCart: vi.fn(),
    };
    const clients = createCatalogObservationClients({
      sessionId: 'kfc:customer-1',
      pinned,
      fetchCurrent: async () => pinned,
      cart: providerCart,
      oms: {
        previewOrder: vi.fn(),
        placeOrder: vi.fn(),
        getOrderStatus: vi.fn(),
        cancelOrder: vi.fn(),
      },
      now: () => new Date('2026-08-08T09:00:00.000Z'),
      automaticRecommendations: {
        decide,
        recordImpression,
        recordOutcome: vi.fn(),
        inspect: vi.fn(),
        readiness: async () => ({ ok: true }),
        close: async () => undefined,
      },
      recommendationContext: {
        storeId: 'store-1',
        fulfilmentMode: 'pickup',
        locale: 'vi-VN',
        orderingJourneyRef: 'journey:1',
        opportunityRef: 'opportunity:1',
      },
      recommendationJourney: { record, revalidateCartChange },
    });

    await expect(
      clients.recommendation.recommendAddOns(cart, externalCallContext),
    ).resolves.toMatchObject({
      ok: true,
      value: [{ code: '41172', priceVnd: 159000 }],
    });
    expect(decide).toHaveBeenCalledWith('smart_cross_sell', expect.objectContaining({
      storeId: 'store-1',
      fulfilmentMode: 'pickup',
      orderingJourneyRef: 'journey:1',
      opportunityRef: 'opportunity:1',
    }));
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      recommendationId: 'rec:chat:1',
      channel: 'chat',
      candidateActions: [{
        actionId: 'action:41172',
        itemCode: '41172',
        renderedPosition: 1,
      }],
    }));
    expect(recordImpression).toHaveBeenCalledWith(
      'rec:chat:1',
      expect.objectContaining({
        channel: 'chat',
        orderingJourneyRef: 'journey:1',
        opportunityRef: 'opportunity:1',
      }),
    );

    await clients.cart.applyChanges(
      cart,
      [{ itemCode: '41172', quantity: 1 }],
      externalCallContext,
    );
    expect(revalidateCartChange).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'kfc:customer-1',
      changes: [{ itemCode: '41172', quantity: 1 }],
    }));
    expect(providerApplyChanges).toHaveBeenCalled();
  });
});
