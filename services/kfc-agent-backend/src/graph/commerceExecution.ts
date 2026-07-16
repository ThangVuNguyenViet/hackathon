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

export const activeTurnTraces = new WeakMap<AgentTurnInput, AgentTraceSpan>();

export async function executeTracedToolCall(input: {
  turnInput: AgentTurnInput;
  turnTrace?: AgentTraceSpan;
  state: AgentGraphState;
  call: ToolCallRequest;
  irreversibleRequestId?: string;
}): Promise<ToolCallResult> {
  if (!(await isRunStillCurrent(input.turnInput))) {
    throw new Error('customer_run_cancelled');
  }
  const irreversible = input.call.toolName === 'placeOrder';
  const protectedPhase = irreversible || new Set<ToolName>([
    'updateCart', 'acquireVoucher', 'redeemReward', 'collectInvoice',
    'createPaymentLink', 'handoff',
  ]).has(input.call.toolName);
  const validatedArguments = parseToolArguments(
    input.call.toolName,
    input.call.arguments,
  );
  if (validatedArguments.success) {
    await input.turnInput.observeRun?.({
      kind: 'tool',
      protected: protectedPhase,
      irreversible,
      progressFamily: projectToolProgressFamily({
        toolName: input.call.toolName,
        arguments: validatedArguments.data as Record<string, unknown>,
      }),
    });
  }
  const turnTrace = input.turnTrace ?? activeTurnTraces.get(input.turnInput);
  const toolSpan = turnTrace ? await turnTrace.startSpan({
    name: `tool_call:${input.call.toolName}`,
    runType: 'tool',
    inputs: {
      toolName: input.call.toolName,
      arguments: input.call.arguments,
      boundary: getToolBoundary(input.call.toolName),
    },
    metadata: { component: 'executeToolCall' },
    tags: ['agent-tool', `tool:${input.call.toolName}`],
  }) : undefined;

  let result: ToolCallResult;
  try {
    result = await executeToolCall(
      input.turnInput.clients,
      input.state,
      input.call,
      toolExecutionContext(input.turnInput, input.irreversibleRequestId),
    );
    if (!(await isRunStillCurrent(input.turnInput))) {
      throw new Error('customer_run_cancelled');
    }
    await toolSpan?.end({
      ok: result.ok,
      resultSummary: result.ok ? result.message : (result.errorCode ?? result.message),
      provenance: result.provenance ?? null,
    });
  } catch (error) {
    await toolSpan?.fail(error);
    throw error;
  }

  return result;
}

export async function applyTracedToolResult(input: {
  turnInput: AgentTurnInput;
  turnTrace?: AgentTraceSpan;
  state: AgentGraphState;
  call: ToolCallRequest;
  result: ToolCallResult;
  currentTurnToolTrace: ToolTraceEntry[];
}): Promise<void> {
  const turnTrace = input.turnTrace ?? activeTurnTraces.get(input.turnInput);
  const before = traceStateSummary(input.state);
  const stateSpan = turnTrace ? await turnTrace.startSpan({
    name: 'state_update',
    runType: 'chain',
    inputs: { toolName: input.call.toolName, before },
  }) : undefined;

  applyToolResultToState(
    input.turnInput,
    input.state,
    input.result,
    input.call.arguments,
    input.currentTurnToolTrace,
  );
  if (input.result.ok) await input.turnInput.observeRun?.({ kind: 'verified_state' });
  await stateSpan?.end({
    toolName: input.call.toolName,
    before,
    after: traceStateSummary(input.state),
  });
}

export async function executeAndApplyTracedToolCall(input: {
  turnInput: AgentTurnInput;
  turnTrace?: AgentTraceSpan;
  state: AgentGraphState;
  call: ToolCallRequest;
  currentTurnToolTrace: ToolTraceEntry[];
}): Promise<ToolCallResult> {
  const result = await executeTracedToolCall(input);
  await applyTracedToolResult({ ...input, result });
  return result;
}

export function storedToolCallResult(value: Record<string, unknown>): ToolCallResult {
  if (typeof value.ok !== 'boolean' || typeof value.message !== 'string') {
    throw new Error('Stored irreversible operation result is invalid');
  }
  return value as unknown as ToolCallResult;
}

export async function executeAndApplyReservedIrreversibleToolCall(input: {
  turnInput: AgentTurnInput;
  turnTrace?: AgentTraceSpan;
  state: AgentGraphState;
  call: ToolCallRequest;
  currentTurnToolTrace: ToolTraceEntry[];
  binding: IrreversibleConfirmationBinding;
}): Promise<ToolCallResult> {
  const { store } = input.turnInput;
  if (
    !store.reserveIrreversibleOperation ||
    !store.getIrreversibleOperation ||
    !store.completeIrreversibleOperation ||
    !store.failIrreversibleOperation
  ) {
    throw new Error('Conversation store does not support atomic irreversible operation replay');
  }
  const operation = {
    requestId: input.binding.requestId,
    sessionId: input.turnInput.sessionId,
    operation: input.call.toolName,
    bindingFingerprint: await bindingFingerprint(input.binding),
  };
  let reservation = await store.reserveIrreversibleOperation(operation);
  if (reservation.status === 'pending') {
    for (let attempt = 0; attempt < 200 && reservation.status === 'pending'; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      reservation = await store.getIrreversibleOperation(operation) ?? { status: 'pending' };
    }
    if (reservation.status === 'pending') throw new Error('Irreversible operation result is still pending');
  }
  if (reservation.status === 'unknown') {
    reservation = await store.reserveIrreversibleOperation(operation);
    if (reservation.status === 'pending' || reservation.status === 'unknown') {
      throw new Error('Irreversible operation reconciliation is already in progress');
    }
  }
  let result: ToolCallResult;
  if (reservation.status === 'completed') {
    result = storedToolCallResult(reservation.result);
  } else {
    const owner = { attempt: reservation.attempt, leaseToken: reservation.leaseToken };
    try {
      result = await executeTracedToolCall({
        ...input,
        irreversibleRequestId: input.binding.requestId,
      });
    } catch (error) {
      await store.failIrreversibleOperation(
        operation,
        owner,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }
  if (reservation.status === 'reserved') {
    const completion = await store.completeIrreversibleOperation(
      operation,
      { attempt: reservation.attempt, leaseToken: reservation.leaseToken },
      result as unknown as Record<string, unknown>,
    );
    if (completion.status === 'completed') {
      result = storedToolCallResult(completion.result);
    } else {
      const winner = await store.getIrreversibleOperation(operation);
      if (winner?.status !== 'completed') {
        throw new Error('Irreversible operation lease was lost before a winning result was recorded');
      }
      result = storedToolCallResult(winner.result);
    }
  }
  await applyTracedToolResult({ ...input, result });
  return result;
}

export async function ensureCartForTool(input: AgentTurnInput, state: AgentGraphState, call: ToolCallRequest): Promise<boolean> {
  if (call.toolName !== 'updateCart' || state.cart) return true;

  const cartResult = await input.clients.cart.createCart(input.sessionId);
  if (!cartResult.ok || !cartResult.value) {
    pushEscalationReasons(state, ['cart_initialization_failed']);
    return false;
  }

  state.cart = cartResult.value;
  return true;
}

export async function quoteFulfillmentFromVerifiedAddress(input: {
  turnInput: AgentTurnInput;
  state: AgentGraphState;
  currentTurnToolTrace: ToolTraceEntry[];
}): Promise<void> {
  if (!input.state.cart || input.state.cart.items.length === 0 || input.state.fulfillment) return;
  if (input.state.escalationReasons.includes('menu_item_verification_required')) return;
  if (input.state.escalationReasons.includes('item_unavailable_before_confirmation')) return;

  const address = shouldUseKnownAddressForFulfillment(input.state) ? input.state.address : undefined;
  const itemCodes = cartItemCodes(input.state);
  if (!address || itemCodes.length === 0) return;

  const call: ToolCallRequest = {
    toolName: 'quoteFulfillment',
    arguments: {
      address,
      method: 'delivery',
      itemCodes,
    },
  };
  const gating = applySafetyGates(input.state, [call]);
  await tracePolicyDecision(activeTurnTraces.get(input.turnInput), {
    proposedToolNames: [call.toolName],
    allowedToolNames: gating.allowedCalls.map((allowedCall) => allowedCall.toolName),
    blockedReasons: gating.blockedReasons,
  });
  pushEscalationReasons(input.state, gating.blockedReasons);
  if (gating.allowedCalls.length === 0) return;

  await executeAndApplyTracedToolCall({ ...input, call });
}

export async function revalidateCurrentCartAvailability(input: {
  turnInput: AgentTurnInput;
  state: AgentGraphState;
  currentTurnToolTrace: ToolTraceEntry[];
}): Promise<void> {
  const fulfillment = input.state.fulfillment;
  const itemCodes = cartItemCodes(input.state);
  if (!fulfillment || itemCodes.length === 0) return;
  if (input.currentTurnToolTrace.some((entry) => entry.toolName === 'checkStoreAvailability' && entry.ok)) return;

  await executeAndApplyTracedToolCall({
    ...input,
    call: {
      toolName: 'checkStoreAvailability',
      arguments: {
        storeId: fulfillment.storeId,
        itemCodes,
        disposition: fulfillment.disposition,
      },
    },
  });
}

export async function placeConfirmedOrderFromVerifiedState(input: {
  turnInput: AgentTurnInput;
  state: AgentGraphState;
  currentTurnToolTrace: ToolTraceEntry[];
}): Promise<void> {
  if (!input.state.userConfirmedOrder || input.state.order) return;
  if (input.state.escalationReasons.includes('menu_item_verification_required')) return;

  const placeCall: ToolCallRequest = { toolName: 'placeOrder', arguments: {} };
  const gating = applySafetyGates(input.state, [placeCall]);
  await tracePolicyDecision(activeTurnTraces.get(input.turnInput), {
    proposedToolNames: [placeCall.toolName],
    allowedToolNames: gating.allowedCalls.map((allowedCall) => allowedCall.toolName),
    blockedReasons: gating.blockedReasons,
  });
  pushEscalationReasons(input.state, gating.blockedReasons);
  if (gating.allowedCalls.length === 0) return;

  if (!input.state.orderPreview) {
    const previewCall: ToolCallRequest = {
      toolName: 'previewOrder',
      arguments: {},
    };
    const previewResult = await executeAndApplyTracedToolCall({ ...input, call: previewCall });
    if (!previewResult.ok) return;
  }

  await executeAndApplyTracedToolCall({ ...input, call: placeCall });
}

export async function addConfirmedPreviousOrderToCart(input: {
  turnInput: AgentTurnInput;
  state: AgentGraphState;
  currentTurnToolTrace: ToolTraceEntry[];
  contextPolicy: ContextPolicyDirective;
}): Promise<void> {
  if (contextPolicyRequiresConfirmation(input.contextPolicy, 'recentOrder')) return;
  if (!contextPolicyIsActive(input.contextPolicy, 'recentOrder')) return;
  if (!hasPlannerBooleanEntity(input.state, 'reorderConfirmed')) return;
  if (hasSuccessfulToolResult(input.currentTurnToolTrace, ['updateCart'])) return;

  const recentOrderCart = input.state.pendingReorder?.cart ?? input.state.customerContext?.recentOrders[0]?.cart;
  if (!recentOrderCart || recentOrderCart.items.length === 0) return;
  if (!hasPlannerBooleanEntity(input.state, 'reorderConfirmed')) {
    input.state.entities = {
      ...(isRecord(input.state.entities) ? input.state.entities : {}),
      asksClarification: true,
    };
    pushEscalationReasons(input.state, ['previous_order_confirmation_required']);
    return;
  }

  input.state.order = undefined;
  input.state.orderPreview = undefined;
  input.state.paymentAttempt = undefined;
  input.state.fulfillment = undefined;
  input.state.cart = undefined;

  for (const item of recentOrderCart.items) {
    const call: ToolCallRequest = {
      toolName: 'updateCart',
      arguments: { itemCode: item.itemCode, quantity: item.quantity },
    };
    if (hasSuccessfulCurrentTurnToolCall(input.currentTurnToolTrace, call)) continue;

    const gating = applySafetyGates(input.state, [call]);
    await tracePolicyDecision(activeTurnTraces.get(input.turnInput), {
      proposedToolNames: [call.toolName],
      allowedToolNames: gating.allowedCalls.map((allowedCall) => allowedCall.toolName),
      blockedReasons: gating.blockedReasons,
    });
    pushEscalationReasons(input.state, gating.blockedReasons);
    if (gating.allowedCalls.length === 0) continue;

    const ready = await ensureCartForTool(input.turnInput, input.state, call);
    if (!ready) continue;

    await executeAndApplyTracedToolCall({ ...input, call });
  }
  if (input.state.cart) {
    input.state.pendingReorder = undefined;
    input.state.entities = {
      ...(isRecord(input.state.entities) ? input.state.entities : {}),
      keepMenuSurface: false,
    };
  }
}

export async function ensureMembershipProfileForActivePolicy(input: {
  turnInput: AgentTurnInput;
  state: AgentGraphState;
  currentTurnToolTrace: ToolTraceEntry[];
  contextPolicy: ContextPolicyDirective;
  force?: boolean;
}): Promise<void> {
  if (!input.force && !contextPolicyIsActive(input.contextPolicy, 'membership')) return;
  if (typeof input.state.customerContext?.loyaltyPoints === 'number') return;
  if (hasSuccessfulToolResult(input.currentTurnToolTrace, ['getMembershipProfile'])) return;

  const call: ToolCallRequest = { toolName: 'getMembershipProfile', arguments: {} };
  await executeAndApplyTracedToolCall({ ...input, call });
}



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

export function hasSuccessfulToolResult(entries: ToolTraceEntry[], toolNames: ToolTraceEntry['toolName'][]): boolean {
  return entries.some((entry) => entry.ok && toolNames.includes(entry.toolName));
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

export function rememberPlannerPaymentMethod(state: AgentGraphState, checksPaymentMethodSupport = false): void {
  if (checksPaymentMethodSupport) return;
  const method = plannerPaymentMethod(state);
  if (!method || state.paymentAttempt?.paymentUrl) return;
  state.selectedPaymentMethod = method;
}

export function recoverSelectedPaymentMethodFromVerifiedLookup(state: AgentGraphState): PaymentLinkMethod | undefined {
  const lookup = [...(state.toolTrace ?? [])].reverse().find(
    (entry) =>
      entry.ok &&
      entry.toolName === 'listPaymentMethods' &&
      typeof entry.arguments.query === 'string' &&
      entry.arguments.query.trim().length > 0,
  );
  if (!lookup || typeof lookup.arguments.query !== 'string') return undefined;

  const matches = (state.paymentMethodEvidence ?? [])
    .filter((entry) => entry.supported && paymentEvidenceDirectlyMatchesQuery(entry, lookup.arguments.query as string))
    .map((entry) => paymentLinkMethodFromFixtureId(entry.methodId))
    .filter((method): method is PaymentLinkMethod => method !== undefined);
  return matches.length === 1 ? matches[0] : undefined;
}

export async function createPaymentLinkAfterOrderFromRememberedMethod(input: {
  turnInput: AgentTurnInput;
  state: AgentGraphState;
  currentTurnToolTrace: ToolTraceEntry[];
}): Promise<void> {
  if (!input.state.order || input.state.order.status !== 'created') return;
  const method = input.state.selectedPaymentMethod ?? recoverSelectedPaymentMethodFromVerifiedLookup(input.state);
  if (!method || input.state.paymentAttempt?.paymentUrl) return;

  input.state.selectedPaymentMethod = method;
  const call: ToolCallRequest = {
    toolName: 'createPaymentLink',
    arguments: { method },
  };
  await executeAndApplyTracedToolCall({ ...input, call });
}

export async function ensurePaymentStatusForCompletionClaim(input: {
  turnInput: AgentTurnInput;
  state: AgentGraphState;
  currentTurnToolTrace: ToolTraceEntry[];
}): Promise<void> {
  if (!isRecord(input.state.entities) || input.state.entities.paymentStatusClaimed !== 'paid') return;
  if (!input.state.order?.id) return;
  if (hasSuccessfulToolResult(input.currentTurnToolTrace, ['checkPaymentStatus'])) return;
  await executeAndApplyTracedToolCall({
    ...input,
    call: {
      toolName: 'checkPaymentStatus',
      arguments: { orderId: input.state.order.id },
    },
  });
}

export function emitDerivedEvents(input: AgentTurnInput, state: AgentGraphState, turnToolTrace: ToolTraceEntry[]): void {
  if (state.cart && hasSuccessfulToolResult(turnToolTrace, ['updateCart', 'previewCart'])) {
    emitDashboardEvent(input, 'cart_changed', { cart: state.cart });
  }

  if (state.promotionContext?.validation?.ok && hasSuccessfulToolResult(turnToolTrace, ['validateVoucher'])) {
    emitDashboardEvent(input, 'voucher_applied', {
      validation: state.promotionContext.validation,
    });
  }

  if (
    state.promotionContext?.validation &&
    !state.promotionContext.validation.ok &&
    hasSuccessfulToolResult(turnToolTrace, ['validateVoucher'])
  ) {
    emitDashboardEvent(input, 'voucher_rejected', {
      validation: state.promotionContext.validation,
    });
  }

  if (state.orderPreview && hasSuccessfulToolResult(turnToolTrace, ['previewOrder'])) {
    emitDashboardEvent(input, 'order_previewed', { order: state.orderPreview });
  }

  if (state.order && hasSuccessfulToolResult(turnToolTrace, ['placeOrder'])) {
    emitDashboardEvent(input, 'order_created', { order: state.order });
  }

  if (state.paymentAttempt?.paymentUrl && state.paymentAttempt.method && hasSuccessfulToolResult(turnToolTrace, ['createPaymentLink'])) {
    emitDashboardEvent(input, 'payment_link_created', {
      method: state.paymentAttempt.method,
      status: state.paymentAttempt.status,
      url: state.paymentAttempt.paymentUrl,
    });
  }

  if (state.paymentAttempt?.status === 'failed' && hasSuccessfulToolResult(turnToolTrace, ['checkPaymentStatus'])) {
    emitDashboardEvent(input, 'payment_failed', {
      status: state.paymentAttempt.status,
    });
  }

  if (state.paymentAttempt?.status === 'paid' && hasSuccessfulToolResult(turnToolTrace, ['checkPaymentStatus'])) {
    emitDashboardEvent(input, 'payment_paid', {
      status: state.paymentAttempt.status,
    });
  }

  if (state.handoff && hasSuccessfulToolResult(turnToolTrace, ['handoff'])) {
    emitDashboardEvent(input, 'handoff_required', {
      escalationId: state.handoff.escalationId,
      reasons: state.handoff.reasons,
    });
  }
}

export async function emitSessionIntelligence(
  input: AgentTurnInput,
  state: AgentGraphState,
  customerTurnCount: number,
): Promise<void> {
  const sessionIntelligence = await resolveMonitorSessionIntelligence({
    state,
    dashboardEvents: input.dashboard.getEvents(input.sessionId),
    customerTurnCount,
  });
  emitDashboardEvent(input, 'session_intelligence_updated', {
    sessionIntelligence,
  });
}
