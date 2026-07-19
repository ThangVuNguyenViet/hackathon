import { describe, expect, it } from 'vitest';
import { loadGeneratedFixtures } from '../../src/fixtures/loadFixtures.js';
import { OrderingDataService } from '../../src/ordering/orderingDataService.js';
import { liveScenarioFixtures } from './liveScenarioFixtures.js';

describe('live scenario fixture providers', () => {
  it('exposes scenario 03 turn-scoped inventory and fulfillment facts as mocked API data', () => {
    const config = liveScenarioFixtures('03-ton-kho-dia-chi-va-cua-hang.json');

    expect(config.mockedUpstreamApiForTurn?.(1)).toEqual({ unavailableItemCodes: ['41140'] });
    expect(config.mockedUpstreamApiForTurn?.(5)).toBeUndefined();
    expect(config.mockedUpstreamApiForTurn?.(7)).toBeUndefined();
    expect(config.mockedUpstreamApiForTurn?.(9)).toEqual({
      deliveryFeeVnd: 18_000,
      deliveryEtaMinutes: 35,
    });
  });

  it('exposes scenario 07 favorite, membership, standalone drink, and combo drink modifier as mocked API data', async () => {
    const source = await loadGeneratedFixtures(process.cwd());
    const config = liveScenarioFixtures('07-ca-nhan-hoa-va-loyalty.json');
    const fixtures = config.transformFixtures?.(source) ?? source;
    const data = new OrderingDataService(fixtures, { currentDate: '2026-07-13' });
    const context = data.getMenuPlanningContext({
      query: 'Đổi thức uống trong combo sang trà đào.',
      activeItemCodes: ['20698'],
      customerEvidenceItems: [{ itemCode: '20698', source: 'favorite' }],
      maxCandidates: 8,
    });
    const combo = context.candidates.find((candidate) => candidate.code === '20698');
    const peachTea = combo?.modifierGroups.flatMap((group) => group.options)
      .find((option) => option.name === 'Trà Đào');

    expect(fixtures.membershipProfileSnapshots[0]).toMatchObject({
      points: 120,
      provenance: { fixtureMode: 'demo_mock_seed' },
    });
    expect(fixtures.menuItems).toContainEqual(expect.objectContaining({
      code: 'MOCK-PEACH-TEA',
      name: 'Trà Đào',
    }));
    expect(combo).toMatchObject({
      code: '20698',
      activeCartItem: true,
      customerEvidenceSources: ['favorite'],
    });
    expect(peachTea).toMatchObject({
      modifierId: 'MOCK-PEACH-TEA-MODIFIER',
      priceDeltaVnd: 10000,
      selectionBundle: [{
        groupId: '3',
        modifierId: 'MOCK-PEACH-TEA-MODIFIER',
        quantity: 1,
      }],
    });
  });

  it('keeps seeded orders catalog-priced at a verified store and returns a verified failed payment', async () => {
    const paid = liveScenarioFixtures('04-sau-khi-dat-don.json')
      .mockClientOptions?.initialOrders?.[0];
    expect(paid).toMatchObject({
      assignedStoreId: 'KFCVN0257',
      cart: {
        items: [{ itemCode: '41141', quantity: 1, unitPriceVnd: 56_000 }],
        subtotalVnd: 56_000,
        deliveryFeeVnd: 18_000,
        totalVnd: 74_000,
      },
    });

    const payment = liveScenarioFixtures('08-thanh-toan-loi-va-don-bat-thuong.json')
      .mockClientOptions?.paymentStatusProvider;
    await expect(Promise.resolve(payment?.('KFC-MOCK-1001'))).resolves.toMatchObject({
      ok: true,
      value: { status: 'failed' },
    });
  });
});
