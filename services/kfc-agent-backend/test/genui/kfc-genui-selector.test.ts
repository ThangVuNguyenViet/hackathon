import { describe, expect, it } from 'vitest';
import { kfcGenUiAttachmentForPersistence } from '../../src/genui/kfcGenUi.js';
import { selectKfcGenUiAttachment } from '../../src/genui/kfcGenUiSelector.js';
import type { AgentGraphState } from '../../src/graph/state.js';

function state(partial: Partial<AgentGraphState>): AgentGraphState {
  return {
    sessionId: 'session_1',
    customerId: 'customer_1',
    channel: 'kfc',
    latestUserMessage: '',
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
        menuSearchResults: [
          {
            code: '41141',
            name: 'Burger Gà Zinger',
            description: 'Burger gà',
            category: 'Burger',
            categoryId: 'test-burger',
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
    expect(attachment?.actions).toEqual([
      {
        id: 'add_items',
        label: 'Xác nhận món',
        intent: 'primary',
      },
    ]);
  });

  it('reuses a verified unavailable menu collection only with current response authority', () => {
    const unavailableItem = {
      code: '41140',
      name: 'Burger Tôm',
      description: 'Burger tôm',
      category: 'Burger',
      categoryId: 'test-burger',
      priceVnd: 45000,
      originalPriceVnd: null,
      imageUrl: '',
      available: false,
    };
    const attachment = selectKfcGenUiAttachment({
      state: state({
        activeMenuCollection: {
          key: 'filtered:burger-shrimp',
          revision: 'menu-revision',
          providerRevision: 'provider-revision',
          result: {
            items: [unavailableItem],
            total: 1,
            returned: 1,
            complete: true,
            scope: { scope: 'filtered', query: 'catalog-query-ref' },
          },
        },
      }),
      turnToolNames: [],
      reuseVerifiedMenuResults: true,
    });

    expect(attachment?.widgetKind).toBe('smartMenuPicker');
    expect(attachment?.data.items).toEqual([
      expect.objectContaining({ code: '41140', available: false }),
    ]);
  });

  it('selects a product detail card from current getItemDetails evidence', () => {
    const item = {
      code: '41141',
      name: 'Burger Gà Zinger',
      description: 'Burger gà',
      category: 'Burger',
      priceVnd: 55000,
      originalPriceVnd: null,
      imageUrl: 'https://static.kfcvietnam.com.vn/images/items/lg/ZINGER.jpg',
      available: true,
    };
    const attachment = selectKfcGenUiAttachment({
      state: state({ menuItemDetail: item } as Partial<AgentGraphState>),
      turnToolNames: ['getItemDetails'],
    });

    expect(attachment).toMatchObject({
      widgetKind: 'productDetailCard',
      data: { item },
      actions: [
        { id: 'add_item', payload: { itemCode: '41141', quantity: 1 } },
      ],
    });
  });

  it('prioritizes current modifier authority over generic menu evidence', () => {
    const option = (modifierId: string, name: string) => ({
      modifierId,
      name,
      priceDeltaVnd: 0,
      default: false,
      quantity: 0,
      posItemId: modifierId,
      imageName: '',
      modifierGroups: [],
    });
    const attachment = selectKfcGenUiAttachment({
      state: state({
        menuSearchResults: [
          {
            code: '3001',
            name: 'Combo',
            description: 'Combo',
            category: 'Combo',
            categoryId: 'test-combo',
            priceVnd: 99_000,
            originalPriceVnd: null,
            imageUrl: '',
            available: true,
          },
        ],
        menuModifierOptions: {
          itemCode: '3001',
          itemId: '3001',
          productCode: 'combo',
          name: 'Combo',
          modifierGroups: [
            {
              groupId: 'a:b',
              name: 'One',
              min: 0,
              max: 1,
              depth: 0,
              options: [option('c', 'C')],
            },
            {
              groupId: 'a',
              name: 'Two',
              min: 0,
              max: 1,
              depth: 0,
              options: [option('b:c', 'BC')],
            },
          ],
          provenance: {
            sourceFile: 'fixture',
            fixtureMode: 'public_crawl_seed',
          },
        },
      }),
      turnToolNames: ['searchMenu', 'getModifierOptions'],
    });

    expect(attachment?.widgetKind).toBe('modifierPicker');
    expect(attachment?.actions).toEqual([
      expect.objectContaining({
        id: 'customize_item:a%3Ab:c',
        payload: { itemCode: '3001', groupId: 'a:b', modifierId: 'c' },
      }),
      expect.objectContaining({
        id: 'customize_item:a:b%3Ac',
        payload: { itemCode: '3001', groupId: 'a', modifierId: 'b:c' },
      }),
    ]);
  });

  it('selects promotion media only from current promotion evidence', () => {
    const offers = [
      {
        offerId: 'lunch-2026-combo-42k',
        campaign: 'Trưa Nay Ăn Gì?',
        offerName: 'Combo 42K',
        startDate: '2026-01-02',
        endDate: '2026-12-31',
        imageUrl:
          'https://static.kfcvietnam.com.vn/TIN%20KHUYEN%20MAI%20-%20TNAG%20PHASE%203.jpg',
      },
    ];
    const attachment = selectKfcGenUiAttachment({
      state: state({
        promotionOffers: offers,
      } as unknown as Partial<AgentGraphState>),
      turnToolNames: ['searchPromotions'],
    });
    expect(attachment).toMatchObject({
      widgetKind: 'promotionGallery',
      data: { offers },
    });
  });

  it('does not expose stale promotion state without current successful tool evidence', () => {
    const attachment = selectKfcGenUiAttachment({
      state: state({
        latestUserMessage: 'Hôm nay có khuyến mãi gì?',
        promotionOffers: [
          {
            offerId: 'stale-offer',
            campaign: 'Stale campaign',
            offerName: 'Stale offer',
          },
        ],
        // Simulate a legacy in-memory/checkpoint object. Presentation must
        // ignore this retired field rather than recover semantic routing.
        intent: 'voucher',
      } as unknown as Partial<AgentGraphState>),
      turnToolNames: [],
    });

    expect(attachment).toBeUndefined();
  });

  it('keeps independent promotion evidence in a combined menu result', () => {
    const item = {
      code: '41141',
      name: 'Burger Gà Zinger',
      description: 'Burger gà',
      category: 'Burger',
      categoryId: 'test-burger',
      priceVnd: 55_000,
      originalPriceVnd: null,
      imageUrl: 'https://example.test/burger.jpg',
      available: true,
    };
    const offers = [
      {
        offerId: 'lunch-2026-combo-42k',
        campaign: 'Trưa Nay Ăn Gì?',
        offerName: 'Combo 42K',
        startDate: '2026-01-02',
        endDate: '2026-12-31',
        imageUrl:
          'https://static.kfcvietnam.com.vn/TIN%20KHUYEN%20MAI%20-%20TNAG%20PHASE%203.jpg',
      },
    ];
    const attachment = selectKfcGenUiAttachment({
      state: state({
        menuSearchResults: [item],
        promotionOffers: offers,
      } as Partial<AgentGraphState>),
      turnToolNames: ['searchMenu', 'searchPromotions'],
    });

    expect(attachment).toMatchObject({
      widgetKind: 'smartMenuPicker',
      data: {
        items: [item],
        promotions: offers,
      },
    });
  });

  it('keeps allergen evidence text-only without matching current product identity', () => {
    const attachment = selectKfcGenUiAttachment({
      state: state({
        menuSearchResults: [
          {
            code: 'stale',
            name: 'Stale burger',
            description: '',
            category: 'Burger',
            categoryId: 'test-burger',
            priceVnd: 1,
            originalPriceVnd: null,
            imageUrl:
              'https://static.kfcvietnam.com.vn/images/items/lg/HOPGU.jpg?v=LNN7PL',
            available: true,
          },
        ],
        contentEvidence: [
          {
            kind: 'allergen',
            title: 'Bảng dị ứng',
            snippet: 'Thông tin chính thức',
            sourceUrl: 'https://www.kfcvietnam.com.vn/allergen-chart',
            sourceFile: 'allergen.json',
          },
        ],
      }),
      turnToolNames: ['searchMenu', 'answerAllergenQuestion'],
    });
    expect(attachment).toMatchObject({
      widgetKind: 'allergenEvidence',
      data: { item: null },
    });
  });

  it('selects the full-menu browser only for a complete verified all-scope search collection', () => {
    const menuSearchResults = Array.from({ length: 12 }, (_, index) => ({
      code: `item_${index + 1}`,
      name: `Món ${index + 1}`,
      description: `Mô tả món ${index + 1}`,
      category: 'Combo',
      categoryId: 'test-combo',
      priceVnd: 50000 + index * 1000,
      originalPriceVnd: null,
      imageUrl: `https://example.test/item-${index + 1}.jpg`,
      available: true,
    }));
    const collection = {
      key: 'all',
      revision: 'menu-revision',
      providerRevision: 'provider-revision',
      result: {
        items: menuSearchResults,
        total: menuSearchResults.length,
        returned: menuSearchResults.length,
        complete: true,
        scope: { scope: 'all' as const },
      },
    };
    const attachment = selectKfcGenUiAttachment({
      state: state({
        menuSearchResults,
        activeMenuCollection: collection,
        activeCollectionKeys: { searchMenu: collection.key },
        verifiedCollections: {
          searchMenu: { [collection.key]: collection },
        },
      }),
      turnToolNames: ['searchMenu'],
    });

    expect(attachment?.widgetKind).toBe('fullMenuBrowser');
    expect(attachment?.title).toBe('Toàn bộ thực đơn');
    expect(attachment?.data.items).toHaveLength(12);
    expect(attachment?.data.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ categoryId: 'test-combo' }),
      ]),
    );
    expect(attachment?.data.categories).toEqual([
      {
        categoryId: 'test-combo',
        label: 'Combo',
      },
    ]);
    expect(attachment?.data.selectionLimit).toBe(5);
    expect(attachment?.data).toMatchObject({
      total: 12,
      returned: 12,
      complete: true,
      collection: {
        key: 'all',
        revision: 'menu-revision',
        providerRevision: 'provider-revision',
        scope: { scope: 'all' },
      },
    });
    expect(attachment?.authority).toMatchObject({
      schemaVersion: 'kfc-genui-v1',
      sessionId: 'session_1',
      customerId: 'customer_1',
      actionLifecycle: 'one_shot',
    });
  });

  it.each([
    {
      name: 'incomplete',
      items: [{
        code: 'partial-1',
        name: 'Partial item',
        description: 'Partial description',
        category: 'Combo',
        categoryId: 'combo',
        priceVnd: 50_000,
        originalPriceVnd: null,
        imageUrl: 'https://example.test/partial.jpg',
        available: true,
      }],
      total: 2,
      returned: 1,
      complete: false,
      expectedKind: 'smartMenuPicker',
    },
    {
      name: 'count-mismatched',
      items: [{
        code: 'mismatch-1',
        name: 'Mismatch item',
        description: 'Mismatch description',
        category: 'Combo',
        categoryId: 'combo',
        priceVnd: 50_000,
        originalPriceVnd: null,
        imageUrl: 'https://example.test/mismatch.jpg',
        available: true,
      }],
      total: 2,
      returned: 1,
      complete: true,
      expectedKind: 'smartMenuPicker',
    },
    {
      name: 'empty',
      items: [],
      total: 0,
      returned: 0,
      complete: true,
      expectedKind: undefined,
    },
  ])('does not claim the entire menu for a $name all-scope collection', ({
    items,
    total,
    returned,
    complete,
    expectedKind,
  }) => {
    const collection = {
      key: 'all',
      revision: 'menu-revision',
      providerRevision: 'provider-revision',
      result: {
        items,
        total,
        returned,
        complete,
        scope: { scope: 'all' as const },
      },
    };
    const attachment = selectKfcGenUiAttachment({
      state: state({
        menuSearchResults: items,
        activeMenuCollection: collection,
        activeCollectionKeys: { searchMenu: collection.key },
        verifiedCollections: {
          searchMenu: { [collection.key]: collection },
        },
      }),
      turnToolNames: ['searchMenu'],
    });

    expect(attachment?.widgetKind).toBe(expectedKind);
    expect(attachment?.title).not.toBe('Toàn bộ thực đơn');
  });

  it('keeps the verified filtered collection complete while showing only five choices', () => {
    const items = Array.from({ length: 12 }, (_, index) => ({
      code: `filtered-${index + 1}`,
      name: `Filtered ${index + 1}`,
      description: `Filtered description ${index + 1}`,
      category: 'Burger',
      categoryId: 'burger',
      priceVnd: 50_000 + index,
      originalPriceVnd: null,
      imageUrl: `https://example.test/filtered-${index + 1}.jpg`,
      available: true,
    }));
    const collection = {
      key: 'filtered:burger',
      revision: 'filtered-revision',
      providerRevision: 'provider-revision',
      result: {
        items,
        total: items.length,
        returned: items.length,
        complete: true,
        scope: { scope: 'filtered' as const, query: 'burger' },
      },
    };
    const attachment = selectKfcGenUiAttachment({
      state: state({
        menuSearchResults: items,
        activeMenuCollection: collection,
        activeCollectionKeys: { searchMenu: collection.key },
        verifiedCollections: {
          searchMenu: { [collection.key]: collection },
        },
      }),
      turnToolNames: ['searchMenu'],
    });

    expect(attachment?.widgetKind).toBe('smartMenuPicker');
    expect(attachment?.data.items).toEqual(items.slice(0, 5));
    expect(attachment?.data).toMatchObject({
      displayed: 5,
      total: 12,
      returned: 12,
      complete: true,
    });
  });

  it('keeps provider category identity when display labels collide', () => {
    const menuSearchResults = [
      {
        code: 'item-a',
        name: 'Item A',
        description: 'A',
        category: 'Combo',
        categoryId: 'combo-a',
        priceVnd: 50_000,
        originalPriceVnd: null,
        imageUrl: 'https://example.test/a.jpg',
        available: true,
      },
      {
        code: 'item-b',
        name: 'Item B',
        description: 'B',
        category: 'Combo',
        categoryId: 'combo-b',
        priceVnd: 60_000,
        originalPriceVnd: null,
        imageUrl: 'https://example.test/b.jpg',
        available: true,
      },
    ];
    const attachment = selectKfcGenUiAttachment({
      state: state({
        menuSearchResults,
      }),
      turnToolNames: ['searchMenu'],
    });

    expect(attachment?.data.categories).toEqual([
      { categoryId: 'combo-a', label: 'Combo' },
      { categoryId: 'combo-b', label: 'Combo' },
    ]);
  });

  it('does not synthesize recommendation quantities from party size or budget', () => {
    const menuSearchResults = Array.from({ length: 6 }, (_, index) => ({
      code: `combo_${index + 1}`,
      name: `Combo ${index + 1}`,
      description: `Combo ${index + 1}`,
      category: 'Combo',
      categoryId: 'test-combo',
      priceVnd: 100000 + index * 10000,
      originalPriceVnd: null,
      imageUrl: `https://example.test/combo-${index + 1}.jpg`,
      available: true,
    }));
    const attachment = selectKfcGenUiAttachment({
      state: state({
        latestUserMessage: 'Gợi ý combo cho 5 người, ngân sách 500k',
        menuSearchResults,
      }),
      turnToolNames: ['searchMenu'],
    });
    const items = attachment?.data.items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(5);
    expect(attachment?.data).not.toHaveProperty('partySize');
    expect(attachment?.data).not.toHaveProperty('budgetVnd');
    expect(items[0]).not.toHaveProperty('recommendedQuantity');
    expect(items[0]).not.toHaveProperty('composedTotalVnd');
    expect(items[0]).not.toHaveProperty('budgetDeltaVnd');
    expect(items[0]).not.toHaveProperty('servingCoverageVerified');
  });

  it('selects PaymentMethodPicker from verified payment-method evidence', () => {
    const methods = [
      {
        methodId: 'zalopay_wallet',
        displayName: 'Ví ZaloPay',
        category: 'digital_wallet' as const,
        supported: true,
        supportStatus: 'listed_supported' as const,
        paymentSurface: 'kfc_website_checkout' as const,
        evidenceText: 'Verified',
        sourceUrl: 'https://example.test/payment',
        sourceFile: 'payment.json',
        notes: '',
        provenance: {
          sourceFile: 'payment.json',
          sourceUrl: 'https://example.test/payment',
          fixtureMode: 'public_crawl_seed' as const,
        },
      },
    ];
    const paymentMethodCollection = {
      collectionKey: 'payment-methods:all',
      collectionRevision: 'payment-collection-revision-1',
      providerRevision: 'payment-provider-revision-1',
    };
    const attachment = selectKfcGenUiAttachment({
      state: state({
        latestUserMessage: 'KFC hỗ trợ phương thức thanh toán nào?',
        paymentMethodEvidence: methods,
        activeCollectionKeys: {
          listPaymentMethods: paymentMethodCollection.collectionKey,
        },
        verifiedCollections: {
          listPaymentMethods: {
            [paymentMethodCollection.collectionKey]: {
              key: paymentMethodCollection.collectionKey,
              revision: paymentMethodCollection.collectionRevision,
              providerRevision: paymentMethodCollection.providerRevision,
              result: {
                items: methods,
                total: methods.length,
                returned: methods.length,
                complete: true,
                scope: { scope: 'all' },
              },
            },
          },
        },
      }),
      turnToolNames: ['listPaymentMethods'],
    });
    expect(attachment?.widgetKind).toBe('paymentMethodPicker');
    expect(attachment?.data.methods).toEqual([
      {
        methodId: 'zalopay_wallet',
        displayName: 'Ví ZaloPay',
        category: 'digital_wallet',
        supported: true,
        supportStatus: 'listed_supported',
        paymentSurface: 'kfc_website_checkout',
      },
    ]);
    expect(attachment?.data.methods).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provenance: expect.anything() }),
      ]),
    );
    expect(attachment?.data.paymentMethodCollection).toEqual(
      paymentMethodCollection,
    );
  });

  it('does not reuse a payment picker when the current job is invoice collection', () => {
    const attachment = selectKfcGenUiAttachment({
      state: state({
        latestUserMessage: 'Mình cần xuất hóa đơn công ty',
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
        menuSearchResults: [
          {
            code: '41141',
            name: 'Burger Gà Zinger',
            description: 'Burger gà',
            category: 'Burger',
            categoryId: 'test-burger',
            priceVnd: 55000,
            originalPriceVnd: null,
            imageUrl: 'https://example.test/burger.jpg',
            available: true,
          },
        ],
      }),
      turnToolNames: ['searchPromotions'],
    });
    expect(attachment).toBeUndefined();
  });

  it('does not render a menu picker when delivery-status text has no menu results', () => {
    const attachment = selectKfcGenUiAttachment({
      state: state({
        latestUserMessage: 'Kiểm tra giao hàng',
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
            source: {
              fixtureMode: 'provider_runtime',
              sourceFile: 'private-provider-debug-source',
              sourceApi: 'private-provider-debug-api',
            },
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
    expect(attachment?.actions.map((action) => action.id)).toContain(
      'accept_fulfillment',
    );
    expect(attachment?.data.fulfillment).toMatchObject({
      availability: {
        ok: true,
        checkedItemIds: ['41141'],
      },
    });
    expect(attachment?.data.fulfillment).not.toHaveProperty(
      'availability.source',
    );
    expect(JSON.stringify(attachment)).not.toContain('fixtureMode');
    expect(JSON.stringify(attachment)).not.toContain(
      'private-provider-debug-source',
    );
    expect(JSON.stringify(attachment)).not.toContain(
      'private-provider-debug-api',
    );
  });

  it('does not offer fulfillment acceptance before an address and quote exist', () => {
    const attachment = selectKfcGenUiAttachment({
      state: state({
        trustedPresentation: { preferredSurface: 'fulfillment' },
      }),
      turnToolNames: ['findStores'],
    });

    expect(attachment?.widgetKind).toBe('addressFulfillmentCheck');
    expect(attachment?.actions.map((action) => action.id)).toEqual([
      'submit_address',
    ]);
    expect(attachment?.actions[0]?.label).toBe('Nhập địa chỉ giao hàng');
  });

  it('renders a saved address only from turn-local opaque-ref presentation evidence', () => {
    const privateAddress = {
      label: 'Private saved label Ω',
      line1: 'Private provider street Ω',
      district: 'Quận 7',
      city: 'Hồ Chí Minh',
    };
    const ref = {
      id: '00000000-0000-4000-8000-000000000001',
      kind: 'saved_address' as const,
    };
    const durableState = state({
      cart: {
        id: 'saved-address-candidate-cart',
        items: [
          {
            itemCode: '41141',
            name: 'Zinger Burger',
            quantity: 2,
            unitPriceVnd: 55_000,
          },
        ],
        subtotalVnd: 110_000,
        discountVnd: 0,
        deliveryFeeVnd: 0,
        totalVnd: 110_000,
        voucherCode: null,
      },
      customerContext: {
        savedAddresses: [privateAddress],
        recentOrders: [],
        favorites: [],
      },
    });

    const withoutCurrentEvidence = selectKfcGenUiAttachment({
      state: durableState,
      turnToolNames: ['getSavedAddresses'],
    });
    const withCurrentEvidence = selectKfcGenUiAttachment({
      state: durableState,
      turnToolNames: [],
      savedAddressPresentation: {
        address: privateAddress,
        ref,
      },
    });

    expect(withoutCurrentEvidence).toMatchObject({
      widgetKind: 'addressFulfillmentCheck',
      data: {
        address: null,
        addressStatus: 'missing',
      },
      actions: [
        {
          id: 'submit_address',
        },
      ],
    });
    expect(withCurrentEvidence).toMatchObject({
      widgetKind: 'addressFulfillmentCheck',
      data: {
        address: privateAddress,
        addressStatus: 'candidate',
        cart: {
          id: 'saved-address-candidate-cart',
          items: [
            expect.objectContaining({
              itemCode: '41141',
              quantity: 2,
            }),
          ],
        },
      },
      actions: expect.arrayContaining([
        expect.objectContaining({
          id: 'accept_fulfillment',
          value: ref.id,
        }),
      ]),
    });
    if (!withCurrentEvidence) {
      throw new Error('saved_address_candidate_missing');
    }
    const persisted = kfcGenUiAttachmentForPersistence(withCurrentEvidence);
    expect(persisted.data).toMatchObject({
      addressStatus: 'candidate',
      cart: {
        id: 'saved-address-candidate-cart',
        items: [
          expect.objectContaining({
            itemCode: '41141',
            quantity: 2,
          }),
        ],
      },
    });
    expect(persisted.data).not.toHaveProperty('address');
    expect(JSON.stringify(persisted)).toContain(ref.id);
    expect(JSON.stringify(persisted)).not.toContain(privateAddress.line1);
  });

  it('makes a turn-local saved-address candidate dominate stale address and fulfillment state', () => {
    const staleAddress = {
      label: 'Stale explicit address',
      line1: 'Stale explicit street',
      district: 'Old District',
      city: 'Hồ Chí Minh',
    };
    const candidateAddress = {
      label: 'Current saved address',
      line1: 'Current private saved street',
      district: 'New District',
      city: 'Hồ Chí Minh',
    };
    const ref = {
      id: '00000000-0000-4000-8000-000000000002',
      kind: 'saved_address' as const,
    };
    const attachment = selectKfcGenUiAttachment({
      state: state({
        cart: {
          id: 'saved-address-stale-state-cart',
          items: [
            {
              itemCode: '41141',
              name: 'Zinger Burger',
              quantity: 1,
              unitPriceVnd: 55_000,
            },
          ],
          subtotalVnd: 55_000,
          discountVnd: 0,
          deliveryFeeVnd: 18_000,
          totalVnd: 73_000,
          voucherCode: null,
        },
        address: staleAddress,
        fulfillment: {
          method: 'delivery',
          disposition: 'delivery',
          storeId: 'stale-fulfillment-store',
          storeName: 'Stale Fulfillment Store',
          feeVnd: 18_000,
          etaMinutes: 30,
          resolvedAddress: staleAddress,
          availability: {
            ok: true,
            checkedItemIds: ['41141'],
            unavailableItemIds: [],
            blockedTimeslotItemIds: [],
            source: {
              fixtureMode: 'provider_runtime',
              sourceFile: 'stale-fulfillment-source',
              sourceApi: 'stale-fulfillment-api',
            },
          },
        },
        trustedPresentation: {
          preferredSurface: 'fulfillment',
          fulfillmentAccepted: true,
        },
      }),
      turnToolNames: [],
      savedAddressPresentation: {
        address: candidateAddress,
        ref,
      },
    });

    expect(attachment).toMatchObject({
      widgetKind: 'addressFulfillmentCheck',
      data: {
        address: candidateAddress,
        addressStatus: 'candidate',
        fulfillment: null,
      },
      actions: expect.arrayContaining([
        expect.objectContaining({
          id: 'accept_fulfillment',
          value: ref.id,
        }),
      ]),
    });
    const serialized = JSON.stringify(attachment);
    expect(serialized).not.toContain(staleAddress.line1);
    expect(serialized).not.toContain('stale-fulfillment-store');
    expect(serialized).not.toContain('Stale Fulfillment Store');
    if (!attachment) {
      throw new Error('saved_address_candidate_missing');
    }
    const persisted = kfcGenUiAttachmentForPersistence(attachment);
    expect(persisted.data).not.toHaveProperty('address');
    expect(persisted.data).toMatchObject({
      addressStatus: 'candidate',
      fulfillment: null,
    });
    expect(JSON.stringify(persisted)).toContain(ref.id);
    expect(JSON.stringify(persisted)).not.toContain(candidateAddress.line1);
  });

  it('never persists a confirmed address after turn-local provenance is gone', () => {
    const confirmedAddress = {
      label: 'Private saved label Ω',
      line1: 'Private provider street Ω',
      district: 'Quận 7',
      city: 'Hồ Chí Minh',
    };
    const attachment = selectKfcGenUiAttachment({
      state: state({
        address: confirmedAddress,
        trustedPresentation: { preferredSurface: 'fulfillment' },
      }),
      turnToolNames: [],
    });

    expect(attachment).toMatchObject({
      widgetKind: 'addressFulfillmentCheck',
      data: {
        address: confirmedAddress,
        addressStatus: 'confirmed',
      },
    });
    if (!attachment) {
      throw new Error('confirmed_address_presentation_missing');
    }
    const persisted = kfcGenUiAttachmentForPersistence(attachment);
    expect(persisted.data).not.toHaveProperty('address');
    expect(JSON.stringify(persisted)).not.toContain(confirmedAddress.line1);
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
            source: {
              fixtureMode: 'provider_runtime',
              sourceFile: 'private-review-debug-source',
              sourceApi: 'private-review-debug-api',
            },
          },
        },
      }),
      turnToolNames: ['previewCart'],
    });

    expect(attachment?.widgetKind).toBe('orderReviewConfirm');
    expect(attachment?.actions.map((action) => action.id)).toContain(
      'confirm_order',
    );
    expect(
      attachment?.actions.find((action) => action.id === 'confirm_order'),
    ).toMatchObject({
      label: 'Đặt đơn 73.000đ',
      intent: 'primary',
    });
    expect(attachment?.data.fulfillment).not.toHaveProperty(
      'availability.source',
    );
    expect(JSON.stringify(attachment)).not.toContain('fixtureMode');
    expect(JSON.stringify(attachment)).not.toContain(
      'private-review-debug-source',
    );
    expect(JSON.stringify(attachment)).not.toContain(
      'private-review-debug-api',
    );
  });

  it('omits track order from payment status actions', () => {
    const attachment = selectKfcGenUiAttachment({
      state: state({
        paymentAttempt: {
          method: 'momo_wallet',
          status: 'pending',
          paymentUrl: 'https://pay.mock/momo/KFC-MOCK-1001',
        },
      }),
      turnToolNames: ['checkPaymentStatus'],
    });

    expect(attachment?.widgetKind).toBe('paymentOrderStatus');
    expect(attachment?.actions.map((action) => action.id)).not.toContain(
      'track_order',
    );
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
          orderId: 'KFC-MOCK-1001',
          method: 'momo_wallet',
          status: 'paid',
          paymentUrl: 'https://pay.mock/momo/KFC-MOCK-1001',
        },
        fulfillment: {
          method: 'delivery',
          disposition: 'delivery',
          storeId: 'store_1',
          storeName: 'KFC Quận 7',
          feeVnd: 18_000,
          etaMinutes: 25,
          availability: {
            ok: true,
            checkedItemIds: ['41141'],
            unavailableItemIds: [],
            blockedTimeslotItemIds: [],
            source: {
              fixtureMode: 'provider_runtime',
              sourceFile: 'private-tracking-debug-source',
              sourceApi: 'private-tracking-debug-api',
            },
          },
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
    expect(attachment?.data.fulfillment).not.toHaveProperty(
      'availability.source',
    );
    expect(JSON.stringify(attachment)).not.toContain('fixtureMode');
    expect(JSON.stringify(attachment)).not.toContain(
      'private-tracking-debug-source',
    );
    expect(JSON.stringify(attachment)).not.toContain(
      'private-tracking-debug-api',
    );
  });

  it('uses a current order-status lookup as the fresh payment-status source', () => {
    const attachment = selectKfcGenUiAttachment({
      state: state({
        order: orderWithPaymentStatus('paid'),
        paymentAttempt: {
          orderId: 'ORDER-STATUS-1',
          method: 'zalopay_wallet',
          status: 'failed',
        },
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
        paymentAttempt: {
          orderId: 'ORDER-STATUS-1',
          method: 'zalopay_wallet',
          status: 'failed',
        },
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

  it('presents a failed current check without rewriting the durable pending payment attempt', () => {
    const durableOrder = orderWithPaymentStatus('pending');
    const durablePaymentAttempt = {
      orderId: durableOrder.id,
      method: 'zalopay_wallet',
      status: 'pending' as const,
      paymentUrl: `https://pay.mock/zalopay/${durableOrder.id}`,
    };
    const attachment = selectKfcGenUiAttachment({
      state: state({
        order: durableOrder,
        paymentAttempt: durablePaymentAttempt,
      }),
      turnToolNames: [],
      paymentStatusPresentation: {
        executionOutcome: 'error',
        errorCode: 'payment_failed',
      },
    });

    expect(attachment).toMatchObject({
      widgetKind: 'paymentOrderStatus',
      data: {
        paymentAttempt: {
          orderId: durablePaymentAttempt.orderId,
          method: 'zalopay_wallet',
          status: 'pending',
          paymentUrl: durablePaymentAttempt.paymentUrl,
        },
        paymentStatusEvidence: {
          resolution: 'current_tool',
          statuses: {
            order: 'pending',
            paymentAttempt: 'pending',
          },
          currentCheck: {
            executionOutcome: 'error',
            errorCode: 'payment_failed',
          },
        },
      },
    });
    expect(attachment?.data.paymentStatusEvidence).not.toHaveProperty(
      'selectedStatus',
    );
    expect(attachment?.data.paymentStatusEvidence).not.toHaveProperty(
      'selectedSource',
    );
    expect(attachment?.actions.map(({ id }) => id)).toEqual([
      'change_payment_method',
    ]);
    expect(durablePaymentAttempt.status).toBe('pending');
  });

  it('renders but does not persist a current authenticated payment-status order', () => {
    const recentOrder = {
      ...orderWithPaymentStatus('pending'),
      cart: {
        ...orderWithPaymentStatus('pending').cart,
        id: 'private-provider-cart-id',
        items: [
          {
            itemCode: 'private-provider-item-code',
            name: 'Private provider product name',
            quantity: 1,
            unitPriceVnd: 117_000,
          },
        ],
        subtotalVnd: 117_000,
        totalVnd: 117_000,
      },
      assignedStoreId: 'private-provider-store-id',
      commerceOrderId: 'private-commerce-order-id',
      omsOrderId: 'private-oms-order-id',
      commerceEnvironment: 'production' as const,
      commerceProviderProvenance: {
        oms: {
          implementation: 'private-provider-implementation',
          source: 'private-provider-source',
        },
      },
    };
    const attachment = selectKfcGenUiAttachment({
      state: state({
        paymentAttempt: {
          method: 'zalopay_wallet',
          status: 'pending',
        },
      }),
      turnToolNames: ['getRecentOrder', 'checkPaymentStatus'],
      recentOrderPresentation: recentOrder,
      paymentStatusPresentation: {
        executionOutcome: 'success',
        status: 'pending',
      },
    });

    expect(attachment).toMatchObject({
      widgetKind: 'paymentOrderStatus',
      data: {
        order: {
          id: recentOrder.id,
          status: recentOrder.status,
          paymentStatus: recentOrder.paymentStatus,
          amountVnd: recentOrder.cart.totalVnd,
        },
        paymentAttempt: {
          status: 'pending',
        },
      },
    });
    if (!attachment) {
      throw new Error('recent_order_payment_presentation_missing');
    }
    expect(attachment.actions.map(({ id }) => id)).not.toContain(
      'open_payment',
    );
    expect(attachment.actions.map(({ id }) => id)).not.toContain('track_order');
    expect(attachment.actions.map(({ id }) => id)).toEqual([
      'change_payment_method',
    ]);
    expect(attachment.data.order).toEqual({
      id: recentOrder.id,
      status: recentOrder.status,
      paymentStatus: recentOrder.paymentStatus,
      amountVnd: recentOrder.cart.totalVnd,
    });
    for (const privateValue of [
      recentOrder.cart.id,
      recentOrder.cart.items[0]!.itemCode,
      recentOrder.cart.items[0]!.name,
      recentOrder.assignedStoreId,
      recentOrder.commerceOrderId,
      recentOrder.omsOrderId,
      recentOrder.commerceProviderProvenance.oms.implementation,
      recentOrder.commerceProviderProvenance.oms.source,
    ]) {
      expect(JSON.stringify(attachment)).not.toContain(privateValue);
    }
    const persisted = kfcGenUiAttachmentForPersistence(attachment, {
      currentTurnPrivateOrder: true,
    });
    expect(persisted.data).not.toHaveProperty('order');
    expect(persisted.data.paymentAttempt).toMatchObject({
      status: 'pending',
    });
    expect(JSON.stringify(persisted)).not.toContain(recentOrder.id);
  });

  it('does not render a transient order without an issued payment-status presentation', () => {
    const recentOrder = orderWithPaymentStatus('pending');
    const attachment = selectKfcGenUiAttachment({
      state: state({
        paymentAttempt: {
          status: 'pending',
        },
      }),
      turnToolNames: ['getRecentOrder', 'checkPaymentStatus'],
      recentOrderPresentation: recentOrder,
    });

    expect(attachment).toMatchObject({
      widgetKind: 'paymentOrderStatus',
      data: {
        order: null,
        paymentAttempt: null,
      },
    });
    expect(JSON.stringify(attachment)).not.toContain(recentOrder.id);
  });

  it('does not pair a transient current order with an unrelated durable payment link', () => {
    const staleOrderId = 'stale-durable-order';
    const recentOrder = {
      ...orderWithPaymentStatus('pending'),
      id: 'current-authenticated-order',
    };
    const attachment = selectKfcGenUiAttachment({
      state: state({
        paymentAttempt: {
          orderId: staleOrderId,
          method: 'zalopay_wallet',
          status: 'pending',
          paymentUrl: `https://pay.mock/zalopay/${staleOrderId}`,
        },
      }),
      turnToolNames: ['getRecentOrder', 'checkPaymentStatus'],
      recentOrderPresentation: recentOrder,
      paymentStatusPresentation: {
        executionOutcome: 'success',
        status: 'pending',
      },
    });

    expect(attachment).toMatchObject({
      widgetKind: 'paymentOrderStatus',
      data: {
        order: { id: recentOrder.id },
        paymentAttempt: { status: 'pending' },
      },
    });
    expect(attachment?.data.paymentAttempt).not.toHaveProperty('method');
    expect(attachment?.data.paymentAttempt).not.toHaveProperty('paymentUrl');
    expect(attachment?.actions.map(({ id }) => id)).toEqual([
      'change_payment_method',
    ]);
    expect(JSON.stringify(attachment)).not.toContain(staleOrderId);

    const nextTurnAttachment = selectKfcGenUiAttachment({
      state: state({
        paymentAttempt: {
          orderId: staleOrderId,
          method: 'zalopay_wallet',
          status: 'pending',
          paymentUrl: `https://pay.mock/zalopay/${staleOrderId}`,
        },
      }),
      turnToolNames: [],
    });
    expect(nextTurnAttachment).toBeUndefined();
  });

  it('fails closed for a payment URL bound to a different durable order', () => {
    const currentOrder = orderWithPaymentStatus('pending');
    const staleOrderId = 'different-durable-order';
    const attachment = selectKfcGenUiAttachment({
      state: state({
        order: currentOrder,
        paymentAttempt: {
          orderId: staleOrderId,
          method: 'zalopay_wallet',
          status: 'pending',
          paymentUrl: `https://pay.mock/zalopay/${staleOrderId}`,
        },
      }),
      turnToolNames: [],
    });

    expect(attachment?.actions.map(({ id }) => id)).toEqual([
      'change_payment_method',
    ]);
    expect(attachment?.data.paymentAttempt).toBeNull();
    expect(JSON.stringify(attachment)).not.toContain(staleOrderId);
  });

  it('exposes payment continuation only for the exact bound durable order', () => {
    const currentOrder = orderWithPaymentStatus('pending');
    const paymentUrl = `https://pay.mock/zalopay/${currentOrder.id}`;
    const attachment = selectKfcGenUiAttachment({
      state: state({
        order: currentOrder,
        paymentAttempt: {
          orderId: currentOrder.id,
          method: 'zalopay_wallet',
          status: 'pending',
          paymentUrl,
        },
      }),
      turnToolNames: [],
    });

    expect(attachment?.data.paymentAttempt).toMatchObject({
      orderId: currentOrder.id,
      paymentUrl,
      status: 'pending',
    });
    expect(attachment?.actions.map(({ id }) => id)).toEqual([
      'open_payment',
      'change_payment_method',
    ]);
  });

  it('marks matching stored payment statuses as consistent evidence', () => {
    const attachment = selectKfcGenUiAttachment({
      state: state({
        order: orderWithPaymentStatus('paid'),
        paymentAttempt: {
          orderId: 'ORDER-STATUS-1',
          method: 'zalopay_wallet',
          status: 'paid',
        },
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
        paymentAttempt: {
          orderId: 'ORDER-STATUS-1',
          method: 'zalopay_wallet',
          status: 'failed',
        },
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
        trustedPresentation: { preferredSurface: 'cart' },
        customerContext: {
          savedAddresses: [
            {
              label: 'Nhà',
              line1: '123 Nguyễn Trãi',
              district: 'Quận 5',
              city: 'Hồ Chí Minh',
            },
          ],
          recentOrders: [],
          favorites: [],
        },
        cart: {
          id: 'cart_1',
          items: [
            {
              itemCode: '41141',
              name: 'Burger Gà Zinger',
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
    expect(attachment?.data.cart).toEqual(
      expect.objectContaining({ id: 'cart_1' }),
    );
  });

  it('keeps submitted order history behind a structurally newer cart', () => {
    const priorOrder = orderWithPaymentStatus('pending');
    const activeCart = {
      ...priorOrder.cart,
      items: [
        {
          itemCode: 'new-checkout-item',
          name: 'New checkout item',
          quantity: 1,
          unitPriceVnd: 55_000,
        },
      ],
      subtotalVnd: 55_000,
      totalVnd: 55_000,
    };
    const checkoutState = state({
      cart: activeCart,
      order: priorOrder,
      paymentAttempt: {
        method: 'zalopay_wallet',
        status: 'pending',
      },
      trustedPresentation: { preferredSurface: 'cart' },
    });

    const cartAttachment = selectKfcGenUiAttachment({
      state: checkoutState,
      turnToolNames: ['updateCart'],
    });
    const refreshedOrderAttachment = selectKfcGenUiAttachment({
      state: checkoutState,
      turnToolNames: ['getOrderStatus'],
    });

    expect(cartAttachment?.widgetKind).toBe('cartBuilder');
    expect(cartAttachment?.data.cart).toEqual(activeCart);
    expect(refreshedOrderAttachment?.widgetKind).toBe('paymentOrderStatus');
    expect(refreshedOrderAttachment?.data.order).toMatchObject({
      id: priorOrder.id,
    });
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
            categoryId: '20000',
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
