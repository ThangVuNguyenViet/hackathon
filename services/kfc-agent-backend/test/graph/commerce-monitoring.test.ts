import { describe, expect, it } from 'vitest';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import type { Order } from '../../src/domain/types.js';
import { emitDerivedEvents } from '../../src/graph/commerceMonitoring.js';
import type { AgentGraphState } from '../../src/graph/state.js';
import type { ToolTraceEntry } from '../../src/ordering/types.js';

const sessionId = 'payment-monitor-session';

const order: Order = {
  id: 'verified-payment-order',
  cart: {
    id: 'verified-payment-cart',
    items: [],
    subtotalVnd: 0,
    discountVnd: 0,
    deliveryFeeVnd: 0,
    totalVnd: 0,
    voucherCode: null,
  },
  status: 'created',
  paymentStatus: 'pending',
  assignedStoreId: 'verified-store',
  createdAt: '2026-07-20T00:00:00.000Z',
};

const successfulPaymentCheck: ToolTraceEntry = {
  toolName: 'checkPaymentStatus',
  arguments: { orderId: order.id },
  ok: true,
  resultSummary: 'payment_status_observed',
  provenance: [],
};

function state(
  paymentAttempt: AgentGraphState['paymentAttempt'],
): AgentGraphState {
  return {
    sessionId,
    customerId: 'payment-monitor-customer',
    channel: 'kfc',
    latestUserMessage: '',
    userConfirmedOrder: false,
    escalationReasons: [],
    retrievedEvidence: [],
    order,
    paymentAttempt,
  };
}

describe('commerce payment monitoring authority', () => {
  it.each([
    {
      label: 'unbound',
      paymentAttempt: {
        status: 'failed' as const,
      },
    },
    {
      label: 'bound to a different order',
      paymentAttempt: {
        orderId: 'different-order',
        status: 'failed' as const,
      },
    },
  ])(
    'does not emit payment events for a $label attempt',
    ({ paymentAttempt }) => {
      const dashboard = new DashboardEventBus();

      emitDerivedEvents(
        { sessionId, dashboard },
        state(paymentAttempt),
        [successfulPaymentCheck],
      );

      expect(
        dashboard.getEvents(sessionId).map(({ type }) => type),
      ).not.toContain('payment_failed');
    },
  );

  it('emits the typed status only for the exact bound attempt', () => {
    const dashboard = new DashboardEventBus();

    emitDerivedEvents(
      { sessionId, dashboard },
      state({
        orderId: order.id,
        status: 'failed',
      }),
      [successfulPaymentCheck],
    );

    expect(dashboard.getEvents(sessionId)).toEqual([
      expect.objectContaining({
        type: 'payment_failed',
        payload: { status: 'failed' },
      }),
    ]);
  });
});
