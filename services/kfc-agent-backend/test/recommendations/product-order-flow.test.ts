import { describe, expect, it } from 'vitest';
import type { Cart, Order } from '../../src/domain/types.js';
import { bindProductOrderFlow } from '../../src/recommendations/application/product-order-flow.js';

function cart(itemCode: string): Cart {
  return {
    id: 'cart-session-001',
    items: [
      {
        itemCode,
        name: itemCode,
        quantity: 1,
        unitPriceVnd: 50_000,
      },
    ],
    subtotalVnd: 50_000,
    discountVnd: 0,
    deliveryFeeVnd: 0,
    totalVnd: 50_000,
    voucherCode: null,
  };
}

function order(id: string, orderCart: Cart): Order {
  return {
    id,
    cart: structuredClone(orderCart),
    status: 'created',
    paymentStatus: 'not_started',
    assignedStoreId: 'KFCVN0002',
    createdAt: '2026-07-27T09:00:00Z',
  };
}

describe('durable product order-flow binding', () => {
  it('stays stable through one order and rotates once when the same session starts the next order', async () => {
    const firstCart = cart('item-1');
    const firstFlow = await bindProductOrderFlow({
      sessionId: 'session-001',
      cart: firstCart,
    });

    await expect(
      bindProductOrderFlow({
        sessionId: 'session-001',
        cart: cart('item-2'),
        prior: firstFlow,
      }),
    ).resolves.toEqual(firstFlow);

    const firstOrder = order('order-1', firstCart);
    await expect(
      bindProductOrderFlow({
        sessionId: 'session-001',
        cart: firstCart,
        order: firstOrder,
        prior: firstFlow,
      }),
    ).resolves.toEqual(firstFlow);

    const secondCart = cart('item-2');
    const secondFlow = await bindProductOrderFlow({
      sessionId: 'session-001',
      cart: secondCart,
      order: firstOrder,
      prior: firstFlow,
    });
    expect(secondFlow.orderFlowId).not.toBe(firstFlow.orderFlowId);
    expect(secondFlow).toMatchObject({
      cartId: secondCart.id,
      predecessorOrderId: 'order-1',
    });

    await expect(
      bindProductOrderFlow({
        sessionId: 'session-001',
        cart: cart('item-3'),
        order: firstOrder,
        prior: secondFlow,
      }),
    ).resolves.toEqual(secondFlow);

    const secondOrder = order('order-2', secondCart);
    const thirdFlow = await bindProductOrderFlow({
      sessionId: 'session-001',
      cart: cart('item-3'),
      order: secondOrder,
      prior: secondFlow,
    });
    expect(thirdFlow.orderFlowId).not.toBe(secondFlow.orderFlowId);
    expect(thirdFlow.predecessorOrderId).toBe('order-2');
  });
});
