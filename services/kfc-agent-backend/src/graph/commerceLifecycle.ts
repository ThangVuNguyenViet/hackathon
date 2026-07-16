import {
  projectToolProgressFamily,
} from '../customerRuns/progressProjection.js';
import { resolveMonitorSessionIntelligence } from '../monitor/sessionIntelligence.js';
import {
  type AgentTraceSpan
} from '../observability/agentTracing.js';
import { applySafetyGates } from '../ordering/safetyGates.js';
import { getToolBoundary } from '../ordering/toolBoundaries.js';
import { parseToolArguments } from '../ordering/toolCatalog.js';
import { executeToolCall } from '../ordering/toolExecutor.js';
import type { PaymentLinkMethod, ToolCallRequest, ToolCallResult, ToolName, ToolTraceEntry } from '../ordering/types.js';
import { cartItemCodes, shouldUseKnownAddressForFulfillment } from './addressContext.js';
import {
  type AgentTurnInput,
  type IrreversibleConfirmationBinding,
  type NaturalLanguagePlan
} from './agentTurnState.js';
import {
  contextPolicyIsActive,
  contextPolicyRequiresConfirmation,
  type ContextPolicyDirective
} from './contextPolicy.js';
import type { AgentGraphState } from './state.js';
import {
  bindingFingerprint,
  emitDashboardEvent,
  hasPlannerBooleanEntity,
  isRecord,
  isRunStillCurrent,
  paymentEvidenceDirectlyMatchesQuery,
  paymentLinkMethodFromFixtureId,
  plannerPaymentMethod,
  pushEscalationReasons,
  toolExecutionContext,
  tracePolicyDecision,
  traceStateSummary,
} from './turnSupport.js';
import { applyToolResultToState, hasSuccessfulCurrentTurnToolCall } from './verifiedState.js';

import { executeAndApplyTracedToolCall } from './commerceExecution.js';
import { hasSuccessfulToolResult } from './commerceExecution.js';

export function beginFreshShoppingJourney(state: AgentGraphState): void {
  state.cart = undefined;
  state.address = undefined;
  state.addressDraft = undefined;
  state.orderPreview = undefined;
  state.order = undefined;
  state.pendingReorder = undefined;
  state.comboConversionProposal = undefined;
  state.fulfillment = undefined;
  state.promotionContext = undefined;
  state.paymentAttempt = undefined;
  state.selectedPaymentMethod = undefined;
  state.paymentMethodEvidence = undefined;
  state.invoiceRequest = undefined;
  state.handoff = undefined;
  state.menuSearchResults = undefined;
  state.plannerMenuSearchResults = undefined;
  state.menuItemDetail = undefined;
  state.menuModifierOptions = undefined;
  state.toolTrace = [];
  state.userConfirmedOrder = false;
  state.entities = {
    ...(isRecord(state.entities) ? state.entities : {}),
    freshShoppingJourney: true,
    orderConfirmed: false,
  };
}

export async function refreshEquivalentComboProposal(input: {
  turnInput: AgentTurnInput;
  state: AgentGraphState;
  currentTurnToolTrace: ToolTraceEntry[];
}): Promise<void> {
  if (!input.state.cart || !input.turnInput.clients.recommendation.recommendEquivalentCombo) return;
  if (!hasSuccessfulToolResult(input.currentTurnToolTrace, ['updateCart'])) return;

  const result = await input.turnInput.clients.recommendation.recommendEquivalentCombo(input.state.cart);
  const entities = isRecord(input.state.entities) ? { ...input.state.entities } : {};
  if (!result.ok || !result.value) {
    delete entities.comboConversionProposal;
    input.state.comboConversionProposal = undefined;
    input.state.entities = entities;
    return;
  }

  const itemResult = await input.turnInput.clients.menu.getItemDetails(result.value.comboItemCode);
  if (!itemResult.ok || !itemResult.value) {
    delete entities.comboConversionProposal;
    input.state.comboConversionProposal = undefined;
    input.state.entities = entities;
    return;
  }

  const proposal = {
    itemCode: result.value.comboItemCode,
    name: itemResult.value.name,
    quantity: result.value.comboQuantity,
    sourceItemCodes: input.state.cart.items.map((item) => item.itemCode),
    sourceTotalVnd: result.value.sourceTotalVnd,
    comboTotalVnd: result.value.comboTotalVnd,
    savingsVnd: result.value.savingsVnd,
  };
  input.state.comboConversionProposal = proposal;
  entities.comboConversionProposal = proposal;
  input.state.entities = entities;
  await input.turnInput.store.appendEvent(input.turnInput.sessionId, 'commerce:combo_conversion_proposed', {
    proposal,
  });
  await executeAndApplyTracedToolCall({
    turnInput: input.turnInput,
    state: input.state,
    currentTurnToolTrace: input.currentTurnToolTrace,
    call: { toolName: 'getModifierOptions', arguments: { code: result.value.comboItemCode } },
  });
}

export const membershipProfileDependentTools: ToolTraceEntry['toolName'][] = [
  'listMembershipRewards',
  'listMembershipWallet',
  'getMembershipPointHistory',
  'acquireVoucher',
  'redeemReward',
];

export function hasMembershipProfileDependentTool(calls: ToolCallRequest[]): boolean {
  return calls.some((call) => membershipProfileDependentTools.includes(call.toolName));
}

export function requiresExplicitDestructiveCartConfirmation(state: AgentGraphState, call: ToolCallRequest): boolean {
  if (call.toolName !== 'updateCart') return false;
  if (!state.cart || state.cart.items.length === 0) return false;
  if (hasPlannerBooleanEntity(state, 'cartMutationConfirmed')) return false;
  const itemCode = typeof call.arguments.itemCode === 'string' ? call.arguments.itemCode : undefined;
  const nextQuantity = typeof call.arguments.quantity === 'number' ? call.arguments.quantity : undefined;
  if (!itemCode || nextQuantity === undefined) return false;
  const currentItem = state.cart.items.find((item) => item.itemCode === itemCode);
  return Boolean(currentItem && nextQuantity < currentItem.quantity);
}

export function contextPolicyBecameActive(
  before: ContextPolicyDirective,
  after: ContextPolicyDirective,
  key: keyof ContextPolicyDirective,
): boolean {
  return !contextPolicyIsActive(before, key) && contextPolicyIsActive(after, key);
}

export function shouldReplanAfterSensitiveContextActivation(input: {
  before: ContextPolicyDirective;
  after: ContextPolicyDirective;
  toolCalls: ToolCallRequest[];
  hasVerifiedCatalogSelections: boolean;
  contextInventory: ReturnType<typeof buildToolPlannerContextInventory>;
}): boolean {
  const catalogSelectionCallsAreSafeWithoutHiddenCheckoutState =
    input.hasVerifiedCatalogSelections &&
    input.toolCalls.every((call) => [
      'updateCart',
      'previewCart',
      'getMembershipProfile',
      'listMembershipRewards',
      'listMembershipWallet',
      'getMembershipPointHistory',
    ].includes(call.toolName));
  if (catalogSelectionCallsAreSafeWithoutHiddenCheckoutState) return false;
  const activatesCart = contextPolicyBecameActive(input.before, input.after, 'cart');
  const activatesRecentOrder = contextPolicyBecameActive(input.before, input.after, 'recentOrder');
  const activatesOrder = contextPolicyBecameActive(input.before, input.after, 'order');
  const activatesPayment = contextPolicyBecameActive(input.before, input.after, 'payment');
  const activatesFulfillment = contextPolicyBecameActive(input.before, input.after, 'fulfillment');
  const activatesCustomer = contextPolicyBecameActive(input.before, input.after, 'customer');
  const activatesMenu = contextPolicyBecameActive(input.before, input.after, 'menuSearchResults');
  return (
    (activatesCart && input.contextInventory.cart.available) ||
    (activatesRecentOrder && input.contextInventory.customer.recentOrderCount > 0) ||
    (activatesOrder && input.contextInventory.order.available) ||
    (activatesPayment && input.contextInventory.payment.available) ||
    (activatesFulfillment && (input.contextInventory.address.available || input.contextInventory.fulfillment.available)) ||
    (activatesCustomer && input.contextInventory.customer.available) ||
    (activatesMenu && input.contextInventory.menuSearchResults.available)
  );
}

export function buildToolPlannerContextInventory(state: AgentGraphState) {
  const savedAddressCount = state.customerContext?.savedAddresses.length ?? 0;
  const recentOrderCount = state.customerContext?.recentOrders.length ?? 0;
  const favoriteCount = state.customerContext?.favorites.length ?? 0;
  const hasUsefulCustomerContext = Boolean(
    savedAddressCount > 0 ||
    recentOrderCount > 0 ||
    favoriteCount > 0 ||
    typeof state.customerContext?.loyaltyPoints === 'number',
  );
  return {
    cart: { available: Boolean(state.cart), itemCount: state.cart?.items.length ?? 0 },
    address: { available: Boolean(state.address) },
    fulfillment: { available: Boolean(state.fulfillment) },
    order: { available: Boolean(state.order) },
    payment: { available: Boolean(state.paymentAttempt || state.paymentMethodEvidence?.length) },
    menuSearchResults: {
      available: Boolean(state.menuSearchResults?.length),
      itemCount: state.menuSearchResults?.length ?? 0,
    },
    customer: {
      available: hasUsefulCustomerContext,
      savedAddressCount,
      recentOrderCount,
      favoriteCount,
    },
  };
}

export function shouldPreserveCurrentMenuSearchResults(entries: ToolTraceEntry[]): boolean {
  return hasSuccessfulToolResult(entries, ['searchMenu']);
}

export function shouldPreserveCurrentCartOrderPaymentContext(entries: ToolTraceEntry[]): boolean {
  return hasSuccessfulToolResult(entries, [
    'updateCart',
    'previewCart',
    'quoteFulfillment',
    'validateVoucher',
    'recommendAddOns',
    'getModifierOptions',
    'previewOrder',
    'placeOrder',
    'createPaymentLink',
    'getOrderStatus',
  ]);
}

export function shouldPreserveCurrentPaymentContext(entries: ToolTraceEntry[]): boolean {
  return hasSuccessfulToolResult(entries, ['listPaymentMethods', 'createPaymentLink', 'checkPaymentStatus']);
}

export function shouldPreserveCurrentHandoff(entries: ToolTraceEntry[]): boolean {
  return hasSuccessfulToolResult(entries, ['handoff']);
}

export function isStructurallySupportedHandoff(state: AgentGraphState, call: ToolCallRequest): boolean {
  if (call.toolName !== 'handoff') return true;

  const reasons = Array.isArray(call.arguments.reasons)
    ? call.arguments.reasons.filter((reason): reason is string => typeof reason === 'string')
    : [];
  if (state.intent === 'handoff') return true;
  if (state.intent === 'complaint' || state.intent === 'safety') return true;
  if (state.paymentAttempt?.status === 'failed' && reasons.includes('payment_failed')) return true;
  return reasons.some((reason) => reason === 'abnormal_large_order');
}

export async function ensureAbnormalLargeOrderHandoff(input: {
  turnInput: AgentTurnInput;
  turnTrace?: AgentTraceSpan;
  state: AgentGraphState;
  currentTurnToolTrace: ToolTraceEntry[];
  plan?: NaturalLanguagePlan;
}): Promise<void> {
  const requestedQuantities = input.plan?.toolCalls.flatMap((call) => {
    if (call.toolName !== 'updateCart') return [];
    const directQuantity = call.arguments.quantity;
    const batchQuantities = Array.isArray(call.arguments.changes)
      ? call.arguments.changes.flatMap((change) =>
        isRecord(change) && typeof change.quantity === 'number' ? [change.quantity] : [],
      )
      : [];
    return [
      ...(typeof directQuantity === 'number' ? [directQuantity] : []),
      ...batchQuantities,
    ];
  }) ?? [];
  if (!requestedQuantities.some((quantity) => Number.isInteger(quantity) && quantity >= 100)) return;
  if (hasSuccessfulToolResult(input.currentTurnToolTrace, ['handoff'])) return;

  const reasons = ['abnormal_large_order', 'human_review_required'];
  input.state.intent = 'handoff';
  input.state.entities = {
    ...(isRecord(input.state.entities) ? input.state.entities : {}),
    abnormalLargeOrder: true,
  };
  pushEscalationReasons(input.state, reasons);

  const call: ToolCallRequest = {
    toolName: 'handoff',
    arguments: { reasons },
  };
  await executeAndApplyTracedToolCall({ ...input, call });
}

export function clearRecoverableFulfillmentArgumentFailure(state: AgentGraphState, entries: ToolTraceEntry[]): void {
  if (!state.cart || state.fulfillment) return;
  if (!hasSuccessfulToolResult(entries, ['updateCart'])) return;
  const failedEntries = entries.filter((entry) => !entry.ok);
  const onlyIncompleteFulfillmentQuoteFailed = failedEntries.every(
    (entry) => entry.toolName === 'quoteFulfillment' && entry.resultSummary === 'invalid_tool_arguments',
  );
  if (!onlyIncompleteFulfillmentQuoteFailed) return;
  state.escalationReasons = state.escalationReasons.filter((reason) => reason !== 'tool_execution_failed');
}
