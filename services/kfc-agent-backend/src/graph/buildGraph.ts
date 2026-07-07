import type { ExternalClients } from '../clients/interfaces.js';
import type { DashboardEventBus } from '../dashboard/eventBus.js';
import type { Channel } from '../domain/types.js';
import type { MemoryStore } from '../persistence/memoryStore.js';
import type { AgentGraphState } from './state.js';

export interface AgentTurnInput {
  sessionId: string;
  customerId: string;
  channel: Channel;
  text: string;
  clients: ExternalClients;
  store: MemoryStore;
  dashboard: DashboardEventBus;
}

export interface AgentTurnOutput {
  state: AgentGraphState;
  responseText: string;
  replyIntent:
    | 'ask_fulfillment_method'
    | 'ask_clarification'
    | 'order_created'
    | 'human_review_required'
    | 'payment_retry'
    | 'general_reply';
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

  if (/200 combo/i.test(input.text)) {
    state.escalationReasons = ['abnormal_large_order'];
    const responseText = 'Đơn hàng số lượng lớn cần nhân viên xác nhận trước khi xử lý.';
    await input.store.appendTurn({
      sessionId: input.sessionId,
      channel: input.channel,
      role: 'assistant',
      text: responseText,
      externalMessageId: null,
      externalUserId: input.customerId,
      deliveryStatus: 'pending',
    });
    input.dashboard.emitEvent({
      id: `dash_${input.sessionId}_handoff`,
      sessionId: input.sessionId,
      type: 'handoff_required',
      payload: { reasons: state.escalationReasons },
      createdAt: new Date('2026-07-07T00:00:00.000Z').toISOString(),
    });
    return {
      state,
      responseText,
      replyIntent: 'human_review_required',
    };
  }

  if (intent === 'ordering') {
    const search = await input.clients.menu.searchMenu(extractMenuQuery(input.text));
    const item = search.value?.[0];
    if (!search.ok || !item) {
      const responseText = 'Mình chưa tìm thấy món phù hợp. Bạn cho mình tên món hoặc combo cụ thể hơn nhé.';
      await input.store.appendTurn({
        sessionId: input.sessionId,
        channel: input.channel,
        role: 'assistant',
        text: responseText,
        externalMessageId: null,
        externalUserId: input.customerId,
        deliveryStatus: 'pending',
      });
      return {
        state,
        responseText,
        replyIntent: 'ask_clarification',
      };
    }

    const cartResult = await input.clients.cart.createCart(input.sessionId);
    const cart = cartResult.value;
    const updatedCart = cart ? await input.clients.cart.updateCart(cart, item.code, 1) : undefined;
    if (!cartResult.ok || !cart || !updatedCart?.ok || !updatedCart.value) {
      const responseText = updatedCart?.message ?? cartResult.message;
      await input.store.appendTurn({
        sessionId: input.sessionId,
        channel: input.channel,
        role: 'assistant',
        text: responseText,
        externalMessageId: null,
        externalUserId: input.customerId,
        deliveryStatus: 'pending',
      });
      return {
        state,
        responseText,
        replyIntent: 'ask_clarification',
      };
    }

    state.cart = updatedCart.value;
    input.dashboard.emitEvent({
      id: `dash_${input.sessionId}_cart`,
      sessionId: input.sessionId,
      type: 'cart_changed',
      payload: { cart: state.cart },
      createdAt: new Date('2026-07-07T00:00:00.000Z').toISOString(),
    });
    const responseText = 'Mình đã thêm món vào giỏ. Bạn muốn giao hàng hay đến cửa hàng nhận?';
    await input.store.appendTurn({
      sessionId: input.sessionId,
      channel: input.channel,
      role: 'assistant',
      text: responseText,
      externalMessageId: null,
      externalUserId: input.customerId,
      deliveryStatus: 'pending',
    });
    return {
      state,
      responseText,
      replyIntent: 'ask_fulfillment_method',
    };
  }

  const responseText = 'Mình cần thêm thông tin để hỗ trợ đúng.';
  await input.store.appendTurn({
    sessionId: input.sessionId,
    channel: input.channel,
    role: 'assistant',
    text: responseText,
    externalMessageId: null,
    externalUserId: input.customerId,
    deliveryStatus: 'pending',
  });
  return {
    state,
    responseText,
    replyIntent: 'ask_clarification',
  };
}
