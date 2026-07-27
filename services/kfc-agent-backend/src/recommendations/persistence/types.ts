import { z } from 'zod';
import type {
  RecommendationDecisionRequest,
  RecommendationDecisionResponse,
} from '../domain/contracts.js';
import {
  customerReasonCodeSchema,
  instantSchema,
  merchandisingEffectSchema,
  recommendationActionSchema,
  recommendationDecisionRequestSchema,
  recommendationDecisionResponseSchema,
  sha256Schema,
} from '../domain/schemas.js';
import type { RecommendationDecisionTechnicalEvidence } from '../application/types.js';
import type { RecommendationDecisionContext } from '../eligibility/types.js';

const finiteNumberSchema = z.number().finite();
const nonNegativeIntegerSchema = z.number().int().nonnegative();
const nonBlankStringSchema = z.string().min(1);

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
  })
  .strict();

export interface RecommendationDecisionRecord {
  request: RecommendationDecisionRequest;
  response: RecommendationDecisionResponse;
  technical: RecommendationDecisionTechnicalEvidence;
  requestFingerprint: string;
  actionDigest: string;
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
  });

export function parseRecommendationDecisionRecord(
  value: unknown,
): RecommendationDecisionRecord {
  return recommendationDecisionRecordSchema.parse(value);
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
