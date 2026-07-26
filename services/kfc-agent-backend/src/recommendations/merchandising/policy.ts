import { z } from 'zod';
import {
  commerceEnvironmentIdSchema,
  opaqueIdSchema,
  sanityPolicyIdSchema,
} from '../domain/identities.js';
import {
  customerReasonCodeSchema,
  fulfilmentModeSchema,
  instantSchema,
  merchandisingActionSchema,
  placementSchema,
} from '../domain/schemas.js';

const policyTextSchema = z.string().min(1).max(240);
const boundedUniqueIds = (maximum = 100) =>
  z
    .array(opaqueIdSchema)
    .max(maximum)
    .refine((ids) => new Set(ids).size === ids.length, 'IDs must be unique');

const policyTargetIdsSchema = boundedUniqueIds(4);

export const recommendationPolicySchema = z
  .object({
    schemaVersion: z.literal('kfc-recommendation-policy-v1'),
    policyId: sanityPolicyIdSchema,
    name: z.string().min(1).max(120),
    description: z.string().min(1).max(500),
    campaignId: z.string().min(1).max(120),
    authoredReason: z.string().min(1).max(500),
    enabled: z.boolean(),
    priority: z.number().int(),
    placement: placementSchema,
    action: merchandisingActionSchema,
    targetIds: policyTargetIdsSchema,
    environment: commerceEnvironmentIdSchema,
    includedStoreIds: boundedUniqueIds(),
    excludedStoreIds: boundedUniqueIds(),
    fulfilmentModes: z
      .array(fulfilmentModeSchema)
      .max(100)
      .refine(
        (modes) => new Set(modes).size === modes.length,
        'Fulfilment modes must be unique',
      ),
    minimumBasketSubtotalVnd: z.number().int().nonnegative().nullable(),
    maximumBasketSubtotalVnd: z.number().int().nonnegative().nullable(),
    requiredCartProductIds: boundedUniqueIds(),
    excludedCartProductIds: boundedUniqueIds(),
    requiredCartCategoryIds: boundedUniqueIds(),
    excludedCartCategoryIds: boundedUniqueIds(),
    verifiedCohorts: boundedUniqueIds(),
    startsAt: instantSchema,
    endsAt: instantSchema.nullable(),
    reasonCode: customerReasonCodeSchema,
    approvedText: z
      .object({ vi: policyTextSchema, en: policyTextSchema })
      .strict(),
    boostWeight: z.number().min(0).max(1).nullable(),
    pinPosition: z.number().int().min(1).max(4).nullable(),
  })
  .strict()
  .superRefine((policy, context) => {
    if (
      policy.minimumBasketSubtotalVnd !== null &&
      policy.maximumBasketSubtotalVnd !== null &&
      policy.minimumBasketSubtotalVnd > policy.maximumBasketSubtotalVnd
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Minimum basket subtotal must not exceed maximum basket subtotal',
        path: ['minimumBasketSubtotalVnd'],
      });
    }

    if (
      policy.endsAt !== null &&
      compareCanonicalInstants(policy.startsAt, policy.endsAt) >= 0
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Policy must end after it starts',
        path: ['endsAt'],
      });
    }

    const requiresTargets = [
      'exclude_target',
      'boost_target',
      'pin_target',
      'replace_slate',
    ].includes(policy.action);
    if (requiresTargets && policy.targetIds.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'This policy action requires at least one target',
        path: ['targetIds'],
      });
    }
    if (policy.action === 'suppress_placement' && policy.targetIds.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Suppression policies must not target actions',
        path: ['targetIds'],
      });
    }

    const permitsBoost = policy.action === 'boost_target';
    if (permitsBoost !== (policy.boostWeight !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Only boost policies may define boostWeight',
        path: ['boostWeight'],
      });
    }
    const permitsPin = policy.action === 'pin_target';
    if (permitsPin !== (policy.pinPosition !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Only pin policies may define pinPosition',
        path: ['pinPosition'],
      });
    }
  });

export const merchandisingPolicySnapshotSchema = z
  .object({
    schemaVersion: z.literal('kfc-recommendation-policy-snapshot-v1'),
    snapshotId: opaqueIdSchema,
    sourceRevision: z.string().min(1),
    publishedAt: instantSchema,
    complete: z.boolean(),
    commerceEnvironment: commerceEnvironmentIdSchema,
    policies: z
      .array(recommendationPolicySchema)
      .refine(
        (policies) =>
          new Set(policies.map((policy) => policy.policyId)).size ===
          policies.length,
        'Policy IDs must be unique',
      )
      .refine(
        (policies) =>
          policies.every(
            (policy) => policy.environment === policies[0]?.environment,
          ),
        'Policies must use one commerce environment',
      ),
  })
  .strict()
  .superRefine((snapshot, context) => {
    if (
      snapshot.policies.length > 0 &&
      snapshot.policies[0]?.environment !== snapshot.commerceEnvironment
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Policy environment must match the snapshot environment',
        path: ['commerceEnvironment'],
      });
    }
  });

export type RecommendationPolicy = z.infer<typeof recommendationPolicySchema>;
export type MerchandisingPolicySnapshot = z.infer<
  typeof merchandisingPolicySnapshotSchema
>;

export function compareCanonicalInstants(left: string, right: string): number {
  const parse = (value: string): { epoch: number; fraction: string } => {
    const [whole, fraction = ''] = value.slice(0, -1).split('.');
    return {
      epoch: Date.parse(`${whole}Z`),
      fraction: fraction.replace(/0+$/u, ''),
    };
  };
  const a = parse(left);
  const b = parse(right);
  if (a.epoch !== b.epoch) return a.epoch - b.epoch;
  const precision = Math.max(a.fraction.length, b.fraction.length);
  return a.fraction
    .padEnd(precision, '0')
    .localeCompare(b.fraction.padEnd(precision, '0'));
}
