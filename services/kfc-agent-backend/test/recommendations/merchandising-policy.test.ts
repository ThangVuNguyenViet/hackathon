import { describe, expect, it } from 'vitest';
import {
  parseRecommendationDecisionRequest,
  recommendationActionSchema,
} from '../../src/recommendations/domain/schemas.js';
import { LocalMerchandisingPolicyRepository } from '../../src/recommendations/merchandising/local-policy-repository.js';
import {
  merchandisingPolicySnapshotSchema,
  recommendationPolicySchema,
} from '../../src/recommendations/merchandising/policy.js';
import {
  applicableMerchandisingPolicies,
  resolveMerchandisingPolicies,
} from '../../src/recommendations/merchandising/resolve-policies.js';
import { SanityMerchandisingPolicyRepository } from '../../src/recommendations/merchandising/sanity-policy-repository.js';
import type { RecommendationDecisionContext } from '../../src/recommendations/eligibility/types.js';
import type { RankedCandidate } from '../../src/recommendations/ranking/types.js';

const context = (
  overrides: Partial<RecommendationDecisionContext> = {},
): RecommendationDecisionContext => ({
  request: parseRecommendationDecisionRequest({
    schemaVersion: 'kfc-recommendation-v1',
    requestId: 'merch-request-001',
    idempotencyKey: 'merch-idempotency-001',
    orderFlowId: 'merch-flow-001',
    sessionId: 'merch-session-001',
    placement: 'smart_cross_sell',
    verifiedCustomerRef: null,
    storeId: 'KFCVN0002',
    fulfilmentMode: 'pickup',
    decisionTime: '2026-07-27T09:00:00Z',
    cart: {
      cartId: 'merch-cart-001',
      revision: 'merch-cart-revision-001',
      subtotal: { amount: 150000, currency: 'VND' },
      lines: [
        {
          lineId: 'line-20732',
          sellableItemId: '20732',
          quantity: 1,
          unitPrice: { amount: 150000, currency: 'VND' },
          modifiers: [],
        },
      ],
    },
    cartRevision: 'merch-cart-revision-001',
    commerceSnapshotBindings: {
      catalog: binding('catalog'),
      modifierGraph: binding('modifier'),
      store: binding('store'),
      availability: binding('availability'),
      promotion: binding('promotion'),
    },
    eligibilityPolicyVersion: 'kfc-recommendation-policy-v1',
    experimentProfile: {
      profileId: 'merch-experiment-001',
      outputMode: 'baseline',
    },
  }),
  storeTimezone: 'Asia/Ho_Chi_Minh',
  verifiedCohorts: ['gold'],
  flow: {
    stage: 'smart_cross_sell_ready',
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

const binding = (name: string) => ({
  snapshotId: `${name}-snapshot-001`,
  digest: 'a'.repeat(64),
  sourceRevision: `${name}-revision-001`,
  observedAt: '2026-01-01T00:00:00Z',
  effectiveAt: '2026-01-01T00:00:00Z',
  expiresAt: '2027-01-01T00:00:00Z',
  complete: true,
  commerceEnvironment: 'kfc-vietnam-demo',
  provenance: { source: 'test', reference: name },
});

const candidate = (
  targetId: string,
  score: number,
  actionId = `product:${targetId}`,
): RankedCandidate => ({
  candidate: {
    action: recommendationActionSchema.parse({
      type: 'add_product',
      actionId,
      sellableItemId: targetId,
      quantity: 1,
      priceImpact: { amount: 50000, currency: 'VND' },
      cartRevision: 'merch-cart-revision-001',
    }),
    targetId,
    sellableItemId: targetId,
    categoryId: targetId === '41091' ? 'modifier' : 'chicken',
    name: `Candidate ${targetId}`,
    imageUrl: null,
    basePriceVnd: 50000,
    activeDiscountRatio: 0,
    promotionId: null,
    parentCartLineId: null,
    modifierGroupPath: [],
  },
  score,
  reasonCodes: ['popular_here'],
  featureSummary: {},
});

const policy = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 'kfc-recommendation-policy-v1',
  policyId: 'policy-001',
  name: 'Merchandising policy',
  description: 'A checked merchandising decision for the recommendation slate.',
  campaignId: 'campaign-001',
  authoredReason: 'Show a qualified recommendation selected by merchandising.',
  enabled: true,
  priority: 10,
  placement: 'smart_cross_sell',
  action: 'boost_target',
  targetIds: ['20732'],
  environment: 'kfc-vietnam-demo',
  includedStoreIds: [],
  excludedStoreIds: [],
  fulfilmentModes: [],
  minimumBasketSubtotalVnd: null,
  maximumBasketSubtotalVnd: null,
  requiredCartProductIds: [],
  excludedCartProductIds: [],
  requiredCartCategoryIds: [],
  excludedCartCategoryIds: [],
  verifiedCohorts: [],
  startsAt: '2026-01-01T00:00:00Z',
  endsAt: '2027-01-01T00:00:00Z',
  reasonCode: 'merchandising_selection',
  approvedText: { vi: 'Lựa chọn dành cho bạn', en: 'Selected for you' },
  boostWeight: 0.2,
  pinPosition: null,
  ...overrides,
});

const policies = (...entries: Record<string, unknown>[]) =>
  entries.map((entry, index) =>
    recommendationPolicySchema.parse({
      ...policy({ policyId: `policy-${String(index + 1).padStart(3, '0')}` }),
      ...entry,
    }),
  );

describe('merchandising policy snapshots', () => {
  it('strictly parses the bundled policy fixture and rejects invalid action fields', async () => {
    const loaded =
      await new LocalMerchandisingPolicyRepository().loadPublishedSnapshot();

    expect(loaded.snapshot).toMatchObject({
      schemaVersion: 'kfc-recommendation-policy-snapshot-v1',
      snapshotId: 'sanity-snapshot-001',
      sourceRevision: 'sanity-policies-revision-001',
      complete: true,
      commerceEnvironment: 'kfc-vietnam-demo',
    });
    expect(loaded.snapshot.policies).toHaveLength(5);
    expect(loaded.binding.digest).toMatch(/^[a-f0-9]{64}$/u);

    for (const invalid of [
      policy({ action: 'exclude_target', boostWeight: 0.1 }),
      policy({ action: 'pin_target', boostWeight: 0.1, pinPosition: 1 }),
      policy({ action: 'boost_target', pinPosition: 1 }),
      policy({
        action: 'suppress_placement',
        targetIds: ['20732'],
        boostWeight: null,
      }),
      policy({ action: 'replace_slate', targetIds: [], boostWeight: null }),
      policy({
        minimumBasketSubtotalVnd: 200000,
        maximumBasketSubtotalVnd: 100000,
      }),
      policy({ includedStoreIds: ['KFCVN0002', 'KFCVN0002'] }),
    ]) {
      expect(recommendationPolicySchema.safeParse(invalid).success).toBe(false);
    }
    expect(
      merchandisingPolicySnapshotSchema.safeParse({
        ...loaded.snapshot,
        unapprovedField: true,
      }).success,
    ).toBe(false);
  });

  it('loads all Sanity documents atomically through the injected published client', async () => {
    const local =
      await new LocalMerchandisingPolicyRepository().loadPublishedSnapshot();
    const fake = {
      fetch: async () =>
        [...local.snapshot.policies].reverse().map((entry, index) => ({
          ...entry,
          _id: `recommendationPolicy-${entry.policyId}`,
          _rev: `rev-${index + 1}`,
          _updatedAt: `2026-07-26T00:00:0${index}Z`,
        })),
    };
    const live = await new SanityMerchandisingPolicyRepository(
      fake as never,
    ).loadPublishedSnapshot();

    expect(live.snapshot.complete).toBe(true);
    expect(live.snapshot.policies.map((entry) => entry.policyId)).toEqual(
      [...local.snapshot.policies].map((entry) => entry.policyId).sort(),
    );
    expect(live.binding.contributingRevisions).toEqual([
      'rev-5',
      'rev-4',
      'rev-3',
      'rev-2',
      'rev-1',
    ]);

    const invalidClient = {
      fetch: async () => [
        {
          ...policy(),
          _id: 'policy-001',
          _rev: 'rev-1',
          _updatedAt: '2026-07-26T00:00:00Z',
          unexpected: true,
        },
      ],
    };
    await expect(
      new SanityMerchandisingPolicyRepository(
        invalidClient as never,
      ).loadPublishedSnapshot(),
    ).rejects.toThrow();

    const privateDocumentClient = {
      fetch: async () => [
        {
          ...policy(),
          _id: `recommendationPolicy.${policy().policyId}`,
          _rev: 'rev-private',
          _updatedAt: '2026-07-26T00:00:00Z',
        },
      ],
    };
    await expect(
      new SanityMerchandisingPolicyRepository(
        privateDocumentClient as never,
      ).loadPublishedSnapshot(),
    ).rejects.toThrow('Sanity policy document ID must match policyId');
  });

  it('applies replacement and suppression from the injected published Sanity snapshot', async () => {
    const sanityDocuments = [
      policy({
        policyId: 'sanity-replacement',
        action: 'replace_slate',
        targetIds: ['20751', '20748', '20732'],
        boostWeight: null,
      }),
      policy({
        policyId: 'sanity-suppression',
        action: 'suppress_placement',
        targetIds: [],
        boostWeight: null,
        priority: 100,
        includedStoreIds: ['KFCVN0036'],
      }),
    ].map((entry, index) => ({
      ...entry,
      _id: `recommendationPolicy-${entry.policyId}`,
      _rev: `sanity-revision-${index + 1}`,
      _updatedAt: `2026-07-26T00:00:0${index}Z`,
    }));
    const loaded = await new SanityMerchandisingPolicyRepository({
      fetch: async () => sanityDocuments,
    } as never).loadPublishedSnapshot();
    const ranked = [
      candidate('20732', 10),
      candidate('20748', 5),
      candidate('20751', 1),
    ];

    const replacement = resolveMerchandisingPolicies({
      context: context(),
      rankedCandidates: ranked,
      policies: loaded.snapshot.policies,
      cartCategoryIds: ['chicken'],
    });
    const suppressionContext = context({
      request: parseRecommendationDecisionRequest({
        ...context().request,
        storeId: 'KFCVN0036',
      }),
    });
    const storeSuppression = resolveMerchandisingPolicies({
      context: suppressionContext,
      rankedCandidates: ranked,
      policies: loaded.snapshot.policies,
      cartCategoryIds: ['chicken'],
    });

    expect(
      replacement.rankedCandidates.map((entry) => entry.candidate.targetId),
    ).toEqual(['20751', '20748', '20732']);
    expect(storeSuppression).toMatchObject({
      suppressed: true,
      replacement: null,
      rankedCandidates: [],
    });
  });

  it('matches every typed applicability constraint and sorts by priority, specificity, time, then ID', () => {
    const applicable = policies(
      {
        policyId: 'policy-c',
        priority: 20,
        includedStoreIds: ['KFCVN0002'],
        fulfilmentModes: ['pickup'],
        minimumBasketSubtotalVnd: 100000,
        maximumBasketSubtotalVnd: 200000,
        requiredCartProductIds: ['20732'],
        requiredCartCategoryIds: ['chicken'],
        verifiedCohorts: ['gold'],
        startsAt: '2026-02-01T00:00:00Z',
      },
      {
        policyId: 'policy-b',
        priority: 20,
        includedStoreIds: ['KFCVN0002'],
        startsAt: '2026-03-01T00:00:00Z',
      },
      {
        policyId: 'policy-a',
        priority: 20,
        includedStoreIds: ['KFCVN0002'],
        startsAt: '2026-03-01T00:00:00Z',
      },
      { policyId: 'policy-disabled', enabled: false },
      {
        policyId: 'policy-other-environment',
        environment: 'another-environment',
      },
      { policyId: 'policy-excluded-store', excludedStoreIds: ['KFCVN0002'] },
      { policyId: 'policy-delivery', fulfilmentModes: ['delivery'] },
      { policyId: 'policy-missing-product', requiredCartProductIds: ['20751'] },
      {
        policyId: 'policy-excluded-product',
        excludedCartProductIds: ['20732'],
      },
      {
        policyId: 'policy-missing-category',
        requiredCartCategoryIds: ['burger'],
      },
      {
        policyId: 'policy-excluded-category',
        excludedCartCategoryIds: ['chicken'],
      },
      { policyId: 'policy-cohort', verifiedCohorts: ['silver'] },
      { policyId: 'policy-min', minimumBasketSubtotalVnd: 200000 },
      { policyId: 'policy-max', maximumBasketSubtotalVnd: 100000 },
      { policyId: 'policy-not-started', startsAt: '2026-08-01T00:00:00Z' },
      { policyId: 'policy-ended', endsAt: '2026-07-01T00:00:00Z' },
    );

    expect(
      applicableMerchandisingPolicies(context(), applicable, ['chicken']).map(
        (entry) => entry.policyId,
      ),
    ).toEqual(['policy-c', 'policy-a', 'policy-b']);
  });

  it('orders matching policies by priority before the remaining sort keys', () => {
    expect(
      applicableMerchandisingPolicies(
        context(),
        policies(
          { policyId: 'policy-lower-priority', priority: 10 },
          { policyId: 'policy-higher-priority', priority: 20 },
        ),
        ['chicken'],
      ).map((entry) => entry.policyId),
    ).toEqual(['policy-higher-priority', 'policy-lower-priority']);
  });

  it('orders equally specific, equally prioritized policies by latest start time', () => {
    expect(
      applicableMerchandisingPolicies(
        context(),
        policies(
          {
            policyId: 'policy-earlier',
            startsAt: '2026-02-01T00:00:00Z',
          },
          {
            policyId: 'policy-later',
            startsAt: '2026-03-01T00:00:00Z',
          },
        ),
        ['chicken'],
      ).map((entry) => entry.policyId),
    ).toEqual(['policy-later', 'policy-earlier']);
  });

  it('omits exclusion effects superseded by a winning suppression', () => {
    const result = resolveMerchandisingPolicies({
      context: context(),
      rankedCandidates: [candidate('20712', 10), candidate('20732', 4)],
      policies: policies(
        { action: 'exclude_target', targetIds: ['20712'], boostWeight: null },
        {
          action: 'suppress_placement',
          targetIds: [],
          boostWeight: null,
          priority: 1,
        },
      ),
      cartCategoryIds: ['chicken'],
    });

    expect(result.effects).toEqual([
      expect.objectContaining({
        action: 'suppress_placement',
        targetActionId: null,
      }),
    ]);
  });

  it('ignores a zero-weight boost with no score or order change', () => {
    const ranked = [candidate('20732', 4), candidate('20751', 3)];
    const result = resolveMerchandisingPolicies({
      context: context(),
      rankedCandidates: ranked,
      policies: policies({
        action: 'boost_target',
        targetIds: ['20732'],
        boostWeight: 0,
      }),
      cartCategoryIds: ['chicken'],
    });

    expect(result.rankedCandidates).toEqual(ranked);
    expect(result.effects).toEqual([]);
    expect(result.reasonCodes).toEqual([]);
  });

  it('uses suppression instead of an otherwise valid replacement', () => {
    const result = resolveMerchandisingPolicies({
      context: context(),
      rankedCandidates: [candidate('20732', 4)],
      policies: policies(
        { action: 'replace_slate', targetIds: ['20732'], boostWeight: null },
        {
          action: 'suppress_placement',
          targetIds: [],
          boostWeight: null,
          priority: 1,
        },
      ),
      cartCategoryIds: ['chicken'],
    });

    expect(result).toMatchObject({
      suppressed: true,
      replacement: null,
      rankedCandidates: [],
    });
    expect(result.effects).toEqual([
      expect.objectContaining({ action: 'suppress_placement' }),
    ]);
  });

  it('applies only the strongest positive boost for a target', () => {
    const result = resolveMerchandisingPolicies({
      context: context(),
      rankedCandidates: [candidate('20732', 4), candidate('20751', 3)],
      policies: policies(
        {
          action: 'boost_target',
          targetIds: ['20732'],
          boostWeight: 0.1,
          priority: 70,
        },
        {
          action: 'boost_target',
          targetIds: ['20732'],
          boostWeight: 0.9,
          priority: 60,
        },
      ),
      cartCategoryIds: ['chicken'],
    });

    expect(result.rankedCandidates[0]).toMatchObject({
      candidate: { targetId: '20732' },
      score: 4.9,
    });
    expect(result.effects).toEqual([
      expect.objectContaining({
        action: 'boost_target',
        targetActionId: 'product:20732',
      }),
    ]);
  });

  it('moves a pinned target and records the material pin effect', () => {
    const result = resolveMerchandisingPolicies({
      context: context(),
      rankedCandidates: [
        candidate('20732', 4),
        candidate('41091', 1, 'modifier:line-20732:41091'),
      ],
      policies: policies({
        action: 'pin_target',
        targetIds: ['41091'],
        boostWeight: null,
        pinPosition: 1,
      }),
      cartCategoryIds: ['chicken'],
    });

    expect(result.rankedCandidates[0]?.candidate.action.actionId).toBe(
      'modifier:line-20732:41091',
    );
    expect(result.effects).toEqual([
      expect.objectContaining({
        action: 'pin_target',
        targetActionId: 'modifier:line-20732:41091',
      }),
    ]);
  });

  it('omits a pin effect when the target is already in position', () => {
    const ranked = [
      candidate('41091', 10, 'modifier:line-20732:41091'),
      candidate('20732', 4),
    ];
    const result = resolveMerchandisingPolicies({
      context: context(),
      rankedCandidates: ranked,
      policies: policies({
        action: 'pin_target',
        targetIds: ['41091'],
        boostWeight: null,
        pinPosition: 1,
      }),
      cartCategoryIds: ['chicken'],
    });

    expect(result.rankedCandidates).toEqual(ranked);
    expect(result.effects).toEqual([]);
  });

  it('skips an invalid-size smart cross-sell replacement atomically', () => {
    const ranked = [
      candidate('20732', 4, '20732'),
      candidate('20751', 3, '20751'),
      candidate('20748', 2, '20748'),
    ];
    const result = resolveMerchandisingPolicies({
      context: context(),
      rankedCandidates: ranked,
      policies: policies({
        action: 'replace_slate',
        targetIds: ['20751', '20732'],
        boostWeight: null,
      }),
      cartCategoryIds: ['chicken'],
    });

    expect(result.replacement).toBeNull();
    expect(
      result.rankedCandidates.map((entry) => entry.candidate.action.actionId),
    ).toEqual(['20732', '20751', '20748']);
  });

  it('preserves ordered Smart Cross-sell replacement targets as the baseline', () => {
    const result = resolveMerchandisingPolicies({
      context: context(),
      rankedCandidates: [
        candidate('20732', 10),
        candidate('20748', 5),
        candidate('20751', 1),
      ],
      policies: policies({
        action: 'replace_slate',
        targetIds: ['20751', '20748', '20732'],
        boostWeight: null,
      }),
      cartCategoryIds: ['chicken'],
    });

    expect(
      result.rankedCandidates.map((entry) => entry.candidate.targetId),
    ).toEqual(['20751', '20748', '20732']);
    expect(result.effects.map((effect) => effect.targetActionId)).toEqual([
      'product:20751',
      'product:20748',
      'product:20732',
    ]);
  });

  it('skips an otherwise valid-size Smart Cross-sell replacement with a missing eligible target', () => {
    const ranked = [
      candidate('20732', 4),
      candidate('20751', 3),
      candidate('20748', 2),
    ];
    const result = resolveMerchandisingPolicies({
      context: context(),
      rankedCandidates: ranked,
      policies: policies({
        action: 'replace_slate',
        targetIds: ['20751', '20732', 'does-not-exist'],
        boostWeight: null,
      }),
      cartCategoryIds: ['chicken'],
    });

    expect(result.replacement).toBeNull();
    expect(
      result.rankedCandidates.map((entry) => entry.candidate.action.actionId),
    ).toEqual(['product:20732', 'product:20751', 'product:20748']);
    expect(result.effects).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'replace_slate' }),
      ]),
    );
  });

  it('excludes by target ID without resurrecting the action and records its real action ID', () => {
    const result = resolveMerchandisingPolicies({
      context: context(),
      rankedCandidates: [candidate('20712', 10), candidate('20732', 4)],
      policies: policies(
        { action: 'exclude_target', targetIds: ['20712'], boostWeight: null },
        { action: 'boost_target', targetIds: ['20712'], boostWeight: 1 },
      ),
      cartCategoryIds: ['chicken'],
    });

    expect(
      result.rankedCandidates.map((entry) => entry.candidate.action.actionId),
    ).toEqual(['product:20732']);
    expect(result.effects).toEqual([
      expect.objectContaining({
        action: 'exclude_target',
        targetActionId: 'product:20712',
      }),
    ]);
  });
});
