import { describe, expect, it } from 'vitest';
import {
  AUTOMATIC_FEATURE_KEYS,
  AUTOMATIC_FEATURE_SCHEMA_DIGEST,
  AUTOMATIC_FEATURE_SCHEMA_VERSION,
  buildAutomaticRecommendationFeatureRows,
  discoverAutomaticRecommendationCandidates,
  evaluateAutomaticRecommendationEligibility,
  parseAutomaticRecommendationFeatureVector,
  resolveAutomaticRecommendationContext,
  type AutomaticCatalogSnapshot,
  type AutomaticRecommendationContext,
  type AutomaticRecommendationContextPorts,
} from '../../src/recommendations/automatic-core/index.js';

const catalog: AutomaticCatalogSnapshot = {
  catalogRevision: 'catalog-revision-eligibility-001',
  resolvedAt: '2026-08-04T05:00:00.000Z',
  timeZone: 'Asia/Ho_Chi_Minh',
  items: [
    {
      sellableItemId: 'parent-1',
      name: 'Chicken Meal',
      imageUrl: null,
      categoryId: 'meal',
      unitPriceVnd: 80000,
      sellable: true,
      safe: true,
      availableFulfilmentModes: ['pickup'],
      promotionActive: false,
      discountAmountVnd: 0,
      localDemandCount: 25,
      basketAssociationCount: 2,
      basketComplementarityScore: 0.5,
      modifierGroups: [
        {
          groupPath: ['meal', 'side'],
          selectionMode: 'single',
          options: [
            {
              optionId: 'fries-large',
              name: 'Large Fries',
              imageUrl: null,
              priceImpactVnd: 15000,
              available: true,
              safe: true,
            },
            {
              optionId: 'unsafe-side',
              name: 'Unsafe Side',
              imageUrl: null,
              priceImpactVnd: 5000,
              available: true,
              safe: false,
            },
          ],
        },
      ],
    },
    {
      sellableItemId: 'eligible-1',
      name: 'Eligible Side',
      imageUrl: null,
      categoryId: 'side',
      unitPriceVnd: 30000,
      sellable: true,
      safe: true,
      availableFulfilmentModes: ['pickup'],
      promotionActive: true,
      discountAmountVnd: 5000,
      localDemandCount: 42,
      basketAssociationCount: 8,
      basketComplementarityScore: 0.8,
      modifierGroups: [],
    },
    {
      sellableItemId: 'delivery-only-1',
      name: 'Delivery Only',
      imageUrl: null,
      categoryId: 'drink',
      unitPriceVnd: 20000,
      sellable: true,
      safe: true,
      availableFulfilmentModes: ['delivery'],
      promotionActive: false,
      discountAmountVnd: 0,
      localDemandCount: 30,
      basketAssociationCount: 5,
      basketComplementarityScore: 0.7,
      modifierGroups: [],
    },
    {
      sellableItemId: 'unsafe-1',
      name: 'Unsafe Product',
      imageUrl: null,
      categoryId: 'side',
      unitPriceVnd: 10000,
      sellable: true,
      safe: false,
      availableFulfilmentModes: ['pickup'],
      promotionActive: false,
      discountAmountVnd: 0,
      localDemandCount: null,
      basketAssociationCount: null,
      basketComplementarityScore: null,
      modifierGroups: [],
    },
    {
      sellableItemId: 'retired-1',
      name: 'Retired Product',
      imageUrl: null,
      categoryId: 'side',
      unitPriceVnd: 10000,
      sellable: false,
      safe: true,
      availableFulfilmentModes: ['pickup'],
      promotionActive: false,
      discountAmountVnd: 0,
      localDemandCount: null,
      basketAssociationCount: null,
      basketComplementarityScore: null,
      modifierGroups: [],
    },
  ],
};

const commonRequest = {
  schemaVersion: 'kfc-automatic-recommendation-v1' as const,
  requestId: 'request-eligibility-001',
  storeId: 'KFCVN0002',
  fulfilmentMode: 'pickup' as const,
  locale: 'vi-VN',
  orderingJourneyRef: 'journey-eligibility-001',
  opportunityRef: 'opportunity-eligibility-001',
  cart: {
    cartId: 'cart-eligibility-001',
    revision: 'cart-revision-eligibility-001',
    subtotal: { amount: 80000, currency: 'VND' as const },
    lines: [
      {
        lineId: 'line-parent-1',
        sellableItemId: 'parent-1',
        quantity: 1,
        unitPrice: { amount: 80000, currency: 'VND' as const },
        modifiers: [],
      },
    ],
  },
};

const ports: AutomaticRecommendationContextPorts = {
  orderContext: {
    readSnapshot: async ({ orderingJourneyRef, opportunityRef }) => ({
      orderingJourneyRef,
      opportunityRef,
      storeId: commonRequest.storeId,
      fulfilmentMode: commonRequest.fulfilmentMode,
      locale: commonRequest.locale,
      cart: commonRequest.cart,
      remainingBudgetVnd: 120000,
      parentCartLineId: 'line-parent-1',
      verifiedCustomerRef: 'customer-001',
    }),
  },
  catalog: { readSnapshot: async () => catalog },
  history: {
    readCompletedHistory: async (verifiedCustomerRef) => ({
      verifiedCustomerRef,
      historyRevision: 'history-revision-001',
      completedOrderCount: 3,
      lastCompletedOrderAt: '2026-08-01T05:15:00.000Z',
      itemOrderCounts: { 'eligible-1': 2 },
      categoryOrderCounts: { side: 2 },
    }),
  },
  exposure: { readState: async () => 'enabled' },
  clock: { now: () => new Date('2026-08-04T05:15:00.000Z') },
};

async function readyContext(
  recommendationType:
    'for_you' | 'local_favorite' | 'modifier_upsell' | 'smart_cross_sell',
): Promise<AutomaticRecommendationContext> {
  const request =
    recommendationType === 'for_you'
      ? { ...commonRequest, verifiedCustomerRef: 'customer-001' }
      : recommendationType === 'modifier_upsell'
        ? { ...commonRequest, parentCartLineId: 'line-parent-1' }
        : commonRequest;
  const resolved = await resolveAutomaticRecommendationContext({
    recommendationType,
    request,
    ports,
  });
  if (resolved.kind !== 'ready') {
    throw new Error('Expected ready context');
  }
  return resolved.context;
}

describe('automatic recommendation Eligibility Policy', () => {
  it('returns typed evidence for every product exclusion and keeps only valid candidates eligible', async () => {
    const context = await readyContext('smart_cross_sell');
    const decisions = evaluateAutomaticRecommendationEligibility(
      context,
      discoverAutomaticRecommendationCandidates(context),
    );

    expect(
      decisions.map(({ candidate, status, evidence }) => ({
        candidateId: candidate.candidateId,
        status,
        code: evidence.code,
      })),
    ).toEqual([
      {
        candidateId: 'product:parent-1',
        status: 'excluded',
        code: 'already_in_cart',
      },
      {
        candidateId: 'product:eligible-1',
        status: 'eligible',
        code: 'eligible',
      },
      {
        candidateId: 'product:delivery-only-1',
        status: 'excluded',
        code: 'unavailable_for_fulfilment',
      },
      {
        candidateId: 'product:unsafe-1',
        status: 'excluded',
        code: 'unsafe_candidate',
      },
      {
        candidateId: 'product:retired-1',
        status: 'excluded',
        code: 'not_sellable',
      },
    ]);
  });

  it('rejects an unavailable modifier and any candidate whose exact parent, path, or option binding is changed', async () => {
    const context = await readyContext('modifier_upsell');
    const candidates = discoverAutomaticRecommendationCandidates(context);
    const valid = candidates[0];
    if (valid === undefined || valid.action.type !== 'apply_modifier') {
      throw new Error('Expected modifier candidate');
    }
    const tampered = {
      ...valid,
      candidateId: 'modifier:line-parent-1:wrong/path:fries-large',
      action: { ...valid.action, groupPath: ['wrong', 'path'] },
    };

    expect(
      evaluateAutomaticRecommendationEligibility(context, [
        ...candidates,
        tampered,
      ]).map(({ candidate, status, evidence }) => ({
        candidateId: candidate.candidateId,
        status,
        code: evidence.code,
      })),
    ).toEqual([
      {
        candidateId: 'modifier:line-parent-1:meal/side:fries-large',
        status: 'eligible',
        code: 'eligible',
      },
      {
        candidateId: 'modifier:line-parent-1:meal/side:unsafe-side',
        status: 'excluded',
        code: 'unsafe_candidate',
      },
      {
        candidateId: 'modifier:line-parent-1:wrong/path:fries-large',
        status: 'excluded',
        code: 'modifier_path_mismatch',
      },
    ]);
  });

  it('recomputes validity from the catalog so copied flags and unknown identities cannot bypass policy', async () => {
    const context = await readyContext('smart_cross_sell');
    const candidates = discoverAutomaticRecommendationCandidates(context);
    const deliveryOnly = candidates.find(
      ({ candidateId }) => candidateId === 'product:delivery-only-1',
    );
    const eligible = candidates.find(
      ({ candidateId }) => candidateId === 'product:eligible-1',
    );
    if (
      deliveryOnly === undefined ||
      eligible === undefined ||
      eligible.action.type !== 'add_product'
    ) {
      throw new Error('Expected product fixtures');
    }

    const spoofedAvailability = { ...deliveryOnly, available: true };
    const unknownIdentity = {
      ...eligible,
      candidateId: 'product:unknown-1',
      action: { ...eligible.action, sellableItemId: 'unknown-1' },
    };

    expect(
      evaluateAutomaticRecommendationEligibility(context, [
        spoofedAvailability,
        unknownIdentity,
      ]).map(({ evidence }) => evidence.code),
    ).toEqual(['unavailable_for_fulfilment', 'candidate_not_in_catalog']);
  });

  it('uses exact nested group semantics to exclude applied modifiers and single-select alternatives', async () => {
    const context = await readyContext('modifier_upsell');
    const parentLine = context.parentCartLine;
    if (parentLine === null) {
      throw new Error('Expected trusted modifier parent');
    }
    const nestedCatalog = {
      ...context.catalog,
      items: context.catalog.items.map((item) =>
        item.sellableItemId !== 'parent-1'
          ? item
          : {
              ...item,
              modifierGroups: [
                {
                  groupPath: ['meal', 'nested', 'side'],
                  selectionMode: 'single' as const,
                  options: [
                    {
                      optionId: 'fries-large',
                      name: 'Large Fries',
                      imageUrl: null,
                      priceImpactVnd: 15000,
                      available: true,
                      safe: true,
                    },
                    {
                      optionId: 'salad',
                      name: 'Salad',
                      imageUrl: null,
                      priceImpactVnd: 12000,
                      available: true,
                      safe: true,
                    },
                  ],
                },
                {
                  groupPath: ['meal', 'nested', 'extras'],
                  selectionMode: 'multiple' as const,
                  options: [
                    {
                      optionId: 'cheese',
                      name: 'Cheese',
                      imageUrl: null,
                      priceImpactVnd: 5000,
                      available: true,
                      safe: true,
                    },
                    {
                      optionId: 'bacon',
                      name: 'Bacon',
                      imageUrl: null,
                      priceImpactVnd: 7000,
                      available: true,
                      safe: true,
                    },
                  ],
                },
              ],
            },
      ),
    };
    const trustedParentLine = {
      ...parentLine,
      modifiers: [
        {
          groupPath: ['meal', 'nested', 'side'],
          optionId: 'fries-large',
          quantity: 1,
          priceImpact: { amount: 15000, currency: 'VND' as const },
        },
        {
          groupPath: ['meal', 'nested', 'extras'],
          optionId: 'cheese',
          quantity: 1,
          priceImpact: { amount: 5000, currency: 'VND' as const },
        },
      ],
    };
    const trustedContext = {
      ...context,
      catalog: nestedCatalog,
      parentCartLine: trustedParentLine,
      order: {
        ...context.order,
        cart: { ...context.order.cart, lines: [trustedParentLine] },
      },
    };

    expect(
      evaluateAutomaticRecommendationEligibility(
        trustedContext,
        discoverAutomaticRecommendationCandidates(trustedContext),
      ).map(({ candidate, evidence }) => ({
        candidateId: candidate.candidateId,
        code: evidence.code,
      })),
    ).toEqual([
      {
        candidateId: 'modifier:line-parent-1:meal/nested/side:fries-large',
        code: 'modifier_already_applied',
      },
      {
        candidateId: 'modifier:line-parent-1:meal/nested/side:salad',
        code: 'modifier_group_satisfied',
      },
      {
        candidateId: 'modifier:line-parent-1:meal/nested/extras:cheese',
        code: 'modifier_already_applied',
      },
      {
        candidateId: 'modifier:line-parent-1:meal/nested/extras:bacon',
        code: 'eligible',
      },
    ]);
  });
});

describe('automatic recommendation versioned feature construction', () => {
  it('constructs scorer rows only for eligible candidates with scalar pre-decision features', async () => {
    const context = await readyContext('for_you');
    const decisions = evaluateAutomaticRecommendationEligibility(
      context,
      discoverAutomaticRecommendationCandidates(context),
    );

    expect(AUTOMATIC_FEATURE_SCHEMA_VERSION).toBe('automatic-feature-v1');
    expect(AUTOMATIC_FEATURE_SCHEMA_DIGEST).toBe(
      '35b710d0b73e7419038e83bc9c39f93feb38564d793726cd47021fa2dbc8421b',
    );
    const rows = buildAutomaticRecommendationFeatureRows(context, decisions);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      candidateId: 'product:eligible-1',
      eligibility: 'eligible',
      priceImpactVnd: 30000,
      features: {
        featureSchemaVersion: 'automatic-feature-v1',
        recommendationType: 'for_you',
        storeId: 'KFCVN0002',
        fulfilmentMode: 'pickup',
        locale: 'vi-VN',
        localHour: 12,
        daypart: 'lunch',
        catalogRevision: 'catalog-revision-eligibility-001',
        cartSubtotalVnd: 80000,
        cartLineCount: 1,
        cartDistinctCategoryCount: 1,
        candidateSellableItemId: 'eligible-1',
        candidateModifierOptionId: null,
        candidateCategoryId: 'side',
        candidatePriceImpactVnd: 30000,
        candidateUnitPriceVnd: 30000,
        candidateDiscountAmountVnd: 5000,
        candidateDiscountActive: true,
        promotionActive: true,
        completedOrderCount: 3,
        priorItemOrderCount: 2,
        priorCategoryOrderCount: 2,
        historyRecencyDays: 3,
        localDemandCount: null,
        modifierParentCartLineId: null,
        modifierParentSellableItemId: null,
        modifierGroupPath: null,
        modifierSelectionMode: null,
        modifierOptionAvailable: null,
        modifierOptionSafe: null,
        modifierPriceRatio: null,
        remainingBudgetVnd: null,
        basketAssociationCount: null,
        basketComplementarityScore: null,
        basketRedundancyCount: null,
        basketCategoryDiversityCount: null,
      },
    });
    expect(Object.keys(rows[0]?.features ?? {})).toEqual(
      AUTOMATIC_FEATURE_KEYS,
    );
  });

  it('includes the exact modifier parent and group path without nested feature values', async () => {
    const context = await readyContext('modifier_upsell');
    const decisions = evaluateAutomaticRecommendationEligibility(
      context,
      discoverAutomaticRecommendationCandidates(context),
    );
    const rows = buildAutomaticRecommendationFeatureRows(context, decisions);

    expect(rows[0]).toMatchObject({
      features: {
        modifierParentSellableItemId: 'parent-1',
        modifierGroupPath: 'meal/side',
        modifierPriceRatio: 0.1875,
      },
    });
    expect(
      Object.values(rows[0]?.features ?? {}).every(
        (value) =>
          value === null ||
          ['string', 'number', 'boolean'].includes(typeof value),
      ),
    ).toBe(true);
  });

  it('rejects missing, extra, post-decision, nested, and type-inapplicable feature fields', async () => {
    const context = await readyContext('for_you');
    const rows = buildAutomaticRecommendationFeatureRows(
      context,
      evaluateAutomaticRecommendationEligibility(
        context,
        discoverAutomaticRecommendationCandidates(context),
      ),
    );
    const valid = rows[0]?.features;
    if (valid === undefined) {
      throw new Error('Expected feature vector');
    }
    const { storeId: _missingStore, ...missing } = valid;

    expect(() =>
      parseAutomaticRecommendationFeatureVector(valid),
    ).not.toThrow();
    expect(() => parseAutomaticRecommendationFeatureVector(missing)).toThrow();
    expect(() =>
      parseAutomaticRecommendationFeatureVector({ ...valid, extra: 1 }),
    ).toThrow();
    expect(() =>
      parseAutomaticRecommendationFeatureVector({
        ...valid,
        selectedAfterDisplay: true,
      }),
    ).toThrow();
    expect(() =>
      parseAutomaticRecommendationFeatureVector({
        ...valid,
        storeId: { nested: 'forbidden' },
      }),
    ).toThrow();
    expect(() =>
      parseAutomaticRecommendationFeatureVector({
        ...valid,
        modifierGroupPath: 'meal/side',
      }),
    ).toThrow();
  });
});
