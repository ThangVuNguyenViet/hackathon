import type { GeneratedFixtures } from '../../src/fixtures/schema.js';

export function createTestFixtures(overrides: Partial<GeneratedFixtures> = {}): GeneratedFixtures {
  const fixtures: GeneratedFixtures = {
    menuItems: [
      {
        code: '20751',
        itemId: '20751',
        posItemId: '20751',
        productCode: 'HOPGU',
        category: 'Ưu Đãi',
        categoryId: '20000',
        categoryUrl: '/order/delivery/hot-deal',
        name: 'Combo Hợp Gu 99K',
        description: '3 Miếng Gà Rán + 1 Burger Tôm',
        priceVnd: 99000,
        originalPriceVnd: null,
        imageUrl: 'https://static.kfcvietnam.com.vn/images/items/lg/HOPGU.jpg?v=LNN7PL',
        available: true,
        productUrlSlug: 'hd_3c_1bu',
        builderUrl: 'https://www.kfcvietnam.com.vn/order/delivery/hot-deal/hd_3c_1bu/builder',
        isCustomize: true,
        isQuickCombo: true,
        provenance: {
          sourceFile: 'ai-talent-tracks/fnb/data/kfcvietnam-ordering-crawl/exhaustive/kfcvietnam-api-modifier-tree.json',
          sourceApi: 'https://api.kfcvietnam.com.vn/menu/kfcvn-generic-menu',
          okfConceptId: 'menu/items/20751',
          fixtureMode: 'public_crawl_seed',
        },
      },
    ],
    stores: [
      {
        storeId: 'KFCVN0002',
        storeKey: 'w3gy',
        name: 'KFC BIG C ĐỒNG NAI',
        address: 'Số 01, KP 1, P. Long Bình Tân, TP Biên Hòa, tỉnh Đồng Nai',
        city: 'ĐỒNG NAI',
        postalCode: '0',
        latitude: 10.90553,
        longitude: 106.84994,
        geoHash: 'w3gyp3mc241u',
        activeAggregators: ['GRAB', 'SHOPEE', 'LOSHIP', 'GOJEK'],
        provenance: {
          sourceFile: 'ai-talent-tracks/fnb/data/kfcvietnam-ordering-crawl/exhaustive/kfcvietnam-api-stores.csv',
          fixtureMode: 'public_crawl_seed',
        },
      },
    ],
    storeAvailability: [
      {
        storeId: 'KFCVN0002',
        storeName: 'KFC BIG C ĐỒNG NAI',
        pickup: { excludedItemIds: [], timeslotExclusions: [] },
        delivery: { excludedItemIds: [], timeslotExclusions: [] },
        provenance: {
          sourceFile: 'ai-talent-tracks/fnb/data/kfcvietnam-ordering-crawl/exhaustive/kfcvietnam-api-store-availability-by-store-vi.raw.json',
          sourceApi: 'https://api.kfcvietnam.com.vn/stores',
          fixtureMode: 'public_crawl_seed',
        },
      },
    ],
    menuModifiers: [
      {
        itemCode: '20751',
        itemId: '20751',
        productCode: 'HOPGU',
        name: 'Combo Hợp Gu 99K',
        modifierGroups: [
          {
            groupId: 'drink_choice',
            name: 'Chọn nước',
            min: 1,
            max: 1,
            depth: 0,
            options: [
              {
                modifierId: 'pepsi_zero',
                name: 'Pepsi Không Calo',
                priceDeltaVnd: 0,
                default: true,
                quantity: 1,
                posItemId: 'PEPSI_ZERO',
                imageName: 'pepsi-zero.png',
                modifierGroups: [],
              },
            ],
          },
        ],
        provenance: {
          sourceFile: 'ai-talent-tracks/fnb/data/kfcvietnam-ordering-crawl/exhaustive/kfcvietnam-api-modifier-tree.json',
          fixtureMode: 'public_crawl_seed',
        },
      },
    ],
    promotions: [],
    promotionVoucherOffers: [
      {
        offerId: 'offer_kfc50_hidden',
        campaign: 'Giảm giá đơn hàng',
        campaignType: 'voucher',
        offerType: 'amount_off',
        offerName: 'Giảm 50K cho đơn đủ điều kiện',
        discountPercent: '',
        discountAmountVnd: 50000,
        priceVnd: '',
        minimumOrderVnd: 199000,
        maximumDiscountVnd: 50000,
        giftQuantity: '',
        partnerBrand: 'KFC',
        appliesTo: 'Đơn giao hàng',
        channel: 'web',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        actualCodeExposed: false,
        publicCode: 'KFC50',
        requiresLogin: false,
        requiresPartnerApi: false,
        redemptionSurface: 'public_site',
        evidenceText: 'Ưu đãi 50K nhưng mã công khai không hiển thị trên bề mặt công cộng.',
        sourceUrl: 'https://www.kfcvietnam.com.vn/khuyen-mai',
        sourceFile: 'ai-talent-tracks/fnb/data/kfcvietnam-ordering-crawl/exhaustive/kfcvietnam-promotion-vouchers.json',
        notes: 'Public fixture keeps the offer text but not a redeemable exposed code.',
      },
    ],
    contentPages: [
      {
        id: 'allergen_cheese_policy',
        kind: 'allergen',
        title: 'Thong tin di ung pho mai',
        sourceUrl: 'https://www.kfcvietnam.com.vn/chinh-sach-di-ung',
        statusCode: 200,
        markdown: 'Pho mai va cac san pham sua co the xuat hien trong mot so mon an va sot kem pho mai.',
        links: ['https://www.kfcvietnam.com.vn/chinh-sach-di-ung'],
        provenance: {
          sourceFile: 'ai-talent-tracks/fnb/data/kfcvietnam-ordering-crawl/exhaustive/kfcvietnam-allergen-pages.json',
          fixtureMode: 'public_crawl_seed',
        },
      },
    ],
  };
  return { ...fixtures, ...overrides };
}
