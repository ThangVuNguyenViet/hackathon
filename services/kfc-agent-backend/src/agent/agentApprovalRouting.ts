import {
  toolCallRequiresApproval,
  type PendingToolCall,
} from "./singleAgentRuntime.js";
import type { CommerceApprovalReceipt } from "../ordering/types.js";

interface ApprovalRoutingState {
  failure: string | null;
  pendingToolCalls: PendingToolCall[];
  structuredAction: unknown;
}

interface ValidatedToolRoutingState extends ApprovalRoutingState {
  responseText: string | null;
  validationError: string | null;
}

interface ApprovalResumeRoutingState extends ApprovalRoutingState {
  approvalDecision: "approve" | "reject" | null;
}

interface ApprovalExecutionState {
  pendingToolCalls: PendingToolCall[];
  approvalDecision: "approve" | "reject" | null;
  validatedApprovalActionDigest: string | null;
}

export function approvalExecutionMatchesPendingCall(
  state: ApprovalExecutionState,
  receipt: CommerceApprovalReceipt | undefined,
): boolean {
  const approvalCalls = state.pendingToolCalls.filter(
    toolCallRequiresApproval,
  );
  if (approvalCalls.length === 0) return true;
  const approvedCall = approvalCalls[0];
  return approvalCalls.length === 1 &&
    state.pendingToolCalls.length === 1 &&
    state.approvalDecision === "approve" &&
    Boolean(state.validatedApprovalActionDigest) &&
    receipt?.decision === "approve" &&
    receipt.binding.capability === approvedCall?.toolName &&
    receipt.binding.actionDigest === state.validatedApprovalActionDigest;
}

export function routePreparedStructuredAction(
  state: ApprovalRoutingState,
): string {
  if (state.failure) return "fail_closed";
  if (state.pendingToolCalls.some(toolCallRequiresApproval)) {
    return "request_approval";
  }
  return state.pendingToolCalls.length > 0
    ? "execute_trusted_action"
    : "call_response_model";
}

export function routeValidatedToolCalls(
  state: ValidatedToolRoutingState,
): string {
  if (state.failure) return "fail_closed";
  if (state.validationError) return "record_semantic_correction";
  if (state.responseText) return "finalize_response";
  return state.pendingToolCalls.some(toolCallRequiresApproval)
    ? "request_approval"
    : "execute_tools";
}

export function routeAfterApprovalResume(
  state: ApprovalResumeRoutingState,
): string {
  if (state.failure) return "fail_closed";
  if (state.approvalDecision === "approve") {
    return state.structuredAction
      ? "execute_trusted_action"
      : "execute_tools";
  }
  const nextCall = state.pendingToolCalls[0];
  if (nextCall) {
    return toolCallRequiresApproval(nextCall)
      ? "request_approval"
      : "execute_tools";
  }
  return state.structuredAction
    ? "call_response_model"
    : "call_model";
}
