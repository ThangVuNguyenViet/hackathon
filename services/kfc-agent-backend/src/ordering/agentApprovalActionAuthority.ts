import type { Order } from '../domain/types.js';
import type { AgentState } from '../agent/agentState.js';
import { currentMembershipApprovalEvidence } from './agentMembershipApprovalAuthority.js';
import {
  agentFailure,
  currentCollectionMatchesProvider,
} from './agentToolAuthority.js';
import {
  paymentApprovalAction,
  paymentApprovalAuthorityRemainsCurrent,
  type CapturedPaymentApprovalAuthority,
} from './paymentApprovalAuthority.js';
import { agentToolArgumentSchemas } from './toolCatalog.js';
import type {
  AgentToolCallFailure,
  CommerceApprovalCapability,
  CommerceAuthorityRevisions,
  ToolCallRequest,
} from './types.js';

export type ApprovalActionResult =
  | { success: true; action: unknown }
  | { success: false; failure: AgentToolCallFailure };

export function buildVerifiedApprovalAction(input: {
  request: ToolCallRequest;
  canonicalRequest: ToolCallRequest;
  capability: CommerceApprovalCapability;
  state: AgentState | undefined;
  sessionId: string;
  orderPreview: Order | undefined;
  contextOrder: Order | undefined;
  paymentAuthority: CapturedPaymentApprovalAuthority | undefined;
  revisions: CommerceAuthorityRevisions;
}): ApprovalActionResult {
  const {
    request,
    canonicalRequest,
    capability,
    state,
    sessionId,
    orderPreview,
    contextOrder,
    paymentAuthority,
    revisions,
  } = input;
  if (capability === 'placeOrder') {
    return orderPreview
      ? {
          success: true,
          action: { toolName: capability, orderPreview },
        }
      : {
          success: false,
          failure: agentFailure(
            request,
            'Order preview is required before approval',
            'order_preview_required',
          ),
        };
  }
  if (capability === 'createPaymentLink') {
    const methodId =
      agentToolArgumentSchemas.createPaymentLink.parse(
        canonicalRequest.arguments,
      ).methodId;
    if (
      !state ||
      !paymentAuthority ||
      !paymentApprovalAuthorityRemainsCurrent({
        state,
        contextOrder,
        captured: paymentAuthority,
        revisions,
      })
    ) {
      return {
        success: false,
        failure: agentFailure(
          request,
          'Payment method collection no longer matches current provider authority',
          'provider_authority_stale',
        ),
      };
    }
    return {
      success: true,
      action: paymentApprovalAction({
        captured: paymentAuthority,
        methodId,
      }),
    };
  }
  if (capability === 'handoff') {
    const reasons = agentToolArgumentSchemas.handoff.parse(
      canonicalRequest.arguments,
    ).reasons;
    return {
      success: true,
      action: { toolName: capability, sessionId, reasons },
    };
  }
  if (capability === 'resolveHandoff') {
    const activeHandoff = state?.handoff;
    return activeHandoff
      ? {
          success: true,
          action: {
            toolName: capability,
            sessionId,
            escalationId: activeHandoff.escalationId,
          },
        }
      : {
          success: false,
          failure: agentFailure(
            request,
            'An active verified handoff is required before resolution',
            'active_handoff_required',
          ),
        };
  }

  const targetId = capability === 'acquireVoucher'
    ? agentToolArgumentSchemas.acquireVoucher.parse(
        canonicalRequest.arguments,
      ).rewardId
    : agentToolArgumentSchemas.redeemReward.parse(
        canonicalRequest.arguments,
      ).voucherId;
  const redeemArgs = capability === 'redeemReward'
    ? agentToolArgumentSchemas.redeemReward.parse(
        canonicalRequest.arguments,
      )
    : undefined;
  const evidence = currentMembershipApprovalEvidence({
    state,
    capability,
    targetId,
    ...(redeemArgs ? { channel: redeemArgs.channel } : {}),
  });
  if (
    !evidence.ok ||
    !currentCollectionMatchesProvider(
      evidence.targetSnapshot,
      revisions,
    ) ||
    !currentCollectionMatchesProvider(
      evidence.toolSnapshot,
      revisions,
    )
  ) {
    return {
      success: false,
      failure: agentFailure(
        request,
        evidence.ok
          ? 'Membership provider authority changed'
          : evidence.message,
        evidence.ok
          ? 'provider_authority_stale'
          : evidence.errorCode,
      ),
    };
  }
  if (capability === 'acquireVoucher') {
    const args = agentToolArgumentSchemas.acquireVoucher.parse(
      canonicalRequest.arguments,
    );
    return {
      success: true,
      action: {
        toolName: capability,
        rewardId: args.rewardId,
      },
    };
  }
  const args = agentToolArgumentSchemas.redeemReward.parse(
    canonicalRequest.arguments,
  );
  return {
    success: true,
    action: {
      toolName: capability,
      voucherId: args.voucherId,
      channel: args.channel,
    },
  };
}
