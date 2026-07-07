import * as clientsModule from '../../src/clients/interfaces.js';
import * as domainModule from '../../src/domain/types.js';
import { describe, expect, it } from 'vitest';
import type { Cart, MenuItem, Order } from '../../src/domain/types.js';
import type { ExternalClients } from '../../src/clients/interfaces.js';

describe('domain contracts', () => {
  it('exposes the domain and client contract modules', () => {
    expect(domainModule).toBeDefined();
    expect(clientsModule).toBeDefined();
  });

  it('represents menu, cart, and order state without channel details', () => {
    const item: MenuItem = {
      code: 'HOPGU',
      category: 'Hot Deals',
      name: 'Combo 99K',
      description: '3 Fried Chicken + 1 Shrimp Burger',
      priceVnd: 99000,
      originalPriceVnd: null,
      imageUrl: 'https://static.kfcvietnam.com.vn/images/items/lg/HOPGU.jpg?v=LNN7PL',
      available: true,
    };

    const cart: Cart = {
      id: 'cart_1',
      items: [{ itemCode: item.code, name: item.name, quantity: 1, unitPriceVnd: 99000 }],
      subtotalVnd: 99000,
      discountVnd: 0,
      deliveryFeeVnd: 0,
      totalVnd: 99000,
      voucherCode: null,
    };

    const order: Order = {
      id: 'KFC-MOCK-1001',
      cart,
      status: 'created',
      paymentStatus: 'pending',
      assignedStoreId: 'store_q7_mock',
      createdAt: '2026-07-07T00:00:00.000Z',
    };

    expect(order.cart.items[0]?.itemCode).toBe('HOPGU');
    expect(order.paymentStatus).toBe('pending');
  });

  it('requires all production-shaped client groups', () => {
    const keys: Array<keyof ExternalClients> = [
      'menu',
      'cart',
      'recommendation',
      'promotion',
      'inventory',
      'storeLocator',
      'oms',
      'payment',
      'delivery',
      'customer',
      'loyalty',
      'handoff',
      'feedback',
      'messenger',
      'zalo',
    ];

    expect(keys).toHaveLength(15);
  });
});
