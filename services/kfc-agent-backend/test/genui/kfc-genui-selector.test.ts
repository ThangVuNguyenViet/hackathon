import { describe, expect, it } from 'vitest';
import { selectKfcGenUiAttachment } from '../../src/genui/kfcGenUiSelector.js';
import type { AgentGraphState } from '../../src/graph/state.js';

function state(partial: Partial<AgentGraphState>): AgentGraphState {
  return {
    sessionId: 'session_1',
    customerId: 'customer_1',
    channel: 'web_mock',
    latestUserMessage: '',
    intent: 'unclear',
    toolTrace: [],
    escalationReasons: [],
    retrievedEvidence: [],
    userConfirmedOrder: false,
    ...partial,
  } as AgentGraphState;
}

describe('selectKfcGenUiAttachment', () => {
  it('selects SmartMenuPicker after menu recommendation evidence', () => {
    const attachment = selectKfcGenUiAttachment({
      state: state({
        latestUserMessage: 'Không biết ăn gì',
        intent: 'ordering',
        menuSearchResults: [
          {
            code: '41141',
            name: 'Burger Gà Zinger',
            description: 'Burger gà',
            category: 'Burger',
            priceVnd: 55000,
            originalPriceVnd: null,
            imageUrl: 'https://example.test/burger.jpg',
            available: true,
          },
        ],
        toolTrace: [
          {
            toolName: 'searchMenu',
            arguments: {},
            ok: true,
            resultSummary: '3 items',
            provenance: [],
          },
        ],
      }),
      turnToolNames: ['searchMenu'],
    });

    expect(attachment?.widgetKind).toBe('smartMenuPicker');
    expect(attachment?.data.items).toEqual([
      expect.objectContaining({
        code: '41141',
        name: 'Burger Gà Zinger',
        priceVnd: 55000,
      }),
    ]);
    expect(attachment?.actions.map((action) => action.id)).toContain('add_item');
    expect(attachment?.actions).toContainEqual({
      id: 'add_item',
      label: 'Thêm vào giỏ',
      intent: 'primary',
    });
    expect(attachment?.actions.map((action) => action.id)).toContain('customize_item');
  });

  it('does not render a menu picker when delivery-status text has no menu results', () => {
    const attachment = selectKfcGenUiAttachment({
      state: state({
        latestUserMessage: 'Kiểm tra giao hàng',
        intent: 'order_status',
        menuSearchResults: [],
        toolTrace: [
          {
            toolName: 'searchMenu',
            arguments: { query: 'giao hàng' },
            ok: true,
            resultSummary: 'ok',
            provenance: [],
          },
        ],
      }),
      turnToolNames: ['searchMenu'],
    });

    expect(attachment).toBeUndefined();
  });

  it('selects AddressFulfillmentCheck when a fulfillment quote is the current job', () => {
    const attachment = selectKfcGenUiAttachment({
      state: state({
        cart: {
          id: 'cart_1',
          items: [
            {
              itemCode: '41141',
              name: 'Zinger Burger',
              quantity: 1,
              unitPriceVnd: 55000,
            },
          ],
          subtotalVnd: 55000,
          discountVnd: 0,
          deliveryFeeVnd: 18000,
          totalVnd: 73000,
          voucherCode: null,
        },
        fulfillment: {
          method: 'delivery',
          disposition: 'delivery',
          storeId: 'store_1',
          storeName: 'KFC Quận 7',
          feeVnd: 18000,
          etaMinutes: 25,
          availability: {
            ok: true,
            checkedItemIds: ['41141'],
            unavailableItemIds: [],
            blockedTimeslotItemIds: [],
            source: { fixtureMode: 'mock_external_state', sourceFile: 'test' },
          },
        },
      }),
      turnToolNames: ['quoteFulfillment'],
    });

    expect(attachment?.widgetKind).toBe('addressFulfillmentCheck');
    expect(attachment?.actions.map((action) => action.id)).toContain('accept_fulfillment');
  });

  it('selects OrderReviewConfirm when cart and fulfillment are ready after fulfillment acceptance', () => {
    const attachment = selectKfcGenUiAttachment({
      state: state({
        cart: {
          id: 'cart_1',
          items: [
            {
              itemCode: '41141',
              name: 'Zinger Burger',
              quantity: 1,
              unitPriceVnd: 55000,
            },
          ],
          subtotalVnd: 55000,
          discountVnd: 0,
          deliveryFeeVnd: 18000,
          totalVnd: 73000,
          voucherCode: null,
        },
        fulfillment: {
          method: 'delivery',
          disposition: 'delivery',
          storeId: 'store_1',
          storeName: 'KFC Quận 7',
          feeVnd: 18000,
          etaMinutes: 25,
          availability: {
            ok: true,
            checkedItemIds: ['41141'],
            unavailableItemIds: [],
            blockedTimeslotItemIds: [],
            source: { fixtureMode: 'mock_external_state', sourceFile: 'test' },
          },
        },
      }),
      turnToolNames: ['previewCart'],
    });

    expect(attachment?.widgetKind).toBe('orderReviewConfirm');
    expect(attachment?.actions.map((action) => action.id)).toContain('confirm_order');
    expect(attachment?.actions.find((action) => action.id === 'confirm_order')).toMatchObject({
      label: 'Đặt đơn 73.000đ',
      intent: 'primary',
    });
  });

  it('omits track order from payment status actions', () => {
    const attachment = selectKfcGenUiAttachment({
      state: state({
        paymentAttempt: {
          method: 'momo',
          status: 'pending',
          paymentUrl: 'https://pay.mock/momo/KFC-MOCK-1001',
        },
      }),
      turnToolNames: ['checkPaymentStatus'],
    });

    expect(attachment?.widgetKind).toBe('paymentOrderStatus');
    expect(attachment?.actions.map((action) => action.id)).not.toContain('track_order');
  });

  it('selects order tracking with track order after payment succeeds', () => {
    const attachment = selectKfcGenUiAttachment({
      state: state({
        order: {
          id: 'KFC-MOCK-1001',
          cart: {
            id: 'cart_1',
            items: [
              {
                itemCode: '41141',
                name: 'Zinger Burger',
                quantity: 1,
                unitPriceVnd: 55000,
              },
            ],
            subtotalVnd: 55000,
            discountVnd: 0,
            deliveryFeeVnd: 18000,
            totalVnd: 73000,
            voucherCode: null,
          },
          status: 'preparing',
          paymentStatus: 'paid',
          assignedStoreId: 'store_1',
          createdAt: '2026-07-09T09:00:00.000Z',
        },
        paymentAttempt: {
          method: 'momo',
          status: 'paid',
          paymentUrl: 'https://pay.mock/momo/KFC-MOCK-1001',
        },
      }),
      turnToolNames: ['checkPaymentStatus'],
    });

    expect(attachment?.widgetKind).toBe('orderTrackingStatus');
    expect(attachment?.actions).toContainEqual({
      id: 'track_order',
      label: 'Theo dõi đơn',
      intent: 'primary',
    });
  });

  it('selects SupportHandoff for escalation state', () => {
    const attachment = selectKfcGenUiAttachment({
      state: state({
        handoff: { escalationId: 'esc_1', reasons: ['abnormal_order'] },
        escalationReasons: ['abnormal_order'],
      }),
      turnToolNames: ['handoff'],
    });

    expect(attachment?.widgetKind).toBe('supportHandoff');
  });

  it('does not turn safety blockers into human handoff widgets', () => {
    const attachment = selectKfcGenUiAttachment({
      state: state({
        escalationReasons: ['order_confirmation_required'],
        cart: {
          id: 'cart_1',
          items: [
            {
              itemCode: '41141',
              name: 'Zinger Burger',
              quantity: 1,
              unitPriceVnd: 55000,
            },
          ],
          subtotalVnd: 55000,
          discountVnd: 0,
          deliveryFeeVnd: 0,
          totalVnd: 55000,
          voucherCode: null,
        },
      }),
      turnToolNames: ['updateCart'],
    });

    expect(attachment?.widgetKind).toBe('cartBuilder');
  });

  it('keeps the cart visible when the current turn also searched menu', () => {
    const attachment = selectKfcGenUiAttachment({
      state: state({
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
        menuSearchResults: [
          {
            code: '20751',
            name: 'Combo Hợp Gu 99K',
            description: '3 Miếng Gà Rán + 1 Burger Tôm',
            category: 'Ưu Đãi',
            priceVnd: 99000,
            originalPriceVnd: null,
            imageUrl: 'https://example.test/combo.jpg',
            available: true,
          },
        ],
      }),
      turnToolNames: ['searchMenu'],
    });

    expect(attachment?.widgetKind).toBe('cartBuilder');
  });
});
