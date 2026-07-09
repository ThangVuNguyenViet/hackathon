import { describe, expect, it } from 'vitest';
import type { GeneratedFixtures, GeneratedPromotionVoucherOffer, GeneratedStoreAvailability } from '../../src/fixtures/schema.js';
import { loadGeneratedFixtures } from '../../src/fixtures/loadFixtures.js';
import { OrderingDataService } from '../../src/ordering/orderingDataService.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';

const FIXED_CURRENT_DATE = '2026-07-08';

function createOffer(overrides: Partial<GeneratedPromotionVoucherOffer> = {}): GeneratedPromotionVoucherOffer {
  return {
    offerId: 'offer-default',
    campaign: 'Lunch campaign',
    campaignType: 'promotion',
    offerType: 'voucher',
    offerName: 'Bữa trưa 42K',
    discountPercent: '',
    discountAmountVnd: 30000,
    priceVnd: '',
    minimumOrderVnd: '',
    maximumDiscountVnd: '',
    giftQuantity: '',
    partnerBrand: '',
    appliesTo: 'Website / app',
    channel: 'Website / app',
    startDate: '2026-07-01',
    endDate: '2026-07-31',
    actualCodeExposed: false,
    publicCode: '',
    requiresLogin: false,
    requiresPartnerApi: false,
    redemptionSurface: 'public web',
    evidenceText: 'Voucher KFC giảm 30.000đ cho đơn hàng từ 120.000đ.',
    sourceUrl: 'https://www.kfcvietnam.com.vn/promo',
    sourceFile: 'fixtures/generated/promotion-voucher-offers.json',
    notes: 'public crawl seed',
    ...overrides,
  };
}

function createService(overrides: Partial<GeneratedFixtures> = {}) {
  return new OrderingDataService(createTestFixtures(overrides), { currentDate: FIXED_CURRENT_DATE });
}

async function createGeneratedFixtureService() {
  return new OrderingDataService(await loadGeneratedFixtures(process.cwd()), { currentDate: FIXED_CURRENT_DATE });
}

describe('OrderingDataService', () => {
  it('searches menu and returns provenance-backed Vietnamese items', async () => {
    const data = await createGeneratedFixtureService();
    const results = data.searchMenu('Combo Hợp Gu 99K');
    expect(results[0]).toMatchObject({
      code: '20751',
      name: 'Combo Hợp Gu 99K',
      provenance: expect.objectContaining({ fixtureMode: 'public_crawl_seed' }),
    });
  });

  it('does not truncate broad menu search results', async () => {
    const data = await createGeneratedFixtureService();
    const results = data.searchMenu('combo');
    expect(results.length).toBeGreaterThan(10);
    expect(results.length).toBe(31);
  });

  it('returns fixture-backed menu data for AI-normalized broad menu discovery', async () => {
    const data = await createGeneratedFixtureService();

    expect(data.searchMenu('').length).toBe(120);
    expect(data.searchMenu('Món Mới').map((item) => item.category)).toEqual(
      expect.arrayContaining(['Món Mới']),
    );
  });

  it('does not truncate add-on recommendations', async () => {
    const fixtures = await loadGeneratedFixtures(process.cwd());
    const data = await createGeneratedFixtureService();
    const results = data.recommendAddOns();
    expect(results.length).toBe(fixtures.menuItems.filter((item) => item.available).length);
  });

  it('derives add-on recommendations from fixture menu data instead of hardcoded categories', () => {
    const fixtures = createTestFixtures();
    const firstItem = fixtures.menuItems[0];
    const data = createService({
      menuItems: firstItem
        ? [
            {
              ...firstItem,
              code: 'DYNAMIC-ADDON',
              itemId: 'dynamic-addon',
              category: 'Fixture Dynamic Category',
              name: 'Fixture Added Side',
              available: true,
            },
          ]
        : [],
    });

    expect(data.recommendAddOns().map((item) => item.code)).toEqual(['DYNAMIC-ADDON']);
  });

  it('does not truncate store search results', async () => {
    const data = await createGeneratedFixtureService();
    const stores = data.searchStores({});
    expect(stores.length).toBeGreaterThan(10);
    expect(stores.length).toBe(265);
  });

  it('returns fixture-backed stores for AI-normalized broad store discovery', async () => {
    const data = await createGeneratedFixtureService();

    expect(data.searchStores({ query: '' }).length).toBe(265);
  });

  it('returns modifier tree for customizable products', async () => {
    const data = await createGeneratedFixtureService();
    const tree = data.getModifierTree('20751');
    expect(tree?.modifierGroups.length).toBeGreaterThan(0);
    expect(JSON.stringify(tree)).toContain('Burger Tôm');
  });

  it('searches stores and checks store availability by disposition', async () => {
    const data = await createGeneratedFixtureService();
    const stores = data.searchStores({ city: 'ĐỒNG NAI', query: 'Biên Hòa' });
    expect(stores[0]?.storeId).toMatch(/^KFCVN/);

    const availability = data.checkItemsAvailable({
      storeId: 'KFCVN0002',
      disposition: 'pickup',
      itemIds: ['20751'],
    });
    expect(availability.checkedItemIds).toEqual(['20751']);
    expect(availability.source.sourceFile).toContain('store-availability');
  });

  it('treats missing store availability as unavailable with generated-source provenance', () => {
    const data = createService({ storeAvailability: [] });
    const availability = data.checkItemsAvailable({
      storeId: 'KFCVN0002',
      disposition: 'pickup',
      itemIds: ['20751'],
    });

    expect(availability).toMatchObject({
      ok: false,
      checkedItemIds: ['20751'],
      unavailableItemIds: ['20751'],
      blockedTimeslotItemIds: [],
      source: expect.objectContaining({
        fixtureMode: 'public_crawl_seed',
        sourceFile: 'fixtures/generated/store-availability.json',
      }),
    });
    expect(availability.source.sourceApi).toContain('/KFCVN0002/');
  });

  it('treats missing disposition availability as unavailable using the availability provenance', () => {
    const brokenAvailability = {
      ...createTestFixtures().storeAvailability[0],
      pickup: undefined,
    } as unknown as GeneratedStoreAvailability;
    const data = createService({ storeAvailability: [brokenAvailability] });
    const availability = data.checkItemsAvailable({
      storeId: 'KFCVN0002',
      disposition: 'pickup',
      itemIds: ['20751'],
    });

    expect(availability).toMatchObject({
      ok: false,
      unavailableItemIds: ['20751'],
      source: expect.objectContaining({
        sourceFile:
          'ai-talent-tracks/fnb/data/kfcvietnam-ordering-crawl/exhaustive/kfcvietnam-api-store-availability-by-store-vi.raw.json',
      }),
    });
  });

  it('returns no stores for a no-match search instead of falling back to arbitrary stores', () => {
    const data = createService();
    expect(data.searchStores({ query: 'completely unknown district 12345' })).toEqual([]);
  });

  it('filters promotion search by active date, channel, and subtotal', () => {
    const data = createService({
      promotionVoucherOffers: [
        createOffer({ offerId: 'active-delivery', channel: 'Website / app', minimumOrderVnd: 120000, offerName: 'Lunch delivery 42K' }),
        createOffer({ offerId: 'pickup-only', channel: 'Nhà hàng', minimumOrderVnd: '', offerName: 'Lunch in-store 42K' }),
        createOffer({ offerId: 'expired-delivery', channel: 'Website / app', endDate: '2026-07-01', offerName: 'Lunch expired 42K' }),
      ],
    });

    expect(
      data.searchPromotionOffers({
        query: 'lunch 42k',
        channel: 'website',
        subtotalVnd: 150000,
      }).map((offer) => offer.offerId),
    ).toEqual(['active-delivery']);
    expect(data.searchPromotionOffers({ query: 'expired 42k' })).toEqual([]);
    expect(data.searchPromotionOffers({ query: 'lunch 42k', channel: 'website', subtotalVnd: 50000 })).toEqual([]);
  });

  it('returns active fixture-backed promotions for AI-normalized broad promotion discovery', async () => {
    const data = await createGeneratedFixtureService();

    expect(data.searchPromotionOffers({ query: '' }).map((offer) => offer.offerId)).toEqual([
      'lunch-2026-combo-42k',
      'lunch-2026-combo-44k',
      'lunch-2026-combo-49k',
      'big-order-2026-july-tier-1m',
      'big-order-2026-july-tier-2p5m',
      'big-order-2026-july-tier-5m',
      'big-order-voucher-vietgoal-free-session',
      'big-order-voucher-greensm-20pct-max-50k',
      'big-order-voucher-shopee-vip-3-months',
      'big-order-voucher-dong-luc-300k-min-1m',
    ]);
  });

  it('returns not_found for unknown voucher text instead of implying a public offer', () => {
    const data = createService({
      promotionVoucherOffers: [createOffer()],
    });

    expect(
      data.validateVoucherInput({
        inputCodeOrText: 'random-unmatched-voucher',
        subtotalVnd: 250000,
      }),
    ).toMatchObject({
      ok: false,
      reason: 'not_found',
      publicCode: '',
      source: {
        fixtureMode: 'public_crawl_seed',
        sourceFile: 'fixtures/generated/promotion-voucher-offers.json',
      },
    });
  });

  it('returns public_code_not_exposed for a matched active public offer without a reusable code', () => {
    const data = createService({
      promotionVoucherOffers: [createOffer({ offerName: 'Big order lunch 42K', evidenceText: 'Big order lunch 42K without exposed code.' })],
    });

    expect(
      data.validateVoucherInput({
        inputCodeOrText: 'big order lunch 42k',
        subtotalVnd: 250000,
      }),
    ).toMatchObject({
      ok: false,
      reason: 'public_code_not_exposed',
      publicCode: '',
      source: expect.objectContaining({
        sourceFile: 'fixtures/generated/promotion-voucher-offers.json',
      }),
    });
  });

  it('returns expired when a matched voucher code or offer is no longer valid', () => {
    const data = createService({
      promotionVoucherOffers: [
        createOffer({
          offerId: 'expired-public-code',
          publicCode: 'HELLO30',
          actualCodeExposed: true,
          endDate: '2026-07-01',
          offerName: 'Voucher HELLO30',
        }),
        createOffer({
          offerId: 'expired-offer-text',
          actualCodeExposed: false,
          publicCode: '',
          endDate: '2026-07-01',
          offerName: 'Voucher KFC giảm 30.000đ',
        }),
      ],
    });

    expect(
      data.validateVoucherInput({
        inputCodeOrText: 'HELLO30',
        subtotalVnd: 250000,
      }).reason,
    ).toBe('expired');
    expect(
      data.validateVoucherInput({
        inputCodeOrText: 'voucher kfc giảm 30.000đ',
        subtotalVnd: 250000,
      }).reason,
    ).toBe('expired');
  });

  it('returns minimum_not_met when a matched offer has a subtotal requirement', () => {
    const data = createService({
      promotionVoucherOffers: [
        createOffer({
          offerId: 'minimum-order-offer',
          minimumOrderVnd: 120000,
          offerName: 'Voucher KFC giảm 30.000đ',
        }),
      ],
    });

    expect(
      data.validateVoucherInput({
        inputCodeOrText: 'voucher kfc giảm 30.000đ',
        subtotalVnd: 100000,
      }).reason,
    ).toBe('minimum_not_met');
  });

  it('does not surface expired real-fixture promotions as active search results', async () => {
    const data = await createGeneratedFixtureService();
    expect(data.searchPromotionOffers({ query: 'voucher KFC giảm 30.000' })).toEqual([]);
  });

  it('loads authenticated membership rewards, wallet, profile, and tool definitions', async () => {
    const data = await createGeneratedFixtureService();

    expect(data.getMembershipProfile()).toMatchObject({
      tier: 'MEMBER',
      points: 0,
      redactedFields: expect.arrayContaining(['name', 'phone', 'dob']),
    });
    expect(data.listMembershipRewards('pepsi')[0]).toMatchObject({
      rewardId: 'reward-free-pepsi-m',
      minimumOrderVnd: 129000,
    });
    expect(data.listMembershipWallet('active').map((voucher) => voucher.voucherId)).toEqual([
      'wallet-500k-any-bill',
      'wallet-new-member-25k',
    ]);
    expect(data.getMembershipPointHistory(30)?.transactions).toEqual([]);
    expect(data.listMembershipTools('voucher_acquisition')[0]).toMatchObject({
      toolName: 'acquireVoucher',
      endpointPath: '/users/acquire-voucher',
      requiresUserConfirmation: true,
    });
  });

  it('returns fixture-backed membership rewards for AI-normalized broad reward discovery', async () => {
    const data = await createGeneratedFixtureService();

    expect(data.listMembershipRewards('').map((reward) => reward.rewardId)).toEqual([
      'reward-discount-10k',
      'reward-free-pepsi-m',
      'reward-free-chocolate-cone',
    ]);
  });

  it('previews membership side-effect actions without completing them until confirmed', () => {
    const data = createService();

    expect(
      data.acquireMembershipVoucher({
        rewardId: 'reward-discount-10k',
        confirmed: false,
      }),
    ).toMatchObject({
      status: 'previewed',
      requiresUserConfirmation: true,
      targetId: 'reward-discount-10k',
    });
    expect(
      data.redeemMembershipReward({
        voucherId: 'wallet-new-member-25k',
        channel: 'kiosk',
        confirmed: true,
      }),
    ).toMatchObject({
      status: 'completed',
      requiresUserConfirmation: false,
      targetId: 'wallet-new-member-25k',
    });
  });

  it('returns allergen evidence only for matched content and no fallback evidence for misses', async () => {
    const generated = await createGeneratedFixtureService();
    const evidence = generated.getAllergenEvidence('bắt đầu');
    expect(evidence.length).toBeGreaterThan(0);
    expect(evidence[0]?.kind).toBe('allergen');
    expect(evidence[0]?.sourceUrl).toContain('allergen-chart');

    const data = createService({
      contentPages: [
        {
          id: 'allergen/allergen-chart',
          kind: 'allergen',
          title: 'Bảng dị ứng',
          sourceUrl: 'https://www.kfcvietnam.com.vn/allergen-chart',
          statusCode: 200,
          markdown: 'Contains soy and milk.',
          links: [],
          provenance: {
            sourceFile: 'fixtures/generated/content-pages.json',
            fixtureMode: 'public_crawl_seed',
          },
        },
      ],
    });

    expect(data.getAllergenEvidence('unmatched allergen query')).toEqual([]);
  });

  it('returns fixture-backed content pages for AI-normalized broad all-content discovery', async () => {
    const data = await createGeneratedFixtureService();

    expect(data.searchContent('all', '').map((entry) => entry.kind)).toEqual([
      'news',
      'allergen',
    ]);
  });

  it('returns fixture-backed allergen evidence for AI-normalized broad allergen discovery', async () => {
    const data = await createGeneratedFixtureService();

    expect(data.getAllergenEvidence('').map((entry) => entry.kind)).toEqual(['allergen']);
  });
});
