import { applySafetyGates } from '../ordering/safetyGates.js';
import type { ToolCallRequest, ToolTraceEntry } from '../ordering/types.js';
import {
  applyPlannerSavedAddressDecision,
  presentedSavedAddressIndex
} from './addressContext.js';
import {
  type IrreversibleConfirmationBinding,
  type LoadedAgentTurnContext,
  type ReplyIntent,
  type StructuredActionPlan,
  type TurnResponseSpec
} from './agentTurnState.js';
import {
  ensureCartForTool,
  executeAndApplyReservedIrreversibleToolCall,
  executeAndApplyTracedToolCall,
  quoteFulfillmentFromVerifiedAddress
} from './commerceExecution.js';
import {
  commandBatchUpdateToToolCalls,
  commandCartUpdateToToolCall,
  findPaymentEvidenceForLinkMethod,
  isRecord,
  paymentMethodFromCustomerCommand,
  pushEscalationReasons,
  structuredModifierSelection,
  tracePolicyDecision,
  verifiedModifierSelectionToolCall
} from './turnSupport.js';
import {
  applyToolResultToState,
  buildVerifiedStateSnapshot,
  hydrateRecentOrderContext
} from './verifiedState.js';
export function structuredCommerceResponseSpec(input: {
  currentTurnToolTrace: ToolTraceEntry[];
  replyIntent?: ReplyIntent;
}): TurnResponseSpec {
  return {
    replyIntent: input.replyIntent ?? 'ask_fulfillment_method',
    fallbackText: '',
    currentTurnToolTrace: input.currentTurnToolTrace,
    contextPolicy: {
      cart: 'active',
      fulfillment: 'active',
      customer: 'active',
    },
  };
}

export async function handleStructuredOrderOrPaymentAction(
  context: LoadedAgentTurnContext,
  plan: StructuredActionPlan,
  binding?: IrreversibleConfirmationBinding,
): Promise<TurnResponseSpec | undefined> {
  const confirmsOrder = plan.command.kind === 'confirm_order';
  const selectsPayment = plan.command.kind === 'select_payment_method';
  if (!confirmsOrder && !selectsPayment) return undefined;

  const currentTurnToolTrace: ToolTraceEntry[] = [];
  if (confirmsOrder) {
    if (!binding) throw new Error('confirm_order reached execution without its persisted confirmation binding');
    context.state.userConfirmedOrder = true;
    context.state.entities = {
      ...(isRecord(context.state.entities) ? context.state.entities : {}),
      orderConfirmed: true,
    };
    for (const call of [
      { toolName: 'previewOrder', arguments: {} },
      { toolName: 'placeOrder', arguments: {} },
    ] satisfies ToolCallRequest[]) {
      const gating = applySafetyGates(context.state, [call]);
      pushEscalationReasons(context.state, gating.blockedReasons);
      if (gating.allowedCalls.length === 0) break;
      const executionInput = {
        turnInput: context.input,
        turnTrace: context.turnTrace,
        state: context.state,
        call,
        currentTurnToolTrace,
      };
      if (call.toolName === 'placeOrder') {
        await executeAndApplyReservedIrreversibleToolCall({ ...executionInput, binding });
      } else {
        await executeAndApplyTracedToolCall(executionInput);
      }
    }
    return structuredCommerceResponseSpec({
      currentTurnToolTrace,
      replyIntent: context.state.order ? 'order_created' : 'ask_clarification',
    });
  }

  const requestedMethod = paymentMethodFromCustomerCommand(plan.command);
  await executeAndApplyTracedToolCall({
    turnInput: context.input,
    turnTrace: context.turnTrace,
    state: context.state,
    call: {
      toolName: 'listPaymentMethods',
      arguments: requestedMethod ? { query: requestedMethod } : {},
    },
    currentTurnToolTrace,
  });
  const supported = requestedMethod
    ? findPaymentEvidenceForLinkMethod(context.state.paymentMethodEvidence, requestedMethod)?.supported === true
    : false;
  if (requestedMethod) {
    context.state.selectedPaymentMethod = supported ? requestedMethod : undefined;
  }
  if (requestedMethod && supported && context.state.order) {
    context.state.paymentAttempt = undefined;
    await executeAndApplyTracedToolCall({
      turnInput: context.input,
      turnTrace: context.turnTrace,
      state: context.state,
      call: { toolName: 'createPaymentLink', arguments: { method: requestedMethod } },
      currentTurnToolTrace,
    });
  }
  return structuredCommerceResponseSpec({
    currentTurnToolTrace,
    replyIntent: context.state.paymentAttempt?.status === 'failed' ? 'payment_retry' : 'general_reply',
  });
}

export async function handleStructuredFulfillmentAction(
  context: LoadedAgentTurnContext,
  plan: StructuredActionPlan,
): Promise<TurnResponseSpec | undefined> {
  const startsFulfillment = plan.command.kind === 'start_fulfillment';
  const acceptsFulfillment = plan.command.kind === 'accept_fulfillment';
  if (!startsFulfillment && !acceptsFulfillment) return undefined;

  const hydrated = await hydrateRecentOrderContext(
    context.input,
    buildVerifiedStateSnapshot(context.state),
    { customer: 'active', fulfillment: 'active' },
  );
  Object.assign(context.state, hydrated);
  const presentedAddressIndex = acceptsFulfillment
    ? presentedSavedAddressIndex(
      context.recentTurns,
      context.state.customerContext?.savedAddresses ?? [],
    )
    : undefined;
  context.state.entities = {
    ...(isRecord(context.state.entities) ? context.state.entities : {}),
    preferFulfillmentSurface: true,
    fulfillmentAccepted: acceptsFulfillment && Boolean(context.state.address || presentedAddressIndex !== undefined),
    useSavedAddress: acceptsFulfillment && presentedAddressIndex !== undefined,
    ...(presentedAddressIndex !== undefined
      ? { savedAddressDecision: { addressIndex: presentedAddressIndex, decision: 'accept' as const } }
      : {}),
    orderConfirmed: false,
  };
  applyPlannerSavedAddressDecision(context.state);
  context.state.userConfirmedOrder = false;

  const currentTurnToolTrace: ToolTraceEntry[] = [];
  if (acceptsFulfillment) {
    await quoteFulfillmentFromVerifiedAddress({
      turnInput: context.input,
      state: context.state,
      currentTurnToolTrace,
    });
  }

  return structuredCommerceResponseSpec({
    currentTurnToolTrace,
  });
}

export async function handleStructuredCartAction(
  context: LoadedAgentTurnContext,
  plan: StructuredActionPlan,
): Promise<TurnResponseSpec | undefined> {
  const { input, state, turnTrace } = context;
  const directCartCall = commandCartUpdateToToolCall(plan.command);
  const directModifierSelection = structuredModifierSelection(plan.command);
  const hasDirectModifierSelection = plan.command.kind === 'modifier_selection';
  const directBatchCalls = commandBatchUpdateToToolCalls(plan.command);
  const hasDirectBatch = plan.command.kind === 'cart_batch_update';
  if (!directCartCall && !hasDirectModifierSelection && !hasDirectBatch) return undefined;

  const currentTurnToolTrace: ToolTraceEntry[] = [];
  state.intent = 'cart_edit';
  state.entities = {
    ...(isRecord(state.entities) ? state.entities : {}),
    cartMutationRequested: true,
    cartMutationConfirmed: true,
  };
  if (hasDirectModifierSelection) {
    let verifiedSelection = directModifierSelection
      ? verifiedModifierSelectionToolCall(state, directModifierSelection)
      : undefined;
    if (
      directModifierSelection &&
      (!state.menuModifierOptions || state.menuModifierOptions.itemCode !== directModifierSelection.itemCode)
    ) {
      await executeAndApplyTracedToolCall({
        turnInput: input,
        turnTrace,
        state,
        call: { toolName: 'getModifierOptions', arguments: { code: directModifierSelection.itemCode } },
        currentTurnToolTrace,
      });
      verifiedSelection = verifiedModifierSelectionToolCall(state, directModifierSelection);
    }
    if (!verifiedSelection) {
      pushEscalationReasons(state, ['menu_item_verification_required']);
    } else {
      const gating = applySafetyGates(state, [verifiedSelection.call], { requireVerifiedItemCodes: true });
      await tracePolicyDecision(turnTrace, {
        proposedToolNames: [verifiedSelection.call.toolName],
        allowedToolNames: gating.allowedCalls.map((call) => call.toolName),
        blockedReasons: gating.blockedReasons,
      });
      pushEscalationReasons(state, gating.blockedReasons);
      if (gating.allowedCalls.length > 0) {
        await executeAndApplyTracedToolCall({
          turnInput: input,
          turnTrace,
          state,
          call: verifiedSelection.call,
          currentTurnToolTrace,
        });
      }
    }
  } else if (hasDirectBatch) {
    if (!directBatchCalls) {
      pushEscalationReasons(state, ['menu_item_verification_required']);
    } else {
      const gating = applySafetyGates(state, directBatchCalls, { requireVerifiedItemCodes: true });
      pushEscalationReasons(state, gating.blockedReasons);
      if (gating.blockedReasons.length === 0 && gating.allowedCalls.length === directBatchCalls.length) {
        const firstCall = directBatchCalls[0]!;
        if (await ensureCartForTool(input, state, firstCall)) {
          const selections = directBatchCalls.map((call) => ({
            itemCode: call.arguments.itemCode as string,
            quantity: call.arguments.quantity as number,
          }));
          const response = await input.clients.cart.applyChanges(state.cart!, selections);
          applyToolResultToState(input, state, {
            toolName: 'updateCart',
            ok: response.ok,
            value: response.value,
            message: response.message,
            errorCode: response.errorCode,
            provenance: [],
          }, { items: selections }, currentTurnToolTrace);
        }
      }
    }
  } else if (directCartCall) {
    const gating = applySafetyGates(state, [directCartCall], { requireVerifiedItemCodes: true });
    await tracePolicyDecision(turnTrace, {
      proposedToolNames: [directCartCall.toolName],
      allowedToolNames: gating.allowedCalls.map((call) => call.toolName),
      blockedReasons: gating.blockedReasons,
    });
    pushEscalationReasons(state, gating.blockedReasons);
    if (gating.allowedCalls.length > 0 && await ensureCartForTool(input, state, directCartCall)) {
      await executeAndApplyTracedToolCall({
        turnInput: input,
        turnTrace,
        state,
        call: directCartCall,
        currentTurnToolTrace,
      });
    }
  }

  return {
    replyIntent: state.escalationReasons.length > 0 ? 'ask_clarification' : 'general_reply',
    fallbackText: '',
    currentTurnToolTrace,
  };
}
