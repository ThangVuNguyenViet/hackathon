import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  parseRecommendationDecisionRequest,
  parseRecommendationDecisionResponse,
  parseRecommendationEvent,
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

describe('recommendation domain contracts', () => {
  it('parses the canonical decision request', () => {
    const parsed = parseRecommendationDecisionRequest(validRequest);

    expect(parsed.requestId).toBe('rec-request-001');
    expect(parsed.commerceSnapshotBindings.catalog.complete).toBe(true);
  });

  it('parses the canonical decision response and event', () => {
    expect(
      parseRecommendationDecisionResponse(validResponse).recommendationId,
    ).toBe('recommendation-001');
    expect(parseRecommendationEvent(validEvent).eventId).toBe(
      'event-impression-001',
    );
  });

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
