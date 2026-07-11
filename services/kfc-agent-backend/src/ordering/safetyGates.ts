import type { AgentGraphState } from '../graph/state.js';
import type { ToolCallRequest, ToolName } from './types.js';

export interface SafetyGateOptions {
  responseClaims?: Array<'promotion' | 'payment_success' | 'allergen_certainty'>;
  requireVerifiedItemCodes?: boolean;
  requireCartMutationConfirmation?: boolean;
}

export interface SafetyGateResult {
  allowedCalls: ToolCallRequest[];
  blockedReasons: string[];
}

const promotionEvidenceTools: ToolName[] = ['searchPromotions', 'explainPromotion', 'validateVoucher'];
const paymentEvidenceTools: ToolName[] = ['checkPaymentStatus'];

function isReadOnlyMenuTurn(text: string): boolean {
  const normalized = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase();
  const asksRecommendation = /\b(?:goi y|khong biet an gi|mon nao|uu dai|khuyen mai|tiet kiem hon)\b/.test(normalized);
  const explicitlyOrders = /\b(?:cho (?:minh|toi|tui)|minh dat|lay|them|doi sang|nang)\b.*\b(?:\d+|mot|hai|ba|bon)\b/.test(normalized);
  return asksRecommendation && !explicitlyOrders;
}

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

function hasVerifiedItemCode(state: AgentGraphState, itemCode: string): boolean {
  if (state.menuSearchResults?.some((item) => item.code === itemCode)) return true;
  if (state.cart?.items.some((item) => item.itemCode === itemCode)) return true;
  if (state.orderPreview?.cart.items.some((item) => item.itemCode === itemCode)) return true;
  if (state.order?.cart.items.some((item) => item.itemCode === itemCode)) return true;
  return false;
}

function hasStructuredConfirmation(state: AgentGraphState, key: string): boolean {
  const entities = state.entities;
  return typeof entities === 'object' && entities !== null && (entities as Record<string, unknown>)[key] === true;
}

function cartMutationItemCodes(call: ToolCallRequest): string[] {
  if (call.toolName !== 'updateCart') return [];
  if (typeof call.arguments.itemCode === 'string') return [call.arguments.itemCode];
  if (!Array.isArray(call.arguments.changes)) return [];
  return call.arguments.changes.flatMap((change) =>
    typeof change === 'object' && change !== null && typeof (change as Record<string, unknown>).itemCode === 'string'
      ? [(change as Record<string, unknown>).itemCode as string]
      : [],
  );
}

function itemCodeAppearsOnlyInRecentOrders(state: AgentGraphState, itemCode: string): boolean {
  const appearsInRecentOrder =
    state.customerContext?.recentOrders.some((order) => order.cart.items.some((item) => item.itemCode === itemCode)) ?? false;
  if (!appearsInRecentOrder) return false;

  return !hasVerifiedItemCode(state, itemCode);
}

function hasPaidPaymentStatusEvidence(state: AgentGraphState, activeOrderId: string): boolean {
  return (
    state.toolTrace?.some(
      (entry) =>
        entry.ok &&
        paymentEvidenceTools.includes(entry.toolName) &&
        entry.arguments.orderId === activeOrderId,
    ) ?? false
  );
}

function canHandoff(state: AgentGraphState, call: ToolCallRequest): boolean {
  if (call.toolName !== 'handoff') return true;

  const reasons = Array.isArray(call.arguments.reasons)
    ? call.arguments.reasons.filter((reason): reason is string => typeof reason === 'string')
    : [];
  if (state.intent === 'handoff') return true;
  if (state.intent === 'complaint' || state.intent === 'safety') return true;
  if (state.paymentAttempt?.status === 'failed' && reasons.includes('payment_failed')) return true;
  if (reasons.some((reason) => reason === 'abnormal_large_order')) return true;
  return false;
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

    if (call.toolName === 'updateCart' && isReadOnlyMenuTurn(state.latestUserMessage)) {
      addBlockedReason('explicit_cart_mutation_required');
      blocked = true;
    }

    if ((call.toolName === 'previewOrder' || call.toolName === 'placeOrder') && !hasFulfillmentForOrdering(state)) {
      addBlockedReason('valid_fulfillment_required');
      blocked = true;
    }

    if (call.toolName === 'handoff' && !canHandoff(state, call)) {
      addBlockedReason('handoff_not_justified');
      blocked = true;
    }

    if (call.toolName === 'placeOrder' && !state.userConfirmedOrder) {
      addBlockedReason('order_confirmation_required');
      blocked = true;
    }

    if (
      call.toolName === 'updateCart' &&
      typeof call.arguments.itemCode === 'string' &&
      itemCodeAppearsOnlyInRecentOrders(state, call.arguments.itemCode) &&
      !hasStructuredConfirmation(state, 'reorderConfirmed')
    ) {
      addBlockedReason('previous_order_confirmation_required');
      blocked = true;
    }

    if (
      options.requireCartMutationConfirmation &&
      call.toolName === 'updateCart' &&
      !hasStructuredConfirmation(state, 'cartMutationConfirmed')
    ) {
      addBlockedReason('cart_mutation_confirmation_required');
      blocked = true;
    }

    if (
      options.requireVerifiedItemCodes &&
      call.toolName === 'updateCart' &&
      cartMutationItemCodes(call).some((itemCode) => !hasVerifiedItemCode(state, itemCode))
    ) {
      addBlockedReason('unverified_item_code');
      blocked = true;
    }

    return !blocked;
  });

  if (options.responseClaims?.includes('promotion') && !hasToolEvidence(state, promotionEvidenceTools)) {
    addBlockedReason('promotion_evidence_required');
  }

  if (options.responseClaims?.includes('payment_success')) {
    const activeOrderId = state.order?.id;
    const paid = state.paymentAttempt?.status === 'paid';
    const hasPaymentEvidence = activeOrderId ? hasPaidPaymentStatusEvidence(state, activeOrderId) : false;
    if (!activeOrderId || !paid || !hasPaymentEvidence) {
      addBlockedReason('payment_tool_success_required');
    }
  }

  if (options.responseClaims?.includes('allergen_certainty')) {
    addBlockedReason('allergen_certainty_not_allowed');
  }

  return { allowedCalls, blockedReasons };
}
