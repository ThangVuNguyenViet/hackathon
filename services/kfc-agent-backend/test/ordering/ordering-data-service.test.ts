import { describe, expect, it } from 'vitest';
import { loadGeneratedFixtures } from '../../src/fixtures/loadFixtures.js';
import { OrderingDataService } from '../../src/ordering/orderingDataService.js';

describe('OrderingDataService', () => {
  async function service() {
    return new OrderingDataService(await loadGeneratedFixtures(process.cwd()));
  }

  it('searches menu and returns provenance-backed Vietnamese items', async () => {
    const data = await service();
    const results = data.searchMenu('Combo Hợp Gu 99K');
    expect(results[0]).toMatchObject({
      code: '20751',
      name: 'Combo Hợp Gu 99K',
      provenance: expect.objectContaining({ fixtureMode: 'public_crawl_seed' }),
    });
  });

  it('returns modifier tree for customizable products', async () => {
    const data = await service();
    const tree = data.getModifierTree('20751');
    expect(tree?.modifierGroups.length).toBeGreaterThan(0);
    expect(JSON.stringify(tree)).toContain('Burger Tôm');
  });

  it('searches stores and checks store availability by disposition', async () => {
    const data = await service();
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

  it('searches public promotions but does not expose reusable public codes', async () => {
    const data = await service();
    const offers = data.searchPromotionOffers({ query: 'voucher KFC giảm 30.000' });
    expect(offers.some((offer) => offer.offerId.includes('voucher'))).toBe(true);

    const validation = data.validateVoucherInput({
      inputCodeOrText: 'KFC50',
      subtotalVnd: 250000,
    });
    expect(validation.ok).toBe(false);
    expect(validation.reason).toBe('public_code_not_exposed');
    expect(validation.publicCode).toBe('');
  });

  it('returns allergen/content evidence without medical certainty', async () => {
    const data = await service();
    const evidence = data.getAllergenEvidence('gà phô mai');
    expect(evidence.length).toBeGreaterThan(0);
    expect(evidence[0]?.kind).toBe('allergen');
    expect(evidence[0]?.sourceUrl).toContain('allergen-chart');
  });
});
