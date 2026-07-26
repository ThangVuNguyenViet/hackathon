import { describe, expect, it } from 'vitest';
import { enumeratePotentialCandidates } from '../../src/recommendations/eligibility/enumerate-candidates.js';
import {
  createEligibilityDecision,
  evaluateEligibility,
} from '../../src/recommendations/eligibility/evaluate-eligibility.js';
import type { RecommendationDecisionContext } from '../../src/recommendations/eligibility/types.js';
import {
  BundledCommerceFactsRepository,
  BundledPromotionFactsRepository,
} from '../../src/recommendations/snapshots/bundled-repositories.js';
import { parseRecommendationDecisionRequest } from '../../src/recommendations/domain/schemas.js';

const commerceFacts = new BundledCommerceFactsRepository().load();
const promotionFacts = new BundledPromotionFactsRepository().load();

const makeContext = (
  overrides: Partial<RecommendationDecisionContext> = {},
): RecommendationDecisionContext => {
  const request = parseRecommendationDecisionRequest({
    schemaVersion: 'kfc-recommendation-v1',
    requestId: 'rec-request-eligibility-001',
    idempotencyKey: 'idempotency-eligibility-001',
    orderFlowId: 'journey-eligibility-001',
    sessionId: 'session-eligibility-001',
    placement: 'local_favorite',
    verifiedCustomerRef: null,
    storeId: 'KFCVN0002',
    fulfilmentMode: 'pickup',
    decisionTime: '2026-07-27T09:00:00Z',
    cart: {
      cartId: 'cart-eligibility-001',
      revision: 'cart-revision-eligibility-001',
      subtotal: { amount: 0, currency: 'VND' },
      lines: [],
    },
    cartRevision: 'cart-revision-eligibility-001',
    commerceSnapshotBindings: {
      catalog: {
        snapshotId: 'catalog-eligibility-001',
        digest: 'a'.repeat(64),
        sourceRevision: 'catalog-revision-001',
        observedAt: '2026-07-27T08:00:00Z',
        effectiveAt: '2026-07-27T08:00:00Z',
        expiresAt: '2026-07-27T10:00:00Z',
        complete: true,
        commerceEnvironment: 'kfc-vietnam-demo',
        provenance: { source: 'test', reference: 'catalog' },
      },
      modifierGraph: {
        snapshotId: 'modifier-eligibility-001',
        digest: 'b'.repeat(64),
        sourceRevision: 'modifier-revision-001',
        observedAt: '2026-07-27T08:00:00Z',
        effectiveAt: '2026-07-27T08:00:00Z',
        expiresAt: '2026-07-27T10:00:00Z',
        complete: true,
        commerceEnvironment: 'kfc-vietnam-demo',
        provenance: { source: 'test', reference: 'modifier' },
      },
      store: {
        snapshotId: 'store-eligibility-001',
        digest: 'c'.repeat(64),
        sourceRevision: 'store-revision-001',
        observedAt: '2026-07-27T08:00:00Z',
        effectiveAt: '2026-07-27T08:00:00Z',
        expiresAt: '2026-07-27T10:00:00Z',
        complete: true,
        commerceEnvironment: 'kfc-vietnam-demo',
        provenance: { source: 'test', reference: 'store' },
      },
      availability: {
        snapshotId: 'availability-eligibility-001',
        digest: 'd'.repeat(64),
        sourceRevision: 'availability-revision-001',
        observedAt: '2026-07-27T08:00:00Z',
        effectiveAt: '2026-07-27T08:00:00Z',
        expiresAt: '2026-07-27T10:00:00Z',
        complete: true,
        commerceEnvironment: 'kfc-vietnam-demo',
        provenance: { source: 'test', reference: 'availability' },
      },
      promotion: {
        snapshotId: 'promotion-eligibility-001',
        digest: 'e'.repeat(64),
        sourceRevision: 'promotion-revision-001',
        observedAt: '2026-07-27T08:00:00Z',
        effectiveAt: '2026-07-27T08:00:00Z',
        expiresAt: '2026-07-27T10:00:00Z',
        complete: true,
        commerceEnvironment: 'kfc-vietnam-demo',
        provenance: { source: 'test', reference: 'promotion' },
      },
    },
    eligibilityPolicyVersion: 'kfc-recommendation-policy-v1',
    experimentProfile: {
      profileId: 'experiment-eligibility-001',
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
};

const candidatesFor = (context: RecommendationDecisionContext) =>
  enumeratePotentialCandidates({ context, commerceFacts, promotionFacts });

const decisionsFor = async (context: RecommendationDecisionContext) => {
  const candidates = candidatesFor(context);
  return {
    candidates,
    decisions: await evaluateEligibility({
      context,
      candidates,
      commerceFacts,
    }),
  };
};

const decisionFor = async (
  context: RecommendationDecisionContext,
  actionId: string,
) => {
  const { decisions } = await decisionsFor(context);
  const decision = decisions.find((entry) => entry.actionId === actionId);
  expect(decision).toBeDefined();
  return decision!;
};

describe('recommendation eligibility', () => {
  it('enumerates every product before Local Favorite hard filtering', async () => {
    const context = makeContext();
    const { candidates, decisions } = await decisionsFor(context);

    expect(candidates).toHaveLength(120);
    expect(candidates.map((candidate) => candidate.action.actionId)).toEqual(
      [...candidates.map((candidate) => candidate.action.actionId)].sort(),
    );
    expect(
      candidates.find((candidate) => candidate.targetId === '40657'),
    ).toMatchObject({
      action: { actionId: 'product:40657', type: 'add_product' },
      basePriceVnd: 0,
    });
    expect(
      candidates.find((candidate) => candidate.targetId === '20732'),
    ).toMatchObject({
      activeDiscountRatio: 50000 / 239000,
      promotionId: 'poc-discount-20732',
    });
    expect(
      candidates.find((candidate) => candidate.targetId === '41172'),
    ).toMatchObject({
      activeDiscountRatio: 0,
      promotionId: null,
    });
    expect(decisions).toHaveLength(candidates.length);
    expect(new Set(decisions.map((decision) => decision.actionId)).size).toBe(
      candidates.length,
    );
  });

  it('records KFCVN0002 pickup blocking and preserves eligible 20751', async () => {
    const context = makeContext();

    await expect(decisionFor(context, 'product:20701')).resolves.toMatchObject({
      eligible: false,
      reasonCodes: ['store_unavailable'],
    });
    await expect(decisionFor(context, 'product:20751')).resolves.toMatchObject({
      eligible: true,
      reasonCodes: ['eligible'],
    });
  });

  it('records zero-price giveaway/category entries as non-sellable', async () => {
    await expect(
      decisionFor(makeContext(), 'product:40657'),
    ).resolves.toMatchObject({
      eligible: false,
      reasonCodes: expect.arrayContaining(['non_sellable_product']),
    });
  });

  it('records placement readiness/history and catalog availability facts', async () => {
    const attempted = makeContext({
      flow: {
        stage: 'starter_ready',
        attemptedPlacements: ['local_favorite'],
        previouslyShownActionIds: [],
        rejectedActionIds: [],
      },
    });
    await expect(
      decisionFor(attempted, 'product:20751'),
    ).resolves.toMatchObject({
      reasonCodes: ['placement_already_attempted'],
    });

    const notReady = makeContext({
      flow: {
        stage: 'complete',
        attemptedPlacements: [],
        previouslyShownActionIds: [],
        rejectedActionIds: [],
      },
    });
    await expect(decisionFor(notReady, 'product:20751')).resolves.toMatchObject(
      {
        reasonCodes: ['placement_not_yet_eligible'],
      },
    );

    const localWithHistory = makeContext({
      request: parseRecommendationDecisionRequest({
        ...makeContext().request,
        verifiedCustomerRef: 'customer-001',
      }),
      customerHistory: {
        verifiedCustomerRef: 'customer-001',
        completedOrders: [
          {
            orderId: 'order-001',
            completedAt: '2026-07-27T08:00:00Z',
            lines: [],
          },
        ],
      },
    });
    await expect(
      decisionFor(localWithHistory, 'product:20751'),
    ).resolves.toMatchObject({ reasonCodes: ['zero_history_required'] });

    const unavailableFacts = structuredClone(commerceFacts);
    const unavailableItem = unavailableFacts.menuItems.find(
      (item) => item.itemId === '20751',
    );
    expect(unavailableItem).toBeDefined();
    unavailableItem!.available = false;
    const candidate = candidatesFor(makeContext()).find(
      (entry) => entry.action.actionId === 'product:20751',
    );
    expect(candidate).toBeDefined();
    const [unavailableDecision] = await evaluateEligibility({
      context: makeContext(),
      candidates: [candidate!],
      commerceFacts: unavailableFacts,
    });
    expect(unavailableDecision.reasonCodes).toContain('catalog_unavailable');
  });

  it('records cart, shown, rejected, and dietary product exclusions', async () => {
    const context = makeContext({
      request: parseRecommendationDecisionRequest({
        ...makeContext().request,
        cart: {
          ...makeContext().request.cart,
          lines: [
            {
              lineId: 'line-20751',
              sellableItemId: '20751',
              quantity: 1,
              unitPrice: { amount: 99000, currency: 'VND' },
              modifiers: [],
            },
          ],
        },
      }),
      flow: {
        stage: 'starter_ready',
        attemptedPlacements: [],
        previouslyShownActionIds: ['product:20732'],
        rejectedActionIds: ['product:20748'],
      },
      verifiedDietaryEvidence: {
        evidenceId: 'dietary-evidence-001',
        excludedSellableItemIds: ['41127'],
      },
    });

    await expect(decisionFor(context, 'product:20751')).resolves.toMatchObject({
      reasonCodes: ['already_in_cart'],
    });
    await expect(decisionFor(context, 'product:20732')).resolves.toMatchObject({
      reasonCodes: ['previously_shown'],
    });
    await expect(decisionFor(context, 'product:20748')).resolves.toMatchObject({
      reasonCodes: ['previously_rejected'],
    });
    await expect(decisionFor(context, 'product:41127')).resolves.toMatchObject({
      reasonCodes: ['verified_dietary_exclusion'],
    });
  });

  it('requires matching verified pre-decision completed history for For You', async () => {
    const request = parseRecommendationDecisionRequest({
      ...makeContext().request,
      placement: 'for_you',
      verifiedCustomerRef: 'customer-001',
    });
    const missingHistory = makeContext({ request });
    const mismatchedHistory = makeContext({
      request,
      customerHistory: {
        verifiedCustomerRef: 'customer-other',
        completedOrders: [
          {
            orderId: 'order-001',
            completedAt: '2026-07-27T08:00:00Z',
            lines: [],
          },
        ],
      },
    });
    const zeroHistory = makeContext({
      request,
      customerHistory: {
        verifiedCustomerRef: 'customer-001',
        completedOrders: [],
      },
    });
    const validHistory = makeContext({
      request,
      customerHistory: {
        verifiedCustomerRef: 'customer-001',
        completedOrders: [
          {
            orderId: 'order-001',
            completedAt: '2026-07-27T08:00:00Z',
            lines: [
              { sellableItemId: '20751', categoryId: '20000', quantity: 1 },
            ],
          },
          {
            orderId: 'order-after-decision',
            completedAt: '2026-07-27T10:00:00Z',
            lines: [],
          },
        ],
      },
    });

    await expect(
      decisionFor(missingHistory, 'product:20751'),
    ).resolves.toMatchObject({
      reasonCodes: ['verified_history_required'],
    });
    await expect(
      decisionFor(mismatchedHistory, 'product:20751'),
    ).resolves.toMatchObject({
      reasonCodes: ['verified_history_required'],
    });
    await expect(
      decisionFor(zeroHistory, 'product:20751'),
    ).resolves.toMatchObject({
      reasonCodes: ['zero_history_required'],
    });
    await expect(
      decisionFor(validHistory, 'product:20751'),
    ).resolves.toMatchObject({
      eligible: true,
      reasonCodes: ['eligible'],
    });

    const equalFractionalInstant = makeContext({
      request: parseRecommendationDecisionRequest({
        ...request,
        decisionTime: '2026-07-27T09:00:00.1Z',
      }),
      customerHistory: {
        verifiedCustomerRef: 'customer-001',
        completedOrders: [
          {
            orderId: 'order-equal-fractional-time',
            completedAt: '2026-07-27T09:00:00.10Z',
            lines: [],
          },
        ],
      },
    });
    await expect(
      decisionFor(equalFractionalInstant, 'product:20751'),
    ).resolves.toMatchObject({ reasonCodes: ['zero_history_required'] });
  });

  it('recursively enumerates 20752 modifiers and records price/capacity/parent guards', async () => {
    const request = parseRecommendationDecisionRequest({
      ...makeContext().request,
      placement: 'modifier_upsell',
      cart: {
        ...makeContext().request.cart,
        lines: [
          {
            lineId: 'line-20752',
            sellableItemId: '20752',
            quantity: 1,
            unitPrice: { amount: 129000, currency: 'VND' },
            modifiers: [
              {
                groupPath: ['2'],
                optionId: '41089',
                quantity: 1,
                priceImpact: { amount: 0, currency: 'VND' },
              },
            ],
          },
        ],
      },
    });
    const context = makeContext({
      request,
      flow: {
        stage: 'modifier_ready',
        attemptedPlacements: [],
        previouslyShownActionIds: [],
        rejectedActionIds: [],
      },
      parentCartLineId: 'line-20752',
    });
    const candidates = candidatesFor(context);

    expect(candidates).toContainEqual(
      expect.objectContaining({
        targetId: '41091',
        modifierGroupPath: ['2'],
        action: expect.objectContaining({
          actionId: 'modifier:line-20752:2:41091',
        }),
      }),
    );
    expect(candidates).toContainEqual(
      expect.objectContaining({
        targetId: '41102',
        modifierGroupPath: ['3'],
        action: expect.objectContaining({
          actionId: 'modifier:line-20752:3:41102',
        }),
      }),
    );
    await expect(
      decisionFor(context, 'modifier:line-20752:2:41091'),
    ).resolves.toMatchObject({ reasonCodes: ['modifier_group_at_capacity'] });
    await expect(
      decisionFor(context, 'modifier:line-20752:3:41102'),
    ).resolves.toMatchObject({ eligible: true, reasonCodes: ['eligible'] });
    await expect(
      decisionFor(context, 'modifier:line-20752:2:41089'),
    ).resolves.toMatchObject({
      reasonCodes: ['modifier_group_at_capacity', 'no_positive_price_modifier'],
    });

    const positiveCandidate = candidates.find(
      (candidate) =>
        candidate.action.actionId === 'modifier:line-20752:3:41102',
    );
    expect(positiveCandidate?.action.type).toBe('apply_modifier');
    if (
      !positiveCandidate ||
      positiveCandidate.action.type !== 'apply_modifier'
    ) {
      throw new Error('Expected positive modifier candidate');
    }
    const missingParent = makeContext({
      ...context,
      parentCartLineId: 'line-other',
    });
    const [missingParentDecision] = await evaluateEligibility({
      context: missingParent,
      candidates: [positiveCandidate],
      commerceFacts,
    });
    expect(missingParentDecision).toMatchObject({
      reasonCodes: ['parent_cart_line_required'],
    });
    const [mismatchDecision] = await evaluateEligibility({
      context,
      candidates: [
        {
          ...positiveCandidate,
          parentCartLineId: 'line-other',
        },
      ],
      commerceFacts,
    });
    expect(mismatchDecision).toMatchObject({
      reasonCodes: ['modifier_parent_mismatch'],
    });
  });

  it('propagates a real modifier parent timeslot block without product-only reasons', async () => {
    const request = parseRecommendationDecisionRequest({
      ...makeContext().request,
      placement: 'modifier_upsell',
      cart: {
        ...makeContext().request.cart,
        lines: [
          {
            lineId: 'line-20701',
            sellableItemId: '20701',
            quantity: 1,
            unitPrice: { amount: 79000, currency: 'VND' },
            modifiers: [],
          },
        ],
      },
    });
    const context = makeContext({
      request,
      flow: {
        stage: 'modifier_ready',
        attemptedPlacements: [],
        previouslyShownActionIds: ['modifier:line-20701:1:41042'],
        rejectedActionIds: ['modifier:line-20701:1:41042'],
      },
      parentCartLineId: 'line-20701',
      verifiedDietaryEvidence: {
        evidenceId: 'dietary-evidence-parent-20701',
        excludedSellableItemIds: ['20701'],
      },
    });

    const decision = await decisionFor(context, 'modifier:line-20701:1:41042');

    expect(decision.reasonCodes).toEqual([
      'store_unavailable',
      'no_positive_price_modifier',
    ]);
    expect(decision.reasonCodes).not.toEqual(
      expect.arrayContaining([
        'already_in_cart',
        'previously_shown',
        'previously_rejected',
        'verified_dietary_exclusion',
      ]),
    );
  });

  it('changes the eligibility digest when an evidence binding changes', async () => {
    const original = await createEligibilityDecision({
      actionId: 'product:20751',
      eligible: false,
      reasonCodes: ['previously_shown'],
      evidenceBindings: ['shown:product:20751'],
    });
    const changed = await createEligibilityDecision({
      actionId: 'product:20751',
      eligible: false,
      reasonCodes: ['previously_shown'],
      evidenceBindings: ['shown:product:20751:revision-2'],
    });

    expect(changed.digest).not.toBe(original.digest);
  });
});
