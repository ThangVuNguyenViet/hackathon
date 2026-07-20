import type { CustomerAccessContext } from '../domain/types.js';
import type { AgentGraphState } from '../graph/state.js';
import type { RunCommitFence } from '../persistence/contracts.js';
import { authorizeCustomerAccess } from '../security/customerAccessContext.js';
import {
  authorizeGuestCheckout,
  type GuestCheckoutAuthority,
} from '../security/guestCheckoutAuthority.js';
import { digestCommerceAction } from './approvalReceipt.js';
import {
  guestPrincipalMatchesAuthority,
  isGuestCheckoutPrincipal,
} from './commerceApprovalPrincipal.js';
import { agentFailure } from './agentToolAuthority.js';
import {
  approvalCapabilityScopes,
  approvalCapabilitySupportsGuestCheckout,
} from './toolBoundaries.js';
import type {
  AgentToolCallFailure,
  CommerceApprovalCapability,
  CommerceApprovalPrincipal,
  ToolCallRequest,
  VerifiedGuestApprovalResumeAuthority,
} from './types.js';

export async function authorizeCommerceApprovalPrincipal(input: {
  request: ToolCallRequest;
  capability: CommerceApprovalCapability;
  principal: CommerceApprovalPrincipal;
  accessContext?: CustomerAccessContext;
  guestCheckoutAuthority?: GuestCheckoutAuthority;
  runFence?: RunCommitFence;
  externalMessageId?: string | null;
  confirmationResume?: boolean;
  confirmationRequestId?: string;
  verifiedGuestAuthority?: VerifiedGuestApprovalResumeAuthority;
  sessionId: string;
  customerId: string;
  channel: AgentGraphState['channel'];
}): Promise<AgentToolCallFailure | undefined> {
  const {
    request,
    capability,
    principal,
    sessionId,
    customerId,
    channel,
  } = input;
  if (
    principal.sessionId !== sessionId ||
    principal.customerId !== customerId ||
    principal.channel !== channel
  ) {
    return agentFailure(
      request,
      'Approval principal does not match the current turn',
      'approval_principal_mismatch',
    );
  }
  if (isGuestCheckoutPrincipal(principal)) {
    if (!approvalCapabilitySupportsGuestCheckout(capability)) {
      return agentFailure(
        request,
        'Guest checkout does not authorize account-scoped actions',
        'authorization_required',
      );
    }
    const verifiedResume = input.verifiedGuestAuthority;
    const verifiedResumeMatches =
      input.confirmationResume === true &&
      verifiedResume !== undefined &&
      verifiedResume.requestId === input.confirmationRequestId &&
      verifiedResume.sessionId === sessionId &&
      verifiedResume.customerId === customerId &&
      verifiedResume.channel === channel &&
      verifiedResume.sessionGeneration ===
        principal.sessionAuthorityGeneration &&
      verifiedResume.toolName === capability &&
      verifiedResume.actionDigest ===
        await digestCommerceAction(request) &&
      verifiedResume.principalDigest ===
        await digestCommerceAction(principal) &&
      Date.parse(verifiedResume.expiresAt) > Date.now();
    const guestDecision = authorizeGuestCheckout(
      input.guestCheckoutAuthority,
      {
        channel,
        sessionId,
        customerId,
        externalMessageId: input.externalMessageId,
        surfaceSubjectRef: principal.surfaceSubjectRef,
        runFence: input.runFence,
        confirmationResume: input.confirmationResume,
      },
    );
    if (
      !verifiedResumeMatches &&
      (
        !guestDecision.allowed ||
        !input.guestCheckoutAuthority ||
        !guestPrincipalMatchesAuthority(
          principal,
          input.guestCheckoutAuthority,
        )
      )
    ) {
      return agentFailure(
        request,
        'Guest checkout authority does not match the current turn',
        guestDecision.allowed
          ? 'approval_principal_mismatch'
          : guestDecision.errorCode,
      );
    }
    return undefined;
  }

  const access = authorizeCustomerAccess(input.accessContext, {
    channel,
    sessionId,
    customerId,
    scope: approvalCapabilityScopes[capability],
  });
  if (!access.allowed) {
    return agentFailure(request, access.message, access.errorCode);
  }
  const evidence = input.accessContext?.authenticationEvidence;
  if (
    input.accessContext?.authenticationState !== 'authenticated' ||
    evidence?.state !== 'verified' ||
    input.accessContext.kfcSubjectRef !== principal.authenticatedSubject ||
    evidence.evidenceRef !== principal.authenticationEvidenceRef
  ) {
    return agentFailure(
      request,
      'Authenticated approval evidence does not match the principal',
      'approval_principal_mismatch',
    );
  }
  return undefined;
}

export async function commerceApprovalPrincipalBindingExtension(input: {
  principal: CommerceApprovalPrincipal;
  state: AgentGraphState | undefined;
}): Promise<
  | Record<string, never>
  | {
      guestCheckout: {
        guestAuthorityDigest: string;
        orderPreviewRevision: string;
        invoiceRevision: string;
      };
    }
> {
  if (!isGuestCheckoutPrincipal(input.principal)) return {};
  return {
    guestCheckout: {
      guestAuthorityDigest: input.principal.guestAuthorityDigest,
      orderPreviewRevision:
        await digestCommerceAction(input.state?.orderPreview ?? null),
      invoiceRevision:
        await digestCommerceAction(input.state?.invoiceRequest ?? null),
    },
  };
}
