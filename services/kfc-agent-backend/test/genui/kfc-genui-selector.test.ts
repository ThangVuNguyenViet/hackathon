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
    expect(attachment?.actions).toEqual([{
      id: 'add_items',
      label: 'Xác nhận món',
      intent: 'primary',
    }]);
  });

  it('keeps current menu choices ahead of fulfillment when the requested item needs confirmation', () => {
    const attachment = selectKfcGenUiAttachment({
      state: state({
        latestUserMessage: 'Cho mình burger tôm, giao về Nhà Bè được không?',
        intent: 'ordering',
        entities: { preferFulfillmentSurface: true },
        plannerMenuCatalogContext: {
          query: 'burger tôm',
          candidates: [{
            code: '41140', itemId: '41140', productCode: '41140', name: 'Burger Tôm',
            description: 'Burger tôm', category: 'Burger', priceVnd: 45000,
            originalPriceVnd: null, imageUrl: '', available: false,
            verifiedForMutation: true, verificationQuery: 'Burger Tôm', modifierGroups: [],
          }],
        },
      }),
      turnToolNames: [],
    });

    expect(attachment?.widgetKind).toBe('smartMenuPicker');
    expect(attachment?.data.items).toEqual([expect.objectContaining({ code: '41140', available: false })]);
  });

  it('selects a product detail card from current getItemDetails evidence', () => {
    const item = {
      code: '41141', name: 'Burger Gà Zinger', description: 'Burger gà',
      category: 'Burger', priceVnd: 55000, originalPriceVnd: null,
      imageUrl: 'https://static.kfcvietnam.com.vn/images/items/lg/ZINGER.jpg', available: true,
    };
    const attachment = selectKfcGenUiAttachment({
      state: state({ intent: 'ordering', menuItemDetail: item } as Partial<AgentGraphState>),
      turnToolNames: ['getItemDetails'],
    });

    expect(attachment).toMatchObject({
      widgetKind: 'productDetailCard',
      data: { item },
      actions: [{ id: 'add_item', payload: { itemCode: '41141', quantity: 1 } }],
    });
  });

  it('gives each modifier option an exact collision-safe trusted action', () => {
    const option = (modifierId: string, name: string) => ({
      modifierId, name, priceDeltaVnd: 0, default: false, quantity: 0,
      posItemId: modifierId, imageName: '', modifierGroups: [],
    });
    const attachment = selectKfcGenUiAttachment({
      state: state({
        intent: 'ordering',
        menuModifierOptions: {
          itemCode: '3001', itemId: '3001', productCode: 'combo', name: 'Combo',
          modifierGroups: [
            { groupId: 'a:b', name: 'One', min: 0, max: 1, depth: 0, options: [option('c', 'C')] },
            { groupId: 'a', name: 'Two', min: 0, max: 1, depth: 0, options: [option('b:c', 'BC')] },
          ],
          provenance: { sourceFile: 'fixture', fixtureMode: 'public_crawl_seed' },
        },
      }),
      turnToolNames: ['getModifierOptions'],
    });

    expect(attachment?.widgetKind).toBe('modifierPicker');
    expect(attachment?.actions).toEqual([
      expect.objectContaining({ id: 'customize_item:a%3Ab:c', payload: { itemCode: '3001', groupId: 'a:b', modifierId: 'c' } }),
      expect.objectContaining({ id: 'customize_item:a:b%3Ac', payload: { itemCode: '3001', groupId: 'a', modifierId: 'b:c' } }),
    ]);
  });

  it('selects promotion media only from current promotion evidence', () => {
    const offers = [{
      offerId: 'lunch-2026-combo-42k', campaign: 'Trưa Nay Ăn Gì?', offerName: 'Combo 42K',
      startDate: '2026-01-02', endDate: '2026-12-31',
      imageUrl: 'https://static.kfcvietnam.com.vn/TIN%20KHUYEN%20MAI%20-%20TNAG%20PHASE%203.jpg',
    }];
    const attachment = selectKfcGenUiAttachment({
      state: state({ intent: 'unclear', promotionOffers: offers } as unknown as Partial<AgentGraphState>),
      turnToolNames: ['searchPromotions'],
    });
    expect(attachment).toMatchObject({ widgetKind: 'promotionGallery', data: { offers } });
  });

  it('keeps allergen evidence text-only without matching current product identity', () => {
    const attachment = selectKfcGenUiAttachment({
      state: state({
        intent: 'unclear',
        menuSearchResults: [{
          code: 'stale', name: 'Stale burger', description: '', category: 'Burger',
          priceVnd: 1, originalPriceVnd: null,
          imageUrl: 'https://static.kfcvietnam.com.vn/images/items/lg/HOPGU.jpg?v=LNN7PL', available: true,
        }],
        contentEvidence: [{
          kind: 'allergen', title: 'Bảng dị ứng', snippet: 'Thông tin chính thức',
          sourceUrl: 'https://www.kfcvietnam.com.vn/allergen-chart', sourceFile: 'allergen.json',
        }],
      }),
      turnToolNames: ['searchMenu', 'answerAllergenQuestion'],
    });
    expect(attachment).toMatchObject({ widgetKind: 'allergenEvidence', data: { item: null } });
  });

  it('projects every verified broad-menu row with provider categories and the five-item selection limit', () => {
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
    expect(attachment?.data.items).toHaveLength(12);
    expect(attachment?.data.categories).toEqual(['Combo']);
    expect(attachment?.data.selectionLimit).toBe(5);
    expect(attachment?.authority).toMatchObject({
      schemaVersion: 'kfc-genui-v1',
      sessionId: 'session_1',
      customerId: 'customer_1',
      actionLifecycle: 'one_shot',
    });
  });

  it('does not synthesize recommendation quantities from party size or budget', () => {
    const menuSearchResults = Array.from({ length: 6 }, (_, index) => ({
      code: `combo_${index + 1}`, name: `Combo ${index + 1}`, description: `Combo ${index + 1}`,
      category: 'Combo', priceVnd: 100000 + index * 10000, originalPriceVnd: null,
      imageUrl: `https://example.test/combo-${index + 1}.jpg`, available: true,
    }));
    const attachment = selectKfcGenUiAttachment({
      state: state({
        latestUserMessage: 'Gợi ý combo cho 5 người, ngân sách 500k',
        intent: 'ordering',
        entities: { partySize: 5, budgetVnd: 500000 },
        menuSearchResults,
      }),
      turnToolNames: ['searchMenu'],
    });
    const items = attachment?.data.items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(6);
    expect(attachment?.data).not.toHaveProperty('partySize');
    expect(attachment?.data).not.toHaveProperty('budgetVnd');
    expect(items[0]).not.toHaveProperty('recommendedQuantity');
    expect(items[0]).not.toHaveProperty('composedTotalVnd');
    expect(items[0]).not.toHaveProperty('budgetDeltaVnd');
    expect(items[0]).not.toHaveProperty('servingCoverageVerified');
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
        intent: 'voucher',
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
        handoff: { escalationId: 'esc_1', reasons: ['abnormal_large_order'] },
        escalationReasons: ['abnormal_large_order'],
      }),
      turnToolNames: ['handoff'],
    });

    expect(attachment?.widgetKind).toBe('supportHandoff');
    expect(attachment?.summary).toBe('Đơn hàng có số lượng lớn');
    expect(attachment?.summary).not.toContain('abnormal_large_order');
  });

  it('keeps an existing support handoff visible during a no-tool explanation', () => {
    const attachment = selectKfcGenUiAttachment({
      state: state({
        handoff: { escalationId: 'esc_1', reasons: ['abnormal_large_order'] },
        entities: { smallTalk: true, suppressGenUi: true },
      }),
      turnToolNames: [],
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

  it('keeps a successful current cart mutation ahead of a saved-address candidate', () => {
    const attachment = selectKfcGenUiAttachment({
      state: state({
        entities: { preferFulfillmentSurface: true, preferCartSurface: true },
        customerContext: {
          savedAddresses: [{ label: 'Nhà', line1: '123 Nguyễn Trãi', district: 'Quận 5', city: 'Hồ Chí Minh' }],
          recentOrders: [],
          favorites: [],
        },
        cart: {
          id: 'cart_1',
          items: [{ itemCode: '41141', name: 'Burger Gà Zinger', quantity: 1, unitPriceVnd: 55000 }],
          subtotalVnd: 55000, discountVnd: 0, deliveryFeeVnd: 0, totalVnd: 55000, voucherCode: null,
        },
      }),
      turnToolNames: ['updateCart'],
    });

    expect(attachment?.widgetKind).toBe('cartBuilder');
    expect(attachment?.data.cart).toEqual(expect.objectContaining({ id: 'cart_1' }));
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

  it('prioritizes successful current-turn menu evidence over a persistent cart', () => {
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

    expect(attachment?.widgetKind).toBe('smartMenuPicker');
  });
});
