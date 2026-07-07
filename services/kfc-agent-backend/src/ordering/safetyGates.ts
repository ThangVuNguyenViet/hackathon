import type { AgentGraphState } from '../graph/state.js';
import type { ToolCallRequest, ToolName } from './types.js';

export interface SafetyGateOptions {
  responseClaims?: Array<'promotion' | 'payment_success' | 'allergen_certainty'>;
}

export interface SafetyGateResult {
  allowedCalls: ToolCallRequest[];
  blockedReasons: string[];
}

const promotionEvidenceTools: ToolName[] = ['searchPromotions', 'explainPromotion', 'validateVoucher'];
const paymentEvidenceTools: ToolName[] = ['createPaymentLink', 'checkPaymentStatus'];

function hasFulfillmentForOrdering(state: AgentGraphState): boolean {
  const fulfillment = state.fulfillment;
  if (!fulfillment) return false;
  if (!fulfillment.storeId || !fulfillment.disposition || !fulfillment.method) return false;
  if (!fulfillment.availability.ok) return false;
  if (fulfillment.availability.checkedItemIds.length === 0) return false;
  if (fulfillment.availability.unavailableItemIds.length > 0) return false;
  if (fulfillment.availability.blockedTimeslotItemIds.length > 0) return false;
  return true;
}

function hasToolEvidence(state: AgentGraphState, toolNames: ToolName[]): boolean {
  return state.toolTrace?.some((entry) => entry.ok && toolNames.includes(entry.toolName)) ?? false;
}

export function applySafetyGates(
  state: AgentGraphState,
  plannedCalls: ToolCallRequest[],
  options: SafetyGateOptions = {},
): SafetyGateResult {
  const blockedReasons: string[] = [];
  const blockedReasonSet = new Set<string>();
  const addBlockedReason = (reason: string) => {
    if (blockedReasonSet.has(reason)) return;
    blockedReasonSet.add(reason);
    blockedReasons.push(reason);
  };

  const allowedCalls = plannedCalls.filter((call) => {
    let blocked = false;

    if ((call.toolName === 'previewOrder' || call.toolName === 'placeOrder') && !hasFulfillmentForOrdering(state)) {
      addBlockedReason('valid_fulfillment_required');
      blocked = true;
    }

    if (call.toolName === 'placeOrder' && !state.userConfirmedOrder) {
      addBlockedReason('order_confirmation_required');
      blocked = true;
    }

    return !blocked;
  });

  if (options.responseClaims?.includes('promotion') && !hasToolEvidence(state, promotionEvidenceTools)) {
    addBlockedReason('promotion_evidence_required');
  }

  if (options.responseClaims?.includes('payment_success')) {
    const paid = state.paymentAttempt?.status === 'paid';
    const hasPaymentEvidence = hasToolEvidence(state, paymentEvidenceTools);
    if (!paid || !hasPaymentEvidence) {
      addBlockedReason('payment_tool_success_required');
    }
  }

  if (options.responseClaims?.includes('allergen_certainty')) {
    addBlockedReason('allergen_certainty_not_allowed');
  }

  return { allowedCalls, blockedReasons };
}
