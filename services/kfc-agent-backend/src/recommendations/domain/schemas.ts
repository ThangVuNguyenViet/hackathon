import type { Format } from 'ajv';
import addFormats from 'ajv-formats';
import type { FormatsPlugin } from 'ajv-formats';
import { z } from 'zod';
import {
  cartLineIdSchema,
  commerceEnvironmentIdSchema,
  modifierOptionIdSchema,
  opaqueIdSchema,
  orderingJourneyIdSchema,
  recommendationEventIdSchema,
  recommendationIdSchema,
  recommendationRequestIdSchema,
  sellableItemIdSchema,
} from './identities.js';
import type {
  RecommendationDecisionRequest,
  RecommendationDecisionResponse,
  RecommendationEvent,
  RecommendationImpressionRequest,
  RecommendationOutcomeRequest,
  RecommendationState,
} from './contracts.js';
import { compareCanonicalUtcInstants } from './canonical-instant.js';
import {
  KFC_RECOMMENDATION_API_VERSION,
  KFC_RECOMMENDATION_EVENT_VERSION,
  KFC_RECOMMENDATION_POLICY_VERSION,
} from './versions.js';

type StringFormatValidator = (value: string) => boolean;
type StringFormatDefinition = {
  validate: RegExp | StringFormatValidator;
};

const ajvDateTimeFormat = (addFormats as unknown as FormatsPlugin).get(
  'date-time',
);
const canonicalUtcInstantPattern =
  /^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\.[0-9]+)?Z$/u;

function isStringFormatValidator(
  format: Format,
): format is StringFormatValidator {
  return typeof format === 'function';
}

function isStringFormatDefinition(
  format: Format,
): format is StringFormatDefinition {
  return (
    typeof format === 'object' &&
    format !== null &&
    'validate' in format &&
    (typeof format.validate === 'function' || format.validate instanceof RegExp)
  );
}

function acceptsAjvStringFormat(format: Format, value: string): boolean {
  if (isStringFormatValidator(format)) {
    return format(value);
  }
  if (format instanceof RegExp) {
    format.lastIndex = 0;
    return format.test(value);
  }
  if (isStringFormatDefinition(format)) {
    const { validate } = format;
    if (typeof validate === 'function') {
      return validate(value) === true;
    }
    if (validate instanceof RegExp) {
      validate.lastIndex = 0;
      return validate.test(value);
    }
  }
  return false;
}

export const instantSchema = z
  .string()
  .regex(canonicalUtcInstantPattern, 'Must use canonical ISO-8601 UTC form')
  .refine(
    (value) => acceptsAjvStringFormat(ajvDateTimeFormat, value),
    'Must use the JSON Schema date-time format',
  );
export const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const nonNegativeIntegerSchema = z.number().int().nonnegative();
const positiveIntegerSchema = z.number().int().positive();

export const moneySchema = z
  .object({
    amount: nonNegativeIntegerSchema,
    currency: z.literal('VND'),
  })
  .strict();

export const snapshotProvenanceSchema = z
  .object({
    source: z.string().min(1),
    reference: z.string().min(1),
  })
  .strict();

export const sanitySnapshotBindingSchema = z
  .object({
    snapshotId: opaqueIdSchema,
    digest: sha256Schema,
    contributingRevisions: z
      .array(z.string().min(1))
      .min(1)
      .refine(
        (revisions) => new Set(revisions).size === revisions.length,
        'Contributing revisions must be unique',
      ),
  })
  .strict();

export const snapshotBindingSchema = z
  .object({
    snapshotId: opaqueIdSchema,
    digest: sha256Schema,
    sourceRevision: z.string().min(1),
    observedAt: instantSchema,
    effectiveAt: instantSchema,
    expiresAt: instantSchema,
    complete: z.boolean(),
    commerceEnvironment: commerceEnvironmentIdSchema,
    provenance: snapshotProvenanceSchema,
  })
  .strict();

export const commerceSnapshotBindingsSchema = z
  .object({
    catalog: snapshotBindingSchema,
    modifierGraph: snapshotBindingSchema,
    store: snapshotBindingSchema,
    availability: snapshotBindingSchema,
    promotion: snapshotBindingSchema,
  })
  .strict();

export const modifierSelectionSchema = z
  .object({
    groupPath: z.array(opaqueIdSchema).min(1),
    optionId: modifierOptionIdSchema,
    quantity: positiveIntegerSchema,
    priceImpact: moneySchema,
  })
  .strict();

export const cartLineSchema = z
  .object({
    lineId: cartLineIdSchema,
    sellableItemId: sellableItemIdSchema,
    quantity: positiveIntegerSchema,
    unitPrice: moneySchema,
    modifiers: z.array(modifierSelectionSchema),
  })
  .strict();

export const cartSnapshotSchema = z
  .object({
    cartId: opaqueIdSchema,
    revision: opaqueIdSchema,
    subtotal: moneySchema,
    lines: z.array(cartLineSchema),
  })
  .strict();

export const experimentProfileSchema = z
  .object({
    profileId: opaqueIdSchema,
    outputMode: z.enum(['baseline', 'learned_technical']),
  })
  .strict();

export const placementSchema = z.enum([
  'local_favorite',
  'for_you',
  'modifier_upsell',
  'smart_cross_sell',
]);

export function placementAcceptsActionCount(
  placement: z.infer<typeof placementSchema>,
  actionCount: number,
): boolean {
  switch (placement) {
    case 'local_favorite':
    case 'for_you':
    case 'modifier_upsell':
      return actionCount === 1;
    case 'smart_cross_sell':
      return actionCount >= 3 && actionCount <= 4;
  }
}

export const decisionStatusSchema = z.enum([
  'recommended',
  'empty',
  'suppressed',
  'invalid_context',
  'ineligible_context',
]);

export const decisionSourceSchema = z.enum([
  'ranked',
  'merchandising_replacement',
  'fallback',
  'suppressed',
]);

export const fulfilmentModeSchema = z.enum(['pickup', 'delivery']);

const recommendationDecisionRequestShape = z
  .object({
    schemaVersion: z.literal(KFC_RECOMMENDATION_API_VERSION),
    requestId: recommendationRequestIdSchema,
    idempotencyKey: opaqueIdSchema,
    orderFlowId: orderingJourneyIdSchema,
    sessionId: opaqueIdSchema,
    placement: placementSchema,
    verifiedCustomerRef: opaqueIdSchema.nullable(),
    storeId: opaqueIdSchema,
    fulfilmentMode: fulfilmentModeSchema,
    decisionTime: instantSchema,
    cart: cartSnapshotSchema,
    cartRevision: opaqueIdSchema,
    commerceSnapshotBindings: commerceSnapshotBindingsSchema,
    eligibilityPolicyVersion: z.literal(KFC_RECOMMENDATION_POLICY_VERSION),
    experimentProfile: experimentProfileSchema,
  })
  .strict();

export const addProductActionSchema = z
  .object({
    type: z.literal('add_product'),
    actionId: opaqueIdSchema,
    sellableItemId: sellableItemIdSchema,
    quantity: positiveIntegerSchema,
    priceImpact: moneySchema,
    cartRevision: opaqueIdSchema,
  })
  .strict();

export const applyModifierActionSchema = z
  .object({
    type: z.literal('apply_modifier'),
    actionId: opaqueIdSchema,
    parentCartLineId: cartLineIdSchema,
    parentSellableItemId: sellableItemIdSchema,
    optionId: modifierOptionIdSchema,
    groupPath: z.array(opaqueIdSchema).min(1),
    quantity: positiveIntegerSchema,
    priceImpact: moneySchema,
    cartRevision: opaqueIdSchema,
  })
  .strict();

export const replaceCartLineActionSchema = z
  .object({
    type: z.literal('replace_cart_line'),
    actionId: opaqueIdSchema,
    replacedCartLineId: cartLineIdSchema,
    replacement: addProductActionSchema,
    priceImpact: moneySchema,
    cartRevision: opaqueIdSchema,
  })
  .strict();

export const recommendationActionSchema = z.discriminatedUnion('type', [
  addProductActionSchema,
  applyModifierActionSchema,
  replaceCartLineActionSchema,
]);

export const primaryOfferSchema = z
  .object({
    actions: z.array(recommendationActionSchema).min(1).max(4),
  })
  .strict();

export const displayFactSchema = z
  .object({
    actionId: opaqueIdSchema,
    name: z.string(),
    imageUrl: z.string().nullable(),
    priceImpact: moneySchema,
  })
  .strict();

export const customerReasonCodeSchema = z.enum([
  'popular_here',
  'ordered_before',
  'matches_your_history',
  'completes_your_item',
  'completes_your_meal',
  'active_offer',
  'merchandising_selection',
]);

export const merchandisingActionSchema = z.enum([
  'exclude_target',
  'boost_target',
  'pin_target',
  'replace_slate',
  'suppress_placement',
]);

export const merchandisingEffectSchema = z
  .object({
    policyId: opaqueIdSchema,
    action: merchandisingActionSchema,
    targetActionId: opaqueIdSchema.nullable(),
    detail: z.string().min(1),
  })
  .strict();

export const versionBindingsSchema = z
  .object({
    catalog: opaqueIdSchema,
    modifierGraph: opaqueIdSchema,
    store: opaqueIdSchema,
    availability: opaqueIdSchema,
    promotion: opaqueIdSchema,
    eligibilityPolicy: opaqueIdSchema,
    sanitySnapshot: sanitySnapshotBindingSchema,
    featureSchema: opaqueIdSchema,
    servingRanker: opaqueIdSchema,
    shadowModel: opaqueIdSchema.nullable(),
    calibration: opaqueIdSchema.nullable(),
    experiment: opaqueIdSchema,
    loggingPolicy: opaqueIdSchema,
  })
  .strict();

export const recommendationCountsSchema = z
  .object({
    potential: nonNegativeIntegerSchema,
    eligible: nonNegativeIntegerSchema,
    ineligible: nonNegativeIntegerSchema,
    scored: nonNegativeIntegerSchema,
    displayed: nonNegativeIntegerSchema,
    complete: z.boolean(),
  })
  .strict();

const recommendationDecisionResponseShape = z
  .object({
    schemaVersion: z.literal(KFC_RECOMMENDATION_API_VERSION),
    recommendationId: recommendationIdSchema,
    requestId: recommendationRequestIdSchema,
    orderFlowId: orderingJourneyIdSchema,
    placement: placementSchema,
    status: decisionStatusSchema,
    decisionSource: decisionSourceSchema,
    primaryOffer: primaryOfferSchema.nullable(),
    displayFacts: z.array(displayFactSchema),
    reasonCodes: z.array(customerReasonCodeSchema),
    merchandisingEffects: z.array(merchandisingEffectSchema),
    versionBindings: versionBindingsSchema,
    counts: recommendationCountsSchema,
    traceRef: opaqueIdSchema,
  })
  .strict();

export const eventTypeSchema = z.enum([
  'decision_requested',
  'decision_completed',
  'candidate_eligibility_summary',
  'impression_rendered',
  'selected',
  'explicitly_dismissed',
  'ignored',
  'superseded',
  'cart_mutation_succeeded',
  'cart_mutation_failed',
  'checkout_completed',
  'order_abandoned',
  'order_cancelled',
]);

export const eventActorSchema = z.enum([
  'customer',
  'agent',
  'system',
  'client',
]);

export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(jsonValueSchema),
    z.record(jsonValueSchema),
  ]),
);

export const recommendationEventSchema = z
  .object({
    schemaVersion: z.literal(KFC_RECOMMENDATION_EVENT_VERSION),
    eventId: recommendationEventIdSchema,
    eventType: eventTypeSchema,
    recommendationId: recommendationIdSchema.nullable(),
    requestId: recommendationRequestIdSchema,
    orderFlowId: orderingJourneyIdSchema,
    sessionId: opaqueIdSchema,
    placement: placementSchema,
    occurredAt: instantSchema,
    recordedAt: instantSchema,
    actor: eventActorSchema,
    actionId: opaqueIdSchema.nullable(),
    cartRevision: opaqueIdSchema.nullable(),
    versionBindings: versionBindingsSchema,
    payload: z.record(jsonValueSchema),
  })
  .strict();

const unique = (values: readonly string[]) =>
  new Set(values).size === values.length;

const starterPlacementSchema = z.enum(['local_favorite', 'for_you']);
export const recommendationStageSchema = z.enum([
  'starter_eligible',
  'starter_resolved',
  'modifier_eligible',
  'modifier_pending',
  'modifier_resolved',
  'smart_cross_sell_eligible',
  'smart_cross_sell_pending',
  'complete',
]);
export const nextEligiblePlacementSchema = z.union([
  z.literal('starter'),
  z.literal('modifier_upsell'),
  z.literal('smart_cross_sell'),
  z.null(),
]);

export const pendingRecommendationSchema = z
  .object({
    recommendationId: recommendationIdSchema,
    requestId: recommendationRequestIdSchema,
    placement: placementSchema,
    actionIds: z
      .array(opaqueIdSchema)
      .min(1)
      .max(4)
      .refine(unique, 'Pending recommendation action IDs must be unique'),
    cartRevision: opaqueIdSchema,
    traceRef: opaqueIdSchema,
    decidedAt: instantSchema,
  })
  .strict();

const recommendationStateShape = z
  .object({
    schemaVersion: z.literal('kfc-recommendation-state-v1'),
    revision: nonNegativeIntegerSchema,
    orderFlowId: orderingJourneyIdSchema,
    stage: recommendationStageSchema,
    attemptedPlacements: z
      .array(placementSchema)
      .refine(unique, 'Attempted placements must be unique'),
    shownActionIds: z
      .array(opaqueIdSchema)
      .refine(unique, 'Shown action IDs must be unique'),
    rejectedActionIds: z
      .array(opaqueIdSchema)
      .refine(unique, 'Rejected action IDs must be unique'),
    pendingRecommendation: pendingRecommendationSchema.nullable(),
    recordedOutcomeEventIds: z
      .array(recommendationEventIdSchema)
      .refine(unique, 'Recorded outcome event IDs must be unique'),
    nextEligiblePlacement: nextEligiblePlacementSchema,
  })
  .strict();

export const renderedRecommendationActionSchema = z
  .object({
    actionId: opaqueIdSchema,
    position: z.number().int().min(1).max(4),
  })
  .strict();

const recommendationImpressionRequestShape = z
  .object({
    schemaVersion: z.literal(KFC_RECOMMENDATION_EVENT_VERSION),
    eventId: recommendationEventIdSchema,
    occurredAt: instantSchema,
    assistantTurnId: opaqueIdSchema,
    attachmentId: opaqueIdSchema,
    renderedActions: z.array(renderedRecommendationActionSchema).min(1).max(4),
    cartRevision: opaqueIdSchema,
    actionDigest: sha256Schema,
  })
  .strict();

export const recommendationOutcomeRequestEventTypeSchema = z.enum([
  'selected',
  'explicitly_dismissed',
  'ignored',
  'superseded',
  'cart_mutation_succeeded',
  'cart_mutation_failed',
  'checkout_completed',
  'order_abandoned',
  'order_cancelled',
]);

const recommendationOutcomeRequestShape = z
  .object({
    schemaVersion: z.literal(KFC_RECOMMENDATION_EVENT_VERSION),
    eventId: recommendationEventIdSchema,
    eventType: recommendationOutcomeRequestEventTypeSchema,
    occurredAt: instantSchema,
    actor: eventActorSchema,
    actionId: opaqueIdSchema.nullable(),
    cartRevision: opaqueIdSchema.nullable(),
    payload: z.record(jsonValueSchema),
  })
  .strict();

const bindings = (value: z.infer<typeof commerceSnapshotBindingsSchema>) =>
  [
    ['catalog', value.catalog],
    ['modifierGraph', value.modifierGraph],
    ['store', value.store],
    ['availability', value.availability],
    ['promotion', value.promotion],
  ] as const;

export const recommendationDecisionRequestSchema =
  recommendationDecisionRequestShape.superRefine((value, context) => {
    if (value.cart.revision !== value.cartRevision) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cartRevision'],
        message: 'Cart revision must match the cart snapshot revision',
      });
    }

    const snapshotBindings = bindings(value.commerceSnapshotBindings);
    const commerceEnvironment = snapshotBindings[0][1].commerceEnvironment;
    if (
      snapshotBindings.some(
        ([, binding]) => binding.commerceEnvironment !== commerceEnvironment,
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['commerceSnapshotBindings'],
        message: 'All snapshot bindings must share a commerce environment',
      });
    }

    for (const [name, binding] of snapshotBindings) {
      const effectiveAt = compareCanonicalUtcInstants(
        binding.effectiveAt,
        value.decisionTime,
      );
      const expiresAt = compareCanonicalUtcInstants(
        value.decisionTime,
        binding.expiresAt,
      );
      const observedAt = compareCanonicalUtcInstants(
        binding.observedAt,
        value.decisionTime,
      );
      if (effectiveAt === null || expiresAt === null || observedAt === null) {
        continue;
      }
      if (effectiveAt > 0 || expiresAt >= 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['commerceSnapshotBindings', name],
          message: 'Snapshot must be effective at the decision time',
        });
      }
      if (observedAt > 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['commerceSnapshotBindings', name, 'observedAt'],
          message: 'Snapshot must be observed by the decision time',
        });
      }
    }
  });

export const recommendationDecisionResponseSchema =
  recommendationDecisionResponseShape.superRefine((value, context) => {
    const actionCount = value.primaryOffer?.actions.length ?? 0;

    if (value.status === 'recommended' && value.primaryOffer === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['primaryOffer'],
        message: 'Recommended responses require a primary offer',
      });
    }
    if (value.status !== 'recommended' && value.primaryOffer !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['primaryOffer'],
        message: 'Non-recommended responses must not have a primary offer',
      });
    }
    if (
      value.counts.eligible + value.counts.ineligible !==
      value.counts.potential
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['counts', 'potential'],
        message: 'Eligible and ineligible counts must equal potential',
      });
    }
    if (value.counts.displayed !== actionCount) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['counts', 'displayed'],
        message: 'Displayed count must equal the number of offered actions',
      });
    }

    const actionIds = new Set(
      value.primaryOffer?.actions.map((action) => action.actionId) ?? [],
    );
    if (value.displayFacts.some((fact) => !actionIds.has(fact.actionId))) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['displayFacts'],
        message: 'Display facts must reference authoritative offer actions',
      });
    }

    const actions = value.primaryOffer?.actions ?? [];
    const hasReplacementAction = actions.some(
      (action) => action.type === 'replace_cart_line',
    );
    const isValidSanityReplacement =
      value.status === 'recommended' &&
      value.decisionSource === 'merchandising_replacement' &&
      actions.length === 1 &&
      actions[0]?.type === 'replace_cart_line';
    if (hasReplacementAction && !isValidSanityReplacement) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['primaryOffer', 'actions'],
        message: 'A replacement requires one merchandising replacement action',
      });
    }
    if (
      value.primaryOffer !== null &&
      !isValidSanityReplacement &&
      value.placement === 'modifier_upsell' &&
      (!placementAcceptsActionCount(value.placement, actions.length) ||
        actions[0]?.type !== 'apply_modifier')
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['primaryOffer', 'actions'],
        message: 'Modifier Upsell requires exactly one modifier action',
      });
    }
    if (
      value.primaryOffer !== null &&
      !isValidSanityReplacement &&
      (value.placement === 'local_favorite' || value.placement === 'for_you') &&
      (!placementAcceptsActionCount(value.placement, actions.length) ||
        actions[0]?.type !== 'add_product')
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['primaryOffer', 'actions'],
        message:
          'Local Favorite and For You require exactly one product action',
      });
    }
    if (
      value.primaryOffer !== null &&
      !isValidSanityReplacement &&
      value.placement === 'smart_cross_sell' &&
      !(
        placementAcceptsActionCount(value.placement, actions.length) &&
        actions.every((action) => action.type === 'add_product')
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['primaryOffer', 'actions'],
        message: 'Smart Cross-sell requires three or four product actions',
      });
    }
  });

export const recommendationStateSchema = recommendationStateShape.superRefine(
  (value, context) => {
    const pending = value.pendingRecommendation;
    const pendingIsStarter =
      pending !== null &&
      starterPlacementSchema.safeParse(pending.placement).success;
    const invalidStage = (message: string) =>
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['stage'],
        message,
      });

    switch (value.stage) {
      case 'starter_eligible':
        if (value.nextEligiblePlacement !== 'starter' || pending !== null) {
          invalidStage(
            'Starter eligibility requires the starter next placement and no pending recommendation',
          );
        }
        break;
      case 'starter_resolved':
        if (
          value.nextEligiblePlacement !== null ||
          (pending !== null && !pendingIsStarter)
        ) {
          invalidStage(
            'Starter resolution allows only a pending starter and no next placement',
          );
        }
        break;
      case 'modifier_eligible':
        if (
          value.nextEligiblePlacement !== 'modifier_upsell' ||
          (pending !== null && !pendingIsStarter)
        ) {
          invalidStage(
            'Modifier eligibility allows only a pending starter and requires Modifier Upsell next',
          );
        }
        break;
      case 'modifier_pending':
        if (
          value.nextEligiblePlacement !== null ||
          pending === null ||
          pending.placement !== 'modifier_upsell'
        ) {
          invalidStage(
            'Modifier pending requires a pending Modifier Upsell and no next placement',
          );
        }
        break;
      case 'modifier_resolved':
        if (
          value.nextEligiblePlacement !== 'smart_cross_sell' ||
          pending !== null
        ) {
          invalidStage(
            'Modifier resolution requires Smart Cross-sell next and no pending recommendation',
          );
        }
        break;
      case 'smart_cross_sell_eligible':
        if (
          value.nextEligiblePlacement !== 'smart_cross_sell' ||
          pending !== null
        ) {
          invalidStage(
            'Smart Cross-sell eligibility requires Smart Cross-sell next and no pending recommendation',
          );
        }
        break;
      case 'smart_cross_sell_pending':
        if (
          value.nextEligiblePlacement !== null ||
          pending === null ||
          pending.placement !== 'smart_cross_sell'
        ) {
          invalidStage(
            'Smart Cross-sell pending requires a pending Smart Cross-sell and no next placement',
          );
        }
        break;
      case 'complete':
        if (value.nextEligiblePlacement !== null || pending !== null) {
          invalidStage(
            'Complete state requires no next or pending recommendation',
          );
        }
        break;
    }

    if (
      pending !== null &&
      !value.attemptedPlacements.includes(pending.placement)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['pendingRecommendation', 'placement'],
        message: 'Pending recommendation placement must already be attempted',
      });
    }
  },
);

export const recommendationImpressionRequestSchema =
  recommendationImpressionRequestShape.superRefine((value, context) => {
    const actionIds = value.renderedActions.map((action) => action.actionId);
    const positions = value.renderedActions.map((action) => action.position);
    if (!unique(actionIds)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['renderedActions'],
        message: 'Rendered action IDs must be unique',
      });
    }
    if (new Set(positions).size !== positions.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['renderedActions'],
        message: 'Rendered action positions must be unique',
      });
    }
  });

export const recommendationOutcomeRequestSchema =
  recommendationOutcomeRequestShape.superRefine((value, context) => {
    if (
      (value.eventType === 'selected' ||
        value.eventType === 'cart_mutation_succeeded' ||
        value.eventType === 'cart_mutation_failed') &&
      value.actionId === null
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['actionId'],
        message: 'Selected and mutation outcomes require an action ID',
      });
    }
    if (
      (value.eventType === 'checkout_completed' ||
        value.eventType === 'order_abandoned' ||
        value.eventType === 'order_cancelled') &&
      value.actionId !== null
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['actionId'],
        message: 'Terminal outcomes require a null action ID',
      });
    }
  });

export function parseRecommendationDecisionRequest(
  value: unknown,
): RecommendationDecisionRequest {
  return recommendationDecisionRequestSchema.parse(value);
}

export function parseRecommendationDecisionResponse(
  value: unknown,
): RecommendationDecisionResponse {
  return recommendationDecisionResponseSchema.parse(value);
}

export function parseRecommendationEvent(value: unknown): RecommendationEvent {
  return recommendationEventSchema.parse(value);
}

export function parseRecommendationState(value: unknown): RecommendationState {
  return recommendationStateSchema.parse(value);
}

export function parseRecommendationImpressionRequest(
  value: unknown,
): RecommendationImpressionRequest {
  return recommendationImpressionRequestSchema.parse(value);
}

export function parseRecommendationOutcomeRequest(
  value: unknown,
): RecommendationOutcomeRequest {
  return recommendationOutcomeRequestSchema.parse(value);
}
