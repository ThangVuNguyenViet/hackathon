import type {
  MenuItem
} from '../domain/types.js';
import { applySafetyGates } from '../ordering/safetyGates.js';
import type { MenuPlanningContext, ToolCallRequest, ToolTraceEntry } from '../ordering/types.js';
import {
  shouldUseKnownAddressForFulfillment
} from './addressContext.js';
import {
  type LoadedAgentTurnContext,
  type NaturalLanguagePlan,
  type TurnResponseSpec
} from './agentTurnState.js';
import {
  addConfirmedPreviousOrderToCart,
  ensureCartForTool,
  ensureMembershipProfileForActivePolicy,
  executeAndApplyTracedToolCall,
  hasSuccessfulToolResult,
  placeConfirmedOrderFromVerifiedState,
  quoteFulfillmentFromVerifiedAddress,
  revalidateCurrentCartAvailability,
} from './commerceExecution.js';
import {
  hasMembershipProfileDependentTool,
  isStructurallySupportedHandoff,
  refreshEquivalentComboProposal,
  requiresExplicitDestructiveCartConfirmation
} from './commerceLifecycle.js';
import {
  createPaymentLinkAfterOrderFromRememberedMethod,
  ensurePaymentStatusForCompletionClaim,
} from './commercePayment.js';
import {
  contextPolicyIsActive,
  contextPolicyRequiresConfirmation
} from './contextPolicy.js';
import type { AgentGraphState } from './state.js';
import {
  findPaymentEvidenceForLinkMethod,
  hasPlannerBooleanEntity,
  isRecord,
  normalizedIntentText,
  plannerPaymentMethod,
  pushEscalationReasons,
  tracePolicyDecision
} from './turnSupport.js';
import {
  hasSuccessfulCurrentTurnToolCall
} from './verifiedState.js';
export function projectVerifiedCatalogSuggestion(state: AgentGraphState): void {
  const entities = isRecord(state.entities) ? state.entities : {};
  const suggestion = isRecord(entities.catalogSuggestion) ? entities.catalogSuggestion : undefined;
  const itemCode = typeof suggestion?.itemCode === 'string' ? suggestion.itemCode : undefined;
  const item = itemCode
    ? state.plannerMenuCatalogContext?.candidates.find((candidate) => candidate.code === itemCode)
    : undefined;
  if (!item) return;
  state.entities = {
    ...entities,
    keepMenuSurface: true,
    ...(suggestion?.decision === 'suggest'
      ? {
        catalogSuggestion: {
          ...suggestion,
          name: item.name,
          sources: item.customerEvidenceSources ?? [],
        },
      }
      : {}),
  };
  if (item.originalPriceVnd === undefined || typeof item.imageUrl !== 'string') return;
  const verifiedMenuItem: MenuItem = {
    code: item.code,
    itemId: item.itemId,
    productCode: item.productCode,
    category: item.category,
    name: item.name,
    description: item.description,
    priceVnd: item.priceVnd,
    originalPriceVnd: item.originalPriceVnd,
    imageUrl: item.imageUrl,
    available: item.available,
    isCustomize: item.isCustomize,
    isQuickCombo: item.isQuickCombo,
    hasModifiers: item.hasModifiers,
  };
  state.menuSearchResults = [
    verifiedMenuItem,
    ...(state.menuSearchResults ?? []).filter((candidate) => candidate.code !== verifiedMenuItem.code),
  ];
}

export function verifiedMenuItemsFromPlanningCandidates(
  candidates: MenuPlanningContext['candidates'],
): MenuItem[] {
  return candidates.flatMap((item) =>
    typeof item.imageUrl === 'string' && item.originalPriceVnd !== undefined
      ? [{
        code: item.code,
        itemId: item.itemId,
        productCode: item.productCode,
        category: item.category,
        name: item.name,
        description: item.description,
        priceVnd: item.priceVnd,
        originalPriceVnd: item.originalPriceVnd,
        imageUrl: item.imageUrl,
        available: item.available,
        isCustomize: item.isCustomize,
        isQuickCombo: item.isQuickCombo,
        hasModifiers: item.hasModifiers,
      } satisfies MenuItem]
      : [],
  );
}

export async function recoverNaturalLanguagePlan(
  context: LoadedAgentTurnContext,
  plan: NaturalLanguagePlan,
  currentTurnToolTrace: ToolTraceEntry[],
): Promise<TurnResponseSpec> {
  const { input, state, turnTrace } = context;
  const responseMode = plan.recoveryMode ?? 'deterministic';
  if (responseMode === 'verified_menu_catalog') {
    state.entities = {
      ...(isRecord(state.entities) ? state.entities : {}),
      asksClarification: true,
      keepMenuSurface: true,
    };
  }
  await input.store.appendEvent(input.sessionId, 'agent:recovery_response', {
    reason: 'tool_planner_failed_or_timed_out',
    responseMode,
  });
  return {
    replyIntent: 'ask_clarification',
    fallbackText: '',
    currentTurnToolTrace,
    contextPolicy: plan.activeContextPolicy,
  };
}

export function catalogSelectionNeedsClarification(
  state: AgentGraphState,
  plan: NaturalLanguagePlan,
  call: ToolCallRequest,
): boolean {
  const itemCode = typeof call.arguments.itemCode === 'string' ? call.arguments.itemCode : undefined;
  if (!itemCode || state.cart?.items.some((item) => item.itemCode === itemCode)) return false;

  const requestFragment = plan.toolCalls.find(
    (candidate) => candidate.toolName === 'searchMenu' && typeof candidate.arguments.query === 'string',
  )?.arguments.query ??
    plan.catalogSelections?.find((selection) => selection.itemCode === itemCode)?.requestFragment;
  if (typeof requestFragment !== 'string' || requestFragment.trim().length === 0) return false;

  const normalizedFragment = normalizedIntentText(requestFragment).replace(/[^a-z0-9]+/g, ' ').trim();
  if (!normalizedFragment) return false;
  const matchingItems = (state.menuSearchResults ?? []).filter((item) =>
    normalizedIntentText(item.name).replace(/[^a-z0-9]+/g, ' ').includes(normalizedFragment),
  );
  if (matchingItems.length <= 1) return false;

  const selectedItem = matchingItems.find((item) => item.code === itemCode);
  const normalizedLatestMessage = normalizedIntentText(state.latestUserMessage).replace(/[^a-z0-9]+/g, ' ').trim();
  const normalizedSelectedName = selectedItem
    ? normalizedIntentText(selectedItem.name).replace(/[^a-z0-9]+/g, ' ').trim()
    : '';
  return Boolean(
    selectedItem &&
    normalizedSelectedName &&
    !normalizedLatestMessage.includes(normalizedSelectedName),
  );
}

export async function executeNaturalLanguagePlan(
  context: LoadedAgentTurnContext,
  plan: NaturalLanguagePlan,
): Promise<TurnResponseSpec> {
  const { input, state, priorVerifiedState, turnTrace } = context;
  const activeContextPolicy = plan.activeContextPolicy;
  const currentTurnToolTrace: ToolTraceEntry[] = [];
  if (plan.recoveryMode) {
    return recoverNaturalLanguagePlan(context, plan, currentTurnToolTrace);
  }

  if (plan.menuCatalogContext) {
    state.plannerMenuCatalogContext = plan.menuCatalogContext;
  }

  if (
    plan.toolCalls.length === 0 &&
    plan.menuCatalogContext &&
    (
      contextPolicyIsActive(activeContextPolicy, 'menuSearchResults') ||
      plan.menuCatalogContext.candidates.some((candidate) => candidate.available === false)
    )
  ) {
    const surfaceCandidates = plan.planningProfile === 'catalog_ordering'
      ? plan.menuCatalogContext.candidates.filter((candidate) => candidate.activeCartItem !== true)
      : plan.menuCatalogContext.candidates;
    const currentMenuResults = verifiedMenuItemsFromPlanningCandidates(surfaceCandidates);
    if (currentMenuResults.length > 0) {
      state.plannerMenuCatalogContext = { ...plan.menuCatalogContext, candidates: surfaceCandidates };
      state.menuSearchResults = currentMenuResults;
      state.plannerMenuSearchResults = currentMenuResults.slice(0, 12);
      state.entities = { ...(isRecord(state.entities) ? state.entities : {}), keepMenuSurface: true };
    }
  }

  projectVerifiedCatalogSuggestion(state);
  if (
    state.fulfillment &&
    (hasPlannerBooleanEntity(state, 'fulfillmentAccepted') ||
      hasPlannerBooleanEntity(state, 'orderConfirmed') ||
      plan.toolCalls.some((call) => ['previewOrder', 'placeOrder'].includes(call.toolName)))
  ) {
    await revalidateCurrentCartAvailability({ turnInput: input, state, currentTurnToolTrace });
  }

  await ensureMembershipProfileForActivePolicy({
    turnInput: input,
    state,
    currentTurnToolTrace,
    contextPolicy: activeContextPolicy,
    force: hasMembershipProfileDependentTool(plan.toolCalls),
  });

  const recentOrderItemCodes = new Set(
    state.customerContext?.recentOrders.flatMap((order) => order.cart.items.map((item) => item.itemCode)) ?? [],
  );
  const favoriteItemCodes = new Set(state.customerContext?.favorites.map((item) => item.code) ?? []);
  const activeCartItemCodes = new Set(state.cart?.items.map((item) => item.itemCode) ?? []);
  const atomicUpdateCalls = plan.toolCalls.filter((call) => call.toolName === 'updateCart');
  let atomicUpdatesHandled = false;
  for (const call of plan.toolCalls) {
    if (call.toolName === 'updateCart' && atomicUpdateCalls.length > 1) {
      if (atomicUpdatesHandled) continue;
      atomicUpdatesHandled = true;
      const gatedUpdates = atomicUpdateCalls.map((candidate) => ({
        candidate,
        gating: applySafetyGates(state, [candidate], {
          requireVerifiedItemCodes: plan.multiStepEnabled,
          requireCartMutationConfirmation: contextPolicyRequiresConfirmation(activeContextPolicy, 'cart'),
        }),
      }));
      const blockedReasons = [...new Set(gatedUpdates.flatMap(({ gating }) => gating.blockedReasons))];
      await tracePolicyDecision(turnTrace, {
        proposedToolNames: atomicUpdateCalls.map(() => 'updateCart'),
        allowedToolNames: gatedUpdates.flatMap(({ gating }) => gating.allowedCalls.map(() => 'updateCart')),
        blockedReasons,
        confirmationRequired: contextPolicyRequiresConfirmation(activeContextPolicy, 'cart'),
      });
      pushEscalationReasons(state, blockedReasons);
      if (gatedUpdates.some(({ gating }) => gating.allowedCalls.length === 0)) continue;
      const atomicCall: ToolCallRequest = {
        toolName: 'updateCart',
        arguments: { changes: atomicUpdateCalls.map((candidate) => candidate.arguments) },
      };
      if (await ensureCartForTool(input, state, atomicCall)) {
        await executeAndApplyTracedToolCall({
          turnInput: input,
          turnTrace,
          state,
          call: atomicCall,
          currentTurnToolTrace,
        });
      }
      continue;
    }
    if (call.toolName === 'createPaymentLink') {
      const requestedMethod = plannerPaymentMethod(state);
      const evidence = requestedMethod
        ? findPaymentEvidenceForLinkMethod(state.paymentMethodEvidence, requestedMethod)
        : undefined;
      if (!requestedMethod || call.arguments.method !== requestedMethod || evidence?.supported === false) continue;
    }
    if (!isStructurallySupportedHandoff(state, call)) continue;
    if ((call.toolName === 'recommendAddOns' || call.toolName === 'previewCart') && !state.cart) continue;
    if (call.toolName === 'updateCart' && catalogSelectionNeedsClarification(state, plan, call)) {
      state.entities = {
        ...(isRecord(state.entities) ? state.entities : {}),
        asksClarification: true,
        keepMenuSurface: true,
      };
      plan.plannerRequestedClarification = true;
      continue;
    }
    if (call.toolName === 'updateCart' && state.order) {
      plan.plannerRequestedClarification = true;
      continue;
    }
    if (
      state.escalationReasons.includes('item_unavailable_before_confirmation') &&
      ['quoteFulfillment', 'previewOrder', 'placeOrder'].includes(call.toolName)
    ) continue;
    const targetsProtectedRecentOrderItem =
      call.toolName === 'updateCart' &&
      typeof call.arguments.itemCode === 'string' &&
      recentOrderItemCodes.has(call.arguments.itemCode) &&
      !favoriteItemCodes.has(call.arguments.itemCode) &&
      !activeCartItemCodes.has(call.arguments.itemCode);
    if (
      targetsProtectedRecentOrderItem &&
      !hasPlannerBooleanEntity(state, 'reorderConfirmed') &&
      (contextPolicyIsActive(activeContextPolicy, 'recentOrder') ||
        contextPolicyRequiresConfirmation(activeContextPolicy, 'recentOrder'))
    ) {
      state.entities = { ...(isRecord(state.entities) ? state.entities : {}), asksClarification: true };
      plan.plannerRequestedClarification = true;
      pushEscalationReasons(state, ['previous_order_confirmation_required']);
      continue;
    }
    if (requiresExplicitDestructiveCartConfirmation(state, call)) {
      state.entities = { ...(isRecord(state.entities) ? state.entities : {}), asksClarification: true };
      plan.plannerRequestedClarification = true;
      pushEscalationReasons(state, ['cart_mutation_confirmation_required']);
      await tracePolicyDecision(turnTrace, {
        proposedToolNames: [call.toolName],
        allowedToolNames: [],
        blockedReasons: ['cart_mutation_confirmation_required'],
        confirmationRequired: true,
      });
      continue;
    }
    if (hasSuccessfulCurrentTurnToolCall(currentTurnToolTrace, call)) continue;
    const gating = applySafetyGates(state, [call], {
      requireVerifiedItemCodes: plan.multiStepEnabled,
      requireCartMutationConfirmation: contextPolicyRequiresConfirmation(activeContextPolicy, 'cart'),
    });
    await tracePolicyDecision(turnTrace, {
      proposedToolNames: [call.toolName],
      allowedToolNames: gating.allowedCalls.map((allowedCall) => allowedCall.toolName),
      blockedReasons: gating.blockedReasons,
      confirmationRequired: contextPolicyRequiresConfirmation(activeContextPolicy, 'cart'),
    });
    pushEscalationReasons(state, gating.blockedReasons);
    if (gating.allowedCalls.length === 0 || !(await ensureCartForTool(input, state, call))) continue;
    if (call.toolName === 'placeOrder' && !state.orderPreview) {
      const previewCall: ToolCallRequest = { toolName: 'previewOrder', arguments: {} };
      const previewGating = applySafetyGates(state, [previewCall]);
      pushEscalationReasons(state, previewGating.blockedReasons);
      if (previewGating.allowedCalls.length === 0) continue;
      const previewResult = await executeAndApplyTracedToolCall({
        turnInput: input,
        turnTrace,
        state,
        call: previewCall,
        currentTurnToolTrace,
      });
      if (!previewResult.ok) continue;
    }
    await executeAndApplyTracedToolCall({
      turnInput: input,
      turnTrace,
      state,
      call,
      currentTurnToolTrace,
    });
  }

  const pureMenuDiscovery =
    currentTurnToolTrace.length === 1 &&
    currentTurnToolTrace.every((entry) => ['searchMenu', 'recommendAddOns'].includes(entry.toolName));
  if (
    pureMenuDiscovery &&
    hasPlannerBooleanEntity(state, 'asksClarification') &&
    !hasPlannerBooleanEntity(state, 'cartMutationRequested') &&
    plan.menuCatalogContext
  ) {
    const surfaceCandidates = plan.planningProfile === 'catalog_ordering'
      ? plan.menuCatalogContext.candidates.filter((candidate) => candidate.activeCartItem !== true)
      : plan.menuCatalogContext.candidates;
    const currentMenuResults = currentTurnToolTrace.some(
      (entry) => entry.toolName === 'searchMenu' && entry.ok,
    )
      ? (state.menuSearchResults ?? [])
      : verifiedMenuItemsFromPlanningCandidates(surfaceCandidates);
    if (currentMenuResults.length > 0) {
      state.plannerMenuCatalogContext = { ...plan.menuCatalogContext, candidates: surfaceCandidates };
      state.menuSearchResults = currentMenuResults;
      state.entities = { ...(isRecord(state.entities) ? state.entities : {}), keepMenuSurface: true };
    }
  }

  state.plannerMenuSearchResults = undefined;
  state.plannerMenuCatalogContext = undefined;
  if (
    state.intent === 'voucher' ||
    plan.toolCalls.some((call) => call.toolName === 'validateVoucher' || call.toolName === 'collectInvoice')
  ) {
    state.address ??= priorVerifiedState.address;
    state.fulfillment ??= priorVerifiedState.fulfillment;
  }
  if (!state.fulfillment && shouldUseKnownAddressForFulfillment(state)) {
    await quoteFulfillmentFromVerifiedAddress({ turnInput: input, state, currentTurnToolTrace });
  }
  await addConfirmedPreviousOrderToCart({
    turnInput: input,
    state,
    currentTurnToolTrace,
    contextPolicy: activeContextPolicy,
  });
  await ensurePaymentStatusForCompletionClaim({ turnInput: input, state, currentTurnToolTrace });
  await ensureMembershipProfileForActivePolicy({
    turnInput: input,
    state,
    currentTurnToolTrace,
    contextPolicy: activeContextPolicy,
  });
  await refreshEquivalentComboProposal({ turnInput: input, state, currentTurnToolTrace });
  if (!hasSuccessfulToolResult(currentTurnToolTrace, ['placeOrder'])) {
    await placeConfirmedOrderFromVerifiedState({ turnInput: input, state, currentTurnToolTrace });
  }
  await createPaymentLinkAfterOrderFromRememberedMethod({ turnInput: input, state, currentTurnToolTrace });
  if (
    state.intent === 'ordering' &&
    isRecord(state.entities) &&
    typeof state.entities.itemText === 'string' &&
    currentTurnToolTrace.some((entry) => entry.toolName === 'searchMenu') &&
    !hasSuccessfulToolResult(currentTurnToolTrace, ['updateCart']) &&
    (hasPlannerBooleanEntity(state, 'cartMutationRequested') || (state.menuSearchResults?.length ?? 0) === 0) &&
    !state.cart
  ) {
    pushEscalationReasons(state, ['menu_item_verification_required']);
  }

  return {
    contextPolicy: activeContextPolicy,
    replyIntent: state.escalationReasons.length > 0 || plan.plannerRequestedClarification
      ? 'ask_clarification'
      : 'general_reply',
    fallbackText: plan.plannerFallbackText ?? '',
    currentTurnToolTrace,
  };
}
