import { describe, expect, it } from 'vitest';
import {
  AUTOMATIC_FEATURE_SCHEMA_DIGEST,
  AutomaticRecommendationInfrastructureError,
  composeAutomaticRecommendationSlate,
  createAutomaticRecommendationEngine,
  resolveQualifiedAutomaticRecommendationBundle,
  type AutomaticCatalogSnapshot,
  type AutomaticQualifiedBundlePort,
  type AutomaticRecommendationContextPorts,
  type AutomaticRecommendationScorerPort,
  type AutomaticTrustedOrderContextSnapshot,
  type AutomaticScoredCandidate,
} from '../../src/recommendations/automatic-core/index.js';

const digest = (character: string) => character.repeat(64);

const catalog: AutomaticCatalogSnapshot = {
  catalogRevision: 'catalog-engine-001',
  resolvedAt: '2026-08-04T05:00:00.000Z',
  timeZone: 'Asia/Ho_Chi_Minh',
  items: [
    {
      sellableItemId: 'side-cheap',
      name: 'Cheap Side',
      imageUrl: null,
      categoryId: 'side',
      unitPriceVnd: 10000,
      discountAmountVnd: 0,
      localDemandCount: 50,
      basketAssociationCount: 5,
      basketComplementarityScore: 0.2,
      sellable: true,
      safe: true,
      availableFulfilmentModes: ['pickup'],
      promotionActive: false,
      modifierGroups: [],
    },
    {
      sellableItemId: 'side-premium',
      name: 'Premium Side',
      imageUrl: null,
      categoryId: 'side',
      unitPriceVnd: 30000,
      discountAmountVnd: 5000,
      localDemandCount: 90,
      basketAssociationCount: 12,
      basketComplementarityScore: 0.8,
      sellable: true,
      safe: true,
      availableFulfilmentModes: ['pickup'],
      promotionActive: true,
      modifierGroups: [],
    },
    {
      sellableItemId: 'drink-1',
      name: 'Drink',
      imageUrl: null,
      categoryId: 'drink',
      unitPriceVnd: 20000,
      discountAmountVnd: 0,
      localDemandCount: 80,
      basketAssociationCount: 8,
      basketComplementarityScore: 0.7,
      sellable: true,
      safe: true,
      availableFulfilmentModes: ['pickup'],
      promotionActive: false,
      modifierGroups: [],
    },
    {
      sellableItemId: 'dessert-1',
      name: 'Dessert',
      imageUrl: null,
      categoryId: 'dessert',
      unitPriceVnd: 15000,
      discountAmountVnd: 0,
      localDemandCount: 70,
      basketAssociationCount: 6,
      basketComplementarityScore: 0.6,
      sellable: true,
      safe: true,
      availableFulfilmentModes: ['pickup'],
      promotionActive: false,
      modifierGroups: [],
    },
    {
      sellableItemId: 'parent-1',
      name: 'Meal',
      imageUrl: null,
      categoryId: 'meal',
      unitPriceVnd: 80000,
      discountAmountVnd: 0,
      localDemandCount: 100,
      basketAssociationCount: 10,
      basketComplementarityScore: 0.9,
      sellable: true,
      safe: true,
      availableFulfilmentModes: ['pickup'],
      promotionActive: false,
      modifierGroups: [
        {
          groupPath: ['meal', 'side'],
          selectionMode: 'single',
          options: [
            {
              optionId: 'large-fries',
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
      ],
    },
  ],
};

const baseRequest = {
  schemaVersion: 'kfc-automatic-recommendation-v1' as const,
  requestId: 'request-engine-001',
  storeId: 'KFCVN0002',
  fulfilmentMode: 'pickup' as const,
  locale: 'vi-VN',
  orderingJourneyRef: 'journey-engine-001',
  opportunityRef: 'opportunity-engine-001',
  cart: {
    cartId: 'cart-engine-001',
    revision: 'cart-revision-engine-001',
    subtotal: { amount: 0, currency: 'VND' as const },
    lines: [],
  },
};

const modelFor = (modelRevision: string, minimumJointProbability = 0.2) => ({
  modelRevision,
  calibratorRevision: `${modelRevision}-calibrator`,
  featureSchemaDigest: AUTOMATIC_FEATURE_SCHEMA_DIGEST,
  thresholdRevision: `${modelRevision}-threshold`,
  minimumJointProbability,
});

const completeBundle = {
  schemaVersion: 'kfc-qualified-automatic-bundle-v1' as const,
  bundleId: 'bundle-engine-001',
  bundleDigest: digest('a'),
  composerContractDigest: digest('c'),
  qualificationRunId: 'qualification-engine-001',
  qualificationEvidenceDigest: digest('d'),
  models: {
    local_favorite: modelFor('local-model'),
    for_you: modelFor('for-you-model'),
    modifier_upsell: modelFor('modifier-model'),
    smart_cross_sell: modelFor('cross-sell-model'),
  },
};

function contextPorts({
  paused = false,
  history = true,
  snapshot = catalog,
  trustedCart = baseRequest.cart,
  trustedParentCartLineId = null,
}: {
  paused?: boolean;
  history?: boolean;
  snapshot?: AutomaticCatalogSnapshot;
  trustedCart?: AutomaticTrustedOrderContextSnapshot['cart'];
  trustedParentCartLineId?: string | null;
} = {}): AutomaticRecommendationContextPorts {
  return {
    orderContext: {
      readSnapshot: async ({ orderingJourneyRef, opportunityRef }) => ({
        orderingJourneyRef,
        opportunityRef,
        storeId: baseRequest.storeId,
        fulfilmentMode: baseRequest.fulfilmentMode,
        locale: baseRequest.locale,
        cart: trustedCart,
        parentCartLineId: trustedParentCartLineId,
        verifiedCustomerRef: 'customer-engine-001',
        remainingBudgetVnd: 100000,
      }),
    },
    catalog: { readSnapshot: async () => snapshot },
    history: {
      readCompletedHistory: async (verifiedCustomerRef) =>
        history
          ? {
              verifiedCustomerRef,
              historyRevision: 'history-engine-001',
              completedOrderCount: 2,
              itemOrderCounts: {},
              categoryOrderCounts: { side: 1 },
              lastCompletedOrderAt: '2026-08-01T05:15:00.000Z',
            }
          : null,
    },
    exposure: {
      readState: async () => (paused ? 'paused' : 'enabled'),
    },
    clock: { now: () => new Date('2026-08-04T05:15:00.000Z') },
  };
}

function bundlePort(
  bundle: unknown = completeBundle,
): AutomaticQualifiedBundlePort {
  return { readQualifiedBundle: async () => bundle };
}

function scorer(
  scoreByCandidate: Readonly<Record<string, [number, number]>>,
): AutomaticRecommendationScorerPort {
  return {
    score: async (request) => ({
      schemaVersion: 'kfc-automatic-scorer-v1',
      requestId: request.requestId,
      model: request.model,
      scores: [...request.candidates].reverse().map(({ candidateId }) => {
        const [selectionProbability, jointProbability] = scoreByCandidate[
          candidateId
        ] ?? [0.4, 0.3];
        return {
          candidateId,
          selectionProbability,
          jointProbability,
          explanationValues: {},
        };
      }),
    }),
  };
}

function engine({
  scorerPort = scorer({}),
  qualifiedBundlePort = bundlePort(),
  ports = contextPorts(),
}: {
  scorerPort?: AutomaticRecommendationScorerPort;
  qualifiedBundlePort?: AutomaticQualifiedBundlePort;
  ports?: AutomaticRecommendationContextPorts;
} = {}) {
  return createAutomaticRecommendationEngine({
    contextPorts: ports,
    qualifiedBundlePort,
    scorer: scorerPort,
    ids: { nextRecommendationId: () => 'recommendation-engine-001' },
    recommendationTtlMs: 300_000,
  });
}

it('returns complete execution evidence from the same engine decision', async () => {
  const result = await engine().decideWithEvidence(
    'local_favorite',
    baseRequest,
  );
  expect(result.response.status).toBe('recommended');
  expect(result.execution.potentialCandidates.length).toBeGreaterThan(0);
  expect(result.execution.eligibilityDecisions.length).toBe(
    result.execution.potentialCandidates.length,
  );
  expect(result.execution.featureReconciliation).toMatchObject({
    featureRows: expect.any(Array),
  });
  expect(result.execution.scoresCalibration).toMatchObject({
    scores: expect.any(Array),
  });
  expect(result.execution.composition).toMatchObject({
    status: 'recommended',
    displayedCandidateIds: expect.any(Array),
  });
  expect(result.execution.modelReleaseProvenance).toMatchObject({
    bundleDigest: completeBundle.bundleDigest,
  });
});

describe('qualified automatic model bundle resolution', () => {
  it('accepts only one complete four-type bundle bound to the runtime feature schema', async () => {
    await expect(
      resolveQualifiedAutomaticRecommendationBundle(bundlePort()),
    ).resolves.toMatchObject({
      bundleId: 'bundle-engine-001',
      models: {
        local_favorite: { modelRevision: 'local-model' },
        for_you: { modelRevision: 'for-you-model' },
        modifier_upsell: { modelRevision: 'modifier-model' },
        smart_cross_sell: { modelRevision: 'cross-sell-model' },
      },
    });

    await expect(
      resolveQualifiedAutomaticRecommendationBundle(
        bundlePort({
          ...completeBundle,
          models: {
            local_favorite: completeBundle.models.local_favorite,
          },
        }),
      ),
    ).resolves.toBeNull();
    await expect(
      resolveQualifiedAutomaticRecommendationBundle(
        bundlePort({
          ...completeBundle,
          models: {
            ...completeBundle.models,
            for_you: {
              ...completeBundle.models.for_you,
              featureSchemaDigest: digest('f'),
            },
          },
        }),
      ),
    ).resolves.toBeNull();
  });
});

describe('automatic recommendation composition tie-breaking', () => {
  it.each([
    'local_favorite',
    'for_you',
    'modifier_upsell',
    'smart_cross_sell',
  ] as const)(
    'uses locale-independent code-point order for %s ties',
    (type) => {
      const tied: AutomaticScoredCandidate[] = ['é', 'a', 'Z'].map(
        (identity, index) => ({
          candidate: {
            candidateId: `product:${identity}`,
            categoryId: `category-${index}`,
            name: identity,
            imageUrl: null,
            sellable: true,
            safe: true,
            available: true,
            promotionActive: false,
            action: {
              type: 'add_product',
              sellableItemId: identity,
              quantity: 1,
              priceImpactVnd: 10000,
            },
          },
          selectionProbability: 0.5,
          jointProbability: 0.5,
          expectedRetainedValueVnd: 5000,
        }),
      );

      expect(
        composeAutomaticRecommendationSlate(type, tied).map(
          ({ candidateId }) => candidateId,
        ),
      ).toEqual(['product:Z', 'product:a', 'product:é']);
    },
  );
});

describe('automatic recommendation deterministic engine', () => {
  it('reconciles reordered scorer output and orders by Main-owned expected retained value', async () => {
    const decision = await engine({
      scorerPort: scorer({
        'product:side-cheap': [0.95, 0.9],
        'product:side-premium': [0.6, 0.4],
        'product:drink-1': [0.5, 0.3],
        'product:dessert-1': [0.5, 0.25],
        'product:parent-1': [0.5, 0.2],
      }),
    }).decide('local_favorite', baseRequest);

    expect(decision).toMatchObject({
      status: 'recommended',
      model: { modelRevision: 'local-model' },
      counts: { potential: 5, eligible: 5, scored: 5, displayed: 3 },
    });
    expect(
      decision.proposals.map(({ action }) =>
        action.type === 'add_product' ? action.sellableItemId : 'modifier',
      ),
    ).toEqual(['side-premium', 'side-cheap', 'drink-1']);
  });

  it('returns typed empty results for prerequisites, no eligible candidates, no bundle, and threshold abstention', async () => {
    const noHistory = await engine({
      ports: contextPorts({ history: false }),
    }).decide('for_you', {
      ...baseRequest,
      verifiedCustomerRef: 'customer-engine-001',
    });
    expect(noHistory).toMatchObject({
      status: 'empty',
      emptyReason: 'insufficient_history',
      proposals: [],
      model: null,
    });

    const unavailableCatalog: AutomaticCatalogSnapshot = {
      ...catalog,
      items: catalog.items.map((item) => ({
        ...item,
        availableFulfilmentModes: [],
      })),
    };
    const noEligible = await engine({
      ports: contextPorts({ snapshot: unavailableCatalog }),
    }).decide('local_favorite', baseRequest);
    expect(noEligible).toMatchObject({
      status: 'empty',
      emptyReason: 'no_eligible_candidates',
      counts: { potential: 5, eligible: 0, scored: 0, displayed: 0 },
    });

    const noBundle = await engine({
      qualifiedBundlePort: bundlePort(null),
    }).decide('local_favorite', baseRequest);
    expect(noBundle).toMatchObject({
      status: 'empty',
      emptyReason: 'no_qualified_model',
      counts: { potential: 5, eligible: 5, scored: 0, displayed: 0 },
    });

    const belowThreshold = await engine({
      scorerPort: scorer({
        'product:side-cheap': [0.2, 0.19],
        'product:side-premium': [0.2, 0.19],
        'product:drink-1': [0.2, 0.19],
        'product:dessert-1': [0.2, 0.19],
        'product:parent-1': [0.2, 0.19],
      }),
    }).decide('local_favorite', baseRequest);
    expect(belowThreshold).toMatchObject({
      status: 'empty',
      emptyReason: 'no_candidate_above_threshold',
      model: null,
      counts: { potential: 5, eligible: 5, scored: 5, displayed: 0 },
    });
  });

  it('returns governed pause without resolving a substitute recommendation', async () => {
    const decision = await engine({
      ports: contextPorts({ paused: true }),
    }).decide('local_favorite', baseRequest);

    expect(decision).toMatchObject({
      status: 'paused',
      emptyReason: 'recommendation_serving_paused',
      proposals: [],
      model: null,
      counts: { potential: 0, eligible: 0, scored: 0, displayed: 0 },
    });
  });

  it('uses type-aware cardinality and never pads modifier or smart-cross-sell slates', async () => {
    const modifierRequest = {
      ...baseRequest,
      cart: {
        ...baseRequest.cart,
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
      parentCartLineId: 'line-parent-1',
    };
    const modifier = await engine({
      ports: contextPorts({
        trustedCart: modifierRequest.cart,
        trustedParentCartLineId: 'line-parent-1',
      }),
    }).decide('modifier_upsell', modifierRequest);
    expect(modifier).toMatchObject({
      status: 'recommended',
      counts: { potential: 2, eligible: 2, scored: 2, displayed: 2 },
    });
    expect(modifier.proposals).toHaveLength(2);
    expect(
      modifier.proposals.every(
        ({ action }) =>
          action.type === 'apply_modifier' &&
          action.parentCartLineId === 'line-parent-1',
      ),
    ).toBe(true);

    const smartRequest = {
      ...baseRequest,
      cart: {
        ...baseRequest.cart,
        subtotal: { amount: 5000, currency: 'VND' as const },
        lines: [
          {
            lineId: 'outside-line',
            sellableItemId: 'outside-catalog',
            quantity: 1,
            unitPrice: { amount: 5000, currency: 'VND' as const },
            modifiers: [],
          },
        ],
      },
    };
    const smart = await engine({
      ports: contextPorts({ trustedCart: smartRequest.cart }),
    }).decide('smart_cross_sell', smartRequest);
    expect(
      smart.proposals.map(({ action }) =>
        action.type === 'add_product' ? action.sellableItemId : 'modifier',
      ),
    ).toEqual(['parent-1', 'side-premium', 'drink-1']);
    expect(
      smart.proposals.filter(({ action }) =>
        action.type === 'add_product'
          ? ['side-cheap', 'side-premium'].includes(action.sellableItemId)
          : false,
      ),
    ).toHaveLength(1);
  });

  it.each([
    {
      label: 'score-set mismatch',
      scorerPort: {
        score: async (
          request: Parameters<AutomaticRecommendationScorerPort['score']>[0],
        ) => ({
          schemaVersion: 'kfc-automatic-scorer-v1',
          requestId: request.requestId,
          model: request.model,
          scores: [],
        }),
      },
    },
    {
      label: 'invalid probability output',
      scorerPort: {
        score: async (
          request: Parameters<AutomaticRecommendationScorerPort['score']>[0],
        ) => ({
          schemaVersion: 'kfc-automatic-scorer-v1',
          requestId: request.requestId,
          model: request.model,
          scores: request.candidates.map(({ candidateId }) => ({
            candidateId,
            selectionProbability: 0.2,
            jointProbability: 0.3,
            explanationValues: {},
          })),
        }),
      },
    },
    {
      label: 'scorer saturation',
      scorerPort: {
        score: async () => {
          throw new Error('scorer_saturated');
        },
      },
    },
  ])(
    'returns retryable 503 infrastructure failure for $label',
    async ({ scorerPort }) => {
      await expect(
        engine({ scorerPort }).decide('local_favorite', baseRequest),
      ).rejects.toMatchObject({
        status: 503,
        code: 'recommendation_infrastructure_unavailable',
        retryable: true,
      });
      await expect(
        engine({ scorerPort }).decide('local_favorite', baseRequest),
      ).rejects.toBeInstanceOf(AutomaticRecommendationInfrastructureError);
    },
  );

  it('returns retryable 503 when a trusted snapshot port fails', async () => {
    const failingPorts = contextPorts();
    failingPorts.catalog.readSnapshot = async () => {
      throw new TypeError('catalog adapter disconnected');
    };

    await expect(
      engine({ ports: failingPorts }).decide('local_favorite', baseRequest),
    ).rejects.toMatchObject({
      status: 503,
      code: 'recommendation_infrastructure_unavailable',
      retryable: true,
      stage: 'context',
    });
  });

  it.each([
    {
      label: 'invalid catalog time zone',
      snapshot: { ...catalog, timeZone: 'Mars/Olympus_Mons' },
    },
    {
      label: 'invalid catalog item price',
      snapshot: {
        ...catalog,
        items: [
          { ...catalog.items[0]!, unitPriceVnd: -1 },
          ...catalog.items.slice(1),
        ],
      },
    },
  ])('fails closed before scoring for $label', async ({ snapshot }) => {
    let scorerCalled = false;
    await expect(
      engine({
        ports: contextPorts({ snapshot }),
        scorerPort: {
          score: async () => {
            scorerCalled = true;
            throw new Error('scorer_must_not_be_called');
          },
        },
      }).decide('local_favorite', baseRequest),
    ).rejects.toMatchObject({
      status: 503,
      retryable: true,
      stage: 'context',
    });
    expect(scorerCalled).toBe(false);
  });

  it('fails closed in the feature stage when trusted inputs cannot form the fixed schema', async () => {
    const zeroPriceCart: AutomaticTrustedOrderContextSnapshot['cart'] = {
      ...baseRequest.cart,
      lines: [
        {
          lineId: 'line-parent-1',
          sellableItemId: 'parent-1',
          quantity: 1,
          unitPrice: { amount: 0, currency: 'VND' },
          modifiers: [],
        },
      ],
    };
    const request = {
      ...baseRequest,
      cart: zeroPriceCart,
      parentCartLineId: 'line-parent-1',
    };
    let scorerCalled = false;
    await expect(
      engine({
        ports: contextPorts({
          trustedCart: zeroPriceCart,
          trustedParentCartLineId: 'line-parent-1',
        }),
        scorerPort: {
          score: async () => {
            scorerCalled = true;
            throw new Error('scorer_must_not_be_called');
          },
        },
      }).decide('modifier_upsell', request),
    ).rejects.toMatchObject({
      status: 503,
      retryable: true,
      stage: 'features',
    });
    expect(scorerCalled).toBe(false);
  });

  it('rejects a malformed trusted order snapshot before catalog or scorer access', async () => {
    const invalidPorts = contextPorts();
    const readOrder = invalidPorts.orderContext.readSnapshot;
    let catalogCalled = false;
    let scorerCalled = false;
    invalidPorts.orderContext.readSnapshot = async (input) => ({
      ...(await readOrder(input))!,
      remainingBudgetVnd: -1,
    });
    invalidPorts.catalog.readSnapshot = async () => {
      catalogCalled = true;
      return catalog;
    };
    await expect(
      engine({
        ports: invalidPorts,
        scorerPort: {
          score: async () => {
            scorerCalled = true;
            throw new Error('scorer_must_not_be_called');
          },
        },
      }).decide('local_favorite', baseRequest),
    ).rejects.toMatchObject({
      status: 503,
      retryable: true,
      stage: 'context',
    });
    expect(catalogCalled).toBe(false);
    expect(scorerCalled).toBe(false);
  });

  it('preserves a typed binding conflict and stops before catalog, candidates, or scoring', async () => {
    const boundPorts = contextPorts();
    let catalogCalled = false;
    let scorerCalled = false;
    boundPorts.catalog.readSnapshot = async () => {
      catalogCalled = true;
      return catalog;
    };
    await expect(
      engine({
        ports: boundPorts,
        scorerPort: {
          score: async () => {
            scorerCalled = true;
            throw new Error('scorer_must_not_be_called');
          },
        },
      }).decide('local_favorite', {
        ...baseRequest,
        storeId: 'SPOOFED-STORE',
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: 'identity_conflict',
      retryable: false,
    });
    expect(catalogCalled).toBe(false);
    expect(scorerCalled).toBe(false);
  });
});
