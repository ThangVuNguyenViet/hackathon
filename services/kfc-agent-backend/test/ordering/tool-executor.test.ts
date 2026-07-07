import { describe, expect, it } from 'vitest';
import { createMockClients } from '../../src/mock/createMockClients.js';
import type { Order } from '../../src/domain/types.js';
import type { AgentGraphState } from '../../src/graph/state.js';
import { executeToolCall } from '../../src/ordering/toolExecutor.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';

const clients = createMockClients(createTestFixtures());

function buildState(overrides: Partial<AgentGraphState> = {}): AgentGraphState {
  return {
    sessionId: 'session_1',
    customerId: 'customer_1',
    channel: 'web_mock',
    latestUserMessage: 'thanh toan',
    intent: 'payment',
    userConfirmedOrder: false,
    escalationReasons: [],
    retrievedEvidence: [],
    toolTrace: [],
    ...overrides,
  };
}

function buildOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'KFC-MOCK-1001',
    cart: {
      id: 'cart_1',
      items: [],
      subtotalVnd: 120000,
      discountVnd: 0,
      deliveryFeeVnd: 18000,
      totalVnd: 138000,
      voucherCode: null,
    },
    status: 'created',
    paymentStatus: 'pending',
    assignedStoreId: 'KFCVN0002',
    createdAt: '2026-07-08T00:00:00.000Z',
    ...overrides,
  };
}

describe('tool executor', () => {
  it('executes menu search through the state-centric contract', async () => {
    const result = await executeToolCall(clients, buildState({ intent: 'ordering' }), {
      toolName: 'searchMenu',
      arguments: { query: 'Combo Hợp Gu 99K' },
    });
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result.value)).toContain('Combo Hợp Gu 99K');
  });

  it('keeps the direct request adapter for invalid argument rejection', async () => {
    const result = await executeToolCall(clients, { toolName: 'searchMenu', arguments: { q: 'wrong' } });
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('invalid_tool_arguments');
  });

  it('executes voucher validation from state without inventing public codes', async () => {
    const result = await executeToolCall(clients, buildState({ intent: 'voucher' }), {
      toolName: 'validateVoucher',
      arguments: { voucherText: 'KFC50', subtotalVnd: 250000 },
    });
    expect(result.ok).toBe(true);
    expect(result.value).toMatchObject({ ok: false, reason: 'public_code_not_exposed', publicCode: '' });
  });

  it('propagates failing client results in the state-centric path', async () => {
    const order = buildOrder();
    const result = await executeToolCall(
      clients,
      buildState({
        order,
        paymentAttempt: { method: 'momo', status: 'pending', paymentUrl: 'https://pay.mock/momo/KFC-MOCK-1001' },
      }),
      { toolName: 'checkPaymentStatus', arguments: { orderId: order.id } },
    );

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('payment_failed');
    expect(result.message).toContain('Mock payment is configured to fail');
  });

  it('rejects payment link creation when only an order preview exists', async () => {
    const result = await executeToolCall(
      clients,
      buildState({
        orderPreview: buildOrder({ id: 'preview_1', status: 'previewed', paymentStatus: 'not_started' }),
      }),
      { toolName: 'createPaymentLink', arguments: { method: 'momo' } },
    );

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('order_required');
  });
});
