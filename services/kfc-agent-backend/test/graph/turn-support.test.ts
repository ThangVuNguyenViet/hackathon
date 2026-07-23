import { describe, expect, it } from 'vitest';
import type { AgentGraphState } from '../../src/graph/state.js';
import { traceStateSummary } from '../../src/graph/turnSupport.js';

function paymentState(
  overrides: Partial<AgentGraphState>,
): AgentGraphState {
  return {
    sessionId: 'payment-trace-session',
    customerId: 'payment-trace-customer',
    channel: 'kfc',
    latestUserMessage: '',
    userConfirmedOrder: false,
    escalationReasons: [],
    retrievedEvidence: [],
    ...overrides,
  };
}

function paymentOrder(id: string): NonNullable<AgentGraphState['order']> {
  return {
    id,
    cart: {
      id: `cart-${id}`,
      items: [],
      subtotalVnd: 0,
      discountVnd: 0,
      deliveryFeeVnd: 0,
      totalVnd: 0,
      voucherCode: null,
    },
    status: 'created',
    paymentStatus: 'pending',
    assignedStoreId: 'KFC-Q5',
    createdAt: '2026-07-20T00:00:00.000Z',
  };
}

describe('turn trace state summary', () => {
  it('ignores a payment attempt bound to a different order', () => {
    const summary = traceStateSummary(paymentState({
      order: paymentOrder('verified-order'),
      paymentAttempt: {
        orderId: 'different-order',
        status: 'failed',
      },
    }));

    expect(summary.paymentStatus).toBe('pending');
    expect(summary).not.toHaveProperty('intent');
  });

  it('uses a payment attempt only when its order binding is exact', () => {
    const summary = traceStateSummary(paymentState({
      order: paymentOrder('verified-order'),
      paymentAttempt: {
        orderId: 'verified-order',
        status: 'failed',
      },
    }));

    expect(summary.paymentStatus).toBe('failed');
  });
});
