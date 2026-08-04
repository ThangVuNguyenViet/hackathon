import { z } from 'zod';

const opaqueIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const moneySchema = z
  .object({
    amount: z.number().int().nonnegative(),
    currency: z.literal('VND'),
  })
  .strict();

const modelBindingSchema = z
  .object({
    bundleId: opaqueIdSchema,
    bundleDigest: sha256Schema,
    modelRevision: opaqueIdSchema,
    calibrationRevision: opaqueIdSchema,
    featureSchema: opaqueIdSchema,
    datasetDigest: sha256Schema,
  })
  .strict();

const proposalSchema = z
  .object({
    actionId: opaqueIdSchema,
    action: z.discriminatedUnion('type', [
      z
        .object({
          type: z.literal('add_product'),
          sellableItemId: opaqueIdSchema,
          quantity: z.number().int().positive(),
          priceImpact: moneySchema,
        })
        .strict(),
      z
        .object({
          type: z.literal('apply_modifier'),
          parentCartLineId: opaqueIdSchema,
          parentSellableItemId: opaqueIdSchema,
          optionId: opaqueIdSchema,
          groupPath: z.array(opaqueIdSchema).min(1),
          quantity: z.number().int().positive(),
          priceImpact: moneySchema,
        })
        .strict(),
    ]),
    display: z
      .object({
        name: z.string().trim().min(1),
        imageUrl: z.string().url().nullable(),
        priceImpact: moneySchema,
      })
      .strict(),
    reasonCodes: z
      .array(
        z.enum([
          'popular_here',
          'ordered_before',
          'matches_your_history',
          'completes_your_item',
          'completes_your_meal',
          'active_offer',
        ]),
      )
      .min(1),
  })
  .strict();

const emptyReasonSchema = z.enum([
  'no_qualified_model',
  'no_eligible_candidates',
  'insufficient_history',
  'parent_cart_line_not_found',
  'empty_cart',
  'no_candidate_above_threshold',
  'recommendation_serving_paused',
]);

const responseSchema = z
  .object({
    schemaVersion: z.literal('kfc-automatic-recommendation-v1'),
    requestId: opaqueIdSchema,
    recommendationId: opaqueIdSchema,
    recommendationType: z.enum([
      'local_favorite',
      'for_you',
      'modifier_upsell',
      'smart_cross_sell',
    ]),
    status: z.enum(['recommended', 'empty', 'paused']),
    emptyReason: emptyReasonSchema.nullable(),
    cartRevision: opaqueIdSchema,
    catalogRevision: opaqueIdSchema,
    expiresAt: z.string().datetime({ offset: true }),
    model: modelBindingSchema.nullable(),
    proposals: z.array(proposalSchema).max(4),
    counts: z
      .object({
        potential: z.number().int().nonnegative(),
        eligible: z.number().int().nonnegative(),
        scored: z.number().int().nonnegative(),
        displayed: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict()
  .superRefine((response, context) => {
    const isRecommended = response.status === 'recommended';
    const isPaused = response.status === 'paused';
    const statusIsConsistent = isRecommended
      ? response.model !== null &&
        response.proposals.length > 0 &&
        response.emptyReason === null
      : response.model === null &&
        response.proposals.length === 0 &&
        (isPaused
          ? response.emptyReason === 'recommendation_serving_paused'
          : response.emptyReason !== null &&
            response.emptyReason !== 'recommendation_serving_paused');
    if (!statusIsConsistent) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Status, model, empty reason, and proposals disagree',
      });
    }
    const maximum = response.recommendationType === 'modifier_upsell' ? 3 : 4;
    if (response.proposals.length > maximum) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['proposals'],
        message: `Recommendation type allows at most ${maximum} proposals`,
      });
    }
    if (response.counts.displayed !== response.proposals.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['counts', 'displayed'],
        message: 'Displayed count must equal proposal count',
      });
    }
  });

export function parseAutomaticRecommendationResponse(value: unknown) {
  return responseSchema.parse(value);
}

const channelSchema = z.enum(['kiosk', 'chat', 'workbench', 'other']);
const renderedActionSchema = z
  .object({
    actionId: opaqueIdSchema,
    renderedPosition: z.number().int().positive(),
  })
  .strict();
const eventBase = {
  schemaVersion: z.literal('kfc-automatic-recommendation-event-v1'),
  eventId: opaqueIdSchema,
  channel: channelSchema,
  occurredAt: z.string().datetime({ offset: true }),
  cartRevision: opaqueIdSchema,
} as const;

const impressionSchema = z
  .object({
    ...eventBase,
    renderedActions: z.array(renderedActionSchema).max(4),
  })
  .strict();

const outcomeSchema = z
  .object({
    ...eventBase,
    eventType: z.enum([
      'selected',
      'explicitly_dismissed',
      'cart_mutation_succeeded',
      'cart_mutation_failed',
      'checkout_completed',
      'order_abandoned',
    ]),
    actionId: opaqueIdSchema.nullable(),
    renderedPosition: z.number().int().positive().nullable(),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict()
  .superRefine((outcome, context) => {
    const actionRequired = [
      'selected',
      'cart_mutation_succeeded',
      'cart_mutation_failed',
    ].includes(outcome.eventType);
    if (actionRequired && outcome.actionId === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['actionId'],
        message: 'This outcome requires an action identity',
      });
    }
  });

export function parseAutomaticRecommendationImpression(value: unknown) {
  return impressionSchema.parse(value);
}

export function parseAutomaticRecommendationOutcome(value: unknown) {
  return outcomeSchema.parse(value);
}

const problemSchema = z
  .object({
    type: z.string().url(),
    title: z.string().trim().min(1),
    status: z.union([
      z.literal(400),
      z.literal(404),
      z.literal(409),
      z.literal(503),
    ]),
    code: z.enum([
      'invalid_request',
      'recommendation_not_found',
      'identity_conflict',
      'stale_or_invalid_action',
      'recommendation_infrastructure_unavailable',
    ]),
    retryable: z.boolean(),
    requestId: opaqueIdSchema.nullable().optional(),
  })
  .strict()
  .superRefine((problem, context) => {
    if (problem.retryable !== (problem.status === 503)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['retryable'],
        message: 'Only infrastructure-unavailable responses are retryable',
      });
    }
  });

const inspectionSchema = z
  .object({
    schemaVersion: z.literal('kfc-automatic-inspection-v1'),
    recommendationId: opaqueIdSchema,
    requestDigest: sha256Schema,
    cartDigest: sha256Schema,
    model: modelBindingSchema.nullable(),
    candidateEvidence: z.array(z.record(z.string(), z.unknown())),
    persistenceEvidence: z.record(z.string(), z.unknown()),
  })
  .strict();

export function parseAutomaticRecommendationProblem(value: unknown) {
  return problemSchema.parse(value);
}

export function parseAutomaticRecommendationInspection(value: unknown) {
  return inspectionSchema.parse(value);
}
