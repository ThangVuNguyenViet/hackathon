import type { AgentGraphState } from '../graph/state.js';
import type { ToolCallRequest, ToolName } from './types.js';

export interface SafetyGateOptions {
  responseClaims?: Array<'promotion' | 'payment_success' | 'allergen_certainty'>;
  requireVerifiedItemCodes?: boolean;
}

export interface SafetyGateResult {
  allowedCalls: ToolCallRequest[];
  blockedReasons: string[];
}

const promotionEvidenceTools: ToolName[] = ['searchPromotions', 'explainPromotion', 'validateVoucher'];
const paymentEvidenceTools: ToolName[] = ['checkPaymentStatus'];

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

function normalizeFreeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/đ/g, 'd')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

const ambiguousReferencePattern = /\b(?:cai do|cai nay|mon do|mon nay|phan do|phan nay|combo do|combo nay|loai do|loai nay|that one|this one|it)\b/;
const menuNameStopwords = new Set(['combo', 'mon', 'phan', 'cai', 'do', 'nay']);

function concreteMenuReferenceTokens(value: string): string[] {
  return normalizeFreeText(value)
    .match(/[a-z0-9]+/g)
    ?.filter((token) => token.length > 1 && !menuNameStopwords.has(token) && Number.isNaN(Number(token))) ?? [];
}

function namesVerifiedMenuItem(state: AgentGraphState, itemCode: string): boolean {
  const item = state.menuSearchResults?.find((candidate) => candidate.code === itemCode);
  if (!item) return false;

  const userText = normalizeFreeText(state.latestUserMessage);
  const nameTokens = concreteMenuReferenceTokens(item.name);
  return nameTokens.length > 0 && nameTokens.every((token) => userText.includes(token));
}

function hasAmbiguousItemReference(state: AgentGraphState, call: ToolCallRequest): boolean {
  if (call.toolName !== 'updateCart' || typeof call.arguments.itemCode !== 'string') return false;

  const normalized = normalizeFreeText(state.latestUserMessage);
  if (!ambiguousReferencePattern.test(normalized)) return false;
  if (namesVerifiedMenuItem(state, call.arguments.itemCode)) return false;

  const verifiedCandidates = state.menuSearchResults?.filter((item) => item.available && item.code) ?? [];
  return verifiedCandidates.length !== 1;
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
  if (state.intent === 'handoff' || state.intent === 'complaint' || state.intent === 'safety') return true;
  if (state.paymentAttempt?.status === 'failed' && reasons.includes('payment_failed')) return true;
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
      options.requireVerifiedItemCodes &&
      call.toolName === 'updateCart' &&
      typeof call.arguments.itemCode === 'string' &&
      !hasVerifiedItemCode(state, call.arguments.itemCode)
    ) {
      addBlockedReason('unverified_item_code');
      blocked = true;
    }

    if (hasAmbiguousItemReference(state, call)) {
      addBlockedReason('ambiguous_item_reference');
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
