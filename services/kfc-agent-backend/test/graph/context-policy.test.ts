import { describe, expect, it } from 'vitest';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import type { Cart, Order } from '../../src/domain/types.js';
import { runAgentTurn } from '../../src/graph/buildGraph.js';
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
  it('does not expose a recent order cart as active planner state for a neutral greeting', async () => {
    const planner = new RecordingPlanner();
    const store = new MemoryStore();

    const output = await runAgentTurn({
      sessionId: 'session_context_greeting_recent_order',
      customerId: 'customer_1',
      channel: 'web_mock',
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

  it('does not expose an existing session cart as active planner state for a neutral greeting', async () => {
    const planner = new RecordingPlanner();
    const store = new MemoryStore();
    const clients = createMockClients(createTestFixtures());

    await runAgentTurn({
      sessionId: 'session_context_greeting_existing_cart',
      customerId: 'customer_1',
      channel: 'web_mock',
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
      channel: 'web_mock',
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
      channel: 'web_mock',
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
      channel: 'web_mock',
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
      channel: 'web_mock',
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
      channel: 'web_mock',
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
      channel: 'web_mock',
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
      channel: 'web_mock',
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
      channel: 'web_mock',
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
      channel: 'web_mock',
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
      channel: 'web_mock',
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
      channel: 'web_mock',
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
});
