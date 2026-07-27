import { z } from 'zod';
import type {
  RecommendationDecisionRequest,
  RecommendationDecisionResponse,
  RecommendationEvent,
} from '../domain/contracts.js';
import {
  customerReasonCodeSchema,
  decisionSourceSchema,
  decisionStatusSchema,
  instantSchema,
  merchandisingEffectSchema,
  parseRecommendationEvent,
  recommendationActionSchema,
  recommendationCountsSchema,
  recommendationDecisionRequestSchema,
  recommendationDecisionResponseSchema,
  renderedRecommendationActionSchema,
  sha256Schema,
} from '../domain/schemas.js';
import { opaqueIdSchema } from '../domain/identities.js';
import type { RecommendationDecisionTechnicalEvidence } from '../application/types.js';
import type { RecommendationDecisionContext } from '../eligibility/types.js';

const finiteNumberSchema = z.number().finite();
const nonNegativeIntegerSchema = z.number().int().nonnegative();
const nonBlankStringSchema = z.string().min(1);

export interface RecommendationRenderBinding {
  recommendationId: string;
  assistantTurnId: string;
  attachmentId: string;
  renderedActions: z.infer<typeof renderedRecommendationActionSchema>[];
  actionDigest: string;
  decisionDigest: string;
  versionBindingDigest: string;
  sessionId: string;
  customerId: string | null;
  cartRevision: string;
}

export const recommendationRenderBindingSchema = z
  .object({
    recommendationId: opaqueIdSchema,
    assistantTurnId: opaqueIdSchema,
    attachmentId: opaqueIdSchema,
    renderedActions: z.array(renderedRecommendationActionSchema).max(4),
    actionDigest: sha256Schema,
    decisionDigest: sha256Schema,
    versionBindingDigest: sha256Schema,
    sessionId: opaqueIdSchema,
    customerId: opaqueIdSchema.nullable(),
    cartRevision: opaqueIdSchema,
  })
  .strict();

export function renderBindingForDecisionDigests(input: {
  requestFingerprint: string;
  actionDigest: string;
}): Pick<RecommendationRenderBinding, 'assistantTurnId' | 'attachmentId'> {
  const token = `${sha256Schema.parse(input.requestFingerprint).slice(0, 48)}${sha256Schema
    .parse(input.actionDigest)
    .slice(0, 48)}`;
  return {
    assistantTurnId: `recommendation-turn:${token}`,
    attachmentId: `recommendation-attachment:${token}`,
  };
}

export function presentationBindingForDecision(input: {
  request: RecommendationDecisionRequest;
  response: RecommendationDecisionResponse;
  requestFingerprint: string;
  actionDigest: string;
  decisionDigest: string;
  versionBindingDigest: string;
  customerId: string | null;
}): RecommendationRenderBinding {
  const identity = renderBindingForDecisionDigests(input);
  return recommendationRenderBindingSchema.parse({
    recommendationId: input.response.recommendationId,
    ...identity,
    renderedActions:
      input.response.primaryOffer?.actions.map((action, index) => ({
        actionId: action.actionId,
        position: index + 1,
      })) ?? [],
    actionDigest: input.actionDigest,
    decisionDigest: input.decisionDigest,
    versionBindingDigest: input.versionBindingDigest,
    sessionId: input.request.sessionId,
    customerId: input.customerId,
    cartRevision: input.request.cartRevision,
  });
}

const decisionRequestedPayloadSchema = z
  .object({
    requestFingerprint: sha256Schema,
    cartRevision: opaqueIdSchema,
  })
  .strict();

const decisionCompletedPayloadSchema = z
  .object({
    status: decisionStatusSchema,
    source: decisionSourceSchema,
    counts: recommendationCountsSchema,
    actionDigest: sha256Schema,
    traceRef: opaqueIdSchema,
  })
  .strict();

const impressionRenderedPayloadSchema = z
  .object({
    assistantTurnId: opaqueIdSchema,
    attachmentId: opaqueIdSchema,
    renderedActions: z
      .array(renderedRecommendationActionSchema)
      .min(1)
      .max(4)
      .refine(
        (actions) =>
          new Set(actions.map((action) => action.actionId)).size ===
            actions.length &&
          new Set(actions.map((action) => action.position)).size ===
            actions.length,
        'Rendered action IDs and positions must be unique',
      ),
    actionDigest: sha256Schema,
  })
  .strict();

const emptyOutcomePayloadSchema = z.object({}).strict();
const outcomeEventTypes = new Set<RecommendationEvent['eventType']>([
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

export function parsePersistedRecommendationEvent(
  value: unknown,
): RecommendationEvent {
  const event = parseRecommendationEvent(value);
  if (event.eventType === 'candidate_eligibility_summary') {
    throw new Error('recommendation_candidate_summary_persistence_unsupported');
  }
  if (event.eventType === 'decision_requested') {
    const payload = decisionRequestedPayloadSchema.parse(event.payload);
    if (
      event.recommendationId !== null ||
      event.cartRevision === null ||
      payload.cartRevision !== event.cartRevision
    ) {
      throw new Error('recommendation_decision_requested_payload_mismatch');
    }
    return { ...event, payload };
  }
  if (event.eventType === 'decision_completed') {
    if (event.recommendationId === null) {
      throw new Error('recommendation_decision_completed_identity_missing');
    }
    return {
      ...event,
      payload: decisionCompletedPayloadSchema.parse(event.payload),
    };
  }
  if (event.eventType === 'impression_rendered') {
    return {
      ...event,
      payload: impressionRenderedPayloadSchema.parse(event.payload),
    };
  }
  if (outcomeEventTypes.has(event.eventType)) {
    return {
      ...event,
      payload: emptyOutcomePayloadSchema.parse(event.payload),
    };
  }
  throw new Error('recommendation_event_persistence_unsupported');
}

const recommendationCandidateSchema = z
  .object({
    action: recommendationActionSchema,
    targetId: nonBlankStringSchema,
    sellableItemId: nonBlankStringSchema,
    categoryId: nonBlankStringSchema,
    name: z.string(),
    imageUrl: z.string().nullable(),
    basePriceVnd: nonNegativeIntegerSchema,
    activeDiscountRatio: finiteNumberSchema,
    promotionId: nonBlankStringSchema.nullable(),
    parentCartLineId: nonBlankStringSchema.nullable(),
    modifierGroupPath: z.array(nonBlankStringSchema),
  })
  .strict();

const eligibilityDecisionSchema = z
  .object({
    policyVersion: z.literal('kfc-recommendation-policy-v1'),
    actionId: nonBlankStringSchema,
    eligible: z.boolean(),
    reasonCodes: z.array(
      z.enum([
        'eligible',
        'placement_already_attempted',
        'placement_not_yet_eligible',
        'verified_history_required',
        'zero_history_required',
        'parent_cart_line_required',
        'catalog_unavailable',
        'store_unavailable',
        'non_sellable_product',
        'already_in_cart',
        'previously_shown',
        'previously_rejected',
        'verified_dietary_exclusion',
        'modifier_parent_mismatch',
        'modifier_group_at_capacity',
        'no_positive_price_modifier',
      ]),
    ),
    evidenceBindings: z.array(nonBlankStringSchema),
    digest: sha256Schema,
  })
  .strict();

const rankedCandidateSchema = z
  .object({
    candidate: recommendationCandidateSchema,
    score: finiteNumberSchema,
    reasonCodes: z.array(customerReasonCodeSchema),
    featureSummary: z.record(
      z.union([finiteNumberSchema, z.string(), z.boolean(), z.null()]),
    ),
  })
  .strict();

const merchandisingResolutionSchema = z
  .object({
    suppressed: z.boolean(),
    replacement: z.array(rankedCandidateSchema).nullable(),
    rankedCandidates: z.array(rankedCandidateSchema),
    effects: z.array(merchandisingEffectSchema),
    reasonCodes: z.array(customerReasonCodeSchema),
  })
  .strict();

const shadowScoreSchema = z
  .object({
    actionId: nonBlankStringSchema,
    calibratedProbability: finiteNumberSchema.min(0).max(1),
    expectedValueScore: finiteNumberSchema,
    modelArtifactId: nonBlankStringSchema,
    calibrationId: nonBlankStringSchema,
    featureSchema: nonBlankStringSchema,
    featureContributions: z
      .array(
        z
          .object({
            feature: nonBlankStringSchema,
            reasonCode: nonBlankStringSchema,
            contribution: finiteNumberSchema.min(-1).max(1),
          })
          .strict(),
      )
      .max(5),
  })
  .strict();

const shadowComparisonBase = {
  outputMode: z.enum(['baseline', 'learned_technical']),
  eligibleActionIds: z.array(nonBlankStringSchema),
  baselineOrderingActionIds: z.array(nonBlankStringSchema),
} as const;

const shadowComparisonSchema = z.discriminatedUnion('status', [
  z
    .object({
      ...shadowComparisonBase,
      status: z.enum(['not_applicable', 'not_configured']),
      modelRevision: z.null(),
      activeTechnicalOrdering: z.literal('baseline'),
    })
    .strict(),
  z
    .object({
      ...shadowComparisonBase,
      status: z.literal('failed'),
      modelRevision: nonBlankStringSchema,
      activeTechnicalOrdering: z.literal('baseline'),
      failureCode: z.enum([
        'shadow_deadline_exceeded',
        'shadow_unavailable',
        'shadow_response_invalid',
      ]),
    })
    .strict(),
  z
    .object({
      ...shadowComparisonBase,
      status: z.literal('succeeded'),
      modelRevision: nonBlankStringSchema,
      activeTechnicalOrdering: z.enum(['baseline', 'learned']),
      learnedOrdering: z.array(shadowScoreSchema),
      provenance: z
        .object({
          modelRevision: nonBlankStringSchema,
          modelArtifactIds: z.array(nonBlankStringSchema).min(1),
          calibrationIds: z.array(nonBlankStringSchema).min(1),
          featureSchema: nonBlankStringSchema,
        })
        .strict(),
    })
    .strict(),
]);

export const recommendationDecisionTechnicalEvidenceSchema = z
  .object({
    potentialCandidates: z.array(recommendationCandidateSchema),
    eligibilityDecisions: z.array(eligibilityDecisionSchema),
    eligiblePrePolicyRanking: z.array(rankedCandidateSchema),
    merchandisingResolution: merchandisingResolutionSchema,
    emptyReason: z
      .enum([
        'no_eligible_candidates',
        'placement_already_attempted',
        'placement_not_yet_eligible',
        'verified_history_required',
        'parent_cart_line_required',
        'no_positive_price_modifier',
        'merchandising_suppressed',
        'invalid_context',
      ])
      .nullable(),
    shadowComparison: shadowComparisonSchema,
  })
  .strict();

export interface RecommendationDecisionRecord {
  request: RecommendationDecisionRequest;
  response: RecommendationDecisionResponse;
  technical: RecommendationDecisionTechnicalEvidence;
  requestFingerprint: string;
  actionDigest: string;
  renderBinding: RecommendationRenderBinding;
  stateRevisionBefore: number;
  stateRevisionAfter: number;
  recordedAt: string;
}

export const recommendationDecisionRecordSchema = z
  .object({
    request: recommendationDecisionRequestSchema,
    response: recommendationDecisionResponseSchema,
    technical: recommendationDecisionTechnicalEvidenceSchema,
    requestFingerprint: sha256Schema,
    actionDigest: sha256Schema,
    renderBinding: recommendationRenderBindingSchema,
    stateRevisionBefore: nonNegativeIntegerSchema,
    stateRevisionAfter: nonNegativeIntegerSchema,
    recordedAt: instantSchema,
  })
  .strict()
  .superRefine((record, context) => {
    if (
      record.response.requestId !== record.request.requestId ||
      record.response.orderFlowId !== record.request.orderFlowId ||
      record.response.placement !== record.request.placement
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['response'],
        message: 'Decision response must correlate to the stored request',
      });
    }
    if (record.stateRevisionAfter <= record.stateRevisionBefore) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['stateRevisionAfter'],
        message: 'Decision state revision must advance monotonically',
      });
    }
    const expectedRenderBinding = renderBindingForDecisionDigests(record);
    if (
      record.renderBinding.assistantTurnId !==
        expectedRenderBinding.assistantTurnId ||
      record.renderBinding.attachmentId !==
        expectedRenderBinding.attachmentId ||
      record.renderBinding.recommendationId !==
        record.response.recommendationId ||
      record.renderBinding.sessionId !== record.request.sessionId ||
      record.renderBinding.cartRevision !== record.request.cartRevision ||
      record.renderBinding.actionDigest !== record.actionDigest ||
      JSON.stringify(record.renderBinding.renderedActions) !==
        JSON.stringify(
          record.response.primaryOffer?.actions.map((action, index) => ({
            actionId: action.actionId,
            position: index + 1,
          })) ?? [],
        )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['renderBinding'],
        message: 'Render binding must be derived from the decision digests',
      });
    }
  });

export function parseRecommendationDecisionRecord(
  value: unknown,
): RecommendationDecisionRecord {
  return recommendationDecisionRecordSchema.parse(value);
}

export interface RecommendationDecisionStoragePayload {
  request: RecommendationDecisionRequest;
  response: RecommendationDecisionResponse;
  technical: RecommendationDecisionTechnicalEvidence;
  renderBinding: RecommendationRenderBinding;
}

export function serializeRecommendationDecisionStoragePayload(
  record: RecommendationDecisionRecord,
): { responseJson: string; technicalJson: string } {
  const parsed = parseRecommendationDecisionRecord(record);
  return {
    responseJson: JSON.stringify(parsed.response),
    technicalJson: JSON.stringify({
      request: parsed.request,
      renderBinding: parsed.renderBinding,
      technical: parsed.technical,
    }),
  };
}

export function parseRecommendationDecisionStoragePayload(input: {
  responseJson: string;
  technicalJson: string;
}): RecommendationDecisionStoragePayload {
  const technicalStorage = JSON.parse(input.technicalJson) as unknown;
  if (
    typeof technicalStorage !== 'object' ||
    technicalStorage === null ||
    Array.isArray(technicalStorage) ||
    Object.keys(technicalStorage).sort().join(',') !==
      'renderBinding,request,technical'
  ) {
    throw new Error('recommendation_technical_storage_invalid');
  }
  const stored = technicalStorage as Record<string, unknown>;
  return {
    request: recommendationDecisionRequestSchema.parse(stored.request),
    response: recommendationDecisionResponseSchema.parse(
      JSON.parse(input.responseJson) as unknown,
    ),
    renderBinding: recommendationRenderBindingSchema.parse(
      stored.renderBinding,
    ),
    technical: recommendationDecisionTechnicalEvidenceSchema.parse(
      stored.technical,
    ),
  };
}

const completedOrderSchema = z
  .object({
    orderId: nonBlankStringSchema,
    completedAt: instantSchema,
    lines: z.array(
      z
        .object({
          sellableItemId: nonBlankStringSchema,
          categoryId: nonBlankStringSchema,
          quantity: z.number().int().positive(),
        })
        .strict(),
    ),
  })
  .strict();

export interface RecommendationDemoCustomerHistoryRecord {
  verifiedCustomerRef: string;
  fixtureLabel: string;
  linked: boolean;
  completedOrders: NonNullable<
    RecommendationDecisionContext['customerHistory']
  >['completedOrders'];
  favoriteSellableItemIds: string[];
  updatedAt: string;
}

export const recommendationDemoCustomerHistoryRecordSchema = z
  .object({
    verifiedCustomerRef: nonBlankStringSchema,
    fixtureLabel: z
      .string()
      .min(1)
      .refine(
        (value) => /mock|synthetic/iu.test(value),
        'Fixture label must identify mock/synthetic POC data',
      ),
    linked: z.boolean(),
    completedOrders: z.array(completedOrderSchema),
    favoriteSellableItemIds: z.array(nonBlankStringSchema),
    updatedAt: instantSchema,
  })
  .strict();

export function parseRecommendationDemoCustomerHistoryRecord(
  value: unknown,
): RecommendationDemoCustomerHistoryRecord {
  return recommendationDemoCustomerHistoryRecordSchema.parse(value);
}
