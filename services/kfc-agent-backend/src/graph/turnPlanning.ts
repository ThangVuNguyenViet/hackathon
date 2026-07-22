import type {
  MenuItem
} from '../domain/types.js';
import type { ToolPlanner, ToolPlannerOutput } from '../llm/toolPlanner.js';
import type { MenuPlanningContext, ToolCallRequest, ToolName, ToolTraceEntry } from '../ordering/types.js';
import { loadPlanningContexts, maxMenuPlanningCandidates } from './planningContext.js';
export { maxMenuPlanningCandidates, maxFulfillmentPlanningCandidates, catalogOrderingPlanningToolNames, activeCheckoutPlanningToolNames } from './planningContext.js';
import {
  applyPlannerSavedAddressDecision,
  hasIncompleteAddressDraft,
  mergeVerifiedAddressDraft,
  partialAddressText,
  plannerAddressDraft,
  plannerSavedAddressDecision,
} from './addressContext.js';
import {
  type LoadedAgentTurnContext,
  type NaturalLanguagePlan,
  type PlannerResponseClaim,
  type PlanningProfile
} from './agentTurnState.js';
import {
  buildToolPlannerContextInventory,
  shouldReplanAfterSensitiveContextActivation,
} from "./commerceLifecycle.js";
import { rememberPlannerPaymentMethod } from './commercePayment.js';
import {
  buildContextPolicyState,
  contextPolicyIsActive,
  contextPolicyRequiresConfirmation,
  mergeContextPolicies
} from './contextPolicy.js';
import type { AgentGraphState } from './state.js';
import {
  commercePlannerState,
  hasPlannerBooleanEntity,
  isRecord,
  plannerPaymentMethod,
  pushEscalationReasons,
} from './turnSupport.js';
import {
  buildVerifiedStateSnapshot,
  deduplicateToolCalls,
  hydrateRecentOrderContext,
  normalizeNewItemCartUpdates,
} from './verifiedState.js';

export const singleStepPlannerIterations = 1;
export const multiStepPlannerIterations = 2;
export const defaultAgentTurnDeadlineMs = 8_000;
export function planBeforeDeadline(
  planner: ToolPlanner,
  plannerInput: Parameters<ToolPlanner['plan']>[0],
  remainingMs: number,
): Promise<ToolPlannerOutput> {
  if (remainingMs <= 0) {
    return Promise.reject(new Error('Agent turn planning deadline exceeded'));
  }
  return new Promise<ToolPlannerOutput>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Agent turn planning deadline exceeded after ${remainingMs}ms`)),
      remainingMs,
    );
    void planner.plan(plannerInput).then(
      (result) => {
        clearTimeout(timeout);
        resolve(result);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}
export const readOnlyDiscoveryTools = new Set<ToolName>([
  'searchMenu',
  'searchPromotions',
  'getItemDetails',
  'getModifierOptions',
  'listPaymentMethods',
]);
export const catalogResolutionTools = new Set<ToolName>([
  'searchMenu',
  'getItemDetails',
  'getModifierOptions',
]);

export function shouldStopAfterVerifiedDiscovery(input: {
  state: AgentGraphState;
  iterationEntries: ToolTraceEntry[];
}): boolean {
  if (input.iterationEntries.length === 0) return false;
  if (!input.iterationEntries.every((entry) => entry.ok && readOnlyDiscoveryTools.has(entry.toolName))) return false;
  const discoveredMenuForOrdering =
    input.iterationEntries.some((entry) =>
      entry.toolName === 'searchMenu' &&
      typeof entry.arguments.query === 'string' &&
      entry.arguments.query.trim().length > 0,
    ) &&
    (input.state.menuSearchResults?.length ?? 0) > 0 &&
    (input.state.intent === 'ordering' || input.state.intent === 'cart_edit') &&
    !hasPlannerBooleanEntity(input.state, 'asksClarification');
  if (discoveredMenuForOrdering) return false;
  if (hasPlannerBooleanEntity(input.state, 'cartMutationRequested')) return false;
  if (hasPlannerBooleanEntity(input.state, 'orderConfirmed')) return false;
  if (hasPlannerBooleanEntity(input.state, 'reorderConfirmed')) return false;
  if (hasPlannerBooleanEntity(input.state, 'fulfillmentAccepted')) return false;
  return true;
}

export async function planNaturalLanguageTurn(
  context: LoadedAgentTurnContext,
): Promise<NaturalLanguagePlan> {
  const { input, state, recentTurns, turnTrace } = context;
  const pendingCatalogSuggestionAtTurnStart = state.pendingCatalogSuggestion;
  const pendingReorderAtTurnStart = state.pendingReorder;
  let activeContextPolicy = context.activeContextPolicy;
  const emptyPlan = (recoveryMode: NonNullable<NaturalLanguagePlan['recoveryMode']>): NaturalLanguagePlan => ({
    activeContextPolicy,
    planningProfile: state.cart && !state.order ? 'active_checkout' : 'full',
    multiStepEnabled: input.toolPlanner?.supportsMultiStep === true,
    toolCalls: [],
    responseClaims: [],
    plannerRequestedClarification: true,
    recoveryMode,
  });

  if (!input.toolPlanner) return emptyPlan('deterministic');
  await input.observeRun?.({ kind: 'planning' });
  const planningContexts = await loadPlanningContexts(context, activeContextPolicy);
  const plannerDeadlineAt = Date.now() + (input.turnDeadlineMs ?? defaultAgentTurnDeadlineMs);
  activeContextPolicy = planningContexts.activeContextPolicy;
  let { menuCatalogContext } = planningContexts;
  const {
    fulfillmentLocationContext,
    planningProfile,
    availableTools,
    activeItemCodes,
    customerEvidenceItems,
    uniqueLocation,
    hasCurrentCatalogCandidates,
  } = planningContexts;
  const multiStepEnabled = input.toolPlanner.supportsMultiStep === true;
  const maxIterations = multiStepEnabled ? multiStepPlannerIterations : singleStepPlannerIterations;
  const responseClaims = new Set<PlannerResponseClaim>();
  let priorPlanForReview: ToolPlannerOutput | undefined;
  const plannedDiscoveryCalls: ToolCallRequest[] = [];
  let plannerFallbackText: string | undefined;
  let plannerRequestedClarification = false;

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const contextPolicyBeforePlan = activeContextPolicy;
    const policyState = buildContextPolicyState({ ...state, toolTrace: [] }, {
      metadata: input.metadata,
      policy: activeContextPolicy,
      preserveCartOrderPaymentContext: false,
      preserveMenuSearchResults: priorPlanForReview !== undefined,
      preservePaymentContext: false,
      preserveHandoff: false,
      preserveToolTrace: false,
      compactMenuSearchResults: true,
    });
    const isVerifiedCatalogReview = Boolean(
      priorPlanForReview &&
      (menuCatalogContext?.candidates.length ?? 0) > 0 &&
      (priorPlanForReview.catalogSelections?.length ?? 0) === 0 &&
      priorPlanForReview.toolCalls.some((call) => call.toolName === 'searchMenu'),
    );
    const plannerInput = {
      state: commercePlannerState({
        ...policyState,
        pendingCatalogSuggestion: pendingCatalogSuggestionAtTurnStart,
        pendingReorder: pendingReorderAtTurnStart,
      }),
      availableTools: isVerifiedCatalogReview
        ? availableTools.filter((toolName) => toolName !== 'searchMenu')
        : availableTools,
      recentTurns: recentTurns.filter((turn) => turn.role === 'user'),
      consentTurns: recentTurns,
      contextInventory: buildToolPlannerContextInventory(state),
      menuCatalogContext,
      fulfillmentLocationContext,
      planningProfile,
      priorPlanForReview,
    };
    const plannerSpan = await turnTrace.startSpan({
      name: 'planner_iteration',
      runType: 'llm',
      inputs: { iteration: iteration + 1, plannerInput },
      metadata: { component: 'ToolPlanner' },
      tags: ['agent-planner'],
    });
    let rawPlan: ToolPlannerOutput | undefined;
    try {
      rawPlan = await planBeforeDeadline(input.toolPlanner, plannerInput, plannerDeadlineAt - Date.now());
      await input.store.appendEvent(input.sessionId, 'llm:tool_plan', {
        clientMessageId: input.externalMessageId ?? null,
        iteration: iteration + 1,
        intent: rawPlan.intent,
        booleanEntities: Object.fromEntries(Object.entries(rawPlan.entities).filter(([, value]) => typeof value === 'boolean')),
        proposedCalls: rawPlan.toolCalls.map((call) => ({
          toolName: call.toolName,
          argumentPaths: persistableArgumentPaths(call.arguments),
        })),
        responseClaims: rawPlan.responseClaims,
        availableTools: plannerInput.availableTools,
        catalogCandidates: plannerInput.menuCatalogContext?.candidates.map((candidate) => ({
          code: candidate.code,
          activeCartItem: candidate.activeCartItem === true,
          available: candidate.available,
          customerEvidenceSources: candidate.customerEvidenceSources ?? [],
          modifierOptionNames: candidate.modifierGroups.flatMap((group) => group.options.map((option) => option.name)),
          modifierAliases: candidate.modifierGroups.flatMap((group) => group.options.flatMap((option) => option.searchAliases ?? [])),
        })) ?? [],
        fulfillmentLocations: plannerInput.fulfillmentLocationContext?.candidates.map(({ district, city }) => ({ district, city })) ?? [],
      });
      await plannerSpan.end({
        plannerOutput: rawPlan,
        intent: rawPlan.intent,
        contextPolicy: rawPlan.contextPolicy ?? {},
        entities: rawPlan.entities,
        proposedToolNames: rawPlan.toolCalls.map((call) => call.toolName),
        responseClaims: rawPlan.responseClaims,
        asksClarification: rawPlan.entities.asksClarification === true,
      });
    } catch (error) {
      await plannerSpan.fail(error);
      await input.store.appendEvent(input.sessionId, 'llm:tool_planner_failed', {
        message: error instanceof Error ? error.message : 'Unknown tool planner failure',
      });
    }

    if (!rawPlan) {
      return {
        activeContextPolicy,
        fulfillmentLocationContext,
        menuCatalogContext,
        planningProfile,
        multiStepEnabled,
        toolCalls: [],
        responseClaims: [],
        plannerRequestedClarification: true,
        recoveryMode:
          priorPlanForReview && (state.menuSearchResults?.length ?? 0) > 0
            ? 'verified_menu_catalog'
            : 'deterministic',
      };
    }

    if (
      planningProfile === 'catalog_ordering' &&
      (rawPlan.intent === 'ordering' || rawPlan.intent === 'cart_edit') &&
      rawPlan.toolCalls.length === 0 &&
      (rawPlan.catalogSelections?.length ?? 0) === 0 &&
      rawPlan.entities.cartMutationRequested !== true &&
      hasCurrentCatalogCandidates
    ) {
      rawPlan = {
        ...rawPlan,
        contextPolicy: {
          ...rawPlan.contextPolicy,
          cart: 'irrelevant',
          menuSearchResults: 'active',
          order: 'irrelevant',
          payment: 'irrelevant',
        },
        entities: { ...rawPlan.entities, asksClarification: true, keepMenuSurface: true },
        directResponse: undefined,
      };
    }

    if (
      rawPlan.catalogSelections?.length &&
      rawPlan.toolCalls.some((call) => call.toolName === 'updateCart') &&
      rawPlan.entities.cartMutationRequested !== true &&
      rawPlan.directResponse?.trim().endsWith('?')
    ) {
      rawPlan = {
        ...rawPlan,
        contextPolicy: {
          ...rawPlan.contextPolicy,
          menuSearchResults: 'active',
          order: 'irrelevant',
          payment: 'irrelevant',
        },
        entities: { ...rawPlan.entities, asksClarification: true },
        toolCalls: rawPlan.toolCalls.filter((call) => call.toolName !== 'updateCart'),
      };
    }

    state.intent = rawPlan.intent;
    if (rawPlan.entities.cancellationStatusChecked === true) {
      state.cancellationStatusChecked = true;
    }
    state.entities = {
      ...rawPlan.entities,
      ...(rawPlan.catalogSuggestion
        ? { catalogSuggestion: rawPlan.catalogSuggestion }
        : {}),
      ...(rawPlan.savedAddressDecision
        ? { savedAddressDecision: rawPlan.savedAddressDecision }
        : {}),
    };
    if (
      state.pendingCatalogSuggestion &&
      (rawPlan.pendingDecisions?.catalogSuggestion === 'decline' ||
        rawPlan.pendingDecisions?.catalogSuggestion === 'unrelated')
    ) {
      state.pendingCatalogSuggestion = undefined;
    }
    if (
      state.pendingReorder &&
      (rawPlan.pendingDecisions?.reorder === 'decline' || rawPlan.pendingDecisions?.reorder === 'unrelated')
    ) {
      state.pendingReorder = undefined;
    }
    const catalogSuggestion = rawPlan.catalogSuggestion;
    if (catalogSuggestion?.decision === 'suggest') {
      const item = menuCatalogContext?.candidates.find(
        (candidate) => candidate.code === catalogSuggestion.itemCode,
      );
      if (item?.customerEvidenceSources?.includes(catalogSuggestion.source)) {
        state.pendingCatalogSuggestion = {
          itemCode: item.code,
          name: item.name,
          source: catalogSuggestion.source,
        };
        plannerFallbackText = undefined;
        rawPlan = {
          ...rawPlan,
          contextPolicy: { ...rawPlan.contextPolicy, menuSearchResults: 'active' },
          entities: { ...rawPlan.entities, keepMenuSurface: true },
        };
        state.entities = { ...state.entities, keepMenuSurface: true };
      }
    }
    const suppressesReadOnlyDiscovery =
      hasPlannerBooleanEntity(state, 'smallTalk') ||
      (rawPlan.intent === 'unclear' && rawPlan.entities.asksClarification === true);
    if (
      suppressesReadOnlyDiscovery &&
      rawPlan.directResponse &&
      rawPlan.toolCalls.every((call) => readOnlyDiscoveryTools.has(call.toolName))
    ) {
      rawPlan = {
        ...rawPlan,
        contextPolicy: { ...rawPlan.contextPolicy, menuSearchResults: 'irrelevant' },
        entities: { ...rawPlan.entities, suppressGenUi: true },
        toolCalls: [],
      };
      state.entities = rawPlan.entities;
    }
    applyPlannerSavedAddressDecision(state);
    mergeVerifiedAddressDraft(state, fulfillmentLocationContext);
    const requestedPaymentMethod = plannerPaymentMethod(state);
    if (requestedPaymentMethod && state.paymentAttempt?.method && state.paymentAttempt.method !== requestedPaymentMethod) {
      state.paymentAttempt = undefined;
    }
    const hasGroundedCompleteAddressQuote =
      rawPlan.toolCalls.some((call) => call.toolName === 'quoteFulfillment') &&
      !hasIncompleteAddressDraft(state) &&
      typeof plannerAddressDraft(state)?.line1 === 'string';
    if (
      !hasGroundedCompleteAddressQuote &&
      (partialAddressText(state) || (hasIncompleteAddressDraft(state) && !plannerSavedAddressDecision(state)))
    ) {
      state.entities = {
        ...state.entities,
        asksClarification: true,
        preferFulfillmentSurface: true,
        suppressSavedAddressCandidate: true,
        useSavedAddress: false,
      };
      state.address = undefined;
      state.fulfillment = undefined;
    }
    if (
      contextPolicyRequiresConfirmation(rawPlan.contextPolicy ?? {}, 'recentOrder') &&
      !hasPlannerBooleanEntity(state, 'reorderConfirmed')
    ) {
      const reorderSource = state.customerContext?.recentOrders[0] ?? state.order;
      if (reorderSource) {
        state.pendingReorder = { orderId: reorderSource.id, cart: reorderSource.cart };
      }
      state.entities = {
        ...state.entities,
        reorderConfirmed: false,
        asksClarification: true,
        suppressGenUi: true,
      };
      state.cart = undefined;
      state.order = undefined;
      state.orderPreview = undefined;
      state.paymentAttempt = undefined;
      state.handoff = undefined;
    }
    activeContextPolicy = mergeContextPolicies(activeContextPolicy, rawPlan.contextPolicy);
    if (hasPlannerBooleanEntity(state, 'freshShoppingJourney')) {
      activeContextPolicy = {
        cart: 'active',
        menuSearchResults: 'active',
        order: 'irrelevant',
        payment: 'irrelevant',
        fulfillment: 'irrelevant',
        handoff: 'irrelevant',
        recentOrder: 'irrelevant',
      };
    }
    if (
      rawPlan.intent === 'voucher' ||
      hasPlannerBooleanEntity(state, 'invoiceRequested') ||
      rawPlan.toolCalls.some((call) => call.toolName === 'validateVoucher' || call.toolName === 'collectInvoice')
    ) {
      activeContextPolicy = mergeContextPolicies(activeContextPolicy, { cart: 'active', fulfillment: 'active' });
    }
    const preservesCartForCheckoutClarification = Boolean(
      planningProfile === 'active_checkout' &&
      state.cart &&
      rawPlan.intent === 'unclear' &&
      rawPlan.toolCalls.length === 0 &&
      rawPlan.directResponse &&
      !hasPlannerBooleanEntity(state, 'smallTalk'),
    );
    if (preservesCartForCheckoutClarification) {
      state.entities = { ...state.entities, asksClarification: true };
      activeContextPolicy = mergeContextPolicies(activeContextPolicy, { cart: 'active' });
    }
    if (
      hasPlannerBooleanEntity(state, 'preferFulfillmentSurface') ||
      (isRecord(state.entities) && state.entities.fulfillmentMethod === 'delivery')
    ) {
      state.entities = { ...state.entities, fulfillmentMethod: 'delivery', preferFulfillmentSurface: true };
      activeContextPolicy = mergeContextPolicies(activeContextPolicy, {
        cart: 'active', fulfillment: 'active', customer: 'active',
      });
    }
    if (hasPlannerBooleanEntity(state, 'addressChangeRequested')) {
      state.address = undefined;
      state.fulfillment = undefined;
      activeContextPolicy = mergeContextPolicies(activeContextPolicy, { cart: 'active', fulfillment: 'active' });
    }
    if (rawPlan.intent === 'payment' || rawPlan.intent === 'order_status') {
      activeContextPolicy = mergeContextPolicies(activeContextPolicy, { order: 'active', payment: 'active' });
    }
    if (rawPlan.toolCalls.length === 0 && rawPlan.contextPolicy?.menuSearchResults !== 'irrelevant' && (state.menuSearchResults?.length ?? 0) > 0 && !state.cart && !state.order && !state.handoff) {
      activeContextPolicy = mergeContextPolicies(activeContextPolicy, { menuSearchResults: 'active' });
      state.entities = { ...state.entities, keepMenuSurface: true };
    }
    const hydratedState = await hydrateRecentOrderContext(input, buildVerifiedStateSnapshot(state), activeContextPolicy);
    Object.assign(state, hydratedState);
    applyPlannerSavedAddressDecision(state);
    if (
      hasPlannerBooleanEntity(state, 'useSavedAddress') &&
      !plannerSavedAddressDecision(state) &&
      (state.customerContext?.savedAddresses.length ?? 0) === 1
    ) {
      state.entities = { ...state.entities, preferFulfillmentSurface: true };
    }
    if (
      (contextPolicyIsActive(activeContextPolicy, 'recentOrder') ||
        contextPolicyRequiresConfirmation(activeContextPolicy, 'recentOrder')) &&
      !hasPlannerBooleanEntity(state, 'reorderConfirmed') &&
      rawPlan.toolCalls.some((call) => call.toolName === 'updateCart')
    ) {
      state.entities = { ...state.entities, asksClarification: true };
      plannerRequestedClarification = true;
      pushEscalationReasons(state, ['previous_order_confirmation_required']);
    }
    if (hasPlannerBooleanEntity(state, 'asksClarification')) plannerRequestedClarification = true;
    if (hasPlannerBooleanEntity(state, 'orderConfirmed')) state.userConfirmedOrder = true;
    rememberPlannerPaymentMethod(state, rawPlan.toolCalls.some((call) => call.toolName === 'listPaymentMethods'));
    for (const claim of rawPlan.responseClaims) responseClaims.add(claim);
    plannerFallbackText = rawPlan.directResponse ?? plannerFallbackText;

    const needsAddressSourceReview = Boolean(
      multiStepEnabled &&
      iteration + 1 < maxIterations &&
      !state.address &&
      hasIncompleteAddressDraft(state) &&
      !plannerAddressDraft(state) &&
      !plannerSavedAddressDecision(state) &&
      (state.customerContext?.savedAddresses.length ?? 0) > 0 &&
      rawPlan.toolCalls.some((call) => call.toolName === 'updateCart'),
    );
    const needsPendingCatalogSuggestionReview = Boolean(
      multiStepEnabled &&
      iteration + 1 < maxIterations &&
      pendingCatalogSuggestionAtTurnStart &&
      !rawPlan.catalogSuggestion &&
      (rawPlan.catalogSelections?.length ?? 0) === 0 &&
      (
        rawPlan.entities.asksClarification === true ||
        rawPlan.toolCalls.some((call) => call.toolName === 'searchMenu')
      ),
    );
    const needsPendingReorderReview = Boolean(
      multiStepEnabled &&
      iteration + 1 < maxIterations &&
      pendingReorderAtTurnStart &&
      !rawPlan.catalogSuggestion &&
      !hasPlannerBooleanEntity(state, 'reorderConfirmed') &&
      rawPlan.toolCalls.length === 0
    );
    const needsCatalogClarificationReview = Boolean(
      rawPlan.toolCalls.length === 0 &&
      rawPlan.entities.asksClarification === true &&
      rawPlan.entities.cartMutationRequested === true &&
      planningProfile === 'catalog_ordering' &&
      (menuCatalogContext?.candidates.length ?? 0) > 0 &&
      iteration + 1 < maxIterations,
    );
    const needsPostSearchCatalogReview = Boolean(
      multiStepEnabled &&
      iteration + 1 < maxIterations &&
      rawPlan.intent !== 'safety' &&
      (rawPlan.catalogSelections?.length ?? 0) === 0 &&
      rawPlan.entities.cartMutationRequested === true &&
      rawPlan.toolCalls.some(
        (call) =>
          call.toolName === 'searchMenu' &&
          typeof call.arguments.query === 'string' &&
          call.arguments.query.trim().length > 0,
      ),
    );
    const verifiedReadOnlyDiscoveryRequiresNoReview = Boolean(
      rawPlan.entities.cartMutationRequested !== true &&
      (rawPlan.catalogSelections?.length ?? 0) === 0 &&
      rawPlan.toolCalls.length > 0 &&
      rawPlan.toolCalls.every((call) => readOnlyDiscoveryTools.has(call.toolName)),
    );
    const acceptedSavedAddressQuoteRequiresNoReview = Boolean(
      rawPlan.savedAddressDecision?.decision === 'accept' &&
      rawPlan.entities.useSavedAddress === true &&
      rawPlan.entities.fulfillmentAccepted === true &&
      rawPlan.toolCalls.length > 0 &&
      rawPlan.toolCalls.every((call) => call.toolName === 'quoteFulfillment'),
    );
    const needsSensitiveContextReview = Boolean(
      multiStepEnabled &&
      iteration + 1 < maxIterations &&
      rawPlan.toolCalls.length > 0 &&
      !verifiedReadOnlyDiscoveryRequiresNoReview &&
      !acceptedSavedAddressQuoteRequiresNoReview &&
      shouldReplanAfterSensitiveContextActivation({
        before: contextPolicyBeforePlan,
        after: activeContextPolicy,
        toolCalls: rawPlan.toolCalls,
        hasVerifiedCatalogSelections: (rawPlan.catalogSelections?.length ?? 0) > 0,
        contextInventory: plannerInput.contextInventory,
      }),
    );
    const needsVerifiedDiscoveryReview = Boolean(
      multiStepEnabled &&
      iteration + 1 < maxIterations &&
      rawPlan.intent !== 'safety' &&
      (rawPlan.catalogSelections?.length ?? 0) === 0 &&
      rawPlan.entities.cartMutationRequested === true &&
      rawPlan.toolCalls.some((call) => catalogResolutionTools.has(call.toolName)) &&
      rawPlan.toolCalls.some(
        (call) =>
          call.toolName === 'searchMenu' &&
          typeof call.arguments.query === 'string' &&
          call.arguments.query.trim().length > 0,
      ),
    );
    if (needsVerifiedDiscoveryReview) {
      const focusedCandidates: MenuPlanningContext['candidates'] = [];
      const focusedMenuResults: MenuItem[] = [];
      for (const call of rawPlan.toolCalls) {
        if (call.toolName !== 'searchMenu' || typeof call.arguments.query !== 'string') continue;
        const [planningResult, searchResult] = await Promise.all([
          input.clients.menu.getPlanningContext({
            query: call.arguments.query,
            activeItemCodes,
            activeItemQuantities: Object.fromEntries((state.cart?.items ?? []).map((item) => [item.itemCode, item.quantity])),
            customerEvidenceItems,
            maxCandidates: 3,
            ...(uniqueLocation
              ? { fulfillment: { storeId: uniqueLocation.storeId, disposition: uniqueLocation.method } }
              : {}),
          }),
          input.clients.menu.searchMenu({ query: call.arguments.query }),
        ]);
        if (planningResult.ok && planningResult.value) focusedCandidates.push(...planningResult.value.candidates);
        if (searchResult.ok && searchResult.value) {
          focusedMenuResults.push(...searchResult.value.items.slice(0, 3).map((item) => ({
            ...item,
            originalPriceVnd: item.originalPriceVnd ?? null,
          })));
        }
      }
      const seenPlanningCodes = new Set<string>();
      menuCatalogContext = {
        query: state.latestUserMessage,
        candidates: [...focusedCandidates, ...(menuCatalogContext?.candidates ?? [])]
          .filter((candidate) => {
            if (seenPlanningCodes.has(candidate.code)) return false;
            seenPlanningCodes.add(candidate.code);
            return true;
          })
          .slice(0, maxMenuPlanningCandidates),
      };
      state.plannerMenuCatalogContext = menuCatalogContext;
      const planningMenuResults = menuCatalogContext.candidates;
      const verifiedPlanningItems = planningMenuResults.flatMap((candidate) =>
        typeof candidate.imageUrl === 'string' && candidate.originalPriceVnd !== undefined
          ? [{
            code: candidate.code,
            itemId: candidate.itemId,
            productCode: candidate.productCode,
            category: candidate.category,
            name: candidate.name,
            description: candidate.description,
            priceVnd: candidate.priceVnd,
            originalPriceVnd: candidate.originalPriceVnd,
            imageUrl: candidate.imageUrl,
            available: candidate.available,
            isCustomize: candidate.isCustomize,
            isQuickCombo: candidate.isQuickCombo,
            hasModifiers: candidate.hasModifiers,
          } satisfies MenuItem]
          : [],
      );
      const seenCandidateCodes = new Set<string>();
      const verifiedCandidates = [...focusedMenuResults, ...verifiedPlanningItems]
        .filter((candidate) => {
          if (seenCandidateCodes.has(candidate.code)) return false;
          seenCandidateCodes.add(candidate.code);
          return true;
        });
      state.menuSearchResults = verifiedCandidates;
      const focusedCodes = new Set(focusedCandidates.map((candidate) => candidate.code));
      state.plannerMenuSearchResults = [
        ...verifiedCandidates.filter((candidate) => focusedCodes.has(candidate.code)),
        ...verifiedCandidates.filter((candidate) => !focusedCodes.has(candidate.code)),
      ].slice(0, 12);
      if (!state.pendingCatalogSuggestion) {
        plannedDiscoveryCalls.push(...rawPlan.toolCalls.filter((call) => catalogResolutionTools.has(call.toolName)));
      }
    }
    if (needsPostSearchCatalogReview && !needsVerifiedDiscoveryReview) {
      plannedDiscoveryCalls.push(...rawPlan.toolCalls.filter((call) => catalogResolutionTools.has(call.toolName)));
    }
    if (
      needsAddressSourceReview ||
      needsPendingCatalogSuggestionReview ||
      needsPendingReorderReview ||
      needsCatalogClarificationReview ||
      needsPostSearchCatalogReview ||
      needsSensitiveContextReview ||
      needsVerifiedDiscoveryReview
    ) {
      priorPlanForReview = rawPlan;
      plannerRequestedClarification = false;
      plannerFallbackText = undefined;
      continue;
    }

    return {
      activeContextPolicy,
      fulfillmentLocationContext,
      menuCatalogContext,
      planningProfile,
      multiStepEnabled,
      toolCalls: deduplicateToolCalls(
        normalizeNewItemCartUpdates(state, [...plannedDiscoveryCalls, ...rawPlan.toolCalls]),
      ),
      catalogSuggestion: rawPlan.catalogSuggestion,
      catalogSelections: rawPlan.catalogSelections,
      savedAddressDecision: rawPlan.savedAddressDecision,
      responseClaims: [...responseClaims],
      plannerFallbackText,
      plannerRequestedClarification,
    };
  }

  return emptyPlan('deterministic');
}

function persistableArgumentPaths(value: unknown, prefix = ''): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return prefix ? [prefix] : [];
  return Object.entries(value).flatMap(([key, nested]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return nested && typeof nested === 'object' && !Array.isArray(nested)
      ? persistableArgumentPaths(nested, path)
      : [path];
  });
}
