import { describe, expect, it } from 'vitest';
import {
  bindProviderPaymentResultToOrder,
  paymentAttemptMatchesOrder,
} from '../../src/ordering/paymentOrderAuthority.js';

describe('payment order authority', () => {
  it('overwrites any provider-supplied order id with the server-bound id', () => {
    const result = bindProviderPaymentResultToOrder(
      {
        ok: true,
        value: {
          orderId: 'provider-forged-order',
          status: 'pending' as const,
        },
        message: 'provider result',
      },
      'server-verified-order',
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        orderId: 'server-verified-order',
        status: 'pending',
      },
    });
  });

  it('requires an exact server-bound order id before reusing an attempt', () => {
    expect(paymentAttemptMatchesOrder(
      {
        orderId: 'order-1',
        status: 'pending',
        paymentUrl: 'https://pay.example/order-1',
      },
      { id: 'order-1' },
    )).toBe(true);
    expect(paymentAttemptMatchesOrder(
      {
        orderId: 'order-2',
        status: 'pending',
        paymentUrl: 'https://pay.example/order-2',
      },
      { id: 'order-1' },
    )).toBe(false);
    expect(paymentAttemptMatchesOrder(
      {
        status: 'pending',
        paymentUrl: 'https://pay.example/legacy',
      },
      { id: 'order-1' },
    )).toBe(false);
  });
});
