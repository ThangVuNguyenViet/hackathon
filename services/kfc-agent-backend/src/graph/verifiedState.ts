import { getToolBoundary } from '../ordering/toolBoundaries.js';
import {
  isPrivateResponseEvidenceTool,
} from '../agent/responseEvidenceContracts.js';
import {
  resolvedFulfillmentAddressSchema,
  toolArgumentSchemas,
} from '../ordering/toolCatalog.js';
import type {
  AgentToolCallResult,
  CollectionToolName,
  MembershipActionResult,
  PromotionValidationResult,
  ToolCallResult,
  ToolName,
  ToolTraceEntry,
  VerifiedCollectionSnapshot,
} from '../ordering/types.js';
import { replaceVerifiedCollection } from '../ordering/verifiedCollections.js';
import {
  selectedPaymentMethodAuthorityMatchesActiveCollection,
} from '../ordering/paymentMethodAuthority.js';
import { paymentAttemptForVerifiedOrder } from '../ordering/paymentOrderAuthority.js';
import type { MenuItem } from '../domain/types.js';
import {
  orderWithoutDeliveryEstimate,
} from '../domain/orderStatusEvidence.js';
import type { ExternalCallContext } from '../clients/interfaces.js';
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
import { applySuccessfulOrderPaymentResult } from './paymentVerifiedState.js';
import {
  emitSessionUpdate,
  isRecord,
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
    resultSummary: privacySafeToolResultSummary(result, args),
    provenance: result.provenance,
  };
}

/**
 * Saved-address provider prose is untrusted private data. A provider may echo
 * the resolved address in its message, so observability receives a structural
 * outcome whenever the server-side audit arguments identify an opaque
 * saved-address quote. Explicit customer-authored address quotes retain their
 * ordinary provider summary.
 */
export function privacySafeToolResultSummary(
  result: ToolCallResult | AgentToolCallResult,
  traceArguments: Record<string, unknown>,
): string {
  if (
    result.toolName === 'quoteFulfillment' &&
    isRecord(traceArguments.savedAddressRef)
  ) {
    return result.ok
      ? 'fulfillment_quote_observed'
      : 'fulfillment_quote_failed';
  }
  return result.ok
    ? result.message
    : (result.errorCode ?? result.message);
}

function privateToolTraceSummary(
  trace: Pick<
    ToolTraceEntry,
    'toolName' | 'ok' | 'resultSummary' | 'publicationEvidenceAudit'
  >,
  membershipActionOutcome: Pick<
    MembershipActionResult,
    'status' | 'requiresUserConfirmation'
  > | undefined = undefined,
): string {
  switch (trace.toolName) {
    case 'getRecentOrder':
      return trace.ok
        ? 'recent_order_observed'
        : 'recent_order_lookup_failed';
    case 'getOrderStatus':
      return trace.ok
        ? 'order_status_observed'
        : 'order_status_lookup_failed';
    case 'checkPaymentStatus':
      return trace.ok
        ? 'payment_status_observed'
        : trace.resultSummary === 'payment_failed'
          ? 'payment_failed'
          : 'payment_status_check_failed';
    case 'acquireVoucher':
      if (!trace.ok) {
        return trace.resultSummary === 'confirmation_required'
          ? 'confirmation_required'
          : 'private_tool_failed';
      }
      return trace.resultSummary === 'voucher_acquired' ||
        (
          membershipActionOutcome?.status === 'completed' &&
        membershipActionOutcome.requiresUserConfirmation === false
        )
        ? 'voucher_acquired'
        : 'private_tool_observed';
    case 'redeemReward':
      if (!trace.ok) {
        return trace.resultSummary === 'confirmation_required'
          ? 'confirmation_required'
          : 'private_tool_failed';
      }
      return trace.resultSummary === 'reward_redeemed' ||
        (
          membershipActionOutcome?.status === 'completed' &&
        membershipActionOutcome.requiresUserConfirmation === false
        )
        ? 'reward_redeemed'
        : 'private_tool_observed';
    default:
      return trace.ok
        ? 'private_tool_observed'
        : 'private_tool_failed';
  }
}

/**
 * Projects private tool traces into their durable audit form. Raw arguments,
 * provider prose/error codes, and identifying provenance remain available
 * only at the execution/publication boundary, never in durable state.
 */
export function verifiedStateToolTraceForPersistence(
  trace: ToolTraceEntry,
  rawArgumentsDigest?: string,
  membershipActionOutcome?: Pick<
    MembershipActionResult,
    'status' | 'requiresUserConfirmation'
  >,
): ToolTraceEntry {
  if (
    trace.toolName === 'quoteFulfillment' &&
    isRecord(trace.arguments.savedAddressRef)
  ) {
    return {
      ...structuredClone(trace),
      resultSummary: trace.ok
        ? 'fulfillment_quote_observed'
        : 'fulfillment_quote_failed',
    };
  }
  if (
    trace.toolName === 'quoteFulfillment' &&
    isRecord(trace.arguments.address)
  ) {
    const argumentsDigest =
      rawArgumentsDigest ??
      trace.publicationEvidenceAudit?.argumentsDigest;
    const method =
      trace.arguments.method === 'pickup' ||
        trace.arguments.method === 'delivery'
        ? trace.arguments.method
        : undefined;
    return {
      ...structuredClone(trace),
      arguments: {
        explicitAddressInputRedacted: true,
        ...(argumentsDigest
          ? { explicitAddressInputDigest: argumentsDigest }
          : {}),
        ...(method ? { method } : {}),
      },
      resultSummary: trace.ok
        ? 'fulfillment_quote_observed'
        : 'fulfillment_quote_failed',
    };
  }
  if (!isPrivateResponseEvidenceTool(trace.toolName)) {
    return structuredClone(trace);
  }
  const existingDigest =
    typeof trace.arguments.privateArgumentsDigest === 'string'
      ? trace.arguments.privateArgumentsDigest
      : undefined;
  const argumentsDigest =
    rawArgumentsDigest ??
    existingDigest ??
    trace.publicationEvidenceAudit?.argumentsDigest;
  return {
    ...structuredClone(trace),
    arguments: argumentsDigest
      ? { privateArgumentsDigest: argumentsDigest }
      : { privateArgumentsRedacted: true },
    resultSummary: privateToolTraceSummary(
      trace,
      membershipActionOutcome,
    ),
    provenance: trace.provenance.map((source) => ({
      fixtureMode: source.fixtureMode,
      ...(source.serverPolicy
        ? { serverPolicy: structuredClone(source.serverPolicy) }
        : {}),
    })),
  };
}

export function shouldEmitToolCalledEvent(result: ToolCallResult): boolean {
  if (!result.ok) return false;
  return true;
}

export function toolCalledEventProjection(
  trace: ToolTraceEntry,
): Record<string, unknown> & { updateType: 'tool_called' } {
  const projected =
    verifiedStateToolTraceForPersistence(trace);
  return {
    updateType: 'tool_called',
    toolName: trace.toolName,
    boundary: getToolBoundary(trace.toolName),
    ok: trace.ok,
    resultSummary: projected.resultSummary,
    provenance: projected.provenance,
    ...(isPrivateResponseEvidenceTool(trace.toolName)
      ? { privateEvidenceTool: true }
      : {}),
  };
}

export function hasCartChanged(previousCart: AgentGraphState['cart'], nextCart: AgentGraphState['cart']): boolean {
  if (!previousCart || !nextCart) return previousCart !== nextCart;

  const itemFingerprint = (
    item: NonNullable<AgentGraphState['cart']>['items'][number],
  ): string => JSON.stringify({
    itemCode: item.itemCode,
    quantity: item.quantity,
    unitPriceVnd: item.unitPriceVnd,
    modifiers: (item.modifiers ?? [])
      .map((modifier) => ({
        groupId: modifier.groupId,
        modifierId: modifier.modifierId,
        quantity: modifier.quantity,
        priceDeltaVnd: modifier.priceDeltaVnd,
      }))
      .sort((left, right) =>
        `${left.groupId}:${left.modifierId}`.localeCompare(
          `${right.groupId}:${right.modifierId}`,
        )),
  });
  const previousItems = previousCart.items.map(itemFingerprint);
  const nextItems = nextCart.items.map(itemFingerprint);

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
  state.pendingSavedAddressRef = undefined;
  state.exactCartAvailabilityObservation = undefined;
  state.orderPreview = undefined;
  state.selectedPaymentMethod = undefined;
  state.promotionContext = undefined;
  state.invoiceRequest = undefined;
}

export function extractVerifiedStateSnapshot(payload: Record<string, unknown>): Partial<VerifiedStateSnapshot> | undefined {
  if (!isRecord(payload.verifiedState)) return undefined;
  const snapshot =
    payload.verifiedState as Partial<VerifiedStateSnapshot>;
  const order = snapshot.order;
  return {
    cart: snapshot.cart,
    address: snapshot.address,
    addressDraft: snapshot.addressDraft,
    orderPreview: snapshot.orderPreview,
    order,
    cancellationStatusChecked: snapshot.cancellationStatusChecked,
    selectedModifiers: snapshot.selectedModifiers,
    fulfillment: snapshot.fulfillment,
    exactCartAvailabilityObservation:
      snapshot.exactCartAvailabilityObservation,
    promotionContext: snapshot.promotionContext,
    promotionOffers: snapshot.promotionOffers,
    contentEvidence: snapshot.contentEvidence,
    menuSearchResults: snapshot.menuSearchResults,
    verifiedCollections: snapshot.verifiedCollections,
    activeCollectionKeys: snapshot.activeCollectionKeys,
    activeMenuCollection: snapshot.activeMenuCollection,
    commerceApprovalReceipts: snapshot.commerceApprovalReceipts,
    menuItemDetail: snapshot.menuItemDetail,
    menuModifierOptions: snapshot.menuModifierOptions,
    customerContext: customerContextWithoutSavedAddresses(
      snapshot.customerContext,
    ),
    pendingSavedAddressRef: snapshot.pendingSavedAddressRef,
    paymentAttempt: paymentAttemptForVerifiedOrder(
      snapshot.paymentAttempt,
      order,
    ),
    selectedPaymentMethod: snapshot.selectedPaymentMethod,
    paymentMethodEvidence: snapshot.paymentMethodEvidence,
    invoiceRequest: snapshot.invoiceRequest,
    handoff: snapshot.handoff,
    toolTrace: snapshot.toolTrace,
  };
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
  externalCallContext: ExternalCallContext,
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
    };
  }

  let customerContext = customerContextWithoutSavedAddresses(
    priorVerifiedState.customerContext,
  );
  const needsCustomer =
    contextPolicyIsActive(policy, 'customer') ||
    contextPolicyIsActive(policy, 'fulfillment') ||
    contextPolicyIsActive(policy, 'membership') ||
    contextPolicyIsActive(policy, 'recentOrder');
  if (needsCustomer && (customerContext?.favorites.length ?? 0) === 0) {
    const favoriteItems = await input.clients.customer.getFavoriteItems(
      input.customerId,
      externalCallContext,
    );
    if (favoriteItems.ok && favoriteItems.value) {
      customerContext = {
        savedAddresses: [],
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

  const result = await input.clients.customer.getRecentOrder(
    input.customerId,
    externalCallContext,
  );
  if (!result.ok || !result.value) return { ...priorVerifiedState, customerContext };

  const recentOrder = orderWithoutDeliveryEstimate(result.value);
  const paymentStatus = recentOrder.paymentStatus === 'not_started' ? 'pending' : recentOrder.paymentStatus;
  customerContext = {
    savedAddresses: [],
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
    paymentAttempt:
      paymentAttemptForVerifiedOrder(
        priorVerifiedState.paymentAttempt,
        recentOrder,
      ) ?? {
        orderId: recentOrder.id,
        status: paymentStatus,
      },
    customerContext,
  };
}

export function buildVerifiedStateSnapshot(state: AgentGraphState): VerifiedStateSnapshot {
  const latestSuccessfulQuote = [...(state.toolTrace ?? [])]
    .reverse()
    .find((trace) => trace.toolName === 'quoteFulfillment' && trace.ok);
  const quoteUsedSavedAddressRef = Boolean(
    latestSuccessfulQuote &&
    isRecord(latestSuccessfulQuote.arguments.savedAddressRef),
  );
  const fulfillment = (() => {
    if (!quoteUsedSavedAddressRef || !state.fulfillment) {
      return state.fulfillment;
    }
    const {
      resolvedAddress: _privateSavedAddress,
      ...checkpointSafeFulfillment
    } = state.fulfillment;
    return checkpointSafeFulfillment;
  })();
  return {
    cart: state.cart,
    // A saved-address quote may use raw provider data in memory for the
    // current response, but only its opaque ref may cross the durable
    // checkpoint boundary. Explicit provider-resolved addresses remain
    // persistable because their source was the customer's own model-visible
    // input rather than a private saved-address lookup.
    address: quoteUsedSavedAddressRef ? undefined : state.address,
    addressDraft: state.addressDraft,
    orderPreview: state.orderPreview,
    order: state.order,
    cancellationStatusChecked: state.cancellationStatusChecked,
    selectedModifiers: state.selectedModifiers,
    fulfillment,
    exactCartAvailabilityObservation:
      state.exactCartAvailabilityObservation,
    promotionContext: state.promotionContext,
    promotionOffers: state.promotionOffers,
    contentEvidence: state.contentEvidence,
    menuSearchResults: state.menuSearchResults,
    verifiedCollections: state.verifiedCollections,
    activeCollectionKeys: state.activeCollectionKeys,
    activeMenuCollection: state.activeMenuCollection,
    commerceApprovalReceipts: state.commerceApprovalReceipts,
    menuItemDetail: state.menuItemDetail,
    menuModifierOptions: state.menuModifierOptions,
    customerContext: customerContextWithoutSavedAddresses(
      state.customerContext,
    ),
    pendingSavedAddressRef: state.pendingSavedAddressRef,
    paymentAttempt: paymentAttemptForVerifiedOrder(
      state.paymentAttempt,
      state.order,
    ),
    selectedPaymentMethod: state.selectedPaymentMethod,
    paymentMethodEvidence: state.paymentMethodEvidence,
    invoiceRequest: state.invoiceRequest,
    handoff: state.handoff,
    toolTrace: (state.toolTrace ?? []).map((trace) =>
      verifiedStateToolTraceForPersistence(trace)),
  };
}

function customerContextWithoutSavedAddresses(
  customerContext: AgentGraphState['customerContext'],
): AgentGraphState['customerContext'] {
  return customerContext
    ? {
        ...customerContext,
        savedAddresses: [],
      }
    : undefined;
}

export async function persistVerifiedStateSnapshot(store: ConversationStore, state: AgentGraphState): Promise<void> {
  await store.appendEvent(state.sessionId, verifiedStateSnapshotSourceType, {
    verifiedState: buildVerifiedStateSnapshot(state),
  });
}

export function applyAgentCollectionToVerifiedState(
  state: AgentGraphState,
  result: AgentToolCallResult,
): void {
  if (!result.ok || !result.verifiedCollection) return;
  const toolName = result.toolName as CollectionToolName;
  state.verifiedCollections = replaceVerifiedCollection(
    state.verifiedCollections,
    toolName,
    result.verifiedCollection,
  );
  state.activeCollectionKeys = {
    ...(state.activeCollectionKeys ?? {}),
    [toolName]: result.verifiedCollection.key,
  };

  switch (result.toolName) {
    case 'searchMenu':
    case 'recommendAddOns': {
      const snapshot = result.verifiedCollection as VerifiedCollectionSnapshot<MenuItem>;
      state.activeMenuCollection = snapshot;
      state.menuSearchResults = snapshot.result.items;
      return;
    }
    case 'searchPromotions':
      state.promotionOffers = result.value.items;
      state.promotionContext = {
        matchedOfferIds: result.value.items.map((entry) => entry.offerId),
        validation: state.promotionContext?.validation,
        caveats: state.promotionContext?.caveats ?? [],
      };
      return;
    case 'listPaymentMethods':
      state.paymentMethodEvidence = result.value.items;
      if (
        state.selectedPaymentMethod &&
        !selectedPaymentMethodAuthorityMatchesActiveCollection(
          state,
          state.selectedPaymentMethod,
        )
      ) {
        state.selectedPaymentMethod = undefined;
      }
      return;
    case 'searchContentPolicy':
    case 'answerAllergenQuestion':
      state.contentEvidence = result.value.items.length > 0 ? result.value.items : undefined;
      return;
    case 'findStores':
    case 'listMembershipRewards':
    case 'listMembershipWallet':
    case 'listMembershipTools':
      return;
    default:
      return;
  }
}

function clearFailedFulfillmentQuote(state: AgentGraphState): void {
  state.fulfillment = undefined;
  state.address = undefined;
  state.orderPreview = undefined;
  state.exactCartAvailabilityObservation = undefined;
  state.userConfirmedOrder = false;
  repriceCartWithDeliveryFee(state, 0);
}

export function applyToolResultToState(
  input: AgentTurnInput,
  state: AgentGraphState,
  result: ToolCallResult,
  args: Record<string, unknown>,
  currentTurnToolTrace: ToolTraceEntry[],
  options: {
    emitEvents?: boolean;
    traceArguments?: Record<string, unknown>;
  } = {},
): void {
  const emitEvents = options.emitEvents ?? true;
  const traceEntry = traceFromResult(
    result,
    options.traceArguments ?? args,
  );
  state.toolTrace = [...(state.toolTrace ?? []), traceEntry];
  currentTurnToolTrace.push(traceEntry);

  if (emitEvents && shouldEmitToolCalledEvent(result)) {
    emitSessionUpdate(
      input,
      toolCalledEventProjection(traceEntry),
    );
  }

  if (!result.ok) {
    if (result.toolName === 'quoteFulfillment') {
      clearFailedFulfillmentQuote(state);
    }
    if (result.toolName === 'checkStoreAvailability') {
      state.exactCartAvailabilityObservation = undefined;
    }
    if (result.toolName === 'checkPaymentStatus') {
      state.paymentAttempt = paymentAttemptForVerifiedOrder(
        state.paymentAttempt,
        state.order,
      );
    }
    pushEscalationReasons(state, ['tool_execution_failed']);
    return;
  }
  if (applySuccessfulOrderPaymentResult(state, result, args)) return;

  switch (result.toolName) {
    case 'updateCart':
    case 'previewCart': {
      const nextCart = result.value;
      if (result.toolName === 'updateCart' && hasCartChanged(state.cart, nextCart)) {
        invalidateDependentStateAfterCartMutation(state);
      }
      state.cart = nextCart;
      return;
    }
    case 'checkStoreAvailability': {
      const checkedItemIds = Object.keys(result.value);
      const unavailableItemCodes = Object.entries(result.value)
        .filter(([, available]) => available === false)
        .map(([itemCode]) => itemCode);
      const availabilitySource = result.provenance[0];
      const matchesActiveFulfillment =
        state.fulfillment &&
        args.storeId === state.fulfillment.storeId &&
        args.disposition === state.fulfillment.disposition;
      if (!availabilitySource) {
        state.exactCartAvailabilityObservation = undefined;
        state.orderPreview = undefined;
        state.userConfirmedOrder = false;
        if (matchesActiveFulfillment) state.fulfillment = undefined;
        pushEscalationReasons(state, ['tool_execution_failed']);
        return;
      }
      state.exactCartAvailabilityObservation =
        result.verifiedAvailabilityObservation;
      if (
        matchesActiveFulfillment &&
        state.fulfillment
      ) {
        state.fulfillment = {
          ...state.fulfillment,
          availability: {
            ok: unavailableItemCodes.length === 0,
            checkedItemIds,
            unavailableItemIds: unavailableItemCodes,
            blockedTimeslotItemIds: [],
            source: availabilitySource,
          },
        };
      }
      const activeCartItemCodes = new Set(state.cart?.items.map((item) => item.itemCode) ?? []);
      const unavailableCartItemCodes = unavailableItemCodes.filter((itemCode) => activeCartItemCodes.has(itemCode));
      if (unavailableCartItemCodes.length > 0) {
        state.orderPreview = undefined;
        state.userConfirmedOrder = false;
        pushEscalationReasons(state, ['item_unavailable_before_confirmation']);
      }
      return;
    }
    case 'quoteFulfillment': {
      const resolvedAddress =
        resolvedFulfillmentAddressSchema.safeParse(
          result.value.resolvedAddress,
        );
      if (!resolvedAddress.success) {
        clearFailedFulfillmentQuote(state);
        pushEscalationReasons(state, ['tool_execution_failed']);
        return;
      }
      const priorAvailability = state.exactCartAvailabilityObservation;
      if (
        priorAvailability &&
        (
          priorAvailability.storeId !== result.value.storeId ||
          priorAvailability.disposition !== result.value.disposition
        )
      ) {
        state.exactCartAvailabilityObservation = undefined;
      }
      state.fulfillment = {
        ...result.value,
        resolvedAddress: resolvedAddress.data,
      };
      state.pendingSavedAddressRef = undefined;
      state.address = resolvedAddress.data;
      state.addressDraft = undefined;
      repriceCartWithDeliveryFee(state, state.fulfillment.feeVnd);
      if (emitEvents) emitSessionUpdate(input, {
        updateType: 'store_assigned',
        storeId: state.fulfillment.storeId,
        storeName: state.fulfillment.storeName,
      });
      if (emitEvents) emitSessionUpdate(input, {
        updateType: 'delivery_quote',
        feeVnd: state.fulfillment.feeVnd,
        etaMinutes: state.fulfillment.etaMinutes,
        method: state.fulfillment.method,
      });
      if (emitEvents) emitSessionUpdate(input, {
        updateType: 'fulfillment_quoted',
        storeId: state.fulfillment.storeId,
        storeName: state.fulfillment.storeName,
        feeVnd: state.fulfillment.feeVnd,
        etaMinutes: state.fulfillment.etaMinutes,
      });
      return;
    }
    case 'searchPromotions':
      state.promotionOffers = result.value;
      state.promotionContext = {
        matchedOfferIds: result.value.map((entry) => entry.offerId),
        validation: state.promotionContext?.validation,
        caveats: state.promotionContext?.caveats ?? [],
      };
      if (emitEvents) {
        emitSessionUpdate(input, { updateType: 'promotion_answered' });
      }
      return;
    case 'searchMenu': {
      state.menuSearchResults = result.value;
      return;
    }
    case 'getItemDetails':
      state.menuItemDetail = result.value;
      return;
    case 'getModifierOptions':
      state.menuModifierOptions = result.value;
      return;
    case 'explainPromotion':
      state.promotionOffers = [result.value];
      state.promotionContext = {
        matchedOfferIds: [...new Set([...(state.promotionContext?.matchedOfferIds ?? []), result.value.offerId])],
        validation: state.promotionContext?.validation,
        caveats: state.promotionContext?.caveats ?? [],
      };
      return;
    case 'validateVoucher': {
      const validation = result.value;
      state.promotionContext = {
        matchedOfferIds: state.promotionContext?.matchedOfferIds ?? [],
        validation,
        caveats: validation.ok ? [] : ['Public crawl did not expose a reusable public promo code.'],
      };
      applyVoucherToCart(state, validation);
      return;
    }
    case 'searchContentPolicy':
    case 'answerAllergenQuestion': {
      const evidence = result.value.length > 0 ? result.value : undefined;
      state.contentEvidence = evidence;
      if (
        emitEvents &&
        result.toolName === 'answerAllergenQuestion' &&
        evidence
      ) {
        emitSessionUpdate(input, {
          updateType: 'content_evidence_found',
          kind: 'allergen',
        });
      }
      return;
    }
    case 'listPaymentMethods': {
      state.paymentMethodEvidence = result.value;
      // This legacy result has no collection/provider revision binding and
      // therefore cannot preserve a prior customer selection.
      state.selectedPaymentMethod = undefined;
      return;
    }
    case 'getMembershipProfile':
      state.customerContext = {
        savedAddresses: [],
        recentOrders: state.customerContext?.recentOrders ?? [],
        favorites: state.customerContext?.favorites ?? [],
        loyaltyPoints: result.value.points,
      };
      return;
    case 'listMembershipRewards':
    case 'listMembershipWallet':
    case 'getMembershipPointHistory':
    case 'listMembershipTools':
    case 'acquireVoucher':
    case 'redeemReward':
    case 'recommendAddOns':
    case 'findStores':
      return;
    case 'getSavedAddresses':
    case 'getRecentOrder':
    case 'getFavoriteItems':
      // Private customer-context reads are model-visible only through their
      // current ToolMessage. Persist the trace/provenance, never the returned
      // address, historical order/cart, or favorites in active agent state.
      return;
    case 'collectInvoice':
      state.invoiceRequest = result.value;
      if (emitEvents) emitSessionUpdate(input, {
        updateType: 'invoice_requested',
      });
      return;
    case 'handoff': {
      const parsedArgs = toolArgumentSchemas.handoff.safeParse(args);
      if (parsedArgs.success) {
        state.handoff = {
          escalationId: result.value.escalationId,
          reasons: parsedArgs.data.reasons,
        };
      }
      return;
    }
    case 'resolveHandoff': {
      const parsedArgs =
        toolArgumentSchemas.resolveHandoff.safeParse(args);
      if (
        parsedArgs.success &&
        state.handoff?.escalationId === parsedArgs.data.escalationId &&
        result.value.escalationId === parsedArgs.data.escalationId &&
        result.value.status === 'resolved'
      ) {
        const escalationId = state.handoff.escalationId;
        state.handoff = undefined;
        if (emitEvents) {
          emitSessionUpdate(input, {
            updateType: 'handoff_resolved',
            escalationId,
          });
        }
      } else {
        pushEscalationReasons(state, ['tool_execution_failed']);
      }
      return;
    }
  }
}
