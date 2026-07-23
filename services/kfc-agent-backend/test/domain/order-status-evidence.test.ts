import { describe, expect, it } from 'vitest';
import type { Order } from '../../src/domain/types.js';
import {
  currentOrderStatusDeliveryEstimate,
  orderStatusDeliveryEstimateSchema,
  orderWithCurrentDeliveryEstimate,
} from '../../src/domain/orderStatusEvidence.js';

const observedAt = '2026-07-20T02:00:00.000Z';
const expiresAt = '2026-07-20T02:05:00.000Z';
const estimate = {
  kind: 'remaining_delivery_window' as const,
  minMinutes: 25,
  maxMinutes: 30,
  observedAt,
  expiresAt,
  providerRevision: 'oms:KFC-1024:status-revision-7',
};

function order(): Order {
  return {
    id: 'KFC-1024',
    status: 'preparing',
    paymentStatus: 'paid',
    assignedStoreId: 'store-1',
    createdAt: '2026-07-20T01:45:00.000Z',
    deliveryEstimate: estimate,
    cart: {
      id: 'cart-1',
      items: [],
      subtotalVnd: 0,
      discountVnd: 0,
      deliveryFeeVnd: 0,
      totalVnd: 0,
      voucherCode: null,
    },
  };
}

describe('order-status delivery estimate freshness', () => {
  it('preserves provider evidence only inside its exact validity window', () => {
    const duringWindow = Date.parse(observedAt) + 1;

    expect(currentOrderStatusDeliveryEstimate(
      estimate,
      Date.parse(observedAt),
    )).toEqual(estimate);
    expect(currentOrderStatusDeliveryEstimate(estimate, duringWindow))
      .toEqual(estimate);
    expect(orderWithCurrentDeliveryEstimate(order(), duringWindow))
      .toMatchObject({ deliveryEstimate: estimate });
  });

  it.each([
    Date.parse(observedAt) - 1,
    Date.parse(expiresAt),
    Date.parse(expiresAt) + 1,
  ])('removes delivery evidence outside the provider validity window (%s)', (nowMs) => {
    expect(currentOrderStatusDeliveryEstimate(estimate, nowMs))
      .toBeUndefined();
    expect(orderWithCurrentDeliveryEstimate(order(), nowMs))
      .not.toHaveProperty('deliveryEstimate', estimate);
  });

  it('rejects a non-positive provider validity window', () => {
    expect(orderStatusDeliveryEstimateSchema.safeParse({
      ...estimate,
      expiresAt: observedAt,
    }).success).toBe(false);
  });

  it('removes malformed persisted evidence instead of trusting its type', () => {
    const malformed = {
      ...order(),
      deliveryEstimate: {
        ...estimate,
        minMinutes: 0,
      },
    } as unknown as Order;

    expect(orderWithCurrentDeliveryEstimate(
      malformed,
      Date.parse(observedAt) + 1,
    )).not.toHaveProperty('deliveryEstimate', malformed.deliveryEstimate);
  });
});
