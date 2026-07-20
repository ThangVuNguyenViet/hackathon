import { z } from 'zod';
import type {
  AuthenticatedCommerceApprovalPrincipal,
} from '../ordering/types.js';
import type { Channel } from './types.js';

export const VERIFIED_REF_SCHEMA_VERSION = 'kfc-verified-ref-v1' as const;

export const verifiedRefKindSchema = z.enum([
  'fulfillment_address',
  'saved_address',
  'payment_method',
  'selected_action_effect',
]);

export const verifiedRefLifecycleSchema = z.enum([
  'replayable',
  'one_shot',
]);

export type VerifiedRefKind = z.infer<typeof verifiedRefKindSchema>;
export type VerifiedRefLifecycle = z.infer<
  typeof verifiedRefLifecycleSchema
>;

export type VerifiedRefJsonValue =
  | null
  | boolean
  | number
  | string
  | VerifiedRefJsonValue[]
  | { [key: string]: VerifiedRefJsonValue };

export type VerifiedRefPayload = Record<string, VerifiedRefJsonValue>;

export const verifiedRefJsonValueSchema: z.ZodType<VerifiedRefJsonValue> =
  z.lazy(() =>
    z.union([
      z.null(),
      z.boolean(),
      z.number().finite(),
      z.string(),
      z.array(verifiedRefJsonValueSchema),
      z.record(verifiedRefJsonValueSchema),
    ]),
  );

export const verifiedRefPayloadSchema: z.ZodType<VerifiedRefPayload> =
  z.record(verifiedRefJsonValueSchema);

export const verifiedRefTimestampSchema = z
  .string()
  .datetime()
  .refine(
    (value) => new Date(value).toISOString() === value,
    'Timestamp must use canonical UTC millisecond precision',
  );

export const verifiedRefRevisionSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/u);

export const verifiedRefIdSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    'Verified reference id must be a canonical UUIDv4',
  );

const verifiedRefChannelSchema: z.ZodType<Channel> = z.enum([
  'messenger',
  'zalo',
  'kfc',
  'messenger_mock',
  'zalo_mock',
]);

export const verifiedRefPrincipalSchema: z.ZodType<
  AuthenticatedCommerceApprovalPrincipal
> =
  z
    .object({
      principalKind: z.literal('authenticated_customer').optional(),
      sessionId: z.string().min(1),
      customerId: z.string().min(1),
      channel: verifiedRefChannelSchema,
      authenticatedSubject: z.string().min(1),
      authenticationEvidenceRef: z.string().min(1),
    })
    .strict();

export const verifiedRefSchema = z
  .object({
    id: verifiedRefIdSchema,
    kind: verifiedRefKindSchema,
  })
  .strict();

const verifiedRefIssueFields = {
  kind: verifiedRefKindSchema,
  principal: verifiedRefPrincipalSchema,
  verifiedRevision: verifiedRefRevisionSchema,
  payload: verifiedRefPayloadSchema,
  lifecycle: verifiedRefLifecycleSchema,
  createdAt: verifiedRefTimestampSchema,
  expiresAt: verifiedRefTimestampSchema,
} as const;

function validateLifetime(
  value: { createdAt: string; expiresAt: string },
  context: z.RefinementCtx,
): void {
  if (Date.parse(value.createdAt) >= Date.parse(value.expiresAt)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['expiresAt'],
      message: 'Verified reference must expire after it is created',
    });
  }
}

export const issueVerifiedRefInputSchema = z
  .object(verifiedRefIssueFields)
  .strict()
  .superRefine(validateLifetime);

export const verifiedRefRecordSchema = z
  .object({
    schemaVersion: z.literal(VERIFIED_REF_SCHEMA_VERSION),
    ref: verifiedRefSchema,
    principal: verifiedRefPrincipalSchema,
    verifiedRevision: verifiedRefRevisionSchema,
    payload: verifiedRefPayloadSchema,
    lifecycle: verifiedRefLifecycleSchema,
    createdAt: verifiedRefTimestampSchema,
    expiresAt: verifiedRefTimestampSchema,
    claimedUseId: z.string().min(1).optional(),
    claimedAt: verifiedRefTimestampSchema.optional(),
  })
  .strict()
  .superRefine((record, context) => {
    validateLifetime(record, context);
    const hasClaimId = record.claimedUseId !== undefined;
    const hasClaimedAt = record.claimedAt !== undefined;
    if (hasClaimId !== hasClaimedAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['claimedUseId'],
        message: 'Verified reference claim fields must be present together',
      });
    }
    if (record.lifecycle === 'replayable' && hasClaimId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['claimedUseId'],
        message: 'Replayable verified references cannot be claimed',
      });
    }
    if (
      record.claimedAt !== undefined &&
      (Date.parse(record.claimedAt) < Date.parse(record.createdAt) ||
        Date.parse(record.claimedAt) >= Date.parse(record.expiresAt))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['claimedAt'],
        message: 'Verified reference claim must occur during its lifetime',
      });
    }
  });

export type VerifiedRef = z.infer<typeof verifiedRefSchema>;
export type IssueVerifiedRefInput = z.infer<
  typeof issueVerifiedRefInputSchema
>;
export type VerifiedRefRecord = z.infer<typeof verifiedRefRecordSchema>;

/**
 * The only public issuance boundary. The caller supplies verified server-side
 * evidence but can neither select nor replay an opaque reference identifier.
 */
export function issueVerifiedRefRecord(
  rawInput: unknown,
): VerifiedRefRecord {
  const input = issueVerifiedRefInputSchema.parse(rawInput);
  return verifiedRefRecordSchema.parse({
    schemaVersion: VERIFIED_REF_SCHEMA_VERSION,
    ref: {
      id: crypto.randomUUID(),
      kind: input.kind,
    },
    principal: input.principal,
    verifiedRevision: input.verifiedRevision,
    payload: input.payload,
    lifecycle: input.lifecycle,
    createdAt: input.createdAt,
    expiresAt: input.expiresAt,
  });
}
