import { describe, expect, it } from 'vitest';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import type { Cart, Order } from '../../src/domain/types.js';
import { runAgentTurn } from '../../src/graph/buildGraph.js';
import type { ToolPlannerOutput } from '../../src/llm/toolPlanner.js';
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
        entities: {},
        toolCalls: [],
        responseClaims: [],
        directResponse: 'Minh se tim combo nhom phu hop.',
      }),
    });

    expect(output.genUi?.widgetKind).toBe('smartMenuPicker');
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
        rawEvent: {
          genUiAction: {
            attachmentId: 'fulfillment_attachment',
            actionId: 'accept_fulfillment',
          },
        },
      },
      clients: createMockClients(createTestFixtures()),
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
        rawEvent: {
          genUiAction: {
            attachmentId: 'cart_attachment',
            actionId: 'continue_to_fulfillment',
          },
        },
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
    expect(output.responseText).toContain('điểm thành viên');
    expect(output.responseText).toContain('giỏ hiện tại');
  });
});
