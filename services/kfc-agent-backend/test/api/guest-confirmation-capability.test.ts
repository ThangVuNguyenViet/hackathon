import { describe, expect, it, vi } from 'vitest';
import {
  createConfirmationApprovalKeyRing,
  issueConfirmationApprovalCapability,
  verifyConfirmationApprovalCapability,
} from '../../src/api/confirmationApprovalCapability.js';
import {
  confirmationPauseForPublicResponse,
  persistCanonicalConfirmationPause,
} from '../../src/api/confirmationPausePersistence.js';
import type {
  AgentTurnOutput,
} from '../../src/graph/agentTurnState.js';
import {
  buildCommerceApprovalBinding,
  digestCommerceAction,
} from '../../src/ordering/approvalReceipt.js';
import {
  guestCheckoutCommerceApprovalPrincipal,
} from '../../src/ordering/commerceApprovalPrincipal.js';
import type {
  RunCommitFence,
} from '../../src/persistence/contracts.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import {
  issueControlledMessengerMockGuestCheckoutAuthority,
} from '../../src/security/guestCheckoutAuthority.js';

const fixedNow = new Date('2026-07-20T00:01:00.000Z');
const keyRing = createConfirmationApprovalKeyRing({
  active: {
    keyId: 'guest-production-boundary',
    secret: 'guest-production-boundary-secret-32-bytes',
  },
});

describe('guest confirmation public capability boundary', () => {
  it.each([
    ['placeOrder', {}],
    ['createPaymentLink', { methodId: 'payment-method-1' }],
  ] as const)(
    'projects and verifies a guest %s approval without account access',
    async (toolName, arguments_) => {
      const { authority, record } = await guestPause(
        toolName,
        arguments_,
      );
      const store = new MemoryStore();
      await store.createConfirmationPause(record);
      const projected = await confirmationPauseForPublicResponse({
        pause: {
          capability: toolName,
          requestId: record.requestId,
          expiresAt: record.expiresAt,
        },
        store,
        accessContext: undefined,
        guestCheckoutAuthority: authority,
        keyRing,
        now: fixedNow,
      });
      const snapshot =
        await store.getConfirmationPauseStorageSnapshot(
          record.requestId,
        );
      if (!snapshot) throw new Error('test_guest_pause_missing');

      await expect(verifyConfirmationApprovalCapability({
        approvalCapability: projected.approvalCapability,
        snapshot,
        keyRing,
        now: fixedNow,
      })).resolves.toMatchObject({
        ok: true,
        payload: {
          principalKind: 'guest_checkout',
          toolName,
          actionDigest: record.actionDigest,
          checkpointThreadId: record.checkpointThreadId,
          checkpointId: record.checkpointId,
        },
        guestAuthority: {
          sessionId: record.sessionId,
          sessionGeneration: 0,
        },
      });
      expect(JSON.stringify(projected)).not.toContain(
        authority.externalMessageId,
      );
      expect(JSON.stringify(projected)).not.toContain(
        authority.ingressEvidenceRef,
      );
    },
  );

  it('fails closed before public projection when guest authority is absent', async () => {
    const { record } = await guestPause('placeOrder', {});
    const store = new MemoryStore();
    await store.createConfirmationPause(record);

    await expect(confirmationPauseForPublicResponse({
      pause: {
        capability: 'placeOrder',
        requestId: record.requestId,
        expiresAt: record.expiresAt,
      },
      store,
      accessContext: undefined,
      keyRing,
      now: fixedNow,
    })).rejects.toThrow(
      'confirmation_approval_capability_authority_invalid',
    );
  });

  it('atomically fences a continuation pause by the source capability expiry', async () => {
    const { authority, record } =
      await guestPause('placeOrder', {});
    const store = new MemoryStore();
    await store.createConfirmationPause(record);
    const snapshot =
      await store.getConfirmationPauseStorageSnapshot(
        record.requestId,
      );
    if (!snapshot) throw new Error('test_guest_pause_missing');
    const source = await issueConfirmationApprovalCapability({
      snapshot,
      accessContext: undefined,
      guestCheckoutAuthority: authority,
      keyRing,
      now: fixedNow,
      ttlMs: 30_000,
    });
    const verified = await verifyConfirmationApprovalCapability({
      approvalCapability: source.approvalCapability,
      snapshot,
      keyRing,
      now: fixedNow,
    });
    if (!verified.ok || !verified.guestAuthority) {
      throw new Error('test_guest_capability_verification_failed');
    }
    const continuation =
      await paymentContinuation(record);
    const commit = vi.spyOn(
      store,
      'commitConfirmationPauseIfRunCurrent',
    ).mockResolvedValue({
      status: 'created',
      stateEvent: {
        id: 'state-event',
        sessionId: record.sessionId,
        sourceType: 'graph:verified_state',
        payload: {},
        createdAt: fixedNow.toISOString(),
      },
      pauseEvent: {
        id: 'pause-event',
        sessionId: record.sessionId,
        sourceType: 'confirmation_pause_created',
        payload: {},
        createdAt: fixedNow.toISOString(),
      },
      record: pendingRecord(continuation),
    });

    await persistCanonicalConfirmationPause({
      store,
      sessionId: continuation.sessionId,
      customerId: continuation.customerId,
      channel: continuation.channel,
      pause: pauseWithRecord(continuation),
      accessContext: undefined,
      verifiedGuestAuthority: verified.guestAuthority,
      checkpointer: {
        async getTuple(config) {
          return {
            config,
            checkpoint: { id: continuation.checkpointId },
          };
        },
      },
      runCommit: {
        fence: {
          kind: 'operation_lease',
          requestId: continuation.requestId,
          operation: 'confirmation_resume',
          bindingFingerprint: 'a'.repeat(64),
          attempt: 1,
          leaseToken:
            '10764563-9204-46fc-ab19-06eb94533b69',
          sessionAuthorityGeneration: 0,
        },
        state: {
          sessionId: continuation.sessionId,
          customerId: continuation.customerId,
          channel: continuation.channel,
          latestUserMessage: 'continue',
          userConfirmedOrder: false,
          escalationReasons: [],
          retrievedEvidence: [],
          toolTrace: [],
        },
      },
      now: fixedNow,
    });

    expect(commit).toHaveBeenCalledWith(
      expect.objectContaining({
        notAfter: source.expiresAt,
      }),
    );
  });
});

async function guestPause(
  toolName: 'placeOrder' | 'createPaymentLink',
  arguments_: Record<string, unknown>,
) {
  const runFence: RunCommitFence = {
    kind: 'agent_run',
    runId: `guest-production-${toolName}`,
    generation: 1,
    sessionAuthorityGeneration: 0,
    executionAttempt: 1,
    executionLeaseToken:
      '06ed78cb-e308-48dd-8f0a-11840a11a308',
  };
  const authority =
    await issueControlledMessengerMockGuestCheckoutAuthority({
      sessionId: 'messenger_mock:guest-production',
      customerId: 'guest-production',
      externalMessageId: `guest-turn-${toolName}`,
      runFence,
      issuedAt: new Date('2026-07-20T00:00:00.000Z'),
      ttlMs: 10 * 60_000,
    });
  const principal =
    guestCheckoutCommerceApprovalPrincipal(authority);
  const action = { toolName, arguments: arguments_ };
  const approvalBinding = await buildCommerceApprovalBinding({
    capability: toolName,
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
  const record = {
    schemaVersion: 'kfc-confirmation-pause-v1',
    requestId: crypto.randomUUID(),
    checkpointThreadId:
      'agent:["messenger_mock:guest-production","run:guest:production"]',
    checkpointNamespace: '',
    checkpointId: `checkpoint-${toolName}`,
    sessionId: principal.sessionId,
    customerId: principal.customerId,
    channel: principal.channel,
    action,
    actionDigest: await digestCommerceAction(action),
    approvalBinding,
    approvalBindingDigest:
      await digestCommerceAction(approvalBinding),
    principal,
    createdAt: '2026-07-20T00:00:00.000Z',
    expiresAt: '2026-07-20T00:10:00.000Z',
  } as const;
  return { authority, record };
}

async function paymentContinuation(
  source: Awaited<ReturnType<typeof guestPause>>['record'],
) {
  const action = {
    toolName: 'createPaymentLink' as const,
    arguments: { methodId: 'payment-method-1' },
  };
  const approvalBinding = await buildCommerceApprovalBinding({
    capability: action.toolName,
    principal: source.principal,
    action,
    revisions: source.approvalBinding.revisions,
    guestCheckout: source.approvalBinding.guestCheckout,
  });
  return {
    ...source,
    requestId: crypto.randomUUID(),
    checkpointId: 'checkpoint-createPaymentLink-continuation',
    action,
    actionDigest: await digestCommerceAction(action),
    approvalBinding,
    approvalBindingDigest:
      await digestCommerceAction(approvalBinding),
  };
}

function pauseWithRecord(
  record: Awaited<ReturnType<typeof paymentContinuation>>,
): NonNullable<AgentTurnOutput['pause']> {
  const pause = {
    capability: record.action.toolName,
    requestId: record.requestId,
    action: record.action,
  } as NonNullable<AgentTurnOutput['pause']>;
  Object.defineProperty(pause, 'confirmationRecord', {
    value: record,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return pause;
}

function pendingRecord(
  input: Awaited<ReturnType<typeof paymentContinuation>>,
) {
  return {
    ...input,
    status: 'pending' as const,
    rejectionReceipt: null,
    rejectedAt: null,
    completionStatus: 'pending' as const,
    result: null,
    completionError: null,
    completedAt: null,
  };
}
