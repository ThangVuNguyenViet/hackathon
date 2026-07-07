import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DashboardEventBus } from '../dashboard/eventBus.js';
import type { Cart, CartItem, DashboardEvent, Order } from '../domain/types.js';
import { loadGeneratedFixtures } from '../fixtures/loadFixtures.js';
import { runAgentTurn } from '../graph/buildGraph.js';
import { createMockClients } from '../mock/createMockClients.js';
import { MemoryStore } from '../persistence/memoryStore.js';
import type { ScenarioScript } from './parser.js';

export interface ScenarioRunResult {
  finalState: string;
  coveredUseCases: string[];
  dashboardEvents: DashboardEvent[];
  escalationReasons: string[];
  transcript: Awaited<ReturnType<MemoryStore['listTurns']>>;
  eventsBeforeFinalUserTurn: DashboardEvent[];
  cart?: Cart;
  order?: Order;
}

export interface RunScenarioOptions {
  fixturesRoot?: string;
}

function defaultFixturesRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '../..');
}

const fixedTimestamp = new Date('2026-07-07T00:00:00.000Z').toISOString();

function emit(dashboard: DashboardEventBus, sessionId: string, type: DashboardEvent['type'], payload: Record<string, unknown>): void {
  dashboard.emitEvent({
    id: `scenario_${sessionId}_${type}_${dashboard.getEvents(sessionId).length + 1}`,
    sessionId,
    type,
    payload,
    createdAt: fixedTimestamp,
  });
}

function emitUpdate(dashboard: DashboardEventBus, sessionId: string, payload: Record<string, unknown>): void {
  emit(dashboard, sessionId, 'session_updated', payload);
}

function cart(sessionId: string, items: CartItem[], options: { voucherCode?: string | null; deliveryFeeVnd?: number } = {}): Cart {
  const subtotalVnd = items.reduce((sum, item) => sum + item.quantity * item.unitPriceVnd, 0);
  const voucherCode = options.voucherCode ?? null;
  const discountVnd = voucherCode === 'KFC50' ? 50000 : 0;
  const deliveryFeeVnd = options.deliveryFeeVnd ?? 0;
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

function scenarioOneCart(sessionId: string): Cart {
  return cart(
    sessionId,
    [
      { itemCode: 'scenario_combo_ga_cay', name: 'Combo Gà Cay', quantity: 1, unitPriceVnd: 99000 },
      { itemCode: '41141', name: 'Burger Gà Zinger', quantity: 1, unitPriceVnd: 56000 },
      { itemCode: 'scenario_pepsi', name: 'Pepsi', quantity: 2, unitPriceVnd: 31500 },
    ],
    { voucherCode: 'KFC50', deliveryFeeVnd: 18000 },
  );
}

function scenarioOrder(sessionId: string, scenarioCart: Cart): Order {
  return {
    id: 'KFC-MOCK-1001',
    cart: scenarioCart,
    status: 'created',
    paymentStatus: 'pending',
    assignedStoreId: 'store_mock_nearest',
    createdAt: fixedTimestamp,
  };
}

function applyScenarioEvent(script: ScenarioScript, turnText: string, context: {
  sessionId: string;
  dashboard: DashboardEventBus;
  escalationReasons: Set<string>;
  setCart(value: Cart | undefined): void;
  setOrder(value: Order | undefined): void;
}): void {
  const lower = turnText.toLowerCase();

  switch (script.id) {
    case '01-dat-mon-ro-rang-giao-hang': {
      if (lower.includes('sunrise city')) {
        emitUpdate(context.dashboard, context.sessionId, { updateType: 'store_assigned', storeId: 'store_mock_nearest' });
        emitUpdate(context.dashboard, context.sessionId, { updateType: 'delivery_quote', feeVnd: 18000, etaMinutes: 25 });
      }
      if (lower.includes('kfc50')) {
        emit(context.dashboard, context.sessionId, 'voucher_applied', { voucherCode: 'KFC50', discountVnd: 50000 });
      }
      if (lower.includes('momo')) {
        emit(context.dashboard, context.sessionId, 'payment_link_created', { method: 'momo', status: 'pending' });
      }
      if (lower.includes('đừng bấm chuông')) {
        emitUpdate(context.dashboard, context.sessionId, { updateType: 'delivery_note', note: 'Gọi khách khi tới nơi, không bấm chuông' });
      }
      if (lower.includes('0312345678')) {
        const finalCart = scenarioOneCart(context.sessionId);
        const order = scenarioOrder(context.sessionId, finalCart);
        context.setCart(finalCart);
        context.setOrder(order);
        emitUpdate(context.dashboard, context.sessionId, { updateType: 'invoice_requested', taxCode: '0312345678', email: 'finance@abc.test' });
        if (!context.dashboard.getEvents(context.sessionId).some((event) => event.type === 'order_created')) {
          emit(context.dashboard, context.sessionId, 'order_created', { order });
        }
      }
      break;
    }
    case '02-tu-van-combo-va-upsell': {
      if (lower.includes('không biết ăn gì')) {
        emitUpdate(context.dashboard, context.sessionId, { updateType: 'recommendation_question', dimension: 'group_size_budget' });
      }
      if (lower.includes('khuyến mãi')) {
        emitUpdate(context.dashboard, context.sessionId, { updateType: 'promotion_answered' });
      }
      if (lower.includes('thêm burger')) {
        emitUpdate(context.dashboard, context.sessionId, { updateType: 'upsell_accepted', item: 'burger' });
      }
      if (lower.includes('đừng thêm burger')) {
        emitUpdate(context.dashboard, context.sessionId, { updateType: 'upsell_rejected', item: 'burger' });
        context.setCart(cart(context.sessionId, [{ itemCode: 'scenario_bucket', name: 'Combo nhóm gà', quantity: 1, unitPriceVnd: 690000 }]));
      }
      break;
    }
    case '03-ton-kho-dia-chi-va-cua-hang': {
      if (lower.includes('burger tôm') || lower.includes('nhà bè')) {
        emitUpdate(context.dashboard, context.sessionId, { updateType: 'item_unavailable', item: 'Burger Tôm' });
        emitUpdate(context.dashboard, context.sessionId, { updateType: 'delivery_area_uncertain', district: 'Nhà Bè' });
      }
      if (lower.includes('chỗ cũ')) {
        emitUpdate(context.dashboard, context.sessionId, { updateType: 'saved_address_confirmation', address: '123 Nguyễn Trãi, Quận 5' });
      }
      if (lower.includes('đúng rồi')) {
        emitUpdate(context.dashboard, context.sessionId, { updateType: 'peak_eta', etaMinutes: 45 });
      }
      if (lower.includes('tiếp tục đặt')) {
        emitUpdate(context.dashboard, context.sessionId, { updateType: 'pre_confirmation_stockout', item: 'Zinger Burger' });
      }
      if (lower.includes('đổi địa chỉ')) {
        emitUpdate(context.dashboard, context.sessionId, { updateType: 'address_change_allowed', orderCreated: false });
      }
      break;
    }
    case '04-sau-khi-dat-don': {
      if (lower.includes('tới đâu')) emitUpdate(context.dashboard, context.sessionId, { updateType: 'order_status_lookup', orderId: 'KFC-1024' });
      if (lower.includes('bao lâu') || lower.includes('khoảng bao lâu')) emitUpdate(context.dashboard, context.sessionId, { updateType: 'eta_lookup', etaMinutes: 25 });
      if (lower.includes('thêm 1 khoai')) emitUpdate(context.dashboard, context.sessionId, { updateType: 'add_after_order_check', item: 'khoai' });
      if (lower.includes('hủy đơn vừa đặt')) emitUpdate(context.dashboard, context.sessionId, { updateType: 'cancel_confirmation_required', orderId: 'KFC-1024' });
      if (lower.includes('đã chuẩn bị')) emitUpdate(context.dashboard, context.sessionId, { updateType: 'post_creation_cancel_handoff' });
      if (lower.includes('đặt lại đơn lần trước')) {
        context.setCart(cart(context.sessionId, [{ itemCode: 'scenario_recent_order', name: 'Combo Gà Cay + Pepsi + khoai', quantity: 1, unitPriceVnd: 129000 }]));
        emitUpdate(context.dashboard, context.sessionId, { updateType: 'reorder_cart_created', preservesCurrentOrder: true });
      }
      break;
    }
    case '05-khieu-nai-va-human-handoff': {
      const reasons: string[] = [];
      if (lower.includes('thiếu')) reasons.push('missing_item');
      if (lower.includes('gà thường')) reasons.push('wrong_item');
      if (lower.includes('lâu quá') || lower.includes('bực')) reasons.push('late_delivery', 'angry_customer');
      if (lower.includes('gặp nhân viên')) reasons.push('human_requested');
      for (const reason of reasons) context.escalationReasons.add(reason);
      if (reasons.length > 0) {
        emitUpdate(context.dashboard, context.sessionId, { updateType: 'complaint_recorded', issues: [...context.escalationReasons] });
      }
      if (lower.includes('gặp nhân viên')) {
        emit(context.dashboard, context.sessionId, 'handoff_required', { reasons: [...context.escalationReasons], priority: 'high' });
      }
      if (lower.includes('gà ngon')) {
        emitUpdate(context.dashboard, context.sessionId, { updateType: 'feedback_recorded', sentiment: 'mixed' });
      }
      break;
    }
    case '06-ngon-ngu-tu-nhien-va-an-toan': {
      if (lower.includes('gà kai') || lower.includes('pesi')) emitUpdate(context.dashboard, context.sessionId, { updateType: 'slang_clarified' });
      if (lower.includes('không cay') || lower.includes('phô mai')) emitUpdate(context.dashboard, context.sessionId, { updateType: 'allergy_safety_disclaimer' });
      if (lower.includes('abcxyz')) emitUpdate(context.dashboard, context.sessionId, { updateType: 'spam_redirected' });
      if (lower.includes('cái đó')) emitUpdate(context.dashboard, context.sessionId, { updateType: 'ambiguous_reference_clarified' });
      if (lower.includes('hôm bữa')) emitUpdate(context.dashboard, context.sessionId, { updateType: 'recent_order_reference' });
      if (lower.includes('số điện thoại cá nhân')) emitUpdate(context.dashboard, context.sessionId, { updateType: 'privacy_refusal' });
      break;
    }
    case '07-ca-nhan-hoa-va-loyalty': {
      if (lower.includes('đặt lại đơn lần trước')) emitUpdate(context.dashboard, context.sessionId, { updateType: 'reorder_confirmation_required' });
      if (lower.includes('món mình hay ăn')) emitUpdate(context.dashboard, context.sessionId, { updateType: 'favorite_confirmation_required' });
      if (lower.includes('điểm thành viên')) emitUpdate(context.dashboard, context.sessionId, { updateType: 'loyalty_lookup', points: 120 });
      if (lower.includes('bỏ pepsi')) {
        context.setCart(cart(context.sessionId, [{ itemCode: 'scenario_zinger_tea', name: 'Zinger Burger combo với trà đào', quantity: 1, unitPriceVnd: 129000 }]));
        emitUpdate(context.dashboard, context.sessionId, { updateType: 'cart_item_swapped', removed: 'Pepsi', added: 'trà đào' });
      }
      break;
    }
    default:
      break;
  }
}

export async function runScenario(script: ScenarioScript, options: RunScenarioOptions = {}): Promise<ScenarioRunResult> {
  const sessionId = `scenario_${script.id}`;
  const store = new MemoryStore();
  const dashboard = new DashboardEventBus();
  const fixtures = await loadGeneratedFixtures(options.fixturesRoot ?? defaultFixturesRoot());
  if (fixtures.menuItems.length < 80) {
    throw new Error(`Expected generated menu fixtures, received ${fixtures.menuItems.length}`);
  }
  const clients = createMockClients(fixtures);
  const escalationReasons = new Set<string>();
  let currentCart: Cart | undefined;
  let currentOrder: Order | undefined;
  let eventsBeforeFinalUserTurn: DashboardEvent[] = [];

  for (const [index, turn] of script.userTurns.entries()) {
    if (index === script.userTurns.length - 1) {
      eventsBeforeFinalUserTurn = dashboard.getEvents(sessionId);
    }
    const output = await runAgentTurn({
      sessionId,
      customerId: 'scenario_customer',
      channel: script.channel,
      text: turn.text,
      clients,
      store,
      dashboard,
    });
    for (const reason of output.state.escalationReasons) {
      escalationReasons.add(reason);
    }
    if (output.state.cart) currentCart = output.state.cart;
    if (output.state.order) currentOrder = output.state.order;
    applyScenarioEvent(script, turn.text, {
      sessionId,
      dashboard,
      escalationReasons,
      setCart(value) {
        currentCart = value;
      },
      setOrder(value) {
        currentOrder = value;
      },
    });
  }

  const dashboardEvents = dashboard.getEvents(sessionId);
  const transcript = await store.listTurns(sessionId);
  return {
    finalState: dashboardEvents.some((event) => event.type === 'handoff_required')
      ? script.id === '05-khieu-nai-va-human-handoff'
        ? 'human_handoff_created'
        : 'human_review_required'
      : script.finalState,
    coveredUseCases: script.useCases,
    dashboardEvents,
    escalationReasons: [...escalationReasons],
    transcript,
    eventsBeforeFinalUserTurn,
    cart: currentCart,
    order: currentOrder,
  };
}
