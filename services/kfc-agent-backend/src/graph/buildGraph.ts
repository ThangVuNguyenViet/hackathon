import type { ExternalClients } from "../clients/interfaces.js";
import type { DashboardEventBus } from "../dashboard/eventBus.js";
import type {
  Address,
  DashboardEvent,
  Channel,
  ConversationTurn,
  ConversationTurnMetadata,
  SessionUpdateType,
} from "../domain/types.js";
import { selectKfcGenUiAttachment } from "../genui/kfcGenUiSelector.js";
import type { KfcGenUiAttachment } from "../genui/kfcGenUi.js";
import type { ResponseComposer } from "../llm/responseComposer.js";
import type { ToolPlanner, ToolPlannerOutput } from "../llm/toolPlanner.js";
import {
  resolveMonitorSessionIntelligence,
  type MonitorSessionIntelligenceJudge,
} from "../monitor/sessionIntelligence.js";
import { executeToolCall } from "../ordering/toolExecutor.js";
import { toolNames } from "../ordering/toolCatalog.js";
import { getToolBoundary } from "../ordering/toolBoundaries.js";
import { applySafetyGates } from "../ordering/safetyGates.js";
import type {
  PaymentLinkMethod,
  PromotionValidationResult,
  ToolCallRequest,
  ToolCallResult,
  ToolTraceEntry,
} from "../ordering/types.js";
import type { ConversationStore } from "../persistence/memoryStore.js";
import { buildBoundedRecentTurns } from "../session/sessionContext.js";
import { buildContextPolicyState } from "./contextPolicy.js";
import type { AgentGraphState } from "./state.js";

export type ReplyIntent =
  | "ask_fulfillment_method"
  | "ask_clarification"
  | "order_created"
  | "human_review_required"
  | "payment_retry"
  | "general_reply";

export interface AgentTurnInput {
  sessionId: string;
  customerId: string;
  channel: Channel;
  text: string;
  clients: ExternalClients;
  store: ConversationStore;
  dashboard: DashboardEventBus;
  externalMessageId?: string | null;
  metadata?: ConversationTurnMetadata | null;
  responseComposer?: ResponseComposer;
  toolPlanner?: ToolPlanner;
  runGuard?: {
    isCurrent(): Promise<boolean>;
    recordIrreversibleBoundary?(
      toolName: ToolCallRequest["toolName"],
    ): Promise<void>;
  };
  monitorJudge?: MonitorSessionIntelligenceJudge;
}

export interface AgentTurnOutput {
  state: AgentGraphState;
  responseText: string;
  replyIntent: ReplyIntent;
  genUi?: KfcGenUiAttachment;
  assistantTurnId?: string;
  suppressed?: boolean;
}

function addressFromText(text: string): Address | undefined {
  const parts = text
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 3) return undefined;

  const city = parts.at(-1);
  const district = parts.at(-2);
  const lineParts = parts.slice(0, -2);
  if (!city || !district || lineParts.length === 0) return undefined;

  return {
    label: lineParts[0],
    line1: lineParts.join(", "),
    district,
    city,
  };
}

function shouldUseKnownAddressForFulfillment(state: AgentGraphState): boolean {
  return Boolean(
    state.cart &&
    state.cart.items.length > 0 &&
    state.address &&
    hasPlannerBooleanEntity(state, "useSavedAddress"),
  );
}

function cartItemCodes(state: AgentGraphState): string[] {
  return [...new Set(state.cart?.items.map((item) => item.itemCode) ?? [])];
}

const verifiedStateSnapshotSourceType = "graph:verified_state";

type VerifiedStateSnapshot = Pick<
  AgentGraphState,
  | "cart"
  | "address"
  | "orderPreview"
  | "order"
  | "fulfillment"
  | "promotionContext"
  | "contentEvidence"
  | "menuSearchResults"
  | "customerContext"
  | "paymentAttempt"
  | "paymentMethodEvidence"
  | "invoiceRequest"
  | "handoff"
  | "toolTrace"
>;

function emitDashboardEvent(
  input: AgentTurnInput,
  type: DashboardEvent["type"],
  payload: Record<string, unknown>,
): void {
  input.dashboard.emitEvent({
    id: `dash_${input.sessionId}_${type}_${Date.now()}_${crypto.randomUUID()}`,
    sessionId: input.sessionId,
    type,
    payload,
    createdAt: new Date().toISOString(),
  });
}

function toolExecutionContext(input: AgentTurnInput) {
  return input.runGuard ? { runGuard: input.runGuard } : undefined;
}

async function isRunStillCurrent(input: AgentTurnInput): Promise<boolean> {
  return input.runGuard ? input.runGuard.isCurrent() : true;
}

function emitSessionUpdate(
  input: AgentTurnInput,
  payload: Record<string, unknown> & { updateType: SessionUpdateType },
): void {
  emitDashboardEvent(input, "session_updated", payload);
}

function pushEscalationReasons(
  state: AgentGraphState,
  reasons: string[],
): void {
  const seen = new Set(state.escalationReasons);
  for (const reason of reasons) {
    if (seen.has(reason)) continue;
    seen.add(reason);
    state.escalationReasons.push(reason);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasPlannerBooleanEntity(state: AgentGraphState, key: string): boolean {
  return isRecord(state.entities) && state.entities[key] === true;
}

function plannerPaymentMethod(
  state: AgentGraphState,
): PaymentLinkMethod | undefined {
  const method = isRecord(state.entities)
    ? state.entities.paymentMethod
    : undefined;
  return method === "momo" ||
    method === "zalopay" ||
    method === "card" ||
    method === "cod"
    ? method
    : undefined;
}

function paymentMethodFixtureId(method: PaymentLinkMethod): string {
  switch (method) {
    case "cod":
      return "cash_on_delivery";
    case "card":
      return "visa_master_card";
    case "zalopay":
      return "zalopay_wallet";
    case "momo":
      return "momo_wallet";
  }
}

function linkMethodFromPaymentEvidence(
  evidence: AgentGraphState["paymentMethodEvidence"],
): PaymentLinkMethod | undefined {
  if (!evidence) return undefined;
  const supportedMethodIds = new Set(
    evidence.filter((entry) => entry.supported).map((entry) => entry.methodId),
  );
  if (supportedMethodIds.has("zalopay_wallet")) return "zalopay";
  if (supportedMethodIds.has("visa_master_card")) return "card";
  if (supportedMethodIds.has("cash_on_delivery")) return "cod";
  return evidence.length > 0 ? "zalopay" : undefined;
}

function findPaymentEvidenceForLinkMethod(
  evidence: AgentGraphState["paymentMethodEvidence"],
  method: PaymentLinkMethod,
): NonNullable<AgentGraphState["paymentMethodEvidence"]>[number] | undefined {
  return evidence?.find(
    (entry) => entry.methodId === paymentMethodFixtureId(method),
  );
}

function isConfirmOrderGenUiAction(
  metadata: ConversationTurnMetadata | null | undefined,
): boolean {
  const rawEvent = metadata?.rawEvent;
  if (!isRecord(rawEvent)) return false;
  const action = rawEvent.genUiAction;
  return isRecord(action) && action.actionId === "confirm_order";
}

function contextPolicyValue(
  metadata: ConversationTurnMetadata | null | undefined,
  key: string,
): unknown {
  const rawEvent = metadata?.rawEvent;
  if (!isRecord(rawEvent) || !isRecord(rawEvent.contextPolicy))
    return undefined;
  return rawEvent.contextPolicy[key];
}

function contextPolicyIsActive(
  metadata: ConversationTurnMetadata | null | undefined,
  key: string,
): boolean {
  const value = contextPolicyValue(metadata, key);
  return (
    value === true ||
    value === "active" ||
    value === "relevant" ||
    value === "resume"
  );
}

function contextPolicyRequiresConfirmation(
  metadata: ConversationTurnMetadata | null | undefined,
  key: string,
): boolean {
  return contextPolicyValue(metadata, key) === "confirm_before_use";
}

function genUiAddItemActionToToolCall(
  metadata: ConversationTurnMetadata | null | undefined,
): ToolCallRequest | undefined {
  const rawEvent = metadata?.rawEvent;
  if (!isRecord(rawEvent)) return undefined;
  const action = rawEvent.genUiAction;
  if (!isRecord(action) || action.actionId !== "add_item") return undefined;
  const payload = action.payload;
  if (!isRecord(payload) || typeof payload.itemCode !== "string")
    return undefined;
  const quantity =
    typeof payload.quantity === "number" && Number.isInteger(payload.quantity)
      ? payload.quantity
      : 1;
  if (quantity < 1) return undefined;
  return {
    toolName: "updateCart",
    arguments: {
      itemCode: payload.itemCode,
      quantity,
    },
  };
}

function repriceCartWithDeliveryFee(
  state: AgentGraphState,
  deliveryFeeVnd: number,
): void {
  if (!state.cart) return;
  state.cart = {
    ...state.cart,
    deliveryFeeVnd,
    totalVnd: Math.max(
      0,
      state.cart.subtotalVnd - state.cart.discountVnd + deliveryFeeVnd,
    ),
  };
}

function applyVoucherToCart(
  state: AgentGraphState,
  validation: PromotionValidationResult,
): void {
  if (!state.cart || !validation.ok) return;
  state.cart = {
    ...state.cart,
    voucherCode: validation.publicCode,
    discountVnd: validation.discountVnd,
    totalVnd: Math.max(
      0,
      state.cart.subtotalVnd -
        validation.discountVnd +
        state.cart.deliveryFeeVnd,
    ),
  };
}

function traceFromResult(
  result: ToolCallResult,
  args: Record<string, unknown>,
): ToolTraceEntry {
  return {
    toolName: result.toolName,
    arguments: args,
    ok: result.ok,
    resultSummary: result.ok
      ? result.message
      : (result.errorCode ?? result.message),
    provenance: result.provenance,
  };
}

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (!isRecord(value) || value instanceof Date) return value;

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalJsonValue(entry)]),
  );
}

function stableToolCallKey(
  call: Pick<ToolTraceEntry, "toolName" | "arguments">,
): string {
  return `${call.toolName}:${JSON.stringify(canonicalJsonValue(call.arguments))}`;
}

function hasSuccessfulCurrentTurnToolCall(
  trace: ToolTraceEntry[],
  call: ToolCallRequest,
): boolean {
  const plannedKey = stableToolCallKey(call);
  return trace.some(
    (entry) => entry.ok && stableToolCallKey(entry) === plannedKey,
  );
}

function shouldEmitToolCalledEvent(result: ToolCallResult): boolean {
  if (!result.ok) return false;
  return true;
}

function hasCartChanged(
  previousCart: AgentGraphState["cart"],
  nextCart: AgentGraphState["cart"],
): boolean {
  if (!previousCart || !nextCart) return previousCart !== nextCart;

  const previousItems = previousCart.items.map(
    (item) => `${item.itemCode}:${item.quantity}:${item.unitPriceVnd}`,
  );
  const nextItems = nextCart.items.map(
    (item) => `${item.itemCode}:${item.quantity}:${item.unitPriceVnd}`,
  );

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

function invalidateDependentStateAfterCartMutation(
  state: AgentGraphState,
): void {
  state.fulfillment = undefined;
  state.orderPreview = undefined;
  state.order = undefined;
  state.paymentAttempt = undefined;
  state.promotionContext = undefined;
  state.invoiceRequest = undefined;
}

function extractVerifiedStateSnapshot(
  payload: Record<string, unknown>,
): Partial<VerifiedStateSnapshot> | undefined {
  if (!isRecord(payload.verifiedState)) return undefined;
  return payload.verifiedState as Partial<VerifiedStateSnapshot>;
}

async function loadPriorVerifiedState(
  store: ConversationStore,
  sessionId: string,
): Promise<Partial<VerifiedStateSnapshot>> {
  const events = await store.listEvents(sessionId);
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.sourceType !== verifiedStateSnapshotSourceType) continue;
    return extractVerifiedStateSnapshot(event.payload) ?? {};
  }
  return {};
}

async function hydrateRecentOrderContext(
  input: AgentTurnInput,
  priorVerifiedState: Partial<VerifiedStateSnapshot>,
): Promise<Partial<VerifiedStateSnapshot>> {
  if (priorVerifiedState.order) return priorVerifiedState;

  const result = await input.clients.customer.getRecentOrder(input.customerId);
  if (!result.ok || !result.value) return priorVerifiedState;

  const recentOrder = result.value;
  return {
    ...priorVerifiedState,
    customerContext: {
      savedAddresses: priorVerifiedState.customerContext?.savedAddresses ?? [],
      recentOrders: [
        recentOrder,
        ...(priorVerifiedState.customerContext?.recentOrders ?? []),
      ],
      favorites: priorVerifiedState.customerContext?.favorites ?? [],
      loyaltyPoints: priorVerifiedState.customerContext?.loyaltyPoints,
    },
  };
}

function buildVerifiedStateSnapshot(
  state: AgentGraphState,
): VerifiedStateSnapshot {
  return {
    cart: state.cart,
    address: state.address,
    orderPreview: state.orderPreview,
    order: state.order,
    fulfillment: state.fulfillment,
    promotionContext: state.promotionContext,
    contentEvidence: state.contentEvidence,
    menuSearchResults: state.menuSearchResults,
    customerContext: state.customerContext,
    paymentAttempt: state.paymentAttempt,
    paymentMethodEvidence: state.paymentMethodEvidence,
    invoiceRequest: state.invoiceRequest,
    handoff: state.handoff,
    toolTrace: state.toolTrace ?? [],
  };
}

async function persistVerifiedStateSnapshot(
  store: ConversationStore,
  state: AgentGraphState,
): Promise<void> {
  await store.appendEvent(state.sessionId, verifiedStateSnapshotSourceType, {
    verifiedState: buildVerifiedStateSnapshot(state),
  });
}

function applyToolResultToState(
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
      updateType: "tool_called",
      toolName: result.toolName,
      boundary: getToolBoundary(result.toolName),
      ok: result.ok,
      resultSummary: result.message,
      provenance: result.provenance,
    });
  }

  if (!result.ok) {
    pushEscalationReasons(state, ["tool_execution_failed"]);
    return;
  }

  switch (result.toolName) {
    case "updateCart":
    case "previewCart":
      if (isRecord(result.value)) {
        const nextCart = result.value as unknown as AgentGraphState["cart"];
        if (
          result.toolName === "updateCart" &&
          hasCartChanged(state.cart, nextCart)
        ) {
          invalidateDependentStateAfterCartMutation(state);
        }
        state.cart = nextCart;
      }
      return;
    case "quoteFulfillment":
      if (isRecord(result.value)) {
        state.fulfillment =
          result.value as unknown as AgentGraphState["fulfillment"];
        if (isRecord(args.address)) {
          state.address = args.address as unknown as AgentGraphState["address"];
        }
        if (state.fulfillment) {
          repriceCartWithDeliveryFee(state, state.fulfillment.feeVnd);
          emitSessionUpdate(input, {
            updateType: "store_assigned",
            storeId: state.fulfillment.storeId,
            storeName: state.fulfillment.storeName,
          });
          emitSessionUpdate(input, {
            updateType: "delivery_quote",
            feeVnd: state.fulfillment.feeVnd,
            etaMinutes: state.fulfillment.etaMinutes,
            method: state.fulfillment.method,
          });
          emitSessionUpdate(input, {
            updateType: "fulfillment_quoted",
            storeId: state.fulfillment.storeId,
            storeName: state.fulfillment.storeName,
            feeVnd: state.fulfillment.feeVnd,
            etaMinutes: state.fulfillment.etaMinutes,
          });
        }
      }
      return;
    case "searchPromotions":
      if (Array.isArray(result.value)) {
        state.promotionContext = {
          matchedOfferIds: result.value.flatMap((entry) =>
            isRecord(entry) && typeof entry.offerId === "string"
              ? [entry.offerId]
              : [],
          ),
          validation: state.promotionContext?.validation,
          caveats: state.promotionContext?.caveats ?? [],
        };
      }
      emitSessionUpdate(input, { updateType: "promotion_answered" });
      return;
    case "searchMenu":
      if (Array.isArray(result.value)) {
        state.menuSearchResults =
          result.value as AgentGraphState["menuSearchResults"];
      }
      return;
    case "explainPromotion":
      if (isRecord(result.value) && typeof result.value.offerId === "string") {
        state.promotionContext = {
          matchedOfferIds: [
            ...new Set([
              ...(state.promotionContext?.matchedOfferIds ?? []),
              result.value.offerId,
            ]),
          ],
          validation: state.promotionContext?.validation,
          caveats: state.promotionContext?.caveats ?? [],
        };
      }
      return;
    case "validateVoucher":
      if (isRecord(result.value)) {
        const validation = result.value as unknown as PromotionValidationResult;
        state.promotionContext = {
          matchedOfferIds: state.promotionContext?.matchedOfferIds ?? [],
          validation,
          caveats: validation.ok
            ? []
            : ["Public crawl did not expose a reusable public promo code."],
        };
        applyVoucherToCart(state, validation);
      }
      return;
    case "searchContentPolicy":
    case "answerAllergenQuestion":
      const evidence =
        Array.isArray(result.value) && result.value.length > 0
          ? (result.value as AgentGraphState["contentEvidence"])
          : undefined;
      if (evidence) {
        state.contentEvidence =
          result.value as AgentGraphState["contentEvidence"];
      }
      if (result.toolName === "answerAllergenQuestion" && evidence) {
        emitSessionUpdate(input, {
          updateType: "content_evidence_found",
          kind: "allergen",
        });
      }
      return;
    case "listPaymentMethods":
      if (Array.isArray(result.value)) {
        state.paymentMethodEvidence =
          result.value as AgentGraphState["paymentMethodEvidence"];
        const requestedMethod = plannerPaymentMethod(state);
        const matchingMethod = requestedMethod
          ? findPaymentEvidenceForLinkMethod(
              state.paymentMethodEvidence,
              requestedMethod,
            )
          : undefined;
        if (
          requestedMethod &&
          matchingMethod?.supported &&
          !state.paymentAttempt?.paymentUrl
        ) {
          state.paymentAttempt = { method: requestedMethod, status: "pending" };
        }
      }
      return;
    case "previewOrder":
      if (isRecord(result.value)) {
        state.orderPreview =
          result.value as unknown as AgentGraphState["orderPreview"];
      }
      return;
    case "placeOrder":
      if (isRecord(result.value)) {
        state.order = result.value as unknown as AgentGraphState["order"];
      }
      return;
    case "getOrderStatus":
      if (isRecord(result.value)) {
        state.order = result.value as unknown as AgentGraphState["order"];
      }
      return;
    case "createPaymentLink":
      if (isRecord(result.value) && typeof args.method === "string") {
        state.paymentAttempt = {
          method: args.method as PaymentLinkMethod,
          status:
            typeof result.value.status === "string"
              ? (result.value.status as "pending" | "paid" | "failed")
              : "pending",
          paymentUrl:
            typeof result.value.url === "string" ? result.value.url : undefined,
        };
      }
      return;
    case "checkPaymentStatus":
      if (isRecord(result.value) && typeof result.value.status === "string") {
        state.paymentAttempt = {
          method: state.paymentAttempt?.method,
          status: result.value.status as "pending" | "paid" | "failed",
          paymentUrl: state.paymentAttempt?.paymentUrl,
        };
      }
      return;
    case "getMembershipProfile":
      if (isRecord(result.value) && typeof result.value.points === "number") {
        state.customerContext = {
          savedAddresses: state.customerContext?.savedAddresses ?? [],
          recentOrders: state.customerContext?.recentOrders ?? [],
          favorites: state.customerContext?.favorites ?? [],
          loyaltyPoints: result.value.points,
        };
      }
      return;
    case "listMembershipRewards":
    case "listMembershipWallet":
    case "getMembershipPointHistory":
    case "listMembershipTools":
    case "acquireVoucher":
    case "redeemReward":
      return;
    case "collectInvoice":
      if (isRecord(result.value)) {
        state.invoiceRequest =
          result.value as unknown as AgentGraphState["invoiceRequest"];
        emitSessionUpdate(input, {
          updateType: "invoice_requested",
          ...result.value,
        });
      }
      return;
    case "handoff":
      if (
        isRecord(result.value) &&
        typeof result.value.escalationId === "string"
      ) {
        state.handoff = {
          escalationId: result.value.escalationId,
          reasons: Array.isArray(args.reasons)
            ? args.reasons.filter(
                (reason): reason is string => typeof reason === "string",
              )
            : [],
        };
      }
      return;
  }
}

async function ensureCartForTool(
  input: AgentTurnInput,
  state: AgentGraphState,
  call: ToolCallRequest,
): Promise<boolean> {
  if (call.toolName !== "updateCart" || state.cart) return true;

  const cartResult = await input.clients.cart.createCart(input.sessionId);
  if (!cartResult.ok || !cartResult.value) {
    pushEscalationReasons(state, ["cart_initialization_failed"]);
    return false;
  }

  state.cart = cartResult.value;
  return true;
}

async function quoteFulfillmentFromVerifiedAddress(input: {
  turnInput: AgentTurnInput;
  state: AgentGraphState;
  currentTurnToolTrace: ToolTraceEntry[];
}): Promise<void> {
  if (
    !input.state.cart ||
    input.state.cart.items.length === 0 ||
    input.state.fulfillment
  )
    return;
  if (input.state.escalationReasons.includes("menu_item_verification_required"))
    return;

  const addressText =
    isRecord(input.state.entities) &&
    typeof input.state.entities.addressText === "string"
      ? input.state.entities.addressText
      : undefined;
  const address =
    (addressText ? addressFromText(addressText) : undefined) ??
    (shouldUseKnownAddressForFulfillment(input.state)
      ? input.state.address
      : undefined);
  const itemCodes = cartItemCodes(input.state);
  if (!address || itemCodes.length === 0) return;

  const call: ToolCallRequest = {
    toolName: "quoteFulfillment",
    arguments: {
      address,
      method: "delivery",
      itemCodes,
    },
  };
  const gating = applySafetyGates(input.state, [call]);
  pushEscalationReasons(input.state, gating.blockedReasons);
  if (gating.allowedCalls.length === 0) return;

  const result = await executeToolCall(
    input.turnInput.clients,
    input.state,
    call,
    toolExecutionContext(input.turnInput),
  );
  applyToolResultToState(
    input.turnInput,
    input.state,
    result,
    call.arguments,
    input.currentTurnToolTrace,
  );
}

async function placeConfirmedOrderFromVerifiedState(input: {
  turnInput: AgentTurnInput;
  state: AgentGraphState;
  currentTurnToolTrace: ToolTraceEntry[];
}): Promise<void> {
  if (!input.state.userConfirmedOrder || input.state.order) return;
  if (input.state.escalationReasons.includes("menu_item_verification_required"))
    return;

  const placeCall: ToolCallRequest = { toolName: "placeOrder", arguments: {} };
  const gating = applySafetyGates(input.state, [placeCall]);
  pushEscalationReasons(input.state, gating.blockedReasons);
  if (gating.allowedCalls.length === 0) return;

  if (!input.state.orderPreview) {
    const previewCall: ToolCallRequest = {
      toolName: "previewOrder",
      arguments: {},
    };
    const previewResult = await executeToolCall(
      input.turnInput.clients,
      input.state,
      previewCall,
      toolExecutionContext(input.turnInput),
    );
    applyToolResultToState(
      input.turnInput,
      input.state,
      previewResult,
      previewCall.arguments,
      input.currentTurnToolTrace,
    );
    if (!previewResult.ok) return;
  }

  const result = await executeToolCall(
    input.turnInput.clients,
    input.state,
    placeCall,
    toolExecutionContext(input.turnInput),
  );
  applyToolResultToState(
    input.turnInput,
    input.state,
    result,
    placeCall.arguments,
    input.currentTurnToolTrace,
  );
}

async function addConfirmedPreviousOrderToCart(input: {
  turnInput: AgentTurnInput;
  state: AgentGraphState;
  currentTurnToolTrace: ToolTraceEntry[];
}): Promise<void> {
  if (!contextPolicyIsActive(input.turnInput.metadata, "recentOrder")) return;
  if (hasSuccessfulToolResult(input.currentTurnToolTrace, ["updateCart"]))
    return;
  if (input.state.cart && input.state.cart.items.length > 0) return;

  const recentOrder = input.state.customerContext?.recentOrders[0];
  if (!recentOrder || recentOrder.cart.items.length === 0) return;

  input.state.entities = {
    ...(isRecord(input.state.entities) ? input.state.entities : {}),
    reorderConfirmed: true,
  };

  for (const item of recentOrder.cart.items) {
    const call: ToolCallRequest = {
      toolName: "updateCart",
      arguments: { itemCode: item.itemCode, quantity: item.quantity },
    };
    if (hasSuccessfulCurrentTurnToolCall(input.currentTurnToolTrace, call))
      continue;

    const gating = applySafetyGates(input.state, [call]);
    pushEscalationReasons(input.state, gating.blockedReasons);
    if (gating.allowedCalls.length === 0) continue;

    const ready = await ensureCartForTool(input.turnInput, input.state, call);
    if (!ready) continue;

    const result = await executeToolCall(
      input.turnInput.clients,
      input.state,
      call,
      toolExecutionContext(input.turnInput),
    );
    applyToolResultToState(
      input.turnInput,
      input.state,
      result,
      call.arguments,
      input.currentTurnToolTrace,
    );
  }
}

function hasSuccessfulToolResult(
  entries: ToolTraceEntry[],
  toolNames: ToolTraceEntry["toolName"][],
): boolean {
  return entries.some(
    (entry) => entry.ok && toolNames.includes(entry.toolName),
  );
}

function shouldPreserveCurrentMenuSearchResults(
  entries: ToolTraceEntry[],
): boolean {
  return hasSuccessfulToolResult(entries, ["searchMenu"]);
}

function shouldPreserveCurrentCartOrderPaymentContext(
  entries: ToolTraceEntry[],
): boolean {
  return hasSuccessfulToolResult(entries, [
    "updateCart",
    "previewCart",
    "quoteFulfillment",
    "validateVoucher",
    "recommendAddOns",
    "getModifierOptions",
    "previewOrder",
    "placeOrder",
    "createPaymentLink",
  ]);
}

function shouldPreserveCurrentPaymentContext(
  entries: ToolTraceEntry[],
): boolean {
  return hasSuccessfulToolResult(entries, [
    "listPaymentMethods",
    "createPaymentLink",
    "checkPaymentStatus",
  ]);
}

function shouldPreserveCurrentHandoff(entries: ToolTraceEntry[]): boolean {
  return hasSuccessfulToolResult(entries, ["handoff"]);
}

function clearRecoverableFulfillmentArgumentFailure(
  state: AgentGraphState,
  entries: ToolTraceEntry[],
): void {
  if (!state.cart || state.fulfillment) return;
  if (!hasSuccessfulToolResult(entries, ["updateCart"])) return;
  const failedEntries = entries.filter((entry) => !entry.ok);
  const onlyIncompleteFulfillmentQuoteFailed = failedEntries.every(
    (entry) =>
      entry.toolName === "quoteFulfillment" &&
      entry.resultSummary === "invalid_tool_arguments",
  );
  if (!onlyIncompleteFulfillmentQuoteFailed) return;
  state.escalationReasons = state.escalationReasons.filter(
    (reason) => reason !== "tool_execution_failed",
  );
}

function rememberPlannerPaymentMethod(
  state: AgentGraphState,
  checksPaymentMethodSupport = false,
): void {
  if (checksPaymentMethodSupport) return;
  const method = plannerPaymentMethod(state);
  if (!method || state.paymentAttempt?.paymentUrl) return;
  state.paymentAttempt = { method, status: "pending" };
}

async function createPaymentLinkAfterOrderFromRememberedMethod(input: {
  turnInput: AgentTurnInput;
  state: AgentGraphState;
  currentTurnToolTrace: ToolTraceEntry[];
}): Promise<void> {
  if (!input.state.order || input.state.order.status !== "created") return;
  const method =
    input.state.paymentAttempt?.method ??
    linkMethodFromPaymentEvidence(input.state.paymentMethodEvidence);
  if (!method || input.state.paymentAttempt?.paymentUrl) return;

  const call: ToolCallRequest = {
    toolName: "createPaymentLink",
    arguments: { method },
  };
  const result = await executeToolCall(
    input.turnInput.clients,
    input.state,
    call,
    toolExecutionContext(input.turnInput),
  );
  applyToolResultToState(
    input.turnInput,
    input.state,
    result,
    call.arguments,
    input.currentTurnToolTrace,
  );
}

function emitDerivedEvents(
  input: AgentTurnInput,
  state: AgentGraphState,
  turnToolTrace: ToolTraceEntry[],
): void {
  if (
    state.cart &&
    hasSuccessfulToolResult(turnToolTrace, ["updateCart", "previewCart"])
  ) {
    emitDashboardEvent(input, "cart_changed", { cart: state.cart });
  }

  if (
    state.promotionContext?.validation?.ok &&
    hasSuccessfulToolResult(turnToolTrace, ["validateVoucher"])
  ) {
    emitDashboardEvent(input, "voucher_applied", {
      validation: state.promotionContext.validation,
    });
  }

  if (
    state.promotionContext?.validation &&
    !state.promotionContext.validation.ok &&
    hasSuccessfulToolResult(turnToolTrace, ["validateVoucher"])
  ) {
    emitDashboardEvent(input, "voucher_rejected", {
      validation: state.promotionContext.validation,
    });
  }

  if (
    state.orderPreview &&
    hasSuccessfulToolResult(turnToolTrace, ["previewOrder"])
  ) {
    emitDashboardEvent(input, "order_previewed", { order: state.orderPreview });
  }

  if (state.order && hasSuccessfulToolResult(turnToolTrace, ["placeOrder"])) {
    emitDashboardEvent(input, "order_created", { order: state.order });
  }

  if (
    state.paymentAttempt?.paymentUrl &&
    state.paymentAttempt.method &&
    hasSuccessfulToolResult(turnToolTrace, ["createPaymentLink"])
  ) {
    emitDashboardEvent(input, "payment_link_created", {
      method: state.paymentAttempt.method,
      status: state.paymentAttempt.status,
      url: state.paymentAttempt.paymentUrl,
    });
  }

  if (
    state.paymentAttempt?.status === "failed" &&
    hasSuccessfulToolResult(turnToolTrace, ["checkPaymentStatus"])
  ) {
    emitDashboardEvent(input, "payment_failed", {
      status: state.paymentAttempt.status,
    });
  }

  if (
    state.paymentAttempt?.status === "paid" &&
    hasSuccessfulToolResult(turnToolTrace, ["checkPaymentStatus"])
  ) {
    emitDashboardEvent(input, "payment_paid", {
      status: state.paymentAttempt.status,
    });
  }

  if (state.handoff && hasSuccessfulToolResult(turnToolTrace, ["handoff"])) {
    emitDashboardEvent(input, "handoff_required", {
      escalationId: state.handoff.escalationId,
      reasons: state.handoff.reasons,
    });
  }
}

async function emitSessionIntelligence(
  input: AgentTurnInput,
  state: AgentGraphState,
): Promise<void> {
  const sessionIntelligence = await resolveMonitorSessionIntelligence({
    state,
    dashboardEvents: input.dashboard.getEvents(input.sessionId),
    judge: input.monitorJudge,
  });
  emitDashboardEvent(input, "session_intelligence_updated", {
    sessionIntelligence,
  });
}

const safeFallbackPriority = [
  "order_confirmation_required",
  "valid_fulfillment_required",
  "payment_tool_success_required",
  "promotion_evidence_required",
  "allergen_certainty_not_allowed",
  "tool_execution_failed",
  "cart_initialization_failed",
  "menu_item_verification_required",
  "cart_mutation_confirmation_required",
  "previous_order_confirmation_required",
] as const;

function paymentMethodFallbackText(state: AgentGraphState): string {
  const methods = state.paymentMethodEvidence ?? [];
  const supported = methods.filter((method) => method.supported);
  const requestedMethod = plannerPaymentMethod(state);
  const requestedEvidence = requestedMethod
    ? findPaymentEvidenceForLinkMethod(methods, requestedMethod)
    : undefined;
  const supportedNames = supported
    .map((method) => method.displayName)
    .join(", ");

  if (requestedEvidence && !requestedEvidence.supported) {
    const suffix = supportedNames
      ? ` Các phương thức đang được liệt kê gồm: ${supportedNames}.`
      : "";
    return `Theo chính sách thanh toán công khai của KFC, ${requestedEvidence.displayName} không được liệt kê cho checkout website/app.${suffix}`;
  }

  if (requestedEvidence?.supported) {
    return `Theo chính sách thanh toán công khai của KFC, ${requestedEvidence.displayName} được liệt kê cho checkout website/app. Mình sẽ tạo thanh toán sau khi bạn xác nhận đơn.`;
  }

  return supportedNames
    ? `Theo chính sách thanh toán công khai của KFC, các phương thức đang được liệt kê gồm: ${supportedNames}.`
    : "Mình chưa tìm thấy phương thức thanh toán đã được liệt kê trong dữ liệu KFC.";
}

function selectSafeFallbackText(
  state: AgentGraphState,
  plannerFallbackText?: string,
): string {
  if (state.escalationReasons.length === 0) {
    if (
      !state.invoiceRequest &&
      hasPlannerBooleanEntity(state, "invoiceRequested")
    ) {
      return "Mình đã lưu ghi chú giao hàng và nhu cầu xuất hóa đơn công ty. Bạn vui lòng gửi tên công ty, mã số thuế và email nhận hóa đơn để mình hoàn tất đơn nhé.";
    }

    if (state.order?.status === "created" && state.paymentAttempt?.paymentUrl) {
      return `Đơn ${state.order.id} đã được tạo. Mình đã tạo link thanh toán ${state.paymentAttempt.paymentUrl}; KFC sẽ xử lý đơn theo thông tin giao hàng và hóa đơn đã ghi nhận.`;
    }

    if (state.paymentMethodEvidence && state.paymentMethodEvidence.length > 0) {
      return paymentMethodFallbackText(state);
    }

    if (
      hasPlannerBooleanEntity(state, "asksClarification") &&
      state.customerContext?.recentOrders[0] &&
      !state.cart
    ) {
      const itemList = state.customerContext.recentOrders[0].cart.items
        .map((item) => `${item.quantity} ${item.name}`)
        .join(", ");
      return `Đơn hàng trước của bạn là ${itemList}. Bạn có muốn đặt lại đơn này không?`;
    }

    if (
      hasSuccessfulToolResult(state.toolTrace ?? [], [
        "getMembershipProfile",
      ]) &&
      typeof state.customerContext?.loyaltyPoints === "number"
    ) {
      const cartApplicability = state.cart
        ? " Mình có thể kiểm tra ưu đãi áp dụng cho giỏ hiện tại, nhưng cần bạn chọn hoặc xác nhận phần thưởng trước khi đổi điểm."
        : " Nếu bạn muốn dùng điểm, mình có thể kiểm tra ưu đãi thành viên phù hợp.";
      return `Bạn hiện có ${state.customerContext.loyaltyPoints} điểm thành viên.${cartApplicability}`;
    }

    if (
      state.paymentAttempt?.method &&
      !state.paymentAttempt.paymentUrl &&
      !state.order
    ) {
      return `Phương thức thanh toán này dùng được cho đơn này. Mình sẽ tạo link thanh toán sau khi bạn xác nhận đơn.`;
    }

    if (state.handoff && !plannerFallbackText) {
      return "Mình sẽ chuyển nhân viên hỗ trợ ngay.";
    }

    if (
      hasPlannerBooleanEntity(state, "invoiceRequested") &&
      !state.invoiceRequest
    ) {
      return "Mình có thể ghi nhận yêu cầu xuất hóa đơn. Bạn gửi giúp mình tên công ty, mã số thuế và email nhận hóa đơn nhé.";
    }

    if (
      state.cart &&
      !state.fulfillment &&
      !state.order &&
      !hasSuccessfulToolResult(state.toolTrace ?? [], [
        "searchMenu",
        "updateCart",
        "getMembershipProfile",
        "listMembershipRewards",
        "listMembershipWallet",
      ])
    ) {
      return "Mình tiếp tục hỗ trợ giỏ hiện tại. Bạn gửi giúp mình địa chỉ giao hàng đầy đủ để mình kiểm tra phí ship và thời gian giao nhé.";
    }

    if (
      state.cart &&
      !state.fulfillment &&
      hasSuccessfulToolResult(state.toolTrace ?? [], ["updateCart"])
    ) {
      const itemList = state.cart.items
        .map((item) => `${item.quantity} ${item.name}`)
        .join(", ");
      return `Mình đã thêm ${itemList} vào giỏ hàng. Bạn gửi giúp mình địa chỉ giao hàng đầy đủ để mình kiểm tra phí ship và thời gian giao nhé.`;
    }

    if (state.cart?.voucherCode && state.promotionContext?.validation?.ok) {
      return `Mình đã áp dụng mã ${state.cart.voucherCode}, giảm ${state.cart.discountVnd.toLocaleString("vi-VN")}đ. Tổng tạm tính hiện là ${state.cart.totalVnd.toLocaleString("vi-VN")}đ.`;
    }

    if (
      state.cart &&
      state.fulfillment &&
      !state.orderPreview &&
      !state.order
    ) {
      const storeName = state.fulfillment.storeName.replace(/^KFC\s+/i, "");
      return `KFC ${storeName} có thể giao đơn này. Phí ship ${state.fulfillment.feeVnd.toLocaleString("vi-VN")}đ, dự kiến ${state.fulfillment.etaMinutes} phút; tạm tính ${state.cart.totalVnd.toLocaleString("vi-VN")}đ.`;
    }

    if (
      !state.cart &&
      state.menuSearchResults &&
      state.menuSearchResults.length > 0
    ) {
      const itemList = state.menuSearchResults
        .map(
          (item) => `${item.name} (${item.priceVnd.toLocaleString("vi-VN")}đ)`,
        )
        .join(", ");
      return `Mình tìm thấy ${state.menuSearchResults.length} món phù hợp trong dữ liệu KFC: ${itemList}. Bạn muốn chọn món nào?`;
    }

    return (
      plannerFallbackText ??
      "Mình đã kiểm tra thông tin từ dữ liệu KFC. Bạn muốn mình tiếp tục thế nào?"
    );
  }

  const reasons = new Set(state.escalationReasons);
  const highestPriorityReason =
    safeFallbackPriority.find((reason) => reasons.has(reason)) ??
    state.escalationReasons[0] ??
    "needs_verified_info";

  switch (highestPriorityReason) {
    case "order_confirmation_required":
      return 'Mình chưa thể đặt đơn khi chưa có xác nhận rõ ràng. Nếu bạn muốn chốt đơn, hãy nhắn "xác nhận đơn".';
    case "valid_fulfillment_required":
      return "Mình cần xác minh cửa hàng và hình thức nhận hoặc giao trước khi tiếp tục đặt đơn.";
    case "payment_tool_success_required":
      return "Mình chưa xác minh được trạng thái thanh toán thành công. Bạn gửi mã đơn để mình kiểm tra lại nhé.";
    case "promotion_evidence_required":
      return "Mình chưa có thông tin khuyến mãi đã được xác minh cho yêu cầu này. Bạn gửi thêm mã hoặc để mình kiểm tra ưu đãi công khai nhé.";
    case "allergen_certainty_not_allowed":
      return "Mình không thể khẳng định tuyệt đối về dị ứng từ dữ liệu hiện có. Mình có thể chia sẻ thông tin thành phần đã xác minh nếu bạn cần.";
    case "tool_execution_failed":
      return "Mình chưa thực hiện được thao tác này từ dữ liệu backend đã xác minh. Bạn kiểm tra lại món hoặc yêu cầu cần làm giúp mình nhé.";
    case "cart_initialization_failed":
      return "Mình chưa khởi tạo được giỏ hàng từ dữ liệu hiện có. Bạn thử lại món cần đặt giúp mình nhé.";
    case "menu_item_verification_required":
      return "Mình chưa xác minh được đầy đủ món bạn muốn đặt từ menu KFC. Bạn gửi lại tên món hoặc combo cụ thể hơn giúp mình nhé.";
    case "cart_mutation_confirmation_required":
      return "Mình cần bạn xác nhận rõ món trong giỏ hiện tại cần thay đổi trước khi mình cập nhật giỏ.";
    case "previous_order_confirmation_required":
      if (state.customerContext?.recentOrders[0]) {
        const itemList = state.customerContext.recentOrders[0].cart.items
          .map((item) => `${item.quantity} ${item.name}`)
          .join(", ");
        return `Đơn hàng trước của bạn là ${itemList}. Bạn có muốn đặt lại đơn này không?`;
      }
      return "Mình tìm thấy món trong đơn trước, nhưng cần bạn xác nhận rõ đơn trước muốn đặt lại trước khi mình thêm vào giỏ.";
    default:
      return "Mình cần thêm thông tin đã được xác minh để hỗ trợ đúng. Bạn cho mình biết chi tiết cần kiểm tra tiếp nhé.";
  }
}

async function composeAndAppendAssistantTurn(input: {
  turnInput: AgentTurnInput;
  state: AgentGraphState;
  fallbackText: string;
  replyIntent: ReplyIntent;
  currentTurnToolTrace: ToolTraceEntry[];
}): Promise<AgentTurnOutput> {
  let responseText = input.fallbackText;

  const useDeterministicPaymentMethodReply =
    input.state.paymentAttempt?.method &&
    !input.state.paymentAttempt.paymentUrl &&
    !input.state.order &&
    input.fallbackText.includes("Phương thức thanh toán này");
  const useStructuredPolicyFallback =
    (hasPlannerBooleanEntity(input.state, "asksClarification") &&
      Boolean(input.state.customerContext?.recentOrders[0])) ||
    input.state.escalationReasons.includes(
      "cart_mutation_confirmation_required",
    ) ||
    input.state.escalationReasons.includes(
      "previous_order_confirmation_required",
    );

  if (
    input.turnInput.responseComposer &&
    !useDeterministicPaymentMethodReply &&
    !useStructuredPolicyFallback
  ) {
    try {
      const composerState = buildContextPolicyState(
        {
          ...input.state,
          toolTrace: input.currentTurnToolTrace,
        },
        {
          metadata: input.turnInput.metadata,
          preserveCartOrderPaymentContext:
            shouldPreserveCurrentCartOrderPaymentContext(
              input.currentTurnToolTrace,
            ),
          preserveMenuSearchResults: shouldPreserveCurrentMenuSearchResults(
            input.currentTurnToolTrace,
          ),
          preservePaymentContext: shouldPreserveCurrentPaymentContext(
            input.currentTurnToolTrace,
          ),
          preserveHandoff: shouldPreserveCurrentHandoff(
            input.currentTurnToolTrace,
          ),
          preserveRecentTurns: true,
          preserveToolTrace: true,
        },
      );
      responseText = await input.turnInput.responseComposer.composeResponse({
        state: composerState,
        replyIntent: input.replyIntent,
        fallbackText: input.fallbackText,
      });
    } catch (error) {
      await input.turnInput.store.appendEvent(
        input.turnInput.sessionId,
        "llm:response_composer_failed",
        {
          message:
            error instanceof Error
              ? error.message
              : "Unknown response composer failure",
          replyIntent: input.replyIntent,
        },
      );
    }
  }

  const genUi = selectKfcGenUiAttachment({
    state: buildContextPolicyState(input.state, {
      metadata: input.turnInput.metadata,
      preserveCartOrderPaymentContext:
        shouldPreserveCurrentCartOrderPaymentContext(
          input.currentTurnToolTrace,
        ),
      preserveMenuSearchResults: shouldPreserveCurrentMenuSearchResults(
        input.currentTurnToolTrace,
      ),
      preservePaymentContext: shouldPreserveCurrentPaymentContext(
        input.currentTurnToolTrace,
      ),
      preserveHandoff: shouldPreserveCurrentHandoff(input.currentTurnToolTrace),
    }),
    turnToolNames: input.currentTurnToolTrace.map((entry) => entry.toolName),
  });

  const turn = await input.turnInput.store.appendTurn({
    sessionId: input.turnInput.sessionId,
    channel: input.turnInput.channel,
    role: "assistant",
    text: responseText,
    externalMessageId: null,
    externalUserId: input.turnInput.customerId,
    deliveryStatus: "pending",
    metadata: genUi ? { genUi } : null,
  });
  emitDashboardEvent(input.turnInput, "conversation_turn_created", {
    turnId: turn.id,
    role: turn.role,
    channel: turn.channel,
    deliveryStatus: turn.deliveryStatus,
    externalMessageId: turn.externalMessageId,
    externalUserId: turn.externalUserId,
    text: turn.text,
    metadata: turn.metadata,
  });

  return {
    state: input.state,
    responseText,
    replyIntent: input.replyIntent,
    genUi,
    assistantTurnId: turn.id,
  };
}

const singleStepPlannerIterations = 1;
const multiStepPlannerIterations = 4;

export async function runAgentTurn(
  input: AgentTurnInput,
): Promise<AgentTurnOutput> {
  let priorVerifiedState = await loadPriorVerifiedState(
    input.store,
    input.sessionId,
  );
  priorVerifiedState = await hydrateRecentOrderContext(
    input,
    priorVerifiedState,
  );
  const retrievedEvidence: AgentGraphState["retrievedEvidence"] = [];

  const existingUserTurn = input.externalMessageId
    ? await input.store.findTurnByExternalMessage(
        input.sessionId,
        input.externalMessageId,
      )
    : undefined;
  const userTurn =
    existingUserTurn ??
    (await input.store.appendTurn({
      sessionId: input.sessionId,
      channel: input.channel,
      role: "user",
      text: input.text,
      externalMessageId: input.externalMessageId ?? null,
      externalUserId: input.customerId,
      deliveryStatus: "received",
      metadata: input.metadata ?? null,
    }));
  if (!existingUserTurn) {
    emitDashboardEvent(input, "customer_message_received", {
      turnId: userTurn.id,
      channel: userTurn.channel,
      externalMessageId: userTurn.externalMessageId,
      externalUserId: userTurn.externalUserId,
      text: userTurn.text,
      metadata: userTurn.metadata,
    });
    emitDashboardEvent(input, "conversation_turn_created", {
      turnId: userTurn.id,
      role: userTurn.role,
      channel: userTurn.channel,
      deliveryStatus: userTurn.deliveryStatus,
      externalMessageId: userTurn.externalMessageId,
      externalUserId: userTurn.externalUserId,
      text: userTurn.text,
      metadata: userTurn.metadata,
    });
  }
  const recentTurns = buildBoundedRecentTurns(
    await input.store.listTurns(input.sessionId),
  );

  const state: AgentGraphState = {
    sessionId: input.sessionId,
    customerId: input.customerId,
    channel: input.channel,
    latestUserMessage: input.text,
    recentTurns,
    intent: "unclear",
    cart: priorVerifiedState.cart,
    address: priorVerifiedState.address,
    orderPreview: priorVerifiedState.orderPreview,
    order: priorVerifiedState.order,
    userConfirmedOrder: isConfirmOrderGenUiAction(input.metadata),
    escalationReasons: [],
    retrievedEvidence,
    fulfillment: priorVerifiedState.fulfillment,
    promotionContext: priorVerifiedState.promotionContext,
    contentEvidence: priorVerifiedState.contentEvidence,
    menuSearchResults: priorVerifiedState.menuSearchResults,
    customerContext: priorVerifiedState.customerContext,
    paymentAttempt: priorVerifiedState.paymentAttempt,
    paymentMethodEvidence: priorVerifiedState.paymentMethodEvidence,
    invoiceRequest: priorVerifiedState.invoiceRequest,
    handoff: priorVerifiedState.handoff,
    toolTrace: priorVerifiedState.toolTrace ?? [],
  };

  if (!(await isRunStillCurrent(input))) {
    return {
      state,
      responseText: "",
      replyIntent: "general_reply",
      suppressed: true,
    };
  }

  if (input.toolPlanner) {
    const currentTurnToolTrace: ToolTraceEntry[] = [];
    const multiStepEnabled = input.toolPlanner.supportsMultiStep === true;
    const maxPlannerIterations = multiStepEnabled
      ? multiStepPlannerIterations
      : singleStepPlannerIterations;
    const responseClaims = new Set<
      NonNullable<ToolPlannerOutput["responseClaims"]>[number]
    >();
    let plannerFallbackText: string | undefined;
    let plannedAtLeastOnce = false;
    let plannerRequestedClarification = false;

    const directGenUiCartCall = genUiAddItemActionToToolCall(input.metadata);
    if (directGenUiCartCall) {
      state.intent = "cart_edit";
      const gatingForCall = applySafetyGates(state, [directGenUiCartCall], {
        requireVerifiedItemCodes: true,
      });
      pushEscalationReasons(state, gatingForCall.blockedReasons);
      if (
        gatingForCall.allowedCalls.length > 0 &&
        (await ensureCartForTool(input, state, directGenUiCartCall))
      ) {
        const result = await executeToolCall(
          input.clients,
          state,
          directGenUiCartCall,
          toolExecutionContext(input),
        );
        applyToolResultToState(
          input,
          state,
          result,
          directGenUiCartCall.arguments,
          currentTurnToolTrace,
        );
      }
      emitDerivedEvents(input, state, currentTurnToolTrace);
      await persistVerifiedStateSnapshot(input.store, state);

      return composeAndAppendAssistantTurn({
        turnInput: input,
        state,
        replyIntent:
          state.escalationReasons.length > 0
            ? "ask_clarification"
            : "general_reply",
        fallbackText: selectSafeFallbackText(
          state,
          "Mình đã cập nhật giỏ hàng.",
        ),
        currentTurnToolTrace,
      });
    }

    for (let iteration = 0; iteration < maxPlannerIterations; iteration += 1) {
      const rawPlan = await input.toolPlanner
        .plan({
          state: buildContextPolicyState(
            { ...state, toolTrace: currentTurnToolTrace },
            {
              metadata: input.metadata,
              preserveCartOrderPaymentContext:
                shouldPreserveCurrentCartOrderPaymentContext(
                  currentTurnToolTrace,
                ),
              preserveMenuSearchResults:
                shouldPreserveCurrentMenuSearchResults(currentTurnToolTrace),
              preservePaymentContext:
                shouldPreserveCurrentPaymentContext(currentTurnToolTrace),
              preserveHandoff:
                shouldPreserveCurrentHandoff(currentTurnToolTrace),
              preserveToolTrace: true,
            },
          ),
          availableTools: toolNames,
          recentTurns,
        })
        .catch(async (error) => {
          await input.store.appendEvent(
            input.sessionId,
            "llm:tool_planner_failed",
            {
              message:
                error instanceof Error
                  ? error.message
                  : "Unknown tool planner failure",
            },
          );
          return undefined;
        });

      if (!rawPlan) {
        if (!plannedAtLeastOnce && currentTurnToolTrace.length === 0) {
          return composeAndAppendAssistantTurn({
            turnInput: input,
            state,
            replyIntent: "ask_clarification",
            fallbackText: "Mình cần thêm thông tin để hỗ trợ đúng.",
            currentTurnToolTrace: [],
          });
        }
        break;
      }

      plannedAtLeastOnce = true;
      state.intent = rawPlan.intent;
      state.entities = rawPlan.entities;
      if (hasPlannerBooleanEntity(state, "asksClarification")) {
        plannerRequestedClarification = true;
      }
      if (hasPlannerBooleanEntity(state, "orderConfirmed")) {
        state.userConfirmedOrder = true;
      }
      const checksPaymentMethodSupport = rawPlan.toolCalls.some(
        (call) => call.toolName === "listPaymentMethods",
      );
      rememberPlannerPaymentMethod(state, checksPaymentMethodSupport);
      for (const claim of rawPlan.responseClaims) responseClaims.add(claim);
      plannerFallbackText = rawPlan.directResponse ?? plannerFallbackText;

      if (rawPlan.toolCalls.length === 0) break;

      for (const call of rawPlan.toolCalls) {
        if (
          contextPolicyRequiresConfirmation(input.metadata, "recentOrder") &&
          ["updateCart", "previewCart", "previewOrder", "placeOrder"].includes(call.toolName)
        ) {
          state.entities = {
            ...(isRecord(state.entities) ? state.entities : {}),
            asksClarification: true,
          };
          plannerRequestedClarification = true;
          pushEscalationReasons(state, ["previous_order_confirmation_required"]);
          continue;
        }
        if (hasSuccessfulCurrentTurnToolCall(currentTurnToolTrace, call)) {
          continue;
        }
        const gatingForCall = applySafetyGates(state, [call], {
          requireVerifiedItemCodes: multiStepEnabled,
          requireCartMutationConfirmation: contextPolicyRequiresConfirmation(
            input.metadata,
            "cart",
          ),
        });
        pushEscalationReasons(state, gatingForCall.blockedReasons);
        if (gatingForCall.allowedCalls.length === 0) {
          continue;
        }

        const ready = await ensureCartForTool(input, state, call);
        if (!ready) continue;

        if (call.toolName === "placeOrder" && !state.orderPreview) {
          const previewCall: ToolCallRequest = {
            toolName: "previewOrder",
            arguments: {},
          };
          const previewGating = applySafetyGates(state, [previewCall]);
          pushEscalationReasons(state, previewGating.blockedReasons);
          if (previewGating.allowedCalls.length === 0) continue;

          const previewResult = await executeToolCall(
            input.clients,
            state,
            previewCall,
            toolExecutionContext(input),
          );
          applyToolResultToState(
            input,
            state,
            previewResult,
            previewCall.arguments,
            currentTurnToolTrace,
          );
          if (!previewResult.ok) continue;
        }

        const result = await executeToolCall(
          input.clients,
          state,
          call,
          toolExecutionContext(input),
        );
        applyToolResultToState(
          input,
          state,
          result,
          call.arguments,
          currentTurnToolTrace,
        );
      }

      if (!multiStepEnabled) break;
    }

    await addConfirmedPreviousOrderToCart({
      turnInput: input,
      state,
      currentTurnToolTrace,
    });

    if (
      contextPolicyIsActive(input.metadata, "membership") &&
      contextPolicyIsActive(input.metadata, "cart") &&
      hasSuccessfulToolResult(currentTurnToolTrace, ["getMembershipProfile"]) &&
      !hasSuccessfulToolResult(currentTurnToolTrace, [
        "acquireVoucher",
        "redeemReward",
      ])
    ) {
      plannerRequestedClarification = true;
    }

    if (!hasSuccessfulToolResult(currentTurnToolTrace, ["placeOrder"])) {
      await placeConfirmedOrderFromVerifiedState({
        turnInput: input,
        state,
        currentTurnToolTrace,
      });
    }

    await createPaymentLinkAfterOrderFromRememberedMethod({
      turnInput: input,
      state,
      currentTurnToolTrace,
    });

    clearRecoverableFulfillmentArgumentFailure(state, currentTurnToolTrace);
    if (
      state.intent === "ordering" &&
      isRecord(state.entities) &&
      typeof state.entities.itemText === "string" &&
      currentTurnToolTrace.some((entry) => entry.toolName === "searchMenu") &&
      !hasSuccessfulToolResult(currentTurnToolTrace, ["updateCart"]) &&
      (hasPlannerBooleanEntity(state, "cartMutationRequested") ||
        (state.menuSearchResults?.length ?? 0) === 0) &&
      !state.cart
    ) {
      pushEscalationReasons(state, ["menu_item_verification_required"]);
    }
    const gatingAfterExecution = applySafetyGates(
      { ...state, toolTrace: currentTurnToolTrace },
      [],
      {
        responseClaims: [...responseClaims],
      },
    );
    pushEscalationReasons(state, gatingAfterExecution.blockedReasons);
    emitDerivedEvents(input, state, currentTurnToolTrace);
    await persistVerifiedStateSnapshot(input.store, state);
    await emitSessionIntelligence(input, state);

    if (!(await isRunStillCurrent(input))) {
      return {
        state,
        responseText: "",
        replyIntent: "general_reply",
        suppressed: true,
      };
    }

    return composeAndAppendAssistantTurn({
      turnInput: input,
      state,
      replyIntent:
        state.escalationReasons.length > 0 || plannerRequestedClarification
          ? "ask_clarification"
          : "general_reply",
      fallbackText: selectSafeFallbackText(
        buildContextPolicyState(
          { ...state, toolTrace: currentTurnToolTrace },
          {
            metadata: input.metadata,
            preserveCartOrderPaymentContext:
              shouldPreserveCurrentCartOrderPaymentContext(
                currentTurnToolTrace,
              ),
            preserveMenuSearchResults:
              shouldPreserveCurrentMenuSearchResults(currentTurnToolTrace),
            preservePaymentContext:
              shouldPreserveCurrentPaymentContext(currentTurnToolTrace),
            preserveHandoff: shouldPreserveCurrentHandoff(currentTurnToolTrace),
            preserveToolTrace: true,
          },
        ),
        plannerFallbackText,
      ),
      currentTurnToolTrace,
    });
  }

  if (!(await isRunStillCurrent(input))) {
    return {
      state,
      responseText: "",
      replyIntent: "general_reply",
      suppressed: true,
    };
  }

  return composeAndAppendAssistantTurn({
    turnInput: input,
    state,
    replyIntent: "ask_clarification",
    fallbackText: "Mình cần thêm thông tin để hỗ trợ đúng.",
    currentTurnToolTrace: [],
  });
}
