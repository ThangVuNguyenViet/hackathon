import { describe, expect, it } from 'vitest';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import type { Cart, Order } from '../../src/domain/types.js';
import { runAgentTurn } from '../../src/graph/buildGraph.js';
import { mergeContextPolicies } from '../../src/graph/contextPolicy.js';
import type { AgentGraphState } from '../../src/graph/state.js';
import type { ToolPlanner, ToolPlannerInput, ToolPlannerOutput } from '../../src/llm/toolPlanner.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';

function comboCart(): Cart {
  return {
    id: 'cart_recent_order',
    items: [
      {
        itemCode: '20751',
        name: 'Combo Hợp Gu 99K',
        quantity: 1,
        unitPriceVnd: 99000,
      },
    ],
    subtotalVnd: 99000,
    discountVnd: 0,
    deliveryFeeVnd: 0,
    totalVnd: 99000,
    voucherCode: null,
  };
}

function recentOrder(): Order {
  return {
    id: 'order_recent_1',
    cart: comboCart(),
    status: 'completed',
    paymentStatus: 'paid',
    assignedStoreId: 'KFCVN0002',
    createdAt: '2026-07-09T10:00:00.000Z',
  };
}

function pendingRecentOrder(): Order {
  return {
    ...recentOrder(),
    id: 'order_pending_payment',
    status: 'created',
    paymentStatus: 'pending',
  };
}

class RecordingPlanner implements ToolPlanner {
  observedState: AgentGraphState | undefined;

  async plan(input: ToolPlannerInput): Promise<ToolPlannerOutput> {
    this.observedState = input.state;
    return {
      intent: 'unclear',
      entities: {},
      toolCalls: [],
      responseClaims: [],
      directResponse: 'Chào bạn! Mình có thể giúp bạn xem menu hoặc hỗ trợ đơn hàng KFC.',
    };
  }
}

describe('context policy', () => {
  it('does not let planner policy downgrade explicit metadata context directives', () => {
    expect(
      mergeContextPolicies(
        { recentOrder: 'active', cart: 'active', handoff: 'operator_only', order: 'confirm_before_use' },
        { recentOrder: 'irrelevant', cart: 'background_only', handoff: 'active', order: 'active', membership: 'active' },
      ),
    ).toEqual({
      recentOrder: 'active',
      cart: 'active',
      handoff: 'operator_only',
      order: 'confirm_before_use',
      membership: 'active',
    });
  });

  it('does not expose a recent order cart as active planner state for a neutral greeting', async () => {
    const planner = new RecordingPlanner();
    const store = new MemoryStore();

    const output = await runAgentTurn({
      sessionId: 'session_context_greeting_recent_order',
      customerId: 'customer_1',
      channel: 'kfc',
      text: 'hi',
      clients: createMockClients(createTestFixtures(), {
        recentOrderProvider: () => ({ ok: true, value: recentOrder(), message: 'recent_order_fixture' }),
      }),
      store,
      dashboard: new DashboardEventBus(),
      toolPlanner: planner,
    });

    expect(planner.observedState?.cart).toBeUndefined();
    expect(planner.observedState?.order).toBeUndefined();
    expect(planner.observedState?.paymentAttempt).toBeUndefined();
    expect(planner.observedState?.customerContext).toBeUndefined();
    expect(output.responseText).not.toContain('Combo Hợp Gu 99K');
    expect(output.responseText.toLowerCase()).not.toContain('giỏ');
    expect(output.state.cart).toBeUndefined();
    expect(output.state.order).toBeUndefined();
    expect(output.state.paymentAttempt).toBeUndefined();
  });

  it('hydrates recent paid order status from structured order context metadata', async () => {
    const planner = new RecordingPlanner();
    const store = new MemoryStore();

    const output = await runAgentTurn({
      sessionId: 'kfc:session_recent_order_status_text',
      customerId: 'customer_recent_order_status',
      channel: 'kfc',
      text: 'Đơn của mình tới đâu rồi?',
      clients: createMockClients(createTestFixtures(), {
        recentOrderProvider: () => ({
          ok: true,
          value: recentOrder(),
          message: 'recent_order_fixture',
        }),
      }),
      metadata: { rawEvent: { contextPolicy: { order: 'active', payment: 'active' } } },
      store,
      dashboard: new DashboardEventBus(),
      toolPlanner: planner,
    });

    expect(planner.observedState?.order).toMatchObject({
      id: 'order_recent_1',
      paymentStatus: 'paid',
    });
    expect(output.state.paymentAttempt).toMatchObject({ status: 'paid' });
    expect(output.genUi).toMatchObject({ widgetKind: 'orderTrackingStatus' });
  });

  it('asks for confirmation before using structured recent-order context metadata', async () => {
    const store = new MemoryStore();

    const output = await runAgentTurn({
      sessionId: 'kfc:session_reorder_text',
      customerId: 'customer_reorder_text',
      channel: 'kfc',
      text: 'Đặt lại đơn lần trước cho mình.',
      clients: createMockClients(createTestFixtures(), {
        recentOrderProvider: () => ({
          ok: true,
          value: recentOrder(),
          message: 'recent_order_fixture',
        }),
      }),
      metadata: { rawEvent: { contextPolicy: { recentOrder: 'active', cart: 'active' } } },
      store,
      dashboard: new DashboardEventBus(),
      toolPlanner: new RecordingPlanner(),
    });

    expect(output.state.cart).toBeUndefined();
    expect(output.state.order).toBeUndefined();
    expect(output.replyIntent).toBe('ask_clarification');
    expect(output.responseText).toContain('Đơn hàng trước');
  });

  it('does not expose an existing session cart as active planner state for a neutral greeting', async () => {
    const planner = new RecordingPlanner();
    const store = new MemoryStore();
    const clients = createMockClients(createTestFixtures());

    await runAgentTurn({
      sessionId: 'session_context_greeting_existing_cart',
      customerId: 'customer_1',
      channel: 'kfc',
      text: 'Cho mình Combo Hợp Gu 99K',
      clients,
      store,
      dashboard: new DashboardEventBus(),
      toolPlanner: {
        async plan(): Promise<ToolPlannerOutput> {
          return {
            intent: 'ordering',
            entities: { itemText: 'Combo Hợp Gu 99K' },
            toolCalls: [
              { toolName: 'searchMenu', arguments: { query: 'Combo Hợp Gu 99K' } },
              { toolName: 'updateCart', arguments: { itemCode: '20751', quantity: 1 } },
            ],
            responseClaims: [],
          };
        },
      },
    });

    const output = await runAgentTurn({
      sessionId: 'session_context_greeting_existing_cart',
      customerId: 'customer_1',
      channel: 'kfc',
      text: 'hi',
      clients,
      store,
      dashboard: new DashboardEventBus(),
      toolPlanner: planner,
    });

    expect(planner.observedState?.cart).toBeUndefined();
    expect(planner.observedState?.toolTrace).toEqual([]);
    expect(output.responseText).not.toContain('Combo Hợp Gu 99K');
    expect(output.responseText.toLowerCase()).not.toContain('giỏ');
    expect(output.responseText.toLowerCase()).not.toContain('địa chỉ');
    expect(output.state.cart?.items).toEqual([expect.objectContaining({ itemCode: '20751', quantity: 1 })]);
  });

  it('does not expose an existing session cart without structured context metadata', async () => {
    const planner = new RecordingPlanner();
    const store = new MemoryStore();
    const clients = createMockClients(createTestFixtures());

    await runAgentTurn({
      sessionId: 'session_context_no_metadata_existing_cart',
      customerId: 'customer_1',
      channel: 'kfc',
      text: 'Cho mình Combo Hợp Gu 99K',
      clients,
      store,
      dashboard: new DashboardEventBus(),
      toolPlanner: {
        async plan(): Promise<ToolPlannerOutput> {
          return {
            intent: 'ordering',
            entities: { itemText: 'Combo Hợp Gu 99K' },
            toolCalls: [
              { toolName: 'searchMenu', arguments: { query: 'Combo Hợp Gu 99K' } },
              { toolName: 'updateCart', arguments: { itemCode: '20751', quantity: 1 } },
            ],
            responseClaims: [],
          };
        },
      },
    });

    const output = await runAgentTurn({
      sessionId: 'session_context_no_metadata_existing_cart',
      customerId: 'customer_1',
      channel: 'kfc',
      text: 'please keep going',
      clients,
      store,
      dashboard: new DashboardEventBus(),
      toolPlanner: planner,
    });

    expect(planner.observedState?.cart).toBeUndefined();
    expect(output.responseText).not.toContain('Combo Hợp Gu 99K');
    expect(output.state.cart?.items).toEqual([expect.objectContaining({ itemCode: '20751', quantity: 1 })]);
  });

  it('resumes an existing session cart when structured metadata marks cart context active', async () => {
    const planner = new RecordingPlanner();
    const store = new MemoryStore();
    const clients = createMockClients(createTestFixtures());

    await runAgentTurn({
      sessionId: 'session_context_metadata_existing_cart',
      customerId: 'customer_1',
      channel: 'kfc',
      text: 'Cho mình Combo Hợp Gu 99K',
      clients,
      store,
      dashboard: new DashboardEventBus(),
      toolPlanner: {
        async plan(): Promise<ToolPlannerOutput> {
          return {
            intent: 'ordering',
            entities: { itemText: 'Combo Hợp Gu 99K' },
            toolCalls: [
              { toolName: 'searchMenu', arguments: { query: 'Combo Hợp Gu 99K' } },
              { toolName: 'updateCart', arguments: { itemCode: '20751', quantity: 1 } },
            ],
            responseClaims: [],
          };
        },
      },
    });

    await runAgentTurn({
      sessionId: 'session_context_metadata_existing_cart',
      customerId: 'customer_1',
      channel: 'kfc',
      text: 'continue',
      metadata: { rawEvent: { contextPolicy: { cart: 'active' } } },
      clients,
      store,
      dashboard: new DashboardEventBus(),
      toolPlanner: planner,
    });

    expect(planner.observedState?.cart?.items).toEqual([expect.objectContaining({ itemCode: '20751', quantity: 1 })]);
  });

  it('treats broad menu browsing as fresh browsing when a cart already exists', async () => {
    const planner = new RecordingPlanner();
    const store = new MemoryStore();
    const clients = createMockClients(createTestFixtures());

    await runAgentTurn({
      sessionId: 'session_context_menu_existing_cart',
      customerId: 'customer_1',
      channel: 'kfc',
      text: 'Cho mình Combo Hợp Gu 99K',
      clients,
      store,
      dashboard: new DashboardEventBus(),
      toolPlanner: {
        async plan(): Promise<ToolPlannerOutput> {
          return {
            intent: 'ordering',
            entities: { itemText: 'Combo Hợp Gu 99K' },
            toolCalls: [
              { toolName: 'searchMenu', arguments: { query: 'Combo Hợp Gu 99K' } },
              { toolName: 'updateCart', arguments: { itemCode: '20751', quantity: 1 } },
            ],
            responseClaims: [],
          };
        },
      },
    });

    planner.plan = async (input: ToolPlannerInput): Promise<ToolPlannerOutput> => {
      planner.observedState = input.state;
      return {
        intent: 'unclear',
        entities: {},
        toolCalls: [{ toolName: 'searchMenu', arguments: {} }],
        responseClaims: [],
      };
    };

    const output = await runAgentTurn({
      sessionId: 'session_context_menu_existing_cart',
      customerId: 'customer_1',
      channel: 'kfc',
      text: 'menu có gì?',
      clients,
      store,
      dashboard: new DashboardEventBus(),
      toolPlanner: planner,
    });

    expect(planner.observedState?.cart).toBeUndefined();
    expect(output.responseText).toContain('Mình tìm thấy');
    expect(output.responseText.toLowerCase()).not.toContain('giỏ');
    expect(output.state.cart?.items).toEqual([expect.objectContaining({ itemCode: '20751', quantity: 1 })]);
    expect(output.state.menuSearchResults?.length).toBeGreaterThan(0);
  });

  it('ignores unrelated cart context for complaints', async () => {
    const planner = new RecordingPlanner();
    const store = new MemoryStore();
    const clients = createMockClients(createTestFixtures());

    await runAgentTurn({
      sessionId: 'session_context_complaint_existing_cart',
      customerId: 'customer_1',
      channel: 'kfc',
      text: 'Cho mình Combo Hợp Gu 99K',
      clients,
      store,
      dashboard: new DashboardEventBus(),
      toolPlanner: {
        async plan(): Promise<ToolPlannerOutput> {
          return {
            intent: 'ordering',
            entities: { itemText: 'Combo Hợp Gu 99K' },
            toolCalls: [
              { toolName: 'searchMenu', arguments: { query: 'Combo Hợp Gu 99K' } },
              { toolName: 'updateCart', arguments: { itemCode: '20751', quantity: 1 } },
            ],
            responseClaims: [],
          };
        },
      },
    });

    const output = await runAgentTurn({
      sessionId: 'session_context_complaint_existing_cart',
      customerId: 'customer_1',
      channel: 'kfc',
      text: 'mình muốn khiếu nại thái độ nhân viên',
      clients,
      store,
      dashboard: new DashboardEventBus(),
      toolPlanner: planner,
    });

    expect(planner.observedState?.cart).toBeUndefined();
    expect(output.responseText).not.toContain('Combo Hợp Gu 99K');
    expect(output.responseText.toLowerCase()).not.toContain('giỏ');
    expect(output.state.cart?.items).toEqual([expect.objectContaining({ itemCode: '20751', quantity: 1 })]);
  });

  it('keeps cart context operator-only for direct human handoff requests', async () => {
    const planner = new RecordingPlanner();
    const store = new MemoryStore();
    const clients = createMockClients(createTestFixtures());

    await runAgentTurn({
      sessionId: 'session_context_handoff_existing_cart',
      customerId: 'customer_1',
      channel: 'kfc',
      text: 'Cho mình Combo Hợp Gu 99K',
      clients,
      store,
      dashboard: new DashboardEventBus(),
      toolPlanner: {
        async plan(): Promise<ToolPlannerOutput> {
          return {
            intent: 'ordering',
            entities: { itemText: 'Combo Hợp Gu 99K' },
            toolCalls: [
              { toolName: 'searchMenu', arguments: { query: 'Combo Hợp Gu 99K' } },
              { toolName: 'updateCart', arguments: { itemCode: '20751', quantity: 1 } },
            ],
            responseClaims: [],
          };
        },
      },
    });

    planner.plan = async (input: ToolPlannerInput): Promise<ToolPlannerOutput> => {
      planner.observedState = input.state;
      return {
        intent: 'handoff',
        entities: {},
        toolCalls: [{ toolName: 'handoff', arguments: { reasons: ['customer_requested_human'] } }],
        responseClaims: [],
      };
    };

    const output = await runAgentTurn({
      sessionId: 'session_context_handoff_existing_cart',
      customerId: 'customer_1',
      channel: 'kfc',
      text: 'gặp nhân viên',
      clients,
      store,
      dashboard: new DashboardEventBus(),
      toolPlanner: planner,
    });

    expect(planner.observedState?.cart).toBeUndefined();
    expect(output.responseText).not.toContain('Combo Hợp Gu 99K');
    expect(output.responseText.toLowerCase()).not.toContain('giỏ');
    expect(output.state.cart?.items).toEqual([expect.objectContaining({ itemCode: '20751', quantity: 1 })]);
    expect(output.state.handoff?.reasons).toEqual(['customer_requested_human']);
  });

  it('repairs text-only group meal recommendations with verified menu results for GenUI', async () => {
    const output = await runAgentTurn({
      sessionId: 'session_context_menu_repair',
      customerId: 'customer_1',
      channel: 'kfc',
      text: 'Mình đặt đồ ăn trưa cho 10 người ở công ty. Tầm 300k thì ăn được gì?',
      clients: createMockClients(createTestFixtures()),
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      toolPlanner: {
        supportsMultiStep: true,
        async plan(): Promise<ToolPlannerOutput> {
          return {
            intent: 'ordering',
            entities: {},
            toolCalls: [],
            responseClaims: [],
            directResponse: 'Mình đã tìm các combo nhóm phù hợp.',
          };
        },
      },
    });

    expect(output.state.menuSearchResults?.length).toBeGreaterThan(0);
    expect(output.genUi?.widgetKind).toBe('smartMenuPicker');
  });

  it('preserves verified paid recent order context for tracking turns', async () => {
    const output = await runAgentTurn({
      sessionId: 'session_context_tracking_recent_order',
      customerId: 'customer_1',
      channel: 'kfc',
      text: 'Đơn của mình tới đâu rồi?',
      clients: createMockClients(createTestFixtures(), {
        recentOrderProvider: () => ({ ok: true, value: recentOrder(), message: 'recent_order_fixture' }),
      }),
      metadata: { rawEvent: { contextPolicy: { order: 'active', payment: 'active' } } },
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      toolPlanner: {
        supportsMultiStep: true,
        async plan(): Promise<ToolPlannerOutput> {
          return {
            intent: 'order_status',
            entities: {},
            toolCalls: [],
            responseClaims: [],
            directResponse: 'Đơn đang được chuẩn bị.',
          };
        },
      },
    });

    expect(output.state.order?.id).toBe('order_recent_1');
    expect(output.genUi?.widgetKind).toBe('orderTrackingStatus');
  });

  it('preserves verified pending payment context for payment error turns', async () => {
    const output = await runAgentTurn({
      sessionId: 'session_context_payment_recent_order',
      customerId: 'customer_1',
      channel: 'kfc',
      text: 'Mình thanh toán rồi mà báo lỗi.',
      clients: createMockClients(createTestFixtures(), {
        recentOrderProvider: () => ({ ok: true, value: pendingRecentOrder(), message: 'pending_order_fixture' }),
      }),
      metadata: { rawEvent: { contextPolicy: { order: 'active', payment: 'active' } } },
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      toolPlanner: {
        supportsMultiStep: true,
        async plan(): Promise<ToolPlannerOutput> {
          return {
            intent: 'payment',
            entities: {},
            toolCalls: [],
            responseClaims: [],
            directResponse: 'Mình kiểm tra lại thanh toán cho đơn gần nhất.',
          };
        },
      },
    });

    expect(output.state.order?.id).toBe('order_pending_payment');
    expect(output.genUi?.widgetKind).toBe('paymentOrderStatus');
  });

  it('blocks unjustified handoff and asks before using previous-order reorder context', async () => {
    const output = await runAgentTurn({
      sessionId: 'session_context_reorder_no_handoff',
      customerId: 'customer_1',
      channel: 'kfc',
      text: 'Đặt lại đơn lần trước cho mình.',
      clients: createMockClients(createTestFixtures(), {
        recentOrderProvider: () => ({ ok: true, value: recentOrder(), message: 'recent_order_fixture' }),
      }),
      metadata: { rawEvent: { contextPolicy: { recentOrder: 'active', cart: 'active' } } },
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      toolPlanner: {
        supportsMultiStep: true,
        async plan(): Promise<ToolPlannerOutput> {
          return {
            intent: 'ordering',
            entities: {},
            toolCalls: [{ toolName: 'handoff', arguments: { reasons: ['customer_requested_human'] } }],
            responseClaims: [],
          };
        },
      },
    });

    expect(output.state.handoff).toBeUndefined();
    expect(output.state.cart).toBeUndefined();
    expect(output.replyIntent).toBe('ask_clarification');
    expect(output.responseText).toContain('Đơn hàng trước');
  });
});
