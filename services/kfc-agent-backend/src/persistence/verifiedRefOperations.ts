import { z } from 'zod';
import {
  verifiedRefPrincipalSchema,
  verifiedRefRecordSchema,
  verifiedRefRevisionSchema,
  verifiedRefSchema,
  verifiedRefTimestampSchema,
  type VerifiedRefRecord,
} from '../domain/verifiedRef.js';
import type {
  ClaimVerifiedRefInput,
  ResolveVerifiedRefInput,
} from './contracts.js';
import type { VerifiedRefStorageSnapshot } from './verifiedRef.js';

const resolveVerifiedRefInputSchema = z
  .object({
    ref: verifiedRefSchema,
    principal: verifiedRefPrincipalSchema,
    expectedVerifiedRevision: verifiedRefRevisionSchema,
    now: verifiedRefTimestampSchema,
  })
  .strict();

const runCommitFenceSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('agent_run'),
      runId: z.string().min(1),
      generation: z.number().int().nonnegative(),
      sessionAuthorityGeneration: z.number().int().nonnegative(),
      executionAttempt: z.number().int().positive(),
      executionLeaseToken: z.string().min(32).max(256),
    })
    .strict(),
  z
    .object({
      kind: z.literal('customer_run'),
      runId: z.string().min(1),
      sessionAuthorityGeneration: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('operation_lease'),
      requestId: z.string().min(1),
      operation: z.string().min(1),
      bindingFingerprint: z.string().min(1),
      attempt: z.number().int().positive(),
      leaseToken: z.string().min(1),
      sessionAuthorityGeneration: z.number().int().nonnegative(),
    })
    .strict(),
]);

const runCommitGuardSchema = z
  .object({
    sessionId: z.string().min(1),
    fence: runCommitFenceSchema,
    notAfter: verifiedRefTimestampSchema.optional(),
  })
  .strict();

const claimVerifiedRefInputSchema = z
  .object({
    ref: verifiedRefSchema,
    principal: verifiedRefPrincipalSchema,
    expectedVerifiedRevision: verifiedRefRevisionSchema,
    now: verifiedRefTimestampSchema,
    useId: z.string().min(1),
    runFence: runCommitGuardSchema,
  })
  .strict()
  .superRefine((input, context) => {
    if (input.runFence.sessionId !== input.principal.sessionId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['runFence', 'sessionId'],
        message:
          'Verified reference run fence must match its principal session',
      });
    }
  });

export function parseResolveVerifiedRefInput(
  rawInput: ResolveVerifiedRefInput,
): ResolveVerifiedRefInput {
  return resolveVerifiedRefInputSchema.parse(rawInput);
}

export function parseClaimVerifiedRefInput(
  rawInput: ClaimVerifiedRefInput,
): ClaimVerifiedRefInput {
  return claimVerifiedRefInputSchema.parse(rawInput);
}

export function verifiedRefSnapshotMatches(
  rawSnapshot: VerifiedRefStorageSnapshot,
  currentSessionGeneration: number,
  input: ResolveVerifiedRefInput,
): boolean {
  const snapshot = {
    record: verifiedRefRecordSchema.parse(rawSnapshot.record),
    sessionGeneration: z
      .number()
      .int()
      .nonnegative()
      .parse(rawSnapshot.sessionGeneration),
  };
  const { record } = snapshot;
  return (
    snapshot.sessionGeneration === currentSessionGeneration &&
    record.ref.id === input.ref.id &&
    record.ref.kind === input.ref.kind &&
    record.principal.sessionId === input.principal.sessionId &&
    record.principal.customerId === input.principal.customerId &&
    record.principal.channel === input.principal.channel &&
    record.principal.authenticatedSubject ===
      input.principal.authenticatedSubject &&
    record.principal.authenticationEvidenceRef ===
      input.principal.authenticationEvidenceRef &&
    record.verifiedRevision === input.expectedVerifiedRevision &&
    Date.parse(record.createdAt) <= Date.parse(input.now) &&
    Date.parse(record.expiresAt) > Date.parse(input.now)
  );
}

export function cloneVerifiedRefRecord(
  rawRecord: VerifiedRefRecord,
): VerifiedRefRecord {
  return structuredClone(verifiedRefRecordSchema.parse(rawRecord));
}
