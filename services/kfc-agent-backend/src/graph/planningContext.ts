import { toolNames } from '../ordering/toolCatalog.js';
import type { ToolName } from '../ordering/types.js';
import type { LoadedAgentTurnContext, PlanningProfile } from './agentTurnState.js';
import { contextPolicyIsActive, mergeContextPolicies, type ContextPolicyDirective } from './contextPolicy.js';

export const maxMenuPlanningCandidates = 6;
export const maxFulfillmentPlanningCandidates = 4;
export const catalogOrderingPlanningToolNames = [
  'searchMenu',
  'getItemDetails',
  'getModifierOptions',
  'updateCart',
  'previewCart',
  'recommendAddOns',
  'findStores',
  'checkStoreAvailability',
  'quoteFulfillment',
  'searchPromotions',
  'explainPromotion',
  'validateVoucher',
  'getMembershipProfile',
  'listMembershipRewards',
  'listMembershipWallet',
  'getMembershipPointHistory',
  'listPaymentMethods',
  'searchContentPolicy',
  'answerAllergenQuestion',
  'handoff',
] satisfies ToolName[];
export const activeCheckoutPlanningToolNames = [
  'searchMenu',
  'getItemDetails',
  'getModifierOptions',
  'updateCart',
  'previewCart',
  'recommendAddOns',
  'findStores',
  'checkStoreAvailability',
  'quoteFulfillment',
  'searchPromotions',
  'explainPromotion',
  'validateVoucher',
  'listPaymentMethods',
  'searchContentPolicy',
  'answerAllergenQuestion',
  'previewOrder',
  'placeOrder',
  'createPaymentLink',
  'collectInvoice',
  'handoff',
] satisfies ToolName[];

export async function loadPlanningContexts(
  context: LoadedAgentTurnContext,
  activeContextPolicy: ContextPolicyDirective,
) {
  const { input, state } = context;
  let resolvedContextPolicy = activeContextPolicy;
  const activeItemCodes = state.order ? [] : state.cart?.items.map((item) => item.itemCode) ?? [];
  const customerEvidenceItems = state.order
    ? []
    : [
      ...(state.customerContext?.favorites.map((item) => ({ itemCode: item.code, source: 'favorite' as const })) ?? []),
      ...(contextPolicyIsActive(resolvedContextPolicy, 'recentOrder') && !state.cart
        ? state.customerContext?.recentOrders.flatMap((order) => order.cart.items.map((item) => ({
          itemCode: item.itemCode,
          source: 'recent_order' as const,
        }))) ?? []
        : []),
    ];
  const fulfillmentPlanningResult = await input.clients.fulfillment.getPlanningContext({
    query: state.latestUserMessage,
    knownDistrict: state.addressDraft?.district,
    knownCity: state.addressDraft?.city,
    method: 'delivery',
    maxCandidates: maxFulfillmentPlanningCandidates,
  });
  const fulfillmentLocationContext = fulfillmentPlanningResult.ok
    ? fulfillmentPlanningResult.value
    : undefined;
  const uniqueLocation = fulfillmentLocationContext?.candidates.length === 1
    ? fulfillmentLocationContext.candidates[0]
    : undefined;
  const menuPlanningResult = await input.clients.menu.getPlanningContext({
    query: state.latestUserMessage,
    activeItemCodes,
    activeItemQuantities: Object.fromEntries((state.cart?.items ?? []).map((item) => [item.itemCode, item.quantity])),
    customerEvidenceItems,
    maxCandidates: maxMenuPlanningCandidates,
    ...(uniqueLocation
      ? { fulfillment: { storeId: uniqueLocation.storeId, disposition: uniqueLocation.method } }
      : {}),
  });
  let menuCatalogContext = menuPlanningResult.ok ? menuPlanningResult.value : undefined;
  const hasCurrentCatalogCandidates = menuCatalogContext?.candidates.some(
    (candidate) => candidate.activeCartItem !== true,
  ) === true;
  const planningProfile: PlanningProfile = hasCurrentCatalogCandidates
    ? 'catalog_ordering'
    : state.cart && !state.order
      ? 'active_checkout'
      : 'full';
  const availableTools = planningProfile === 'active_checkout'
    ? activeCheckoutPlanningToolNames
    : planningProfile === 'catalog_ordering'
      ? catalogOrderingPlanningToolNames
      : toolNames;
  state.plannerMenuCatalogContext = menuCatalogContext;

  if (menuCatalogContext?.candidates.length) {
    await input.store.appendEvent(input.sessionId, 'menu:planning_context_loaded', {
      query: menuCatalogContext.query,
      candidateCodes: menuCatalogContext.candidates.map((candidate) => candidate.code),
    });
  } else if (!menuPlanningResult.ok) {
    await input.store.appendEvent(input.sessionId, 'menu:planning_context_failed', {
      errorCode: menuPlanningResult.errorCode ?? 'menu_planning_context_unavailable',
      message: menuPlanningResult.message,
    });
  }
  if (fulfillmentLocationContext?.candidates.length) {
    await input.store.appendEvent(input.sessionId, 'fulfillment:planning_context_loaded', {
      serviceAreaIds: fulfillmentLocationContext.candidates.map((candidate) => candidate.serviceAreaId),
      candidateCount: fulfillmentLocationContext.candidates.length,
    });
  } else if (!fulfillmentPlanningResult.ok) {
    await input.store.appendEvent(input.sessionId, 'fulfillment:planning_context_failed', {
      errorCode: fulfillmentPlanningResult.errorCode ?? 'fulfillment_planning_context_unavailable',
      message: fulfillmentPlanningResult.message,
    });
  }
  if (state.cart && !state.order && fulfillmentLocationContext?.candidates.length === 1) {
    resolvedContextPolicy = mergeContextPolicies(resolvedContextPolicy, { cart: 'active', fulfillment: 'active' });
  }

  return {
    activeContextPolicy: resolvedContextPolicy,
    menuCatalogContext,
    fulfillmentLocationContext,
    planningProfile,
    availableTools,
    activeItemCodes,
    customerEvidenceItems,
    uniqueLocation,
    hasCurrentCatalogCandidates,
  };
}
