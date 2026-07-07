import type { ExternalClients } from '../clients/interfaces.js';
import type { DashboardEventBus } from '../dashboard/eventBus.js';
import type { DashboardEvent, Channel, SessionUpdateType } from '../domain/types.js';
import type { ResponseComposer } from '../llm/responseComposer.js';
import type { ToolPlanner } from '../llm/toolPlanner.js';
import { executeToolCall } from '../ordering/toolExecutor.js';
import { toolNames } from '../ordering/toolCatalog.js';
import { applySafetyGates } from '../ordering/safetyGates.js';
import type { PromotionValidationResult, ToolCallRequest, ToolCallResult, ToolTraceEntry } from '../ordering/types.js';
import type { MemoryStore } from '../persistence/memoryStore.js';
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
  store: MemoryStore;
  dashboard: DashboardEventBus;
  responseComposer?: ResponseComposer;
  toolPlanner?: ToolPlanner;
}

export interface AgentTurnOutput {
  state: AgentGraphState;
  responseText: string;
  replyIntent: ReplyIntent;
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

const fixedTimestamp = new Date('2026-07-07T00:00:00.000Z').toISOString();
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
  | 'customerContext'
  | 'paymentAttempt'
  | 'invoiceRequest'
  | 'handoff'
  | 'toolTrace'
>;

function emitDashboardEvent(input: AgentTurnInput, type: DashboardEvent['type'], payload: Record<string, unknown>): void {
  input.dashboard.emitEvent({
    id: `dash_${input.sessionId}_${type}_${input.dashboard.getEvents(input.sessionId).length + 1}`,
    sessionId: input.sessionId,
    type,
    payload,
    createdAt: fixedTimestamp,
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

function traceFromResult(result: ToolCallResult, args: Record<string, unknown>): ToolTraceEntry {
  return {
    toolName: result.toolName,
    arguments: args,
    ok: result.ok,
    resultSummary: result.ok ? result.message : result.errorCode ?? result.message,
    provenance: result.provenance,
  };
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

async function loadPriorVerifiedState(store: MemoryStore, sessionId: string): Promise<Partial<VerifiedStateSnapshot>> {
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
    customerContext: state.customerContext,
    paymentAttempt: state.paymentAttempt,
    invoiceRequest: state.invoiceRequest,
    handoff: state.handoff,
    toolTrace: state.toolTrace ?? [],
  };
}

async function persistVerifiedStateSnapshot(store: MemoryStore, state: AgentGraphState): Promise<void> {
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

  emitSessionUpdate(input, {
    updateType: 'tool_called',
    toolName: result.toolName,
    ok: result.ok,
    resultSummary: result.message,
    provenance: result.provenance,
  });

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

function hasSuccessfulToolResult(entries: ToolTraceEntry[], toolNames: ToolTraceEntry['toolName'][]): boolean {
  return entries.some((entry) => entry.ok && toolNames.includes(entry.toolName));
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
] as const;

function selectSafeFallbackText(state: AgentGraphState, plannerFallbackText?: string): string {
  if (state.escalationReasons.length === 0) {
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
    default:
      return 'Mình cần thêm thông tin đã được xác minh để hỗ trợ đúng. Bạn cho mình biết chi tiết cần kiểm tra tiếp nhé.';
  }
}

async function composeAndAppendAssistantTurn(input: {
  turnInput: AgentTurnInput;
  state: AgentGraphState;
  fallbackText: string;
  replyIntent: ReplyIntent;
}): Promise<AgentTurnOutput> {
  let responseText = input.fallbackText;
  if (input.turnInput.responseComposer) {
    try {
      responseText = await input.turnInput.responseComposer.composeResponse({
        state: input.state,
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

  await input.turnInput.store.appendTurn({
    sessionId: input.turnInput.sessionId,
    channel: input.turnInput.channel,
    role: 'assistant',
    text: responseText,
    externalMessageId: null,
    externalUserId: input.turnInput.customerId,
    deliveryStatus: 'pending',
  });

  return {
    state: input.state,
    responseText,
    replyIntent: input.replyIntent,
  };
}

export async function runAgentTurn(input: AgentTurnInput): Promise<AgentTurnOutput> {
  const priorVerifiedState = await loadPriorVerifiedState(input.store, input.sessionId);
  const retrievedEvidence = /chỗ cũ|same as before/i.test(input.text)
    ? (await input.store.searchHistory(input.sessionId, input.text)).map((result) => ({
        eventId: result.id,
        timestamp: result.createdAt,
        sourceType: result.sourceType,
        confidence: result.confidence,
        payload: result.payload,
      }))
    : [];

  await input.store.appendTurn({
    sessionId: input.sessionId,
    channel: input.channel,
    role: 'user',
    text: input.text,
    externalMessageId: null,
    externalUserId: input.customerId,
    deliveryStatus: 'received',
  });

  const intent = detectIntent(input.text);
  const state: AgentGraphState = {
    sessionId: input.sessionId,
    customerId: input.customerId,
    channel: input.channel,
    latestUserMessage: input.text,
    intent,
    cart: priorVerifiedState.cart,
    address: priorVerifiedState.address,
    orderPreview: priorVerifiedState.orderPreview,
    order: priorVerifiedState.order,
    userConfirmedOrder: isAffirmativeOrderConfirmation(input.text),
    escalationReasons: [],
    retrievedEvidence,
    fulfillment: priorVerifiedState.fulfillment,
    promotionContext: priorVerifiedState.promotionContext,
    contentEvidence: priorVerifiedState.contentEvidence,
    customerContext: priorVerifiedState.customerContext,
    paymentAttempt: priorVerifiedState.paymentAttempt,
    invoiceRequest: priorVerifiedState.invoiceRequest,
    handoff: priorVerifiedState.handoff,
    toolTrace: priorVerifiedState.toolTrace ?? [],
  };

  if (input.toolPlanner) {
    const turns = await input.store.listTurns(input.sessionId);
    const plan = await input.toolPlanner.plan({
      state,
      availableTools: toolNames,
      recentTurns: turns,
    });

    state.intent = plan.intent;
    state.entities = plan.entities;

    const currentTurnToolTrace: ToolTraceEntry[] = [];

    for (const call of plan.toolCalls) {
      const gatingForCall = applySafetyGates(state, [call]);
      pushEscalationReasons(state, gatingForCall.blockedReasons);
      if (gatingForCall.allowedCalls.length === 0) {
        continue;
      }

      const ready = await ensureCartForTool(input, state, call);
      if (!ready) continue;

      const result = await executeToolCall(input.clients, state, call);
      applyToolResultToState(input, state, result, call.arguments, currentTurnToolTrace);
    }

    const gatingAfterExecution = applySafetyGates(
      { ...state, toolTrace: currentTurnToolTrace },
      [],
      { responseClaims: plan.responseClaims },
    );
    pushEscalationReasons(state, gatingAfterExecution.blockedReasons);
    emitDerivedEvents(input, state, currentTurnToolTrace);
    await persistVerifiedStateSnapshot(input.store, state);

    return composeAndAppendAssistantTurn({
      turnInput: input,
      state,
      replyIntent: state.escalationReasons.length > 0 ? 'ask_clarification' : 'general_reply',
      fallbackText: selectSafeFallbackText(state, plan.directResponse),
    });
  }

  return composeAndAppendAssistantTurn({
    turnInput: input,
    state,
    replyIntent: 'ask_clarification',
    fallbackText: 'Mình cần thêm thông tin để hỗ trợ đúng.',
  });
}
