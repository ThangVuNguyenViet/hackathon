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
    calibratorRevision: opaqueIdSchema,
    featureSchemaDigest: sha256Schema,
    thresholdRevision: opaqueIdSchema,
    composerContractDigest: sha256Schema,
    qualificationRunId: opaqueIdSchema,
    qualificationEvidenceDigest: sha256Schema,
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
    if (
      response.counts.potential < response.counts.eligible ||
      response.counts.eligible < response.counts.scored ||
      response.counts.scored < response.counts.displayed
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['counts'],
        message: 'Recommendation counts must be monotonic',
      });
    }
    const actionIds = new Set(
      response.proposals.map((proposal) => proposal.actionId),
    );
    if (actionIds.size !== response.proposals.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['proposals'],
        message: 'Proposal action identifiers must be unique',
      });
    }
    if (
      response.proposals.some(({ action }) =>
        response.recommendationType === 'modifier_upsell'
          ? action.type !== 'apply_modifier'
          : action.type !== 'add_product',
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['proposals'],
        message: 'Proposal action is incompatible with recommendation type',
      });
    }
  });

export type AutomaticRecommendationResponse = z.infer<typeof responseSchema>;

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
  orderingJourneyRef: opaqueIdSchema,
  opportunityRef: opaqueIdSchema,
  cartRevision: opaqueIdSchema,
} as const;

const impressionSchema = z
  .object({
    ...eventBase,
    renderedActions: z.array(renderedActionSchema).min(1).max(4),
  })
  .strict()
  .superRefine((impression, context) => {
    const positions = new Set(
      impression.renderedActions.map(
        ({ renderedPosition }) => renderedPosition,
      ),
    );
    const actionIds = new Set(
      impression.renderedActions.map(({ actionId }) => actionId),
    );
    if (positions.size !== impression.renderedActions.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['renderedActions'],
        message: 'Rendered positions must be unique',
      });
    }
    if (actionIds.size !== impression.renderedActions.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['renderedActions'],
        message: 'Rendered action identifiers must be unique',
      });
    }
  });

const actionOutcomeSchema = z
  .object({
    ...eventBase,
    eventType: z.enum(['selected', 'action_dismissed']),
    actionId: opaqueIdSchema,
    renderedPosition: z.number().int().positive(),
  })
  .strict();
const mutationOutcomeSchema = z
  .object({
    ...eventBase,
    eventType: z.enum(['cart_mutation_succeeded', 'cart_mutation_failed']),
    actionId: opaqueIdSchema,
    cartMutationRef: opaqueIdSchema,
  })
  .strict();
const slateDismissedOutcomeSchema = z
  .object({
    ...eventBase,
    eventType: z.literal('slate_dismissed'),
  })
  .strict();
const checkoutCompletedOutcomeSchema = z
  .object({
    ...eventBase,
    eventType: z.literal('checkout_completed'),
    orderRef: opaqueIdSchema,
  })
  .strict();
const orderAbandonedOutcomeSchema = z
  .object({
    ...eventBase,
    eventType: z.literal('order_abandoned'),
  })
  .strict();
const outcomeSchema = z.discriminatedUnion('eventType', [
  actionOutcomeSchema,
  mutationOutcomeSchema,
  slateDismissedOutcomeSchema,
  checkoutCompletedOutcomeSchema,
  orderAbandonedOutcomeSchema,
]);

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
      z.literal(401),
      z.literal(403),
      z.literal(404),
      z.literal(409),
      z.literal(503),
    ]),
    code: z.enum([
      'invalid_request',
      'unauthorized',
      'forbidden',
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
    const validCodesByStatus: Record<number, readonly string[]> = {
      400: ['invalid_request'],
      401: ['unauthorized'],
      403: ['forbidden'],
      404: ['recommendation_not_found'],
      409: ['identity_conflict', 'stale_or_invalid_action'],
      503: ['recommendation_infrastructure_unavailable'],
    };
    if (!validCodesByStatus[problem.status].includes(problem.code)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['code'],
        message: 'Problem code must agree with its HTTP status',
      });
    }
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
