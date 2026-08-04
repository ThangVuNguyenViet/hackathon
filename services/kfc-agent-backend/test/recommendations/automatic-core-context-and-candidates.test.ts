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
      discountAmountVnd: 0,
      localDemandCount: 100,
      basketAssociationCount: 8,
      basketComplementarityScore: 0.5,
      sellable: true,
      safe: true,
      availableFulfilmentModes: ['pickup', 'delivery'],
      promotionActive: false,
      modifierGroups: [
        {
          groupPath: ['meal', 'drink'],
          selectionMode: 'single',
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
      discountAmountVnd: 5000,
      localDemandCount: 90,
      basketAssociationCount: 12,
      basketComplementarityScore: 0.9,
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
      discountAmountVnd: 0,
      localDemandCount: 70,
      basketAssociationCount: 5,
      basketComplementarityScore: 0.7,
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
      discountAmountVnd: 0,
      localDemandCount: null,
      basketAssociationCount: null,
      basketComplementarityScore: null,
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
  trustedParentCartLineId = 'line-chicken-1',
  trustedCustomerRef = 'customer-001',
  trustedCart = commonRequest.cart,
}: {
  paused?: boolean;
  completedOrderCount?: number;
  trustedParentCartLineId?: string | null;
  trustedCustomerRef?: string | null;
  trustedCart?: typeof commonRequest.cart;
} = {}): AutomaticRecommendationContextPorts {
  return {
    orderContext: {
      readSnapshot: async () => ({
        orderingJourneyRef: commonRequest.orderingJourneyRef,
        opportunityRef: commonRequest.opportunityRef,
        storeId: commonRequest.storeId,
        fulfilmentMode: commonRequest.fulfilmentMode,
        locale: commonRequest.locale,
        cart: trustedCart,
        parentCartLineId: trustedParentCartLineId,
        verifiedCustomerRef: trustedCustomerRef,
        remainingBudgetVnd: 100000,
      }),
    },
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
              lastCompletedOrderAt: '2026-08-01T05:15:00.000Z',
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
      contextPorts: ports({ trustedParentCartLineId: 'missing-line' }),
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
      contextPorts: ports({
        trustedCart: {
          ...commonRequest.cart,
          subtotal: { amount: 0, currency: 'VND' as const },
          lines: [],
        },
      }),
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

  it.each([
    {
      label: 'store',
      recommendationType: 'local_favorite' as const,
      request: { ...commonRequest, storeId: 'SPOOFED-STORE' },
      contextPorts: ports(),
    },
    {
      label: 'fulfilment',
      recommendationType: 'local_favorite' as const,
      request: { ...commonRequest, fulfilmentMode: 'delivery' as const },
      contextPorts: ports(),
    },
    {
      label: 'cart contents',
      recommendationType: 'local_favorite' as const,
      request: {
        ...commonRequest,
        cart: {
          ...commonRequest.cart,
          subtotal: { amount: 0, currency: 'VND' as const },
          lines: [],
        },
      },
      contextPorts: ports(),
    },
    {
      label: 'subtotal',
      recommendationType: 'local_favorite' as const,
      request: {
        ...commonRequest,
        cart: {
          ...commonRequest.cart,
          subtotal: { amount: 1, currency: 'VND' as const },
        },
      },
      contextPorts: ports(),
    },
    {
      label: 'modifier parent',
      recommendationType: 'modifier_upsell' as const,
      request: { ...commonRequest, parentCartLineId: 'spoofed-line' },
      contextPorts: ports(),
    },
    {
      label: 'history authority',
      recommendationType: 'for_you' as const,
      request: { ...commonRequest, verifiedCustomerRef: 'spoofed-customer' },
      contextPorts: ports(),
    },
  ])(
    'rejects spoofed $label binding before trusted context can affect candidates',
    async ({ recommendationType, request, contextPorts }) => {
      await expect(
        resolveAutomaticRecommendationContext({
          recommendationType,
          request,
          ports: contextPorts,
        }),
      ).rejects.toMatchObject({
        status: 409,
        code: 'identity_conflict',
        retryable: false,
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
