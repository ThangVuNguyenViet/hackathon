import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  canonicalUtcInstantOccursBefore,
  compareCanonicalUtcInstants,
  strictlyLaterCanonicalUtcInstant,
} from '../../src/recommendations/domain/canonical-instant.js';
import {
  instantSchema,
  parseRecommendationDecisionRequest,
  parseRecommendationDecisionResponse,
  parseRecommendationEvent,
  parseRecommendationImpressionRequest,
  parseRecommendationOutcomeRequest,
  parseRecommendationState,
} from '../../src/recommendations/domain/schemas.js';

type SnapshotBindingFixture = {
  commerceEnvironment: string;
  effectiveAt: string;
  expiresAt: string;
  observedAt: string;
};

type DecisionRequestFixture = {
  cart: { revision: string };
  cartRevision: string;
  commerceSnapshotBindings: {
    availability: SnapshotBindingFixture;
    catalog: SnapshotBindingFixture & { complete: boolean };
    modifierGraph: SnapshotBindingFixture;
    promotion: SnapshotBindingFixture;
    store: SnapshotBindingFixture;
  };
  decisionTime: string;
  requestId: string;
};

type AddProductActionFixture = {
  actionId: string;
  cartRevision: string;
  priceImpact: { amount: number; currency: string };
  quantity: number;
  sellableItemId: string;
  type: 'add_product';
};

type ApplyModifierActionFixture = {
  actionId: string;
  cartRevision: string;
  groupPath: string[];
  optionId: string;
  parentCartLineId: string;
  parentSellableItemId: string;
  priceImpact: { amount: number; currency: string };
  quantity: number;
  type: 'apply_modifier';
};

type ReplaceCartLineActionFixture = {
  actionId: string;
  cartRevision: string;
  priceImpact: { amount: number; currency: string };
  replacedCartLineId: string;
  replacement: AddProductActionFixture;
  type: 'replace_cart_line';
};

type RecommendationActionFixture =
  | AddProductActionFixture
  | ApplyModifierActionFixture
  | ReplaceCartLineActionFixture;

type DecisionResponseFixture = {
  counts: {
    displayed: number;
    eligible: number;
    ineligible: number;
    potential: number;
  };
  displayFacts: Array<{ actionId: string }>;
  decisionSource:
    'ranked' | 'merchandising_replacement' | 'fallback' | 'suppressed';
  placement:
    'for_you' | 'local_favorite' | 'modifier_upsell' | 'smart_cross_sell';
  primaryOffer: { actions: RecommendationActionFixture[] } | null;
  status:
    | 'recommended'
    | 'empty'
    | 'suppressed'
    | 'invalid_context'
    | 'ineligible_context';
};

type InstantConformanceCorpus = {
  accepted: Array<{ name: string; value: unknown }>;
  rejected: Array<{ name: string; value: unknown }>;
};

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const examplesDirectory = resolve(
  repoRoot,
  'contracts/recommendations/v1/examples',
);

const readExample = async <T>(name: string): Promise<T> =>
  JSON.parse(await readFile(resolve(examplesDirectory, name), 'utf8')) as T;

const validRequest = await readExample<DecisionRequestFixture>(
  'valid-decision-request.json',
);
const validResponse = await readExample<DecisionResponseFixture>(
  'valid-decision-response.json',
);
const validEvent = await readExample<unknown>(
  'valid-recommendation-event.json',
);
const validState = await readExample<unknown>(
  'valid-recommendation-state.json',
);
const validImpressionRequest = await readExample<unknown>(
  'valid-impression-request.json',
);
const validOutcomeRequest = await readExample<unknown>(
  'valid-outcome-request.json',
);
const instantConformance = await readExample<InstantConformanceCorpus>(
  'instant-conformance.json',
);

const modifierAction = (): ApplyModifierActionFixture => ({
  type: 'apply_modifier',
  actionId: 'action-modifier-001',
  parentCartLineId: 'cart-line-001',
  parentSellableItemId: 'cart-item-001',
  optionId: 'modifier-option-001',
  groupPath: ['modifier-group-001'],
  quantity: 1,
  priceImpact: { amount: 5000, currency: 'VND' },
  cartRevision: 'cart-revision-001',
});

const productAction = (actionId: string): AddProductActionFixture => ({
  type: 'add_product',
  actionId,
  sellableItemId: `item-${actionId}`,
  quantity: 1,
  priceImpact: { amount: 45000, currency: 'VND' },
  cartRevision: 'cart-revision-001',
});

const replaceCartLineAction = (): ReplaceCartLineActionFixture => ({
  type: 'replace_cart_line',
  actionId: 'action-replace-001',
  replacedCartLineId: 'cart-line-001',
  replacement: productAction('action-replacement-product-001'),
  priceImpact: { amount: 0, currency: 'VND' },
  cartRevision: 'cart-revision-001',
});

const sanitySnapshotBinding = () => ({
  snapshotId: 'sanity-snapshot-001',
  digest: 'f'.repeat(64),
  contributingRevisions: ['sanity-policies-revision-001'],
});

const pendingRecommendation = (placement: string) => ({
  recommendationId: 'recommendation-001',
  requestId: 'rec-request-001',
  placement,
  actionIds: ['action-product-001'],
  cartRevision: 'cart-revision-001',
  traceRef: 'trace-001',
  decidedAt: '2026-07-27T09:00:00Z',
});

describe('recommendation domain contracts', () => {
  it('parses the canonical decision request', () => {
    const parsed = parseRecommendationDecisionRequest(validRequest);

    expect(parsed.requestId).toBe('rec-request-001');
    expect(parsed.commerceSnapshotBindings.catalog.complete).toBe(true);
  });

  it.each(instantConformance.accepted)(
    'accepts canonical Instant: $name',
    ({ value }) => {
      expect(instantSchema.parse(value)).toBe(value);
    },
  );

  it.each(instantConformance.rejected)(
    'rejects non-canonical Instant: $name',
    ({ value }) => {
      expect(() => instantSchema.parse(value)).toThrow();
    },
  );

  it.each([
    '2026-02-31T00:00:00Z',
    '2026-13-01T00:00:00Z',
    '2026-02-29T00:00:00Z',
  ])('fails closed for calendar-invalid canonical UTC text: %s', (value) => {
    expect(instantSchema.safeParse(value).success).toBe(false);
    expect(
      compareCanonicalUtcInstants(value, '2026-03-01T00:00:00Z'),
    ).toBeNull();
    expect(canonicalUtcInstantOccursBefore(value, '2026-03-01T00:00:00Z')).toBe(
      false,
    );
  });

  it('retains exact fractional precision for a valid leap-day Instant', () => {
    expect(
      compareCanonicalUtcInstants(
        '2028-02-29T00:00:00.1001Z',
        '2028-02-29T00:00:00.1002Z',
      ),
    ).toBe(-1);
    expect(
      compareCanonicalUtcInstants(
        '2028-02-29T00:00:00.1002Z',
        '2028-02-29T00:00:00.10021Z',
      ),
    ).toBe(-1);
    expect(
      compareCanonicalUtcInstants(
        '2028-02-29T00:00:00.1Z',
        '2028-02-29T00:00:00.10Z',
      ),
    ).toBe(0);
  });

  it('advances a repeated canonical instant without losing fractional precision', () => {
    expect(
      strictlyLaterCanonicalUtcInstant(
        '2028-02-29T00:00:00.1002Z',
        '2028-02-29T00:00:00.1002Z',
      ),
    ).toBe('2028-02-29T00:00:00.10021Z');
    expect(
      strictlyLaterCanonicalUtcInstant(
        '2028-02-29T00:00:00.1003Z',
        '2028-02-29T00:00:00.1002Z',
      ),
    ).toBe('2028-02-29T00:00:00.1003Z');
  });

  it('parses the canonical decision response and event', () => {
    expect(
      parseRecommendationDecisionResponse(validResponse).recommendationId,
    ).toBe('recommendation-001');
    expect(parseRecommendationEvent(validEvent).eventId).toBe(
      'event-impression-001',
    );
  });

  it('parses the canonical recommendation state and event ingress requests', () => {
    expect(parseRecommendationState(validState).nextEligiblePlacement).toBe(
      'starter',
    );
    expect(
      parseRecommendationImpressionRequest(validImpressionRequest)
        .assistantTurnId,
    ).toBe('assistant-turn-001');
    expect(parseRecommendationOutcomeRequest(validOutcomeRequest).eventType).toBe(
      'selected',
    );
  });

  it.each([
    ['starter_eligible', 'starter', null],
    ['starter_resolved', null, 'for_you'],
    ['modifier_eligible', 'modifier_upsell', 'for_you'],
    ['modifier_pending', null, 'modifier_upsell'],
    ['modifier_resolved', 'smart_cross_sell', null],
    ['smart_cross_sell_eligible', 'smart_cross_sell', null],
    ['smart_cross_sell_pending', null, 'smart_cross_sell'],
    ['complete', null, null],
  ] as const)(
    'accepts the %s state combination',
    (stage, nextEligiblePlacement, pendingPlacement) => {
      const value = structuredClone(validState) as Record<string, unknown>;
      value.stage = stage;
      value.nextEligiblePlacement = nextEligiblePlacement;
      value.attemptedPlacements = pendingPlacement === null ? [] : [pendingPlacement];
      value.pendingRecommendation =
        pendingPlacement === null
          ? null
          : {
              recommendationId: 'recommendation-001',
              requestId: 'rec-request-001',
              placement: pendingPlacement,
              actionIds: ['action-product-001'],
              cartRevision: 'cart-revision-001',
              traceRef: 'trace-001',
              decidedAt: '2026-07-27T09:00:00Z',
            };

      expect(() => parseRecommendationState(value)).not.toThrow();
    },
  );

  it('rejects a pending recommendation outside attempted placements', () => {
    const value = structuredClone(validState) as Record<string, unknown>;
    value.stage = 'starter_resolved';
    value.nextEligiblePlacement = null;
    value.pendingRecommendation = {
      recommendationId: 'recommendation-001',
      requestId: 'rec-request-001',
      placement: 'for_you',
      actionIds: ['action-product-001'],
      cartRevision: 'cart-revision-001',
      traceRef: 'trace-001',
      decidedAt: '2026-07-27T09:00:00Z',
    };

    expect(() => parseRecommendationState(value)).toThrow();
  });

  it('rejects duplicate state and impression action IDs', () => {
    const state = structuredClone(validState) as Record<string, unknown>;
    state.shownActionIds = ['action-product-001', 'action-product-001'];
    expect(() => parseRecommendationState(state)).toThrow();

    const impression = structuredClone(validImpressionRequest) as {
      renderedActions: Array<{ actionId: string; position: number }>;
    };
    impression.renderedActions.push({ actionId: 'action-product-001', position: 2 });
    expect(() => parseRecommendationImpressionRequest(impression)).toThrow();
  });

  it('rejects duplicate impression positions and invalid action digests', () => {
    const duplicatePosition = structuredClone(validImpressionRequest) as {
      renderedActions: Array<{ actionId: string; position: number }>;
    };
    duplicatePosition.renderedActions.push({
      actionId: 'action-product-002',
      position: 1,
    });
    expect(() => parseRecommendationImpressionRequest(duplicatePosition)).toThrow();

    const invalidDigest = structuredClone(validImpressionRequest) as {
      actionDigest: string;
    };
    invalidDigest.actionDigest = 'A';
    expect(() => parseRecommendationImpressionRequest(invalidDigest)).toThrow();
  });

  it('rejects strict unknown fields in state and event ingress requests', () => {
    const state = structuredClone(validState) as Record<string, unknown>;
    state.unexpected = true;
    expect(() => parseRecommendationState(state)).toThrow();

    const impression = structuredClone(validImpressionRequest) as {
      renderedActions: Array<Record<string, unknown>>;
    };
    impression.renderedActions[0]!.unexpected = true;
    expect(() => parseRecommendationImpressionRequest(impression)).toThrow();
  });

  it.each([
    ['starter_eligible', null, null],
    ['starter_resolved', 'starter', null],
    ['modifier_eligible', 'starter', null],
    ['modifier_pending', null, null],
    ['modifier_resolved', null, null],
    ['smart_cross_sell_eligible', null, null],
    ['smart_cross_sell_pending', null, null],
    ['complete', null, 'for_you'],
    ['complete', 'starter', null],
  ] as const)(
    'rejects invalid %s state next/pending combination',
    (stage, nextEligiblePlacement, pendingPlacement) => {
      const value = structuredClone(validState) as Record<string, unknown>;
      value.stage = stage;
      value.nextEligiblePlacement = nextEligiblePlacement;
      value.attemptedPlacements = pendingPlacement === null ? [] : [pendingPlacement];
      value.pendingRecommendation =
        pendingPlacement === null ? null : pendingRecommendation(pendingPlacement);

      expect(() => parseRecommendationState(value)).toThrow();
    },
  );

  it.each([
    ['starter_eligible', 'starter', 'for_you'],
    ['starter_resolved', null, 'modifier_upsell'],
    ['modifier_eligible', 'modifier_upsell', 'modifier_upsell'],
    ['modifier_pending', null, 'for_you'],
    ['modifier_resolved', 'smart_cross_sell', 'for_you'],
    ['smart_cross_sell_eligible', 'smart_cross_sell', 'for_you'],
    ['smart_cross_sell_pending', null, 'modifier_upsell'],
  ] as const)(
    'rejects a %s state with the wrong pending placement',
    (stage, nextEligiblePlacement, pendingPlacement) => {
      const value = structuredClone(validState) as Record<string, unknown>;
      value.stage = stage;
      value.nextEligiblePlacement = nextEligiblePlacement;
      value.attemptedPlacements = [pendingPlacement];
      value.pendingRecommendation = pendingRecommendation(pendingPlacement);

      expect(() => parseRecommendationState(value)).toThrow();
    },
  );

  it('rejects a client-authored impression recordedAt field', () => {
    const value = structuredClone(validImpressionRequest) as Record<string, unknown>;
    value.recordedAt = '2026-07-27T09:00:06Z';

    expect(() => parseRecommendationImpressionRequest(value)).toThrow();
  });

  it.each([
      ['recordedAt', '2026-07-27T09:00:06Z'],
      ['stage', 'complete'],
      ['evidence', { server: 'only' }],
    ] as const)('rejects a client-authored outcome %s field', (field, fieldValue) => {
      const value = structuredClone(validOutcomeRequest) as Record<string, unknown>;
      value[field] = fieldValue;

      expect(() => parseRecommendationOutcomeRequest(value)).toThrow();
    });

  it('rejects client-authored pending recommendation evidence', () => {
    const value = structuredClone(validState) as Record<string, unknown>;
    value.stage = 'starter_resolved';
    value.nextEligiblePlacement = null;
    value.attemptedPlacements = ['for_you'];
    value.pendingRecommendation = {
      ...pendingRecommendation('for_you'),
      evidence: { server: 'only' },
    };

    expect(() => parseRecommendationState(value)).toThrow();
  });

  it.each([
    ['selected', null, true],
    ['cart_mutation_succeeded', null, true],
    ['cart_mutation_failed', null, true],
    ['explicitly_dismissed', null, false],
    ['ignored', null, false],
    ['superseded', null, false],
    ['checkout_completed', 'action-product-001', true],
    ['order_abandoned', 'action-product-001', true],
    ['order_cancelled', 'action-product-001', true],
  ] as const)(
    'enforces the action ID rule for %s outcomes',
    (eventType, actionId, shouldReject) => {
      const value = structuredClone(validOutcomeRequest) as {
        actionId: string | null;
        eventType: string;
      };
      value.eventType = eventType;
      value.actionId = actionId;

      if (shouldReject) {
        expect(() => parseRecommendationOutcomeRequest(value)).toThrow();
      } else {
        expect(() => parseRecommendationOutcomeRequest(value)).not.toThrow();
      }
    },
  );

  it('rejects a cart revision that is not the request revision', () => {
    const value = structuredClone(validRequest);
    value.cart.revision = 'cart-revision-other';

    expect(() => parseRecommendationDecisionRequest(value)).toThrow();
  });

  it('rejects mixed Commerce Environments', () => {
    const value = structuredClone(validRequest);
    value.commerceSnapshotBindings.availability.commerceEnvironment =
      'other-environment';

    expect(() => parseRecommendationDecisionRequest(value)).toThrow();
  });

  it('rejects a snapshot that is not effective at the decision time', () => {
    const value = structuredClone(validRequest);
    value.commerceSnapshotBindings.catalog.effectiveAt = '2026-07-27T09:01:00Z';

    expect(() => parseRecommendationDecisionRequest(value)).toThrow();
  });

  it('rejects a snapshot that has expired at the decision time', () => {
    const value = structuredClone(validRequest);
    value.commerceSnapshotBindings.catalog.expiresAt = '2026-07-27T09:00:00Z';

    expect(() => parseRecommendationDecisionRequest(value)).toThrow();
  });

  it('rejects a snapshot observed after the decision time', () => {
    const value = structuredClone(validRequest);
    value.commerceSnapshotBindings.catalog.observedAt = '2026-07-27T09:01:00Z';

    expect(() => parseRecommendationDecisionRequest(value)).toThrow();
  });

  it('requires a primary offer for a recommended response', () => {
    const value = structuredClone(validResponse);
    value.primaryOffer = null;
    value.displayFacts = [];
    value.counts.displayed = 0;

    expect(() => parseRecommendationDecisionResponse(value)).toThrow();
  });

  it('parses an empty response with no primary offer', () => {
    const value = structuredClone(validResponse);
    value.status = 'empty';
    value.primaryOffer = null;
    value.displayFacts = [];
    value.counts.displayed = 0;

    expect(parseRecommendationDecisionResponse(value).status).toBe('empty');
  });

  it('requires non-recommended statuses to have no primary offer', () => {
    const value = structuredClone(validResponse);
    value.status = 'suppressed';

    expect(() => parseRecommendationDecisionResponse(value)).toThrow();
  });

  it('rejects counts whose eligible and ineligible values do not equal potential', () => {
    const value = structuredClone(validResponse);
    value.counts.potential = 9;

    expect(() => parseRecommendationDecisionResponse(value)).toThrow();
  });

  it('rejects counts whose displayed value does not equal offered actions', () => {
    const value = structuredClone(validResponse);
    value.counts.displayed = 0;

    expect(() => parseRecommendationDecisionResponse(value)).toThrow();
  });

  it('rejects display facts for actions outside the authoritative offer', () => {
    const value = structuredClone(validResponse);
    value.displayFacts[0].actionId = 'action-not-offered';

    expect(() => parseRecommendationDecisionResponse(value)).toThrow();
  });

  it('parses a complete Sanity merchandising replacement response', () => {
    const value = structuredClone(validResponse);
    const action = replaceCartLineAction();
    value.decisionSource = 'merchandising_replacement';
    value.primaryOffer = { actions: [action] };
    value.displayFacts[0].actionId = action.actionId;

    const parsed = parseRecommendationDecisionResponse(value);

    expect(parsed.decisionSource).toBe('merchandising_replacement');
    expect(parsed.primaryOffer?.actions[0]?.type).toBe('replace_cart_line');
  });

  it.each(['ranked', 'fallback', 'suppressed'] as const)(
    'rejects a replacement action from %s',
    (decisionSource) => {
      const value = structuredClone(validResponse);
      const action = replaceCartLineAction();
      value.decisionSource = decisionSource;
      value.primaryOffer = { actions: [action] };
      value.displayFacts[0].actionId = action.actionId;

      expect(() => parseRecommendationDecisionResponse(value)).toThrow();
    },
  );

  it('rejects a merchandising replacement mixed with another action', () => {
    const value = structuredClone(validResponse);
    const action = replaceCartLineAction();
    value.decisionSource = 'merchandising_replacement';
    value.primaryOffer = {
      actions: [action, productAction('action-product-002')],
    };
    value.displayFacts[0].actionId = action.actionId;
    value.counts.displayed = 2;

    expect(() => parseRecommendationDecisionResponse(value)).toThrow();
  });

  it('keeps normal placement rules for a non-replacement merchandising response', () => {
    const value = structuredClone(validResponse);
    value.decisionSource = 'merchandising_replacement';

    expect(parseRecommendationDecisionResponse(value).placement).toBe(
      'for_you',
    );
  });

  it('requires a strict Sanity snapshot binding', () => {
    const value = structuredClone(validResponse) as unknown as {
      versionBindings: { sanitySnapshot: unknown };
    };
    value.versionBindings.sanitySnapshot = sanitySnapshotBinding();

    expect(() => parseRecommendationDecisionResponse(value)).not.toThrow();

    value.versionBindings.sanitySnapshot = 'sanity-snapshot-001';
    expect(() => parseRecommendationDecisionResponse(value)).toThrow();
  });

  it('rejects duplicate Sanity snapshot contributing revisions', () => {
    const value = structuredClone(validResponse) as unknown as {
      versionBindings: { sanitySnapshot: unknown };
    };
    const binding = sanitySnapshotBinding();
    binding.contributingRevisions.push('sanity-policies-revision-001');
    value.versionBindings.sanitySnapshot = binding;

    expect(() => parseRecommendationDecisionResponse(value)).toThrow();
  });

  it('parses a Modifier Upsell response with one modifier action', () => {
    const value = structuredClone(validResponse);
    value.placement = 'modifier_upsell';
    value.primaryOffer = { actions: [modifierAction()] };
    value.displayFacts[0].actionId = 'action-modifier-001';

    expect(parseRecommendationDecisionResponse(value).placement).toBe(
      'modifier_upsell',
    );
  });

  it('requires exactly one modifier action for Modifier Upsell', () => {
    const value = structuredClone(validResponse);
    value.placement = 'modifier_upsell';
    value.primaryOffer = { actions: [modifierAction(), modifierAction()] };
    value.primaryOffer.actions[1].actionId = 'action-modifier-002';
    value.displayFacts[0].actionId = 'action-modifier-001';
    value.counts.displayed = 2;

    expect(() => parseRecommendationDecisionResponse(value)).toThrow();
  });

  it('rejects a product action for Modifier Upsell', () => {
    const value = structuredClone(validResponse);
    value.placement = 'modifier_upsell';

    expect(() => parseRecommendationDecisionResponse(value)).toThrow();
  });

  it.each(['for_you', 'local_favorite'] as const)(
    'requires exactly one product action for %s',
    (placement) => {
      const value = structuredClone(validResponse);
      value.placement = placement;
      value.primaryOffer?.actions.push(productAction('action-product-002'));
      value.counts.displayed = 2;

      expect(() => parseRecommendationDecisionResponse(value)).toThrow();
    },
  );

  it.each(['for_you', 'local_favorite'] as const)(
    'rejects a modifier action for %s',
    (placement) => {
      const value = structuredClone(validResponse);
      const action = modifierAction();
      value.placement = placement;
      value.primaryOffer = { actions: [action] };
      value.displayFacts[0].actionId = action.actionId;

      expect(() => parseRecommendationDecisionResponse(value)).toThrow();
    },
  );

  it.each(['for_you', 'local_favorite'] as const)(
    'rejects a replacement action for %s',
    (placement) => {
      const value = structuredClone(validResponse);
      const action = replaceCartLineAction();
      value.placement = placement;
      value.primaryOffer = { actions: [action] };
      value.displayFacts[0].actionId = action.actionId;

      expect(() => parseRecommendationDecisionResponse(value)).toThrow();
    },
  );

  it('parses a Smart Cross-sell response with three product actions', () => {
    const value = structuredClone(validResponse);
    value.placement = 'smart_cross_sell';
    value.primaryOffer?.actions.push(
      productAction('action-product-002'),
      productAction('action-product-003'),
    );
    value.displayFacts.push(
      {
        ...structuredClone(value.displayFacts[0]),
        actionId: 'action-product-002',
      },
      {
        ...structuredClone(value.displayFacts[0]),
        actionId: 'action-product-003',
      },
    );
    value.counts.displayed = 3;

    expect(parseRecommendationDecisionResponse(value).placement).toBe(
      'smart_cross_sell',
    );
  });

  it('requires three or four product actions for Smart Cross-sell', () => {
    const value = structuredClone(validResponse);
    value.placement = 'smart_cross_sell';

    expect(() => parseRecommendationDecisionResponse(value)).toThrow();
  });

  it('rejects a non-product action in Smart Cross-sell', () => {
    const value = structuredClone(validResponse);
    const modifier = modifierAction();
    value.placement = 'smart_cross_sell';
    value.primaryOffer = {
      actions: [
        productAction('action-product-001'),
        productAction('action-product-002'),
        modifier,
      ],
    };
    value.displayFacts = [
      {
        ...structuredClone(value.displayFacts[0]),
        actionId: 'action-product-001',
      },
      {
        ...structuredClone(value.displayFacts[0]),
        actionId: 'action-product-002',
      },
      {
        ...structuredClone(value.displayFacts[0]),
        actionId: modifier.actionId,
      },
    ];
    value.counts.displayed = 3;

    expect(() => parseRecommendationDecisionResponse(value)).toThrow();
  });
});
