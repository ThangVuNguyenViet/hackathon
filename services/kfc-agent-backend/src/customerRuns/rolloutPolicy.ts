import { z } from 'zod';
import type { AppEnv } from '../config/env.js';

const streamingRolloutPolicySchema = z
  .object({
    mode: z.enum(['off', 'internal', 'cohort', 'on']),
    cohortPercent: z.number().min(0).max(100),
    policyRevision: z.string().trim().min(1).max(200),
    internalCustomerIds: z.array(z.string().trim().min(1).max(200)).max(1_000),
    cohortSalt: z.string().max(500),
    supportedSchemaMin: z.number().int().positive(),
    supportedSchemaMax: z.number().int().positive(),
    provisionalGenUiEnabled: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.supportedSchemaMin > value.supportedSchemaMax) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['supportedSchemaMax'],
        message: 'supportedSchemaMax must be greater than or equal to supportedSchemaMin',
      });
    }
    if (value.mode === 'cohort' && value.cohortSalt.trim().length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cohortSalt'],
        message: 'cohortSalt is required in cohort mode',
      });
    }
  });

export type StreamingRolloutPolicy = z.infer<typeof streamingRolloutPolicySchema>;
export type StreamingAssignmentPath = 'legacy' | 'stream';
export type StreamingAssignmentReason =
  | 'rollout_off'
  | 'client_incapable'
  | 'unsupported_schema'
  | 'internal_allowlist'
  | 'not_internal'
  | 'cohort_selected'
  | 'outside_cohort'
  | 'rollout_on';

export interface StreamingClientCapability {
  appVersion: string;
  supportedSchemaVersions: number[];
}

export interface StreamingAssignment {
  path: StreamingAssignmentPath;
  reason: StreamingAssignmentReason;
  policyRevision: string;
  schemaVersion: number | null;
  provisionalGenUiEnabled: boolean;
}

export function createStreamingRolloutPolicy(input: unknown): StreamingRolloutPolicy {
  return streamingRolloutPolicySchema.parse(input);
}

export function createStreamingRolloutPolicyFromEnv(env: AppEnv): StreamingRolloutPolicy {
  return createStreamingRolloutPolicy({
    mode: env.KFC_CUSTOMER_CHAT_STREAMING_MODE,
    cohortPercent: env.KFC_CUSTOMER_CHAT_STREAMING_COHORT_PERCENT,
    policyRevision: env.KFC_CUSTOMER_CHAT_STREAMING_POLICY_REVISION,
    internalCustomerIds: env.KFC_CUSTOMER_CHAT_STREAMING_INTERNAL_CUSTOMER_IDS
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    cohortSalt: env.KFC_CUSTOMER_CHAT_STREAMING_COHORT_SALT,
    supportedSchemaMin: env.KFC_CUSTOMER_CHAT_STREAMING_SCHEMA_MIN,
    supportedSchemaMax: env.KFC_CUSTOMER_CHAT_STREAMING_SCHEMA_MAX,
    provisionalGenUiEnabled: env.KFC_CUSTOMER_CHAT_PROVISIONAL_GENUI_ENABLED,
  });
}

export function decideStreamingAssignment(input: {
  sessionId: string;
  customerId: string;
  clientCapability: StreamingClientCapability | null;
  policy: StreamingRolloutPolicy;
}): StreamingAssignment {
  const { policy } = input;
  if (policy.mode === 'off') return assignment(policy, 'legacy', 'rollout_off', null);
  if (!input.clientCapability) return assignment(policy, 'legacy', 'client_incapable', null);

  const schemaVersion = selectSchemaVersion(input.clientCapability, policy);
  if (schemaVersion === null) return assignment(policy, 'legacy', 'unsupported_schema', null);

  const internallyAllowed = policy.internalCustomerIds.includes(input.customerId);
  if (internallyAllowed) {
    return assignment(policy, 'stream', 'internal_allowlist', schemaVersion);
  }
  if (policy.mode === 'internal') {
    return assignment(policy, 'legacy', 'not_internal', schemaVersion);
  }
  if (policy.mode === 'on') {
    return assignment(policy, 'stream', 'rollout_on', schemaVersion);
  }

  const bucket = stableBucket(
    `${policy.cohortSalt}:${input.customerId}:${input.sessionId}`,
  );
  return bucket < policy.cohortPercent * 100
    ? assignment(policy, 'stream', 'cohort_selected', schemaVersion)
    : assignment(policy, 'legacy', 'outside_cohort', schemaVersion);
}

function selectSchemaVersion(
  capability: StreamingClientCapability,
  policy: StreamingRolloutPolicy,
): number | null {
  const compatible = capability.supportedSchemaVersions
    .filter(
      (version) =>
        Number.isInteger(version) &&
        version >= policy.supportedSchemaMin &&
        version <= policy.supportedSchemaMax,
    )
    .sort((left, right) => right - left);
  return compatible[0] ?? null;
}

function assignment(
  policy: StreamingRolloutPolicy,
  path: StreamingAssignmentPath,
  reason: StreamingAssignmentReason,
  schemaVersion: number | null,
): StreamingAssignment {
  return {
    path,
    reason,
    policyRevision: policy.policyRevision,
    schemaVersion,
    provisionalGenUiEnabled:
      path === 'stream' && policy.provisionalGenUiEnabled,
  };
}

function stableBucket(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % 10_000;
}
