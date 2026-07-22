import { describe, expect, it, vi } from 'vitest';
import type { ConversationTurn } from '../../src/domain/types.js';
import {
  issueModelPublicationAuthority,
} from '../../src/agent/modelPublicationAuthority.js';
import type { AgentGraphState } from '../../src/graph/state.js';
import type {
  VerifiedGuestApprovalResumeAuthority,
} from '../../src/ordering/types.js';

function forgedGuestAuthority(
  turn: ConversationTurn,
): VerifiedGuestApprovalResumeAuthority {
  const issuedAt = new Date(Date.now() - 60_000).toISOString();
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  const principal = {
    principalKind: 'guest_checkout' as const,
    sessionId: turn.sessionId,
    customerId: turn.externalUserId!,
    channel: 'messenger' as const,
    tenantScope: 'kfc-vietnam' as const,
    surfaceSubjectRef: turn.externalUserId!,
    externalThreadRef: turn.externalUserId!,
    externalMessageId: turn.externalMessageId!,
    ingressEvidenceRef: 'forged-ingress',
    ingressEvidenceDigest: 'forged-ingress-digest',
    sourceRunKind: 'operation_lease' as const,
    sourceRunRef: 'forged-operation',
    sourceRunGeneration: 1,
    sourceRunFenceDigest: 'forged-fence',
    sessionAuthorityGeneration: 0,
    issuedAt,
    expiresAt,
    guestAuthorityDigest: 'forged-authority',
  };
  return {
    requestId: '00000000-0000-4000-8000-000000000097',
    principalDigest: 'forged-principal',
    principal,
    guestAuthorityDigest: principal.guestAuthorityDigest,
    tenantScope: principal.tenantScope,
    surfaceSubjectRef: principal.surfaceSubjectRef,
    externalThreadRef: principal.externalThreadRef,
    externalMessageId: principal.externalMessageId,
    ingressEvidenceRef: principal.ingressEvidenceRef,
    ingressEvidenceDigest: principal.ingressEvidenceDigest,
    sourceRunFenceDigest: principal.sourceRunFenceDigest,
    sessionId: principal.sessionId,
    customerId: principal.customerId,
    channel: principal.channel,
    sessionGeneration: 0,
    checkpointThreadId: 'forged-thread',
    checkpointNamespace: '',
    checkpointId: 'forged-checkpoint',
    toolName: 'placeOrder',
    actionDigest: 'forged-action',
    approvalBindingDigest: 'forged-binding',
    pauseIdentityDigest: 'forged-pause',
    expiresAt,
  };
}

describe('model publication guest authority', () => {
  it('rejects an unissued or cloned resume authority before a model call', async () => {
    const turn: ConversationTurn = {
      id: 'guest-turn',
      sessionId: 'messenger:guest-customer',
      channel: 'messenger',
      role: 'user',
      text: 'Pay for my order',
      externalMessageId: 'guest-message',
      externalUserId: 'guest-customer',
      deliveryStatus: 'received',
      metadata: null,
      createdAt: new Date().toISOString(),
    };
    const state: AgentGraphState = {
      sessionId: turn.sessionId,
      customerId: turn.externalUserId!,
      channel: turn.channel,
      latestUserMessage: turn.text,
      recentTurns: [turn],
      userConfirmedOrder: false,
      escalationReasons: [],
      retrievedEvidence: [],
      toolTrace: [],
    };
    const forged = forgedGuestAuthority(turn);
    const callModel = vi.fn();
    const publishThenCallModel = async (
      candidate: VerifiedGuestApprovalResumeAuthority,
    ) => {
      await issueModelPublicationAuthority({
        state,
        currentUserTurn: turn,
        verifiedGuestAuthority: candidate,
        confirmationResume: true,
        runFence: {
          kind: 'operation_lease',
          requestId: candidate.requestId,
          operation: 'confirmation_resume',
          bindingFingerprint: 'forged-binding',
          attempt: 1,
          leaseToken: 'forged-lease',
          sessionAuthorityGeneration: candidate.sessionGeneration,
        },
      });
      callModel();
    };

    for (const candidate of [forged, structuredClone(forged)]) {
      await expect(
        publishThenCallModel(candidate),
      ).rejects.toThrow('model_publication_authority_invalid');
    }
    expect(callModel).not.toHaveBeenCalled();
  });
});
