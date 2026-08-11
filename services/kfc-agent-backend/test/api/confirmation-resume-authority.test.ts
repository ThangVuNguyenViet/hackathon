import { describe, expect, it, vi } from 'vitest';
import {
  createConfirmationApprovalKeyRing,
  issueConfirmationApprovalCapability,
  verifyConfirmationApprovalCapability,
} from '../../src/api/confirmationApprovalCapability.js';
import {
  createConfirmationResumeCoordinator,
  type ConfirmationResumeClaimInput,
  type ConfirmationResumeClaimResult,
  type ConfirmationResumeCompletionResult,
  type ConfirmationResumeOperationIdentity,
  type ConfirmationResumeOperationState,
  type ConfirmationResumeRepository,
} from '../../src/api/confirmationResumeAuthority.js';
import {
  createConversationStoreConfirmationResumeRepository,
} from '../../src/api/confirmationResumeRepository.js';
import type { CustomerAccessContext } from '../../src/domain/types.js';
import {
  buildCommerceApprovalBinding,
  digestCommerceAction,
  verifyCommerceApprovalReceipt,
} from '../../src/ordering/approvalReceipt.js';
import {
  verifyCommerceApprovalExecutionFence,
} from '../../src/ordering/approvalExecutionFence.js';
import {
  guestCheckoutCommerceApprovalPrincipal,
} from '../../src/ordering/commerceApprovalPrincipal.js';
import type { CommerceApprovalPrincipal } from '../../src/ordering/types.js';
import {
  confirmationPauseCreateInput,
  confirmationPauseIdentityDigest,
  immutableConfirmationPauseMatches,
  pendingConfirmationPause,
} from '../../src/persistence/confirmationPause.js';
import type {
  ConfirmationPauseRecord,
  CreateConfirmationPauseInput,
  RunCommitFence,
} from '../../src/persistence/contracts.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import {
  issueControlledMessengerMockGuestCheckoutAuthority,
} from '../../src/security/guestCheckoutAuthority.js';

const signingSecret = 'confirmation-test-secret-32-bytes!!';
const fixedNow = new Date('2026-07-20T00:01:00.000Z');

function completedResult(
  pause: Pick<ConfirmationPauseRecord, 'requestId'>,
  responseText: string,
  extra: { orderId?: string | null } = {},
) {
  return {
    actionOutcome: 'succeeded' as const,
    continuation: 'turn_completed' as const,
    requestId: pause.requestId,
    responseText,
    ...extra,
  };
}

describe('durable confirmation resume authority', () => {
  it('binds an authenticated approval to the exact pause and action identity', async () => {
    const pause = await canonicalPause();
    const repository = new FakeConfirmationResumeRepository(pause);
    const execute = vi.fn(async (input) =>
      completedResult(input.pause, 'Order placed.')
    );
    const coordinator = createConfirmationResumeCoordinator({
      repository,
      signingSecret,
      accessContext: async () => trustedAccessContext(),
      revalidate: async () => ({ ok: true }),
      execute,
      now: () => fixedNow,
    });

    const response = await coordinator({
      requestId: pause.requestId,
      decision: 'approve',
    });

    expect(response).toEqual({
      status: 200,
      body: {
        status: 'completed',
        result: completedResult(pause, 'Order placed.'),
      },
    });
    expect(execute).toHaveBeenCalledTimes(1);
    const execution = execute.mock.calls[0]![0];
    expect(execution.pause).toMatchObject({
      sourceTurnId: pause.sourceTurnId,
      actionScope: pause.actionScope,
      actionId: pause.actionId,
      actionDigest: pause.actionDigest,
      approvalBindingDigest: pause.approvalBindingDigest,
    });
    expect(execution.actionIdentity).toEqual({
      sourceTurnId: pause.sourceTurnId,
      scope: pause.actionScope,
      actionId: pause.actionId,
    });
    expect(execution.signingSecret).toBe(signingSecret);
    expect(execution.executionFence).toMatchObject({
      schemaVersion: 'kfc-commerce-approval-execution-v1',
      operation: 'confirmation_resume',
      requestId: pause.requestId,
      expectedSessionGeneration: 0,
      sessionAuthorityGeneration: 0,
      sourceTurnId: pause.sourceTurnId,
      actionScope: pause.actionScope,
      actionId: pause.actionId,
      bindingFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u),
      approvalBindingDigest: pause.approvalBindingDigest,
      providerIdempotencyKey: execution.providerIdempotencyKey,
      attempt: 1,
      leaseToken: expect.any(String),
    });
    expect(Object.isFrozen(execution.externalCallContext)).toBe(true);
    expect(execution.providerIdempotencyKey).toContain(pause.requestId);
    expect(execution.providerIdempotencyKey).toContain(pause.actionDigest);
    expect(await verifyCommerceApprovalReceipt({
      receipt: execution.receipt,
      expectedBinding: pause.approvalBinding,
      secret: signingSecret,
      now: fixedNow,
    })).toMatchObject({
      ok: true,
      receipt: {
        receiptId: pause.requestId,
        decision: 'approve',
      },
    });
    expect(await verifyCommerceApprovalExecutionFence({
      fence: execution.executionFence,
      receipt: execution.receipt,
      binding: pause.approvalBinding,
      secret: signingSecret,
    })).toEqual(execution.executionFence);
  });

  it('stores only a next-approval pointer before transient projection', async () => {
    const pause = await canonicalPause();
    const repository = new FakeConfirmationResumeRepository(pause);
    const approvalPause = {
      capability: 'placeOrder' as const,
      requestId: pause.requestId,
      expiresAt: pause.expiresAt,
    };
    const coordinator = createConfirmationResumeCoordinator({
      repository,
      signingSecret,
      accessContext: async () => trustedAccessContext(),
      revalidate: async () => ({ ok: true }),
      execute: async () => ({
        actionOutcome: 'succeeded',
        continuation: 'approval_required',
        requestId: pause.requestId,
        responseText: 'Another approval is required.',
        approvalPause,
      }),
      projectResult: async (result) => {
        if (result.continuation !== 'approval_required') {
          return result;
        }
        return {
          actionOutcome: result.actionOutcome,
          continuation: result.continuation,
          requestId: result.requestId,
          responseText: result.responseText,
          capability: result.approvalPause.capability,
          approvalCapability: 'transient-signed-capability',
          expiresAt: result.approvalPause.expiresAt,
        };
      },
      now: () => fixedNow,
    });

    const response = await coordinator({
      requestId: pause.requestId,
      decision: 'approve',
    });

    expect(response).toEqual({
      status: 200,
      body: {
        status: 'completed',
        result: {
          actionOutcome: 'succeeded',
          continuation: 'approval_required',
          requestId: pause.requestId,
          responseText: 'Another approval is required.',
          capability: 'placeOrder',
          approvalCapability: 'transient-signed-capability',
          expiresAt: pause.expiresAt,
        },
      },
    });
    const durable = await repository.inspectOperation(
      repository.operationIdentity!,
    );
    expect(durable).toEqual({
      status: 'completed',
      result: {
        actionOutcome: 'succeeded',
        continuation: 'approval_required',
        requestId: pause.requestId,
        responseText: 'Another approval is required.',
        approvalPause,
      },
    });
    expect(JSON.stringify(durable)).not.toContain(
      'transient-signed-capability',
    );
  });

  it('coalesces concurrent identical decisions into one execution and identical replay', async () => {
    const pause = await canonicalPause();
    const repository = new FakeConfirmationResumeRepository(pause);
    const entered = deferred<void>();
    const release = deferred<void>();
    let executions = 0;
    const coordinator = createConfirmationResumeCoordinator({
      repository,
      signingSecret,
      accessContext: async () => trustedAccessContext(),
      revalidate: async () => ({ ok: true }),
      execute: async ({ pause: executionPause }) => {
        executions += 1;
        entered.resolve();
        await release.promise;
        return completedResult(executionPause, 'Completed once.');
      },
      now: () => fixedNow,
      pendingWaitMs: 1_000,
    });

    const first = coordinator({
      requestId: pause.requestId,
      decision: 'approve',
    });
    await entered.promise;
    const duplicate = coordinator({
      requestId: pause.requestId,
      decision: 'approve',
    });
    await Promise.resolve();
    release.resolve();

    const responses = await Promise.all([first, duplicate]);
    expect(responses[0]).toEqual(responses[1]);
    expect(responses[0]).toEqual({
      status: 200,
      body: {
        status: 'completed',
        result: completedResult(pause, 'Completed once.'),
      },
    });
    expect(executions).toBe(1);
    expect(repository.claimedAttempts).toEqual([1]);
  });

  it('returns an unknown waiter outcome as retryable reconciliation state', async () => {
    const pause = await canonicalPause();
    const repository = new FakeConfirmationResumeRepository(pause);
    const entered = deferred<void>();
    const release = deferred<void>();
    const coordinator = createConfirmationResumeCoordinator({
      repository,
      signingSecret,
      accessContext: async () => trustedAccessContext(),
      revalidate: async () => ({ ok: true }),
      execute: async ({ pause: executionPause }) => {
        entered.resolve();
        await release.promise;
        return completedResult(
          executionPause,
          'Completed by the active owner.',
        );
      },
      now: () => fixedNow,
      pendingWaitMs: 1_000,
    });

    const active = coordinator({
      requestId: pause.requestId,
      decision: 'approve',
    });
    await entered.promise;
    repository.returnUnknownOnNextWait();
    await expect(coordinator({
      requestId: pause.requestId,
      decision: 'approve',
    })).resolves.toEqual({
      status: 503,
      body: { errorCode: 'confirmation_outcome_unknown' },
    });
    release.resolve();
    await expect(active).resolves.toMatchObject({ status: 200 });
  });

  it('reclaims an expired pending lease while fencing its late first attempt', async () => {
    const pause = await canonicalPause();
    const repository = new FakeConfirmationResumeRepository(pause);
    const entered = deferred<void>();
    const release = deferred<void>();
    const coordinator = createConfirmationResumeCoordinator({
      repository,
      signingSecret,
      accessContext: async () => trustedAccessContext(),
      revalidate: async () => ({ ok: true }),
      execute: async ({ attempt, reconciliation, pause: executionPause }) => {
        if (attempt === 1) {
          expect(reconciliation).toBe(false);
          entered.resolve();
          await release.promise;
        } else {
          expect(reconciliation).toBe(true);
        }
        return completedResult(
          executionPause,
          `Completed attempt ${attempt}.`,
        );
      },
      now: () => fixedNow,
      pendingWaitMs: 1_000,
    });

    const first = coordinator({
      requestId: pause.requestId,
      decision: 'approve',
    });
    await entered.promise;
    repository.expirePendingLease();

    const reclaimed = await coordinator({
      requestId: pause.requestId,
      decision: 'approve',
    });
    release.resolve();
    const late = await first;

    expect(reclaimed).toEqual({
      status: 200,
      body: {
        status: 'completed',
        result: completedResult(pause, 'Completed attempt 2.'),
      },
    });
    expect(late).toEqual(reclaimed);
    expect(repository.claimedAttempts).toEqual([1, 2]);
  });

  it('rejects a conflicting decision without a second execution', async () => {
    const pause = await canonicalPause();
    const repository = new FakeConfirmationResumeRepository(pause);
    const execute = vi.fn(async ({ pause: executionPause }) =>
      completedResult(executionPause, 'Approved.')
    );
    const coordinator = createConfirmationResumeCoordinator({
      repository,
      signingSecret,
      accessContext: async () => trustedAccessContext(),
      revalidate: async () => ({ ok: true }),
      execute,
      now: () => fixedNow,
    });

    expect((await coordinator({
      requestId: pause.requestId,
      decision: 'approve',
    })).status).toBe(200);
    expect(await coordinator({
      requestId: pause.requestId,
      decision: 'reject',
    })).toEqual({
      status: 409,
      body: { errorCode: 'confirmation_decision_conflict' },
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      'wrong principal',
      trustedAccessContext({ kfcSubjectRef: 'customer-2' }),
    ],
    [
      'wrong evidence',
      trustedAccessContext({
        authenticationEvidence: {
          ...verifiedEvidence(),
          evidenceRef: 'access-token:forged',
        },
      }),
    ],
    [
      'missing scope',
      trustedAccessContext({ authorizedScopes: [] }),
    ],
  ])('fails closed for %s before a durable claim', async (_label, access) => {
    const pause = await canonicalPause();
    const repository = new FakeConfirmationResumeRepository(pause);
    const execute = vi.fn(async () => ({ responseText: 'should not run' }));
    const coordinator = createConfirmationResumeCoordinator({
      repository,
      signingSecret,
      accessContext: async () => access,
      revalidate: async () => ({ ok: true }),
      execute,
      now: () => fixedNow,
    });

    expect(await coordinator({
      requestId: pause.requestId,
      decision: 'approve',
    })).toEqual({
      status: 403,
      body: { errorCode: 'confirmation_authority_mismatch' },
    });
    expect(repository.claimedAttempts).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });

  it('fails closed for a persisted guest pause after process-local authority is lost', async () => {
    const { pause, authority } = await canonicalGuestPause();
    for (const guestCheckoutAuthority of [
      undefined,
      async () => structuredClone(authority),
    ]) {
      const repository = new FakeConfirmationResumeRepository(pause);
      const inspectOperation = vi.spyOn(repository, 'inspectOperation');
      const claimOperation = vi.spyOn(repository, 'claimOperation');
      const revalidate = vi.fn(async () => ({ ok: true }));
      const execute = vi.fn(async () =>
        completedResult(pause, 'must not execute')
      );
      const coordinator = createConfirmationResumeCoordinator({
        repository,
        signingSecret,
        accessContext: async () => undefined,
        ...(guestCheckoutAuthority
          ? { guestCheckoutAuthority }
          : {}),
        revalidate,
        execute,
        now: () => fixedNow,
      });

      await expect(coordinator({
        requestId: pause.requestId,
        decision: 'approve',
      })).resolves.toEqual({
        status: 403,
        body: { errorCode: 'confirmation_authority_mismatch' },
      });
      expect(inspectOperation).not.toHaveBeenCalled();
      expect(claimOperation).not.toHaveBeenCalled();
      expect(revalidate).not.toHaveBeenCalled();
      expect(execute).not.toHaveBeenCalled();
    }
  });

  it.each([
    'placeOrder',
    'createPaymentLink',
  ] as const)(
    'accepts a verified public guest %s capability without authenticated access',
    async (toolName) => {
      const { pause, authority } =
        await canonicalGuestPause(toolName);
      const snapshot = {
        record: pause,
        sessionGeneration:
          pause.principal.principalKind === 'guest_checkout'
            ? pause.principal.sessionAuthorityGeneration
            : -1,
        sessionAuthorityGeneration:
          pause.principal.principalKind === 'guest_checkout'
            ? pause.principal.sessionAuthorityGeneration
            : -1,
        identityDigest:
          await confirmationPauseIdentityDigest(pause),
      };
      const keyRing = createConfirmationApprovalKeyRing({
        active: {
          keyId: 'guest-resume',
          secret: signingSecret,
        },
      });
      const issued = await issueConfirmationApprovalCapability({
        snapshot,
        accessContext: undefined,
        guestCheckoutAuthority: authority,
        keyRing,
        now: fixedNow,
      });
      const verified = await verifyConfirmationApprovalCapability({
        approvalCapability: issued.approvalCapability,
        snapshot,
        keyRing,
        now: fixedNow,
      });
      if (!verified.ok || !verified.guestAuthority) {
        throw new Error('test_guest_capability_verification_failed');
      }
      const repository =
        new FakeConfirmationResumeRepository(pause);
      const execute = vi.fn(async (input) =>
        completedResult(input.pause, `${toolName} completed`)
      );
      const coordinator = createConfirmationResumeCoordinator({
        repository,
        signingSecret: verified.signingSecret,
        verifiedGuestAuthority: verified.guestAuthority,
        accessContext: async () => undefined,
        revalidate: async () => ({ ok: true }),
        execute,
        now: () => fixedNow,
      });

      await expect(coordinator({
        requestId: pause.requestId,
        decision: 'approve',
      })).resolves.toEqual({
        status: 200,
        body: {
          status: 'completed',
          result: completedResult(
            pause,
            `${toolName} completed`,
          ),
        },
      });
      expect(execute).toHaveBeenCalledTimes(1);
    },
  );

  it('fails expired and stale bindings before execution', async () => {
    const expired = await canonicalPause({
      expiresAt: '2026-07-20T00:00:30.000Z',
    });
    const expiredRepository =
      new FakeConfirmationResumeRepository(expired);
    const execute = vi.fn(async () => ({ responseText: 'should not run' }));
    const expiredCoordinator = createConfirmationResumeCoordinator({
      repository: expiredRepository,
      signingSecret,
      accessContext: async () => trustedAccessContext(),
      revalidate: async () => ({ ok: true }),
      execute,
      now: () => fixedNow,
    });
    expect(await expiredCoordinator({
      requestId: expired.requestId,
      decision: 'approve',
    })).toEqual({
      status: 410,
      body: { errorCode: 'confirmation_expired' },
    });

    const current = await canonicalPause();
    const staleRepository =
      new FakeConfirmationResumeRepository(current);
    const staleCoordinator = createConfirmationResumeCoordinator({
      repository: staleRepository,
      signingSecret,
      accessContext: async () => trustedAccessContext(),
      revalidate: async (candidate) => ({
        ok: candidate.approvalBinding.revisions.providerRevision !==
          current.approvalBinding.revisions.providerRevision,
      }),
      execute,
      now: () => fixedNow,
    });
    expect(await staleCoordinator({
      requestId: current.requestId,
      decision: 'approve',
    })).toEqual({
      status: 409,
      body: { errorCode: 'confirmation_binding_stale' },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('reconciles an unknown provider outcome with the same immutable idempotency identity', async () => {
    const pause = await canonicalPause();
    const repository = new FakeConfirmationResumeRepository(pause);
    const providerResults = new Map<string, Record<string, unknown>>();
    const seenKeys: string[] = [];
    let logicalMutations = 0;
    const coordinator = createConfirmationResumeCoordinator({
      repository,
      signingSecret,
      accessContext: async () => trustedAccessContext(),
      revalidate: async () => ({ ok: true }),
      execute: async ({
        pause: executionPause,
        providerIdempotencyKey,
        reconciliation,
      }) => {
        seenKeys.push(providerIdempotencyKey);
        const replay = providerResults.get(providerIdempotencyKey);
        if (replay) {
          expect(reconciliation).toBe(true);
          return replay;
        }
        logicalMutations += 1;
        const result = completedResult(
          executionPause,
          'Order created.',
          { orderId: 'order-1' },
        );
        providerResults.set(providerIdempotencyKey, result);
        throw new Error('transport_disconnected_after_provider_commit');
      },
      now: () => fixedNow,
    });

    expect(await coordinator({
      requestId: pause.requestId,
      decision: 'approve',
    })).toEqual({
      status: 503,
      body: { errorCode: 'confirmation_outcome_unknown' },
    });
    expect(await coordinator({
      requestId: pause.requestId,
      decision: 'approve',
    })).toEqual({
      status: 200,
      body: {
        status: 'completed',
        result: completedResult(
          pause,
          'Order created.',
          { orderId: 'order-1' },
        ),
      },
    });
    expect(logicalMutations).toBe(1);
    expect(new Set(seenKeys).size).toBe(1);
    expect(repository.claimedAttempts).toEqual([1, 2]);
  });

  it('never returns action identity or authority internals from an execution result', async () => {
    const pause = await canonicalPause();
    const repository = new FakeConfirmationResumeRepository(pause);
    const coordinator = createConfirmationResumeCoordinator({
      repository,
      signingSecret,
      accessContext: async () => trustedAccessContext(),
      revalidate: async () => ({ ok: true }),
      execute: async () => ({
        responseText: 'Unsafe result.',
        actionId: pause.actionId,
      }),
      now: () => fixedNow,
    });

    const response = await coordinator({
      requestId: pause.requestId,
      decision: 'approve',
    });
    expect(response).toEqual({
      status: 503,
      body: { errorCode: 'confirmation_outcome_unknown' },
    });
    expect(JSON.stringify(response)).not.toContain(pause.actionId);
    expect(await repository.inspectOperation(
      repository.operationIdentity!,
    )).toEqual({
      status: 'unknown',
      lastError: 'confirmation_outcome_unknown',
    });
  });

  it('rejects every server authority object outside the public result schema', async () => {
    const pause = await canonicalPause();
    const unsafeResults: Record<string, unknown>[] = [
      {},
      { responseText: 'Unsafe.', signingSecret },
      {
        ...completedResult(pause, 'Unsafe.'),
        approvalCapability: 'must-never-be-stored',
      },
      {
        actionOutcome: 'succeeded',
        continuation: 'approval_required',
        requestId: pause.requestId,
        responseText: 'Unsafe.',
      },
      {
        actionOutcome: 'succeeded',
        continuation: 'approval_required',
        requestId: pause.requestId,
        responseText: 'Unsafe.',
        approvalPause: {
          capability: 'placeOrder',
          requestId: pause.requestId,
          expiresAt: pause.expiresAt,
        },
        approvalCapability: 'must-never-be-stored',
      },
      {
        responseText: 'Unsafe.',
        providerIdempotencyKey: 'provider-secret-key',
      },
      {
        responseText: 'Unsafe.',
        executionFence: { leaseToken: 'lease-secret' },
      },
      {
        responseText: 'Unsafe.',
        receipt: { signature: 'receipt-secret' },
      },
      {
        responseText: 'Unsafe.',
        approvalBindingDigest: 'binding-secret',
      },
      {
        responseText: 'Unsafe.',
        authenticationEvidence: { evidenceRef: 'auth-secret' },
      },
    ];
    for (const unsafeResult of unsafeResults) {
      const repository = new FakeConfirmationResumeRepository(pause);
      const coordinator = createConfirmationResumeCoordinator({
        repository,
        signingSecret,
        accessContext: async () => trustedAccessContext(),
        revalidate: async () => ({ ok: true }),
        execute: async () => unsafeResult,
        now: () => fixedNow,
      });

      const response = await coordinator({
        requestId: pause.requestId,
        decision: 'approve',
      });
      expect(response).toEqual({
        status: 503,
        body: { errorCode: 'confirmation_outcome_unknown' },
      });
      expect(JSON.stringify(response)).not.toContain('secret');
    }
  });

  it('uses the real memory store lease and completion boundary', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);
    try {
      const pause = await canonicalPause();
      const store = new MemoryStore();
      await store.createConfirmationPause(
        confirmationPauseCreateInput(pause),
      );
      const repository =
        createConversationStoreConfirmationResumeRepository(store);
      const execute = vi.fn(async ({ pause: executionPause }) =>
        completedResult(executionPause, 'Durably complete.')
      );
      const coordinator = createConfirmationResumeCoordinator({
        repository,
        signingSecret,
        accessContext: async () => trustedAccessContext(),
        revalidate: async () => ({ ok: true }),
        execute,
        now: () => fixedNow,
      });

      const first = await coordinator({
        requestId: pause.requestId,
        decision: 'approve',
      });
      const replay = await coordinator({
        requestId: pause.requestId,
        decision: 'approve',
      });

      expect(first).toEqual(replay);
      expect(first).toEqual({
        status: 200,
        body: {
          status: 'completed',
          result: completedResult(pause, 'Durably complete.'),
        },
      });
      expect(execute).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cannot claim a pause that is reset during revalidation', async () => {
    const pause = await canonicalPause();
    const store = new MemoryStore();
    await store.createConfirmationPause(
      confirmationPauseCreateInput(pause),
    );
    const repository =
      createConversationStoreConfirmationResumeRepository(store);
    const execute = vi.fn(async () => ({ responseText: 'should not run' }));
    const coordinator = createConfirmationResumeCoordinator({
      repository,
      signingSecret,
      accessContext: async () => trustedAccessContext(),
      revalidate: async () => {
        await store.resetSession(pause.sessionId);
        return { ok: true };
      },
      execute,
      now: () => fixedNow,
    });

    expect(await coordinator({
      requestId: pause.requestId,
      decision: 'approve',
    })).toEqual({
      status: 404,
      body: { errorCode: 'confirmation_not_found' },
    });
    expect(execute).not.toHaveBeenCalled();
  });
});

interface StoredOperation {
  identity: ConfirmationResumeOperationIdentity;
  status: 'pending' | 'unknown' | 'completed';
  attempt: number;
  leaseToken: string;
  result?: Record<string, unknown>;
  lastError?: string;
}

class FakeConfirmationResumeRepository
implements ConfirmationResumeRepository {
  private operation?: StoredOperation;
  private pendingLeaseExpired = false;
  private nextWaitIsUnknown = false;
  private readonly waiters = new Set<
    (state: ConfirmationResumeOperationState) => void
  >();
  readonly claimedAttempts: number[] = [];

  constructor(private readonly pause: ConfirmationPauseRecord) {}

  get operationIdentity(): ConfirmationResumeOperationIdentity | undefined {
    return this.operation?.identity;
  }

  expirePendingLease(): void {
    if (this.operation?.status !== 'pending') {
      throw new Error('expected_pending_confirmation_resume_operation');
    }
    this.pendingLeaseExpired = true;
  }

  returnUnknownOnNextWait(): void {
    this.nextWaitIsUnknown = true;
  }

  async getPause(
    requestId: string,
  ): Promise<{
    record: ConfirmationPauseRecord;
    sessionGeneration: number;
    sessionAuthorityGeneration: number;
    identityDigest: string;
  } | undefined> {
    return requestId === this.pause.requestId
      ? {
          record: structuredClone(this.pause),
          sessionGeneration: 0,
          sessionAuthorityGeneration: 0,
          identityDigest:
            await confirmationPauseIdentityDigest(this.pause),
        }
      : undefined;
  }

  async inspectOperation(
    identity: ConfirmationResumeOperationIdentity,
  ): Promise<
    ConfirmationResumeOperationState | { status: 'conflict' } | undefined
  > {
    if (!this.operation) return undefined;
    if (!operationIdentityMatches(this.operation.identity, identity)) {
      return { status: 'conflict' };
    }
    return operationState(this.operation);
  }

  async claimOperation(
    input: ConfirmationResumeClaimInput,
  ): Promise<ConfirmationResumeClaimResult> {
    if (
      !immutableConfirmationPauseMatches(
        this.pause,
        input.expectedPause,
      ) ||
      await confirmationPauseIdentityDigest(input.expectedPause) !==
        input.pauseIdentityDigest ||
      input.expectedSessionGeneration !== 0
    ) {
      return { status: 'conflict' };
    }
    if (Date.parse(this.pause.expiresAt) <= Date.parse(input.claimedAt)) {
      return { status: 'expired' };
    }
    if (this.operation) {
      if (!operationIdentityMatches(this.operation.identity, input)) {
        return { status: 'conflict' };
      }
      if (this.operation.status === 'completed') {
        return {
          status: 'completed',
          result: structuredClone(this.operation.result!),
        };
      }
      if (
        this.operation.status === 'pending' &&
        !this.pendingLeaseExpired
      ) {
        return { status: 'pending' };
      }
      this.pendingLeaseExpired = false;
      this.operation.status = 'pending';
      this.operation.attempt += 1;
      this.operation.leaseToken = crypto.randomUUID();
      this.claimedAttempts.push(this.operation.attempt);
      return {
        status: 'claimed',
        attempt: this.operation.attempt,
        leaseToken: this.operation.leaseToken,
        reconciliation: true,
        sessionAuthorityGeneration: 0,
      };
    }
    this.operation = {
      identity: {
        requestId: input.requestId,
        operation: input.operation,
        bindingFingerprint: input.bindingFingerprint,
      },
      status: 'pending',
      attempt: 1,
      leaseToken: crypto.randomUUID(),
    };
    this.claimedAttempts.push(1);
    return {
      status: 'claimed',
      attempt: 1,
      leaseToken: this.operation.leaseToken,
      reconciliation: false,
      sessionAuthorityGeneration: 0,
    };
  }

  async waitForOperation(
    identity: ConfirmationResumeOperationIdentity,
    timeoutMs: number,
  ): Promise<ConfirmationResumeOperationState> {
    if (this.nextWaitIsUnknown) {
      this.nextWaitIsUnknown = false;
      return { status: 'unknown', lastError: 'owner_outcome_unknown' };
    }
    const current = await this.inspectOperation(identity);
    if (!current || current.status === 'conflict') {
      return { status: 'unknown', lastError: 'operation_missing' };
    }
    if (current.status !== 'pending') return current;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiters.delete(onResolution);
        resolve({ status: 'pending' });
      }, timeoutMs);
      const onResolution = (state: ConfirmationResumeOperationState) => {
        clearTimeout(timer);
        this.waiters.delete(onResolution);
        resolve(state);
      };
      this.waiters.add(onResolution);
    });
  }

  async completeOperation(input: {
    identity: ConfirmationResumeOperationIdentity;
    attempt: number;
    leaseToken: string;
    sessionAuthorityGeneration: number;
    result: Record<string, unknown>;
    completedAt: string;
  }): Promise<ConfirmationResumeCompletionResult> {
    void input.completedAt;
    if (!this.operation) return { status: 'lost' };
    if (!operationIdentityMatches(this.operation.identity, input.identity)) {
      return { status: 'conflict' };
    }
    if (this.operation.status === 'completed') {
      return {
        status: 'completed',
        result: structuredClone(this.operation.result!),
      };
    }
    if (
      this.operation.status !== 'pending' ||
      this.operation.attempt !== input.attempt ||
      this.operation.leaseToken !== input.leaseToken ||
      input.sessionAuthorityGeneration !== 0
    ) {
      return { status: 'lost' };
    }
    this.operation.status = 'completed';
    this.operation.result = structuredClone(input.result);
    this.resolveWaiters();
    return {
      status: 'completed',
      result: structuredClone(input.result),
    };
  }

  async markOperationUnknown(input: {
    identity: ConfirmationResumeOperationIdentity;
    attempt: number;
    leaseToken: string;
    sessionAuthorityGeneration: number;
    errorCode: string;
    recordedAt: string;
  }): Promise<void> {
    void input.recordedAt;
    if (
      this.operation &&
      operationIdentityMatches(this.operation.identity, input.identity) &&
      this.operation.status === 'pending' &&
      this.operation.attempt === input.attempt &&
      this.operation.leaseToken === input.leaseToken &&
      input.sessionAuthorityGeneration === 0
    ) {
      this.operation.status = 'unknown';
      this.operation.lastError = input.errorCode;
      this.resolveWaiters();
    }
  }

  private resolveWaiters(): void {
    if (!this.operation) return;
    const state = operationState(this.operation);
    for (const resolve of this.waiters) resolve(state);
    this.waiters.clear();
  }
}

function operationIdentityMatches(
  left: ConfirmationResumeOperationIdentity,
  right: ConfirmationResumeOperationIdentity,
): boolean {
  return (
    left.requestId === right.requestId &&
    left.operation === right.operation &&
    left.bindingFingerprint === right.bindingFingerprint
  );
}

function operationState(
  operation: StoredOperation,
): ConfirmationResumeOperationState {
  if (operation.status === 'completed') {
    return {
      status: 'completed',
      result: structuredClone(operation.result!),
    };
  }
  return operation.status === 'unknown'
    ? { status: 'unknown', lastError: operation.lastError ?? null }
    : { status: 'pending' };
}

function deferred<Value>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  const promise = new Promise<Value>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

async function canonicalPause(
  overrides: Partial<CreateConfirmationPauseInput> = {},
): Promise<ConfirmationPauseRecord> {
  const principal: CommerceApprovalPrincipal = {
    sessionId: 'kfc:customer-1',
    customerId: 'customer-1',
    channel: 'kfc',
    authenticatedSubject: 'customer-1',
    authenticationEvidenceRef: 'access-token:jti-1',
  };
  const action = { toolName: 'placeOrder' as const, arguments: {} };
  const approvalBinding = await buildCommerceApprovalBinding({
    capability: action.toolName,
    principal,
    action,
    revisions: {
      cartRevision: 'cart-r1',
      fulfillmentRevision: 'fulfillment-r1',
      paymentRevision: 'payment-r1',
      collectionRevision: 'collection-r1',
      providerRevision: 'provider-r1',
    },
  });
  const input: CreateConfirmationPauseInput = {
    schemaVersion: 'kfc-confirmation-pause-v1',
    requestId: '00000000-0000-4000-8000-000000000001',
    sourceTurnId:
      'agent:["kfc:customer-1","run:confirmation:message-1"]',
    actionScope: '',
    actionId: 'checkpoint-paused-1',
    sessionId: principal.sessionId,
    customerId: principal.customerId,
    channel: principal.channel,
    action,
    actionDigest: await digestCommerceAction(action),
    approvalBinding,
    approvalBindingDigest: await digestCommerceAction(approvalBinding),
    principal,
    createdAt: '2026-07-20T00:00:00.000Z',
    expiresAt: '2026-07-20T00:10:00.000Z',
    ...overrides,
  };
  return pendingConfirmationPause(input);
}

async function canonicalGuestPause(
  toolName: 'placeOrder' | 'createPaymentLink' = 'placeOrder',
): Promise<{
  pause: ConfirmationPauseRecord;
  authority: Awaited<
    ReturnType<typeof issueControlledMessengerMockGuestCheckoutAuthority>
  >;
}> {
  const runFence: RunCommitFence = {
    kind: 'agent_run',
    runId: 'guest-run-1',
    generation: 1,
    sessionAuthorityGeneration: 0,
    executionAttempt: 1,
    executionLeaseToken: 'c47762a3-9be0-4424-a7aa-f8bdad4270c2',
  };
  const authority =
    await issueControlledMessengerMockGuestCheckoutAuthority({
      sessionId: 'messenger_mock:guest-1',
      customerId: 'guest-1',
      externalMessageId: 'guest-message-1',
      runFence,
      issuedAt: new Date('2026-07-20T00:00:00.000Z'),
      ttlMs: 10 * 60_000,
    });
  const principal = guestCheckoutCommerceApprovalPrincipal(authority);
  const action = toolName === 'placeOrder'
    ? { toolName, arguments: {} }
    : {
        toolName,
        arguments: { methodId: 'payment-method-1' },
      };
  const approvalBinding = await buildCommerceApprovalBinding({
    capability: action.toolName,
    principal,
    action,
    revisions: {
      cartRevision: 'cart-r1',
      fulfillmentRevision: 'fulfillment-r1',
      paymentRevision: 'payment-r1',
      collectionRevision: 'collection-r1',
      providerRevision: 'provider-r1',
    },
    guestCheckout: {
      guestAuthorityDigest: authority.authorityDigest,
      orderPreviewRevision: await digestCommerceAction(null),
      invoiceRevision: await digestCommerceAction(null),
    },
  });
  const input: CreateConfirmationPauseInput = {
    schemaVersion: 'kfc-confirmation-pause-v1',
    requestId: toolName === 'placeOrder'
      ? '00000000-0000-4000-8000-000000000002'
      : '00000000-0000-4000-8000-000000000003',
    sourceTurnId:
      'agent:["messenger_mock:guest-1","run:guest:message-1"]',
    actionScope: '',
    actionId: 'checkpoint-guest-paused-1',
    sessionId: principal.sessionId,
    customerId: principal.customerId,
    channel: principal.channel,
    action,
    actionDigest: await digestCommerceAction(action),
    approvalBinding,
    approvalBindingDigest: await digestCommerceAction(approvalBinding),
    principal,
    createdAt: '2026-07-20T00:00:00.000Z',
    expiresAt: '2026-07-20T00:10:00.000Z',
  };
  return {
    pause: pendingConfirmationPause(input),
    authority,
  };
}

function verifiedEvidence(): Extract<
  CustomerAccessContext['authenticationEvidence'],
  { state: 'verified' }
> {
  return {
    state: 'verified',
    method: 'kfc-access-token',
    issuer: 'kfc-vietnam',
    audience: 'kfc-app-chat',
    authenticatedAt: '2026-07-20T00:00:00.000Z',
    expiresAt: '2026-07-21T00:00:00.000Z',
    evidenceRef: 'access-token:jti-1',
  };
}

function trustedAccessContext(
  overrides: Partial<CustomerAccessContext> = {},
): CustomerAccessContext {
  return {
    tenantScope: 'kfc-vietnam',
    customerSurface: 'kfc-app-chat',
    sessionRef: 'kfc:customer-1',
    surfaceSubjectRef: 'not-applicable',
    kfcSubjectRef: 'customer-1',
    authenticationState: 'authenticated',
    membershipState: 'member',
    channelAccountLinkState: 'not-applicable',
    subjectBindingState: 'verified',
    authenticationEvidence: verifiedEvidence(),
    authorizedScopes: ['order:write'],
    ...overrides,
  };
}
