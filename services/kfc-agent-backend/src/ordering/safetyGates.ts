import type { AgentGraphState } from '../graph/state.js';
import {
  defaultCommerceAgentPolicy,
  type CommerceAgentPolicy,
} from '../config/commerceAgentPolicy.js';
import type { ToolCallRequest, ToolName } from './types.js';

export interface SafetyGateOptions {
  responseClaims?: Array<'promotion' | 'payment_success' | 'allergen_certainty'>;
  requireVerifiedItemCodes?: boolean;
  requireCartMutationConfirmation?: boolean;
  policy?: CommerceAgentPolicy;
}

export interface SafetyGateResult {
  allowedCalls: ToolCallRequest[];
  blockedReasons: string[];
}

const promotionEvidenceTools: ToolName[] = ['searchPromotions', 'explainPromotion', 'validateVoucher'];
const paymentEvidenceTools: ToolName[] = ['checkPaymentStatus'];

function hasFulfillmentForOrdering(state: AgentGraphState): boolean {
  if (!state.address) return false;
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
  if (state.plannerMenuCatalogContext?.candidates.some((item) => item.code === itemCode && item.verifiedForMutation)) {
    return true;
  }
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

function normalizedAddressField(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase('vi-VN')
    .replace(/đ/g, 'd')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function addressFieldsMatch(
  left: Partial<{ line1: string; district: string; city: string }>,
  right: Partial<{ line1: string; district: string; city: string }>,
): boolean {
  return (['line1', 'district', 'city'] as const).every((field) =>
    typeof left[field] === 'string' &&
    typeof right[field] === 'string' &&
    normalizedAddressField(left[field]) === normalizedAddressField(right[field]),
  );
}

function hasVerifiedAddressForQuote(state: AgentGraphState, call: ToolCallRequest): boolean {
  if (call.toolName !== 'quoteFulfillment') return true;
  const plannedAddress = call.arguments.address;
  if (typeof plannedAddress !== 'object' || plannedAddress === null) return false;
  const address = plannedAddress as Partial<{ line1: string; district: string; city: string }>;

  if (state.addressDraft) {
    return addressFieldsMatch(state.addressDraft, address);
  }

  const acceptedSavedAddress =
    state.address &&
    (hasStructuredConfirmation(state, 'useSavedAddress') || hasStructuredConfirmation(state, 'fulfillmentAccepted'))
      ? state.address
      : undefined;
  return acceptedSavedAddress ? addressFieldsMatch(acceptedSavedAddress, address) : false;
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

function itemUnavailableForPlannedFulfillment(state: AgentGraphState, itemCode: string): boolean {
  return state.plannerMenuCatalogContext?.candidates.some(
    (candidate) =>
      candidate.code === itemCode &&
      candidate.fulfillmentAvailability?.available === false,
  ) ?? false;
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
  const policy = options.policy ?? defaultCommerceAgentPolicy;
  const blockedReasons: string[] = [];
  const blockedReasonSet = new Set<string>();
  const addBlockedReason = (reason: string) => {
    if (blockedReasonSet.has(reason)) return;
    blockedReasonSet.add(reason);
    blockedReasons.push(reason);
  };

  const allowedCalls = plannedCalls.filter((call) => {
    let blocked = false;

    if (
      call.toolName === 'updateCart' &&
      !hasStructuredConfirmation(state, 'cartMutationRequested') &&
      !hasStructuredConfirmation(state, 'cartMutationConfirmed') &&
      !hasStructuredConfirmation(state, 'reorderConfirmed')
    ) {
      addBlockedReason('explicit_cart_mutation_required');
      blocked = true;
    }

    if ((call.toolName === 'previewOrder' || call.toolName === 'placeOrder') && !hasFulfillmentForOrdering(state)) {
      addBlockedReason('valid_fulfillment_required');
      blocked = true;
    }

    if (call.toolName === 'quoteFulfillment' && !hasVerifiedAddressForQuote(state, call)) {
      addBlockedReason('confirmed_address_required');
      blocked = true;
    }

    if (call.toolName === 'handoff') {
      const reasons = Array.isArray(call.arguments.reasons) ? call.arguments.reasons : [];
      const requestedQuantity = state.entities?.abnormalLargeOrderQuantity;
      if (
        reasons.includes('abnormal_large_order') &&
        (
          typeof requestedQuantity !== 'number' ||
          !Number.isInteger(requestedQuantity) ||
          requestedQuantity < policy.largeOrderQuantityThreshold
        )
      ) {
        addBlockedReason('large_order_threshold_not_met');
        blocked = true;
      } else if (!canHandoff(state, call)) {
        addBlockedReason('handoff_not_justified');
        blocked = true;
      }
    }

    if (policy.confirmationRequiredTools.includes(call.toolName)) {
      if (call.toolName === 'placeOrder' && !state.userConfirmedOrder) {
        addBlockedReason('order_confirmation_required');
        blocked = true;
      }
      if (
        (call.toolName === 'acquireVoucher' || call.toolName === 'redeemReward') &&
        call.arguments.confirmed === true &&
        !hasStructuredConfirmation(state, 'membershipMutationConfirmed')
      ) {
        addBlockedReason('membership_mutation_confirmation_required');
        blocked = true;
      }
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

    if (
      call.toolName === 'updateCart' &&
      cartMutationItemCodes(call).some((itemCode) => itemUnavailableForPlannedFulfillment(state, itemCode))
    ) {
      addBlockedReason('item_unavailable_for_fulfillment_location');
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
