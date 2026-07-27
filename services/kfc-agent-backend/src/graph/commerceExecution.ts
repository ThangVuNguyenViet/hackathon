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

export function hasSuccessfulToolResult(entries: ToolTraceEntry[], toolNames: ToolTraceEntry['toolName'][]): boolean {
  return entries.some((entry) => entry.ok && toolNames.includes(entry.toolName));
}

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
    category: 'tool',
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
    category: input.result.ok ? 'verified_state' : 'graph_node',
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
