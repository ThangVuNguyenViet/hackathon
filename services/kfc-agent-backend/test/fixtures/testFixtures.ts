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
    menuModifiers: [],
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
    promotions: [],
    promotionVoucherOffers: [],
    contentPages: [],
  };
  return { ...fixtures, ...overrides };
}
