import type { IrreversibleConfirmationResume } from '../businesses/kfc/turnContracts.js';
import type {
  CommerceApprovalCapability,
} from '../ordering/types.js';
import type {
  AgentApprovalExecutionContext,
} from '../ordering/agentToolExecutor.js';

/**
 * Projects only the server-owned signed receipt and durable lease into the
 * lower commerce executor. The lower boundary still recomputes current
 * authority and verifies the receipt/fence immediately before dispatch.
 */
export function approvalExecutionForResume(
  resume: IrreversibleConfirmationResume | undefined,
  capability: CommerceApprovalCapability,
): AgentApprovalExecutionContext | undefined {
  const receipt = resume?.commerceReceipt;
  const fence = resume?.executionFence;
  if (
    !receipt ||
    !fence ||
    !resume.signingSecret ||
    (
      resume.verifiedGuestAuthority !== undefined &&
      resume.verifiedGuestAuthority.requestId !== resume.requestId
    ) ||
    receipt.receiptId !== resume.requestId ||
    receipt.binding.capability !== capability ||
    fence.requestId !== resume.requestId
  ) {
    return undefined;
  }
  return {
    principal: receipt.binding.principal,
    receipt,
    signingSecret: resume.signingSecret,
    preclaimedExecution: fence,
    confirmationRequestId: resume.requestId,
    ...(resume.verifiedGuestAuthority
      ? {
          verifiedGuestAuthority:
            resume.verifiedGuestAuthority,
        }
      : {}),
  };
}
