import { describe, expect, it } from 'vitest';
import { ContextualPopularityRanker } from '../../src/recommendations/ranking/contextual-popularity.js';
import { ForYouAffinityRanker } from '../../src/recommendations/ranking/for-you-affinity.js';
import { IncrementalValueRanker } from '../../src/recommendations/ranking/incremental-value.js';
import { RankerRepository } from '../../src/recommendations/ranking/ranker-repository.js';
import {
  SmartCrossBlendRanker,
  composeSmartCrossSellSlate,
} from '../../src/recommendations/ranking/smart-cross-blend.js';
import type {
  RankedCandidate,
  RankerInput,
} from '../../src/recommendations/ranking/types.js';
import {
  parseRecommendationDecisionRequest,
  recommendationActionSchema,
} from '../../src/recommendations/domain/schemas.js';
import type { RecommendationAction } from '../../src/recommendations/domain/contracts.js';
import type {
  EligibilityDecision,
  PotentialRecommendationCandidate,
  RecommendationDecisionContext,
} from '../../src/recommendations/eligibility/types.js';
import { BundledRankingStatisticsRepository } from '../../src/recommendations/snapshots/bundled-repositories.js';
import type { RankingStatisticsSnapshot } from '../../src/recommendations/snapshots/types.js';

const rankingStatistics = new BundledRankingStatisticsRepository().load();

const makeContext = (
  overrides: Partial<RecommendationDecisionContext> = {},
): RecommendationDecisionContext => ({
  request: parseRecommendationDecisionRequest({
    schemaVersion: 'kfc-recommendation-v1',
    requestId: 'rec-request-ranker-001',
    idempotencyKey: 'idempotency-ranker-001',
    orderFlowId: 'journey-ranker-001',
    sessionId: 'session-ranker-001',
    placement: 'local_favorite',
    verifiedCustomerRef: null,
    storeId: 'KFCVN0002',
    fulfilmentMode: 'pickup',
    decisionTime: '2026-07-27T09:00:00Z',
    cart: {
      cartId: 'cart-ranker-001',
      revision: 'cart-revision-ranker-001',
      subtotal: { amount: 0, currency: 'VND' },
      lines: [],
    },
    cartRevision: 'cart-revision-ranker-001',
    commerceSnapshotBindings: {
      catalog: snapshotBinding('catalog'),
      modifierGraph: snapshotBinding('modifier'),
      store: snapshotBinding('store'),
      availability: snapshotBinding('availability'),
      promotion: snapshotBinding('promotion'),
    },
    eligibilityPolicyVersion: 'kfc-recommendation-policy-v1',
    experimentProfile: { profileId: 'experiment-ranker-001', outputMode: 'baseline' },
  }),
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
});

function snapshotBinding(snapshotId: string) {
  return {
    snapshotId: `${snapshotId}-ranker-001`,
    digest: 'a'.repeat(64),
    sourceRevision: `${snapshotId}-revision-001`,
    observedAt: '2026-01-01T00:00:00Z',
    effectiveAt: '2026-01-01T00:00:00Z',
    expiresAt: '2027-01-01T00:00:00Z',
    complete: true,
    commerceEnvironment: 'kfc-vietnam-demo',
    provenance: { source: 'test', reference: snapshotId },
  };
}

const candidate = (
  id: string,
  overrides: Partial<PotentialRecommendationCandidate> = {},
): PotentialRecommendationCandidate => ({
  action: action({
    type: 'add_product',
    actionId: `product:${id}`,
    sellableItemId: id,
    quantity: 1,
    priceImpact: { amount: 50_000, currency: 'VND' },
    cartRevision: 'cart-revision-ranker-001',
  }),
  targetId: id,
  sellableItemId: id,
  categoryId: 'chicken',
  name: `Product ${id}`,
  imageUrl: null,
  basePriceVnd: 50_000,
  activeDiscountRatio: 0,
  promotionId: null,
  parentCartLineId: null,
  modifierGroupPath: [],
  ...overrides,
});

const eligible = (entry: PotentialRecommendationCandidate): EligibilityDecision => ({
  policyVersion: 'kfc-recommendation-policy-v1',
  actionId: entry.action.actionId,
  eligible: true,
  reasonCodes: ['eligible'],
  evidenceBindings: [],
  digest: 'a'.repeat(64),
});

const action = (value: unknown): RecommendationAction =>
  recommendationActionSchema.parse(value);

const rankerInput = (
  candidates: PotentialRecommendationCandidate[],
  overrides: Partial<RankerInput> = {},
): RankerInput => ({
  context: makeContext(),
  candidates,
  eligibilityDecisions: candidates.map(eligible),
  rankingStatistics,
  ...overrides,
});

const withStatistics = (
  productStatistics: RankingStatisticsSnapshot['productStatistics'],
): RankingStatisticsSnapshot => ({
  ...rankingStatistics,
  productStatistics,
});

describe('deterministic recommendation rankers', () => {
  it('uses each contextual-popularity back-off level with Bayesian smoothing', () => {
    const entry = candidate('20751');
    const base = rankingStatistics.productStatistics.find(
      (statistics) => statistics.sellableItemId === '20751',
    )!;
    const ranker = new ContextualPopularityRanker();
    const cases = [
      {
        statistics: base,
        expectedSegment: 'KFCVN0002:weekday:lunch',
        expectedScore: (18 + 20 * (120 / 712)) / (98 + 20),
      },
      {
        strip: 'calendar',
        expectedSegment: 'KFCVN0002:lunch',
        expectedScore: (24 + 20 * (120 / 712)) / (134 + 20),
      },
      {
        strip: 'daypart',
        expectedSegment: 'KFCVN0002',
        expectedScore: (50 + 20 * (120 / 712)) / (274 + 20),
      },
      {
        strip: 'store',
        expectedSegment: 'global',
        expectedScore: 120 / 712,
      },
      {
        strip: 'zero-calendar',
        expectedSegment: 'KFCVN0002:weekday:lunch',
        expectedScore: 120 / 712,
      },
    ];

    for (const expectation of cases) {
      const [result] = ranker.rank(
        rankerInput([entry], {
          rankingStatistics: withStatistics([
            ...rankingStatistics.productStatistics.map((statistics) => ({
              ...statistics,
              storeCalendarDayTypeDaypartOrderCounts:
                expectation.strip === 'calendar' ||
                expectation.strip === 'daypart' ||
                expectation.strip === 'store'
                  ? {}
                  : expectation.strip === 'zero-calendar'
                    ? {
                        ...statistics.storeCalendarDayTypeDaypartOrderCounts,
                        'KFCVN0002:weekday:lunch': 0,
                      }
                  : statistics.storeCalendarDayTypeDaypartOrderCounts,
              storeDaypartOrderCounts:
                expectation.strip === 'daypart' || expectation.strip === 'store'
                  ? {}
                  : statistics.storeDaypartOrderCounts,
              storeOrderCounts:
                expectation.strip === 'store' ? {} : statistics.storeOrderCounts,
            })),
          ]),
          context: makeContext({
            request: parseRecommendationDecisionRequest({
              ...makeContext().request,
              decisionTime: '2026-07-27T03:00:00Z',
            }),
          }),
        }),
      );
      expect(result.featureSummary.segment).toBe(expectation.expectedSegment);
      expect(result.score).toBeCloseTo(expectation.expectedScore, 12);
    }
  });

  it('honors local weekday/weekend and all exact daypart boundaries', () => {
    const entry = candidate('20751');
    const ranker = new ContextualPopularityRanker();
    const boundaries = [
      ['2026-07-26T22:00:00Z', 'breakfast'],
      ['2026-07-27T03:00:00Z', 'lunch'],
      ['2026-07-27T07:00:00Z', 'afternoon'],
      ['2026-07-27T10:00:00Z', 'dinner'],
      ['2026-07-27T15:00:00Z', 'late_night'],
      ['2026-07-27T17:00:00Z', 'late_night'],
      ['2026-07-25T03:00:00Z', 'lunch'],
    ] as const;

    for (const [decisionTime, daypart] of boundaries) {
      const [result] = ranker.rank(
        rankerInput([entry], {
          context: makeContext({
            request: parseRecommendationDecisionRequest({
              ...makeContext().request,
              decisionTime,
            }),
          }),
        }),
      );
      expect(result.featureSummary.daypart).toBe(daypart);
    }

    const [weekday] = ranker.rank(rankerInput([entry]));
    const [weekend] = ranker.rank(
      rankerInput([entry], {
        context: makeContext({
          request: parseRecommendationDecisionRequest({
            ...makeContext().request,
            decisionTime: '2026-07-25T03:00:00Z',
          }),
        }),
      }),
    );
    expect(weekday.featureSummary.dayType).toBe('weekday');
    expect(weekend.featureSummary.dayType).toBe('weekend');
  });

  it('applies the 90-day half-life, excludes future history, and uses the fixed For You blend', () => {
    const entry = candidate('20751');
    const ranker = new ForYouAffinityRanker();
    const [result] = ranker.rank(
      rankerInput([entry], {
        context: makeContext({
          request: parseRecommendationDecisionRequest({
            ...makeContext().request,
            placement: 'for_you',
            verifiedCustomerRef: 'customer-001',
            decisionTime: '2026-07-27T09:00:00Z',
          }),
          customerHistory: {
            verifiedCustomerRef: 'customer-001',
            completedOrders: [
              {
                orderId: 'past-90-days',
                completedAt: '2026-04-28T09:00:00Z',
                lines: [{ sellableItemId: '20751', categoryId: 'chicken', quantity: 1 }],
              },
              {
                orderId: 'future',
                completedAt: '2026-07-28T09:00:00Z',
                lines: [{ sellableItemId: '20751', categoryId: 'chicken', quantity: 99 }],
              },
            ],
          },
        }),
        rankingStatistics: withStatistics([
          {
            ...rankingStatistics.productStatistics[0],
            globalOrderCount: 0,
            storeOrderCounts: {},
            storeDaypartOrderCounts: {},
            storeCalendarDayTypeDaypartOrderCounts: {},
          },
        ]),
      }),
    );

    expect(result.score).toBeCloseTo(0.55 * (0.5 / 5) + 0.25 * (0.5 / 12), 12);
    expect(result.reasonCodes).toEqual(['ordered_before']);
    expect(result.featureSummary.exactAffinityTotal).toBeCloseTo(0.5, 12);
    expect(result.featureSummary.contextualPopularity).toBe(0);
  });

  it('clamps fixed For You normalization and does not duplicate popularity as a customer reason', () => {
    const entry = candidate('20751');
    const [result] = new ForYouAffinityRanker().rank(
      rankerInput([entry], {
        context: makeContext({
          request: parseRecommendationDecisionRequest({
            ...makeContext().request,
            placement: 'for_you',
            verifiedCustomerRef: 'customer-001',
          }),
          customerHistory: {
            verifiedCustomerRef: 'customer-001',
            completedOrders: [
              {
                orderId: 'large-past-order',
                completedAt: '2026-04-28T09:00:00Z',
                lines: [
                  { sellableItemId: '20751', categoryId: 'chicken', quantity: 100 },
                  { sellableItemId: 'another', categoryId: 'chicken', quantity: 100 },
                ],
              },
            ],
          },
        }),
        rankingStatistics: withStatistics([
          {
            ...rankingStatistics.productStatistics[0],
            globalOrderCount: 0,
            storeOrderCounts: {},
            storeDaypartOrderCounts: {},
            storeCalendarDayTypeDaypartOrderCounts: {},
          },
        ]),
      }),
    );

    expect(result.score).toBeCloseTo(0.8, 12);
    expect(result.reasonCodes).toEqual(['ordered_before']);
    expect(result.featureSummary.exactAffinity).toBe(1);
    expect(result.featureSummary.categoryAffinity).toBe(1);
    expect(result.featureSummary.popularHere).toBe(true);
    expect(result.featureSummary.popularityReasonCode).toBe('popular_here');
  });

  it('orders modifier upsells by price impact with action-ID ties', () => {
    const entries = [
      candidate('modifier-b', {
        action: action({
          type: 'apply_modifier', actionId: 'modifier:z', parentCartLineId: 'line-1',
          parentSellableItemId: '20752', optionId: 'b', groupPath: ['1'], quantity: 1,
          priceImpact: { amount: 10_000, currency: 'VND' }, cartRevision: 'cart-revision-ranker-001',
        }),
      }),
      candidate('modifier-a', {
        action: action({
          type: 'apply_modifier', actionId: 'modifier:a', parentCartLineId: 'line-1',
          parentSellableItemId: '20752', optionId: 'a', groupPath: ['1'], quantity: 1,
          priceImpact: { amount: 10_000, currency: 'VND' }, cartRevision: 'cart-revision-ranker-001',
        }),
      }),
      candidate('modifier-high', {
        action: action({
          type: 'apply_modifier', actionId: 'modifier:high', parentCartLineId: 'line-1',
          parentSellableItemId: '20752', optionId: 'high', groupPath: ['1'], quantity: 1,
          priceImpact: { amount: 20_000, currency: 'VND' }, cartRevision: 'cart-revision-ranker-001',
        }),
      }),
    ];
    const results = new IncrementalValueRanker().rank(rankerInput(entries));

    expect(results.map((result) => result.candidate.action.actionId)).toEqual([
      'modifier:high', 'modifier:a', 'modifier:z',
    ]);
    expect(results[0].score).toBe(Math.log1p(20_000));
    expect(results[0].reasonCodes).toEqual(['completes_your_item']);
  });

  it('calculates Smart Cross-sell z-scores and retains the full eligible ranking', () => {
    const entries = [
      candidate('20751', { activeDiscountRatio: 0 }),
      candidate('20732', { activeDiscountRatio: 0.5 }),
    ];
    const results = new SmartCrossBlendRanker().rank(rankerInput(entries));
    const first = results.find((result) => result.candidate.sellableItemId === '20751')!;
    const expectedPopularity = Math.log1p(2 * 50 + 120);
    expect(first.featureSummary.popularityZ).toBeCloseTo((expectedPopularity - 4.5) / 1.2, 12);
    expect(first.featureSummary.discountZ).toBeCloseTo(-0.5, 12);
    expect(first.score).toBeCloseTo(((expectedPopularity - 4.5) / 1.2 - 0.5) / 2, 12);
    expect(results).toHaveLength(2);
    expect(results.find((result) => result.candidate.sellableItemId === '20732')!.reasonCodes).toEqual(['active_offer']);
  });

  it('composes a default three and only a diverse, positive, affordable fourth', () => {
    const ranked = [
      slateCandidate('a', 9, 'chicken', 50),
      slateCandidate('b', 8, 'chicken', 50),
      slateCandidate('c', 7, 'sides', 50),
      slateCandidate('d', 6, 'drinks', 50),
      slateCandidate('e', 5, 'drinks', 50),
      slateCandidate('f', -1, 'dessert', 50),
    ];
    expect(composeSmartCrossSellSlate(ranked, null).map((entry) => entry.candidate.action.actionId)).toEqual([
      'product:a', 'product:b', 'product:c', 'product:d',
    ]);
    expect(composeSmartCrossSellSlate(ranked, 150).map((entry) => entry.candidate.action.actionId)).toEqual([
      'product:a', 'product:b', 'product:c',
    ]);
    expect(composeSmartCrossSellSlate(ranked.slice(0, 2), null)).toEqual([]);
  });

  it('enforces unique products, category cap, running budget, eligible decisions, and placement versions', () => {
    const duplicate = slateCandidate('duplicate', 10, 'chicken', 30, 'shared');
    const ranked = [
      duplicate,
      slateCandidate('duplicate-action', 9, 'chicken', 30, 'shared'),
      slateCandidate('two', 8, 'chicken', 30),
      slateCandidate('three', 7, 'chicken', 30),
      slateCandidate('four', 6, 'sides', 100),
      slateCandidate('five', 5, 'drink', 30),
    ];
    expect(composeSmartCrossSellSlate(ranked, 120).map((entry) => entry.candidate.action.actionId)).toEqual([
      'product:duplicate', 'product:two', 'product:five',
    ]);

    const repository = new RankerRepository();
    expect(repository.forPlacement('local_favorite').version).toBe('contextual-popularity-v1');
    expect(repository.forPlacement('for_you').version).toBe('for-you-affinity-v1');
    expect(repository.forPlacement('modifier_upsell').version).toBe('incremental-value-v1');
    expect(repository.forPlacement('smart_cross_sell').version).toBe('smart-cross-blend-v1');

    const ineligible = candidate('20751');
    expect(() => new ContextualPopularityRanker().rank(rankerInput([ineligible], {
      eligibilityDecisions: [{ ...eligible(ineligible), eligible: false, reasonCodes: ['store_unavailable'] }],
    }))).toThrow('eligible decision');
  });
});

function slateCandidate(
  id: string,
  score: number,
  categoryId: string,
  amount: number,
  sellableItemId = id,
): RankedCandidate {
  return {
    candidate: candidate(sellableItemId, {
      action: action({
        type: 'add_product', actionId: `product:${id}`, sellableItemId, quantity: 1,
        priceImpact: { amount, currency: 'VND' }, cartRevision: 'cart-revision-ranker-001',
      }),
      categoryId,
      basePriceVnd: amount,
    }),
    score,
    reasonCodes: ['completes_your_meal'],
    featureSummary: {},
  };
}
