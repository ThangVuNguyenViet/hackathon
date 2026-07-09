import { describe, expect, it } from 'vitest';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import { runAgentTurn } from '../../src/graph/buildGraph.js';
import { StaticToolPlanner } from '../../src/llm/toolPlanner.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';

describe('AI tool graph', () => {
  it('falls back instead of failing the turn when the planner request fails', async () => {
    const store = new MemoryStore();
    const output = await runAgentTurn({
      sessionId: 'session_planner_failed',
      customerId: 'customer_1',
      channel: 'web_mock',
      text: 'Cho mình Combo Hợp Gu 99K',
      clients: createMockClients(createTestFixtures()),
      store,
      dashboard: new DashboardEventBus(),
      toolPlanner: {
        async plan() {
          throw new Error('OpenAI tool planning failed: Country, region, or territory not supported');
        },
      },
    });

    expect(output.responseText).toBe('Mình cần thêm thông tin để hỗ trợ đúng.');
    expect(output.replyIntent).toBe('ask_clarification');
    expect(await store.listEvents('session_planner_failed')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceType: 'llm:tool_planner_failed',
          payload: expect.objectContaining({
            message: 'OpenAI tool planning failed: Country, region, or territory not supported',
          }),
        }),
      ]),
    );
  });

  it('adds a menu item through planned fixture-backed tools', async () => {
    const output = await runAgentTurn({
      sessionId: 'session_ai_menu',
      customerId: 'customer_1',
      channel: 'web_mock',
      text: 'Cho mình Combo Hợp Gu 99K',
      clients: createMockClients(createTestFixtures()),
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      toolPlanner: new StaticToolPlanner([
        {
          intent: 'ordering',
          entities: { itemText: 'Combo Hợp Gu 99K' },
          toolCalls: [
            { toolName: 'searchMenu', arguments: { query: 'Combo Hợp Gu 99K' } },
            { toolName: 'updateCart', arguments: { itemCode: '20751', quantity: 1 } },
          ],
          responseClaims: [],
        },
      ]),
    });

    expect(output.state.cart?.items[0]).toMatchObject({ itemCode: '20751', name: 'Combo Hợp Gu 99K' });
    expect(output.state.toolTrace?.map((entry) => entry.toolName)).toEqual(['searchMenu', 'updateCart']);
  });

  it('adds a verified single menu search result when the planner only searches but the user asks to order', async () => {
    const dashboard = new DashboardEventBus();
    const output = await runAgentTurn({
      sessionId: 'session_ai_search_derived_cart',
      customerId: 'customer_1',
      channel: 'web_mock',
      text: 'Mình muốn đặt 1 phần Combo Hợp Gu 99K vào giỏ hàng',
      clients: createMockClients(createTestFixtures()),
      store: new MemoryStore(),
      dashboard,
      toolPlanner: new StaticToolPlanner([
        {
          intent: 'ordering',
          entities: { itemText: 'Combo Hợp Gu 99K' },
          toolCalls: [{ toolName: 'searchMenu', arguments: { query: 'Combo Hợp Gu 99K' } }],
          responseClaims: [],
        },
      ]),
    });

    expect(output.state.cart?.items[0]).toMatchObject({
      itemCode: '20751',
      name: 'Combo Hợp Gu 99K',
      quantity: 1,
    });
    expect(output.state.toolTrace?.map((entry) => entry.toolName)).toEqual(['searchMenu', 'updateCart']);
    expect(dashboard.getEvents('session_ai_search_derived_cart')).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'cart_changed' })]),
    );
  });

  it('does not mutate the cart from a search-only informational product question', async () => {
    const output = await runAgentTurn({
      sessionId: 'session_ai_search_only_info',
      customerId: 'customer_1',
      channel: 'web_mock',
      text: 'Combo Hợp Gu 99K gồm gì?',
      clients: createMockClients(createTestFixtures()),
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      toolPlanner: new StaticToolPlanner([
        {
          intent: 'ordering',
          entities: { itemText: 'Combo Hợp Gu 99K' },
          toolCalls: [{ toolName: 'searchMenu', arguments: { query: 'Combo Hợp Gu 99K' } }],
          responseClaims: [],
        },
      ]),
    });

    expect(output.state.cart).toBeUndefined();
    expect(output.state.toolTrace?.map((entry) => entry.toolName)).toEqual(['searchMenu']);
  });

  it('previews an order before placing it when the planner asks to place a confirmed order directly', async () => {
    const store = new MemoryStore();
    const dashboard = new DashboardEventBus();
    const clients = createMockClients(createTestFixtures(), {
      fulfillmentQuoteProvider: async () => ({ ok: true, value: { feeVnd: 18000, etaMinutes: 35 }, message: 'ok' }),
    });
    const toolPlanner = new StaticToolPlanner([
      {
        intent: 'ordering',
        entities: { itemText: 'Combo Hợp Gu 99K' },
        toolCalls: [
          { toolName: 'searchMenu', arguments: { query: 'Combo Hợp Gu 99K' } },
          { toolName: 'updateCart', arguments: { itemCode: '20751', quantity: 1 } },
        ],
        responseClaims: [],
      },
      {
        intent: 'ordering',
        entities: { fulfillmentMethod: 'delivery' },
        toolCalls: [
          {
            toolName: 'quoteFulfillment',
            arguments: {
              address: { label: 'Big C Đồng Nai', line1: 'Big C Đồng Nai', district: 'Biên Hòa', city: 'Đồng Nai' },
              method: 'delivery',
              itemCodes: ['20751'],
            },
          },
        ],
        responseClaims: [],
      },
      {
        intent: 'ordering',
        entities: {},
        toolCalls: [{ toolName: 'placeOrder', arguments: {} }],
        responseClaims: [],
      },
    ]);

    await runAgentTurn({
      sessionId: 'session_ai_direct_place_order',
      customerId: 'customer_1',
      channel: 'web_mock',
      text: 'Mình muốn đặt 1 phần Combo Hợp Gu 99K vào giỏ hàng',
      clients,
      store,
      dashboard,
      toolPlanner,
    });
    await runAgentTurn({
      sessionId: 'session_ai_direct_place_order',
      customerId: 'customer_1',
      channel: 'web_mock',
      text: 'Giao tới Big C Đồng Nai, Biên Hòa, Đồng Nai',
      clients,
      store,
      dashboard,
      toolPlanner,
    });
    const output = await runAgentTurn({
      sessionId: 'session_ai_direct_place_order',
      customerId: 'customer_1',
      channel: 'web_mock',
      text: 'Xác nhận đơn',
      clients,
      store,
      dashboard,
      toolPlanner,
    });

    const traceNames = output.state.toolTrace?.map((entry) => entry.toolName) ?? [];
    expect(output.state.orderPreview?.status).toBe('previewed');
    expect(output.state.order?.status).toBe('created');
    expect(traceNames.slice(-2)).toEqual(['previewOrder', 'placeOrder']);
    expect(dashboard.getEvents('session_ai_direct_place_order')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'order_previewed' }),
        expect.objectContaining({ type: 'order_created' }),
      ]),
    );
  });

  it('fills explicit address and confirmation tool gaps through fixture-backed orchestration', async () => {
    const store = new MemoryStore();
    const dashboard = new DashboardEventBus();
    const clients = createMockClients(createTestFixtures(), {
      fulfillmentQuoteProvider: async () => ({ ok: true, value: { feeVnd: 18000, etaMinutes: 35 }, message: 'ok' }),
    });
    const toolPlanner = new StaticToolPlanner([
      {
        intent: 'ordering',
        entities: { itemText: 'Combo Hợp Gu 99K' },
        toolCalls: [
          { toolName: 'searchMenu', arguments: { query: 'Combo Hợp Gu 99K' } },
          { toolName: 'updateCart', arguments: { itemCode: '20751', quantity: 1 } },
        ],
        responseClaims: [],
      },
      {
        intent: 'ordering',
        entities: { addressText: 'Big C Đồng Nai, Biên Hòa, Đồng Nai' },
        toolCalls: [],
        responseClaims: [],
      },
      {
        intent: 'ordering',
        entities: {},
        toolCalls: [],
        responseClaims: [],
      },
    ]);

    await runAgentTurn({
      sessionId: 'session_ai_derived_address_confirm',
      customerId: 'customer_1',
      channel: 'web_mock',
      text: 'Mình muốn đặt 1 phần Combo Hợp Gu 99K vào giỏ hàng',
      clients,
      store,
      dashboard,
      toolPlanner,
    });
    const quoteOutput = await runAgentTurn({
      sessionId: 'session_ai_derived_address_confirm',
      customerId: 'customer_1',
      channel: 'web_mock',
      text: 'Giao tới Big C Đồng Nai, Biên Hòa, Đồng Nai',
      clients,
      store,
      dashboard,
      toolPlanner,
    });
    const finalOutput = await runAgentTurn({
      sessionId: 'session_ai_derived_address_confirm',
      customerId: 'customer_1',
      channel: 'web_mock',
      text: 'Xác nhận đơn và đặt ngay',
      clients,
      store,
      dashboard,
      toolPlanner,
    });

    expect(quoteOutput.state.fulfillment).toMatchObject({
      storeId: 'KFCVN0002',
      feeVnd: 18000,
      etaMinutes: 35,
    });
    expect(finalOutput.state.order).toMatchObject({
      id: 'KFC-MOCK-1001',
      status: 'created',
      assignedStoreId: 'KFCVN0002',
    });
    expect(finalOutput.state.toolTrace?.map((entry) => entry.toolName)).toEqual(
      expect.arrayContaining(['quoteFulfillment', 'previewOrder', 'placeOrder']),
    );
    expect(dashboard.getEvents('session_ai_derived_address_confirm')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'order_previewed' }),
        expect.objectContaining({ type: 'order_created' }),
      ]),
    );
  });

  it('blocks order placement without explicit confirmation even when planner asks for placeOrder', async () => {
    const output = await runAgentTurn({
      sessionId: 'session_ai_no_confirm',
      customerId: 'customer_1',
      channel: 'web_mock',
      text: 'Đặt luôn đi',
      clients: createMockClients(createTestFixtures()),
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      toolPlanner: new StaticToolPlanner([
        {
          intent: 'ordering',
          entities: {},
          toolCalls: [{ toolName: 'placeOrder', arguments: {} }],
          responseClaims: [],
        },
      ]),
    });

    expect(output.state.order).toBeUndefined();
    expect(output.state.escalationReasons).toContain('order_confirmation_required');
  });

  it('does not apply hardcoded KFC50 as a valid public voucher', async () => {
    const output = await runAgentTurn({
      sessionId: 'session_ai_voucher',
      customerId: 'customer_1',
      channel: 'web_mock',
      text: 'Mình có mã KFC50',
      clients: createMockClients(createTestFixtures()),
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      toolPlanner: new StaticToolPlanner([
        {
          intent: 'voucher',
          entities: { voucherText: 'KFC50' },
          toolCalls: [{ toolName: 'validateVoucher', arguments: { voucherText: 'KFC50', subtotalVnd: 250000 } }],
          responseClaims: ['promotion'],
        },
      ]),
    });

    expect(output.state.promotionContext?.validation?.ok).toBe(false);
    expect(output.state.promotionContext?.validation?.reason).toBe('public_code_not_exposed');
    expect(output.state.cart?.voucherCode).not.toBe('KFC50');
  });

  it('uses a safe verified fallback instead of planner directResponse when promotion evidence is blocked', async () => {
    const output = await runAgentTurn({
      sessionId: 'session_ai_blocked_promo',
      customerId: 'customer_1',
      channel: 'web_mock',
      text: 'Mã này giảm được bao nhiêu?',
      clients: createMockClients(createTestFixtures()),
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      toolPlanner: new StaticToolPlanner([
        {
          intent: 'voucher',
          entities: { voucherText: 'KFC50' },
          toolCalls: [],
          responseClaims: ['promotion'],
          directResponse: 'Mã KFC50 đang giảm 50K cho đơn này nhé.',
        },
      ]),
    });

    expect(output.replyIntent).toBe('ask_clarification');
    expect(output.state.escalationReasons).toContain('promotion_evidence_required');
    expect(output.responseText).toBe(
      'Mình chưa có thông tin khuyến mãi đã được xác minh cho yêu cầu này. Bạn gửi thêm mã hoặc để mình kiểm tra ưu đãi công khai nhé.',
    );
    expect(output.responseText).not.toContain('KFC50');
  });

  it('requires current-turn promotion evidence instead of reusing historical tool trace for response claims', async () => {
    const store = new MemoryStore();
    const toolPlanner = new StaticToolPlanner([
      {
        intent: 'voucher',
        entities: { voucherText: 'KFC50' },
        toolCalls: [{ toolName: 'validateVoucher', arguments: { voucherText: 'KFC50', subtotalVnd: 250000 } }],
        responseClaims: ['promotion'],
      },
      {
        intent: 'voucher',
        entities: { voucherText: 'KFC50' },
        toolCalls: [],
        responseClaims: ['promotion'],
        directResponse: 'Mã KFC50 đang giảm 50K cho đơn này nhé.',
      },
    ]);

    await runAgentTurn({
      sessionId: 'session_ai_historical_promo_trace',
      customerId: 'customer_1',
      channel: 'web_mock',
      text: 'Mình có mã KFC50',
      clients: createMockClients(createTestFixtures()),
      store,
      dashboard: new DashboardEventBus(),
      toolPlanner,
    });

    const output = await runAgentTurn({
      sessionId: 'session_ai_historical_promo_trace',
      customerId: 'customer_1',
      channel: 'web_mock',
      text: 'Mã đó giảm được bao nhiêu nữa?',
      clients: createMockClients(createTestFixtures()),
      store,
      dashboard: new DashboardEventBus(),
      toolPlanner,
    });

    expect(output.replyIntent).toBe('ask_clarification');
    expect(output.state.escalationReasons).toContain('promotion_evidence_required');
    expect(output.responseText).toBe(
      'Mình chưa có thông tin khuyến mãi đã được xác minh cho yêu cầu này. Bạn gửi thêm mã hoặc để mình kiểm tra ưu đãi công khai nhé.',
    );
    expect(output.responseText).not.toContain('giảm 50K');
  });

  it('rehydrates the prior verified cart across planner-backed turns in one session', async () => {
    const baseFixtures = createTestFixtures();
    const baseProvenance = baseFixtures.menuItems[0]!.provenance;
    const clients = createMockClients(
      createTestFixtures({
        menuItems: [
          ...baseFixtures.menuItems,
          {
            code: '30001',
            itemId: '30001',
            posItemId: '30001',
            productCode: 'ZINGER',
            category: 'Burger',
            categoryId: '30000',
            categoryUrl: '/order/delivery/burger',
            name: 'Burger Zinger',
            description: 'Burger ga cay',
            priceVnd: 45000,
            originalPriceVnd: null,
            imageUrl: 'https://static.kfcvietnam.com.vn/images/items/lg/ZINGER.jpg',
            available: true,
            productUrlSlug: 'burger-zinger',
            builderUrl: 'https://www.kfcvietnam.com.vn/order/delivery/burger/burger-zinger',
            isCustomize: false,
            isQuickCombo: false,
            provenance: {
              ...baseProvenance,
              sourceFile: 'test/graph/ai-tool-graph.test.ts',
              okfConceptId: 'menu/items/30001',
            },
          },
        ],
      }),
    );
    const store = new MemoryStore();
    const dashboard = new DashboardEventBus();
    const toolPlanner = new StaticToolPlanner([
      {
        intent: 'ordering',
        entities: { itemText: 'Combo Hợp Gu 99K' },
        toolCalls: [
          { toolName: 'searchMenu', arguments: { query: 'Combo Hợp Gu 99K' } },
          { toolName: 'updateCart', arguments: { itemCode: '20751', quantity: 1 } },
        ],
        responseClaims: [],
      },
      {
        intent: 'cart_edit',
        entities: { itemText: 'Burger Zinger' },
        toolCalls: [
          { toolName: 'searchMenu', arguments: { query: 'Burger Zinger' } },
          { toolName: 'updateCart', arguments: { itemCode: '30001', quantity: 1 } },
        ],
        responseClaims: [],
      },
    ]);

    await runAgentTurn({
      sessionId: 'session_ai_rehydrate',
      customerId: 'customer_1',
      channel: 'web_mock',
      text: 'Cho minh Combo Hop Gu 99K',
      clients,
      store,
      dashboard,
      toolPlanner,
    });

    const output = await runAgentTurn({
      sessionId: 'session_ai_rehydrate',
      customerId: 'customer_1',
      channel: 'web_mock',
      text: 'Them 1 Burger Zinger',
      clients,
      store,
      dashboard,
      toolPlanner,
    });

    expect(output.state.cart?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ itemCode: '20751', quantity: 1 }),
        expect.objectContaining({ itemCode: '30001', quantity: 1 }),
      ]),
    );
    expect(output.state.toolTrace?.map((entry) => entry.toolName)).toEqual([
      'searchMenu',
      'updateCart',
      'searchMenu',
      'updateCart',
    ]);
  });

  it('invalidates stale fulfillment and preview state after cart mutation before preview or place can continue', async () => {
    const baseFixtures = createTestFixtures();
    const baseProvenance = baseFixtures.menuItems[0]!.provenance;
    const fixtures = createTestFixtures({
      menuItems: [
        ...baseFixtures.menuItems,
        {
          code: '30001',
          itemId: '30001',
          posItemId: '30001',
          productCode: 'ZINGER',
          category: 'Burger',
          categoryId: '30000',
          categoryUrl: '/order/delivery/burger',
          name: 'Burger Zinger',
          description: 'Burger ga cay',
          priceVnd: 45000,
          originalPriceVnd: null,
          imageUrl: 'https://static.kfcvietnam.com.vn/images/items/lg/ZINGER.jpg',
          available: true,
          productUrlSlug: 'burger-zinger',
          builderUrl: 'https://www.kfcvietnam.com.vn/order/delivery/burger/burger-zinger',
          isCustomize: false,
          isQuickCombo: false,
          provenance: {
            ...baseProvenance,
            sourceFile: 'test/graph/ai-tool-graph.test.ts',
            okfConceptId: 'menu/items/30001',
          },
        },
      ],
    });
    const store = new MemoryStore();
    const dashboard = new DashboardEventBus();
    const clients = createMockClients(fixtures, {
      fulfillmentQuoteProvider: async () => ({
        ok: true,
        value: { feeVnd: 18000, etaMinutes: 25 },
        message: 'quoted',
      }),
    });
    const toolPlanner = new StaticToolPlanner([
      {
        intent: 'ordering',
        entities: { itemText: 'Combo Hợp Gu 99K', fulfillmentMethod: 'delivery' },
        toolCalls: [
          { toolName: 'searchMenu', arguments: { query: 'Combo Hợp Gu 99K' } },
          { toolName: 'updateCart', arguments: { itemCode: '20751', quantity: 1 } },
          {
            toolName: 'quoteFulfillment',
            arguments: {
              method: 'delivery',
              address: {
                label: 'Big C Dong Nai',
                line1: 'So 01, KP 1, P. Long Binh Tan',
                district: 'Bien Hoa',
                city: 'DONG NAI',
              },
              itemCodes: ['20751'],
            },
          },
          { toolName: 'previewOrder', arguments: {} },
        ],
        responseClaims: [],
      },
      {
        intent: 'ordering',
        entities: { itemText: 'Burger Zinger' },
        toolCalls: [
          { toolName: 'updateCart', arguments: { itemCode: '30001', quantity: 1 } },
          { toolName: 'previewOrder', arguments: {} },
          { toolName: 'placeOrder', arguments: {} },
        ],
        responseClaims: [],
      },
    ]);

    await runAgentTurn({
      sessionId: 'session_ai_cart_mutation_invalidates_fulfillment',
      customerId: 'customer_1',
      channel: 'web_mock',
      text: 'Giao cho mình 1 Combo Hợp Gu 99K',
      clients,
      store,
      dashboard,
      toolPlanner,
    });

    const output = await runAgentTurn({
      sessionId: 'session_ai_cart_mutation_invalidates_fulfillment',
      customerId: 'customer_1',
      channel: 'web_mock',
      text: 'xác nhận đơn và thêm Burger Zinger',
      clients,
      store,
      dashboard,
      toolPlanner,
    });

    const traceNames = output.state.toolTrace?.map((entry) => entry.toolName) ?? [];
    expect(output.replyIntent).toBe('ask_clarification');
    expect(output.state.escalationReasons).toContain('valid_fulfillment_required');
    expect(output.state.fulfillment).toBeUndefined();
    expect(output.state.orderPreview).toBeUndefined();
    expect(output.state.order).toBeUndefined();
    expect(traceNames.filter((name) => name === 'previewOrder')).toHaveLength(1);
    expect(traceNames).not.toContain('placeOrder');
  });

  it('suppresses planner success wording when a tool call fails backend validation', async () => {
    const dashboard = new DashboardEventBus();
    const output = await runAgentTurn({
      sessionId: 'session_ai_invalid_args',
      customerId: 'customer_1',
      channel: 'web_mock',
      text: 'Them Combo Hoi Gu 99K',
      clients: createMockClients(createTestFixtures()),
      store: new MemoryStore(),
      dashboard,
      toolPlanner: new StaticToolPlanner([
        {
          intent: 'ordering',
          entities: { itemText: 'Combo Hợp Gu 99K' },
          toolCalls: [{ toolName: 'updateCart', arguments: { itemCode: 20751, quantity: 'mot' } }],
          responseClaims: [],
          directResponse: 'Minh da them mon vao gio roi nhe.',
        },
      ]),
    });

    expect(output.replyIntent).toBe('ask_clarification');
    expect(output.state.escalationReasons).toContain('tool_execution_failed');
    expect(output.responseText).toBe(
      'Mình chưa thực hiện được thao tác này từ dữ liệu backend đã xác minh. Bạn kiểm tra lại món hoặc yêu cầu cần làm giúp mình nhé.',
    );
    expect(output.responseText).not.toContain('them mon vao gio');
    expect(output.state.toolTrace).toContainEqual(
      expect.objectContaining({
        toolName: 'updateCart',
        ok: false,
        resultSummary: 'invalid_tool_arguments',
      }),
    );
    const dashboardEvents = dashboard.getEvents('session_ai_invalid_args');
    expect(dashboardEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'customer_message_received' }),
        expect.objectContaining({ type: 'conversation_turn_created' }),
      ]),
    );
    expect(dashboardEvents).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({ type: 'cart_changed' }),
        expect.objectContaining({ type: 'session_updated' }),
      ]),
    );
  });

  it('does not backfill an unverified payment method from checkPaymentStatus', async () => {
    const clients = createMockClients(createTestFixtures());
    const output = await runAgentTurn({
      sessionId: 'session_ai_payment_status',
      customerId: 'customer_1',
      channel: 'web_mock',
      text: 'Thanh toán xong chưa?',
      clients: {
        ...clients,
        payment: {
          ...clients.payment,
          async checkPaymentStatus() {
            return {
              ok: true,
              value: { status: 'paid' as const },
              message: 'status=paid',
            };
          },
        },
      },
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      toolPlanner: new StaticToolPlanner([
        {
          intent: 'payment',
          entities: { orderId: 'KFC-MOCK-1001' },
          toolCalls: [{ toolName: 'checkPaymentStatus', arguments: { orderId: 'KFC-MOCK-1001' } }],
          responseClaims: [],
        },
      ]),
    });

    expect(output.state.paymentAttempt).toMatchObject({ status: 'paid' });
    expect(output.state.paymentAttempt?.method).toBeUndefined();
  });
});
