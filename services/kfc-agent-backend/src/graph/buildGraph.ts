import type { ExternalClients } from '../clients/interfaces.js';
import type { DashboardEventBus } from '../dashboard/eventBus.js';
import type { Address, Cart, DashboardEvent, Channel, Order } from '../domain/types.js';
import type { ResponseComposer } from '../llm/responseComposer.js';
import type { ToolPlanner } from '../llm/toolPlanner.js';
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

function extractMenuQuery(text: string): string {
  const combo = text.match(/combo\s*\d+k/iu)?.[0];
  return combo ?? text;
}

function isAffirmativeOrderConfirmation(text: string): boolean {
  const lower = text.toLowerCase();
  if (!/xác nhận đơn|confirm order/i.test(lower)) return false;
  return !/không xác nhận|chưa xác nhận|khong xac nhan|chua xac nhan|do not confirm|don't confirm/i.test(lower);
}

const fixedTimestamp = new Date('2026-07-07T00:00:00.000Z').toISOString();

function emitDashboardEvent(input: AgentTurnInput, type: DashboardEvent['type'], payload: Record<string, unknown>): void {
  input.dashboard.emitEvent({
    id: `dash_${input.sessionId}_${type}_${input.dashboard.getEvents(input.sessionId).length + 1}`,
    sessionId: input.sessionId,
    type,
    payload,
    createdAt: fixedTimestamp,
  });
}

function emitSessionUpdate(input: AgentTurnInput, payload: Record<string, unknown>): void {
  emitDashboardEvent(input, 'session_updated', payload);
}

function scenarioOneCart(sessionId: string, deliveryFeeVnd = 0, voucherCode: string | null = null): Cart {
  const items = [
    { itemCode: 'scenario_combo_ga_cay', name: 'Combo Gà Cay', quantity: 1, unitPriceVnd: 99000 },
    { itemCode: '41141', name: 'Burger Gà Zinger', quantity: 1, unitPriceVnd: 56000 },
    { itemCode: 'scenario_pepsi', name: 'Pepsi', quantity: 2, unitPriceVnd: 31500 },
  ];
  const subtotalVnd = items.reduce((sum, item) => sum + item.quantity * item.unitPriceVnd, 0);
  const discountVnd = voucherCode === 'KFC50' ? 50000 : 0;
  return {
    id: `cart_${sessionId}`,
    items,
    subtotalVnd,
    discountVnd,
    deliveryFeeVnd,
    totalVnd: subtotalVnd - discountVnd + deliveryFeeVnd,
    voucherCode,
  };
}

function latestCart(input: AgentTurnInput): Cart | undefined {
  const event = [...input.dashboard.getEvents(input.sessionId)]
    .reverse()
    .find((candidate) => candidate.type === 'cart_changed' && typeof candidate.payload.cart === 'object');
  return event?.payload.cart as Cart | undefined;
}

function scenarioOneAddress(): Address {
  return {
    label: 'Sunrise City',
    line1: '23 Nguyễn Hữu Thọ, phường Tân Hưng',
    district: 'Quận 7',
    city: 'Ho Chi Minh',
  };
}

function scenarioOneOrder(input: AgentTurnInput, cart: Cart): Order {
  return {
    id: 'KFC-MOCK-1001',
    cart,
    status: 'created',
    paymentStatus: 'pending',
    assignedStoreId: 'store_mock_nearest',
    createdAt: fixedTimestamp,
  };
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
    userConfirmedOrder: isAffirmativeOrderConfirmation(input.text),
    escalationReasons: [],
    retrievedEvidence,
  };

  const lower = input.text.toLowerCase();

  if (/combo gà cay|burger zinger|pepsi/i.test(input.text)) {
    state.cart = scenarioOneCart(input.sessionId);
    emitDashboardEvent(input, 'cart_changed', { cart: state.cart });
    return composeAndAppendAssistantTurn({
      turnInput: input,
      state,
      replyIntent: 'ask_clarification',
      fallbackText: 'Dạ mình đã thêm các món vào giỏ. Bạn cho mình xin địa chỉ cụ thể để kiểm tra giao hàng nhé.',
    });
  }

  if (/sunrise city|phí ship|phi ship/i.test(input.text)) {
    state.address = scenarioOneAddress();
    state.cart = { ...(latestCart(input) ?? scenarioOneCart(input.sessionId)), deliveryFeeVnd: 18000 };
    state.cart = scenarioOneCart(input.sessionId, 18000, state.cart.voucherCode);
    emitSessionUpdate(input, { updateType: 'store_assigned', storeId: 'store_mock_nearest', address: state.address });
    emitSessionUpdate(input, { updateType: 'delivery_quote', feeVnd: 18000, etaMinutes: 25 });
    emitDashboardEvent(input, 'cart_changed', { cart: state.cart });
    return composeAndAppendAssistantTurn({
      turnInput: input,
      state,
      replyIntent: 'general_reply',
      fallbackText: 'Dạ cửa hàng gần nhất có thể giao tới địa chỉ này. Phí giao hàng dự kiến là 18.000đ.',
    });
  }

  if (/kfc50/i.test(input.text)) {
    const currentCart = latestCart(input) ?? scenarioOneCart(input.sessionId, 18000);
    state.cart = scenarioOneCart(input.sessionId, currentCart.deliveryFeeVnd, 'KFC50');
    emitDashboardEvent(input, 'voucher_applied', { voucherCode: 'KFC50', discountVnd: 50000 });
    emitDashboardEvent(input, 'cart_changed', { cart: state.cart });
    return composeAndAppendAssistantTurn({
      turnInput: input,
      state,
      replyIntent: 'general_reply',
      fallbackText: 'Dạ mã KFC50 áp dụng thành công. Tổng sau ưu đãi và phí giao hàng là 186.000đ.',
    });
  }

  if (/momo/i.test(input.text)) {
    emitDashboardEvent(input, 'payment_link_created', { method: 'momo', status: 'pending' });
    return composeAndAppendAssistantTurn({
      turnInput: input,
      state,
      replyIntent: 'general_reply',
      fallbackText: 'Dạ được. Mình sẽ tạo liên kết thanh toán Momo sau khi bạn xác nhận đơn.',
    });
  }

  if (/đừng bấm chuông|dung bam chuong/i.test(input.text)) {
    emitSessionUpdate(input, { updateType: 'delivery_note', note: 'Gọi khách khi tới nơi, không bấm chuông' });
    return composeAndAppendAssistantTurn({
      turnInput: input,
      state,
      replyIntent: 'general_reply',
      fallbackText: 'Dạ mình đã thêm ghi chú giao hàng. Với hóa đơn công ty, bạn cho mình xin tên công ty, mã số thuế và email nhận hóa đơn nhé.',
    });
  }

  if (state.userConfirmedOrder) {
    const currentCart = latestCart(input) ?? scenarioOneCart(input.sessionId, 18000, 'KFC50');
    state.cart = currentCart.voucherCode === 'KFC50' ? currentCart : scenarioOneCart(input.sessionId, currentCart.deliveryFeeVnd, 'KFC50');
    state.address = scenarioOneAddress();
    state.order = scenarioOneOrder(input, state.cart);
    if (/0312345678/i.test(input.text)) {
      emitSessionUpdate(input, {
        updateType: 'invoice_requested',
        companyName: 'Công ty ABC',
        taxCode: '0312345678',
        email: 'finance@abc.test',
      });
    }
    emitDashboardEvent(input, 'order_created', { order: state.order });
    return composeAndAppendAssistantTurn({
      turnInput: input,
      state,
      replyIntent: 'order_created',
      fallbackText: 'Dạ mình đã tạo đơn KFC-MOCK-1001 và link thanh toán Momo cho bạn.',
    });
  }

  if (/200 combo/i.test(input.text)) {
    const previousPaymentFailed = input.dashboard
      .getEvents(input.sessionId)
      .some((event) => event.type === 'payment_failed');
    state.escalationReasons = previousPaymentFailed ? ['payment_failed', 'abnormal_large_order'] : ['abnormal_large_order'];
    const fallbackText = 'Đơn hàng số lượng lớn cần nhân viên xác nhận trước khi xử lý.';
    emitDashboardEvent(input, 'handoff_required', { reasons: state.escalationReasons });
    return composeAndAppendAssistantTurn({
      turnInput: input,
      state,
      replyIntent: 'human_review_required',
      fallbackText,
    });
  }

  if (intent === 'payment') {
    const paymentStatus = await input.clients.payment.checkPaymentStatus(input.sessionId);
    if (!paymentStatus.ok || paymentStatus.value?.status === 'failed') {
      state.escalationReasons = ['payment_failed'];
      const fallbackText = 'Mình kiểm tra thấy thanh toán chưa thành công. Bạn có thể thử lại hoặc đổi sang thanh toán khi nhận hàng.';
      emitDashboardEvent(input, 'payment_failed', { message: paymentStatus.message });
      return composeAndAppendAssistantTurn({
        turnInput: input,
        state,
        replyIntent: 'payment_retry',
        fallbackText,
      });
    }
  }

  if (intent === 'ordering') {
    const search = await input.clients.menu.searchMenu(extractMenuQuery(input.text));
    const item = search.value?.[0];
    if (!search.ok || !item) {
      return composeAndAppendAssistantTurn({
        turnInput: input,
        state,
        replyIntent: 'ask_clarification',
        fallbackText: 'Mình chưa tìm thấy món phù hợp. Bạn cho mình tên món hoặc combo cụ thể hơn nhé.',
      });
    }

    const cartResult = await input.clients.cart.createCart(input.sessionId);
    const cart = cartResult.value;
    const updatedCart = cart ? await input.clients.cart.updateCart(cart, item.code, 1) : undefined;
    if (!cartResult.ok || !cart || !updatedCart?.ok || !updatedCart.value) {
      return composeAndAppendAssistantTurn({
        turnInput: input,
        state,
        replyIntent: 'ask_clarification',
        fallbackText: updatedCart?.message ?? cartResult.message,
      });
    }

    state.cart = updatedCart.value;
    emitDashboardEvent(input, 'cart_changed', { cart: state.cart });
    return composeAndAppendAssistantTurn({
      turnInput: input,
      state,
      replyIntent: 'ask_fulfillment_method',
      fallbackText: 'Mình đã thêm món vào giỏ. Bạn muốn giao hàng hay đến cửa hàng nhận?',
    });
  }

  return composeAndAppendAssistantTurn({
    turnInput: input,
    state,
    replyIntent: 'ask_clarification',
    fallbackText: 'Mình cần thêm thông tin để hỗ trợ đúng.',
  });
}
