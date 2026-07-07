import { describe, expect, it } from 'vitest';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import { runAgentTurn } from '../../src/graph/buildGraph.js';
import { StaticToolPlanner } from '../../src/llm/toolPlanner.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';

describe('AI tool graph', () => {
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
