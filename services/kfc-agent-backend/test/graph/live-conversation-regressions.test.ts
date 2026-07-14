import { describe, expect, it, vi } from 'vitest';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import type { Address, Cart, Order } from '../../src/domain/types.js';
import { loadGeneratedFixtures } from '../../src/fixtures/loadFixtures.js';
import { runAgentTurn } from '../../src/graph/buildGraph.js';
import type { ToolPlannerOutput } from '../../src/llm/toolPlanner.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';

function cart(items: Cart['items'] = [
  { itemCode: '20751', name: 'Combo Hợp Gu 99K', quantity: 1, unitPriceVnd: 99_000 },
]): Cart {
  const subtotalVnd = items.reduce((total, item) => total + item.quantity * item.unitPriceVnd, 0);
  return {
    id: 'cart_live_regression',
    items,
    subtotalVnd,
    discountVnd: 0,
    deliveryFeeVnd: 0,
    totalVnd: subtotalVnd,
    voucherCode: null,
  };
}

function pendingOrder(): Order {
  return {
    id: 'KFC-MOCK-1001',
    cart: cart(),
    status: 'created',
    paymentStatus: 'pending',
    assignedStoreId: 'KFCVN0002',
    createdAt: '2026-07-12T00:00:00.000Z',
  };
}

function planner(output: ToolPlannerOutput) {
  return { async plan(): Promise<ToolPlannerOutput> { return output; } };
}

async function seed(store: MemoryStore, sessionId: string, verifiedState: Record<string, unknown>) {
  await store.appendEvent(sessionId, 'graph:verified_state', { verifiedState });
}

describe('recent live conversation regressions', () => {
  it('starts a fresh cart when a named item is selected after an existing order', async () => {
    const fixtures = await loadGeneratedFixtures(process.cwd());
    const store = new MemoryStore();
    const sessionId = 'kfc:live_new_order_regression';
    await seed(store, sessionId, {
      cart: cart(),
      order: pendingOrder(),
      paymentAttempt: {
        method: 'zalopay',
        status: 'pending',
        paymentUrl: 'https://pay.mock/zalopay/KFC-MOCK-1001',
      },
      toolTrace: [],
    });

    const output = await runAgentTurn({
      sessionId,
      customerId: 'live_new_order_regression',
      channel: 'kfc',
      text: 'I want Combo Đẫy Đà 129K',
      clients: createMockClients(fixtures),
      store,
      dashboard: new DashboardEventBus(),
      toolPlanner: planner({
        intent: 'ordering',
        contextPolicy: { cart: 'active', menuSearchResults: 'active' },
        entities: {
          itemText: 'Combo Đẫy Đà 129K',
          freshShoppingJourney: true,
          cartMutationRequested: true,
          cartMutationConfirmed: true,
        },
        toolCalls: [
          { toolName: 'searchMenu', arguments: { query: 'Combo Đẫy Đà 129K' } },
          { toolName: 'updateCart', arguments: { itemCode: '20752', quantity: 1 } },
        ],
        responseClaims: [],
      }),
    });

    expect(output.state.cart?.items).toEqual([
      expect.objectContaining({ itemCode: '20752', quantity: 1 }),
    ]);
    expect(output.state.order).toBeUndefined();
    expect(output.state.orderPreview).toBeUndefined();
    expect(output.state.paymentAttempt).toBeUndefined();
    expect(output.genUi?.widgetKind).toBe('cartBuilder');
    expect(output.responseText).not.toContain('KFC-MOCK-1001');
  });

  it('shows current Pepsi choices instead of the existing cart', async () => {
    const fixtures = await loadGeneratedFixtures(process.cwd());
    const store = new MemoryStore();
    const sessionId = 'kfc:live_pepsi_picker_regression';
    await seed(store, sessionId, { cart: cart(), toolTrace: [] });

    const output = await runAgentTurn({
      sessionId,
      customerId: 'live_pepsi_picker_regression',
      channel: 'kfc',
      text: 'I want some pepsi',
      clients: createMockClients(fixtures),
      store,
      dashboard: new DashboardEventBus(),
      toolPlanner: planner({
        intent: 'ordering',
        contextPolicy: { cart: 'active', menuSearchResults: 'active' },
        entities: { itemText: 'Pepsi' },
        toolCalls: [{ toolName: 'searchMenu', arguments: { query: 'Pepsi' } }],
        responseClaims: [],
      }),
    });

    expect(output.genUi?.widgetKind).toBe('smartMenuPicker');
    expect(output.genUi?.data.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: expect.stringContaining('Pepsi') })]),
    );
  });

  it('suggests modifier-compatible combos for an ambiguous spicy-combo request without selecting one', async () => {
    const fixtures = await loadGeneratedFixtures(process.cwd());
    const output = await runAgentTurn({
      sessionId: 'kfc:spicy_combo_modifier_search',
      customerId: 'spicy_combo_modifier_search',
      channel: 'kfc',
      text: 'Cho mình 1 combo gà cay',
      clients: createMockClients(fixtures),
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      toolPlanner: planner({
        intent: 'ordering',
        contextPolicy: { menuSearchResults: 'active' },
        entities: { itemText: 'combo gà cay', cartMutationRequested: true },
        toolCalls: [{ toolName: 'searchMenu', arguments: { query: 'combo gà cay' } }],
        responseClaims: [],
      }),
    });

    expect(output.state.cart).toBeUndefined();
    expect(output.genUi?.widgetKind).toBe('smartMenuPicker');
    expect(output.genUi?.data.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: '20751',
        name: 'Combo Hợp Gu 99K',
        modifierGroups: expect.arrayContaining([
          expect.objectContaining({
            options: expect.arrayContaining([
              expect.objectContaining({
                modifierGroups: expect.arrayContaining([
                  expect.objectContaining({
                    options: expect.arrayContaining([
                      expect.objectContaining({ name: 'Gà Giòn Cay', priceDeltaVnd: 0 }),
                      expect.objectContaining({ name: 'Gà Giòn Không Cay', priceDeltaVnd: 0 }),
                    ]),
                  }),
                ]),
              }),
            ]),
          }),
        ]),
      }),
      expect.objectContaining({ code: '20752', name: 'Combo Đẫy Đà 129K' }),
    ]));
  });

  it('uses current modifier-aware catalog evidence for a social menu question instead of stale order results', async () => {
    const fixtures = await loadGeneratedFixtures(process.cwd());
    const store = new MemoryStore();
    const sessionId = 'messenger_mock:spicy_combo_after_order';
    await seed(store, sessionId, {
      cart: cart(),
      order: pendingOrder(),
      menuSearchResults: [{
        code: '20752',
        itemId: '20752',
        productCode: 'DAYDA',
        category: 'Ưu Đãi',
        name: 'Combo Đẫy Đà 129K',
        description: 'stale result',
        priceVnd: 129_000,
        originalPriceVnd: null,
        available: true,
      }],
      toolTrace: [],
    });

    const output = await runAgentTurn({
      sessionId,
      customerId: 'spicy_combo_after_order',
      channel: 'messenger_mock',
      text: 'Có combo nào có gà cay không?',
      clients: createMockClients(fixtures),
      store,
      dashboard: new DashboardEventBus(),
      responseComposer: {
        async composeStandaloneSocial() {
          return '- Combo Đẫy Đà 129K: 129.000đ\nBạn muốn chọn món nào?';
        },
        async composeResponse() {
          return '- Combo Đẫy Đà 129K: 129.000đ\nBạn muốn chọn món nào?';
        },
      },
      toolPlanner: planner({
        intent: 'ordering',
        contextPolicy: { menuSearchResults: 'active', order: 'irrelevant', payment: 'irrelevant' },
        entities: {},
        catalogSelections: [{
          itemCode: '20711',
          quantity: 1,
          replacesItemCodes: [],
          requestFragment: 'combo nào có gà cay',
          modifierChoices: [{ groupId: '60255', name: 'Gà Giòn Cay' }],
        }],
        directResponse: 'Combo Gà Rôm Rả 245k có thể chọn gà giòn cay. Bạn muốn thêm combo này vào giỏ hàng không?',
        toolCalls: [{
          toolName: 'updateCart',
          arguments: {
            itemCode: '20711',
            quantity: 1,
            modifiers: [
              { groupId: '2', modifierId: '41037', quantity: 1 },
              { groupId: '60255', modifierId: '70087', quantity: 3 },
            ],
          },
        }],
        responseClaims: [],
      }),
    });

    expect(output.responseText).toContain('Combo Gà Rôm Rả 245k');
    expect(output.responseText).toContain('Gà Giòn Cay');
    expect(output.responseText).not.toContain('Combo Đẫy Đà 129K');
    expect(output.responseText).not.toContain('KFC-MOCK-1001');
  });

  it('asks an anonymous customer for an address without invoking the planner', async () => {
    const store = new MemoryStore();
    const sessionId = 'kfc:anon_customer_live_address_regression';
    await seed(store, sessionId, { cart: cart(), toolTrace: [] });
    const plan = vi.fn(async (): Promise<ToolPlannerOutput> => {
      throw new Error('structured fulfillment actions must not call the planner');
    });

    const output = await runAgentTurn({
      sessionId,
      customerId: 'anon_customer_live_address_regression',
      channel: 'kfc',
      text: 'Tiếp tục giao hàng',
      metadata: {
        customerCommand: { kind: 'start_fulfillment' },
        rawEvent: { source: 'kfc_genui_action' },
      },
      clients: createMockClients(createTestFixtures()),
      store,
      dashboard: new DashboardEventBus(),
      toolPlanner: { plan },
    });

    expect(plan).not.toHaveBeenCalled();
    expect(output.state.address).toBeUndefined();
    expect(output.state.fulfillment).toBeUndefined();
    expect(output.state.orderPreview).toBeUndefined();
    expect(output.genUi).toMatchObject({
      widgetKind: 'addressFulfillmentCheck',
      data: { addressStatus: 'missing' },
    });
    expect(output.responseText.toLowerCase()).toContain('địa chỉ');
  });

  it('persists a deterministic assistant response when planning times out', async () => {
    const store = new MemoryStore();
    const sessionId = 'messenger:live_planner_timeout_regression';

    const output = await runAgentTurn({
      sessionId,
      customerId: 'live_planner_timeout_regression',
      channel: 'messenger',
      text: 'Tôi cần hỗ trợ đơn hàng',
      clients: createMockClients(createTestFixtures()),
      store,
      dashboard: new DashboardEventBus(),
      turnDeadlineMs: 10,
      toolPlanner: {
        supportsMultiStep: true,
        async plan(): Promise<ToolPlannerOutput> {
          return new Promise<ToolPlannerOutput>(() => undefined);
        },
      },
    });

    expect(output.responseText).not.toBe('');
    expect(output.assistantTurnId).toBeTruthy();
    expect(await store.listTurns(sessionId)).toEqual(
      expect.arrayContaining([expect.objectContaining({ role: 'assistant', text: output.responseText })]),
    );
    expect((await store.listEvents(sessionId)).map((event) => event.sourceType)).toEqual(
      expect.arrayContaining(['llm:tool_planner_failed', 'agent:recovery_response', 'graph:verified_state']),
    );
  });

  it('recovers an exact-quantity cart and verified combo proposal when planning times out', async () => {
    const fixtures = await loadGeneratedFixtures(process.cwd());
    const store = new MemoryStore();
    const sessionId = 'kfc:exact_quantity_timeout_recovery';

    const output = await runAgentTurn({
      sessionId,
      customerId: 'exact_quantity_timeout_recovery',
      channel: 'kfc',
      text: 'Món gà nào bán chạy? Nếu gọi lẻ thì cho mình 10 miếng gà rán và 4 Pepsi tiêu chuẩn.',
      clients: createMockClients(fixtures),
      store,
      dashboard: new DashboardEventBus(),
      turnDeadlineMs: 10,
      toolPlanner: {
        supportsMultiStep: true,
        async plan(): Promise<ToolPlannerOutput> {
          return new Promise<ToolPlannerOutput>(() => undefined);
        },
      },
    });

    expect(output.state.cart?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemCode: '41037', quantity: 3 }),
      expect.objectContaining({ itemCode: '41035', quantity: 1 }),
      expect.objectContaining({ itemCode: '41074', quantity: 4 }),
    ]));
    expect(output.state.cart?.totalVnd).toBe(404_000);
    expect(output.state.comboConversionProposal).toMatchObject({
      itemCode: '20752',
      quantity: 2,
      savingsVnd: 146_000,
    });
    expect(output.state.toolTrace?.map((entry) => entry.toolName) ?? []).toContain('updateCart');
    expect(['modifierPicker', 'cartBuilder']).toContain(output.genUi?.widgetKind);
    expect(output.responseText).toContain('2 Combo Đẫy Đà 129K');
    expect(output.responseText).toContain('146.000');
    expect(await store.listEvents(sessionId)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceType: 'agent:recovery_response',
        payload: expect.objectContaining({ responseMode: 'verified_exact_quantity_cart' }),
      }),
    ]));
  });

  it('finishes a verified checkout and invoice request when planning times out', async () => {
    const store = new MemoryStore();
    const sessionId = 'kfc:order_confirmation_timeout_recovery';
    const address: Address = {
      label: 'Sunrise City',
      line1: '23 Nguyễn Hữu Thọ, phường Tân Hưng',
      district: 'Quận 7',
      city: 'Hồ Chí Minh',
    };
    await seed(store, sessionId, {
      cart: { ...cart(), deliveryFeeVnd: 18_000, totalVnd: 117_000 },
      address,
      fulfillment: {
        method: 'delivery',
        disposition: 'delivery',
        storeId: 'KFCVN0002',
        storeName: 'KFC Test',
        feeVnd: 18_000,
        etaMinutes: 35,
        availability: {
          ok: true,
          checkedItemIds: ['20751'],
          unavailableItemIds: [],
          blockedTimeslotItemIds: [],
          source: { fixtureMode: 'test_only', sourceFile: 'live-conversation-regressions.test.ts' },
        },
      },
      selectedPaymentMethod: 'zalopay',
      toolTrace: [],
    });

    const output = await runAgentTurn({
      sessionId,
      customerId: 'order_confirmation_timeout_recovery',
      channel: 'kfc',
      text: 'Công ty ABC, MST 0312345678, email finance@abc.test. Xác nhận đơn.',
      clients: createMockClients(createTestFixtures()),
      store,
      dashboard: new DashboardEventBus(),
      turnDeadlineMs: 10,
      toolPlanner: {
        supportsMultiStep: true,
        async plan(): Promise<ToolPlannerOutput> {
          return new Promise<ToolPlannerOutput>(() => undefined);
        },
      },
    });

    expect(output.state.invoiceRequest).toEqual({
      companyName: 'Công ty ABC',
      taxCode: '0312345678',
      email: 'finance@abc.test',
    });
    expect(output.state.order).toMatchObject({ status: 'created', paymentStatus: 'pending' });
    expect(output.state.paymentAttempt).toMatchObject({
      method: 'zalopay',
      status: 'pending',
      paymentUrl: expect.stringContaining('/zalopay/'),
    });
    expect(output.state.toolTrace?.map((entry) => entry.toolName) ?? []).toEqual(expect.arrayContaining([
      'collectInvoice',
      'previewOrder',
      'placeOrder',
      'createPaymentLink',
    ]));
    expect(output.genUi?.widgetKind).toBe('paymentOrderStatus');
    expect(await store.listEvents(sessionId)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceType: 'agent:recovery_response',
        payload: expect.objectContaining({ responseMode: 'verified_order_confirmation' }),
      }),
    ]));
  });

  it('recovers a timed-out planner by accepting only the exact saved address candidate previously shown', async () => {
    const store = new MemoryStore();
    const sessionId = 'messenger:saved_address_timeout_recovery';
    const savedAddress: Address = {
      label: 'Địa chỉ cũ',
      line1: '23 Nguyễn Hữu Thọ, phường Tân Hưng',
      district: 'Quận 7',
      city: 'Hồ Chí Minh',
    };
    await seed(store, sessionId, {
      cart: cart(),
      customerContext: { savedAddresses: [savedAddress], favorites: [], recentOrders: [] },
      toolTrace: [],
    });
    await store.appendTurn({
      sessionId,
      channel: 'messenger',
      role: 'assistant',
      text: 'Mình tìm thấy địa chỉ 23 Nguyễn Hữu Thọ, phường Tân Hưng, Quận 7, Hồ Chí Minh. Bạn xác nhận nhé.',
      externalMessageId: null,
      externalUserId: 'saved_address_timeout_recovery',
      deliveryStatus: 'sent',
      metadata: {
        genUi: {
          id: 'saved_address_candidate',
          lifecycleStage: 'fulfillment',
          widgetKind: 'addressFulfillmentCheck',
          status: 'active',
          title: 'Kiểm tra giao hàng',
          data: { address: savedAddress, addressStatus: 'candidate', fulfillment: null },
          actions: [{ id: 'accept_fulfillment', label: 'Giao đến địa chỉ này' }],
        },
      },
    });

    const output = await runAgentTurn({
      sessionId,
      customerId: 'saved_address_timeout_recovery',
      channel: 'messenger',
      text: 'Đúng rồi',
      clients: createMockClients(createTestFixtures(), {
        fulfillmentQuoteProvider: () => ({
          ok: true,
          value: { feeVnd: 18_000, etaMinutes: 45 },
          message: 'timeout_recovery_quote',
        }),
      }),
      store,
      dashboard: new DashboardEventBus(),
      turnDeadlineMs: 10,
      toolPlanner: {
        supportsMultiStep: true,
        async plan(): Promise<ToolPlannerOutput> {
          return new Promise<ToolPlannerOutput>(() => undefined);
        },
      },
    });

    expect(output.state.address).toEqual(savedAddress);
    expect(output.state.fulfillment).toMatchObject({ feeVnd: 18_000, etaMinutes: 45 });
    expect(output.state.toolTrace).toEqual([
      expect.objectContaining({ toolName: 'quoteFulfillment', ok: true }),
    ]);
    expect(output.responseText).not.toBe('');
    expect(await store.listEvents(sessionId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceType: 'agent:recovery_response',
          payload: expect.objectContaining({ responseMode: 'verified_fulfillment_confirmation' }),
        }),
      ]),
    );
  });

  it('presents a saved address as an unconfirmed candidate', async () => {
    const savedAddress: Address = {
      label: 'Nhà',
      line1: 'Sunrise City',
      district: 'Quận 7',
      city: 'TP.HCM',
    };
    const store = new MemoryStore();
    const sessionId = 'kfc:saved_address_confirmation_regression';
    await seed(store, sessionId, { cart: cart(), toolTrace: [] });

    const output = await runAgentTurn({
      sessionId,
      customerId: 'saved_address_confirmation_regression',
      channel: 'kfc',
      text: 'Tiếp tục giao hàng',
      metadata: {
        customerCommand: { kind: 'start_fulfillment' },
        rawEvent: { source: 'kfc_genui_action' },
      },
      clients: createMockClients(createTestFixtures(), {
        savedAddressesProvider: () => ({ ok: true, value: [savedAddress], message: 'saved_addresses' }),
      }),
      store,
      dashboard: new DashboardEventBus(),
    });

    expect(output.state.address).toBeUndefined();
    expect(output.state.fulfillment).toBeUndefined();
    expect(output.genUi).toMatchObject({
      widgetKind: 'addressFulfillmentCheck',
      data: { address: savedAddress, addressStatus: 'candidate' },
      actions: expect.arrayContaining([expect.objectContaining({ id: 'accept_fulfillment' })]),
    });

    const accepted = await runAgentTurn({
      sessionId,
      customerId: 'saved_address_confirmation_regression',
      channel: 'kfc',
      text: 'Dùng địa chỉ này',
      metadata: {
        customerCommand: { kind: 'accept_fulfillment' },
        rawEvent: { source: 'kfc_genui_action' },
      },
      clients: createMockClients(createTestFixtures(), {
        savedAddressesProvider: () => ({ ok: true, value: [savedAddress], message: 'saved_addresses' }),
        fulfillmentQuoteProvider: () => ({
          ok: true,
          value: { feeVnd: 18_000, etaMinutes: 30 },
          message: 'quote',
        }),
      }),
      store,
      dashboard: new DashboardEventBus(),
    });

    expect(accepted.state.address).toEqual(savedAddress);
    expect(accepted.state.fulfillment).toBeDefined();
    expect(accepted.genUi?.widgetKind).toBe('orderReviewConfirm');
  });

  it('keeps repeated delivery requests at the address step without placing an order', async () => {
    const store = new MemoryStore();
    const sessionId = 'kfc:repeated_delivery_regression';
    await seed(store, sessionId, { cart: cart(), toolTrace: [] });
    const noToolPlan: ToolPlannerOutput = {
      intent: 'ordering',
      contextPolicy: { cart: 'active', fulfillment: 'active', customer: 'active' },
      entities: {
        fulfillmentMethod: 'delivery',
        preferFulfillmentSurface: true,
        asksClarification: true,
      },
      toolCalls: [],
      responseClaims: [],
    };

    for (const text of ['giao hàng cho tôi', 'giao hàng cho tôi']) {
      const output = await runAgentTurn({
        sessionId,
        customerId: 'repeated_delivery_regression',
        channel: 'kfc',
        text,
        clients: createMockClients(createTestFixtures()),
        store,
        dashboard: new DashboardEventBus(),
        toolPlanner: planner(noToolPlan),
      });
      expect(output.state.address).toBeUndefined();
      expect(output.state.orderPreview).toBeUndefined();
      expect(output.state.order).toBeUndefined();
      expect(output.genUi?.widgetKind).toBe('addressFulfillmentCheck');
      expect(output.state.toolTrace?.map((entry) => entry.toolName)).not.toEqual(
        expect.arrayContaining(['previewOrder', 'placeOrder']),
      );
    }
  });

  it('does not substitute a partial typed address with a saved address', async () => {
    const store = new MemoryStore();
    const sessionId = 'messenger:partial_address_regression';
    await seed(store, sessionId, { cart: cart(), toolTrace: [] });

    const output = await runAgentTurn({
      sessionId,
      customerId: 'partial_address_regression',
      channel: 'messenger',
      text: 'giao hàng qua cho 54/2 Nguyễn Hồng Đào',
      clients: createMockClients(createTestFixtures(), {
        savedAddressesProvider: () => ({
          ok: true,
          value: [{ label: 'Cũ', line1: 'Sunrise City', district: 'Quận 7', city: 'TP.HCM' }],
          message: 'saved_addresses',
        }),
      }),
      store,
      dashboard: new DashboardEventBus(),
      toolPlanner: planner({
        intent: 'ordering',
        contextPolicy: { cart: 'active', fulfillment: 'active', customer: 'active' },
        entities: { fulfillmentMethod: 'delivery', addressText: '54/2 Nguyễn Hồng Đào' },
        toolCalls: [],
        responseClaims: [],
      }),
    });

    expect(output.state.address).toBeUndefined();
    expect(output.state.fulfillment).toBeUndefined();
    expect(output.responseText).toContain('quận');
    expect(output.responseText).not.toContain('Sunrise City');
  });

  it('does not carry a confirmed street into a different partial address draft', async () => {
    const store = new MemoryStore();
    const sessionId = 'kfc:different_partial_address_regression';
    const oldAddress: Address = {
      label: 'Địa chỉ cũ',
      line1: '123 Nguyễn Trãi',
      district: 'Quận 5',
      city: 'Hồ Chí Minh',
    };
    await seed(store, sessionId, {
      cart: cart(),
      address: oldAddress,
      addressDraft: oldAddress,
      customerContext: { savedAddresses: [oldAddress], favorites: [], recentOrders: [] },
      toolTrace: [],
    });

    const output = await runAgentTurn({
      sessionId,
      customerId: 'different_partial_address_regression',
      channel: 'kfc',
      text: 'Đổi địa chỉ giao qua Quận 3 được không?',
      clients: createMockClients(createTestFixtures()),
      store,
      dashboard: new DashboardEventBus(),
      toolPlanner: planner({
        intent: 'cart_edit',
        contextPolicy: { cart: 'active', fulfillment: 'active' },
        entities: { addressDraft: { district: 'Quận 3' } },
        toolCalls: [{
          toolName: 'quoteFulfillment',
          arguments: {
            address: {
              line1: oldAddress.line1,
              district: 'Quận 3',
              city: oldAddress.city,
            },
            method: 'delivery',
            itemCodes: ['20751'],
          },
        }],
        responseClaims: [],
      }),
    });

    expect(output.state.address).toBeUndefined();
    expect(output.state.fulfillment).toBeUndefined();
    expect(output.state.addressDraft).toMatchObject({ district: 'Quận 3' });
    expect(output.state.addressDraft?.line1).toBeUndefined();
    expect(output.state.toolTrace?.some((entry) => entry.toolName === 'quoteFulfillment' && entry.ok)).toBe(false);
    expect(output.responseText).not.toContain(oldAddress.line1);
    expect(output.genUi).toMatchObject({
      widgetKind: 'addressFulfillmentCheck',
      data: { address: null, addressStatus: 'missing' },
    });
  });

  it('quotes a specific typed address through the model-planned fulfillment tool', async () => {
    const store = new MemoryStore();
    const sessionId = 'kfc:typed_address_quote_regression';
    await seed(store, sessionId, { cart: cart(), toolTrace: [] });
    await store.appendTurn({
      sessionId,
      channel: 'kfc',
      role: 'user',
      text: 'Giao về Quận 7',
      externalMessageId: null,
      externalUserId: 'typed_address_quote_regression',
      deliveryStatus: 'received',
      metadata: null,
    });
    await store.appendTurn({
      sessionId,
      channel: 'kfc',
      role: 'assistant',
      text: 'Bạn gửi địa chỉ cụ thể giúp mình nhé.',
      externalMessageId: null,
      externalUserId: 'typed_address_quote_regression',
      deliveryStatus: 'sent',
      metadata: null,
    });
    const plan = vi.fn(async (): Promise<ToolPlannerOutput> => ({
      intent: 'ordering',
      contextPolicy: { cart: 'active', fulfillment: 'active' },
        entities: {
          fulfillmentMethod: 'delivery',
          preferFulfillmentSurface: true,
          fulfillmentAccepted: true,
          addressDraft: {
            line1: 'Chung cư Sunrise City, 23 Nguyễn Hữu Thọ, phường Tân Hưng',
            district: 'Quận 7',
            city: 'Hồ Chí Minh',
          },
        },
      toolCalls: [{
        toolName: 'quoteFulfillment',
        arguments: {
          address: {
            label: 'Chung cư Sunrise City',
            line1: 'Chung cư Sunrise City, 23 Nguyễn Hữu Thọ, phường Tân Hưng',
            district: 'Quận 7',
            city: 'Hồ Chí Minh',
          },
          method: 'delivery',
          itemCodes: ['20751'],
        },
      }],
      responseClaims: [],
    }));

    const output = await runAgentTurn({
      sessionId,
      customerId: 'typed_address_quote_regression',
      channel: 'kfc',
      text: 'Chung cư Sunrise City, 23 Nguyễn Hữu Thọ, phường Tân Hưng, Quận 7, Hồ Chí Minh. Phí ship bao nhiêu?',
      clients: createMockClients(createTestFixtures(), {
        fulfillmentQuoteProvider: () => ({
          ok: true,
          value: { feeVnd: 18_000, etaMinutes: 25 },
          message: 'quote',
        }),
      }),
      store,
      dashboard: new DashboardEventBus(),
      toolPlanner: { plan },
    });

    expect(plan).toHaveBeenCalledOnce();
    expect(output.state.address).toMatchObject({
      district: 'Quận 7',
      city: 'Hồ Chí Minh',
    });
    expect(output.state.fulfillment).toMatchObject({ feeVnd: 18_000, etaMinutes: 25 });
    expect(output.state.toolTrace?.map((entry) => entry.toolName)).toEqual(['quoteFulfillment']);
    expect(output.genUi?.widgetKind).toBe('orderReviewConfirm');
  });

  it('rechecks active-cart inventory before advancing an existing checkout', async () => {
    const store = new MemoryStore();
    const sessionId = 'kfc:checkout_inventory_recheck_regression';
    const address: Address = {
      label: 'Home',
      line1: 'Big C Đồng Nai',
      district: 'Biên Hòa',
      city: 'ĐỒNG NAI',
    };
    await seed(store, sessionId, {
      cart: { ...cart(), deliveryFeeVnd: 18_000, totalVnd: 117_000 },
      address,
      fulfillment: {
        method: 'delivery',
        disposition: 'delivery',
        storeId: 'KFCVN0002',
        storeName: 'KFC BIG C ĐỒNG NAI',
        feeVnd: 18_000,
        etaMinutes: 35,
        availability: {
          ok: true,
          checkedItemIds: ['20751'],
          unavailableItemIds: [],
          blockedTimeslotItemIds: [],
          source: { fixtureMode: 'public_crawl_seed', sourceFile: 'availability.json' },
        },
      },
      toolTrace: [],
    });

    const output = await runAgentTurn({
      sessionId,
      customerId: 'checkout_inventory_recheck_regression',
      channel: 'kfc',
      text: 'Tiếp tục nhé',
      clients: createMockClients(createTestFixtures(), {
        mockedUpstreamApiProvider: () => ({ unavailableItemCodes: ['20751'] }),
      }),
      store,
      dashboard: new DashboardEventBus(),
      toolPlanner: planner({
        intent: 'ordering',
        contextPolicy: { cart: 'active', fulfillment: 'active' },
        entities: { fulfillmentAccepted: true },
        toolCalls: [],
        responseClaims: [],
      }),
    });

    expect(output.state.toolTrace).toEqual([
      expect.objectContaining({ toolName: 'checkStoreAvailability', ok: true }),
    ]);
    expect(output.state.fulfillment).toBeUndefined();
    expect(output.state.cart).toMatchObject({ deliveryFeeVnd: 0, totalVnd: 99_000 });
    expect(output.state.order).toBeUndefined();
    expect(output.state.orderPreview).toBeUndefined();
    expect(output.responseText).toContain('Combo Hợp Gu 99K');
  });

  it('does not substitute ZaloPay when MoMo is requested', async () => {
    const store = new MemoryStore();
    const sessionId = 'kfc:momo_regression';
    await seed(store, sessionId, { order: pendingOrder(), cart: cart(), toolTrace: [] });

    const output = await runAgentTurn({
      sessionId,
      customerId: 'momo_regression',
      channel: 'kfc',
      text: 'Thanh toán bằng MoMo',
      clients: createMockClients(createTestFixtures()),
      store,
      dashboard: new DashboardEventBus(),
      toolPlanner: planner({
        intent: 'payment',
        contextPolicy: { order: 'active', payment: 'active' },
        entities: { paymentMethod: 'momo' },
        toolCalls: [
          { toolName: 'listPaymentMethods', arguments: { query: 'MoMo' } },
          { toolName: 'createPaymentLink', arguments: { method: 'zalopay' } },
        ],
        responseClaims: [],
      }),
    });

    expect(output.state.toolTrace).toEqual(
      expect.arrayContaining([expect.objectContaining({ toolName: 'listPaymentMethods', ok: true })]),
    );
    expect(output.state.toolTrace?.filter((entry) => entry.toolName === 'createPaymentLink')).toEqual([]);
    expect(output.state.paymentAttempt?.paymentUrl).toBeUndefined();
    expect(output.responseText).toContain('MoMo');
    expect(output.responseText).not.toContain('pay.mock/zalopay');
  });

  it('checks payment status when the customer says they paid', async () => {
    const store = new MemoryStore();
    const sessionId = 'messenger:payment_status_regression';
    await seed(store, sessionId, {
      order: pendingOrder(),
      cart: cart(),
      paymentAttempt: {
        method: 'zalopay',
        status: 'pending',
        paymentUrl: 'https://pay.mock/zalopay/KFC-MOCK-1001',
      },
      toolTrace: [],
    });

    const output = await runAgentTurn({
      sessionId,
      customerId: 'payment_status_regression',
      channel: 'messenger',
      text: 'okay tôi thanh toán rồi',
      clients: createMockClients(createTestFixtures(), {
        paymentStatusProvider: () => ({ ok: true, value: { status: 'pending' }, message: 'pending' }),
      }),
      store,
      dashboard: new DashboardEventBus(),
      toolPlanner: planner({
        intent: 'payment',
        contextPolicy: { order: 'active', payment: 'active' },
        entities: { paymentStatusClaimed: 'paid' },
        toolCalls: [],
        responseClaims: [],
      }),
    });

    expect(output.state.toolTrace).toEqual(expect.arrayContaining([
      expect.objectContaining({
        toolName: 'checkPaymentStatus',
        arguments: { orderId: 'KFC-MOCK-1001' },
        ok: true,
      }),
    ]));
    expect(output.state.paymentAttempt?.status).toBe('pending');
    expect(output.responseText.toLowerCase()).toContain('chờ thanh toán');
  });
});
