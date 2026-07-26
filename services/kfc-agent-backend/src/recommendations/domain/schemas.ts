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
} from './contracts.js';
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
    sanitySnapshot: opaqueIdSchema,
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

    const decisionTime = Date.parse(value.decisionTime);
    for (const [name, binding] of snapshotBindings) {
      if (
        Date.parse(binding.effectiveAt) > decisionTime ||
        decisionTime >= Date.parse(binding.expiresAt)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['commerceSnapshotBindings', name],
          message: 'Snapshot must be effective at the decision time',
        });
      }
      if (Date.parse(binding.observedAt) > decisionTime) {
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
    if (
      value.primaryOffer !== null &&
      value.placement === 'modifier_upsell' &&
      (actions.length !== 1 || actions[0]?.type !== 'apply_modifier')
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['primaryOffer', 'actions'],
        message: 'Modifier Upsell requires exactly one modifier action',
      });
    }
    if (
      value.primaryOffer !== null &&
      (value.placement === 'local_favorite' || value.placement === 'for_you') &&
      (actions.length !== 1 || actions[0]?.type !== 'add_product')
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
      value.placement === 'smart_cross_sell' &&
      !(
        actions.length >= 3 &&
        actions.length <= 4 &&
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
