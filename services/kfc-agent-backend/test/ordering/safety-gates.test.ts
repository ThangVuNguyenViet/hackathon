import { describe, expect, it } from 'vitest';
import type { AgentGraphState } from '../../src/graph/state.js';
import { applySafetyGates } from '../../src/ordering/safetyGates.js';

function order(id: string) {
  return {
    id,
    cart: {
      id: `cart-${id}`,
      items: [],
      subtotalVnd: 199000,
      discountVnd: 0,
      deliveryFeeVnd: 18000,
      totalVnd: 217000,
      voucherCode: null,
    },
    status: 'created' as const,
    paymentStatus: 'paid' as const,
    assignedStoreId: 'KFCVN0002',
    createdAt: '2026-07-08T00:00:00.000Z',
  };
}

function state(overrides: Partial<AgentGraphState> = {}): AgentGraphState {
  return {
    sessionId: 'session_1',
    customerId: 'customer_1',
    channel: 'web_mock',
    latestUserMessage: 'xác nhận đơn',
    intent: 'ordering',
    userConfirmedOrder: false,
    escalationReasons: [],
    retrievedEvidence: [],
    toolTrace: [],
    ...overrides,
  };
}

describe('safety gates', () => {
  it('blocks placeOrder without explicit confirmation', () => {
    const result = applySafetyGates(state(), [{ toolName: 'placeOrder', arguments: {} }]);
    expect(result.allowedCalls).toHaveLength(0);
    expect(result.blockedReasons).toContain('order_confirmation_required');
  });

  it('blocks promo claim when no promotion tool evidence exists', () => {
    const result = applySafetyGates(state(), [{ toolName: 'previewOrder', arguments: {} }], {
      responseClaims: ['promotion'],
    });
    expect(result.blockedReasons).toContain('promotion_evidence_required');
  });

  it('blocks payment-success claim when only payment-link evidence exists', () => {
    const result = applySafetyGates(
      state({
        paymentAttempt: { method: 'momo', status: 'paid', paymentUrl: 'https://pay.mock/momo/KFC-MOCK-1001' },
        toolTrace: [
          {
            toolName: 'createPaymentLink',
            arguments: { method: 'momo' },
            ok: true,
            resultSummary: 'pending link created',
            provenance: [],
          },
        ],
      }),
      [],
      { responseClaims: ['payment_success'] },
    );

    expect(result.blockedReasons).toContain('payment_tool_success_required');
  });

  it('allows payment-success claim only after successful payment status evidence', () => {
    const result = applySafetyGates(
      state({
        order: order('KFC-MOCK-1001'),
        paymentAttempt: { method: 'momo', status: 'paid', paymentUrl: 'https://pay.mock/momo/KFC-MOCK-1001' },
        toolTrace: [
          {
            toolName: 'checkPaymentStatus',
            arguments: { orderId: 'KFC-MOCK-1001' },
            ok: true,
            resultSummary: 'status=paid',
            provenance: [],
          },
        ],
      }),
      [],
      { responseClaims: ['payment_success'] },
    );

    expect(result.blockedReasons).toEqual([]);
  });

  it('blocks payment-success claim when no active order id is available', () => {
    const result = applySafetyGates(
      state({
        paymentAttempt: { method: 'momo', status: 'paid', paymentUrl: 'https://pay.mock/momo/KFC-MOCK-1001' },
        toolTrace: [
          {
            toolName: 'checkPaymentStatus',
            arguments: { orderId: 'KFC-MOCK-1001' },
            ok: true,
            resultSummary: 'status=paid',
            provenance: [],
          },
        ],
      }),
      [],
      { responseClaims: ['payment_success'] },
    );

    expect(result.blockedReasons).toContain('payment_tool_success_required');
  });

  it('blocks payment-success claim when paid status evidence belongs to another order', () => {
    const result = applySafetyGates(
      state({
        order: order('KFC-MOCK-1002'),
        paymentAttempt: { method: 'momo', status: 'paid', paymentUrl: 'https://pay.mock/momo/KFC-MOCK-1002' },
        toolTrace: [
          {
            toolName: 'checkPaymentStatus',
            arguments: { orderId: 'KFC-MOCK-1001' },
            ok: true,
            resultSummary: 'status=paid',
            provenance: [],
          },
        ],
      }),
      [],
      { responseClaims: ['payment_success'] },
    );

    expect(result.blockedReasons).toContain('payment_tool_success_required');
  });

  it('blocks payment-success claim when structured payment status is not paid', () => {
    const result = applySafetyGates(
      state({
        order: order('KFC-MOCK-1001'),
        paymentAttempt: { method: 'momo', status: 'pending', paymentUrl: 'https://pay.mock/momo/KFC-MOCK-1001' },
        toolTrace: [
          {
            toolName: 'checkPaymentStatus',
            arguments: { orderId: 'KFC-MOCK-1001' },
            ok: true,
            resultSummary: 'status=pending',
            provenance: [],
          },
        ],
      }),
      [],
      { responseClaims: ['payment_success'] },
    );

    expect(result.blockedReasons).toContain('payment_tool_success_required');
  });

  it('allows placeOrder after confirmation and valid fulfillment', () => {
    const result = applySafetyGates(
      state({
        userConfirmedOrder: true,
        fulfillment: {
          method: 'delivery',
          disposition: 'delivery',
          storeId: 'KFCVN0002',
          storeName: 'KFC BIG C ĐỒNG NAI',
          feeVnd: 18000,
          etaMinutes: 25,
          availability: {
            ok: true,
            checkedItemIds: ['20751'],
            unavailableItemIds: [],
            blockedTimeslotItemIds: [],
            source: { fixtureMode: 'public_crawl_seed', sourceFile: 'fixtures/generated/store-availability.json' },
          },
        },
      }),
      [{ toolName: 'placeOrder', arguments: {} }],
    );
    expect(result.blockedReasons).toEqual([]);
    expect(result.allowedCalls[0]?.toolName).toBe('placeOrder');
  });
});
