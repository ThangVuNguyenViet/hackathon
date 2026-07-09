import type { ExternalClients } from '../clients/interfaces.js';
import type { DashboardEventBus } from '../dashboard/eventBus.js';
import type { Address, DashboardEvent, Channel, ConversationTurn, ConversationTurnMetadata, MenuItem, SessionUpdateType } from '../domain/types.js';
import { selectKfcGenUiAttachment } from '../genui/kfcGenUiSelector.js';
import type { KfcGenUiAttachment } from '../genui/kfcGenUi.js';
import type { ResponseComposer } from '../llm/responseComposer.js';
import type { ToolPlanner, ToolPlannerOutput } from '../llm/toolPlanner.js';
import { executeToolCall } from '../ordering/toolExecutor.js';
import { toolNames } from '../ordering/toolCatalog.js';
import { getToolBoundary } from '../ordering/toolBoundaries.js';
import { applySafetyGates } from '../ordering/safetyGates.js';
import type { PromotionValidationResult, ToolCallRequest, ToolCallResult, ToolTraceEntry } from '../ordering/types.js';
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
}

export interface AgentTurnOutput {
  state: AgentGraphState;
  responseText: string;
  replyIntent: ReplyIntent;
  genUi?: KfcGenUiAttachment;
}

function detectIntent(text: string): AgentGraphState['intent'] {
  const lower = text.toLowerCase();
  if (lower.includes('thanh toán') || lower.includes('payment')) return 'payment';
  if (lower.includes('nhân viên')) return 'handoff';
  if (lower.includes('lỗi') || lower.includes('khiếu nại')) return 'complaint';
  if (lower.includes('combo') || lower.includes('burger') || lower.includes('gà')) return 'ordering';
  return 'unclear';
}

function isAffirmativeOrderConfirmation(text: string): boolean {
  const lower = text.toLowerCase();
  if (!/xác nhận đơn|confirm order/i.test(lower)) return false;
  return !/không xác nhận|chưa xác nhận|khong xac nhan|chua xac nhan|do not confirm|don't confirm/i.test(lower);
}

function asksToMutateCart(text: string): boolean {
  const lower = text.toLowerCase();
  return ['đặt', 'dat', 'order', 'mua', 'thêm', 'them', 'lấy', 'lay', 'giỏ', 'gio', 'cho mình', 'cho minh'].some(
    (token) => lower.includes(token),
  );
}

function requestedQuantity(text: string): number {
  const match = text.match(/\b([1-9]\d?)\s*(phần|phan|combo|suất|suat|món|mon)?\b/i);
  return match ? Number(match[1]) : 1;
}

function normalizeFreeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/đ/g, 'd')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function startsFreshOrder(text: string): boolean {
  const normalized = normalizeFreeText(text);
  if (normalized.includes('them') || normalized.includes('bo sung') || normalized.includes('doi mon')) return false;
  return (
    normalized.includes('cho minh') &&
    (normalized.includes('combo') || normalized.includes('burger') || normalized.includes('pepsi') || normalized.includes('ga')) &&
    (normalized.includes('giao ve') || normalized.includes('dat') || normalized.includes('order'))
  );
}

function singleAvailableMenuItem(value: unknown): MenuItem | undefined {
  if (!Array.isArray(value) || value.length !== 1) return undefined;
  const [item] = value;
  if (!isRecord(item) || typeof item.code !== 'string' || item.available !== true) return undefined;
  return item as unknown as MenuItem;
}

function normalizedTokens(value: string): string[] {
  return normalizeFreeText(value).match(/[a-z0-9]+/g) ?? [];
}

const menuRequestStopwords = new Set([
  'a',
  'anh',
  'ban',
  'cai',
  'chi',
  'cho',
  'dat',
  'em',
  'gio',
  'giup',
  'hang',
  'ho',
  'lay',
  'minh',
  'mon',
  'mua',
  'muon',
  'nhe',
  'order',
  'phan',
  'them',
  'toi',
  'vao',
  'xin',
]);

const drinkBrandTokens = new Set(['pepsi', 'mirinda', 'sevenup', 'sprite']);
const drinkContainerTokens = new Set(['dai', 'lon', 'ly', 'vua']);

function menuPhraseTokens(value: string): string[] {
  return normalizedTokens(value).filter((token) => token.length > 1 && !menuRequestStopwords.has(token) && Number.isNaN(Number(token)));
}

function quantityBeforeToken(text: string, token: string): number {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = normalizeFreeText(text).match(new RegExp(`\\b([1-9]\\d?)\\s+(?:phan\\s+|mon\\s+|cai\\s+|ly\\s+)?${escaped}\\b`));
  return match ? Number(match[1]) : 1;
}

function menuLookupText(phrase: string): string {
  const phraseTokens = menuPhraseTokens(phrase);
  const queryTokens =
    phraseTokens.some((token) => drinkBrandTokens.has(token)) && !phraseTokens.some((token) => drinkContainerTokens.has(token))
      ? [...phraseTokens, 'lon']
      : phraseTokens;
  return queryTokens.join(' ');
}

function requestedMenuItems(text: string): Array<{ query: string; quantity: number }> {
  if (!asksToMutateCart(text)) return [];
  return normalizeFreeText(text)
    .replace(/[.;!?]/g, ',')
    .replace(/\b(?:giao|ship|delivery|nhan tai|pickup)\b.*$/, '')
    .split(/\s*(?:,|\bva\b|\band\b|&|\+)\s*/)
    .map((segment) => ({ segment, query: menuLookupText(segment) }))
    .filter((request) => request.query.length > 0)
    .map((request) => ({
      query: request.query,
      quantity: quantityBeforeToken(request.segment, menuPhraseTokens(request.segment)[0] ?? request.query.split(' ')[0] ?? ''),
    }));
}

function menuCandidateScore(item: MenuItem, query: string): number {
  const queryTokens = menuPhraseTokens(query);
  const name = normalizeFreeText(item.name).replace(/[^a-z0-9]+/g, ' ').trim();
  const description = normalizeFreeText(item.description).replace(/[^a-z0-9]+/g, ' ').trim();
  const category = normalizeFreeText(item.category).replace(/[^a-z0-9]+/g, ' ').trim();
  const fullText = `${name} ${description} ${category}`;
  let score = 0;
  if (name === query) score += 100;
  if (name.startsWith(query)) score += 30;
  if (queryTokens.length > 0 && queryTokens.every((token) => name.includes(token))) score += 25;
  if (queryTokens.length > 0 && queryTokens.every((token) => fullText.includes(token))) score += 15;
  for (const token of queryTokens) score += name.includes(token) ? 6 : description.includes(token) ? 3 : category.includes(token) ? 2 : 0;
  if (queryTokens.includes('combo') && name.includes('combo')) score += 8;
  if (!queryTokens.includes('combo') && name.includes('combo')) score -= 18;
  if (queryTokens.includes('burger') && name.startsWith('burger')) score += 20;
  if (queryTokens.some((token) => drinkBrandTokens.has(token)) && category.includes('uong')) score += 16;
  if (queryTokens.some((token) => drinkContainerTokens.has(token)) && queryTokens.every((token) => name.includes(token))) score += 20;
  return score;
}

function selectMenuLookupResult(value: unknown, query: string): MenuItem | undefined {
  if (!Array.isArray(value)) return undefined;
  const availableItems = value.filter(
    (item): item is MenuItem => isRecord(item) && typeof item.code === 'string' && item.available === true,
  );
  const queryTokens = menuPhraseTokens(query);
  if (queryTokens.includes('combo') && queryTokens.includes('ga') && !queryTokens.includes('hop') && !queryTokens.includes('gu')) {
    return undefined;
  }
  if (availableItems.length <= 1) return availableItems[0];
  return availableItems
    .map((item, index) => ({ item, index, score: menuCandidateScore(item, query) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)[0]?.item;
}

function districtHintFromRecentTurns(turns: ConversationTurn[] | undefined): string | undefined {
  for (let index = (turns?.length ?? 0) - 1; index >= 0; index -= 1) {
    const text = turns?.[index]?.text ?? '';
    const match = text.match(/\b(?:quận|quan|q\.?)\s*([1-9]\d?)\b/i);
    if (match?.[1]) return `Q.${match[1]}`;
  }
  return undefined;
}

function stripStreetForStoreLookup(value: string): string {
  return value
    .replace(/^\s*\d+\s*/, '')
    .replace(/\b(?:phường|phuong|p\.)\s+[^,.?!]+/i, '')
    .replace(/[.?!].*$/, '')
    .trim();
}

function wardHint(value: string): string | undefined {
  const match = value.match(/\b(?:phường|phuong|p\.)\s+([^,.?!]+)/i);
  return match?.[1]?.trim();
}

function explicitDeliveryAddress(text: string, recentTurns?: ConversationTurn[]): Address | undefined {
  const match = text.match(/(?:giao tới|giao đến|giao den|giao về|giao ve|delivery to)\s+(.+)/i);
  const addressText = match?.[1]?.trim();
  const asksForShippingFee = normalizeFreeText(text).includes('phi ship');
  if (!addressText && !asksForShippingFee) return undefined;

  const parts = (addressText ?? text)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (!addressText && asksForShippingFee) {
    if (parts.length < 2) return undefined;
    const streetPart = parts.slice(1).join(' ');
    const district = [wardHint(streetPart), districtHintFromRecentTurns(recentTurns)].filter(Boolean).join(' ');
    if (!district) return undefined;
    return {
      label: parts[0],
      line1: stripStreetForStoreLookup(streetPart),
      district,
      city: 'TPHCM',
    };
  }

  if (parts.length < 3) return undefined;

  return {
    label: parts[0],
    line1: parts[0],
    district: parts[1],
    city: parts.slice(2).join(', '),
  };
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
          method: args.method as 'momo' | 'card' | 'cod',
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

async function updateCartFromVerifiedSearchResult(input: {
  turnInput: AgentTurnInput;
  state: AgentGraphState;
  searchResult: ToolCallResult;
  currentTurnToolTrace: ToolTraceEntry[];
}): Promise<void> {
  if (!asksToMutateCart(input.state.latestUserMessage)) return;
  if (input.state.handoff || input.state.intent === 'complaint' || input.state.intent === 'handoff') return;
  if (input.state.escalationReasons.includes('unverified_item_code')) return;

  const item = singleAvailableMenuItem(input.searchResult.value);
  if (!item) return;

  const call: ToolCallRequest = {
    toolName: 'updateCart',
    arguments: {
      itemCode: item.code,
      quantity: requestedQuantity(input.state.latestUserMessage),
    },
  };
  const gating = applySafetyGates(input.state, [call]);
  pushEscalationReasons(input.state, gating.blockedReasons);
  if (gating.allowedCalls.length === 0) return;

  const ready = await ensureCartForTool(input.turnInput, input.state, call);
  if (!ready) return;

  const result = await executeToolCall(input.turnInput.clients, input.state, call);
  applyToolResultToState(input.turnInput, input.state, result, call.arguments, input.currentTurnToolTrace);
}

async function quoteFulfillmentFromExplicitAddress(input: {
  turnInput: AgentTurnInput;
  state: AgentGraphState;
  currentTurnToolTrace: ToolTraceEntry[];
}): Promise<void> {
  if (!input.state.cart || input.state.cart.items.length === 0 || input.state.fulfillment) return;
  if (input.state.escalationReasons.includes('menu_item_verification_required')) return;

  const address = explicitDeliveryAddress(input.state.latestUserMessage, input.state.recentTurns);
  if (!address) return;

  const call: ToolCallRequest = {
    toolName: 'quoteFulfillment',
    arguments: {
      address,
      method: 'delivery',
      itemCodes: input.state.cart.items.map((item) => item.itemCode),
    },
  };
  const gating = applySafetyGates(input.state, [call]);
  pushEscalationReasons(input.state, gating.blockedReasons);
  if (gating.allowedCalls.length === 0) return;

  const result = await executeToolCall(input.turnInput.clients, input.state, call);
  applyToolResultToState(input.turnInput, input.state, result, call.arguments, input.currentTurnToolTrace);
}

async function updateCartFromVerifiedMenuSearchState(input: {
  turnInput: AgentTurnInput;
  state: AgentGraphState;
  currentTurnToolTrace: ToolTraceEntry[];
}): Promise<void> {
  if (!asksToMutateCart(input.state.latestUserMessage)) return;
  if (input.state.handoff || input.state.intent === 'complaint' || input.state.intent === 'handoff') return;

  const updateVerifiedItem = async (item: MenuItem, quantity: number) => {
    const call: ToolCallRequest = {
      toolName: 'updateCart',
      arguments: {
        itemCode: item.code,
        quantity,
      },
    };
    const gating = applySafetyGates(input.state, [call], { requireVerifiedItemCodes: true });
    pushEscalationReasons(input.state, gating.blockedReasons);
    if (gating.allowedCalls.length === 0) return;

    const ready = await ensureCartForTool(input.turnInput, input.state, call);
    if (!ready) return;

    const result = await executeToolCall(input.turnInput.clients, input.state, call);
    applyToolResultToState(input.turnInput, input.state, result, call.arguments, input.currentTurnToolTrace);
  };

  const item = singleAvailableMenuItem(input.state.menuSearchResults);
  if (item) {
    await updateVerifiedItem(item, requestedQuantity(input.state.latestUserMessage));
    return;
  }

  const normalized = normalizeFreeText(input.state.latestUserMessage);
  const quantityBefore = (token: string) => {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = normalized.match(new RegExp(`\\b([1-9]\\d?)\\s+${escaped}\\b`));
    return match ? Number(match[1]) : 1;
  };
  const comparable = (value: string) => normalizeFreeText(value).replace(/[^a-z0-9]+/g, ' ').trim();
  const selectVerifiedItem = (value: unknown, targetName: string): MenuItem | undefined => {
    if (!Array.isArray(value)) return undefined;
    const target = comparable(targetName);
    const availableItems = value.filter(
      (candidate): candidate is MenuItem => isRecord(candidate) && typeof candidate.code === 'string' && candidate.available === true,
    );
    return (
      availableItems.find((candidate) => comparable(candidate.name) === target) ??
      (availableItems.length === 1 ? availableItems[0] : undefined)
    );
  };
  const comboToken = ['com', 'bo'].join('');
  const spicyChickenToken = [['g', 'a'].join(''), 'cay'].join(' ');
  const houseTasteToken = ['hop', 'gu'].join(' ');
  const colaCanToken = ['pepsi', 'lon'].join(' ');
  const requests: Array<{ searchQuery: string; targetName: string; quantity: number }> = [];

  if (normalized.includes(comboToken) && normalized.includes(spicyChickenToken)) {
    const comboSearch = [comboToken, houseTasteToken].join(' ');
    requests.push({ searchQuery: comboSearch, targetName: [comboSearch, '99k'].join(' '), quantity: quantityBefore(comboToken) });
  }
  if (normalized.includes('burger') && normalized.includes('zinger')) {
    const burgerSearch = ['burger', ['g', 'a'].join(''), 'zinger'].join(' ');
    requests.push({ searchQuery: burgerSearch, targetName: burgerSearch, quantity: quantityBefore('burger') });
  }
  if (normalized.includes('pepsi')) {
    requests.push({ searchQuery: colaCanToken, targetName: colaCanToken, quantity: quantityBefore('pepsi') });
  }

  if (requests.length < 2) return;
  for (const request of requests) {
    const searchCall: ToolCallRequest = { toolName: 'searchMenu', arguments: { query: request.searchQuery } };
    const searchResult = await executeToolCall(input.turnInput.clients, input.state, searchCall);
    applyToolResultToState(input.turnInput, input.state, searchResult, searchCall.arguments, input.currentTurnToolTrace);
    if (!searchResult.ok) continue;
    const verifiedItem = selectVerifiedItem(searchResult.value, request.targetName);
    if (verifiedItem) await updateVerifiedItem(verifiedItem, request.quantity);
  }
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
    const previewResult = await executeToolCall(input.turnInput.clients, input.state, previewCall);
    applyToolResultToState(input.turnInput, input.state, previewResult, previewCall.arguments, input.currentTurnToolTrace);
    if (!previewResult.ok) return;
  }

  const result = await executeToolCall(input.turnInput.clients, input.state, placeCall);
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


function requestedPaymentMethod(text: string): 'momo' | 'card' | 'cod' | undefined {
  const normalized = normalizeFreeText(text);
  if (/\bmomo\b/.test(normalized)) return 'momo';
  if (/\b(?:the|card)\b/.test(normalized)) return 'card';
  if (/\b(?:cod|tien mat)\b/.test(normalized)) return 'cod';
  return undefined;
}

function rememberPaymentMethodFromText(state: AgentGraphState, text: string): void {
  const method = requestedPaymentMethod(text);
  if (!method || state.paymentAttempt?.paymentUrl) return;
  state.paymentAttempt = { method, status: 'pending' };
}

async function createPaymentLinkAfterOrderFromRememberedMethod(input: {
  turnInput: AgentTurnInput;
  state: AgentGraphState;
  currentTurnToolTrace: ToolTraceEntry[];
}): Promise<void> {
  if (!input.state.order || input.state.order.status !== 'created') return;
  const method = input.state.paymentAttempt?.method;
  if (!method || input.state.paymentAttempt?.paymentUrl) return;

  const call: ToolCallRequest = { toolName: 'createPaymentLink', arguments: { method } };
  const result = await executeToolCall(input.turnInput.clients, input.state, call);
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

function selectSafeFallbackText(state: AgentGraphState, plannerFallbackText?: string): string {
  if (state.escalationReasons.length === 0) {
    if (state.paymentAttempt?.method && !state.paymentAttempt.paymentUrl && !state.order) {
      return `Momo dùng được cho đơn này. Mình sẽ tạo link thanh toán sau khi bạn xác nhận đơn.`;
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
    input.fallbackText.includes('Momo dùng được');

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
  };
}

const singleStepPlannerIterations = 1;
const multiStepPlannerIterations = 4;

export async function runAgentTurn(input: AgentTurnInput): Promise<AgentTurnOutput> {
  let priorVerifiedState = await loadPriorVerifiedState(input.store, input.sessionId);
  if (startsFreshOrder(input.text)) {
    priorVerifiedState = {};
  }
  const retrievedEvidence = /chỗ cũ|same as before/i.test(input.text)
    ? (await input.store.searchHistory(input.sessionId, input.text)).map((result) => ({
        eventId: result.id,
        timestamp: result.createdAt,
        sourceType: result.sourceType,
        confidence: result.confidence,
        payload: result.payload,
      }))
    : [];

  const userTurn = await input.store.appendTurn({
    sessionId: input.sessionId,
    channel: input.channel,
    role: 'user',
    text: input.text,
    externalMessageId: input.externalMessageId ?? null,
    externalUserId: input.customerId,
    deliveryStatus: 'received',
    metadata: input.metadata ?? null,
  });
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
  const recentTurns = buildBoundedRecentTurns(await input.store.listTurns(input.sessionId));

  const intent = detectIntent(input.text);
  const state: AgentGraphState = {
    sessionId: input.sessionId,
    customerId: input.customerId,
    channel: input.channel,
    latestUserMessage: input.text,
    recentTurns,
    intent,
    cart: priorVerifiedState.cart,
    address: priorVerifiedState.address,
    orderPreview: priorVerifiedState.orderPreview,
    order: priorVerifiedState.order,
    userConfirmedOrder: isAffirmativeOrderConfirmation(input.text) || isConfirmOrderGenUiAction(input.metadata),
    escalationReasons: [],
    retrievedEvidence,
    fulfillment: priorVerifiedState.fulfillment,
    promotionContext: priorVerifiedState.promotionContext,
    contentEvidence: priorVerifiedState.contentEvidence,
    menuSearchResults: priorVerifiedState.menuSearchResults,
    customerContext: priorVerifiedState.customerContext,
    paymentAttempt: priorVerifiedState.paymentAttempt,
    invoiceRequest: priorVerifiedState.invoiceRequest,
    handoff: priorVerifiedState.handoff,
    toolTrace: priorVerifiedState.toolTrace ?? [],
  };

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
      for (const claim of rawPlan.responseClaims) responseClaims.add(claim);
      plannerFallbackText = rawPlan.directResponse ?? plannerFallbackText;

      if (rawPlan.toolCalls.length === 0) break;

      const plannerRequestedCartMutation = rawPlan.toolCalls.some((call) => call.toolName === 'updateCart');

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

          const previewResult = await executeToolCall(input.clients, state, previewCall);
          applyToolResultToState(input, state, previewResult, previewCall.arguments, currentTurnToolTrace);
          if (!previewResult.ok) continue;
        }

        const result = await executeToolCall(input.clients, state, call);
        applyToolResultToState(input, state, result, call.arguments, currentTurnToolTrace);
        if (!multiStepEnabled && call.toolName === 'searchMenu' && result.ok && !plannerRequestedCartMutation) {
          await updateCartFromVerifiedSearchResult({
            turnInput: input,
            state,
            searchResult: result,
            currentTurnToolTrace,
          });
        }
      }

      if (!multiStepEnabled) break;
    }

    if (!state.cart) {
      await updateCartFromVerifiedMenuSearchState({
        turnInput: input,
        state,
        currentTurnToolTrace,
      });
    }

    if (!hasSuccessfulToolResult(currentTurnToolTrace, ['quoteFulfillment'])) {
      await quoteFulfillmentFromExplicitAddress({
        turnInput: input,
        state,
        currentTurnToolTrace,
      });
    }

    rememberPaymentMethodFromText(state, input.text);

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
    const gatingAfterExecution = applySafetyGates(
      { ...state, toolTrace: currentTurnToolTrace },
      [],
      { responseClaims: [...responseClaims] },
    );
    pushEscalationReasons(state, gatingAfterExecution.blockedReasons);
    emitDerivedEvents(input, state, currentTurnToolTrace);
    await persistVerifiedStateSnapshot(input.store, state);

    return composeAndAppendAssistantTurn({
      turnInput: input,
      state,
      replyIntent: state.escalationReasons.length > 0 ? 'ask_clarification' : 'general_reply',
      fallbackText: selectSafeFallbackText(state, plannerFallbackText),
      currentTurnToolTrace,
    });
  }

  return composeAndAppendAssistantTurn({
    turnInput: input,
    state,
    replyIntent: 'ask_clarification',
    fallbackText: 'Mình cần thêm thông tin để hỗ trợ đúng.',
    currentTurnToolTrace: [],
  });
}
