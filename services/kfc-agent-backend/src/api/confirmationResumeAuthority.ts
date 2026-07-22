import type { ExternalCallContext } from '../clients/interfaces.js';
import type { CustomerAccessContext } from '../domain/types.js';
import { z } from 'zod';
import { createCommerceApprovalReceipt } from '../ordering/approvalReceipt.js';
import { approvalCapabilityScopes } from '../ordering/toolBoundaries.js';
import {
  createCommerceApprovalExecutionFence,
  type CommerceApprovalExecutionFence,
} from '../ordering/approvalExecutionFence.js';
import type { CommerceApprovalReceipt } from '../ordering/types.js';
import {
  guestPrincipalMatchesAuthority,
  isAuthenticatedCommerceApprovalPrincipal,
  isGuestCheckoutPrincipal,
} from '../ordering/commerceApprovalPrincipal.js';
import {
  confirmationPauseCreateInput,
  confirmationPauseIdentityDigest,
  confirmationResumeOperationBindingFingerprint,
  confirmationResumeProviderIdempotencyKey,
  parseConfirmationPauseRecord,
} from '../persistence/confirmationPause.js';
import type { ConfirmationPauseStorageSnapshot } from '../persistence/confirmationPause.js';
import type {
  ConfirmationPauseRecord,
  CreateConfirmationPauseInput,
  ReserveConfirmationResumeOperationInput,
} from '../persistence/contracts.js';
import { authorizeCustomerAccess } from '../security/customerAccessContext.js';
import {
  guestCheckoutAuthorityIsIssued,
  type GuestCheckoutAuthority,
} from '../security/guestCheckoutAuthority.js';
import {
  type VerifiedGuestConfirmationApprovalAuthority,
  verifiedGuestApprovalAuthorityMatches,
} from './confirmationApprovalCapability.js';
import { confirmationApprovalPausePointerSchema } from './confirmationPausePersistence.js';

const defaultExecutionTimeoutMs = 8_000;
const maximumExecutionTimeoutMs = 15_000;
const defaultPendingWaitMs = 8_000;

type ApprovalSecret = string | Uint8Array;
export type ConfirmationResumeDecision = CommerceApprovalReceipt['decision'];

export interface ConfirmationResumeOperationIdentity {
  requestId: string;
  operation: 'confirmation_resume';
  bindingFingerprint: string;
}

export type ConfirmationResumeClaimInput =
  ReserveConfirmationResumeOperationInput;

export type ConfirmationResumeOperationState =
  | { status: 'pending' }
  | { status: 'unknown'; lastError: string | null }
  | { status: 'completed'; result: Record<string, unknown> };

export type ConfirmationResumeClaimResult =
  | {
      status: 'claimed';
      attempt: number;
      leaseToken: string;
      reconciliation: boolean;
      sessionAuthorityGeneration: number;
    }
  | ConfirmationResumeOperationState
  | { status: 'conflict' | 'expired' | 'not_found' };

export type ConfirmationResumeCompletionResult =
  | { status: 'completed'; result: Record<string, unknown> }
  | { status: 'lost' | 'conflict' };

/**
 * The claim implementation is the durable authorization boundary. It must
 * atomically verify expectedPause against the current pause generation and
 * claim the exact operation identity before returning `claimed`.
 */
export interface ConfirmationResumeRepository {
  getPause(
    requestId: string,
  ): Promise<ConfirmationPauseStorageSnapshot | undefined>;
  inspectOperation(
    identity: ConfirmationResumeOperationIdentity,
  ): Promise<
    ConfirmationResumeOperationState | { status: 'conflict' } | undefined
  >;
  claimOperation(
    input: ConfirmationResumeClaimInput,
  ): Promise<ConfirmationResumeClaimResult>;
  waitForOperation(
    identity: ConfirmationResumeOperationIdentity,
    timeoutMs: number,
  ): Promise<ConfirmationResumeOperationState>;
  completeOperation(input: {
    identity: ConfirmationResumeOperationIdentity;
    attempt: number;
    leaseToken: string;
    sessionAuthorityGeneration: number;
    result: Record<string, unknown>;
    completedAt: string;
  }): Promise<ConfirmationResumeCompletionResult>;
  markOperationUnknown(input: {
    identity: ConfirmationResumeOperationIdentity;
    attempt: number;
    leaseToken: string;
    sessionAuthorityGeneration: number;
    errorCode: string;
    recordedAt: string;
  }): Promise<void>;
}

export interface ConfirmationResumeExecutionInput {
  pause: CreateConfirmationPauseInput;
  receipt: CommerceApprovalReceipt;
  checkpoint: {
    threadId: string;
    namespace: string;
    checkpointId: string;
  };
  executionFence: CommerceApprovalExecutionFence;
  signingSecret: ApprovalSecret;
  providerIdempotencyKey: string;
  attempt: number;
  reconciliation: boolean;
  externalCallContext: ExternalCallContext;
  abortExternalCalls(reason: unknown): void;
}

export interface ConfirmationResumeCoordinatorOptions {
  repository: ConfirmationResumeRepository;
  signingSecret: ApprovalSecret;
  accessContext(
    pause: ConfirmationPauseRecord,
  ): Promise<CustomerAccessContext | undefined>;
  /**
   * Controlled guest-checkout authority resolver. Production callers must
   * derive authorization from a verified signed capability; tests may return
   * only an authority issued by the controlled messenger_mock boundary.
   */
  guestCheckoutAuthority?(
    pause: ConfirmationPauseRecord,
  ): Promise<GuestCheckoutAuthority | undefined>;
  /**
   * Opaque authority returned only after the public HMAC capability was
   * verified against the exact persisted pause.
   */
  verifiedGuestAuthority?: VerifiedGuestConfirmationApprovalAuthority;
  revalidate(
    pause: CreateConfirmationPauseInput,
    externalCallContext: ExternalCallContext,
  ): Promise<{ ok: boolean }>;
  execute(
    input: ConfirmationResumeExecutionInput,
  ): Promise<Record<string, unknown>>;
  projectResult?(
    result: ConfirmationResumeStoredResult,
  ): Promise<ConfirmationResumePublicResult>;
  now?: () => Date;
  executionTimeoutMs?: number;
  pendingWaitMs?: number;
  /** Public capability routes reject completed-token replay; internal harnesses may opt into idempotent result replay. */
  rejectCompletedReplay?: boolean;
}

export interface ConfirmationResumeRequest {
  requestId: string;
  decision: ConfirmationResumeDecision;
}

export interface ConfirmationResumeResponse {
  status: number;
  body: Record<string, unknown>;
}

const confirmationResumeCommonResultFields = {
  actionOutcome: z.enum(['succeeded', 'failed']),
  requestId: z.string().uuid(),
  responseText: z.string().max(32_000),
  orderId: z.string().min(1).max(512).nullable().optional(),
} as const;

export const confirmationResumeStoredResultSchema = z.discriminatedUnion(
  'continuation',
  [
    z
      .object({
        ...confirmationResumeCommonResultFields,
        continuation: z.literal('turn_completed'),
      })
      .strict(),
    z
      .object({
        ...confirmationResumeCommonResultFields,
        continuation: z.literal('approval_required'),
        approvalPause: confirmationApprovalPausePointerSchema,
      })
      .strict(),
  ],
);

export const confirmationResumePublicResultSchema = z.discriminatedUnion(
  'continuation',
  [
    z
      .object({
        ...confirmationResumeCommonResultFields,
        continuation: z.literal('turn_completed'),
      })
      .strict(),
    z
      .object({
        ...confirmationResumeCommonResultFields,
        continuation: z.literal('approval_required'),
        capability: z.enum([
          'placeOrder',
          'createPaymentLink',
          'acquireVoucher',
          'redeemReward',
          'handoff',
          'resolveHandoff',
        ]),
        approvalCapability: z.string().min(1).max(8_192),
        expiresAt: z.string().datetime(),
      })
      .strict(),
  ],
);

export type ConfirmationResumeStoredResult = z.infer<
  typeof confirmationResumeStoredResultSchema
>;
export type ConfirmationResumePublicResult = z.infer<
  typeof confirmationResumePublicResultSchema
>;

export function assertSafeConfirmationResumeResult(
  value: unknown,
): asserts value is ConfirmationResumePublicResult {
  if (!confirmationResumePublicResultSchema.safeParse(value).success) {
    throw new Error('confirmation_resume_result_not_public');
  }
}

function exactPrincipalAccess(
  pause: ConfirmationPauseRecord,
  accessContext: CustomerAccessContext | undefined,
  now: number,
): boolean {
  if (!isAuthenticatedCommerceApprovalPrincipal(pause.principal)) {
    return false;
  }
  const access = authorizeCustomerAccess(
    accessContext,
    {
      channel: pause.channel,
      sessionId: pause.sessionId,
      customerId: pause.customerId,
      scope: approvalCapabilityScopes[pause.approvalBinding.capability],
    },
    now,
  );
  const evidence = accessContext?.authenticationEvidence;
  return (
    access.allowed &&
    accessContext?.authenticationState === 'authenticated' &&
    accessContext.kfcSubjectRef === pause.principal.authenticatedSubject &&
    evidence?.state === 'verified' &&
    evidence.evidenceRef === pause.principal.authenticationEvidenceRef
  );
}

async function exactGuestPrincipalAccess(input: {
  pause: ConfirmationPauseRecord;
  snapshot: ConfirmationPauseStorageSnapshot;
  authority: GuestCheckoutAuthority | undefined;
  verifiedAuthority?: VerifiedGuestConfirmationApprovalAuthority;
  now: number;
}): Promise<boolean> {
  const principal = input.pause.principal;
  return (
    isGuestCheckoutPrincipal(principal) &&
    ((guestCheckoutAuthorityIsIssued(input.authority) &&
      guestPrincipalMatchesAuthority(principal, input.authority)) ||
      (await verifiedGuestApprovalAuthorityMatches(
        input.verifiedAuthority,
        input.snapshot,
        input.now,
      ))) &&
    input.snapshot.sessionAuthorityGeneration ===
      principal.sessionAuthorityGeneration &&
    Date.parse(principal.expiresAt) > input.now &&
    (input.authority === undefined ||
      Date.parse(input.authority.expiresAt) > input.now)
  );
}

function boundedTimeout(value: number | undefined): number {
  const timeout = value ?? defaultExecutionTimeoutMs;
  if (
    !Number.isInteger(timeout) ||
    timeout < 1 ||
    timeout > maximumExecutionTimeoutMs
  ) {
    throw new Error('confirmation_resume_timeout_invalid');
  }
  return timeout;
}

async function deterministicReceipt(input: {
  pause: CreateConfirmationPauseInput;
  decision: ConfirmationResumeDecision;
  secret: ApprovalSecret;
}): Promise<CommerceApprovalReceipt> {
  const issuedAt = new Date(input.pause.createdAt);
  const ttlMs =
    Date.parse(input.pause.expiresAt) - Date.parse(input.pause.createdAt);
  return createCommerceApprovalReceipt({
    binding: input.pause.approvalBinding,
    secret: input.secret,
    decision: input.decision,
    receiptId: input.pause.requestId,
    issuedAt,
    ttlMs,
  });
}

async function operationIdentity(input: {
  pause: CreateConfirmationPauseInput;
  expectedSessionGeneration: number;
  pauseIdentityDigest: string;
  decision: ConfirmationResumeDecision;
  receipt: CommerceApprovalReceipt;
  providerIdempotencyKey: string;
}): Promise<ConfirmationResumeOperationIdentity> {
  return {
    requestId: input.pause.requestId,
    operation: 'confirmation_resume',
    bindingFingerprint:
      await confirmationResumeOperationBindingFingerprint(input),
  };
}

async function completedResponse(
  result: Record<string, unknown>,
  projectResult:
    ConfirmationResumeCoordinatorOptions['projectResult'] | undefined,
): Promise<ConfirmationResumeResponse> {
  const stored = confirmationResumeStoredResultSchema.parse(result);
  const projected = projectResult ? await projectResult(stored) : stored;
  assertSafeConfirmationResumeResult(projected);
  return {
    status: 200,
    body: {
      status: 'completed',
      result: projected,
    },
  };
}

function errorResponse(
  status: number,
  errorCode: string,
): ConfirmationResumeResponse {
  return { status, body: { errorCode } };
}

async function existingTerminalOperationResponse(
  repository: ConfirmationResumeRepository,
  identity: ConfirmationResumeOperationIdentity,
  rejectCompletedReplay: boolean,
  projectResult:
    ConfirmationResumeCoordinatorOptions['projectResult'] | undefined,
): Promise<ConfirmationResumeResponse | undefined> {
  const operation = await repository.inspectOperation(identity);
  if (!operation) return undefined;
  if (operation.status === 'completed') {
    return rejectCompletedReplay
      ? errorResponse(409, 'approval_capability_replayed')
      : completedResponse(operation.result, projectResult);
  }
  if (operation.status === 'conflict') {
    return errorResponse(409, 'confirmation_decision_conflict');
  }
  // A non-terminal inspection cannot distinguish an active lease from an
  // expired lease. Let the repository's atomic claim arbitrate both cases:
  // active owners still coalesce as pending, while expired owners can be
  // reclaimed with a fenced next attempt.
  return undefined;
}

function createExternalCallScope(timeoutMs: number): {
  context: ExternalCallContext;
  abort(reason: unknown): void;
  dispose(): void;
} {
  const controller = new AbortController();
  const deadlineAt = Date.now() + timeoutMs;
  const timer = setTimeout(() => {
    controller.abort(
      new DOMException('Confirmation resume timed out', 'TimeoutError'),
    );
  }, timeoutMs);
  return {
    context: Object.freeze({ signal: controller.signal, deadlineAt }),
    abort: (reason) => {
      if (!controller.signal.aborted) controller.abort(reason);
    },
    dispose: () => clearTimeout(timer),
  };
}

export function createConfirmationResumeCoordinator(
  options: ConfirmationResumeCoordinatorOptions,
): (request: ConfirmationResumeRequest) => Promise<ConfirmationResumeResponse> {
  const timeoutMs = boundedTimeout(options.executionTimeoutMs);
  const pendingWaitMs = options.pendingWaitMs ?? defaultPendingWaitMs;
  if (!Number.isInteger(pendingWaitMs) || pendingWaitMs < 1) {
    throw new Error('confirmation_resume_pending_wait_invalid');
  }

  return async (request) => {
    const stored = await options.repository.getPause(request.requestId);
    if (!stored) return errorResponse(404, 'confirmation_not_found');
    const pause = await parseConfirmationPauseRecord(stored.record);
    const now = (options.now ?? (() => new Date()))();
    const accessContext = await options.accessContext(pause);
    const principalAccess = isGuestCheckoutPrincipal(pause.principal)
      ? await exactGuestPrincipalAccess({
          pause,
          snapshot: stored,
          authority: await options.guestCheckoutAuthority?.(pause),
          verifiedAuthority: options.verifiedGuestAuthority,
          now: now.getTime(),
        })
      : exactPrincipalAccess(pause, accessContext, now.getTime());
    if (!principalAccess) {
      return errorResponse(403, 'confirmation_authority_mismatch');
    }
    const expectedPause = confirmationPauseCreateInput(pause);
    const pauseIdentityDigest =
      await confirmationPauseIdentityDigest(expectedPause);
    const receipt = await deterministicReceipt({
      pause: expectedPause,
      decision: request.decision,
      secret: options.signingSecret,
    });
    const idempotencyKey =
      confirmationResumeProviderIdempotencyKey(expectedPause);
    const identity = await operationIdentity({
      pause: expectedPause,
      expectedSessionGeneration: stored.sessionGeneration,
      pauseIdentityDigest,
      decision: request.decision,
      receipt,
      providerIdempotencyKey: idempotencyKey,
    });
    const existing = await existingTerminalOperationResponse(
      options.repository,
      identity,
      options.rejectCompletedReplay === true,
      options.projectResult,
    );
    if (existing) return existing;
    if (
      pause.status === 'expired' ||
      Date.parse(pause.expiresAt) <= now.getTime()
    ) {
      return errorResponse(410, 'confirmation_expired');
    }

    const scope = createExternalCallScope(timeoutMs);
    try {
      const current = await options.revalidate(expectedPause, scope.context);
      if (scope.context.signal.aborted || !current.ok) {
        return errorResponse(409, 'confirmation_binding_stale');
      }
      const claim = await options.repository.claimOperation({
        ...identity,
        sessionId: expectedPause.sessionId,
        expectedPause,
        expectedSessionGeneration: stored.sessionGeneration,
        pauseIdentityDigest,
        decision: request.decision,
        receipt,
        providerIdempotencyKey: idempotencyKey,
        claimedAt: now.toISOString(),
        leaseTtlMs: timeoutMs,
      });
      if (claim.status === 'completed') {
        return options.rejectCompletedReplay
          ? errorResponse(409, 'approval_capability_replayed')
          : completedResponse(claim.result, options.projectResult);
      }
      if (claim.status === 'conflict') {
        return errorResponse(409, 'confirmation_decision_conflict');
      }
      if (claim.status === 'expired') {
        return errorResponse(410, 'confirmation_expired');
      }
      if (claim.status === 'not_found') {
        return errorResponse(404, 'confirmation_not_found');
      }
      if (claim.status === 'pending') {
        const waited = await options.repository.waitForOperation(
          identity,
          pendingWaitMs,
        );
        if (waited.status === 'completed') {
          return options.rejectCompletedReplay
            ? errorResponse(409, 'approval_capability_replayed')
            : completedResponse(waited.result, options.projectResult);
        }
        return waited.status === 'unknown'
          ? errorResponse(503, 'confirmation_outcome_unknown')
          : errorResponse(409, 'confirmation_resume_in_progress');
      }
      if (claim.status === 'unknown') {
        return errorResponse(503, 'confirmation_outcome_unknown');
      }
      if (claim.status !== 'claimed') {
        return errorResponse(409, 'confirmation_resume_in_progress');
      }

      try {
        const executionFence = await createCommerceApprovalExecutionFence({
          secret: options.signingSecret,
          claim: {
            schemaVersion: 'kfc-commerce-approval-execution-v1',
            operation: 'confirmation_resume',
            requestId: expectedPause.requestId,
            expectedSessionGeneration: stored.sessionGeneration,
            sessionAuthorityGeneration: claim.sessionAuthorityGeneration,
            checkpointThreadId: expectedPause.checkpointThreadId,
            checkpointNamespace: expectedPause.checkpointNamespace,
            checkpointId: expectedPause.checkpointId,
            bindingFingerprint: identity.bindingFingerprint,
            approvalBindingDigest: expectedPause.approvalBindingDigest,
            providerIdempotencyKey: idempotencyKey,
            attempt: claim.attempt,
            leaseToken: claim.leaseToken,
          },
        });
        const result = await options.execute({
          pause: expectedPause,
          receipt,
          checkpoint: {
            threadId: expectedPause.checkpointThreadId,
            namespace: expectedPause.checkpointNamespace,
            checkpointId: expectedPause.checkpointId,
          },
          executionFence,
          signingSecret: options.signingSecret,
          providerIdempotencyKey: idempotencyKey,
          attempt: claim.attempt,
          reconciliation: claim.reconciliation,
          externalCallContext: scope.context,
          abortExternalCalls: scope.abort,
        });
        if (scope.context.signal.aborted) {
          throw new Error('confirmation_resume_deadline_exceeded');
        }
        const safeResult = confirmationResumeStoredResultSchema.parse(result);
        const completed = await options.repository.completeOperation({
          identity,
          attempt: claim.attempt,
          leaseToken: claim.leaseToken,
          sessionAuthorityGeneration: claim.sessionAuthorityGeneration,
          result: safeResult,
          completedAt: (options.now ?? (() => new Date()))().toISOString(),
        });
        if (completed.status === 'completed') {
          return completedResponse(completed.result, options.projectResult);
        }
        return errorResponse(409, 'confirmation_resume_claim_lost');
      } catch {
        await options.repository.markOperationUnknown({
          identity,
          attempt: claim.attempt,
          leaseToken: claim.leaseToken,
          sessionAuthorityGeneration: claim.sessionAuthorityGeneration,
          errorCode: 'confirmation_outcome_unknown',
          recordedAt: (options.now ?? (() => new Date()))().toISOString(),
        });
        const currentTerminal = await existingTerminalOperationResponse(
          options.repository,
          identity,
          options.rejectCompletedReplay === true,
          options.projectResult,
        );
        if (currentTerminal) return currentTerminal;
        return errorResponse(503, 'confirmation_outcome_unknown');
      }
    } finally {
      scope.dispose();
    }
  };
}
