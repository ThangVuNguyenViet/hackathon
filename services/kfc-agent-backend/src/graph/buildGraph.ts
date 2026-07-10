import type { ExternalClients } from '../clients/interfaces.js';
import type { DashboardEventBus } from '../dashboard/eventBus.js';
import type { Address, DashboardEvent, Channel, ConversationTurn, ConversationTurnMetadata, SessionUpdateType } from '../domain/types.js';
import { selectKfcGenUiAttachment } from '../genui/kfcGenUiSelector.js';
import type { KfcGenUiAttachment } from '../genui/kfcGenUi.js';
import type { ResponseComposer } from '../llm/responseComposer.js';
import type { ToolPlanner, ToolPlannerOutput } from '../llm/toolPlanner.js';
import { executeToolCall } from '../ordering/toolExecutor.js';
import { toolNames } from '../ordering/toolCatalog.js';
import { getToolBoundary } from '../ordering/toolBoundaries.js';
import { applySafetyGates } from '../ordering/safetyGates.js';
import type { PaymentLinkMethod, PromotionValidationResult, ToolCallRequest, ToolCallResult, ToolTraceEntry } from '../ordering/types.js';
import type { ConversationStore } from '../persistence/memoryStore.js';
import { buildBoundedRecentTurns } from '../session/sessionContext.js';
import type { AgentGraphState } from './state.js';

export type ReplyIntent =
  | 'ask_fulfillment_method'
  | 'ask_clarification'
  | 'order_created'
  | 'human_review_required'
  | 'payment_retry'
  | 'general_reply';

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
    recordIrreversibleBoundary?(toolName: ToolCallRequest['toolName']): Promise<void>;
  };
}

export interface AgentTurnOutput {
  state: AgentGraphState;
  responseText: string;
  replyIntent: ReplyIntent;
  genUi?: KfcGenUiAttachment;
  assistantTurnId?: string;
  suppressed?: boolean;
}

function normalizeFreeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/đ/g, 'd')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function asksToMutateCart(text: string): boolean {
  const normalized = normalizeFreeText(text);
  return /\b(?:dat|them|add|order|cho minh|cho toi|vao gio|lay|mua)\b/.test(normalized);
}

function isAffirmativeOrderConfirmation(text: string): boolean {
  const normalized = normalizeFreeText(text);
  const negated = /\b(?:khong|chua|do not|dont)\s+(?:xac nhan|confirm)\b/.test(normalized);
  if (negated) return false;
  return /\b(?:xac nhan|chot|confirm)\b/.test(normalized) && /\b(?:don|order)\b/.test(normalized);
}

function addressFromText(text: string): Address | undefined {
  const parts = text
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 3) return undefined;

  const city = parts.at(-1);
  const district = parts.at(-2);
  const lineParts = parts.slice(0, -2);
  if (!city || !district || lineParts.length === 0) return undefined;

  return {
    label: lineParts[0],
    line1: lineParts.join(', '),
    district,
    city,
  };
}

function referencesSavedOrPriorAddress(text: string): boolean {
  const normalized = normalizeFreeText(text);
  return /\b(?:cho cu|dia chi cu|dia chi da luu|dia chi gan nhat|same address|saved address|old address|as before)\b/.test(normalized);
}

function isAffirmativeShortConfirmation(text: string): boolean {
  const normalized = normalizeFreeText(text)
    .replace(/[.?!]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return /^(?:dung roi|ok|oke|okay|uh|uhm|vang|da|duoc|chinh xac|yes|yep)(?:\s+(?:roi|nha|a|ah|ban|tiep tuc))*$/.test(
    normalized,
  );
}

function recentAssistantAskedAddressConfirmation(turns: ConversationTurn[] | undefined): boolean {
  for (let index = (turns?.length ?? 0) - 1, inspected = 0; index >= 0 && inspected < 6; index -= 1, inspected += 1) {
    const turn = turns?.[index];
    if (!turn || turn.role !== 'assistant') continue;

    const normalized = normalizeFreeText(turn.text);
    const asksAboutAddress = /\b(?:dia chi|address|giao den|giao ve|delivery)\b/.test(normalized);
    const asksForConfirmation = /\b(?:dung khong|xac nhan|dia chi nay|cho nay|tiep tuc)\b/.test(normalized);
    if (asksAboutAddress && asksForConfirmation) return true;
  }
  return false;
}

function shouldUseKnownAddressForFulfillment(state: AgentGraphState): boolean {
  if (!state.cart || state.cart.items.length === 0 || !state.address) return false;
  return (
    referencesSavedOrPriorAddress(state.latestUserMessage) ||
    (isAffirmativeShortConfirmation(state.latestUserMessage) && recentAssistantAskedAddressConfirmation(state.recentTurns))
  );
}

function shouldHydrateRecentOrder(text: string): boolean {
  const normalized = normalizeFreeText(text);
  return /\b(?:don|order|trang thai|status|thanh toan|payment|tra tien|momo|da thanh toan|ship|giao toi dau)\b/.test(normalized);
}

function cartItemCodes(state: AgentGraphState): string[] {
  return [...new Set(state.cart?.items.map((item) => item.itemCode) ?? [])];
}

const verifiedStateSnapshotSourceType = 'graph:verified_state';

type VerifiedStateSnapshot = Pick<
  AgentGraphState,
  | 'cart'
  | 'address'
  | 'orderPreview'
  | 'order'
  | 'fulfillment'
  | 'promotionContext'
  | 'contentEvidence'
  | 'menuSearchResults'
  | 'customerContext'
  | 'paymentAttempt'
  | 'paymentMethodEvidence'
  | 'invoiceRequest'
  | 'handoff'
  | 'toolTrace'
>;

function emitDashboardEvent(input: AgentTurnInput, type: DashboardEvent['type'], payload: Record<string, unknown>): void {
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
  emitDashboardEvent(input, 'session_updated', payload);
}

function pushEscalationReasons(state: AgentGraphState, reasons: string[]): void {
  const seen = new Set(state.escalationReasons);
  for (const reason of reasons) {
    if (seen.has(reason)) continue;
    seen.add(reason);
    state.escalationReasons.push(reason);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hasPlannerBooleanEntity(state: AgentGraphState, key: string): boolean {
  return isRecord(state.entities) && state.entities[key] === true;
}

function plannerPaymentMethod(state: AgentGraphState): PaymentLinkMethod | undefined {
  const method = isRecord(state.entities) ? state.entities.paymentMethod : undefined;
  return method === 'momo' || method === 'zalopay' || method === 'card' || method === 'cod' ? method : undefined;
}

function paymentMethodFixtureId(method: PaymentLinkMethod): string {
  switch (method) {
    case 'cod':
      return 'cash_on_delivery';
    case 'card':
      return 'visa_master_card';
    case 'zalopay':
      return 'zalopay_wallet';
    case 'momo':
      return 'momo_wallet';
  }
}

function linkMethodFromPaymentEvidence(
  evidence: AgentGraphState['paymentMethodEvidence'],
): PaymentLinkMethod | undefined {
  if (!evidence) return undefined;
  const supportedMethodIds = new Set(evidence.filter((entry) => entry.supported).map((entry) => entry.methodId));
  if (supportedMethodIds.has('zalopay_wallet')) return 'zalopay';
  if (supportedMethodIds.has('visa_master_card')) return 'card';
  if (supportedMethodIds.has('cash_on_delivery')) return 'cod';
  return evidence.length > 0 ? 'zalopay' : undefined;
}

function findPaymentEvidenceForLinkMethod(
  evidence: AgentGraphState['paymentMethodEvidence'],
  method: PaymentLinkMethod,
): NonNullable<AgentGraphState['paymentMethodEvidence']>[number] | undefined {
  return evidence?.find((entry) => entry.methodId === paymentMethodFixtureId(method));
}

function isConfirmOrderGenUiAction(metadata: ConversationTurnMetadata | null | undefined): boolean {
  const rawEvent = metadata?.rawEvent;
  if (!isRecord(rawEvent)) return false;
  const action = rawEvent.genUiAction;
  return isRecord(action) && action.actionId === 'confirm_order';
}

function repriceCartWithDeliveryFee(state: AgentGraphState, deliveryFeeVnd: number): void {
  if (!state.cart) return;
  state.cart = {
    ...state.cart,
    deliveryFeeVnd,
    totalVnd: Math.max(0, state.cart.subtotalVnd - state.cart.discountVnd + deliveryFeeVnd),
  };
}

function applyVoucherToCart(state: AgentGraphState, validation: PromotionValidationResult): void {
  if (!state.cart || !validation.ok) return;
  state.cart = {
    ...state.cart,
    voucherCode: validation.publicCode,
    discountVnd: validation.discountVnd,
    totalVnd: Math.max(0, state.cart.subtotalVnd - validation.discountVnd + state.cart.deliveryFeeVnd),
  };
}

function traceFromResult(result: ToolCallResult, args: Record<string, unknown>): ToolTraceEntry {
  return {
    toolName: result.toolName,
    arguments: args,
    ok: result.ok,
    resultSummary: result.ok ? result.message : result.errorCode ?? result.message,
    provenance: result.provenance,
  };
}

function shouldEmitToolCalledEvent(result: ToolCallResult): boolean {
  if (!result.ok) return false;
  return true;
}

function hasCartChanged(
  previousCart: AgentGraphState['cart'],
  nextCart: AgentGraphState['cart'],
): boolean {
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

function invalidateDependentStateAfterCartMutation(state: AgentGraphState): void {
  state.fulfillment = undefined;
  state.orderPreview = undefined;
  state.order = undefined;
  state.paymentAttempt = undefined;
  state.promotionContext = undefined;
  state.invoiceRequest = undefined;
}

function extractVerifiedStateSnapshot(payload: Record<string, unknown>): Partial<VerifiedStateSnapshot> | undefined {
  if (!isRecord(payload.verifiedState)) return undefined;
  return payload.verifiedState as Partial<VerifiedStateSnapshot>;
}

async function loadPriorVerifiedState(store: ConversationStore, sessionId: string): Promise<Partial<VerifiedStateSnapshot>> {
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
  const paymentStatus = recentOrder.paymentStatus === 'not_started' ? 'pending' : recentOrder.paymentStatus;
  return {
    ...priorVerifiedState,
    order: recentOrder,
    cart: priorVerifiedState.cart ?? recentOrder.cart,
    paymentAttempt: priorVerifiedState.paymentAttempt ?? {
      status: paymentStatus,
    },
    customerContext: {
      savedAddresses: priorVerifiedState.customerContext?.savedAddresses ?? [],
      recentOrders: [recentOrder, ...(priorVerifiedState.customerContext?.recentOrders ?? [])],
      favorites: priorVerifiedState.customerContext?.favorites ?? [],
      loyaltyPoints: priorVerifiedState.customerContext?.loyaltyPoints,
    },
  };
}

function buildVerifiedStateSnapshot(state: AgentGraphState): VerifiedStateSnapshot {
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

async function persistVerifiedStateSnapshot(store: ConversationStore, state: AgentGraphState): Promise<void> {
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
      return;
    case 'quoteFulfillment':
      if (isRecord(result.value)) {
        state.fulfillment = result.value as unknown as AgentGraphState['fulfillment'];
        if (isRecord(args.address)) {
          state.address = args.address as unknown as AgentGraphState['address'];
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
        state.promotionContext = {
          matchedOfferIds: result.value.flatMap((entry) =>
            isRecord(entry) && typeof entry.offerId === 'string' ? [entry.offerId] : [],
          ),
          validation: state.promotionContext?.validation,
          caveats: state.promotionContext?.caveats ?? [],
        };
      }
      emitSessionUpdate(input, { updateType: 'promotion_answered' });
      return;
    case 'searchMenu':
      if (Array.isArray(result.value)) {
        state.menuSearchResults = result.value as AgentGraphState['menuSearchResults'];
      }
      return;
    case 'explainPromotion':
      if (isRecord(result.value) && typeof result.value.offerId === 'string') {
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
        emitSessionUpdate(input, { updateType: 'content_evidence_found', kind: 'allergen' });
      }
      return;
    case 'listPaymentMethods':
      if (Array.isArray(result.value)) {
        state.paymentMethodEvidence = result.value as AgentGraphState['paymentMethodEvidence'];
        const requestedMethod = plannerPaymentMethod(state);
        const matchingMethod = requestedMethod ? findPaymentEvidenceForLinkMethod(state.paymentMethodEvidence, requestedMethod) : undefined;
        if (requestedMethod && matchingMethod?.supported && !state.paymentAttempt?.paymentUrl) {
          state.paymentAttempt = { method: requestedMethod, status: 'pending' };
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

async function ensureCartForTool(input: AgentTurnInput, state: AgentGraphState, call: ToolCallRequest): Promise<boolean> {
  if (call.toolName !== 'updateCart' || state.cart) return true;

  const cartResult = await input.clients.cart.createCart(input.sessionId);
  if (!cartResult.ok || !cartResult.value) {
    pushEscalationReasons(state, ['cart_initialization_failed']);
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
  if (!input.state.cart || input.state.cart.items.length === 0 || input.state.fulfillment) return;
  if (input.state.escalationReasons.includes('menu_item_verification_required')) return;

  const addressText =
    isRecord(input.state.entities) && typeof input.state.entities.addressText === 'string'
      ? input.state.entities.addressText
      : undefined;
  const address = (addressText ? addressFromText(addressText) : undefined) ?? (shouldUseKnownAddressForFulfillment(input.state) ? input.state.address : undefined);
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
  pushEscalationReasons(input.state, gating.blockedReasons);
  if (gating.allowedCalls.length === 0) return;

  const result = await executeToolCall(input.turnInput.clients, input.state, call);
  applyToolResultToState(input.turnInput, input.state, result, call.arguments, input.currentTurnToolTrace);
}

async function placeConfirmedOrderFromVerifiedState(input: {
  turnInput: AgentTurnInput;
  state: AgentGraphState;
  currentTurnToolTrace: ToolTraceEntry[];
}): Promise<void> {
  if (!input.state.userConfirmedOrder || input.state.order) return;
  if (input.state.escalationReasons.includes('menu_item_verification_required')) return;

  const placeCall: ToolCallRequest = { toolName: 'placeOrder', arguments: {} };
  const gating = applySafetyGates(input.state, [placeCall]);
  pushEscalationReasons(input.state, gating.blockedReasons);
  if (gating.allowedCalls.length === 0) return;

  if (!input.state.orderPreview) {
    const previewCall: ToolCallRequest = { toolName: 'previewOrder', arguments: {} };
    const previewResult = await executeToolCall(input.turnInput.clients, input.state, previewCall, toolExecutionContext(input.turnInput));
    applyToolResultToState(input.turnInput, input.state, previewResult, previewCall.arguments, input.currentTurnToolTrace);
    if (!previewResult.ok) return;
  }

  const result = await executeToolCall(input.turnInput.clients, input.state, placeCall, toolExecutionContext(input.turnInput));
  applyToolResultToState(input.turnInput, input.state, result, placeCall.arguments, input.currentTurnToolTrace);
}

function hasSuccessfulToolResult(entries: ToolTraceEntry[], toolNames: ToolTraceEntry['toolName'][]): boolean {
  return entries.some((entry) => entry.ok && toolNames.includes(entry.toolName));
}

function clearRecoverableFulfillmentArgumentFailure(state: AgentGraphState, entries: ToolTraceEntry[]): void {
  if (!state.cart || state.fulfillment) return;
  if (!hasSuccessfulToolResult(entries, ['updateCart'])) return;
  const failedEntries = entries.filter((entry) => !entry.ok);
  const onlyIncompleteFulfillmentQuoteFailed = failedEntries.every(
    (entry) => entry.toolName === 'quoteFulfillment' && entry.resultSummary === 'invalid_tool_arguments',
  );
  if (!onlyIncompleteFulfillmentQuoteFailed) return;
  state.escalationReasons = state.escalationReasons.filter((reason) => reason !== 'tool_execution_failed');
}

function rememberPlannerPaymentMethod(state: AgentGraphState, checksPaymentMethodSupport = false): void {
  if (checksPaymentMethodSupport) return;
  const method = plannerPaymentMethod(state);
  if (!method || state.paymentAttempt?.paymentUrl) return;
  state.paymentAttempt = { method, status: 'pending' };
}

async function createPaymentLinkAfterOrderFromRememberedMethod(input: {
  turnInput: AgentTurnInput;
  state: AgentGraphState;
  currentTurnToolTrace: ToolTraceEntry[];
}): Promise<void> {
  if (!input.state.order || input.state.order.status !== 'created') return;
  const method = input.state.paymentAttempt?.method ?? linkMethodFromPaymentEvidence(input.state.paymentMethodEvidence);
  if (!method || input.state.paymentAttempt?.paymentUrl) return;

  const call: ToolCallRequest = { toolName: 'createPaymentLink', arguments: { method } };
  const result = await executeToolCall(input.turnInput.clients, input.state, call, toolExecutionContext(input.turnInput));
  applyToolResultToState(input.turnInput, input.state, result, call.arguments, input.currentTurnToolTrace);
}

function emitDerivedEvents(input: AgentTurnInput, state: AgentGraphState, turnToolTrace: ToolTraceEntry[]): void {
  if (state.cart && hasSuccessfulToolResult(turnToolTrace, ['updateCart', 'previewCart'])) {
    emitDashboardEvent(input, 'cart_changed', { cart: state.cart });
  }

  if (state.promotionContext?.validation?.ok && hasSuccessfulToolResult(turnToolTrace, ['validateVoucher'])) {
    emitDashboardEvent(input, 'voucher_applied', { validation: state.promotionContext.validation });
  }

  if (state.promotionContext?.validation && !state.promotionContext.validation.ok && hasSuccessfulToolResult(turnToolTrace, ['validateVoucher'])) {
    emitDashboardEvent(input, 'voucher_rejected', { validation: state.promotionContext.validation });
  }

  if (state.orderPreview && hasSuccessfulToolResult(turnToolTrace, ['previewOrder'])) {
    emitDashboardEvent(input, 'order_previewed', { order: state.orderPreview });
  }

  if (state.order && hasSuccessfulToolResult(turnToolTrace, ['placeOrder'])) {
    emitDashboardEvent(input, 'order_created', { order: state.order });
  }

  if (
    state.paymentAttempt?.paymentUrl &&
    state.paymentAttempt.method &&
    hasSuccessfulToolResult(turnToolTrace, ['createPaymentLink'])
  ) {
    emitDashboardEvent(input, 'payment_link_created', {
      method: state.paymentAttempt.method,
      status: state.paymentAttempt.status,
      url: state.paymentAttempt.paymentUrl,
    });
  }

  if (state.paymentAttempt?.status === 'failed' && hasSuccessfulToolResult(turnToolTrace, ['checkPaymentStatus'])) {
    emitDashboardEvent(input, 'payment_failed', { status: state.paymentAttempt.status });
  }

  if (state.paymentAttempt?.status === 'paid' && hasSuccessfulToolResult(turnToolTrace, ['checkPaymentStatus'])) {
    emitDashboardEvent(input, 'payment_paid', { status: state.paymentAttempt.status });
  }

  if (state.handoff && hasSuccessfulToolResult(turnToolTrace, ['handoff'])) {
    emitDashboardEvent(input, 'handoff_required', {
      escalationId: state.handoff.escalationId,
      reasons: state.handoff.reasons,
    });
  }
}

const safeFallbackPriority = [
  'order_confirmation_required',
  'valid_fulfillment_required',
  'payment_tool_success_required',
  'promotion_evidence_required',
  'allergen_certainty_not_allowed',
  'tool_execution_failed',
  'cart_initialization_failed',
  'menu_item_verification_required',
] as const;

function paymentMethodFallbackText(state: AgentGraphState): string {
  const methods = state.paymentMethodEvidence ?? [];
  const supported = methods.filter((method) => method.supported);
  const requestedMethod = plannerPaymentMethod(state);
  const requestedEvidence = requestedMethod ? findPaymentEvidenceForLinkMethod(methods, requestedMethod) : undefined;
  const supportedNames = supported.map((method) => method.displayName).join(', ');

  if (requestedEvidence && !requestedEvidence.supported) {
    const suffix = supportedNames ? ` Các phương thức đang được liệt kê gồm: ${supportedNames}.` : '';
    return `Theo chính sách thanh toán công khai của KFC, ${requestedEvidence.displayName} không được liệt kê cho checkout website/app.${suffix}`;
  }

  if (requestedEvidence?.supported) {
    return `Theo chính sách thanh toán công khai của KFC, ${requestedEvidence.displayName} được liệt kê cho checkout website/app. Mình sẽ tạo thanh toán sau khi bạn xác nhận đơn.`;
  }

  return supportedNames
    ? `Theo chính sách thanh toán công khai của KFC, các phương thức đang được liệt kê gồm: ${supportedNames}.`
    : 'Mình chưa tìm thấy phương thức thanh toán đã được liệt kê trong dữ liệu KFC.';
}

function selectSafeFallbackText(state: AgentGraphState, plannerFallbackText?: string): string {
  if (state.escalationReasons.length === 0) {
    if (!state.invoiceRequest && (hasPlannerBooleanEntity(state, 'invoiceRequested') || /h[oóòỏõọôốồổỗộơớờởỡợ][aáàảãạ]?\s*đ[oơ]n|xu[ấa]t\s+h[oóòỏõọôốồổỗộơớờởỡợ][aáàảãạ]?/i.test(state.latestUserMessage))) {
      return 'Mình đã lưu ghi chú giao hàng và nhu cầu xuất hóa đơn công ty. Bạn vui lòng gửi tên công ty, mã số thuế và email nhận hóa đơn để mình hoàn tất đơn nhé.';
    }

    if (state.order?.status === 'created' && state.paymentAttempt?.paymentUrl) {
      return `Đơn ${state.order.id} đã được tạo. Mình đã tạo link thanh toán ${state.paymentAttempt.paymentUrl}; KFC sẽ xử lý đơn theo thông tin giao hàng và hóa đơn đã ghi nhận.`;
    }

    if (state.paymentMethodEvidence && state.paymentMethodEvidence.length > 0) {
      return paymentMethodFallbackText(state);
    }

    if (state.paymentAttempt?.method && !state.paymentAttempt.paymentUrl && !state.order) {
      return `Phương thức thanh toán này dùng được cho đơn này. Mình sẽ tạo link thanh toán sau khi bạn xác nhận đơn.`;
    }

    if (state.cart && !state.fulfillment && hasSuccessfulToolResult(state.toolTrace ?? [], ['updateCart'])) {
      const itemList = state.cart.items.map((item) => `${item.quantity} ${item.name}`).join(', ');
      return `Mình đã thêm ${itemList} vào giỏ hàng. Bạn gửi giúp mình địa chỉ giao hàng đầy đủ để mình kiểm tra phí ship và thời gian giao nhé.`;
    }

    if (state.cart?.voucherCode && state.promotionContext?.validation?.ok) {
      return `Mình đã áp dụng mã ${state.cart.voucherCode}, giảm ${state.cart.discountVnd.toLocaleString('vi-VN')}đ. Tổng tạm tính hiện là ${state.cart.totalVnd.toLocaleString('vi-VN')}đ.`;
    }

    if (state.cart && state.fulfillment && !state.orderPreview && !state.order) {
      const storeName = state.fulfillment.storeName.replace(/^KFC\s+/i, '');
      return `KFC ${storeName} có thể giao đơn này. Phí ship ${state.fulfillment.feeVnd.toLocaleString('vi-VN')}đ, dự kiến ${state.fulfillment.etaMinutes} phút; tạm tính ${state.cart.totalVnd.toLocaleString('vi-VN')}đ.`;
    }

    if (!state.cart && state.menuSearchResults && state.menuSearchResults.length > 1) {
      const itemList = state.menuSearchResults
        .map((item) => `${item.name} (${item.priceVnd.toLocaleString('vi-VN')}đ)`)
        .join(', ');
      return `Mình tìm thấy ${state.menuSearchResults.length} món phù hợp trong dữ liệu KFC: ${itemList}. Bạn muốn chọn món nào?`;
    }

    return plannerFallbackText ?? 'Mình đã kiểm tra thông tin từ dữ liệu KFC. Bạn muốn mình tiếp tục thế nào?';
  }

  const reasons = new Set(state.escalationReasons);
  const highestPriorityReason =
    safeFallbackPriority.find((reason) => reasons.has(reason)) ?? state.escalationReasons[0] ?? 'needs_verified_info';

  switch (highestPriorityReason) {
    case 'order_confirmation_required':
      return 'Mình chưa thể đặt đơn khi chưa có xác nhận rõ ràng. Nếu bạn muốn chốt đơn, hãy nhắn "xác nhận đơn".';
    case 'valid_fulfillment_required':
      return 'Mình cần xác minh cửa hàng và hình thức nhận hoặc giao trước khi tiếp tục đặt đơn.';
    case 'payment_tool_success_required':
      return 'Mình chưa xác minh được trạng thái thanh toán thành công. Bạn gửi mã đơn để mình kiểm tra lại nhé.';
    case 'promotion_evidence_required':
      return 'Mình chưa có thông tin khuyến mãi đã được xác minh cho yêu cầu này. Bạn gửi thêm mã hoặc để mình kiểm tra ưu đãi công khai nhé.';
    case 'allergen_certainty_not_allowed':
      return 'Mình không thể khẳng định tuyệt đối về dị ứng từ dữ liệu hiện có. Mình có thể chia sẻ thông tin thành phần đã xác minh nếu bạn cần.';
    case 'tool_execution_failed':
      return 'Mình chưa thực hiện được thao tác này từ dữ liệu backend đã xác minh. Bạn kiểm tra lại món hoặc yêu cầu cần làm giúp mình nhé.';
    case 'cart_initialization_failed':
      return 'Mình chưa khởi tạo được giỏ hàng từ dữ liệu hiện có. Bạn thử lại món cần đặt giúp mình nhé.';
    case 'menu_item_verification_required':
      return 'Mình chưa xác minh được đầy đủ món bạn muốn đặt từ menu KFC. Bạn gửi lại tên món hoặc combo cụ thể hơn giúp mình nhé.';
    default:
      return 'Mình cần thêm thông tin đã được xác minh để hỗ trợ đúng. Bạn cho mình biết chi tiết cần kiểm tra tiếp nhé.';
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
    input.fallbackText.includes('Phương thức thanh toán này');

  if (input.turnInput.responseComposer && !useDeterministicPaymentMethodReply) {
    try {
      responseText = await input.turnInput.responseComposer.composeResponse({
        state: {
          ...input.state,
          toolTrace: input.currentTurnToolTrace,
        },
        replyIntent: input.replyIntent,
        fallbackText: input.fallbackText,
      });
    } catch (error) {
      await input.turnInput.store.appendEvent(input.turnInput.sessionId, 'llm:response_composer_failed', {
        message: error instanceof Error ? error.message : 'Unknown response composer failure',
        replyIntent: input.replyIntent,
      });
    }
  }

  const genUi = selectKfcGenUiAttachment({
    state: input.state,
    turnToolNames: input.currentTurnToolTrace.map((entry) => entry.toolName),
  });

  const turn = await input.turnInput.store.appendTurn({
    sessionId: input.turnInput.sessionId,
    channel: input.turnInput.channel,
    role: 'assistant',
    text: responseText,
    externalMessageId: null,
    externalUserId: input.turnInput.customerId,
    deliveryStatus: 'pending',
    metadata: genUi ? { genUi } : null,
  });
  emitDashboardEvent(input.turnInput, 'conversation_turn_created', {
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

export async function runAgentTurn(input: AgentTurnInput): Promise<AgentTurnOutput> {
  let priorVerifiedState = await loadPriorVerifiedState(input.store, input.sessionId);
  priorVerifiedState = await hydrateRecentOrderContext(input, priorVerifiedState);
  const retrievedEvidence = /chỗ cũ|same as before/i.test(input.text)
    ? (await input.store.searchHistory(input.sessionId, input.text)).map((result) => ({
        eventId: result.id,
        timestamp: result.createdAt,
        sourceType: result.sourceType,
        confidence: result.confidence,
        payload: result.payload,
      }))
    : [];

  const existingUserTurn = input.externalMessageId
    ? await input.store.findTurnByExternalMessage(input.sessionId, input.externalMessageId)
    : undefined;
  const userTurn =
    existingUserTurn ??
    (await input.store.appendTurn({
      sessionId: input.sessionId,
      channel: input.channel,
      role: 'user',
      text: input.text,
      externalMessageId: input.externalMessageId ?? null,
      externalUserId: input.customerId,
      deliveryStatus: 'received',
      metadata: input.metadata ?? null,
    }));
  if (!existingUserTurn) {
    emitDashboardEvent(input, 'customer_message_received', {
      turnId: userTurn.id,
      channel: userTurn.channel,
      externalMessageId: userTurn.externalMessageId,
      externalUserId: userTurn.externalUserId,
      text: userTurn.text,
      metadata: userTurn.metadata,
    });
    emitDashboardEvent(input, 'conversation_turn_created', {
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
  const recentTurns = buildBoundedRecentTurns(await input.store.listTurns(input.sessionId));

  const state: AgentGraphState = {
    sessionId: input.sessionId,
    customerId: input.customerId,
    channel: input.channel,
    latestUserMessage: input.text,
    recentTurns,
    intent: 'unclear',
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
      responseText: '',
      replyIntent: 'general_reply',
      suppressed: true,
    };
  }

  if (input.toolPlanner) {
    const currentTurnToolTrace: ToolTraceEntry[] = [];
    const multiStepEnabled = input.toolPlanner.supportsMultiStep === true;
    const maxPlannerIterations = multiStepEnabled ? multiStepPlannerIterations : singleStepPlannerIterations;
    const responseClaims = new Set<NonNullable<ToolPlannerOutput['responseClaims']>[number]>();
    let plannerFallbackText: string | undefined;
    let plannedAtLeastOnce = false;

    for (let iteration = 0; iteration < maxPlannerIterations; iteration += 1) {
      const rawPlan = await input.toolPlanner
        .plan({
          state,
          availableTools: toolNames,
          recentTurns,
        })
        .catch(async (error) => {
          await input.store.appendEvent(input.sessionId, 'llm:tool_planner_failed', {
            message: error instanceof Error ? error.message : 'Unknown tool planner failure',
          });
          return undefined;
        });

      if (!rawPlan) {
        if (!plannedAtLeastOnce && currentTurnToolTrace.length === 0) {
          return composeAndAppendAssistantTurn({
            turnInput: input,
            state,
            replyIntent: 'ask_clarification',
            fallbackText: 'Mình cần thêm thông tin để hỗ trợ đúng.',
            currentTurnToolTrace: [],
          });
        }
        break;
      }

      plannedAtLeastOnce = true;
      state.intent = rawPlan.intent;
      state.entities = rawPlan.entities;
      if (hasPlannerBooleanEntity(state, 'orderConfirmed')) {
        state.userConfirmedOrder = true;
      }
      const checksPaymentMethodSupport = rawPlan.toolCalls.some((call) => call.toolName === 'listPaymentMethods');
      rememberPlannerPaymentMethod(state, checksPaymentMethodSupport);
      for (const claim of rawPlan.responseClaims) responseClaims.add(claim);
      plannerFallbackText = rawPlan.directResponse ?? plannerFallbackText;

      if (rawPlan.toolCalls.length === 0) break;

      for (const call of rawPlan.toolCalls) {
        const gatingForCall = applySafetyGates(state, [call], { requireVerifiedItemCodes: multiStepEnabled });
        pushEscalationReasons(state, gatingForCall.blockedReasons);
        if (gatingForCall.allowedCalls.length === 0) {
          continue;
        }

        const ready = await ensureCartForTool(input, state, call);
        if (!ready) continue;

        if (call.toolName === 'placeOrder' && !state.orderPreview) {
          const previewCall: ToolCallRequest = { toolName: 'previewOrder', arguments: {} };
          const previewGating = applySafetyGates(state, [previewCall]);
          pushEscalationReasons(state, previewGating.blockedReasons);
          if (previewGating.allowedCalls.length === 0) continue;

          const previewResult = await executeToolCall(input.clients, state, previewCall, toolExecutionContext(input));
          applyToolResultToState(input, state, previewResult, previewCall.arguments, currentTurnToolTrace);
          if (!previewResult.ok) continue;
        }

        const result = await executeToolCall(input.clients, state, call, toolExecutionContext(input));
        applyToolResultToState(input, state, result, call.arguments, currentTurnToolTrace);
      }

      if (!multiStepEnabled) break;
    }

    if (!hasSuccessfulToolResult(currentTurnToolTrace, ['placeOrder'])) {
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
      state.intent === 'ordering' &&
      asksToMutateCart(state.latestUserMessage) &&
      isRecord(state.entities) &&
      typeof state.entities.itemText === 'string' &&
      currentTurnToolTrace.some((entry) => entry.toolName === 'searchMenu') &&
      !hasSuccessfulToolResult(currentTurnToolTrace, ['updateCart']) &&
      !state.cart
    ) {
      pushEscalationReasons(state, ['menu_item_verification_required']);
    }
    const gatingAfterExecution = applySafetyGates(
      { ...state, toolTrace: currentTurnToolTrace },
      [],
      { responseClaims: [...responseClaims] },
    );
    pushEscalationReasons(state, gatingAfterExecution.blockedReasons);
    emitDerivedEvents(input, state, currentTurnToolTrace);
    await persistVerifiedStateSnapshot(input.store, state);

    if (!(await isRunStillCurrent(input))) {
      return {
        state,
        responseText: '',
        replyIntent: 'general_reply',
        suppressed: true,
      };
    }

    return composeAndAppendAssistantTurn({
      turnInput: input,
      state,
      replyIntent: state.escalationReasons.length > 0 ? 'ask_clarification' : 'general_reply',
      fallbackText: selectSafeFallbackText(state, plannerFallbackText),
      currentTurnToolTrace,
    });
  }

  if (!(await isRunStillCurrent(input))) {
    return {
      state,
      responseText: '',
      replyIntent: 'general_reply',
      suppressed: true,
    };
  }

  return composeAndAppendAssistantTurn({
    turnInput: input,
    state,
    replyIntent: 'ask_clarification',
    fallbackText: 'Mình cần thêm thông tin để hỗ trợ đúng.',
    currentTurnToolTrace: [],
  });
}
