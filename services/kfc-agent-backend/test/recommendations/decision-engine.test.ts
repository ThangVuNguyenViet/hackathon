import { describe, expect, it } from 'vitest';
import {
  createBundledRecommendationDecisionEngine,
  createRecommendationDecisionEngine,
} from '../../src/recommendations/application/create-bundled-engine.js';
import type { RecommendationDecisionEngineDependencies } from '../../src/recommendations/application/types.js';
import {
  parseRecommendationDecisionRequest,
  parseRecommendationDecisionResponse,
} from '../../src/recommendations/domain/schemas.js';
import type { RecommendationDecisionContext } from '../../src/recommendations/eligibility/types.js';
import { LocalMerchandisingPolicyRepository } from '../../src/recommendations/merchandising/local-policy-repository.js';
import type { MerchandisingPolicySnapshot } from '../../src/recommendations/merchandising/policy.js';
import { merchandisingPolicySnapshotSchema } from '../../src/recommendations/merchandising/policy.js';
import type { MerchandisingPolicyRepository } from '../../src/recommendations/merchandising/repository.js';
import { RankerRepository } from '../../src/recommendations/ranking/ranker-repository.js';
import {
  BundledCommerceFactsRepository,
  BundledPromotionFactsRepository,
  BundledRankingStatisticsRepository,
} from '../../src/recommendations/snapshots/bundled-repositories.js';
import type {
  PromotionFactsSnapshot,
  RankingStatisticsSnapshot,
} from '../../src/recommendations/snapshots/types.js';

const bundledEngine = createBundledRecommendationDecisionEngine();

function snapshotBinding(name: string) {
  return {
    snapshotId: `${name}-decision-001`,
    digest: name.at(0)!.repeat(64),
    sourceRevision: `${name}-revision-001`,
    observedAt: '2026-07-27T08:00:00Z',
    effectiveAt: '2026-07-27T08:00:00Z',
    expiresAt: '2026-07-27T10:00:00Z',
    complete: true,
    commerceEnvironment: 'kfc-vietnam-demo',
    provenance: { source: 'test', reference: name },
  };
}

function makeContext(
  overrides: Partial<RecommendationDecisionContext> = {},
): RecommendationDecisionContext {
  const request = parseRecommendationDecisionRequest({
    schemaVersion: 'kfc-recommendation-v1',
    requestId: 'rec-request-decision-001',
    idempotencyKey: 'idempotency-decision-001',
    orderFlowId: 'journey-decision-001',
    sessionId: 'session-decision-001',
    placement: 'local_favorite',
    verifiedCustomerRef: null,
    storeId: 'KFCVN0002',
    fulfilmentMode: 'pickup',
    decisionTime: '2026-07-27T09:00:00Z',
    cart: {
      cartId: 'cart-decision-001',
      revision: 'cart-revision-decision-001',
      subtotal: { amount: 0, currency: 'VND' },
      lines: [],
    },
    cartRevision: 'cart-revision-decision-001',
    commerceSnapshotBindings: {
      catalog: snapshotBinding('a-catalog'),
      modifierGraph: snapshotBinding('b-modifier'),
      store: snapshotBinding('c-store'),
      availability: snapshotBinding('d-availability'),
      promotion: snapshotBinding('e-promotion'),
    },
    eligibilityPolicyVersion: 'kfc-recommendation-policy-v1',
    experimentProfile: {
      profileId: 'experiment-decision-001',
      outputMode: 'baseline',
    },
  });
  return {
    request,
    storeTimezone: 'Asia/Ho_Chi_Minh',
    verifiedCohorts: [],
    flow: {
      stage: 'starter_ready',
      attemptedPlacements: [],
      previouslyShownActionIds: [],
      rejectedActionIds: [],
    },
    parentCartLineId: null,
    remainingBudgetVnd: null,
    verifiedDietaryEvidence: null,
    customerHistory: null,
    ...overrides,
  };
}

async function decide(
  context: RecommendationDecisionContext,
  engine = bundledEngine,
) {
  const result = await engine.decide(context);
  expect(parseRecommendationDecisionResponse(result.response)).toEqual(
    result.response,
  );
  return result;
}

async function expectInvalidContext(
  context: RecommendationDecisionContext,
  engine = bundledEngine,
) {
  const result = await decide(context, engine);
  expect(result.response.status).toBe('invalid_context');
  expect(result.technical.emptyReason).toBe('invalid_context');
  expect(result.technical.potentialCandidates).toEqual([]);
}

function forYouContext(historyItemId = '20751'): RecommendationDecisionContext {
  const base = makeContext();
  return makeContext({
    request: parseRecommendationDecisionRequest({
      ...base.request,
      placement: 'for_you',
      verifiedCustomerRef: 'customer-decision-001',
    }),
    customerHistory: {
      verifiedCustomerRef: 'customer-decision-001',
      completedOrders: [
        {
          orderId: 'order-decision-001',
          completedAt: '2026-04-28T09:00:00Z',
          lines: [
            {
              sellableItemId: historyItemId,
              categoryId: '20000',
              quantity: 1,
            },
          ],
        },
      ],
    },
  });
}

function modifierContext(): RecommendationDecisionContext {
  const base = makeContext();
  return makeContext({
    request: parseRecommendationDecisionRequest({
      ...base.request,
      placement: 'modifier_upsell',
      cart: {
        ...base.request.cart,
        subtotal: { amount: 129_000, currency: 'VND' },
        lines: [
          {
            lineId: 'line-20752',
            sellableItemId: '20752',
            quantity: 1,
            unitPrice: { amount: 129_000, currency: 'VND' },
            modifiers: [],
          },
        ],
      },
    }),
    flow: {
      stage: 'modifier_ready',
      attemptedPlacements: [],
      previouslyShownActionIds: [],
      rejectedActionIds: [],
    },
    parentCartLineId: 'line-20752',
  });
}

function smartContext(
  overrides: Partial<RecommendationDecisionContext> = {},
): RecommendationDecisionContext {
  const base = makeContext();
  return makeContext({
    request: parseRecommendationDecisionRequest({
      ...base.request,
      placement: 'smart_cross_sell',
      cart: {
        ...base.request.cart,
        subtotal: { amount: 99_000, currency: 'VND' },
        lines: [
          {
            lineId: 'line-20751',
            sellableItemId: '20751',
            quantity: 1,
            unitPrice: { amount: 99_000, currency: 'VND' },
            modifiers: [],
          },
        ],
      },
    }),
    flow: {
      stage: 'smart_cross_sell_ready',
      attemptedPlacements: [],
      previouslyShownActionIds: [],
      rejectedActionIds: [],
    },
    ...overrides,
  });
}

class FixedPolicyRepository implements MerchandisingPolicyRepository {
  constructor(
    private readonly snapshot: MerchandisingPolicySnapshot,
    private readonly complete = snapshot.complete,
  ) {}

  async loadPublishedSnapshot() {
    return {
      snapshot: { ...this.snapshot, complete: this.complete },
      binding: {
        snapshotId: this.snapshot.snapshotId,
        digest: 'f'.repeat(64),
        contributingRevisions: [this.snapshot.sourceRevision],
      },
    };
  }
}

function engineWith(
  overrides: Partial<RecommendationDecisionEngineDependencies>,
) {
  return createRecommendationDecisionEngine({
    commerceFactsRepository: new BundledCommerceFactsRepository(),
    rankingStatisticsRepository: new BundledRankingStatisticsRepository(),
    promotionFactsRepository: new BundledPromotionFactsRepository(),
    rankerRepository: new RankerRepository(),
    merchandisingPolicyRepository: new LocalMerchandisingPolicyRepository(),
    ...overrides,
  });
}

async function customSmartPolicyRepository() {
  const local =
    await new LocalMerchandisingPolicyRepository().loadPublishedSnapshot();
  const base = local.snapshot.policies.find(
    (policy) => policy.policyId === 'smart-cross-sell-exclude-20712',
  )!;
  return new FixedPolicyRepository(
    merchandisingPolicySnapshotSchema.parse({
      ...local.snapshot,
      policies: [
        base,
        {
          ...base,
          policyId: 'smart-cross-sell-boost-20748',
          action: 'boost_target',
          targetIds: ['20748'],
          priority: 20,
          reasonCode: 'completes_your_meal',
          boostWeight: 1,
        },
        {
          ...base,
          policyId: 'smart-cross-sell-pin-41127',
          action: 'pin_target',
          targetIds: ['41127'],
          priority: 30,
          reasonCode: 'completes_your_meal',
          boostWeight: null,
          pinPosition: 1,
        },
      ],
    }),
  );
}

async function modifierCartCategoryPolicyRepository() {
  const local =
    await new LocalMerchandisingPolicyRepository().loadPublishedSnapshot();
  const base = local.snapshot.policies.find(
    (policy) => policy.policyId === 'modifier-pin-41091',
  )!;
  return new FixedPolicyRepository(
    merchandisingPolicySnapshotSchema.parse({
      ...local.snapshot,
      policies: [
        {
          ...base,
          policyId: 'modifier-pin-41102-with-required-cart-category',
          targetIds: ['41102'],
          priority: 20,
          requiredCartCategoryIds: ['20010'],
        },
        {
          ...base,
          policyId: 'modifier-suppress-with-excluded-cart-category',
          action: 'suppress_placement',
          targetIds: [],
          priority: 100,
          excludedCartCategoryIds: ['20010'],
          pinPosition: null,
        },
      ],
    }),
  );
}

describe('pure recommendation decision engine', () => {
  it('recommends one real anonymous Local Favorite with complete evidence', async () => {
    const result = await decide(makeContext());

    expect(result.response).toMatchObject({
      requestId: 'rec-request-decision-001',
      placement: 'local_favorite',
      status: 'recommended',
      decisionSource: 'ranked',
      primaryOffer: {
        actions: [{ type: 'add_product', actionId: 'product:20732' }],
      },
      reasonCodes: ['popular_here'],
      counts: {
        potential: 120,
        displayed: 1,
        complete: true,
      },
      versionBindings: {
        catalog: 'a-catalog-decision-001',
        modifierGraph: 'b-modifier-decision-001',
        store: 'c-store-decision-001',
        availability: 'd-availability-decision-001',
        promotion: 'e-promotion-decision-001',
        eligibilityPolicy: 'kfc-recommendation-policy-v1',
        sanitySnapshot: { snapshotId: 'sanity-snapshot-001' },
        featureSchema: 'contextual-popularity-feature-schema-v1',
        servingRanker: 'contextual-popularity-v1',
        shadowModel: null,
        calibration: null,
        experiment: 'experiment-decision-001',
        loggingPolicy: 'recommendation-logging-policy-v1',
      },
    });
    expect(result.response.displayFacts[0]).toMatchObject({
      actionId: 'product:20732',
      name: 'Xô Hợp Cạ 189k',
      priceImpact: { amount: 189_000, currency: 'VND' },
    });
    expect(result.technical.potentialCandidates).toHaveLength(120);
    expect(result.technical.eligibilityDecisions).toHaveLength(120);
    expect(result.technical.eligiblePrePolicyRanking.length).toBe(
      result.response.counts.scored,
    );
    expect(result.technical.emptyReason).toBeNull();
  });

  it('uses verified 90-day-decayed exact-item history for For You', async () => {
    const result = await decide(forYouContext());
    const exactWinner = result.technical.eligiblePrePolicyRanking.find(
      (entry) => entry.candidate.sellableItemId === '20751',
    );

    expect(exactWinner?.featureSummary.exactAffinityTotal).toBe(0.5);
    expect(result.response).toMatchObject({
      placement: 'for_you',
      status: 'recommended',
      decisionSource: 'merchandising_replacement',
      primaryOffer: { actions: [{ actionId: 'product:20751' }] },
      reasonCodes: ['merchandising_selection'],
      merchandisingEffects: [
        {
          policyId: 'for-you-replace-20751',
          action: 'replace_slate',
          targetActionId: 'product:20751',
        },
      ],
    });
  });

  it('fails closed when verified history contains a calendar-invalid completion Instant', async () => {
    const context = forYouContext();
    context.customerHistory!.completedOrders[0]!.completedAt =
      '2026-02-31T09:00:00Z';

    const result = await decide(context);
    const itemDecision = result.technical.eligibilityDecisions.find(
      (decision) => decision.actionId === 'product:20751',
    );

    expect(result.response).toMatchObject({
      placement: 'for_you',
      status: 'empty',
      decisionSource: 'fallback',
      primaryOffer: null,
    });
    expect(itemDecision?.reasonCodes).toEqual(['zero_history_required']);
  });

  it('excludes a calendar-invalid order from affinity when other verified history is valid', async () => {
    const context = forYouContext('41127');
    context.customerHistory!.completedOrders.push({
      orderId: 'calendar-invalid-order',
      completedAt: '2026-02-31T09:00:00Z',
      lines: [
        {
          sellableItemId: '20751',
          categoryId: '20000',
          quantity: 99,
        },
      ],
    });

    const result = await decide(context);
    const invalidHistoryTarget = result.technical.eligiblePrePolicyRanking.find(
      (entry) => entry.candidate.sellableItemId === '20751',
    );
    const validHistoryTarget = result.technical.eligiblePrePolicyRanking.find(
      (entry) => entry.candidate.sellableItemId === '41127',
    );

    expect(invalidHistoryTarget?.featureSummary.exactAffinityTotal).toBe(0);
    expect(validHistoryTarget?.featureSummary.exactAffinityTotal).toBe(0.5);
  });

  it('chooses the highest positive-price compatible 20752 modifier with a deterministic tie break', async () => {
    const result = await decide(modifierContext());

    expect(result.response).toMatchObject({
      placement: 'modifier_upsell',
      status: 'recommended',
      primaryOffer: {
        actions: [
          {
            type: 'apply_modifier',
            actionId: 'modifier:line-20752:2:41091',
            optionId: '41091',
            priceImpact: { amount: 7_000, currency: 'VND' },
          },
        ],
      },
    });
    expect(
      result.technical.eligiblePrePolicyRanking
        .filter((entry) => entry.candidate.action.priceImpact.amount === 7_000)
        .map((entry) => entry.candidate.action.actionId)
        .slice(0, 4),
    ).toEqual([
      'modifier:line-20752:2:41091',
      'modifier:line-20752:2:41102',
      'modifier:line-20752:3:41091',
      'modifier:line-20752:3:41102',
    ]);
  });

  it('applies modifier policies against categories from every typed cart line', async () => {
    const context = modifierContext();
    context.request = parseRecommendationDecisionRequest({
      ...context.request,
      cart: {
        ...context.request.cart,
        subtotal: { amount: 179_000, currency: 'VND' },
        lines: [
          ...context.request.cart.lines,
          {
            lineId: 'line-41127',
            sellableItemId: '41127',
            quantity: 1,
            unitPrice: { amount: 50_000, currency: 'VND' },
            modifiers: [],
          },
        ],
      },
    });
    const engine = engineWith({
      merchandisingPolicyRepository:
        await modifierCartCategoryPolicyRepository(),
    });

    const result = await decide(context, engine);

    expect(result.response).toMatchObject({
      status: 'recommended',
      primaryOffer: {
        actions: [
          {
            actionId: 'modifier:line-20752:2:41102',
            optionId: '41102',
          },
        ],
      },
      merchandisingEffects: [
        expect.objectContaining({
          policyId: 'modifier-pin-41102-with-required-cart-category',
          action: 'pin_target',
        }),
      ],
    });
  });

  it('composes a policy-adjusted Smart Cross-sell slate of three or four with at most two per category', async () => {
    const engine = engineWith({
      merchandisingPolicyRepository: await customSmartPolicyRepository(),
    });
    const result = await decide(smartContext(), engine);
    const actions = result.response.primaryOffer!.actions;
    const byId = new Map(
      result.technical.potentialCandidates.map((entry) => [
        entry.action.actionId,
        entry,
      ]),
    );
    const categoryCounts = actions.reduce<Record<string, number>>(
      (counts, action) => {
        const category = byId.get(action.actionId)!.categoryId;
        counts[category] = (counts[category] ?? 0) + 1;
        return counts;
      },
      {},
    );

    expect(actions.length).toBeGreaterThanOrEqual(3);
    expect(actions.length).toBeLessThanOrEqual(4);
    expect(Math.max(...Object.values(categoryCounts))).toBeLessThanOrEqual(2);
    expect(actions[0]?.actionId).toBe('product:41127');
    expect(actions.map((action) => action.actionId)).not.toContain(
      'product:20712',
    );
    expect(
      result.response.merchandisingEffects.map((effect) => effect.action),
    ).toEqual(
      expect.arrayContaining(['exclude_target', 'boost_target', 'pin_target']),
    );
  });

  it('returns typed empty reasons for attempted, wrong-stage, and empty placement contexts', async () => {
    const attempted = await decide(
      makeContext({
        flow: {
          stage: 'starter_ready',
          attemptedPlacements: ['local_favorite'],
          previouslyShownActionIds: [],
          rejectedActionIds: [],
        },
      }),
    );
    const wrongStage = await decide(
      makeContext({
        flow: {
          stage: 'complete',
          attemptedPlacements: [],
          previouslyShownActionIds: [],
          rejectedActionIds: [],
        },
      }),
    );
    const noParent = await decide(
      makeContext({
        request: parseRecommendationDecisionRequest({
          ...makeContext().request,
          placement: 'modifier_upsell',
        }),
        flow: {
          stage: 'modifier_ready',
          attemptedPlacements: [],
          previouslyShownActionIds: [],
          rejectedActionIds: [],
        },
      }),
    );

    expect(attempted.response.status).toBe('ineligible_context');
    expect(attempted.technical.emptyReason).toBe('placement_already_attempted');
    expect(wrongStage.response.status).toBe('ineligible_context');
    expect(wrongStage.technical.emptyReason).toBe('placement_not_yet_eligible');
    expect(noParent.response.status).toBe('empty');
    expect(noParent.technical.emptyReason).toBe('parent_cart_line_required');
  });

  it('reports only material bundled effects and KFCVN0036 suppression', async () => {
    const local = await decide(makeContext());
    const personalized = await decide(forYouContext());
    const modifier = await decide(modifierContext());
    const smart = await decide(smartContext());
    const suppressed = await decide(
      smartContext({
        request: parseRecommendationDecisionRequest({
          ...smartContext().request,
          storeId: 'KFCVN0036',
        }),
      }),
    );

    expect(local.response.merchandisingEffects).toEqual([
      expect.objectContaining({
        policyId: 'local-favorite-boost-20732',
        action: 'boost_target',
      }),
    ]);
    expect(personalized.response.decisionSource).toBe(
      'merchandising_replacement',
    );
    expect(modifier.response.merchandisingEffects).toEqual([]);
    expect(modifier.technical.merchandisingResolution.effects).toEqual([]);
    expect(smart.response.merchandisingEffects).toEqual([
      expect.objectContaining({
        policyId: 'smart-cross-sell-exclude-20712',
        action: 'exclude_target',
      }),
    ]);
    expect(suppressed.response).toMatchObject({
      status: 'suppressed',
      decisionSource: 'suppressed',
      primaryOffer: null,
      counts: { displayed: 0 },
    });
    expect(suppressed.technical.emptyReason).toBe('merchandising_suppressed');
  });

  it('rejects an incomplete commerce binding', async () => {
    const context = structuredClone(makeContext());
    context.request.commerceSnapshotBindings.catalog.complete = false;

    await expectInvalidContext(context);
  });

  it('rejects a commerce binding from another environment', async () => {
    const context = structuredClone(makeContext());
    context.request.commerceSnapshotBindings.availability.commerceEnvironment =
      'other-environment' as never;

    await expectInvalidContext(context);
  });

  it('rejects a commerce binding expired at decision time', async () => {
    const context = structuredClone(makeContext());
    context.request.commerceSnapshotBindings.store.expiresAt =
      context.request.decisionTime;

    await expectInvalidContext(context);
  });

  it('rejects an incomplete ranking snapshot', async () => {
    const ranking = new BundledRankingStatisticsRepository().load();
    await expectInvalidContext(
      makeContext(),
      engineWith({
        rankingStatisticsRepository: {
          load: (): RankingStatisticsSnapshot => ({
            ...ranking,
            complete: false,
          }),
        },
      }),
    );
  });

  it('rejects a ranking snapshot from another environment', async () => {
    const ranking = new BundledRankingStatisticsRepository().load();
    await expectInvalidContext(
      makeContext(),
      engineWith({
        rankingStatisticsRepository: {
          load: (): RankingStatisticsSnapshot => ({
            ...ranking,
            commerceEnvironment: 'other-environment' as never,
          }),
        },
      }),
    );
  });

  it('rejects a ranking snapshot not yet effective at decision time', async () => {
    const ranking = new BundledRankingStatisticsRepository().load();
    await expectInvalidContext(
      makeContext(),
      engineWith({
        rankingStatisticsRepository: {
          load: (): RankingStatisticsSnapshot => ({
            ...ranking,
            effectiveAt: '2026-07-27T09:00:00.0001Z',
          }),
        },
      }),
    );
  });

  it('rejects an incomplete promotion snapshot', async () => {
    const promotion = new BundledPromotionFactsRepository().load();
    await expectInvalidContext(
      makeContext(),
      engineWith({
        promotionFactsRepository: {
          load: (): PromotionFactsSnapshot => ({
            ...promotion,
            complete: false,
          }),
        },
      }),
    );
  });

  it('rejects a promotion snapshot expired at decision time', async () => {
    const promotion = new BundledPromotionFactsRepository().load();
    await expectInvalidContext(
      makeContext(),
      engineWith({
        promotionFactsRepository: {
          load: (): PromotionFactsSnapshot => ({
            ...promotion,
            expiresAt: '2026-07-27T09:00:00Z',
          }),
        },
      }),
    );
  });

  it('rejects a promotion snapshot from another environment', async () => {
    const promotion = new BundledPromotionFactsRepository().load();
    await expectInvalidContext(
      makeContext(),
      engineWith({
        promotionFactsRepository: {
          load: (): PromotionFactsSnapshot => ({
            ...promotion,
            commerceEnvironment: 'other-environment' as never,
          }),
        },
      }),
    );
  });

  it('rejects an incomplete merchandising snapshot', async () => {
    const sanity =
      await new LocalMerchandisingPolicyRepository().loadPublishedSnapshot();
    await expectInvalidContext(
      makeContext(),
      engineWith({
        merchandisingPolicyRepository: new FixedPolicyRepository(
          sanity.snapshot,
          false,
        ),
      }),
    );
  });

  it('rejects a merchandising snapshot from another environment', async () => {
    const sanity =
      await new LocalMerchandisingPolicyRepository().loadPublishedSnapshot();
    await expectInvalidContext(
      makeContext(),
      engineWith({
        merchandisingPolicyRepository: new FixedPolicyRepository({
          ...sanity.snapshot,
          commerceEnvironment: 'other-environment' as never,
          policies: [],
        }),
      }),
    );
  });

  it('never lets policy resurrect unavailable, cart, or dietary candidates', async () => {
    const base = forYouContext('20732');
    const cartExcluded = forYouContext('20732');
    cartExcluded.request = parseRecommendationDecisionRequest({
      ...cartExcluded.request,
      cart: {
        ...cartExcluded.request.cart,
        subtotal: { amount: 99_000, currency: 'VND' },
        lines: [
          {
            lineId: 'line-20751',
            sellableItemId: '20751',
            quantity: 1,
            unitPrice: { amount: 99_000, currency: 'VND' },
            modifiers: [],
          },
        ],
      },
    });
    const dietaryExcluded = {
      ...base,
      verifiedDietaryEvidence: {
        evidenceId: 'dietary-decision-001',
        excludedSellableItemIds: ['20751'],
      },
    };
    const commerceFacts = structuredClone(
      new BundledCommerceFactsRepository().load(),
    );
    commerceFacts.menuItems.find((item) => item.itemId === '20751')!.available =
      false;
    const unavailableEngine = engineWith({
      commerceFactsRepository: { load: () => commerceFacts },
    });

    for (const [context, engine] of [
      [cartExcluded, bundledEngine],
      [dietaryExcluded, bundledEngine],
      [base, unavailableEngine],
    ] as const) {
      const result = await decide(context, engine);
      expect(
        result.response.primaryOffer?.actions.map((entry) => entry.actionId),
      ).not.toContain('product:20751');
      expect(result.response.decisionSource).not.toBe(
        'merchandising_replacement',
      );
      expect(
        result.technical.eligibilityDecisions.find(
          (entry) => entry.actionId === 'product:20751',
        )?.eligible,
      ).toBe(false);
    }
  });

  it('returns byte-equivalent output and deterministic IDs for identical canonical input', async () => {
    const first = await decide(smartContext());
    const second = await decide(structuredClone(smartContext()));

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(first.response.recommendationId).toMatch(
      /^recommendation:[a-f0-9]{24}$/u,
    );
    expect(first.response.traceRef).toMatch(/^trace:[a-f0-9]{24}$/u);
  });

  it('uses exact arbitrary-precision Instants at the public request-validation and engine seam', async () => {
    const base = makeContext();
    const binding = {
      ...snapshotBinding('a-fractional'),
      observedAt: '2026-07-27T09:00:00.1000Z',
      effectiveAt: '2026-07-27T09:00:00.1000Z',
      expiresAt: '2026-07-27T09:00:00.1002Z',
    };
    const request = parseRecommendationDecisionRequest({
      ...base.request,
      decisionTime: '2026-07-27T09:00:00.1001Z',
      commerceSnapshotBindings: {
        catalog: binding,
        modifierGraph: { ...binding, snapshotId: 'b-fractional-decision-001' },
        store: { ...binding, snapshotId: 'c-fractional-decision-001' },
        availability: {
          ...binding,
          snapshotId: 'd-fractional-decision-001',
        },
        promotion: { ...binding, snapshotId: 'e-fractional-decision-001' },
      },
    });
    const result = await decide(makeContext({ request }));

    expect(result.response.status).toBe('recommended');
    expect(result.technical.emptyReason).toBeNull();
  });
});
