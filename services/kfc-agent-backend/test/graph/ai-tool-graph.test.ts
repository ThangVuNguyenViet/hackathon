import { describe, expect, it } from 'vitest';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import type { ConversationTurn } from '../../src/domain/types.js';
import { loadGeneratedFixtures } from '../../src/fixtures/loadFixtures.js';
import { runAgentTurn } from '../../src/graph/buildGraph.js';
import { StaticToolPlanner, type ToolPlanner, type ToolPlannerInput, type ToolPlannerOutput } from '../../src/llm/toolPlanner.js';
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
      clients: createMockClients(await loadGeneratedFixtures(process.cwd())),
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

  it('answers payment method availability from fixture-backed payment methods', async () => {
    const output = await runAgentTurn({
      sessionId: 'session_payment_method_fixture',
      customerId: 'customer_1',
      channel: 'web_mock',
      text: 'KFC thanh toán MoMo được không?',
      clients: createMockClients(createTestFixtures()),
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      toolPlanner: new StaticToolPlanner([
        {
          intent: 'payment',
          entities: { paymentMethod: 'momo' },
          toolCalls: [{ toolName: 'listPaymentMethods' as any, arguments: {} }],
          responseClaims: [],
        },
      ]),
    });

    expect(output.state.paymentMethodEvidence).toEqual(
      expect.arrayContaining([
      expect.objectContaining({
        methodId: 'momo_wallet',
        displayName: 'Ví MoMo',
        supported: false,
      }),
      ]),
    );
    expect(output.state.paymentAttempt).toBeUndefined();
    expect(output.state.toolTrace?.map((entry) => entry.toolName)).toEqual(['listPaymentMethods']);
    expect(output.responseText).toContain('MoMo');
    expect(output.responseText).toContain('không');
    expect(output.responseText).toContain('ZaloPay');
  });

  it('replans after a verified menu lookup before mutating the cart', async () => {
    const planner = new MultiStepMenuPlanner();

    const output = await runAgentTurn({
      sessionId: 'session_ai_multistep_menu',
      customerId: 'customer_1',
      channel: 'web_mock',
      text: 'Cho mình Combo Hợp Gu 99K',
      clients: createMockClients(createTestFixtures()),
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      toolPlanner: planner,
    });

    expect(planner.inputs).toHaveLength(3);
    expect(planner.inputs[0]?.state.menuSearchResults).toBeUndefined();
    expect(planner.inputs[1]?.state.menuSearchResults?.[0]).toMatchObject({
      code: '20751',
      name: 'Combo Hợp Gu 99K',
    });
    expect(output.state.cart?.items[0]).toMatchObject({ itemCode: '20751', name: 'Combo Hợp Gu 99K' });
    expect(output.state.toolTrace?.map((entry) => entry.toolName)).toEqual(['searchMenu', 'updateCart']);
  });

  it('skips duplicate successful tool calls during multi-step planning', async () => {
    const output = await runAgentTurn({
      sessionId: 'session_ai_duplicate_tool_call',
      customerId: 'customer_1',
      channel: 'web_mock',
      text: 'Cho mình xem menu',
      clients: createMockClients(createTestFixtures()),
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      toolPlanner: new DuplicateSearchPlanner(),
    });

    expect(output.state.toolTrace?.map((entry) => entry.toolName)).toEqual(['searchMenu']);
  });

  it('blocks cart mutation when a multi-step planner uses an item code that was not verified', async () => {
    const output = await runAgentTurn({
      sessionId: 'session_ai_multistep_unverified_item_code',
      customerId: 'customer_1',
      channel: 'web_mock',
      text: 'Cho mình món đặc biệt',
      clients: createMockClients(createTestFixtures()),
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      toolPlanner: new UnverifiedMultiStepPlanner(),
    });

    expect(output.state.cart).toBeUndefined();
    expect(output.state.escalationReasons).toContain('unverified_item_code');
    expect(output.state.toolTrace?.map((entry) => entry.toolName) ?? []).not.toContain('updateCart');
    expect(output.responseText).not.toContain('thêm món đặc biệt');
  });

  it('passes bounded recent chat turns to the tool planner for the current session', async () => {
    const store = new MemoryStore();
    await seedTurns(store, 'session_bounded_context', [
      'chat_1',
      'chat_2',
      'chat_3',
      'chat_4',
      'chat_5',
      'chat_6',
      'chat_7',
      'chat_8',
      'chat_9',
      'chat_10',
    ]);
    await appendTurn(store, 'session_bounded_context', 'tool_ignored', 'tool');
    await appendTurn(store, 'session_bounded_context', 'system_ignored', 'system');
    await appendTurn(store, 'other_session', 'other_session_message', 'user');
    const planner = new CapturingToolPlanner();

    await runAgentTurn({
      sessionId: 'session_bounded_context',
      customerId: 'customer_1',
      channel: 'web_mock',
      text: 'current user message',
      clients: createMockClients(createTestFixtures()),
      store,
      dashboard: new DashboardEventBus(),
      toolPlanner: planner,
    });

    expect(planner.inputs[0]?.recentTurns.map((turn) => turn.text)).toEqual([
      'chat_4',
      'chat_5',
      'chat_6',
      'chat_7',
      'chat_8',
      'chat_9',
      'chat_10',
      'current user message',
    ]);
  });

  it('exposes bounded recent turns to the response composer state', async () => {
    const store = new MemoryStore();
    await seedTurns(store, 'session_composer_context', [
      'chat_1',
      'chat_2',
      'chat_3',
      'chat_4',
      'chat_5',
      'chat_6',
      'chat_7',
      'chat_8',
    ]);
    const composerStates: Array<{ recentTurns?: ConversationTurn[] }> = [];

    await runAgentTurn({
      sessionId: 'session_composer_context',
      customerId: 'customer_1',
      channel: 'web_mock',
      text: 'latest composer turn',
      clients: createMockClients(createTestFixtures()),
      store,
      dashboard: new DashboardEventBus(),
      toolPlanner: new CapturingToolPlanner(),
      responseComposer: {
        async composeResponse(input) {
          composerStates.push(input.state);
          return input.fallbackText;
        },
      },
    });

    expect(composerStates[0]?.recentTurns?.map((turn) => turn.text)).toEqual([
      'chat_2',
      'chat_3',
      'chat_4',
      'chat_5',
      'chat_6',
      'chat_7',
      'chat_8',
      'latest composer turn',
    ]);
  });

  it('starts a fresh order without stale voucher, invoice, or previous tool trace in response composition', async () => {
    const store = new MemoryStore();
    await store.appendEvent('session_fresh_order_reset', 'graph:verified_state', {
      verifiedState: {
        promotionContext: {
          validation: { ok: true, publicCode: 'KFC50', discountVnd: 50000 },
          matchedOfferIds: [],
          caveats: [],
        },
        invoiceRequest: {
          companyName: 'Công ty ABC',
          taxCode: '0312345678',
          email: 'finance@abc.test',
        },
        toolTrace: [
          {
            toolName: 'quoteFulfillment',
            arguments: {
              address: {
                label: 'Chung cư Sunrise City',
                line1: '23 Nguyễn Hữu Thọ, phường Tân Hưng',
                district: 'Quận 7',
                city: 'Hồ Chí Minh',
              },
            },
            ok: false,
            resultSummary: 'store_not_found',
            provenance: [],
          },
        ],
      },
    });
    const composerStates: Array<{
      toolTrace?: Array<{ toolName: string }>;
      promotionContext?: unknown;
      invoiceRequest?: unknown;
    }> = [];

    const output = await runAgentTurn({
      sessionId: 'session_fresh_order_reset',
      customerId: 'customer_1',
      channel: 'web_mock',
      text: 'Cho mình 1 combo gà cay, 1 burger Zinger và 2 Pepsi, giao về Quận 7.',
      clients: createMockClients(createTestFixtures()),
      store,
      dashboard: new DashboardEventBus(),
      toolPlanner: new StaticToolPlanner([
        {
          intent: 'ordering',
          entities: { itemText: 'Combo Hợp Gu 99K, Burger Gà Zinger, Pepsi' },
          toolCalls: [
            { toolName: 'searchMenu', arguments: { query: 'Combo Hợp Gu 99K Burger Gà Zinger Pepsi' } },
            { toolName: 'updateCart', arguments: { itemCode: '20751', quantity: 1 } },
            { toolName: 'updateCart', arguments: { itemCode: '41141', quantity: 1 } },
            { toolName: 'updateCart', arguments: { itemCode: '41086', quantity: 2 } },
          ],
          responseClaims: [],
        },
      ]),
      responseComposer: {
        async composeResponse(input) {
          composerStates.push(input.state);
          return input.fallbackText;
        },
      },
    });

    expect(output.state.cart?.voucherCode).toBeNull();
    expect(output.state.promotionContext).toBeUndefined();
    expect(output.state.invoiceRequest).toBeUndefined();
    expect(composerStates[0]?.promotionContext).toBeUndefined();
    expect(composerStates[0]?.invoiceRequest).toBeUndefined();
    expect(composerStates[0]?.toolTrace?.map((entry) => entry.toolName)).toEqual([
      'searchMenu',
      'updateCart',
      'updateCart',
      'updateCart',
    ]);
  });

  it('does not mutate the cart when the planner only searches a single order request', async () => {
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
	          entities: { itemText: 'Combo Hợp Gu 99K', cartMutationRequested: true },
	          toolCalls: [{ toolName: 'searchMenu', arguments: { query: 'Combo Hợp Gu 99K' } }],
	          responseClaims: [],
	        },
      ]),
    });

    expect(output.state.cart).toBeUndefined();
    expect(output.state.escalationReasons).toContain('menu_item_verification_required');
    expect(output.state.toolTrace?.map((entry) => entry.toolName)).toEqual(['searchMenu']);
    expect(dashboard.getEvents('session_ai_search_derived_cart').filter((event) => event.type === 'cart_changed')).toEqual([]);
  });

  it('does not repair search-only multi-item text into a cart', async () => {
    const store = new MemoryStore();
    const dashboard = new DashboardEventBus();
    const output = await runAgentTurn({
      sessionId: 'session_ai_search_only_multi_item',
      customerId: 'customer_1',
      channel: 'web_mock',
      text: 'Cho mình 1 combo gà cay, 1 burger Zinger và 2 Pepsi, giao về Quận 7.',
      clients: createMockClients(await loadGeneratedFixtures(process.cwd())),
      store,
      dashboard,
      toolPlanner: new StaticToolPlanner([
	        {
	          intent: 'ordering',
	          entities: { itemText: 'combo gà cay burger Zinger Pepsi', cartMutationRequested: true },
	          toolCalls: [{ toolName: 'searchMenu', arguments: { query: 'combo gà cay burger Zinger Pepsi' } }],
	          responseClaims: [],
	        },
      ]),
    });

    expect(output.state.cart).toBeUndefined();
    expect(output.state.escalationReasons).toContain('menu_item_verification_required');
    expect(output.state.toolTrace?.map((entry) => entry.toolName)).toEqual(['searchMenu']);
    expect(JSON.stringify(output.state.toolTrace)).not.toContain('20751');
    expect(JSON.stringify(output.state.toolTrace)).not.toContain('KFC50');
    expect(dashboard.getEvents('session_ai_search_only_multi_item').filter((event) => event.type === 'cart_changed')).toEqual([]);
    expect(await store.listEvents('session_ai_search_only_multi_item')).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ sourceType: 'llm:tool_plan_contract_repaired' })]),
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

  it('keeps broad menu evidence while bounding customer-facing choices', async () => {
    const output = await runAgentTurn({
      sessionId: 'session_ai_broad_menu_search',
      customerId: 'customer_1',
      channel: 'web_mock',
      text: 'Có combo nào?',
      clients: createMockClients(await loadGeneratedFixtures(process.cwd())),
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      toolPlanner: new StaticToolPlanner([
        {
          intent: 'ordering',
          entities: {},
          toolCalls: [{ toolName: 'searchMenu', arguments: { query: 'combo' } }],
          responseClaims: [],
        },
      ]),
    });

    expect(output.state.cart).toBeUndefined();
    expect(output.state.menuSearchResults?.length).toBe(31);
    expect(output.responseText).toContain('Combo Hợp Gu 99K');
    expect(output.responseText).toContain('Còn 26 món khác');
    expect(output.responseText).not.toContain('Combo Cùng "Dzô"');
    expect(output.genUi?.data.items).toHaveLength(5);
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
        entities: { orderConfirmed: true },
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
        entities: { orderConfirmed: true },
        toolCalls: [{ toolName: 'placeOrder', arguments: {} }],
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

  it('completes the six-turn Messenger order demo with mock fulfillment, OMS, and payment link tools', async () => {
    const store = new MemoryStore();
    const dashboard = new DashboardEventBus();
    const baseFixtures = createTestFixtures();
    const scenarioFixtures = createTestFixtures({
      menuItems: [
        ...baseFixtures.menuItems,
        {
          ...baseFixtures.menuItems[0],
          code: '41141',
          itemId: '41141',
          posItemId: '41141',
          productCode: 'ZINGER',
          category: 'Burger - Cơm - Mì Ý',
          name: 'Burger Gà Zinger',
          description: '1 Burger Gà Zinger',
          priceVnd: 55000,
          productUrlSlug: 'burger-zinger',
          builderUrl: 'https://www.kfcvietnam.com.vn/order/delivery/burger-rice-spaghetti/burger-zinger/builder',
          isCustomize: false,
          isQuickCombo: false,
          provenance: {
            ...baseFixtures.menuItems[0].provenance,
            okfConceptId: 'menu/items/41141',
          },
        },
        {
          ...baseFixtures.menuItems[0],
          code: '82001',
          itemId: '82001',
          posItemId: '82001',
          productCode: 'PEPSI',
          category: 'Thức Uống & Tráng Miệng',
          name: 'Pepsi (Lon)',
          description: '1 Pepsi (Lon)',
          priceVnd: 25000,
          productUrlSlug: 'pepsi-can',
          builderUrl: 'https://www.kfcvietnam.com.vn/order/delivery/drinks-desserts/pepsi-can/builder',
          isCustomize: false,
          isQuickCombo: false,
          provenance: {
            ...baseFixtures.menuItems[0].provenance,
            okfConceptId: 'menu/items/82001',
          },
        },
      ],
    });
    const clients = createMockClients(scenarioFixtures, {
      fulfillmentQuoteProvider: async (input) => ({
        ok: true,
        value: {
          storeId: input.storeId,
          feeVnd: 18000,
          etaMinutes: 35,
        },
        message: 'quoted',
      }),
    });
    const toolPlanner = new StaticToolPlanner([
      {
        intent: 'ordering',
        entities: { itemText: 'combo gà cay, burger Zinger, Pepsi', fulfillmentMethod: 'delivery' },
        toolCalls: [
          { toolName: 'searchMenu', arguments: { query: 'combo gà cay' } },
          { toolName: 'updateCart', arguments: { itemCode: '20751', quantity: 1 } },
          { toolName: 'searchMenu', arguments: { query: 'Burger Zinger' } },
          { toolName: 'updateCart', arguments: { itemCode: '41141', quantity: 1 } },
          { toolName: 'searchMenu', arguments: { query: 'Pepsi' } },
          { toolName: 'updateCart', arguments: { itemCode: '82001', quantity: 2 } },
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
              address: {
                label: 'Sunrise City',
                line1: 'Chung cư Sunrise City, 23 Nguyễn Hữu Thọ',
                district: 'Quận 7',
                city: 'Hồ Chí Minh',
              },
              method: 'delivery',
              itemCodes: ['20751', '41141', '82001'],
            },
          },
        ],
        responseClaims: [],
      },
      {
        intent: 'voucher',
        entities: { voucherText: 'KFC50' },
        toolCalls: [{ toolName: 'validateVoucher', arguments: { voucherText: 'KFC50', subtotalVnd: 250000 } }],
        responseClaims: [],
      },
      {
        intent: 'payment',
        entities: { paymentMethod: 'momo' },
        toolCalls: [{ toolName: 'listPaymentMethods', arguments: { query: 'momo' } }],
        responseClaims: [],
      },
      {
        intent: 'ordering',
        entities: { deliveryNote: 'Gọi khi tới nơi, không bấm chuông', invoiceRequested: true },
        toolCalls: [],
        responseClaims: [],
      },
      {
        intent: 'ordering',
        entities: { orderConfirmed: true },
        toolCalls: [
          {
            toolName: 'collectInvoice',
            arguments: { companyName: 'Công ty ABC', taxCode: '0312345678', email: 'finance@abc.test' },
          },
        ],
        responseClaims: [],
      },
    ]);

    const sessionId = 'session_ai_six_turn_messenger_demo';
    await runAgentTurn({
      sessionId,
      customerId: 'customer_1',
      channel: 'messenger_mock',
      text: 'Cho mình 1 combo gà cay, 1 burger Zinger và 2 Pepsi, giao về Quận 7.',
      clients,
      store,
      dashboard,
      toolPlanner,
    });
    await runAgentTurn({
      sessionId,
      customerId: 'customer_1',
      channel: 'messenger_mock',
      text: 'Chung cư Sunrise City, 23 Nguyễn Hữu Thọ, phường Tân Hưng. Phí ship bao nhiêu?',
      clients,
      store,
      dashboard,
      toolPlanner,
    });
    await runAgentTurn({
      sessionId,
      customerId: 'customer_1',
      channel: 'messenger_mock',
      text: 'Mình có mã KFC50, áp dụng giúp mình.',
      clients,
      store,
      dashboard,
      toolPlanner,
    });
    await runAgentTurn({
      sessionId,
      customerId: 'customer_1',
      channel: 'messenger_mock',
      text: 'Thanh toán bằng Momo được không?',
      clients,
      store,
      dashboard,
      toolPlanner,
    });
    const noteOutput = await runAgentTurn({
      sessionId,
      customerId: 'customer_1',
      channel: 'messenger_mock',
      text: 'Giao tới nơi gọi mình, đừng bấm chuông. Mình cần xuất hóa đơn công ty nữa.',
      clients,
      store,
      dashboard,
      toolPlanner,
    });
    const finalOutput = await runAgentTurn({
      sessionId,
      customerId: 'customer_1',
      channel: 'messenger_mock',
      text: 'Công ty ABC, MST 0312345678, email finance@abc.test. Xác nhận đơn.',
      clients,
      store,
      dashboard,
      toolPlanner,
    });

    expect(noteOutput.responseText).toContain('hóa đơn');
    expect(noteOutput.responseText).not.toBe(
      'Hiện KFC chưa hỗ trợ thanh toán bằng Ví MoMo trên kênh đặt hàng chính thức nhé. Bạn có thể thanh toán bằng tiền mặt, thẻ ATM/Visa/Master hoặc ZaloPay.',
    );
    expect(finalOutput.state.fulfillment).toMatchObject({
      storeId: 'KFCVN0002',
      feeVnd: 18000,
      etaMinutes: 35,
    });
    expect(finalOutput.state.invoiceRequest).toMatchObject({
      companyName: 'Công ty ABC',
      taxCode: '0312345678',
      email: 'finance@abc.test',
    });
    expect(finalOutput.state.order).toMatchObject({
      id: 'KFC-MOCK-1001',
      status: 'created',
      assignedStoreId: 'KFCVN0002',
    });
    expect(finalOutput.state.paymentAttempt).toMatchObject({
      method: 'zalopay',
      status: 'pending',
      paymentUrl: 'https://pay.mock/zalopay/KFC-MOCK-1001',
    });
    expect(finalOutput.responseText).toContain('KFC-MOCK-1001');
    expect(finalOutput.responseText).toContain('https://pay.mock/zalopay/KFC-MOCK-1001');
    expect(finalOutput.state.toolTrace?.map((entry) => entry.toolName)).toEqual(
      expect.arrayContaining(['quoteFulfillment', 'collectInvoice', 'previewOrder', 'placeOrder', 'createPaymentLink']),
    );
    expect(dashboard.getEvents(sessionId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'voucher_applied' }),
        expect.objectContaining({ type: 'order_previewed' }),
        expect.objectContaining({ type: 'order_created' }),
        expect.objectContaining({ type: 'payment_link_created' }),
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

  it('applies fixture-backed demo-stable KFC50 voucher validation', async () => {
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

    expect(output.state.promotionContext?.validation).toMatchObject({
      ok: true,
      reason: 'validated',
      publicCode: 'KFC50',
      discountVnd: 50000,
    });
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

  it('blocks unsupported handoff during loyalty cart edits', async () => {
    const dashboard = new DashboardEventBus();
    const output = await runAgentTurn({
      sessionId: 'session_ai_loyalty_cart_edit_no_handoff',
      customerId: 'customer_1',
      channel: 'web_mock',
      text: 'Ok, thêm combo đó. Mình có điểm thành viên không?',
      clients: createMockClients(createTestFixtures()),
      store: new MemoryStore(),
      dashboard,
      toolPlanner: new StaticToolPlanner([
        {
          intent: 'ordering',
          entities: { itemText: 'Combo Hợp Gu 99K' },
          toolCalls: [
            { toolName: 'searchMenu', arguments: { query: 'Combo Hợp Gu 99K' } },
            { toolName: 'handoff', arguments: { reasons: ['human_review_required'] } },
          ],
          responseClaims: [],
        },
      ]),
    });

    expect(output.state.cart).toBeUndefined();
    expect(output.genUi?.widgetKind).toBe('smartMenuPicker');
    expect(output.state.handoff).toBeUndefined();
    expect(output.state.toolTrace?.map((entry) => entry.toolName)).not.toContain('handoff');
    expect(dashboard.getEvents('session_ai_loyalty_cart_edit_no_handoff')).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ type: 'handoff_required' })]),
    );
  });
});

class CapturingToolPlanner implements ToolPlanner {
  readonly inputs: ToolPlannerInput[] = [];

  async plan(input: ToolPlannerInput): Promise<ToolPlannerOutput> {
    this.inputs.push(input);
    return {
      intent: 'unclear',
      entities: {},
      toolCalls: [],
      responseClaims: [],
      directResponse: 'Mình cần thêm thông tin để hỗ trợ đúng.',
    };
  }
}

class MultiStepMenuPlanner implements ToolPlanner {
  readonly supportsMultiStep = true;
  readonly inputs: ToolPlannerInput[] = [];

  async plan(input: ToolPlannerInput): Promise<ToolPlannerOutput> {
    this.inputs.push(structuredClone(input));
    if (!input.state.menuSearchResults) {
      return {
        intent: 'ordering',
        entities: { itemText: 'Combo Hợp Gu 99K' },
        toolCalls: [{ toolName: 'searchMenu', arguments: { query: 'Combo Hợp Gu 99K' } }],
        responseClaims: [],
      };
    }

    if (!input.state.cart) {
      return {
        intent: 'ordering',
        entities: { itemText: 'Combo Hợp Gu 99K' },
        toolCalls: [{ toolName: 'updateCart', arguments: { itemCode: '20751', quantity: 1 } }],
        responseClaims: [],
      };
    }

    return {
      intent: 'ordering',
      entities: {},
      toolCalls: [],
      responseClaims: [],
    };
  }
}

class UnverifiedMultiStepPlanner implements ToolPlanner {
  readonly supportsMultiStep = true;

  async plan(): Promise<ToolPlannerOutput> {
    return {
      intent: 'ordering',
      entities: { itemText: 'món đặc biệt' },
      toolCalls: [{ toolName: 'updateCart', arguments: { itemCode: '99999', quantity: 1 } }],
      responseClaims: [],
      directResponse: 'Mình đã thêm món đặc biệt vào giỏ.',
    };
  }
}

class DuplicateSearchPlanner implements ToolPlanner {
  readonly supportsMultiStep = true;

  async plan(): Promise<ToolPlannerOutput> {
    return {
      intent: 'ordering',
      entities: {},
      toolCalls: [{ toolName: 'searchMenu', arguments: {} }],
      responseClaims: [],
    };
  }
}

async function seedTurns(store: MemoryStore, sessionId: string, texts: string[]): Promise<void> {
  for (const text of texts) {
    await appendTurn(store, sessionId, text, text.endsWith('1') ? 'user' : 'assistant');
  }
}

async function appendTurn(
  store: MemoryStore,
  sessionId: string,
  text: string,
  role: ConversationTurn['role'],
): Promise<void> {
  await store.appendTurn({
    sessionId,
    channel: 'web_mock',
    role,
    text,
    externalMessageId: `external_${sessionId}_${text}`,
    externalUserId: 'customer_1',
    deliveryStatus: role === 'assistant' ? 'sent' : 'received',
    metadata: null,
  });
}
