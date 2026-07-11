import { describe, expect, it } from 'vitest';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import { runAgentTurn } from '../../src/graph/buildGraph.js';
import { StaticToolPlanner } from '../../src/llm/toolPlanner.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';

const fixtures = createTestFixtures();

describe('runAgentTurn', () => {
  it('does not place an order before explicit confirmation', async () => {
    const store = new MemoryStore();
    const dashboard = new DashboardEventBus();
    const clients = createMockClients(fixtures);

    const output = await runAgentTurn({
      sessionId: 'session_1',
      customerId: 'customer_1',
      channel: 'messenger_mock',
      text: 'Cho mình 1 Combo Hợp Gu 99K',
      clients,
      store,
      dashboard,
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

    expect(output.state.cart?.items[0]?.itemCode).toBe('20751');
    expect(output.state.order).toBeUndefined();
    expect(output.state.toolTrace?.map((entry) => entry.toolName)).toEqual(['searchMenu', 'updateCart']);
  });

  it('does not treat negated confirmation text as an explicit confirmation', async () => {
    const output = await runAgentTurn({
      sessionId: 'session_negated',
      customerId: 'customer_1',
      channel: 'messenger_mock',
      text: 'Mình chưa xác nhận đơn nha',
      clients: createMockClients(fixtures),
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

    expect(output.state.userConfirmedOrder).toBe(false);
    expect(output.state.order).toBeUndefined();
    expect(output.state.escalationReasons).toContain('order_confirmation_required');
  });

  it('treats structured planner confirmation with payment request as order confirmation', async () => {
    const store = new MemoryStore();
    const dashboard = new DashboardEventBus();

    await runAgentTurn({
      sessionId: 'session_typed_confirm_payment',
      customerId: 'customer_1',
      channel: 'messenger_mock',
      text: 'Cho mình Combo Hợp Gu 99K giao tới Big C Đồng Nai',
      clients: createMockClients(fixtures, {
        fulfillmentQuoteProvider: async (input) => ({
          ok: true,
          value: {
            storeId: input.storeId,
            feeVnd: 18000,
            etaMinutes: 25,
          },
          message: 'quoted',
        }),
      }),
      store,
      dashboard,
      toolPlanner: new StaticToolPlanner([
        {
          intent: 'ordering',
          entities: {},
          toolCalls: [
            { toolName: 'searchMenu', arguments: { query: 'Combo Hợp Gu 99K' } },
            { toolName: 'updateCart', arguments: { itemCode: '20751', quantity: 1 } },
            {
              toolName: 'quoteFulfillment',
              arguments: {
                method: 'delivery',
                itemCodes: ['20751'],
                address: {
                  label: 'Big C Đồng Nai',
                  line1: 'Big C Đồng Nai',
                  district: 'Biên Hòa',
                  city: 'Đồng Nai',
                },
              },
            },
          ],
          responseClaims: [],
        },
      ]),
    });

    const output = await runAgentTurn({
      sessionId: 'session_typed_confirm_payment',
      customerId: 'customer_1',
      channel: 'messenger_mock',
      text: 'Thanh toán ZaloPay.',
      clients: createMockClients(fixtures, {
        fulfillmentQuoteProvider: async (input) => ({
          ok: true,
          value: {
            storeId: input.storeId,
            feeVnd: 18000,
            etaMinutes: 25,
          },
          message: 'quoted',
        }),
      }),
      store,
      dashboard,
      responseComposer: {
        async composeResponse() {
          return 'Mình cần xác minh lại địa chỉ trước khi tiếp tục.';
        },
      },
      toolPlanner: new StaticToolPlanner([
        {
          intent: 'ordering',
          entities: { orderConfirmed: true, paymentMethod: 'zalopay' },
          toolCalls: [
            { toolName: 'previewOrder', arguments: {} },
            { toolName: 'placeOrder', arguments: {} },
            { toolName: 'createPaymentLink', arguments: { method: 'zalopay' } },
          ],
          responseClaims: [],
          directResponse: 'Mình cần xác minh lại địa chỉ trước khi tiếp tục.',
        },
      ]),
    });

    expect(output.state.userConfirmedOrder).toBe(true);
    expect(output.state.order).toMatchObject({ status: 'created' });
    expect(output.state.paymentAttempt).toMatchObject({
      method: 'zalopay',
      status: 'pending',
    });
    expect(output.genUi).toMatchObject({ widgetKind: 'paymentOrderStatus' });
    expect(output.responseText).toBe('Mình cần xác minh lại địa chỉ trước khi tiếp tục.');
  });

  it('treats invoice details plus structured planner confirmation as order confirmation', async () => {
    const store = new MemoryStore();
    const dashboard = new DashboardEventBus();
    const clients = createMockClients(fixtures, {
      fulfillmentQuoteProvider: async (input) => ({
        ok: true,
        value: {
          storeId: input.storeId,
          feeVnd: 18000,
          etaMinutes: 25,
        },
        message: 'quoted',
      }),
    });

    await runAgentTurn({
      sessionId: 'session_invoice_text_confirm',
      customerId: 'customer_1',
      channel: 'kfc',
      text: 'Cho mình Combo Hợp Gu 99K giao tới Big C Đồng Nai',
      clients,
      store,
      dashboard,
      toolPlanner: new StaticToolPlanner([
        {
          intent: 'ordering',
          entities: {},
          toolCalls: [
            { toolName: 'searchMenu', arguments: { query: 'Combo Hợp Gu 99K' } },
            { toolName: 'updateCart', arguments: { itemCode: '20751', quantity: 1 } },
            {
              toolName: 'quoteFulfillment',
              arguments: {
                method: 'delivery',
                itemCodes: ['20751'],
                address: {
                  label: 'Big C Đồng Nai',
                  line1: 'Big C Đồng Nai',
                  district: 'Biên Hòa',
                  city: 'Đồng Nai',
                },
              },
            },
          ],
          responseClaims: [],
        },
      ]),
    });

    const output = await runAgentTurn({
      sessionId: 'session_invoice_text_confirm',
      customerId: 'customer_1',
      channel: 'kfc',
      text: 'Công ty ABC, MST 0312345678, email finance@abc.test. Xác nhận đơn.',
      clients,
      store,
      dashboard,
      toolPlanner: new StaticToolPlanner([
        {
          intent: 'ordering',
          entities: { paymentMethod: 'zalopay', orderConfirmed: true },
          toolCalls: [
            {
              toolName: 'collectInvoice',
              arguments: {
                companyName: 'Công ty ABC',
                taxCode: '0312345678',
                email: 'finance@abc.test',
              },
            },
          ],
          responseClaims: [],
        },
      ]),
    });

    expect(output.state.userConfirmedOrder).toBe(true);
    expect(output.state.invoiceRequest).toMatchObject({
      companyName: 'Công ty ABC',
      taxCode: '0312345678',
      email: 'finance@abc.test',
    });
    expect(output.state.order).toMatchObject({ status: 'created' });
    expect(output.state.paymentAttempt).toMatchObject({
      method: 'zalopay',
      status: 'pending',
    });
    expect(output.genUi).toMatchObject({ widgetKind: 'paymentOrderStatus' });
  });

  it('asks for clarification instead of claiming cart success when no item matches', async () => {
    const dashboard = new DashboardEventBus();
    const output = await runAgentTurn({
      sessionId: 'session_unknown',
      customerId: 'customer_1',
      channel: 'messenger_mock',
      text: 'Cho mình 1 combo không tồn tại',
      clients: createMockClients(createTestFixtures({ menuItems: [] })),
      store: new MemoryStore(),
      dashboard,
      toolPlanner: new StaticToolPlanner([
        {
          intent: 'ordering',
          entities: { itemText: 'combo không tồn tại' },
          toolCalls: [{ toolName: 'searchMenu', arguments: { query: 'combo không tồn tại' } }],
          responseClaims: [],
          directResponse: 'Mình chưa tìm thấy món phù hợp. Bạn cho mình tên món hoặc combo cụ thể hơn nhé.',
        },
      ]),
    });

    expect(output.state.cart).toBeUndefined();
    expect(output.replyIntent).toBe('ask_clarification');
    expect(output.responseText).toBe('Mình chưa xác minh được đầy đủ món bạn muốn đặt từ menu KFC. Bạn gửi lại tên món hoặc combo cụ thể hơn giúp mình nhé.');
    const dashboardEvents = dashboard.getEvents('session_unknown');
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
    expect(output.state.toolTrace?.map((entry) => entry.toolName)).toEqual(['searchMenu']);
  });

  it('does not retrieve the current long-range reference as prior evidence', async () => {
    const output = await runAgentTurn({
      sessionId: 'session_empty_history',
      customerId: 'customer_1',
      channel: 'messenger_mock',
      text: 'Giao tới chỗ cũ nha',
      clients: createMockClients(fixtures),
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
    });

    expect(output.state.retrievedEvidence).toEqual([]);
  });

  it('uses an injected response composer without changing graph business state', async () => {
    const store = new MemoryStore();
    const output = await runAgentTurn({
      sessionId: 'session_composer',
      customerId: 'customer_1',
      channel: 'messenger_mock',
      text: 'Cho mình 1 Combo Hợp Gu 99K',
      clients: createMockClients(fixtures),
      store,
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
      responseComposer: {
        async composeResponse(input) {
          expect(input.replyIntent).toBe('general_reply');
          expect(input.state.cart?.items[0]?.itemCode).toBe('20751');
          expect(input.state.toolTrace?.map((entry) => entry.toolName)).toEqual(['searchMenu', 'updateCart']);
          expect(input.fallbackText).toContain('Mình đã thêm 1 Combo Hợp Gu 99K');
          return 'Dạ mình đã thêm Combo Hợp Gu 99K vào giỏ. Bạn muốn giao hàng hay nhận tại cửa hàng ạ?';
        },
      },
    });

    const turns = await store.listTurns('session_composer');
    expect(output.responseText).toBe('Dạ mình đã thêm Combo Hợp Gu 99K vào giỏ. Bạn muốn giao hàng hay nhận tại cửa hàng ạ?');
    expect(output.state.cart?.items[0]?.itemCode).toBe('20751');
    expect(turns.at(-1)?.text).toBe(output.responseText);
  });

  it('falls back to deterministic text and records an event when response composition fails', async () => {
    const store = new MemoryStore();
    const output = await runAgentTurn({
      sessionId: 'session_composer_failed',
      customerId: 'customer_1',
      channel: 'messenger_mock',
      text: 'Cho mình 1 Combo Hợp Gu 99K',
      clients: createMockClients(fixtures),
      store,
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
      responseComposer: {
        async composeResponse() {
          throw new Error('OpenAI timeout');
        },
      },
    });

    const events = await store.listEvents('session_composer_failed');
    expect(output.responseText).toBe(
      'Mình đã thêm 1 Combo Hợp Gu 99K vào giỏ hàng. Bạn gửi giúp mình địa chỉ giao hàng đầy đủ để mình kiểm tra phí ship và thời gian giao nhé.',
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        sourceType: 'llm:response_composer_failed',
        payload: expect.objectContaining({ message: 'OpenAI timeout' }),
      }),
    );
    expect(output.state.toolTrace?.map((entry) => entry.toolName)).toEqual(['searchMenu', 'updateCart']);
  });
});
