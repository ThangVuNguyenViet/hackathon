import { describe, expect, it } from 'vitest';
import type {
  RecommendationDecisionResponse,
  RecommendationEvent,
} from '../../src/recommendations/domain/contracts.js';
import {
  parseRecommendationDecisionResponse,
  parseRecommendationEvent,
} from '../../src/recommendations/domain/schemas.js';
import {
  applyCustomerRequestedRecommendationDecision,
  applyCustomerRequestedRecommendationOutcome,
  applyRecommendationDecision,
  applyRecommendationImpression,
  applyRecommendationOutcome,
  flowForDecision,
  initialRecommendationState,
} from '../../src/recommendations/state/state-machine.js';

const versionBindings = {
  catalog: 'catalog-snapshot-001',
  modifierGraph: 'modifier-graph-snapshot-001',
  store: 'store-snapshot-001',
  availability: 'availability-snapshot-001',
  promotion: 'promotion-snapshot-001',
  eligibilityPolicy: 'kfc-recommendation-policy-v1',
  sanitySnapshot: {
    snapshotId: 'sanity-snapshot-001',
    digest: 'f'.repeat(64),
    contributingRevisions: ['sanity-policies-revision-001'],
  },
  featureSchema: 'feature-schema-001',
  servingRanker: 'ranker-001',
  shadowModel: null,
  calibration: null,
  experiment: 'experiment-001',
  loggingPolicy: 'logging-policy-001',
};

function decision(input: {
  placement: RecommendationDecisionResponse['placement'];
  status?: RecommendationDecisionResponse['status'];
}): RecommendationDecisionResponse {
  const status = input.status ?? 'recommended';
  const actionIds =
    input.placement === 'smart_cross_sell'
      ? ['action-smart-001', 'action-smart-002', 'action-smart-003']
      : [`action-${input.placement}-001`];
  const actions = actionIds.map((actionId) =>
    input.placement === 'modifier_upsell'
      ? {
          type: 'apply_modifier' as const,
          actionId,
          parentCartLineId: 'cart-line-001',
          parentSellableItemId: 'sellable-item-001',
          optionId: 'modifier-option-001',
          groupPath: ['modifier-group-001'],
          quantity: 1,
          priceImpact: { amount: 5000, currency: 'VND' as const },
          cartRevision: 'cart-revision-001',
        }
      : {
          type: 'add_product' as const,
          actionId,
          sellableItemId: `sellable-${actionId}`,
          quantity: 1,
          priceImpact: { amount: 5000, currency: 'VND' as const },
          cartRevision: 'cart-revision-001',
        },
  );
  return parseRecommendationDecisionResponse({
    schemaVersion: 'kfc-recommendation-v1',
    recommendationId: `recommendation-${input.placement}-001`,
    requestId: `request-${input.placement}-001`,
    orderFlowId: 'order-flow-001',
    placement: input.placement,
    status,
    decisionSource: status === 'suppressed' ? 'suppressed' : 'ranked',
    primaryOffer: status === 'recommended' ? { actions } : null,
    displayFacts:
      status === 'recommended'
        ? actionIds.map((actionId) => ({
            actionId,
            name: actionId,
            imageUrl: null,
            priceImpact: { amount: 5000, currency: 'VND' as const },
          }))
        : [],
    reasonCodes: [],
    merchandisingEffects: [],
    versionBindings,
    counts: {
      potential: 1,
      eligible: status === 'recommended' ? 1 : 0,
      ineligible: status === 'recommended' ? 0 : 1,
      scored: status === 'recommended' ? 1 : 0,
      displayed: status === 'recommended' ? actionIds.length : 0,
      complete: true,
    },
    traceRef: `trace-${input.placement}-001`,
  });
}

function outcome(input: {
  eventId: string;
  placement: RecommendationEvent['placement'];
  eventType: RecommendationEvent['eventType'];
  actionId?: string | null;
  recommendationId?: string | null;
  requestId?: string;
  cartRevision?: string | null;
}): RecommendationEvent {
  return parseRecommendationEvent({
    schemaVersion: 'kfc-recommendation-event-v1',
    eventId: input.eventId,
    eventType: input.eventType,
    recommendationId:
      input.recommendationId ?? `recommendation-${input.placement}-001`,
    requestId: input.requestId ?? `request-${input.placement}-001`,
    orderFlowId: 'order-flow-001',
    sessionId: 'session-001',
    placement: input.placement,
    occurredAt: '2026-07-27T09:00:10Z',
    recordedAt: '2026-07-27T09:00:11Z',
    actor: 'client',
    actionId:
      input.actionId === undefined
        ? `action-${input.placement}-001`
        : input.actionId,
    cartRevision: input.cartRevision ?? 'cart-revision-001',
    versionBindings,
    payload: {},
  });
}

function modifierPending() {
  const modifierEligible = applyRecommendationOutcome(
    applyRecommendationDecision(
      initialRecommendationState('order-flow-001'),
      decision({ placement: 'for_you' }),
      '2026-07-27T09:00:00Z',
    ),
    outcome({
      eventId: 'event-starter-mutation-001',
      placement: 'for_you',
      eventType: 'cart_mutation_succeeded',
    }),
    ['action-for_you-001'],
  );
  return applyRecommendationDecision(
    modifierEligible,
    decision({ placement: 'modifier_upsell' }),
    '2026-07-27T09:01:00Z',
  );
}

function smartEligible() {
  return {
    ...initialRecommendationState('order-flow-001'),
    revision: 3,
    stage: 'smart_cross_sell_eligible' as const,
    nextEligiblePlacement: 'smart_cross_sell' as const,
  };
}

function smartPending() {
  return applyRecommendationDecision(
    smartEligible(),
    decision({ placement: 'smart_cross_sell' }),
    '2026-07-27T09:02:00Z',
  );
}

describe('durable recommendation state machine', () => {
  it('initializes a new order flow at starter eligibility', () => {
    expect(initialRecommendationState('order-flow-001')).toEqual({
      schemaVersion: 'kfc-recommendation-state-v1',
      revision: 0,
      orderFlowId: 'order-flow-001',
      stage: 'starter_eligible',
      attemptedPlacements: [],
      shownActionIds: [],
      rejectedActionIds: [],
      pendingRecommendation: null,
      recordedOutcomeEventIds: [],
      nextEligiblePlacement: 'starter',
    });
  });

  it('maps eligible and wrong-stage proactive decisions to engine flow', () => {
    const state = initialRecommendationState('order-flow-001');

    expect(flowForDecision(state, 'for_you', 'proactive')).toMatchObject({
      stage: 'starter_ready',
      attemptedPlacements: [],
    });
    expect(flowForDecision(state, 'modifier_upsell', 'proactive').stage).toBe(
      'complete',
    );
  });

  it('moves a starter recommendation to a pending starter decision', () => {
    const state = initialRecommendationState('order-flow-001');
    const next = applyRecommendationDecision(
      state,
      decision({ placement: 'for_you' }),
      '2026-07-27T09:00:00Z',
    );

    expect(next).toMatchObject({
      revision: 1,
      stage: 'starter_resolved',
      attemptedPlacements: ['for_you'],
      nextEligiblePlacement: null,
      pendingRecommendation: {
        placement: 'for_you',
        actionIds: ['action-for_you-001'],
      },
    });
    expect(state.revision).toBe(0);
  });

  it('advances a starter cart mutation to modifier eligibility', () => {
    const starter = applyRecommendationDecision(
      initialRecommendationState('order-flow-001'),
      decision({ placement: 'local_favorite' }),
      '2026-07-27T09:00:00Z',
    );
    const next = applyRecommendationOutcome(
      starter,
      outcome({
        eventId: 'event-starter-mutation-001',
        placement: 'local_favorite',
        eventType: 'cart_mutation_succeeded',
      }),
      ['action-local_favorite-001'],
    );

    expect(next).toMatchObject({
      revision: 2,
      stage: 'modifier_eligible',
      nextEligiblePlacement: 'modifier_upsell',
      pendingRecommendation: null,
    });
  });

  it('moves an empty modifier decision through resolved to Smart Cross-sell eligibility', () => {
    const modifierEligible = applyRecommendationOutcome(
      applyRecommendationDecision(
        initialRecommendationState('order-flow-001'),
        decision({ placement: 'for_you' }),
        '2026-07-27T09:00:00Z',
      ),
      outcome({
        eventId: 'event-starter-mutation-001',
        placement: 'for_you',
        eventType: 'cart_mutation_succeeded',
      }),
      ['action-for_you-001'],
    );
    const next = applyRecommendationDecision(
      modifierEligible,
      decision({ placement: 'modifier_upsell', status: 'empty' }),
      '2026-07-27T09:01:00Z',
    );

    expect(next).toMatchObject({
      revision: 3,
      stage: 'smart_cross_sell_eligible',
      nextEligiblePlacement: 'smart_cross_sell',
      pendingRecommendation: null,
    });
  });

  it('moves a dismissed modifier to Smart Cross-sell eligibility and rejects its displayed actions', () => {
    const modifier = modifierPending();
    const next = applyRecommendationOutcome(
      modifier,
      outcome({
        eventId: 'event-modifier-dismissed-001',
        placement: 'modifier_upsell',
        eventType: 'explicitly_dismissed',
      }),
      ['action-modifier_upsell-001'],
    );

    expect(next).toMatchObject({
      revision: 4,
      stage: 'smart_cross_sell_eligible',
      nextEligiblePlacement: 'smart_cross_sell',
      pendingRecommendation: null,
      rejectedActionIds: ['action-modifier_upsell-001'],
    });
  });

  it('moves an ignored Smart Cross-sell recommendation to complete without rejection', () => {
    const smart = smartPending();
    const next = applyRecommendationOutcome(
      smart,
      outcome({
        eventId: 'event-smart-ignored-001',
        placement: 'smart_cross_sell',
        eventType: 'ignored',
        actionId: 'action-smart-001',
      }),
      ['action-smart-001', 'action-smart-002', 'action-smart-003'],
    );

    expect(next).toMatchObject({
      revision: 5,
      stage: 'complete',
      nextEligiblePlacement: null,
      pendingRecommendation: null,
      rejectedActionIds: [],
    });
  });

  it('records impression actions once and ignores duplicate outcomes byte-for-byte', () => {
    const pending = applyRecommendationDecision(
      initialRecommendationState('order-flow-001'),
      decision({ placement: 'for_you' }),
      '2026-07-27T09:00:00Z',
    );
    const impressed = applyRecommendationImpression(
      pending,
      outcome({
        eventId: 'event-impression-001',
        placement: 'for_you',
        eventType: 'impression_rendered',
      }),
    );
    const dismissed = applyRecommendationOutcome(
      impressed,
      outcome({
        eventId: 'event-dismissed-001',
        placement: 'for_you',
        eventType: 'explicitly_dismissed',
      }),
      ['action-for_you-001'],
    );

    expect(impressed.shownActionIds).toEqual(['action-for_you-001']);
    expect(dismissed.rejectedActionIds).toEqual(['action-for_you-001']);
    expect(
      applyRecommendationOutcome(
        dismissed,
        outcome({
          eventId: 'event-dismissed-001',
          placement: 'for_you',
          eventType: 'explicitly_dismissed',
        }),
        ['action-for_you-001'],
      ),
    ).toEqual(dismissed);
  });

  it('does not advance a starter on selection before cart mutation succeeds', () => {
    const starter = applyRecommendationDecision(
      initialRecommendationState('order-flow-001'),
      decision({ placement: 'for_you' }),
      '2026-07-27T09:00:00Z',
    );
    const next = applyRecommendationOutcome(
      starter,
      outcome({
        eventId: 'event-starter-selected-001',
        placement: 'for_you',
        eventType: 'selected',
      }),
      ['action-for_you-001'],
    );

    expect(next).toMatchObject({
      revision: 2,
      stage: 'starter_resolved',
      pendingRecommendation: { placement: 'for_you' },
    });
  });

  it('advances a failed starter mutation to modifier eligibility', () => {
    const starter = applyRecommendationDecision(
      initialRecommendationState('order-flow-001'),
      decision({ placement: 'for_you' }),
      '2026-07-27T09:00:00Z',
    );
    const selected = applyRecommendationOutcome(
      starter,
      outcome({
        eventId: 'event-starter-selected-before-failure-001',
        placement: 'for_you',
        eventType: 'selected',
      }),
      ['action-for_you-001'],
    );
    const failed = applyRecommendationOutcome(
      selected,
      outcome({
        eventId: 'event-starter-mutation-failed-001',
        placement: 'for_you',
        eventType: 'cart_mutation_failed',
      }),
      ['action-for_you-001'],
    );

    expect(failed).toMatchObject({
      stage: 'modifier_eligible',
      pendingRecommendation: null,
      nextEligiblePlacement: 'modifier_upsell',
    });
  });

  it('advances a dismissed starter and rejects every displayed action', () => {
    const starter = applyRecommendationDecision(
      initialRecommendationState('order-flow-001'),
      decision({ placement: 'for_you' }),
      '2026-07-27T09:00:00Z',
    );
    const dismissed = applyRecommendationOutcome(
      starter,
      outcome({
        eventId: 'event-starter-dismissed-001',
        placement: 'for_you',
        eventType: 'explicitly_dismissed',
        actionId: null,
      }),
      ['action-for_you-001', 'action-for_you-002'],
    );

    expect(dismissed).toMatchObject({
      stage: 'modifier_eligible',
      pendingRecommendation: null,
      nextEligiblePlacement: 'modifier_upsell',
      rejectedActionIds: ['action-for_you-001', 'action-for_you-002'],
    });
  });

  it('keeps a selected modifier pending until its cart outcome is recorded', () => {
    const next = applyRecommendationOutcome(
      modifierPending(),
      outcome({
        eventId: 'event-modifier-selected-001',
        placement: 'modifier_upsell',
        eventType: 'selected',
      }),
      ['action-modifier_upsell-001'],
    );

    expect(next).toMatchObject({
      stage: 'modifier_pending',
      pendingRecommendation: { placement: 'modifier_upsell' },
      nextEligiblePlacement: null,
    });
  });

  it('advances a failed modifier mutation to Smart Cross-sell eligibility', () => {
    const selected = applyRecommendationOutcome(
      modifierPending(),
      outcome({
        eventId: 'event-modifier-selected-before-failure-001',
        placement: 'modifier_upsell',
        eventType: 'selected',
      }),
      ['action-modifier_upsell-001'],
    );
    const failed = applyRecommendationOutcome(
      selected,
      outcome({
        eventId: 'event-modifier-mutation-failed-001',
        placement: 'modifier_upsell',
        eventType: 'cart_mutation_failed',
      }),
      ['action-modifier_upsell-001'],
    );

    expect(failed).toMatchObject({
      stage: 'smart_cross_sell_eligible',
      pendingRecommendation: null,
      nextEligiblePlacement: 'smart_cross_sell',
    });
  });

  it('moves an ignored modifier to Smart Cross-sell eligibility', () => {
    const next = applyRecommendationOutcome(
      modifierPending(),
      outcome({
        eventId: 'event-modifier-ignored-001',
        placement: 'modifier_upsell',
        eventType: 'ignored',
      }),
      ['action-modifier_upsell-001'],
    );

    expect(next.stage).toBe('smart_cross_sell_eligible');
  });

  it('moves a superseded modifier to Smart Cross-sell eligibility', () => {
    const next = applyRecommendationOutcome(
      modifierPending(),
      outcome({
        eventId: 'event-modifier-superseded-001',
        placement: 'modifier_upsell',
        eventType: 'superseded',
      }),
      ['action-modifier_upsell-001'],
    );

    expect(next.stage).toBe('smart_cross_sell_eligible');
  });

  it('moves an empty Smart Cross-sell decision to complete', () => {
    const next = applyRecommendationDecision(
      smartEligible(),
      decision({ placement: 'smart_cross_sell', status: 'empty' }),
      '2026-07-27T09:02:00Z',
    );

    expect(next.stage).toBe('complete');
  });

  it('moves a suppressed Smart Cross-sell decision to complete', () => {
    const next = applyRecommendationDecision(
      smartEligible(),
      decision({ placement: 'smart_cross_sell', status: 'suppressed' }),
      '2026-07-27T09:02:00Z',
    );

    expect(next.stage).toBe('complete');
  });

  it('keeps a selected Smart Cross-sell recommendation pending until mutation outcome', () => {
    const next = applyRecommendationOutcome(
      smartPending(),
      outcome({
        eventId: 'event-smart-selected-001',
        placement: 'smart_cross_sell',
        eventType: 'selected',
        actionId: 'action-smart-001',
      }),
      ['action-smart-001', 'action-smart-002', 'action-smart-003'],
    );

    expect(next.stage).toBe('smart_cross_sell_pending');
  });

  it('moves a dismissed Smart Cross-sell recommendation to complete', () => {
    const next = applyRecommendationOutcome(
      smartPending(),
      outcome({
        eventId: 'event-smart-dismissed-001',
        placement: 'smart_cross_sell',
        eventType: 'explicitly_dismissed',
        actionId: null,
      }),
      ['action-smart-001', 'action-smart-002', 'action-smart-003'],
    );

    expect(next).toMatchObject({
      stage: 'complete',
      rejectedActionIds: [
        'action-smart-001',
        'action-smart-002',
        'action-smart-003',
      ],
    });
  });

  it('moves a superseded Smart Cross-sell recommendation to complete', () => {
    const next = applyRecommendationOutcome(
      smartPending(),
      outcome({
        eventId: 'event-smart-superseded-001',
        placement: 'smart_cross_sell',
        eventType: 'superseded',
        actionId: 'action-smart-001',
      }),
      ['action-smart-001', 'action-smart-002', 'action-smart-003'],
    );

    expect(next.stage).toBe('complete');
  });

  it('rejects outcomes whose request, action, or non-mutation cart revision does not match the pending decision', () => {
    const pending = applyRecommendationDecision(
      initialRecommendationState('order-flow-001'),
      decision({ placement: 'for_you' }),
      '2026-07-27T09:00:00Z',
    );
    const before = structuredClone(pending);

    expect(() =>
      applyRecommendationOutcome(
        pending,
        outcome({
          eventId: 'event-wrong-request-001',
          placement: 'for_you',
          eventType: 'ignored',
          requestId: 'request-other-001',
        }),
        ['action-for_you-001'],
      ),
    ).toThrow('recommendation_outcome_not_pending');
    expect(() =>
      applyRecommendationOutcome(
        pending,
        outcome({
          eventId: 'event-wrong-action-001',
          placement: 'for_you',
          eventType: 'selected',
          actionId: 'action-other-001',
        }),
        ['action-for_you-001'],
      ),
    ).toThrow('recommendation_outcome_not_pending');
    expect(() =>
      applyRecommendationOutcome(
        pending,
        outcome({
          eventId: 'event-wrong-cart-001',
          placement: 'for_you',
          eventType: 'ignored',
          cartRevision: 'cart-revision-other-001',
        }),
        ['action-for_you-001'],
      ),
    ).toThrow('recommendation_outcome_not_pending');
    expect(pending).toEqual(before);
  });

  it('increments revision once for a new outcome and never mutates input state', () => {
    const pending = applyRecommendationDecision(
      initialRecommendationState('order-flow-001'),
      decision({ placement: 'for_you' }),
      '2026-07-27T09:00:00Z',
    );
    const before = structuredClone(pending);
    const event = outcome({
      eventId: 'event-exactly-once-001',
      placement: 'for_you',
      eventType: 'ignored',
    });
    const first = applyRecommendationOutcome(pending, event, [
      'action-for_you-001',
    ]);

    expect(first.revision).toBe(pending.revision + 1);
    expect(
      applyRecommendationOutcome(first, event, ['action-for_you-001']),
    ).toEqual(first);
    expect(pending).toEqual(before);
  });

  it('keeps completed proactive state unchanged for customer-requested decisions', () => {
    const state = {
      ...initialRecommendationState('order-flow-001'),
      revision: 4,
      stage: 'complete' as const,
      shownActionIds: ['action-shown-001'],
      rejectedActionIds: ['action-rejected-001'],
      nextEligiblePlacement: null,
    };

    expect(flowForDecision(state, 'for_you', 'customer_requested')).toEqual({
      stage: 'complete',
      attemptedPlacements: [],
      previouslyShownActionIds: ['action-shown-001'],
      rejectedActionIds: ['action-rejected-001'],
    });
  });

  it('records a customer-requested decision after complete without reopening proactive state', () => {
    const state = {
      ...initialRecommendationState('order-flow-001'),
      revision: 4,
      stage: 'complete' as const,
      attemptedPlacements: [
        'local_favorite' as const,
        'modifier_upsell' as const,
        'smart_cross_sell' as const,
      ],
      shownActionIds: ['action-shown-001'],
      rejectedActionIds: ['action-rejected-001'],
      nextEligiblePlacement: null,
    };

    expect(
      applyCustomerRequestedRecommendationDecision(
        state,
        decision({ placement: 'for_you' }),
      ),
    ).toEqual({
      ...state,
      revision: 5,
    });
  });

  it('records a customer-requested outcome after complete without a pending proactive recommendation', () => {
    const state = {
      ...initialRecommendationState('order-flow-001'),
      revision: 5,
      stage: 'complete' as const,
      attemptedPlacements: [
        'local_favorite' as const,
        'modifier_upsell' as const,
        'smart_cross_sell' as const,
      ],
      pendingRecommendation: null,
      nextEligiblePlacement: null,
    };
    const event = outcome({
      eventId: 'event-customer-requested-dismissed-001',
      placement: 'for_you',
      eventType: 'explicitly_dismissed',
      actionId: null,
    });
    const next = applyCustomerRequestedRecommendationOutcome(state, event, [
      'action-for_you-001',
    ]);

    expect(next).toMatchObject({
      revision: 6,
      stage: 'complete',
      attemptedPlacements: [
        'local_favorite',
        'modifier_upsell',
        'smart_cross_sell',
      ],
      rejectedActionIds: ['action-for_you-001'],
      recordedOutcomeEventIds: ['event-customer-requested-dismissed-001'],
      pendingRecommendation: null,
      nextEligiblePlacement: null,
    });
    expect(
      applyCustomerRequestedRecommendationOutcome(next, event, [
        'action-for_you-001',
      ]),
    ).toEqual(next);
  });

  it('keeps selected then cart mutation telemetry post-complete without reopening proactive state', () => {
    const state = {
      ...initialRecommendationState('order-flow-001'),
      revision: 5,
      stage: 'complete' as const,
      attemptedPlacements: [
        'local_favorite' as const,
        'modifier_upsell' as const,
        'smart_cross_sell' as const,
      ],
      pendingRecommendation: null,
      nextEligiblePlacement: null,
    };
    const selected = applyCustomerRequestedRecommendationOutcome(
      state,
      outcome({
        eventId: 'event-customer-requested-selected-001',
        placement: 'for_you',
        eventType: 'selected',
      }),
      ['action-for_you-001'],
    );
    const mutated = applyCustomerRequestedRecommendationOutcome(
      selected,
      outcome({
        eventId: 'event-customer-requested-cart-succeeded-001',
        placement: 'for_you',
        eventType: 'cart_mutation_succeeded',
        cartRevision: 'cart-revision-after-selection',
      }),
      ['action-for_you-001'],
    );

    expect(mutated).toMatchObject({
      revision: 7,
      stage: 'complete',
      pendingRecommendation: null,
      nextEligiblePlacement: null,
      recordedOutcomeEventIds: [
        'event-customer-requested-selected-001',
        'event-customer-requested-cart-succeeded-001',
      ],
    });
  });

  it('rejects decisions for a proactive placement that is not currently eligible', () => {
    expect(() =>
      applyRecommendationDecision(
        initialRecommendationState('order-flow-001'),
        decision({ placement: 'modifier_upsell' }),
        '2026-07-27T09:00:00Z',
      ),
    ).toThrow('recommendation_decision_not_eligible');
  });

  it('rejects proactive decisions after the order flow is complete', () => {
    const complete = {
      ...initialRecommendationState('order-flow-001'),
      revision: 4,
      stage: 'complete' as const,
      nextEligiblePlacement: null,
    };

    expect(() =>
      applyRecommendationDecision(
        complete,
        decision({ placement: 'for_you' }),
        '2026-07-27T09:00:00Z',
      ),
    ).toThrow('recommendation_decision_not_eligible');
  });
});
