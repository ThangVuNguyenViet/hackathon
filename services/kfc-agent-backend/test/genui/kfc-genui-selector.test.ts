import { describe, expect, it } from 'vitest';
import { selectKfcGenUiAttachment } from '../../src/genui/kfcGenUiSelector.js';
import type { AgentGraphState } from '../../src/graph/state.js';

function state(partial: Partial<AgentGraphState>): AgentGraphState {
  return {
    sessionId: 'session_1',
    customerId: 'customer_1',
    channel: 'kfc',
    latestUserMessage: '',
    intent: 'unclear',
    toolTrace: [],
    escalationReasons: [],
    retrievedEvidence: [],
    userConfirmedOrder: false,
    ...partial,
  } as AgentGraphState;
}

function orderWithPaymentStatus(paymentStatus: 'pending' | 'paid') {
  return {
    id: 'ORDER-STATUS-1',
    cart: {
      id: 'cart_status_1',
      items: [],
      subtotalVnd: 0,
      discountVnd: 0,
      deliveryFeeVnd: 0,
      totalVnd: 0,
      voucherCode: null,
    },
    status: 'created' as const,
    paymentStatus,
    assignedStoreId: 'store_1',
    createdAt: '2026-07-11T00:00:00.000Z',
  };
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

  it('limits broad menu recommendations to five actionable choices', () => {
    const menuSearchResults = Array.from({ length: 12 }, (_, index) => ({
      code: `item_${index + 1}`,
      name: `Món ${index + 1}`,
      description: `Mô tả món ${index + 1}`,
      category: 'Combo',
      priceVnd: 50000 + index * 1000,
      originalPriceVnd: null,
      imageUrl: `https://example.test/item-${index + 1}.jpg`,
      available: true,
    }));
    const attachment = selectKfcGenUiAttachment({
      state: state({
        intent: 'ordering',
        entities: { keepMenuSurface: true },
        menuSearchResults,
      }),
      turnToolNames: ['searchMenu'],
    });

    expect(attachment?.widgetKind).toBe('smartMenuPicker');
    expect(attachment?.data.items).toHaveLength(5);
  });

  it('limits group recommendations to three budget compositions without claiming serving coverage', () => {
    const menuSearchResults = Array.from({ length: 6 }, (_, index) => ({
      code: `combo_${index + 1}`, name: `Combo ${index + 1}`, description: `Combo ${index + 1}`,
      category: 'Combo', priceVnd: 100000 + index * 10000, originalPriceVnd: null,
      imageUrl: `https://example.test/combo-${index + 1}.jpg`, available: true,
    }));
    const attachment = selectKfcGenUiAttachment({
      state: state({ latestUserMessage: 'Gợi ý combo cho 5 người, ngân sách 500k', intent: 'ordering', menuSearchResults }),
      turnToolNames: ['searchMenu'],
    });
    const items = attachment?.data.items as Array<Record<string, unknown>>;
    expect(attachment?.data).toMatchObject({ partySize: 5, budgetVnd: 500000 });
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({
      recommendedQuantity: 5, composedTotalVnd: 500000, budgetDeltaVnd: 0, servingCoverageVerified: false,
    });
  });

  it('selects PaymentMethodPicker from verified payment-method evidence', () => {
    const methods = [{
      methodId: 'zalopay_wallet', displayName: 'Ví ZaloPay', category: 'digital_wallet' as const,
      supported: true, supportStatus: 'listed_supported' as const, paymentSurface: 'kfc_website_checkout',
      evidenceText: 'Verified', sourceUrl: 'https://example.test/payment', sourceFile: 'payment.json', notes: '',
      provenance: { sourceFile: 'payment.json', sourceUrl: 'https://example.test/payment', fixtureMode: 'public_crawl_seed' as const },
    }];
    const attachment = selectKfcGenUiAttachment({
      state: state({ latestUserMessage: 'KFC hỗ trợ phương thức thanh toán nào?', intent: 'payment', paymentMethodEvidence: methods }),
      turnToolNames: ['listPaymentMethods'],
    });
    expect(attachment?.widgetKind).toBe('paymentMethodPicker');
    expect(attachment?.data.methods).toEqual(methods);
  });

  it('does not reuse a payment picker when the current job is invoice collection', () => {
    const attachment = selectKfcGenUiAttachment({
      state: state({
        latestUserMessage: 'Mình cần xuất hóa đơn công ty',
        intent: 'ordering',
        paymentMethodEvidence: [{}] as AgentGraphState['paymentMethodEvidence'],
      }),
      turnToolNames: ['collectInvoice'],
    });
    expect(attachment).toBeUndefined();
  });

  it('does not reuse menu results for a promotion-only turn', () => {
    const attachment = selectKfcGenUiAttachment({
      state: state({
        latestUserMessage: 'Hôm nay có khuyến mãi gì?',
        intent: 'unclear',
        entities: { keepMenuSurface: true },
        menuSearchResults: [{
          code: '41141', name: 'Burger Gà Zinger', description: 'Burger gà',
          category: 'Burger', priceVnd: 55000, originalPriceVnd: null,
          imageUrl: 'https://example.test/burger.jpg', available: true,
        }],
      }),
      turnToolNames: [],
    });
    expect(attachment).toBeUndefined();
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
        address: {
          label: 'Nhà',
          line1: '23 Nguyễn Hữu Thọ',
          district: 'Quận 7',
          city: 'Hồ Chí Minh',
        },
      }),
      turnToolNames: ['quoteFulfillment'],
    });

    expect(attachment?.widgetKind).toBe('addressFulfillmentCheck');
    expect(attachment?.actions.map((action) => action.id)).toContain('accept_fulfillment');
  });

  it('does not offer fulfillment acceptance before an address and quote exist', () => {
    const attachment = selectKfcGenUiAttachment({
      state: state({
        intent: 'ordering',
        entities: { preferFulfillmentSurface: true },
      }),
      turnToolNames: ['findStores'],
    });

    expect(attachment?.widgetKind).toBe('addressFulfillmentCheck');
    expect(attachment?.actions.map((action) => action.id)).toEqual([
      'submit_address',
    ]);
    expect(attachment?.actions[0]?.label).toBe('Nhập địa chỉ giao hàng');
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

  it('uses a current order-status lookup as the fresh payment-status source', () => {
    const attachment = selectKfcGenUiAttachment({
      state: state({
        order: orderWithPaymentStatus('paid'),
        paymentAttempt: { method: 'zalopay', status: 'failed' },
      }),
      turnToolNames: ['getOrderStatus'],
    });

    expect(attachment?.widgetKind).toBe('orderTrackingStatus');
    expect(attachment?.data.paymentStatusEvidence).toEqual({
      resolution: 'current_tool',
      selectedStatus: 'paid',
      selectedSource: 'order',
      statuses: { order: 'paid', paymentAttempt: 'failed' },
    });
  });

  it('uses a current payment-status check instead of an older order value', () => {
    const attachment = selectKfcGenUiAttachment({
      state: state({
        order: orderWithPaymentStatus('paid'),
        paymentAttempt: { method: 'zalopay', status: 'failed' },
      }),
      turnToolNames: ['checkPaymentStatus'],
    });

    expect(attachment?.widgetKind).toBe('paymentOrderStatus');
    expect(attachment?.data.paymentStatusEvidence).toEqual({
      resolution: 'current_tool',
      selectedStatus: 'failed',
      selectedSource: 'paymentAttempt',
      statuses: { order: 'paid', paymentAttempt: 'failed' },
    });
  });

  it('marks matching stored payment statuses as consistent evidence', () => {
    const attachment = selectKfcGenUiAttachment({
      state: state({
        order: orderWithPaymentStatus('paid'),
        paymentAttempt: { method: 'zalopay', status: 'paid' },
      }),
      turnToolNames: [],
    });

    expect(attachment?.data.paymentStatusEvidence).toEqual({
      resolution: 'consistent',
      selectedStatus: 'paid',
      selectedSource: 'matching_sources',
      statuses: { order: 'paid', paymentAttempt: 'paid' },
    });
  });

  it('carries both stored payment statuses when their freshness is unresolved', () => {
    const attachment = selectKfcGenUiAttachment({
      state: state({
        order: orderWithPaymentStatus('paid'),
        paymentAttempt: { method: 'zalopay', status: 'failed' },
      }),
      turnToolNames: [],
    });

    expect(attachment?.data.paymentStatusEvidence).toEqual({
      resolution: 'conflict',
      statuses: { order: 'paid', paymentAttempt: 'failed' },
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

  it('does not turn an unverified item clarification into support handoff', () => {
    const attachment = selectKfcGenUiAttachment({
      state: state({
        escalationReasons: ['unverified_item_code'],
      }),
      turnToolNames: ['searchMenu'],
    });

    expect(attachment).toBeUndefined();
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
