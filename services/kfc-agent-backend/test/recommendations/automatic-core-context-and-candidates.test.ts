import { describe, expect, it } from 'vitest';
import {
  discoverAutomaticRecommendationCandidates,
  resolveAutomaticRecommendationContext,
  type AutomaticCatalogSnapshot,
  type AutomaticRecommendationContextPorts,
} from '../../src/recommendations/automatic-core/index.js';

const catalog: AutomaticCatalogSnapshot = {
  catalogRevision: 'catalog-revision-001',
  resolvedAt: '2026-08-04T05:00:00.000Z',
  timeZone: 'Asia/Ho_Chi_Minh',
  items: [
    {
      sellableItemId: 'chicken-1',
      name: 'Original Chicken',
      imageUrl: 'https://example.test/chicken-1.png',
      categoryId: 'chicken',
      unitPriceVnd: 45000,
      sellable: true,
      safe: true,
      availableFulfilmentModes: ['pickup', 'delivery'],
      promotionActive: false,
      modifierGroups: [
        {
          groupPath: ['meal', 'drink'],
          options: [
            {
              optionId: 'pepsi-medium',
              name: 'Pepsi Medium',
              imageUrl: null,
              priceImpactVnd: 10000,
              available: true,
              safe: true,
            },
            {
              optionId: 'seven-up-medium',
              name: '7Up Medium',
              imageUrl: null,
              priceImpactVnd: 10000,
              available: false,
              safe: true,
            },
          ],
        },
      ],
    },
    {
      sellableItemId: 'fries-1',
      name: 'Fries',
      imageUrl: 'https://example.test/fries-1.png',
      categoryId: 'side',
      unitPriceVnd: 25000,
      sellable: true,
      safe: true,
      availableFulfilmentModes: ['pickup', 'delivery'],
      promotionActive: true,
      modifierGroups: [],
    },
    {
      sellableItemId: 'drink-1',
      name: 'Pepsi',
      imageUrl: null,
      categoryId: 'drink',
      unitPriceVnd: 20000,
      sellable: true,
      safe: true,
      availableFulfilmentModes: ['delivery'],
      promotionActive: false,
      modifierGroups: [],
    },
    {
      sellableItemId: 'retired-1',
      name: 'Retired Product',
      imageUrl: null,
      categoryId: 'retired',
      unitPriceVnd: 1000,
      sellable: false,
      safe: true,
      availableFulfilmentModes: [],
      promotionActive: false,
      modifierGroups: [],
    },
  ],
};

const commonRequest = {
  schemaVersion: 'kfc-automatic-recommendation-v1' as const,
  requestId: 'request-001',
  storeId: 'KFCVN0002',
  fulfilmentMode: 'pickup' as const,
  locale: 'vi-VN',
  orderingJourneyRef: 'journey-001',
  opportunityRef: 'opportunity-001',
  cart: {
    cartId: 'cart-001',
    revision: 'cart-revision-001',
    subtotal: { amount: 45000, currency: 'VND' as const },
    lines: [
      {
        lineId: 'line-chicken-1',
        sellableItemId: 'chicken-1',
        quantity: 1,
        unitPrice: { amount: 45000, currency: 'VND' as const },
        modifiers: [],
      },
    ],
  },
};

function ports({
  paused = false,
  completedOrderCount = 2,
}: {
  paused?: boolean;
  completedOrderCount?: number;
} = {}): AutomaticRecommendationContextPorts {
  return {
    catalog: {
      readSnapshot: async () => catalog,
    },
    history: {
      readCompletedHistory: async (verifiedCustomerRef) =>
        completedOrderCount === 0
          ? null
          : {
              verifiedCustomerRef,
              historyRevision: 'history-revision-001',
              completedOrderCount,
              itemOrderCounts: { 'chicken-1': 2 },
              categoryOrderCounts: { chicken: 2 },
            },
    },
    exposure: {
      readState: async () => (paused ? 'paused' : 'enabled'),
    },
    clock: {
      now: () => new Date('2026-08-04T05:15:00.000Z'),
    },
  };
}

describe('automatic recommendation trusted context', () => {
  it('resolves only server-owned catalog, history, time, and exposure snapshots', async () => {
    const resolved = await resolveAutomaticRecommendationContext({
      recommendationType: 'for_you',
      request: {
        ...commonRequest,
        verifiedCustomerRef: 'customer-001',
      },
      ports: ports(),
    });

    expect(resolved).toMatchObject({
      kind: 'ready',
      context: {
        decisionTime: '2026-08-04T05:15:00.000Z',
        catalog: { catalogRevision: 'catalog-revision-001' },
        history: {
          verifiedCustomerRef: 'customer-001',
          completedOrderCount: 2,
        },
      },
    });
  });

  it.each([
    {
      recommendationType: 'for_you' as const,
      request: { ...commonRequest, verifiedCustomerRef: 'customer-001' },
      contextPorts: ports({ completedOrderCount: 0 }),
      expectedKind: 'empty',
      expectedReason: 'insufficient_history',
    },
    {
      recommendationType: 'modifier_upsell' as const,
      request: { ...commonRequest, parentCartLineId: 'missing-line' },
      contextPorts: ports(),
      expectedKind: 'empty',
      expectedReason: 'parent_cart_line_not_found',
    },
    {
      recommendationType: 'smart_cross_sell' as const,
      request: {
        ...commonRequest,
        cart: {
          ...commonRequest.cart,
          subtotal: { amount: 0, currency: 'VND' as const },
          lines: [],
        },
      },
      contextPorts: ports(),
      expectedKind: 'empty',
      expectedReason: 'empty_cart',
    },
    {
      recommendationType: 'local_favorite' as const,
      request: commonRequest,
      contextPorts: ports({ paused: true }),
      expectedKind: 'paused',
      expectedReason: 'recommendation_serving_paused',
    },
  ])(
    'returns typed $expectedKind for $expectedReason',
    async ({
      recommendationType,
      request,
      contextPorts,
      expectedKind,
      expectedReason,
    }) => {
      const resolved = await resolveAutomaticRecommendationContext({
        recommendationType,
        request,
        ports: contextPorts,
      });

      expect(resolved).toMatchObject({
        kind: expectedKind,
        reason: expectedReason,
      });
    },
  );
});

describe('automatic recommendation candidate discovery', () => {
  it.each([
    [
      'local_favorite',
      [
        'product:chicken-1',
        'product:fries-1',
        'product:drink-1',
        'product:retired-1',
      ],
    ],
    [
      'for_you',
      [
        'product:chicken-1',
        'product:fries-1',
        'product:drink-1',
        'product:retired-1',
      ],
    ],
    [
      'smart_cross_sell',
      [
        'product:chicken-1',
        'product:fries-1',
        'product:drink-1',
        'product:retired-1',
      ],
    ],
  ] as const)(
    'enumerates every catalog candidate for %s before eligibility',
    async (recommendationType, expectedIds) => {
      const request =
        recommendationType === 'for_you'
          ? { ...commonRequest, verifiedCustomerRef: 'customer-001' }
          : commonRequest;
      const resolved = await resolveAutomaticRecommendationContext({
        recommendationType,
        request,
        ports: ports(),
      });
      if (resolved.kind !== 'ready') {
        throw new Error('Expected ready context');
      }

      expect(
        discoverAutomaticRecommendationCandidates(resolved.context).map(
          ({ candidateId }) => candidateId,
        ),
      ).toEqual(expectedIds);
    },
  );

  it('enumerates only exact modifier options owned by the requested parent line', async () => {
    const resolved = await resolveAutomaticRecommendationContext({
      recommendationType: 'modifier_upsell',
      request: { ...commonRequest, parentCartLineId: 'line-chicken-1' },
      ports: ports(),
    });
    if (resolved.kind !== 'ready') {
      throw new Error('Expected ready context');
    }

    expect(
      discoverAutomaticRecommendationCandidates(resolved.context),
    ).toMatchObject([
      {
        candidateId: 'modifier:line-chicken-1:meal/drink:pepsi-medium',
        action: {
          type: 'apply_modifier',
          parentCartLineId: 'line-chicken-1',
          parentSellableItemId: 'chicken-1',
          groupPath: ['meal', 'drink'],
          optionId: 'pepsi-medium',
        },
      },
      {
        candidateId: 'modifier:line-chicken-1:meal/drink:seven-up-medium',
        action: {
          type: 'apply_modifier',
          parentCartLineId: 'line-chicken-1',
          parentSellableItemId: 'chicken-1',
          groupPath: ['meal', 'drink'],
          optionId: 'seven-up-medium',
        },
      },
    ]);
  });
});
