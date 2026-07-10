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

  it('does not block a verified cart mutation by matching user-message words', () => {
    const result = applySafetyGates(
      state({
        latestUserMessage: 'Cho mình cái đó đi.',
        menuSearchResults: [
          {
            code: '20751',
            category: 'Combo',
            name: 'Combo Hợp Gu 99K',
            description: '',
            priceVnd: 99000,
            originalPriceVnd: null,
            imageUrl: '',
            available: true,
          },
          {
            code: '41141',
            category: 'Burger',
            name: 'Burger Gà Zinger',
            description: '',
            priceVnd: 55000,
            originalPriceVnd: null,
            imageUrl: '',
            available: true,
          },
        ],
      }),
      [{ toolName: 'updateCart', arguments: { itemCode: '20751', quantity: 1 } }],
      { requireVerifiedItemCodes: true },
    );

    expect(result.blockedReasons).toEqual([]);
    expect(result.allowedCalls[0]?.toolName).toBe('updateCart');
  });

  it('allows cart mutation from a pronoun when exactly one menu candidate is verified', () => {
    const result = applySafetyGates(
      state({
        latestUserMessage: 'Ok, thêm combo đó.',
        menuSearchResults: [
          {
            code: '20751',
            category: 'Combo',
            name: 'Combo Hợp Gu 99K',
            description: '',
            priceVnd: 99000,
            originalPriceVnd: null,
            imageUrl: '',
            available: true,
          },
        ],
      }),
      [{ toolName: 'updateCart', arguments: { itemCode: '20751', quantity: 1 } }],
      { requireVerifiedItemCodes: true },
    );

    expect(result.blockedReasons).toEqual([]);
    expect(result.allowedCalls[0]?.toolName).toBe('updateCart');
  });

  it('blocks previous-order cart mutation until the planner records structured reorder confirmation', () => {
    const baseState = state({
      customerContext: {
        savedAddresses: [],
        favorites: [],
        recentOrders: [
          order('KFC-MOCK-1001'),
        ],
      },
    });
    baseState.customerContext!.recentOrders[0]!.cart.items = [
      {
        itemCode: '20751',
        name: 'Combo Hợp Gu 99K',
        quantity: 1,
        unitPriceVnd: 99000,
      },
    ];

    const result = applySafetyGates(baseState, [
      { toolName: 'updateCart', arguments: { itemCode: '20751', quantity: 1 } },
    ]);

    expect(result.allowedCalls).toEqual([]);
    expect(result.blockedReasons).toContain('previous_order_confirmation_required');
  });

  it('allows previous-order cart mutation when structured reorder confirmation is present', () => {
    const baseState = state({
      entities: { reorderConfirmed: true },
      customerContext: {
        savedAddresses: [],
        favorites: [],
        recentOrders: [
          order('KFC-MOCK-1001'),
        ],
      },
    });
    baseState.customerContext!.recentOrders[0]!.cart.items = [
      {
        itemCode: '20751',
        name: 'Combo Hợp Gu 99K',
        quantity: 1,
        unitPriceVnd: 99000,
      },
    ];

    const result = applySafetyGates(baseState, [
      { toolName: 'updateCart', arguments: { itemCode: '20751', quantity: 1 } },
    ]);

    expect(result.blockedReasons).toEqual([]);
    expect(result.allowedCalls[0]?.toolName).toBe('updateCart');
  });

  it('blocks cart mutation under confirm-before-use policy until structured cart confirmation is present', () => {
    const result = applySafetyGates(
      state({
        cart: {
          id: 'cart_1',
          items: [
            {
              itemCode: '20751',
              name: 'Combo Hợp Gu 99K',
              quantity: 1,
              unitPriceVnd: 99000,
            },
          ],
          subtotalVnd: 99000,
          discountVnd: 0,
          deliveryFeeVnd: 0,
          totalVnd: 99000,
          voucherCode: null,
        },
      }),
      [{ toolName: 'updateCart', arguments: { itemCode: '20751', quantity: 0 } }],
      { requireCartMutationConfirmation: true },
    );

    expect(result.allowedCalls).toEqual([]);
    expect(result.blockedReasons).toContain('cart_mutation_confirmation_required');
  });

  it('allows cart mutation under confirm-before-use policy when structured cart confirmation is present', () => {
    const result = applySafetyGates(
      state({
        entities: { cartMutationConfirmed: true },
        cart: {
          id: 'cart_1',
          items: [
            {
              itemCode: '20751',
              name: 'Combo Hợp Gu 99K',
              quantity: 1,
              unitPriceVnd: 99000,
            },
          ],
          subtotalVnd: 99000,
          discountVnd: 0,
          deliveryFeeVnd: 0,
          totalVnd: 99000,
          voucherCode: null,
        },
      }),
      [{ toolName: 'updateCart', arguments: { itemCode: '20751', quantity: 0 } }],
      { requireCartMutationConfirmation: true },
    );

    expect(result.blockedReasons).toEqual([]);
    expect(result.allowedCalls[0]?.toolName).toBe('updateCart');
  });
});
