import { getToolBoundary } from '../ordering/toolBoundaries.js';
import type { PaymentLinkMethod, PromotionValidationResult, ToolCallRequest, ToolCallResult, ToolTraceEntry } from '../ordering/types.js';
import type { ConversationStore } from '../persistence/memoryStore.js';
import {
  authorizeCustomerAccess,
  createUnverifiedCustomerAccessContext,
} from '../security/customerAccessContext.js';
import {
  type AgentTurnInput,
  type VerifiedStateSnapshot
} from './agentTurnState.js';
import {
  contextPolicyIsActive,
  contextPolicyRequiresConfirmation,
  type ContextPolicyDirective
} from './contextPolicy.js';
import type { AgentGraphState } from './state.js';
import {
  emitSessionUpdate,
  findPaymentEvidenceForLinkMethod,
  isRecord,
  paymentEvidenceDirectlyMatchesQuery,
  paymentEvidenceMentionedInText,
  paymentLinkMethodFromFixtureId,
  plannerPaymentMethod,
  pushEscalationReasons,
  verifiedStateSnapshotSourceType,
} from "./turnSupport.js";

export function repriceCartWithDeliveryFee(state: AgentGraphState, deliveryFeeVnd: number): void {
  if (!state.cart) return;
  state.cart = {
    ...state.cart,
    deliveryFeeVnd,
    totalVnd: Math.max(0, state.cart.subtotalVnd - state.cart.discountVnd + deliveryFeeVnd),
  };
}

export function applyVoucherToCart(state: AgentGraphState, validation: PromotionValidationResult): void {
  if (!state.cart || !validation.ok) return;
  state.cart = {
    ...state.cart,
    voucherCode: validation.publicCode,
    discountVnd: validation.discountVnd,
    totalVnd: Math.max(0, state.cart.subtotalVnd - validation.discountVnd + state.cart.deliveryFeeVnd),
  };
}

export function traceFromResult(result: ToolCallResult, args: Record<string, unknown>): ToolTraceEntry {
  return {
    toolName: result.toolName,
    arguments: args,
    ok: result.ok,
    resultSummary: result.ok ? result.message : (result.errorCode ?? result.message),
    provenance: result.provenance,
  };
}

export function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (!isRecord(value) || value instanceof Date) return value;

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalJsonValue(entry)]),
  );
}

export function stableToolCallKey(call: Pick<ToolTraceEntry, 'toolName' | 'arguments'>): string {
  return `${call.toolName}:${JSON.stringify(canonicalJsonValue(call.arguments))}`;
}

export function hasSuccessfulCurrentTurnToolCall(trace: ToolTraceEntry[], call: ToolCallRequest): boolean {
  const plannedKey = stableToolCallKey(call);
  return trace.some((entry) => entry.ok && stableToolCallKey(entry) === plannedKey);
}

export function normalizeNewItemCartUpdates(
  state: AgentGraphState,
  calls: ToolCallRequest[],
): ToolCallRequest[] {
  const existingItemCodes = new Set(state.cart?.items.map((item) => item.itemCode) ?? []);
  const mergedIndexes = new Map<string, number>();
  const normalized: ToolCallRequest[] = [];

  for (const call of calls) {
    const argumentKeys = Object.keys(call.arguments);
    const itemCode = call.arguments.itemCode;
    const quantity = call.arguments.quantity;
    const isDirectValidShape =
      call.toolName === 'updateCart' &&
      argumentKeys.every((key) => ['itemCode', 'quantity', 'modifiers'].includes(key)) &&
      typeof itemCode === 'string' &&
      itemCode.length > 0 &&
      typeof quantity === 'number' &&
      Number.isInteger(quantity) &&
      quantity > 0 &&
      !existingItemCodes.has(itemCode);

    if (!isDirectValidShape) {
      normalized.push(call);
      continue;
    }

    const modifierKey = JSON.stringify(canonicalJsonValue(call.arguments.modifiers ?? []));
    const mergeKey = `${itemCode}:${modifierKey}`;
    const existingIndex = mergedIndexes.get(mergeKey);
    if (existingIndex === undefined) {
      mergedIndexes.set(mergeKey, normalized.length);
      normalized.push(call);
      continue;
    }

    const existingCall = normalized[existingIndex]!;
    normalized[existingIndex] = {
      ...existingCall,
      arguments: {
        ...existingCall.arguments,
        quantity: (existingCall.arguments.quantity as number) + quantity,
      },
    };
  }

  return normalized;
}

export function deduplicateToolCalls(calls: ToolCallRequest[]): ToolCallRequest[] {
  const seen = new Set<string>();
  return calls.filter((call) => {
    const key = stableToolCallKey(call);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function shouldEmitToolCalledEvent(result: ToolCallResult): boolean {
  if (!result.ok) return false;
  return true;
}

export function hasCartChanged(previousCart: AgentGraphState['cart'], nextCart: AgentGraphState['cart']): boolean {
  if (!previousCart || !nextCart) return previousCart !== nextCart;

  const previousItems = previousCart.items.map((item) => `${item.itemCode}:${item.quantity}:${item.unitPriceVnd}`);
  const nextItems = nextCart.items.map((item) => `${item.itemCode}:${item.quantity}:${item.unitPriceVnd}`);

  return (
    previousCart.subtotalVnd !== nextCart.subtotalVnd ||
    previousCart.discountVnd !== nextCart.discountVnd ||
    previousCart.deliveryFeeVnd !== nextCart.deliveryFeeVnd ||
    previousCart.totalVnd !== nextCart.totalVnd ||
    previousCart.voucherCode !== nextCart.voucherCode ||
    previousItems.length !== nextItems.length ||
    previousItems.some((item, index) => item !== nextItems[index])
  );
}

export function invalidateDependentStateAfterCartMutation(state: AgentGraphState): void {
  state.fulfillment = undefined;
  state.orderPreview = undefined;
  state.order = undefined;
  state.paymentAttempt = undefined;
  state.selectedPaymentMethod = undefined;
  state.promotionContext = undefined;
  state.invoiceRequest = undefined;
}

export function extractVerifiedStateSnapshot(payload: Record<string, unknown>): Partial<VerifiedStateSnapshot> | undefined {
  if (!isRecord(payload.verifiedState)) return undefined;
  return payload.verifiedState as Partial<VerifiedStateSnapshot>;
}

export async function loadPriorVerifiedState(store: ConversationStore, sessionId: string): Promise<Partial<VerifiedStateSnapshot>> {
  const events = await store.listEvents(sessionId);
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.sourceType !== verifiedStateSnapshotSourceType) continue;
    return extractVerifiedStateSnapshot(event.payload) ?? {};
  }
  return {};
}

export async function hydrateRecentOrderContext(
  input: AgentTurnInput,
  priorVerifiedState: Partial<VerifiedStateSnapshot>,
  policy: ContextPolicyDirective,
): Promise<Partial<VerifiedStateSnapshot>> {
  const access = authorizeCustomerAccess(
    input.accessContext ?? createUnverifiedCustomerAccessContext(input),
    {
      channel: input.channel,
      sessionId: input.sessionId,
      customerId: input.customerId,
      scope: 'customer:read',
    },
  );
  if (!access.allowed) {
    return {
      ...priorVerifiedState,
      customerContext: undefined,
      pendingReorder: undefined,
    };
  }

  let customerContext = priorVerifiedState.customerContext;
  const needsCustomer =
    contextPolicyIsActive(policy, 'customer') ||
    contextPolicyIsActive(policy, 'fulfillment') ||
    contextPolicyIsActive(policy, 'membership') ||
    contextPolicyIsActive(policy, 'recentOrder');
  if (needsCustomer && (customerContext?.savedAddresses.length ?? 0) === 0) {
    const savedAddresses = await input.clients.customer.getSavedAddresses(input.customerId);
    if (savedAddresses.ok && savedAddresses.value) {
      customerContext = {
        savedAddresses: savedAddresses.value,
        recentOrders: customerContext?.recentOrders ?? [],
        favorites: customerContext?.favorites ?? [],
        loyaltyPoints: customerContext?.loyaltyPoints,
      };
    }
  }
  if (needsCustomer && (customerContext?.favorites.length ?? 0) === 0) {
    const favoriteItems = await input.clients.customer.getFavoriteItems(input.customerId);
    if (favoriteItems.ok && favoriteItems.value) {
      customerContext = {
        savedAddresses: customerContext?.savedAddresses ?? [],
        recentOrders: customerContext?.recentOrders ?? [],
        favorites: favoriteItems.value,
        loyaltyPoints: customerContext?.loyaltyPoints,
      };
    }
  }

  const needsRecentOrder =
    contextPolicyIsActive(policy, 'recentOrder') ||
    contextPolicyRequiresConfirmation(policy, 'recentOrder') ||
    contextPolicyIsActive(policy, 'order') ||
    contextPolicyIsActive(policy, 'payment');
  if (!needsRecentOrder || priorVerifiedState.order) {
    return { ...priorVerifiedState, customerContext };
  }

  const result = await input.clients.customer.getRecentOrder(input.customerId);
  if (!result.ok || !result.value) return { ...priorVerifiedState, customerContext };

  const recentOrder = result.value;
  const paymentStatus = recentOrder.paymentStatus === 'not_started' ? 'pending' : recentOrder.paymentStatus;
  customerContext = {
    savedAddresses: customerContext?.savedAddresses ?? [],
    recentOrders: [recentOrder, ...(customerContext?.recentOrders ?? [])],
    favorites: customerContext?.favorites ?? [],
    loyaltyPoints: customerContext?.loyaltyPoints,
  };
  const shouldHydrateActiveOrder =
    contextPolicyIsActive(policy, 'order') ||
    contextPolicyIsActive(policy, 'payment');
  if (!shouldHydrateActiveOrder) {
    return {
      ...priorVerifiedState,
      customerContext,
    };
  }

  return {
    ...priorVerifiedState,
    order: recentOrder,
    cart: priorVerifiedState.cart ?? recentOrder.cart,
    paymentAttempt: priorVerifiedState.paymentAttempt ?? {
      status: paymentStatus,
    },
    customerContext,
  };
}

export function buildVerifiedStateSnapshot(state: AgentGraphState): VerifiedStateSnapshot {
  return {
    cart: state.cart,
    address: state.address,
    addressDraft: state.addressDraft,
    orderPreview: state.orderPreview,
    order: state.order,
    pendingReorder: state.pendingReorder,
    comboConversionProposal: state.comboConversionProposal,
    pendingCatalogSuggestion: state.pendingCatalogSuggestion,
    cancellationStatusChecked: state.cancellationStatusChecked,
    fulfillment: state.fulfillment,
    promotionContext: state.promotionContext,
    contentEvidence: state.contentEvidence,
    menuSearchResults: state.menuSearchResults,
    menuModifierOptions: state.menuModifierOptions,
    customerContext: state.customerContext,
    paymentAttempt: state.paymentAttempt,
    selectedPaymentMethod: state.selectedPaymentMethod,
    paymentMethodEvidence: state.paymentMethodEvidence,
    invoiceRequest: state.invoiceRequest,
    handoff: state.handoff,
    toolTrace: state.toolTrace ?? [],
  };
}

export async function persistVerifiedStateSnapshot(store: ConversationStore, state: AgentGraphState): Promise<void> {
  await store.appendEvent(state.sessionId, verifiedStateSnapshotSourceType, {
    verifiedState: buildVerifiedStateSnapshot(state),
  });
}

export function applyToolResultToState(
  input: AgentTurnInput,
  state: AgentGraphState,
  result: ToolCallResult,
  args: Record<string, unknown>,
  currentTurnToolTrace: ToolTraceEntry[],
): void {
  const traceEntry = traceFromResult(result, args);
  state.toolTrace = [...(state.toolTrace ?? []), traceEntry];
  currentTurnToolTrace.push(traceEntry);

  if (shouldEmitToolCalledEvent(result)) {
    emitSessionUpdate(input, {
      updateType: 'tool_called',
      toolName: result.toolName,
      boundary: getToolBoundary(result.toolName),
      ok: result.ok,
      resultSummary: result.message,
      provenance: result.provenance,
    });
  }

  if (!result.ok) {
    pushEscalationReasons(state, ['tool_execution_failed']);
    return;
  }

  switch (result.toolName) {
    case 'updateCart':
    case 'previewCart':
      if (isRecord(result.value)) {
        const nextCart = result.value as unknown as AgentGraphState['cart'];
        if (result.toolName === 'updateCart' && hasCartChanged(state.cart, nextCart)) {
          invalidateDependentStateAfterCartMutation(state);
        }
        state.cart = nextCart;
      }
      if (result.toolName === 'updateCart' && state.pendingCatalogSuggestion) {
        const directItemCode = typeof args.itemCode === 'string' ? args.itemCode : undefined;
        const changedItemCodes = Array.isArray(args.changes)
          ? args.changes.flatMap((change) =>
            isRecord(change) && typeof change.itemCode === 'string' ? [change.itemCode] : [],
          )
          : [];
        if (
          directItemCode === state.pendingCatalogSuggestion.itemCode ||
          changedItemCodes.includes(state.pendingCatalogSuggestion.itemCode)
        ) {
          state.pendingCatalogSuggestion = undefined;
        }
      }
      return;
    case 'checkStoreAvailability':
      if (isRecord(result.value)) {
        const unavailableItemCodes = Object.entries(result.value)
          .filter(([, available]) => available === false)
          .map(([itemCode]) => itemCode);
        const activeCartItemCodes = new Set(state.cart?.items.map((item) => item.itemCode) ?? []);
        const unavailableCartItemCodes = unavailableItemCodes.filter((itemCode) => activeCartItemCodes.has(itemCode));
        if (unavailableCartItemCodes.length > 0) {
          state.fulfillment = undefined;
          state.orderPreview = undefined;
          state.userConfirmedOrder = false;
          repriceCartWithDeliveryFee(state, 0);
          state.entities = {
            ...(isRecord(state.entities) ? state.entities : {}),
            asksClarification: true,
            fulfillmentRisk: 'item_unavailable_before_confirmation',
            unavailableItemCodes: unavailableCartItemCodes,
          };
          pushEscalationReasons(state, ['item_unavailable_before_confirmation']);
        }
      }
      return;
    case 'quoteFulfillment':
      if (isRecord(result.value)) {
        state.fulfillment = result.value as unknown as AgentGraphState['fulfillment'];
        if (isRecord(args.address)) {
          state.address = args.address as unknown as AgentGraphState['address'];
          state.addressDraft = undefined;
        }
        if (state.fulfillment) {
          repriceCartWithDeliveryFee(state, state.fulfillment.feeVnd);
          emitSessionUpdate(input, {
            updateType: 'store_assigned',
            storeId: state.fulfillment.storeId,
            storeName: state.fulfillment.storeName,
          });
          emitSessionUpdate(input, {
            updateType: 'delivery_quote',
            feeVnd: state.fulfillment.feeVnd,
            etaMinutes: state.fulfillment.etaMinutes,
            method: state.fulfillment.method,
          });
          emitSessionUpdate(input, {
            updateType: 'fulfillment_quoted',
            storeId: state.fulfillment.storeId,
            storeName: state.fulfillment.storeName,
            feeVnd: state.fulfillment.feeVnd,
            etaMinutes: state.fulfillment.etaMinutes,
          });
        }
      }
      return;
    case 'searchPromotions':
      if (Array.isArray(result.value)) {
        state.promotionOffers = result.value as AgentGraphState['promotionOffers'];
        state.promotionContext = {
          matchedOfferIds: result.value.flatMap((entry) => (isRecord(entry) && typeof entry.offerId === 'string' ? [entry.offerId] : [])),
          validation: state.promotionContext?.validation,
          caveats: state.promotionContext?.caveats ?? [],
        };
      }
      emitSessionUpdate(input, { updateType: 'promotion_answered' });
      return;
    case 'searchMenu':
      if (Array.isArray(result.value)) {
        const nextResults = result.value as NonNullable<AgentGraphState['menuSearchResults']>;
        const isSpecificLookup = typeof args.query === 'string' && args.query.trim().length > 0;
        if (!isSpecificLookup) {
          state.menuSearchResults = nextResults;
          state.plannerMenuSearchResults = nextResults.slice(0, 24);
          return;
        }
        const mergeUnique = (items: NonNullable<AgentGraphState['menuSearchResults']>, limit?: number) => {
          const seenCodes = new Set<string>();
          const unique = items.filter((item) => {
            if (seenCodes.has(item.code)) return false;
            seenCodes.add(item.code);
            return true;
          });
          return limit === undefined ? unique : unique.slice(0, limit);
        };
        state.menuSearchResults = mergeUnique([
          ...nextResults,
          ...(state.menuSearchResults ?? []),
        ]);
        state.plannerMenuSearchResults = mergeUnique([
          ...nextResults.slice(0, 4),
          ...(state.plannerMenuSearchResults ?? state.menuSearchResults.slice(0, 4)),
        ], 24);
      }
      return;
    case 'getItemDetails':
      if (isRecord(result.value)) {
        state.menuItemDetail = result.value as unknown as AgentGraphState['menuItemDetail'];
      }
      return;
    case 'getModifierOptions':
      if (isRecord(result.value)) {
        state.menuModifierOptions = result.value as AgentGraphState['menuModifierOptions'];
      }
      return;
    case 'explainPromotion':
      if (isRecord(result.value) && typeof result.value.offerId === 'string') {
        state.promotionOffers = [result.value as unknown as NonNullable<AgentGraphState['promotionOffers']>[number]];
        state.promotionContext = {
          matchedOfferIds: [...new Set([...(state.promotionContext?.matchedOfferIds ?? []), result.value.offerId])],
          validation: state.promotionContext?.validation,
          caveats: state.promotionContext?.caveats ?? [],
        };
      }
      return;
    case 'validateVoucher':
      if (isRecord(result.value)) {
        const validation = result.value as unknown as PromotionValidationResult;
        state.promotionContext = {
          matchedOfferIds: state.promotionContext?.matchedOfferIds ?? [],
          validation,
          caveats: validation.ok ? [] : ['Public crawl did not expose a reusable public promo code.'],
        };
        applyVoucherToCart(state, validation);
      }
      return;
    case 'searchContentPolicy':
    case 'answerAllergenQuestion':
      const evidence =
        Array.isArray(result.value) && result.value.length > 0 ? (result.value as AgentGraphState['contentEvidence']) : undefined;
      if (evidence) {
        state.contentEvidence = result.value as AgentGraphState['contentEvidence'];
      }
      if (result.toolName === 'answerAllergenQuestion' && evidence) {
        emitSessionUpdate(input, {
          updateType: 'content_evidence_found',
          kind: 'allergen',
        });
      }
      return;
    case 'listPaymentMethods':
      if (Array.isArray(result.value)) {
        state.paymentMethodEvidence = result.value as AgentGraphState['paymentMethodEvidence'];
        const requestedMethod = plannerPaymentMethod(state);
        if (requestedMethod) {
          state.selectedPaymentMethod =
            findPaymentEvidenceForLinkMethod(state.paymentMethodEvidence, requestedMethod)?.supported === true
              ? requestedMethod
              : undefined;
        } else {
          const paymentQuery = typeof args.query === 'string' && args.query.trim().length > 0
            ? args.query
            : input.text;
          const directMatches = state.paymentMethodEvidence?.filter((evidence) =>
            paymentEvidenceDirectlyMatchesQuery(evidence, paymentQuery) ||
            paymentEvidenceMentionedInText(evidence, paymentQuery),
          ) ?? [];
          state.selectedPaymentMethod = directMatches.length === 1 && directMatches[0]?.supported === true
            ? paymentLinkMethodFromFixtureId(directMatches[0].methodId)
            : undefined;
        }
      }
      return;
    case 'previewOrder':
      if (isRecord(result.value)) {
        state.orderPreview = result.value as unknown as AgentGraphState['orderPreview'];
      }
      return;
    case 'placeOrder':
      if (isRecord(result.value)) {
        state.order = result.value as unknown as AgentGraphState['order'];
      }
      return;
    case 'getOrderStatus':
      if (isRecord(result.value)) {
        state.order = result.value as unknown as AgentGraphState['order'];
      }
      return;
    case 'createPaymentLink':
      if (isRecord(result.value) && typeof args.method === 'string') {
        state.paymentAttempt = {
          method: args.method as PaymentLinkMethod,
          status: typeof result.value.status === 'string' ? (result.value.status as 'pending' | 'paid' | 'failed') : 'pending',
          paymentUrl: typeof result.value.url === 'string' ? result.value.url : undefined,
        };
      }
      return;
    case 'checkPaymentStatus':
      if (isRecord(result.value) && typeof result.value.status === 'string') {
        state.paymentAttempt = {
          method: state.paymentAttempt?.method,
          status: result.value.status as 'pending' | 'paid' | 'failed',
          paymentUrl: state.paymentAttempt?.paymentUrl,
        };
      }
      return;
    case 'getMembershipProfile':
      if (isRecord(result.value) && typeof result.value.points === 'number') {
        state.customerContext = {
          savedAddresses: state.customerContext?.savedAddresses ?? [],
          recentOrders: state.customerContext?.recentOrders ?? [],
          favorites: state.customerContext?.favorites ?? [],
          loyaltyPoints: result.value.points,
        };
      }
      return;
    case 'listMembershipRewards':
    case 'listMembershipWallet':
    case 'getMembershipPointHistory':
    case 'listMembershipTools':
    case 'acquireVoucher':
    case 'redeemReward':
      return;
    case 'collectInvoice':
      if (isRecord(result.value)) {
        state.invoiceRequest = result.value as unknown as AgentGraphState['invoiceRequest'];
        emitSessionUpdate(input, {
          updateType: 'invoice_requested',
          ...result.value,
        });
      }
      return;
    case 'handoff':
      if (isRecord(result.value) && typeof result.value.escalationId === 'string') {
        state.handoff = {
          escalationId: result.value.escalationId,
          reasons: Array.isArray(args.reasons) ? args.reasons.filter((reason): reason is string => typeof reason === 'string') : [],
        };
      }
      return;
  }
}
