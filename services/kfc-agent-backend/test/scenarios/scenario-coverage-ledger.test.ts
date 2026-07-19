import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { loadGeneratedFixtures } from '../../src/fixtures/loadFixtures.js';
import { KFC_USE_CASE_DEFINITIONS } from '../../src/scenarios/scenarioScript.js';
import { liveScenarioCases } from './scenarioCoverageLedger.js';

const scenariosRoot = join(process.cwd(), '../../ai-talent-tracks/fnb/conversations');

it('uses JSON as the sole authored 48-turn outcome oracle', async () => {
  expect(liveScenarioCases.map(({ turnExpectations }) => turnExpectations.length))
    .toEqual([6, 7, 5, 8, 5, 6, 5, 4, 2]);
  const rows = liveScenarioCases.flatMap(({ turnExpectations }) => turnExpectations);
  expect(rows).toHaveLength(48);
  expect(new Set(rows.map(({ id }) => id)).size).toBe(48);
  const actualUseCases = [...new Set(liveScenarioCases.flatMap(({ useCases }) => useCases))]
    .filter((useCase) => useCase !== 'Filler')
    .sort();
  expect(actualUseCases).toEqual(
    Array.from({ length: 39 }, (_, index) => `UC-${String(index + 1).padStart(2, '0')}`),
  );
  for (const scenario of liveScenarioCases) {
    const turnUseCases = new Set(scenario.turnExpectations.flatMap(({ useCaseIds }) => useCaseIds));
    expect(
      scenario.useCases.filter((useCase) => !turnUseCases.has(useCase)),
      `${scenario.fileName} has top-level use cases without a turn`,
    ).toEqual([]);
    const authored = JSON.parse(
      await readFile(join(scenariosRoot, scenario.fileName), 'utf8'),
    ) as unknown;
    const serialized = JSON.stringify(authored);
    for (const banned of [
      'plannerRecords',
      'allowedTools',
      'requiredGroups',
      'toolOrder',
      'argumentConstraints',
      'allowDeterministicExecution',
      'assistantAfterUserTurnContains',
    ]) {
      expect(serialized).not.toContain(`"${banned}"`);
    }
    expect(serialized).not.toContain('"speaker":"Bot"');
  }
});

it('pins the full-menu, drink, conversion, upsize, and pickup-to-delivery outcomes to verified facts', async () => {
  const scenario02 = liveScenarioCases[1]!;
  const fullMenu = scenario02.turnExpectations[0]!;
  const drinks = scenario02.turnExpectations[1]!;
  const conversion = scenario02.turnExpectations[5]!;
  const upsize = scenario02.turnExpectations[6]!;
  expect(fullMenu.outcome.presentation.collections).toContainEqual({
    key: 'menu:all',
    scope: 'all',
    minItems: 1,
    exactVerifiedItems: true,
    requireComplete: true,
    requiredCategories: [],
    requireCategoryTabs: true,
    selectionLimit: 5,
  });
  expect(drinks.outcome.presentation.collections[0]).toMatchObject({
    key: 'menu:drinks',
    scope: 'filtered',
    maxItems: 3,
    requiredCategories: ['Thức Uống & Tráng Miệng'],
  });
  expect(drinks.outcome.effects.forbidden).toContain('cart_mutated');
  expect(conversion.outcome.state.facts).toEqual(expect.arrayContaining([
    expect.objectContaining({ path: 'cart.items.*.itemCode', value: ['20702'] }),
    expect.objectContaining({ path: 'cart.totalVnd', value: 258000 }),
  ]));
  expect(upsize.outcome.state.facts).toEqual(expect.arrayContaining([
    expect.objectContaining({
      path: 'cart.items',
      value: [expect.objectContaining({
        itemCode: '20702',
        modifiers: [
          { groupId: '4', modifierId: '41091', quantity: 1, priceDeltaVnd: 3000 },
          { groupId: '5', modifierId: '41091', quantity: 1, priceDeltaVnd: 3000 },
        ],
      })],
    }),
    expect.objectContaining({ path: 'cart.totalVnd', value: 270000 }),
  ]));

  const scenario03 = liveScenarioCases[2]!;
  expect(scenario03.turnExpectations[2]!.outcome.state.facts)
    .toContainEqual(expect.objectContaining({ path: 'fulfillment.method', value: 'pickup' }));
  expect(scenario03.turnExpectations[4]!.outcome.state.facts)
    .toContainEqual(expect.objectContaining({ path: 'fulfillment.method', value: 'delivery' }));

  const fixtures = await loadGeneratedFixtures(process.cwd());
  const items = new Map(fixtures.menuItems.map((item) => [item.code, item]));
  expect(items.get('20702')?.priceVnd).toBe(129000);
  expect(['41036', '41042', '41063', '41075'].map((code) => items.get(code)?.priceVnd))
    .toEqual([74000, 30000, 20000, 17000]);
  const combo = fixtures.menuModifiers.find(({ itemCode }) => itemCode === '20702')!;
  expect(combo.modifierGroups.filter(({ groupId }) => ['4', '5'].includes(groupId)))
    .toEqual(expect.arrayContaining([
      expect.objectContaining({ groupId: '4', options: expect.arrayContaining([
        expect.objectContaining({ modifierId: '41091', priceDeltaVnd: 3000 }),
      ]) }),
      expect.objectContaining({ groupId: '5', options: expect.arrayContaining([
        expect.objectContaining({ modifierId: '41091', priceDeltaVnd: 3000 }),
      ]) }),
  ]));
});

it('binds reviewed UC labels to the authoritative 39-use-case taxonomy', () => {
  expect(KFC_USE_CASE_DEFINITIONS).toHaveLength(39);
  expect(Object.fromEntries(KFC_USE_CASE_DEFINITIONS.map(({ id, name }) => [id, name])))
    .toMatchObject({
      'UC-04': 'User hỏi menu hoặc khuyến mãi',
      'UC-08': 'User ngoài vùng giao hàng',
      'UC-12': 'User hỏi món bán chạy hoặc món được đề xuất',
      'UC-37': 'Đơn được phân về cửa hàng gần nhất',
      'UC-38': 'Quá tải đơn hàng giờ cao điểm',
      'UC-39': 'Đơn có dấu hiệu bất thường',
    });

  const scenario02 = liveScenarioCases[1]!;
  expect(scenario02.turnExpectations[0]!.useCaseIds).toEqual(['UC-04']);
  expect(scenario02.turnExpectations[1]!.useCaseIds).toEqual(['UC-11', 'UC-12']);
  expect(scenario02.turnExpectations[4]!.useCaseIds).toEqual(['UC-01']);

  const scenario03 = liveScenarioCases[2]!;
  expect(scenario03.turnExpectations[0]!.useCaseIds).toEqual(['UC-06', 'UC-08']);
  expect(scenario03.turnExpectations[0]!.outcome.state.facts).toContainEqual(
    expect.objectContaining({
      source: 'presentation',
      path: 'fulfillment.deliverable',
      value: false,
    }),
  );
  expect(scenario03.turnExpectations[1]!.useCaseIds).toEqual(['UC-37']);
  expect(scenario03.turnExpectations[1]!.outcome.state.facts).toContainEqual(
    expect.objectContaining({ path: 'pickup.storeId', value: 'KFCVN0219' }),
  );
  expect(scenario03.turnExpectations[3]!.useCaseIds).toEqual(['UC-07']);

  const exceptionalOrder = liveScenarioCases[7]!.turnExpectations[2]!;
  expect(exceptionalOrder.useCaseIds).toEqual(['UC-38', 'UC-39']);
  expect(exceptionalOrder.outcome.effects.required).toContain('handoff_created');
});

it('pins exact modifier, note, invoice, payment-policy, and governed provenance facts', () => {
  const scenario01 = liveScenarioCases[0]!;
  expect(scenario01.turnExpectations[0]!.outcome.state.facts).toContainEqual(
    expect.objectContaining({
      path: 'cart.items',
      value: expect.arrayContaining([
        expect.objectContaining({
          itemCode: '20702',
          modifiers: [{ groupId: '60254', modifierId: '70012', quantity: 2 }],
        }),
      ]),
    }),
  );
  expect(scenario01.turnExpectations[3]!.outcome.state.facts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ path: 'paymentMethods.methodId', value: 'zalopay_wallet' }),
      expect.objectContaining({ path: 'paymentMethods.supported', value: true }),
    ]),
  );
  expect(scenario01.turnExpectations[4]!.outcome.state.facts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ path: 'orderNotes.callOnArrival', value: true }),
      expect.objectContaining({ path: 'orderNotes.ringDoorbell', value: false }),
      expect.objectContaining({ path: 'invoice.requested', value: true }),
    ]),
  );
  expect(scenario01.turnExpectations[5]!.outcome.state.facts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ path: 'invoiceRequest.companyName', value: 'Công ty ABC' }),
      expect.objectContaining({ path: 'invoiceRequest.taxCode', value: '0312345678' }),
      expect.objectContaining({ path: 'invoiceRequest.email', value: 'finance@abc.test' }),
      expect.objectContaining({ path: 'order.status', value: 'created' }),
      expect.objectContaining({ path: 'order.paymentStatus', value: 'pending' }),
      expect.objectContaining({ path: 'paymentAttempt.status', value: 'pending' }),
    ]),
  );

  expect(liveScenarioCases[6]!.turnExpectations[3]!.outcome.state.facts).toContainEqual(
    expect.objectContaining({
      path: 'cart.items',
      value: [expect.objectContaining({
        itemCode: '20698',
        modifiers: [{
          groupId: '3',
          modifierId: 'MOCK-PEACH-TEA-MODIFIER',
          quantity: 1,
          priceDeltaVnd: 10_000,
        }],
      })],
    }),
  );

  const paymentMethods = liveScenarioCases[8]!;
  expect(paymentMethods.turnExpectations[0]!.outcome.state.facts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        path: 'paymentMethods.supportedIds',
        value: [
          'cash_on_delivery',
          'atm_internet_banking',
          'visa_master_card',
          'zalopay_wallet',
        ],
      }),
      expect.objectContaining({
        path: 'paymentMethods.unsupportedIds',
        value: ['momo_wallet'],
      }),
    ]),
  );
  expect(paymentMethods.turnExpectations[1]!.outcome.state.facts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ path: 'paymentMethods.methodId', value: 'momo_wallet' }),
      expect.objectContaining({ path: 'paymentMethods.supported', value: false }),
    ]),
  );
  expect(liveScenarioCases[4]!.turnExpectations[3]!.outcome.state.facts).toContainEqual(
    expect.objectContaining({
      path: 'handoff.reasons',
      value: ['missing_item', 'wrong_item', 'late_delivery', 'angry_customer', 'human_requested'],
    }),
  );
  expect(liveScenarioCases[7]!.turnExpectations[2]!.outcome.state.facts).toContainEqual(
    expect.objectContaining({
      path: 'handoff.reasons',
      value: ['payment_failed', 'abnormal_large_order', 'human_review_required'],
    }),
  );
  for (const expectation of [
    scenario01.turnExpectations[3]!,
    liveScenarioCases[5]!.turnExpectations[1]!,
    ...paymentMethods.turnExpectations,
  ]) {
    expect(expectation.outcome.provenance.requireOfficialSameReference).toBe(true);
    expect(expectation.outcome.provenance.requiredEvidenceKinds.length).toBeGreaterThan(0);
  }
});
