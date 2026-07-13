import { describe, expect, it } from 'vitest';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import type { Cart, Order } from '../../src/domain/types.js';
import { runAgentTurn } from '../../src/graph/buildGraph.js';
import type { ToolPlannerInput, ToolPlannerOutput } from '../../src/llm/toolPlanner.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';

function cart(): Cart {
  return {
    id: 'cart_context',
    items: [{ itemCode: '20751', name: 'Combo Hop Gu 99K', quantity: 1, unitPriceVnd: 99000 }],
    subtotalVnd: 99000,
    discountVnd: 0,
    deliveryFeeVnd: 0,
    totalVnd: 99000,
    voucherCode: null,
  };
}

function paidOrder(): Order {
  return {
    id: 'order_context',
    cart: cart(),
    status: 'preparing',
    paymentStatus: 'paid',
    assignedStoreId: 'KFCVN0002',
    createdAt: '2026-07-10T08:00:00.000Z',
  };
}

function planner(output: ToolPlannerOutput) {
  return { async plan(): Promise<ToolPlannerOutput> { return output; } };
}

function multiStepPlanner(outputs: ToolPlannerOutput[]) {
  let index = 0;
  return {
    supportsMultiStep: true,
    async plan(): Promise<ToolPlannerOutput> {
      const output = outputs[Math.min(index, outputs.length - 1)];
      index += 1;
      return output!;
    },
  };
}

async function seed(store: MemoryStore, sessionId: string, verifiedState: Record<string, unknown>) {
  await store.appendEvent(sessionId, 'graph:verified_state', { verifiedState });
}

describe('planner context policy', () => {
  it('shows verified order state when structured metadata activates order context', async () => {
    const store = new MemoryStore();
    await seed(store, 'kfc:first_planner_verified_context', {
      order: paidOrder(),
      paymentAttempt: { method: 'momo', status: 'paid' },
      toolTrace: [],
    });
    let firstInput: ToolPlannerInput | undefined;

    await runAgentTurn({
      sessionId: 'kfc:first_planner_verified_context',
      customerId: 'first_planner_verified_context',
      channel: 'kfc',
      text: 'Đơn của mình tới đâu rồi?',
      metadata: { rawEvent: { contextPolicy: { order: 'active', payment: 'active' } } },
      clients: createMockClients(createTestFixtures()),
      store,
      dashboard: new DashboardEventBus(),
      toolPlanner: {
        async plan(input): Promise<ToolPlannerOutput> {
          firstInput ??= input;
          return { intent: 'order_status', contextPolicy: { order: 'active' }, entities: {}, toolCalls: [], responseClaims: [] };
        },
      },
    });

    expect(firstInput?.state.order?.id).toBe('order_context');
    expect(firstInput?.state.paymentAttempt?.status).toBe('paid');
  });

  it('honors the model small-talk signal without executing a proposed discovery tool', async () => {
    const output = await runAgentTurn({
      sessionId: 'kfc:planner_small_talk_signal',
      customerId: 'planner_small_talk_signal',
      channel: 'kfc',
      text: 'Xin chào KFC, hôm nay bạn khỏe không?',
      clients: createMockClients(createTestFixtures()),
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      toolPlanner: planner({
        intent: 'unclear',
        contextPolicy: { menuSearchResults: 'active' },
        entities: { smallTalk: true },
        toolCalls: [{ toolName: 'searchMenu', arguments: {} }],
        responseClaims: [],
        directResponse: 'Chào bạn! Mình có thể giúp gì cho bạn?',
      }),
    });

    expect(output.state.toolTrace ?? []).toEqual([]);
    expect(output.genUi).toBeUndefined();
    expect(output.responseText).toBe('Chào bạn! Mình có thể giúp gì cho bạn?');
  });

  it('answers a greeting from model-planned text without a second model call', async () => {
    const store = new MemoryStore();
    await seed(store, 'kfc:planner_neutral_greeting', { cart: cart(), toolTrace: [] });
    let plannerCalls = 0;
    let composerCalls = 0;

    const output = await runAgentTurn({
      sessionId: 'kfc:planner_neutral_greeting',
      customerId: 'planner_neutral_greeting',
      channel: 'kfc',
      text: 'hi',
      clients: createMockClients(createTestFixtures()),
      store,
      dashboard: new DashboardEventBus(),
      toolPlanner: {
        supportsMultiStep: true,
        async plan(): Promise<ToolPlannerOutput> {
          plannerCalls += 1;
          return {
            intent: 'unclear',
            contextPolicy: {},
            entities: {},
            toolCalls: [],
            responseClaims: [],
            directResponse: 'Xin chào! Bạn muốn xem giỏ hàng không?',
          };
        },
      },
      responseComposer: {
        async composeResponse(): Promise<string> {
          composerCalls += 1;
          return 'Chào bạn! Hôm nay mình có thể giúp bạn chọn món gì?';
        },
      },
    });

    expect(plannerCalls).toBe(1);
    expect(composerCalls).toBe(0);
    expect(output.responseText).toBe('Xin chào! Bạn muốn xem giỏ hàng không?');
    expect(output.state.toolTrace ?? []).toEqual([]);
    expect(output.genUi).toBeUndefined();
  });

  it('finishes verified menu discovery from model-planned text without a second model call', async () => {
    let plannerCalls = 0;
    let composerCalls = 0;

    const output = await runAgentTurn({
      sessionId: 'kfc:planner_single_pass_menu_discovery',
      customerId: 'planner_single_pass_menu_discovery',
      channel: 'kfc',
      text: 'Hôm nay có món gì ngon?',
      clients: createMockClients(createTestFixtures()),
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      toolPlanner: {
        supportsMultiStep: true,
        async plan(): Promise<ToolPlannerOutput> {
          plannerCalls += 1;
          return {
            intent: 'ordering',
            contextPolicy: { menuSearchResults: 'active' },
            entities: { keepMenuSurface: true },
            toolCalls: [{ toolName: 'searchMenu', arguments: {} }],
            responseClaims: [],
            directResponse: 'Mình đang hiển thị các lựa chọn để bạn xem.',
          };
        },
      },
      responseComposer: {
        async composeResponse(): Promise<string> {
          composerCalls += 1;
          return 'Danh sách món đã được tải.';
        },
      },
    });

    expect(plannerCalls).toBe(1);
    expect(composerCalls).toBe(0);
    expect(output.state.toolTrace?.map((entry) => entry.toolName)).toEqual(['searchMenu']);
    expect(output.genUi?.widgetKind).toBe('smartMenuPicker');
    expect(output.responseText).toBe('Mình đang hiển thị các lựa chọn để bạn xem.');
  });

  it('repairs a tool-less menu recommendation from structured menu context', async () => {
    const output = await runAgentTurn({
      sessionId: 'kfc:planner_menu_context',
      customerId: 'planner_menu_context',
      channel: 'kfc',
      text: 'Combo nhom cho 10 nguoi.',
      clients: createMockClients(createTestFixtures()),
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      toolPlanner: planner({
        intent: 'unclear',
        contextPolicy: { menuSearchResults: 'active' },
        entities: { itemText: 'combo nhom' },
        toolCalls: [],
        responseClaims: [],
        directResponse: 'Minh se tim combo nhom phu hop.',
      }),
    });

    expect(output.genUi?.widgetKind).toBe('smartMenuPicker');
  });

  it('does not turn an unstructured nonsense turn into a menu recommendation', async () => {
    const store = new MemoryStore();
    await seed(store, 'kfc:planner_nonsense_context', { cart: cart(), toolTrace: [] });
    const output = await runAgentTurn({
      sessionId: 'kfc:planner_nonsense_context',
      customerId: 'planner_nonsense_context',
      channel: 'kfc',
      text: 'abcxyz haha',
      clients: createMockClients(createTestFixtures()),
      store,
      dashboard: new DashboardEventBus(),
      toolPlanner: planner({
        intent: 'unclear',
        contextPolicy: { cart: 'active', menuSearchResults: 'active' },
        entities: {},
        toolCalls: [{ toolName: 'searchMenu', arguments: { query: '' } }],
        responseClaims: [],
        directResponse: 'Minh chua hieu yeu cau cua ban.',
      }),
    });

    expect(output.state.toolTrace?.map((entry) => entry.toolName) ?? []).not.toContain('searchMenu');
    expect(output.genUi).toBeUndefined();
  });

  it('keeps verified menu results when add-on planning has no cart yet', async () => {
    const output = await runAgentTurn({
      sessionId: 'kfc:planner_menu_addon_context',
      customerId: 'planner_menu_addon_context',
      channel: 'kfc',
      text: 'Goi y combo nhom cho minh.',
      clients: createMockClients(createTestFixtures()),
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      toolPlanner: planner({
        intent: 'ordering',
        contextPolicy: { menuSearchResults: 'active' },
        entities: {},
        toolCalls: [
          { toolName: 'searchMenu', arguments: { query: 'combo' } },
          { toolName: 'recommendAddOns', arguments: {} },
        ],
        responseClaims: [],
      }),
    });

    expect(output.state.escalationReasons).not.toContain('tool_execution_failed');
    expect(output.genUi?.widgetKind).toBe('smartMenuPicker');
  });

  it('keeps the current verified menu surface across a tool-less follow-up', async () => {
    const store = new MemoryStore();
    const clients = createMockClients(createTestFixtures());

    await runAgentTurn({
      sessionId: 'kfc:planner_menu_followup_context',
      customerId: 'planner_menu_followup_context',
      channel: 'kfc',
      text: 'Goi y mon cho minh.',
      clients,
      store,
      dashboard: new DashboardEventBus(),
      toolPlanner: planner({
        intent: 'ordering',
        contextPolicy: { menuSearchResults: 'active' },
        entities: {},
        toolCalls: [{ toolName: 'searchMenu', arguments: { query: 'combo' } }],
        responseClaims: [],
      }),
    });

    const output = await runAgentTurn({
      sessionId: 'kfc:planner_menu_followup_context',
      customerId: 'planner_menu_followup_context',
      channel: 'kfc',
      text: 'Ngan sach nay co du khong?',
      clients,
      store,
      dashboard: new DashboardEventBus(),
      toolPlanner: planner({
        intent: 'unclear',
        entities: {},
        toolCalls: [],
        responseClaims: [],
        directResponse: 'Minh se giu cac lua chon da xac minh de ban chon.',
      }),
    });

    expect(output.genUi?.widgetKind).toBe('smartMenuPicker');
  });

  it('hydrates a saved address and advances an active cart to order review', async () => {
    const store = new MemoryStore();
    await seed(store, 'kfc:planner_fulfillment_context', { cart: cart(), toolTrace: [] });
    const fixtures = createTestFixtures();
    fixtures.stores[0] = {
      ...fixtures.stores[0]!,
      address: '123 Nguyen Trai, Quan 5, Ho Chi Minh',
      city: 'HO CHI MINH',
    };

    const output = await runAgentTurn({
      sessionId: 'kfc:planner_fulfillment_context',
      customerId: 'planner_fulfillment_context',
      channel: 'kfc',
      text: 'Dung roi, giao toi cho cu.',
      clients: createMockClients(fixtures, {
        fulfillmentQuoteProvider: () => ({
          ok: true,
          value: { feeVnd: 18000, etaMinutes: 25 },
          message: 'quote',
        }),
      }),
      store,
      dashboard: new DashboardEventBus(),
      toolPlanner: planner({
        intent: 'ordering',
        contextPolicy: { cart: 'active', fulfillment: 'active', customer: 'active' },
        entities: { useSavedAddress: true },
        toolCalls: [],
        responseClaims: [],
      }),
    });

    expect(output.state.address).toBeDefined();
    expect(output.state.fulfillment).toBeDefined();
    expect(output.genUi?.widgetKind).toBe('orderReviewConfirm');
  });

  it('discovers stores when fulfillment is active but only a district is available', async () => {
    const output = await runAgentTurn({
      sessionId: 'kfc:planner_district_fulfillment_context',
      customerId: 'planner_district_fulfillment_context',
      channel: 'kfc',
      text: 'Cho minh mot combo, giao ve Quan 7.',
      clients: createMockClients(createTestFixtures()),
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      toolPlanner: planner({
        intent: 'ordering',
        contextPolicy: { cart: 'active', fulfillment: 'active' },
        entities: {},
        toolCalls: [
          { toolName: 'searchMenu', arguments: { query: 'combo' } },
          { toolName: 'updateCart', arguments: { itemCode: '20751', quantity: 1 } },
        ],
        responseClaims: [],
      }),
    });

    expect(output.state.toolTrace).toEqual(
      expect.arrayContaining([expect.objectContaining({ toolName: 'findStores', ok: true })]),
    );
    expect(output.genUi?.widgetKind).toBe('addressFulfillmentCheck');
  });

  it('prioritizes fulfillment for explicit delivery language even when the planner only searches menu', async () => {
    const output = await runAgentTurn({
      sessionId: 'kfc:planner_explicit_delivery',
      customerId: 'planner_explicit_delivery',
      channel: 'kfc',
      text: 'Cho mình Burger Tôm, giao về Nhà Bè được không?',
      clients: createMockClients(createTestFixtures()),
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      toolPlanner: planner({
        intent: 'ordering',
        contextPolicy: { menuSearchResults: 'active' },
        entities: { itemText: 'Burger Tôm' },
        toolCalls: [{ toolName: 'searchMenu', arguments: { query: 'Burger Tôm' } }],
        responseClaims: [],
      }),
    });

    expect(output.state.toolTrace?.map((entry) => entry.toolName)).toEqual(['searchMenu', 'findStores']);
    expect(output.genUi?.widgetKind).toBe('addressFulfillmentCheck');
  });

  it('keeps an explicit multi-item delivery order cart-first', async () => {
    const output = await runAgentTurn({
      sessionId: 'kfc:planner_multi_item_delivery',
      customerId: 'planner_multi_item_delivery',
      channel: 'kfc',
      text: 'Cho mình combo gà, burger Zinger và 2 Pepsi, giao về Quận 7.',
      clients: createMockClients(createTestFixtures()),
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      toolPlanner: planner({
        intent: 'ordering',
        contextPolicy: { cart: 'active' },
        entities: {},
        toolCalls: [
          { toolName: 'updateCart', arguments: { itemCode: '20751', quantity: 1 } },
          { toolName: 'findStores', arguments: { query: 'Quận 7' } },
        ],
        responseClaims: [],
      }),
    });

    expect(output.genUi?.widgetKind).toBe('cartBuilder');
  });

  it('advances accepted verified fulfillment to order review despite another store lookup', async () => {
    const store = new MemoryStore();
    await seed(store, 'kfc:planner_accept_fulfillment_context', {
      cart: cart(),
      address: {
        label: 'Home',
        line1: 'Sunrise City, 23 Nguyen Huu Tho',
        district: 'Quan 7',
        city: 'Ho Chi Minh',
      },
      fulfillment: {
        method: 'delivery',
        disposition: 'delivery',
        storeId: 'KFCVN0002',
        storeName: 'KFC Test',
        feeVnd: 18000,
        etaMinutes: 25,
        availability: {
          ok: true,
          checkedItemIds: ['20751'],
          unavailableItemIds: [],
          blockedTimeslotItemIds: [],
          source: { fixtureMode: 'test_only', sourceFile: 'planner-context-policy.test.ts' },
        },
      },
      toolTrace: [],
    });

    const output = await runAgentTurn({
      sessionId: 'kfc:planner_accept_fulfillment_context',
      customerId: 'planner_accept_fulfillment_context',
      channel: 'kfc',
      text: 'Giao den dia chi nay',
      metadata: {
        customerCommand: { kind: 'accept_fulfillment' },
      },
      clients: createMockClients(createTestFixtures(), {
        fulfillmentQuoteProvider: () => ({
          ok: true,
          value: { feeVnd: 18000, etaMinutes: 25 },
          message: 'quote',
        }),
      }),
      store,
      dashboard: new DashboardEventBus(),
      toolPlanner: planner({
        intent: 'ordering',
        contextPolicy: { cart: 'active', fulfillment: 'active' },
        entities: {},
        toolCalls: [{ toolName: 'findStores', arguments: { query: 'Quan 7' } }],
        responseClaims: [],
      }),
    });

    expect(output.genUi?.widgetKind).toBe('orderReviewConfirm');
  });

  it('does not let fulfillment acceptance skip directly to order placement or payment', async () => {
    const store = new MemoryStore();
    await seed(store, 'kfc:planner_accept_fulfillment_no_payment', {
      cart: cart(),
      address: {
        label: 'Home',
        line1: 'Sunrise City, 23 Nguyen Huu Tho',
        district: 'Quan 7',
        city: 'Ho Chi Minh',
      },
      toolTrace: [],
    });
    const output = await runAgentTurn({
      sessionId: 'kfc:planner_accept_fulfillment_no_payment',
      customerId: 'planner_accept_fulfillment_no_payment',
      channel: 'kfc',
      text: 'Giao đến địa chỉ này',
      metadata: {
        customerCommand: { kind: 'accept_fulfillment' },
      },
      clients: createMockClients(createTestFixtures(), {
        fulfillmentQuoteProvider: () => ({
          ok: true,
          value: { feeVnd: 18000, etaMinutes: 25 },
          message: 'quote',
        }),
      }),
      store,
      dashboard: new DashboardEventBus(),
      toolPlanner: planner({
        intent: 'payment',
        contextPolicy: { cart: 'active', fulfillment: 'active' },
        entities: { orderConfirmed: true, paymentMethod: 'zalopay' },
        toolCalls: [
          { toolName: 'previewOrder', arguments: {} },
          { toolName: 'placeOrder', arguments: {} },
          { toolName: 'createPaymentLink', arguments: { method: 'zalopay' } },
        ],
        responseClaims: [],
      }),
    });

    expect(output.state.order).toBeUndefined();
    expect(output.state.paymentAttempt).toBeUndefined();
    expect(output.genUi?.widgetKind).toBe('orderReviewConfirm');
  });

  it('does not treat natural-language fulfillment continuation as final order confirmation', async () => {
    const store = new MemoryStore();
    await seed(store, 'kfc:planner_text_fulfillment_no_payment', {
      cart: cart(),
      address: {
        label: 'Home',
        line1: 'Sunrise City, 23 Nguyen Huu Tho',
        district: 'Quan 7',
        city: 'Ho Chi Minh',
      },
      toolTrace: [],
    });
    await store.appendTurn({
      sessionId: 'kfc:planner_text_fulfillment_no_payment',
      channel: 'kfc',
      role: 'assistant',
      text: 'Kiểm tra giao hàng',
      externalMessageId: null,
      externalUserId: 'planner_text_fulfillment_no_payment',
      deliveryStatus: 'sent',
      metadata: {
        genUi: {
          id: 'fulfillment_attachment',
          lifecycleStage: 'fulfillment',
          widgetKind: 'addressFulfillmentCheck',
          status: 'active',
          title: 'Kiểm tra giao hàng',
          data: {},
          actions: [],
        },
      },
    });
    const output = await runAgentTurn({
      sessionId: 'kfc:planner_text_fulfillment_no_payment',
      customerId: 'planner_text_fulfillment_no_payment',
      channel: 'kfc',
      text: 'Tiếp tục đặt.',
      clients: createMockClients(createTestFixtures(), {
        fulfillmentQuoteProvider: () => ({
          ok: true,
          value: { feeVnd: 18000, etaMinutes: 25 },
          message: 'quote',
        }),
      }),
      store,
      dashboard: new DashboardEventBus(),
      toolPlanner: planner({
        intent: 'ordering',
        contextPolicy: { cart: 'active', fulfillment: 'active' },
        entities: { orderConfirmed: true },
        toolCalls: [
          { toolName: 'previewOrder', arguments: {} },
          { toolName: 'placeOrder', arguments: {} },
        ],
        responseClaims: [],
      }),
    });

    expect(output.state.order).toBeUndefined();
    expect(output.genUi?.widgetKind).toBe('orderReviewConfirm');
  });

  it('re-quotes the verified address when accepting fulfillment also mutates the cart', async () => {
    const store = new MemoryStore();
    await seed(store, 'kfc:planner_accept_fulfillment_cart_context', {
      cart: cart(),
      address: {
        label: 'Home',
        line1: 'Sunrise City, 23 Nguyen Huu Tho',
        district: 'Quan 7',
        city: 'Ho Chi Minh',
      },
      fulfillment: {
        method: 'delivery',
        disposition: 'delivery',
        storeId: 'KFCVN0002',
        storeName: 'KFC Test',
        feeVnd: 18000,
        etaMinutes: 25,
        availability: {
          ok: true,
          checkedItemIds: ['20751'],
          unavailableItemIds: [],
          blockedTimeslotItemIds: [],
          source: { fixtureMode: 'test_only', sourceFile: 'planner-context-policy.test.ts' },
        },
      },
      toolTrace: [],
    });

    const output = await runAgentTurn({
      sessionId: 'kfc:planner_accept_fulfillment_cart_context',
      customerId: 'planner_accept_fulfillment_cart_context',
      channel: 'kfc',
      text: 'Giao den dia chi nay',
      metadata: {
        customerCommand: { kind: 'accept_fulfillment' },
      },
      clients: createMockClients(createTestFixtures(), {
        fulfillmentQuoteProvider: () => ({
          ok: true,
          value: { feeVnd: 18000, etaMinutes: 25 },
          message: 'quote',
        }),
      }),
      store,
      dashboard: new DashboardEventBus(),
      toolPlanner: planner({
        intent: 'ordering',
        contextPolicy: { cart: 'active', fulfillment: 'active' },
        entities: {},
        toolCalls: [{ toolName: 'updateCart', arguments: { itemCode: '20751', quantity: 2 } }],
        responseClaims: [],
      }),
    });

    expect(output.state.address).toMatchObject({ district: 'Quan 7' });
    expect(output.state.fulfillment).toBeDefined();
    expect(output.genUi?.widgetKind).toBe('orderReviewConfirm');
  });

  it('re-quotes a verified address when continuing from a cart after checkout invalidation', async () => {
    const store = new MemoryStore();
    await seed(store, 'kfc:planner_continue_fulfillment_context', {
      cart: cart(),
      address: {
        label: 'Home',
        line1: 'Sunrise City, 23 Nguyen Huu Tho',
        district: 'Quan 7',
        city: 'Ho Chi Minh',
      },
      toolTrace: [],
    });

    const output = await runAgentTurn({
      sessionId: 'kfc:planner_continue_fulfillment_context',
      customerId: 'planner_continue_fulfillment_context',
      channel: 'kfc',
      text: 'Tiep tuc giao hang',
      metadata: {
        customerCommand: { kind: 'start_fulfillment' },
      },
      clients: createMockClients(createTestFixtures(), {
        fulfillmentQuoteProvider: () => ({
          ok: true,
          value: { feeVnd: 18000, etaMinutes: 25 },
          message: 'quote',
        }),
      }),
      store,
      dashboard: new DashboardEventBus(),
      toolPlanner: planner({
        intent: 'ordering',
        entities: {},
        toolCalls: [],
        responseClaims: [],
      }),
    });

    expect(output.state.fulfillment).toBeDefined();
    expect(output.genUi?.widgetKind).toBe('orderReviewConfirm');
  });

  it('keeps an active paid order visible during a post-order add-on question', async () => {
    const store = new MemoryStore();
    await seed(store, 'kfc:planner_order_context', { order: paidOrder(), cart: cart(), toolTrace: [] });

    const output = await runAgentTurn({
      sessionId: 'kfc:planner_order_context',
      customerId: 'planner_order_context',
      channel: 'kfc',
      text: 'Minh them mot khoai nua duoc khong?',
      clients: createMockClients(createTestFixtures()),
      store,
      dashboard: new DashboardEventBus(),
      toolPlanner: planner({
        intent: 'order_status',
        contextPolicy: { order: 'active', payment: 'active' },
        entities: {},
        toolCalls: [],
        responseClaims: [],
      }),
    });

    expect(output.genUi?.widgetKind).toBe('orderTrackingStatus');
  });

  it('hydrates payment context from typed planner intent when explicit policy is omitted', async () => {
    const pending = { ...paidOrder(), paymentStatus: 'pending' as const };
    const output = await runAgentTurn({
      sessionId: 'kfc:planner_payment_intent_context',
      customerId: 'planner_payment_intent_context',
      channel: 'kfc',
      text: 'Thanh toan cua minh dang co van de.',
      clients: createMockClients(createTestFixtures(), {
        recentOrderProvider: () => ({ ok: true, value: pending, message: 'pending_order' }),
      }),
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      toolPlanner: planner({
        intent: 'payment',
        entities: {},
        toolCalls: [],
        responseClaims: [],
      }),
    });

    expect(output.state.order?.id).toBe('order_context');
    expect(output.genUi?.widgetKind).toBe('paymentOrderStatus');
  });

  it('answers payment-method availability with the verified payment-method picker', async () => {
    const store = new MemoryStore();
    await seed(store, 'kfc:planner_payment_availability', {
      cart: cart(),
      fulfillment: {
        method: 'delivery',
        disposition: 'delivery',
        storeId: 'KFCVN0002',
        storeName: 'KFC Test',
        feeVnd: 18000,
        etaMinutes: 25,
        availability: {
          ok: true,
          checkedItemIds: ['20751'],
          unavailableItemIds: [],
          blockedTimeslotItemIds: [],
          source: { fixtureMode: 'test_only', sourceFile: 'planner-context-policy.test.ts' },
        },
      },
      toolTrace: [],
    });
    const output = await runAgentTurn({
      sessionId: 'kfc:planner_payment_availability',
      customerId: 'planner_payment_availability',
      channel: 'kfc',
      text: 'Thanh toán bằng ZaloPay được không?',
      clients: createMockClients(createTestFixtures()),
      store,
      dashboard: new DashboardEventBus(),
      toolPlanner: planner({
        intent: 'payment',
        contextPolicy: { cart: 'active', fulfillment: 'active' },
        entities: { paymentMethod: 'zalopay' },
        toolCalls: [{ toolName: 'listPaymentMethods', arguments: {} }],
        responseClaims: [],
      }),
    });

    expect(output.state.paymentMethodEvidence).toEqual(
      expect.arrayContaining([expect.objectContaining({ methodId: 'zalopay_wallet', supported: true })]),
    );
    expect(output.genUi?.widgetKind).toBe('paymentMethodPicker');
  });

  it('preserves order review while applying a voucher', async () => {
    const store = new MemoryStore();
    await seed(store, 'kfc:planner_checkout_voucher', {
      cart: cart(),
      fulfillment: {
        method: 'delivery',
        disposition: 'delivery',
        storeId: 'KFCVN0002',
        storeName: 'KFC Test',
        feeVnd: 18000,
        etaMinutes: 25,
        availability: {
          ok: true,
          checkedItemIds: ['20751'],
          unavailableItemIds: [],
          blockedTimeslotItemIds: [],
          source: { fixtureMode: 'test_only', sourceFile: 'planner-context-policy.test.ts' },
        },
      },
      toolTrace: [],
    });
    const output = await runAgentTurn({
      sessionId: 'kfc:planner_checkout_voucher',
      customerId: 'planner_checkout_voucher',
      channel: 'kfc',
      text: 'Mình có mã KFC50, áp dụng giúp mình.',
      clients: createMockClients(createTestFixtures()),
      store,
      dashboard: new DashboardEventBus(),
      toolPlanner: planner({
        intent: 'ordering',
        contextPolicy: { cart: 'active' },
        entities: { voucherText: 'KFC50' },
        toolCalls: [
          { toolName: 'updateCart', arguments: { itemCode: '20751', quantity: 1 } },
          { toolName: 'validateVoucher', arguments: { voucherText: 'KFC50', subtotalVnd: 99000 } },
        ],
        responseClaims: [],
      }),
    });

    expect(output.genUi?.widgetKind).toBe('orderReviewConfirm');
  });

  it('preserves a paid order after a successful status lookup even when planner context is omitted', async () => {
    const store = new MemoryStore();
    await seed(store, 'kfc:planner_status_tool_context', {
      order: paidOrder(),
      paymentAttempt: { status: 'paid' },
      toolTrace: [],
    });

    const output = await runAgentTurn({
      sessionId: 'kfc:planner_status_tool_context',
      customerId: 'planner_status_tool_context',
      channel: 'kfc',
      text: 'Don cua minh toi dau roi?',
      clients: createMockClients(createTestFixtures(), { initialOrders: [paidOrder()] }),
      store,
      dashboard: new DashboardEventBus(),
      toolPlanner: planner({
        intent: 'order_status',
        entities: {},
        toolCalls: [{ toolName: 'getOrderStatus', arguments: { orderId: 'order_context' } }],
        responseClaims: [],
      }),
    });

    expect(output.genUi?.widgetKind).toBe('orderTrackingStatus');
  });

  it('marks a current order lookup as fresher than a prior failed payment attempt', async () => {
    const store = new MemoryStore();
    await seed(store, 'kfc:current_order_payment_status', {
      order: { ...paidOrder(), paymentStatus: 'pending' },
      paymentAttempt: { method: 'zalopay', status: 'failed' },
      toolTrace: [],
    });

    const output = await runAgentTurn({
      sessionId: 'kfc:current_order_payment_status',
      customerId: 'current_order_payment_status',
      channel: 'kfc',
      text: 'Kiểm tra trạng thái đơn',
      clients: createMockClients(createTestFixtures(), {
        orderStatusProvider: () => ({ ok: true, value: paidOrder(), message: 'order_paid' }),
      }),
      store,
      dashboard: new DashboardEventBus(),
      toolPlanner: planner({
        intent: 'order_status',
        contextPolicy: { order: 'active', payment: 'active' },
        entities: { orderId: 'order_context' },
        toolCalls: [{ toolName: 'getOrderStatus', arguments: { orderId: 'order_context' } }],
        responseClaims: [],
      }),
    });

    expect(output.genUi?.data.paymentStatusEvidence).toMatchObject({
      resolution: 'current_tool',
      selectedStatus: 'paid',
      selectedSource: 'order',
    });
  });

  it('marks a current payment check as fresher than an older paid order', async () => {
    const store = new MemoryStore();
    await seed(store, 'kfc:current_attempt_payment_status', {
      order: paidOrder(),
      paymentAttempt: { method: 'zalopay', status: 'pending' },
      toolTrace: [],
    });

    const output = await runAgentTurn({
      sessionId: 'kfc:current_attempt_payment_status',
      customerId: 'current_attempt_payment_status',
      channel: 'kfc',
      text: 'Kiểm tra thanh toán',
      clients: createMockClients(createTestFixtures(), {
        paymentStatusProvider: () => ({ ok: true, value: { status: 'failed' }, message: 'payment_failed' }),
      }),
      store,
      dashboard: new DashboardEventBus(),
      toolPlanner: planner({
        intent: 'payment',
        contextPolicy: { order: 'active', payment: 'active' },
        entities: { orderId: 'order_context' },
        toolCalls: [{ toolName: 'checkPaymentStatus', arguments: { orderId: 'order_context' } }],
        responseClaims: [],
      }),
    });

    expect(output.genUi?.widgetKind).toBe('paymentOrderStatus');
    expect(output.genUi?.data.paymentStatusEvidence).toMatchObject({
      resolution: 'current_tool',
      selectedStatus: 'failed',
      selectedSource: 'paymentAttempt',
    });
  });

  it('hydrates a known paid order for a tool-less delivery tracking request', async () => {
    const output = await runAgentTurn({
      sessionId: 'kfc:planner_tracking_phrase',
      customerId: 'planner_tracking_phrase',
      channel: 'kfc',
      text: 'Đơn của mình tới đâu rồi?',
      clients: createMockClients(createTestFixtures(), {
        recentOrderProvider: () => ({ ok: true, value: paidOrder(), message: 'recent_order' }),
      }),
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      toolPlanner: planner({
        intent: 'unclear',
        contextPolicy: {},
        entities: {},
        toolCalls: [],
        responseClaims: [],
      }),
    });

    expect(output.state.order?.id).toBe('order_context');
    expect(output.genUi?.widgetKind).toBe('orderTrackingStatus');
    expect(output.responseText).toContain('order_context');
    expect(output.responseText).not.toContain('cung cấp mã đơn');
  });

  it('keeps tracking GenUI for a short ETA follow-up', async () => {
    const store = new MemoryStore();
    await seed(store, 'kfc:planner_short_eta', { order: paidOrder(), toolTrace: [] });
    const output = await runAgentTurn({
      sessionId: 'kfc:planner_short_eta',
      customerId: 'planner_short_eta',
      channel: 'kfc',
      text: 'Khoảng bao lâu tới?',
      clients: createMockClients(createTestFixtures()),
      store,
      dashboard: new DashboardEventBus(),
      toolPlanner: planner({
        intent: 'unclear',
        contextPolicy: {},
        entities: {},
        toolCalls: [],
        responseClaims: [],
      }),
    });

    expect(output.genUi?.widgetKind).toBe('orderTrackingStatus');
  });

  it('does not turn a submitted-order edit into reorder clarification', async () => {
    const store = new MemoryStore();
    await seed(store, 'kfc:planner_post_order_edit', { order: paidOrder(), toolTrace: [] });
    const output = await runAgentTurn({
      sessionId: 'kfc:planner_post_order_edit',
      customerId: 'planner_post_order_edit',
      channel: 'kfc',
      text: 'Mình thêm 1 khoai nữa được không?',
      clients: createMockClients(createTestFixtures(), {
        recentOrderProvider: () => ({ ok: true, value: paidOrder(), message: 'recent_order' }),
      }),
      store,
      dashboard: new DashboardEventBus(),
      toolPlanner: planner({
        intent: 'order_status',
        contextPolicy: { order: 'active' },
        entities: { asksClarification: true },
        toolCalls: [],
        responseClaims: [],
      }),
    });

    expect(output.responseText).toContain('không thể sửa trực tiếp');
    expect(output.responseText).not.toContain('đặt lại');
    expect(output.genUi?.widgetKind).toBe('orderTrackingStatus');
  });

  it('routes an explicit cancellation request to support handoff', async () => {
    const output = await runAgentTurn({
      sessionId: 'kfc:planner_cancel_order',
      customerId: 'planner_cancel_order',
      channel: 'kfc',
      text: 'Mình muốn hủy đơn vừa đặt.',
      clients: createMockClients(createTestFixtures(), {
        recentOrderProvider: () => ({ ok: true, value: paidOrder(), message: 'recent_order' }),
      }),
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      toolPlanner: planner({
        intent: 'order_status',
        contextPolicy: { order: 'active' },
        entities: {},
        toolCalls: [],
        responseClaims: [],
      }),
    });

    expect(output.state.handoff?.reasons).toContain('order_cancellation_requested');
    expect(output.genUi?.widgetKind).toBe('supportHandoff');
    expect(output.responseText).toContain('hủy đơn');
    expect(output.responseText).not.toContain('đặt lại');
  });

  it('keeps an explicit cancellation follow-up in support handoff', async () => {
    const output = await runAgentTurn({
      sessionId: 'kfc:planner_cancel_follow_up',
      customerId: 'planner_cancel_follow_up',
      channel: 'kfc',
      text: 'Nếu đơn đang giao rồi thì sao, mình vẫn muốn hủy.',
      clients: createMockClients(createTestFixtures(), {
        recentOrderProvider: () => ({ ok: true, value: paidOrder(), message: 'recent_order' }),
      }),
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      toolPlanner: planner({
        intent: 'order_status',
        contextPolicy: { order: 'active' },
        entities: {},
        toolCalls: [],
        responseClaims: [],
      }),
    });

    expect(output.state.handoff?.reasons).toContain('order_cancellation_requested');
    expect(output.genUi?.widgetKind).toBe('supportHandoff');
  });

  it('hydrates pending payment context on the first explicit payment-failure turn', async () => {
    const pendingOrder: Order = {
      ...paidOrder(),
      status: 'created',
      paymentStatus: 'pending',
    };
    const output = await runAgentTurn({
      sessionId: 'kfc:planner_payment_failure_phrase',
      customerId: 'planner_payment_failure_phrase',
      channel: 'kfc',
      text: 'Mình thanh toán rồi mà báo lỗi.',
      clients: createMockClients(createTestFixtures(), {
        recentOrderProvider: () => ({ ok: true, value: pendingOrder, message: 'recent_order' }),
      }),
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      toolPlanner: planner({
        intent: 'unclear',
        contextPolicy: {},
        entities: {},
        toolCalls: [],
        responseClaims: [],
      }),
    });

    expect(output.genUi?.widgetKind).toBe('paymentOrderStatus');
    expect(output.responseText).toContain('order_context');
    expect(output.responseText).not.toContain('cung cấp mã đơn');
  });

  it('keeps an existing support handoff visible for complaint feedback', async () => {
    const store = new MemoryStore();
    await seed(store, 'kfc:planner_handoff_context', {
      handoff: { escalationId: 'esc_context', reasons: ['customer_requested_human'] },
      toolTrace: [],
    });

    const output = await runAgentTurn({
      sessionId: 'kfc:planner_handoff_context',
      customerId: 'planner_handoff_context',
      channel: 'kfc',
      text: 'Ga ngon, chi la giao cham va sai mon.',
      clients: createMockClients(createTestFixtures()),
      store,
      dashboard: new DashboardEventBus(),
      toolPlanner: planner({
        intent: 'feedback',
        contextPolicy: { handoff: 'active' },
        entities: {},
        toolCalls: [],
        responseClaims: [],
      }),
    });

    expect(output.genUi?.widgetKind).toBe('supportHandoff');
  });

  it('keeps support handoff visible when the customer asks why they were transferred', async () => {
    const store = new MemoryStore();
    await seed(store, 'kfc:planner_handoff_explanation', {
      handoff: { escalationId: 'esc_context', reasons: ['abnormal_large_order'] },
      toolTrace: [],
    });
    const output = await runAgentTurn({
      sessionId: 'kfc:planner_handoff_explanation',
      customerId: 'planner_handoff_explanation',
      channel: 'kfc',
      text: 'Sao phải chuyển nhân viên?',
      clients: createMockClients(createTestFixtures()),
      store,
      dashboard: new DashboardEventBus(),
      toolPlanner: planner({
        intent: 'unclear',
        contextPolicy: {},
        entities: {},
        toolCalls: [],
        responseClaims: [],
      }),
    });

    expect(output.genUi?.widgetKind).toBe('supportHandoff');
  });

  it('keeps the active cart visible for an ambiguous recent-item reference', async () => {
    const store = new MemoryStore();
    await seed(store, 'kfc:planner_cart_context', { cart: cart(), toolTrace: [] });

    const output = await runAgentTurn({
      sessionId: 'kfc:planner_cart_context',
      customerId: 'planner_cart_context',
      channel: 'kfc',
      text: 'Cho minh cai do di.',
      clients: createMockClients(createTestFixtures()),
      store,
      dashboard: new DashboardEventBus(),
      toolPlanner: planner({
        intent: 'unclear',
        contextPolicy: { cart: 'active', recentTurns: 'active' },
        entities: { asksClarification: true },
        toolCalls: [],
        responseClaims: [],
      }),
    });

    expect(output.genUi?.widgetKind).toBe('cartBuilder');
  });

  it('replans before mutating newly activated cart context', async () => {
    const store = new MemoryStore();
    await seed(store, 'kfc:planner_cart_replan_context', { cart: cart(), toolTrace: [] });

    const output = await runAgentTurn({
      sessionId: 'kfc:planner_cart_replan_context',
      customerId: 'planner_cart_replan_context',
      channel: 'kfc',
      text: 'Bo mon do.',
      clients: createMockClients(createTestFixtures()),
      store,
      dashboard: new DashboardEventBus(),
      toolPlanner: multiStepPlanner([
        {
          intent: 'cart_edit',
          contextPolicy: { cart: 'active' },
          entities: {},
          toolCalls: [{ toolName: 'updateCart', arguments: { itemCode: '20751', quantity: 0 } }],
          responseClaims: [],
        },
        {
          intent: 'cart_edit',
          contextPolicy: { cart: 'confirm_before_use' },
          entities: { asksClarification: true },
          toolCalls: [],
          responseClaims: [],
          directResponse: 'Bạn muốn bỏ Combo Hợp Gu 99K khỏi giỏ hiện tại đúng không?',
        },
      ]),
    });

    expect(output.state.toolTrace?.map((entry) => entry.toolName) ?? []).not.toContain('updateCart');
    expect(output.state.cart?.items).toEqual([expect.objectContaining({ itemCode: '20751', quantity: 1 })]);
    expect(output.replyIntent).toBe('ask_clarification');
    expect(output.responseText).toContain('đúng không');
  });

  it('blocks an unconfirmed destructive cart edit in the single-step planner path', async () => {
    const store = new MemoryStore();
    await seed(store, 'kfc:planner_cart_single_step_safety', { cart: cart(), toolTrace: [] });

    const output = await runAgentTurn({
      sessionId: 'kfc:planner_cart_single_step_safety',
      customerId: 'planner_cart_single_step_safety',
      channel: 'kfc',
      text: 'Bỏ món đó',
      clients: createMockClients(createTestFixtures()),
      store,
      dashboard: new DashboardEventBus(),
      toolPlanner: planner({
        intent: 'cart_edit',
        contextPolicy: { cart: 'active' },
        entities: { cartMutationConfirmed: true },
        toolCalls: [{ toolName: 'updateCart', arguments: { itemCode: '20751', quantity: 0 } }],
        responseClaims: [],
        directResponse: 'Combo Hợp Gu 99K đã được bỏ khỏi giỏ hàng.',
      }),
    });

    expect(output.state.toolTrace?.map((entry) => entry.toolName) ?? []).not.toContain('updateCart');
    expect(output.state.cart?.items).toEqual([expect.objectContaining({ itemCode: '20751', quantity: 1 })]);
    expect(output.replyIntent).toBe('ask_clarification');
    expect(output.responseText).toContain('xác nhận');
    expect(output.responseText).not.toContain('đã được bỏ');
  });

  it('stops replanning after an ambiguous cart edit is blocked without executing tools', async () => {
    const store = new MemoryStore();
    await seed(store, 'kfc:planner_cart_clarification_latency', { cart: cart(), toolTrace: [] });
    let plannerCalls = 0;

    const output = await runAgentTurn({
      sessionId: 'kfc:planner_cart_clarification_latency',
      customerId: 'planner_cart_clarification_latency',
      channel: 'kfc',
      text: 'Bỏ món đó',
      clients: createMockClients(createTestFixtures()),
      store,
      dashboard: new DashboardEventBus(),
      toolPlanner: {
        supportsMultiStep: true,
        async plan(): Promise<ToolPlannerOutput> {
          plannerCalls += 1;
          return {
            intent: 'cart_edit',
            contextPolicy: { cart: 'active' },
            entities: { cartMutationConfirmed: true },
            toolCalls: [{ toolName: 'updateCart', arguments: { itemCode: '20751', quantity: 0 } }],
            responseClaims: [],
            directResponse: 'Combo Hợp Gu 99K đã được bỏ khỏi giỏ hàng.',
          };
        },
      },
    });

    expect(plannerCalls).toBe(2);
    expect(output.replyIntent).toBe('ask_clarification');
    expect(output.state.toolTrace?.map((entry) => entry.toolName) ?? []).not.toContain('updateCart');
  });

  it('allows a destructive cart edit after structured planner confirmation', async () => {
    const store = new MemoryStore();
    await seed(store, 'kfc:planner_cart_confirmed_edit_context', { cart: cart(), toolTrace: [] });

    const output = await runAgentTurn({
      sessionId: 'kfc:planner_cart_confirmed_edit_context',
      customerId: 'planner_cart_confirmed_edit_context',
      channel: 'kfc',
      text: 'Bo Combo Hop Gu 99K.',
      clients: createMockClients(createTestFixtures()),
      store,
      dashboard: new DashboardEventBus(),
      toolPlanner: multiStepPlanner([
        {
          intent: 'cart_edit',
          contextPolicy: { cart: 'active' },
          entities: { cartMutationConfirmed: true },
          toolCalls: [{ toolName: 'updateCart', arguments: { itemCode: '20751', quantity: 0 } }],
          responseClaims: [],
        },
        {
          intent: 'cart_edit',
          contextPolicy: { cart: 'active' },
          entities: { cartMutationConfirmed: true },
          toolCalls: [{ toolName: 'updateCart', arguments: { itemCode: '20751', quantity: 0 } }],
          responseClaims: [],
        },
      ]),
    });

    expect(output.state.toolTrace?.map((entry) => entry.toolName)).toEqual(['updateCart']);
    expect(output.state.cart?.items).toEqual([]);
  });

  it('rebuilds a previous order as a new cart from structured recent-order context', async () => {
    const output = await runAgentTurn({
      sessionId: 'kfc:planner_reorder_context',
      customerId: 'planner_reorder_context',
      channel: 'kfc',
      text: 'Dat lai don lan truoc cho minh.',
      clients: createMockClients(createTestFixtures(), {
        recentOrderProvider: () => ({ ok: true, value: paidOrder(), message: 'recent_order' }),
      }),
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      toolPlanner: planner({
        intent: 'ordering',
        contextPolicy: { recentOrder: 'active', cart: 'active' },
        entities: { reorderConfirmed: true },
        toolCalls: [],
        responseClaims: [],
      }),
    });

    expect(output.state.order).toBeUndefined();
    expect(output.state.cart?.items).toEqual([expect.objectContaining({ itemCode: '20751', quantity: 1 })]);
    expect(output.genUi?.widgetKind).toBe('cartBuilder');
  });

  it('blocks previous-order cart mutation until reorder confirmation is structured', async () => {
    const output = await runAgentTurn({
      sessionId: 'kfc:planner_reorder_unconfirmed_context',
      customerId: 'planner_reorder_unconfirmed_context',
      channel: 'kfc',
      text: 'Dat lai don cu.',
      clients: createMockClients(createTestFixtures(), {
        recentOrderProvider: () => ({ ok: true, value: paidOrder(), message: 'recent_order' }),
      }),
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      toolPlanner: multiStepPlanner([
        {
          intent: 'ordering',
          contextPolicy: { recentOrder: 'active', cart: 'active' },
          entities: {},
          toolCalls: [{ toolName: 'updateCart', arguments: { itemCode: '20751', quantity: 1 } }],
          responseClaims: [],
        },
        {
          intent: 'ordering',
          contextPolicy: { recentOrder: 'active', cart: 'active' },
          entities: {},
          toolCalls: [{ toolName: 'updateCart', arguments: { itemCode: '20751', quantity: 1 } }],
          responseClaims: [],
        },
      ]),
    });

    expect(output.state.toolTrace?.map((entry) => entry.toolName) ?? []).not.toContain('updateCart');
    expect(output.state.cart).toBeUndefined();
    expect(output.replyIntent).toBe('ask_clarification');
    expect(output.responseText).toContain('Đơn hàng trước');
  });

  it('requires confirmation before reordering for a different recipient', async () => {
    const store = new MemoryStore();
    await seed(store, 'kfc:planner_colleague_reorder', {
      order: paidOrder(),
      cart: cart(),
      handoff: { escalationId: 'esc_cancel', reasons: ['order_cancellation_requested'] },
      toolTrace: [],
    });
    const output = await runAgentTurn({
      sessionId: 'kfc:planner_colleague_reorder',
      customerId: 'planner_colleague_reorder',
      channel: 'kfc',
      text: 'Chưa hủy, cho mình đặt lại đơn lần trước cho đồng nghiệp.',
      clients: createMockClients(createTestFixtures(), {
        recentOrderProvider: () => ({ ok: true, value: paidOrder(), message: 'recent_order' }),
      }),
      store,
      dashboard: new DashboardEventBus(),
      toolPlanner: planner({
        intent: 'ordering',
        contextPolicy: { recentOrder: 'active', cart: 'active' },
        entities: { reorderConfirmed: true },
        toolCalls: [{ toolName: 'updateCart', arguments: { itemCode: '20751', quantity: 1 } }],
        responseClaims: [],
      }),
    });

    expect(output.state.toolTrace?.map((entry) => entry.toolName) ?? []).not.toContain('updateCart');
    expect(output.state.order).toBeUndefined();
    expect(output.state.handoff).toBeUndefined();
    expect(output.genUi).toBeUndefined();
    expect(output.replyIntent).toBe('ask_clarification');
  });

  it('builds the reorder cart after confirming the different-recipient request', async () => {
    const store = new MemoryStore();
    const clients = createMockClients(createTestFixtures(), {
      recentOrderProvider: () => ({ ok: true, value: paidOrder(), message: 'recent_order' }),
    });

    await runAgentTurn({
      sessionId: 'kfc:planner_colleague_reorder_confirm',
      customerId: 'planner_colleague_reorder_confirm',
      channel: 'kfc',
      text: 'Chưa hủy, cho mình đặt lại đơn lần trước cho đồng nghiệp.',
      clients,
      store,
      dashboard: new DashboardEventBus(),
      toolPlanner: planner({
        intent: 'ordering',
        contextPolicy: { recentOrder: 'active', cart: 'active' },
        entities: { reorderConfirmed: true },
        toolCalls: [{ toolName: 'updateCart', arguments: { itemCode: '20751', quantity: 1 } }],
        responseClaims: [],
      }),
    });

    const output = await runAgentTurn({
      sessionId: 'kfc:planner_colleague_reorder_confirm',
      customerId: 'planner_colleague_reorder_confirm',
      channel: 'kfc',
      text: 'Đúng rồi, nhưng đơn hiện tại cứ giữ nguyên.',
      clients,
      store,
      dashboard: new DashboardEventBus(),
      toolPlanner: planner({
        intent: 'unclear',
        contextPolicy: {},
        entities: {},
        toolCalls: [],
        responseClaims: [],
      }),
    });

    expect(output.state.cart?.items).toEqual([expect.objectContaining({ itemCode: '20751' })]);
    expect(output.genUi?.widgetKind).toBe('cartBuilder');
  });

  it('renders a verified recent item picker for a favorite-item request without mutating the cart', async () => {
    const output = await runAgentTurn({
      sessionId: 'kfc:planner_favorite_item_context',
      customerId: 'planner_favorite_item_context',
      channel: 'kfc',
      text: 'Khoan, lấy món mình hay ăn đi.',
      clients: createMockClients(createTestFixtures(), {
        recentOrderProvider: () => ({ ok: true, value: paidOrder(), message: 'recent_order' }),
      }),
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      toolPlanner: planner({
        intent: 'ordering',
        contextPolicy: {},
        entities: {},
        toolCalls: [],
        responseClaims: [],
      }),
    });

    expect(output.state.toolTrace?.map((entry) => entry.toolName)).toEqual(['searchMenu']);
    expect(output.state.cart).toBeUndefined();
    expect(output.state.escalationReasons).not.toContain('previous_order_confirmation_required');
    expect(output.genUi?.widgetKind).toBe('smartMenuPicker');
  });

  it('reuses verified menu results for a favorite-item request', async () => {
    const store = new MemoryStore();
    await seed(store, 'kfc:planner_favorite_existing_menu', {
      menuSearchResults: [{
        code: '20751',
        category: 'Combo',
        name: 'Combo Hop Gu 99K',
        description: 'Combo',
        priceVnd: 99000,
        originalPriceVnd: null,
        imageUrl: null,
        available: true,
      }],
      toolTrace: [],
    });

    const output = await runAgentTurn({
      sessionId: 'kfc:planner_favorite_existing_menu',
      customerId: 'planner_favorite_existing_menu',
      channel: 'kfc',
      text: 'Lấy món mình hay ăn đi.',
      clients: createMockClients(createTestFixtures()),
      store,
      dashboard: new DashboardEventBus(),
      toolPlanner: planner({
        intent: 'ordering',
        contextPolicy: {},
        entities: {},
        toolCalls: [],
        responseClaims: [],
      }),
    });

    expect(output.state.toolTrace).toEqual([]);
    expect(output.genUi?.widgetKind).toBe('smartMenuPicker');
  });

  it('uses a verified active-order item when favorite history is not hydrated separately', async () => {
    const store = new MemoryStore();
    await seed(store, 'kfc:planner_favorite_order_item', { order: paidOrder(), toolTrace: [] });

    const output = await runAgentTurn({
      sessionId: 'kfc:planner_favorite_order_item',
      customerId: 'planner_favorite_order_item',
      channel: 'kfc',
      text: 'Lấy món mình hay ăn đi.',
      clients: createMockClients(createTestFixtures()),
      store,
      dashboard: new DashboardEventBus(),
      toolPlanner: planner({
        intent: 'ordering',
        contextPolicy: {},
        entities: {},
        toolCalls: [],
        responseClaims: [],
      }),
    });

    expect(output.state.toolTrace?.map((entry) => entry.toolName)).toEqual(['searchMenu']);
    expect(output.state.order).toBeUndefined();
    expect(output.state.cart).toBeUndefined();
    expect(output.genUi?.widgetKind).toBe('smartMenuPicker');
  });

  it('prioritizes favorite selection over an existing draft cart without discarding the cart', async () => {
    const store = new MemoryStore();
    await seed(store, 'kfc:planner_favorite_with_cart', { cart: cart(), toolTrace: [] });

    const output = await runAgentTurn({
      sessionId: 'kfc:planner_favorite_with_cart',
      customerId: 'planner_favorite_with_cart',
      channel: 'kfc',
      text: 'Khoan, lấy món mình hay ăn đi.',
      clients: createMockClients(createTestFixtures(), {
        recentOrderProvider: () => ({ ok: true, value: paidOrder(), message: 'recent_order' }),
      }),
      store,
      dashboard: new DashboardEventBus(),
      toolPlanner: planner({
        intent: 'ordering',
        contextPolicy: {},
        entities: {},
        toolCalls: [],
        responseClaims: [],
      }),
    });

    expect(output.state.cart?.id).toBe('cart_context');
    expect(output.genUi?.widgetKind).toBe('smartMenuPicker');
  });

  it('repairs an empty favorite search with a verified recent-order item', async () => {
    const output = await runAgentTurn({
      sessionId: 'kfc:planner_favorite_empty_search',
      customerId: 'planner_favorite_empty_search',
      channel: 'kfc',
      text: 'Lấy món mình hay ăn đi.',
      clients: createMockClients(createTestFixtures(), {
        recentOrderProvider: () => ({ ok: true, value: paidOrder(), message: 'recent_order' }),
      }),
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      toolPlanner: planner({
        intent: 'ordering',
        contextPolicy: {},
        entities: {},
        toolCalls: [{ toolName: 'searchMenu', arguments: { query: 'khong-co-mon-nay' } }],
        responseClaims: [],
      }),
    });

    expect(output.state.toolTrace?.map((entry) => entry.toolName)).toEqual(['searchMenu', 'searchMenu']);
    expect(output.state.menuSearchResults).not.toHaveLength(0);
    expect(output.genUi?.widgetKind).toBe('smartMenuPicker');
  });

  it('adds a verified combo when the customer confirms a burger upgrade', async () => {
    const store = new MemoryStore();
    const fixtures = createTestFixtures();
    const burgerCombo = fixtures.menuItems.find((item) => /burger/i.test(`${item.name} ${item.description}`))!;
    await seed(store, 'kfc:planner_burger_upgrade', {
      menuSearchResults: [burgerCombo],
      toolTrace: [],
    });

    const output = await runAgentTurn({
      sessionId: 'kfc:planner_burger_upgrade',
      customerId: 'planner_burger_upgrade',
      channel: 'kfc',
      text: 'Ok, nâng lên combo có thêm burger đi.',
      clients: createMockClients(fixtures),
      store,
      dashboard: new DashboardEventBus(),
      toolPlanner: planner({
        intent: 'ordering',
        contextPolicy: { menuSearchResults: 'active' },
        entities: {},
        toolCalls: [{ toolName: 'searchMenu', arguments: { query: 'khong-co-mon' } }],
        responseClaims: [],
      }),
    });

    expect(output.state.toolTrace?.map((entry) => entry.toolName)).toEqual(['searchMenu', 'searchMenu', 'updateCart']);
    expect(output.state.cart?.items).toEqual([expect.objectContaining({ itemCode: burgerCombo.code })]);
    expect(output.genUi?.widgetKind).toBe('cartBuilder');
  });

  it('adds an ambiguously referenced verified menu item and keeps the cart on follow-up', async () => {
    const store = new MemoryStore();
    const fixtures = createTestFixtures();
    const selectedItem = fixtures.menuItems[0]!;
    await seed(store, 'kfc:planner_ambiguous_menu_add', {
      menuSearchResults: [selectedItem],
      toolTrace: [],
    });
    const clients = createMockClients(fixtures);
    const first = await runAgentTurn({
      sessionId: 'kfc:planner_ambiguous_menu_add',
      customerId: 'planner_ambiguous_menu_add',
      channel: 'kfc',
      text: 'Cho mình cái đó đi.',
      clients,
      store,
      dashboard: new DashboardEventBus(),
      toolPlanner: planner({
        intent: 'unclear',
        contextPolicy: { menuSearchResults: 'active' },
        entities: {},
        toolCalls: [],
        responseClaims: [],
      }),
    });

    expect(first.state.cart?.items).toEqual([expect.objectContaining({ itemCode: selectedItem.code })]);
    expect(first.genUi?.widgetKind).toBe('cartBuilder');

    const second = await runAgentTurn({
      sessionId: 'kfc:planner_ambiguous_menu_add',
      customerId: 'planner_ambiguous_menu_add',
      channel: 'kfc',
      text: 'Cái phần giống hôm bữa á.',
      clients,
      store,
      dashboard: new DashboardEventBus(),
      toolPlanner: planner({
        intent: 'unclear',
        contextPolicy: { menuSearchResults: 'active' },
        entities: { keepMenuSurface: true },
        toolCalls: [],
        responseClaims: [],
      }),
    });

    expect(second.genUi?.widgetKind).toBe('cartBuilder');
  });

  it('forces human review for an explicit abnormal quantity despite a reorder plan', async () => {
    const output = await runAgentTurn({
      sessionId: 'kfc:planner_abnormal_quantity_context',
      customerId: 'planner_abnormal_quantity_context',
      channel: 'kfc',
      text: 'Vậy đặt cho mình 200 combo gà, giao trong 30 phút.',
      clients: createMockClients(createTestFixtures(), {
        recentOrderProvider: () => ({ ok: true, value: paidOrder(), message: 'recent_order' }),
      }),
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      toolPlanner: planner({
        intent: 'ordering',
        contextPolicy: { recentOrder: 'confirm_before_use', cart: 'active' },
        entities: { asksClarification: true },
        toolCalls: [],
        responseClaims: [],
      }),
    });

    expect(output.state.toolTrace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolName: 'handoff',
          ok: true,
          arguments: {
            reasons: ['abnormal_large_order', 'human_review_required'],
          },
        }),
      ]),
    );
    expect(output.genUi?.widgetKind).toBe('supportHandoff');
  });

  it('completes membership profile evidence when membership context is active for the current cart', async () => {
    const store = new MemoryStore();
    await seed(store, 'kfc:planner_membership_context', { cart: cart(), toolTrace: [] });

    const output = await runAgentTurn({
      sessionId: 'kfc:planner_membership_context',
      customerId: 'planner_membership_context',
      channel: 'kfc',
      text: 'Diem thanh vien co dung duoc cho gio nay khong?',
      clients: createMockClients(createTestFixtures()),
      store,
      dashboard: new DashboardEventBus(),
      toolPlanner: planner({
        intent: 'voucher',
        contextPolicy: { membership: 'active', cart: 'active' },
        entities: {},
        toolCalls: [
          { toolName: 'listMembershipRewards', arguments: {} },
          { toolName: 'listMembershipWallet', arguments: {} },
        ],
        responseClaims: [],
      }),
      responseComposer: {
        async composeResponse() {
          return 'Bạn vui lòng chọn voucher đổi điểm muốn áp dụng cho giỏ hàng hiện tại.';
        },
      },
    });

    expect(output.state.toolTrace?.map((entry) => entry.toolName)).toEqual([
      'getMembershipProfile',
      'listMembershipRewards',
      'listMembershipWallet',
    ]);
    expect(output.responseText).toBe('Bạn vui lòng chọn voucher đổi điểm muốn áp dụng cho giỏ hàng hiện tại.');
  });

  it('keeps Messenger cart replies on the verified fallback instead of natural-language composition', async () => {
    const composerCalls: string[] = [];
    const output = await runAgentTurn({
      sessionId: 'kfc:messenger_compact_cart_reply',
      customerId: 'messenger_compact_cart_reply',
      channel: 'messenger',
      text: 'Cho mình 1 Combo Hợp Gu 99K',
      clients: createMockClients(createTestFixtures()),
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      toolPlanner: planner({
        intent: 'ordering',
        contextPolicy: { cart: 'active' },
        entities: { cartMutationRequested: true },
        toolCalls: [
          { toolName: 'searchMenu', arguments: { query: 'Combo Hợp Gu 99K' } },
          { toolName: 'updateCart', arguments: { itemCode: '20751', quantity: 1 } },
        ],
        responseClaims: [],
      }),
      responseComposer: {
        async composeResponse() {
          composerCalls.push('called');
          return 'Bạn đã đặt món rồi nhé!';
        },
      },
    });

    expect(composerCalls).toEqual(['called']);
    expect(output.responseText).toContain('Combo Hợp Gu 99K');
    expect(output.responseText).toContain('địa chỉ giao hàng');
    expect(output.responseText).not.toContain('Bước tiếp theo:');
    expect(output.responseText).not.toBe('Bạn đã đặt món rồi nhé!');
  });
});
