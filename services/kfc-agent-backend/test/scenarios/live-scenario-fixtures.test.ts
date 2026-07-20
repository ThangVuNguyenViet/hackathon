import { describe, expect, it } from 'vitest';
import { loadGeneratedFixtures } from '../../src/fixtures/loadFixtures.js';
import { OrderingDataService } from '../../src/ordering/orderingDataService.js';
import { liveScenarioFixtures } from './liveScenarioFixtures.js';

describe('live scenario fixture providers', () => {
  it('exposes scenario 03 private address only through its authenticated provider', async () => {
    const config = liveScenarioFixtures('03-ton-kho-dia-chi-va-cua-hang.json');

    expect(config.initialVerifiedState?.customerContext).toBeUndefined();
    await expect(
      Promise.resolve(config.mockClientOptions?.savedAddressesProvider?.(
        'scenario_customer',
        {
          signal: new AbortController().signal,
          deadlineAt: Date.now() + 10_000,
        },
      )),
    ).resolves.toMatchObject({
      ok: true,
      value: [{
        label: 'Địa chỉ cũ',
        line1: '123 Nguyễn Trãi',
        district: 'Quận 5',
        city: 'Hồ Chí Minh',
      }],
    });
    expect(config.mockedUpstreamApiForTurn?.(1)).toEqual({ unavailableItemCodes: ['41140'] });
    expect(config.mockedUpstreamApiForTurn?.(5)).toEqual({
      deliveryFeeVnd: 18_000,
      deliveryEtaMinutes: 45,
    });
    expect(config.mockedUpstreamApiForTurn?.(7)).toEqual({ unavailableItemCodes: ['41141'] });
    expect(config.mockedUpstreamApiForTurn?.(9)).toBeUndefined();
  });

  it('exposes scenario 07 private history and favorites only through authenticated providers', async () => {
    const source = await loadGeneratedFixtures(process.cwd());
    const config = liveScenarioFixtures('07-ca-nhan-hoa-va-loyalty.json');
    const providerContext = {
      signal: new AbortController().signal,
      deadlineAt: Date.now() + 10_000,
    };
    const [recentOrder, favoriteItems] = await Promise.all([
      Promise.resolve(config.mockClientOptions?.recentOrderProvider?.(
        'scenario_customer',
        providerContext,
      )),
      Promise.resolve(config.mockClientOptions?.favoriteItemsProvider?.(
        'scenario_customer',
        providerContext,
      )),
    ]);
    const fixtures = config.transformFixtures?.(source) ?? source;
    const data = new OrderingDataService(fixtures, { currentDate: '2026-07-13' });
    const combo = data.getMenuItem('20698');
    const peachTeaGroup = data.getModifierTree('20698')?.modifierGroups
      .find((group) =>
        group.options.some((option) => option.name === 'Trà Đào'));
    const peachTea = peachTeaGroup?.options
      .find((option) => option.name === 'Trà Đào');

    expect(config.initialVerifiedState?.customerContext).toBeUndefined();
    expect(recentOrder).toMatchObject({
      ok: true,
      value: {
        id: 'KFC-MOCK-1001',
        cart: { totalVnd: 94_000 },
      },
    });
    expect(favoriteItems).toMatchObject({
      ok: true,
      value: [{ code: '20698', name: 'Combo Burger Zinger' }],
    });
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
      name: 'Combo Burger Zinger',
      hasModifiers: true,
    });
    expect(peachTeaGroup).toMatchObject({ groupId: '3' });
    expect(peachTea).toMatchObject({
      modifierId: 'MOCK-PEACH-TEA-MODIFIER',
      priceDeltaVnd: 10000,
      quantity: 1,
    });
  });

  it('keeps the scenario 07 arithmetic correction local to its recent order', () => {
    const paid = liveScenarioFixtures('04-sau-khi-dat-don.json')
      .mockClientOptions?.initialOrders?.[0];
    expect(paid).toMatchObject({
      cart: {
        items: [{ itemCode: '41141', quantity: 1, unitPriceVnd: 55_000 }],
        subtotalVnd: 55_000,
        deliveryFeeVnd: 18_000,
        totalVnd: 73_000,
      },
    });
    expect(paid?.deliveryEstimate).toBeUndefined();

    const recent = liveScenarioFixtures('07-ca-nhan-hoa-va-loyalty.json')
      .mockClientOptions?.initialOrders?.[0];
    expect(recent).toMatchObject({
      cart: {
        items: [
          { itemCode: '41141', quantity: 1, unitPriceVnd: 56_000 },
          { itemCode: '41086', quantity: 1, unitPriceVnd: 20_000 },
        ],
        subtotalVnd: 76_000,
        deliveryFeeVnd: 18_000,
        totalVnd: 94_000,
      },
    });
  });

  it('keeps ETA out of initial state and returns it from the Scenario 04 mock OMS read', async () => {
    const scenario = liveScenarioFixtures('04-sau-khi-dat-don.json');
    expect(scenario.initialVerifiedState?.order?.deliveryEstimate)
      .toBeUndefined();
    const provider = scenario.mockClientOptions?.orderStatusProvider;
    const result = await Promise.resolve(
      provider?.('KFC-1024', {
        signal: new AbortController().signal,
        deadlineAt: Date.now() + 10_000,
      }),
    );
    const estimate = result?.value?.deliveryEstimate;

    expect(estimate).toMatchObject({
      kind: 'remaining_delivery_window',
      minMinutes: 25,
      maxMinutes: 30,
      observedAt: expect.any(String),
      expiresAt: expect.any(String),
      providerRevision: 'mock-oms:KFC-1024:status-v1',
    });
    expect(Date.parse(estimate?.expiresAt ?? '')).toBeGreaterThan(
      Date.parse(estimate?.observedAt ?? ''),
    );
  });

  it('seeds ZaloPay by provider method ID and returns a verified failed payment observation', async () => {
    expect(
      liveScenarioFixtures('04-sau-khi-dat-don.json')
        .initialVerifiedState?.paymentAttempt,
    ).toMatchObject({ method: 'zalopay_wallet', status: 'paid' });
    const scenario08 = liveScenarioFixtures(
      '08-thanh-toan-loi-va-don-bat-thuong.json',
    );
    expect(scenario08.initialVerifiedState?.paymentAttempt).toMatchObject({
      method: 'zalopay_wallet',
      status: 'pending',
    });

    const payment = scenario08.mockClientOptions?.paymentStatusProvider;
    const context = {
      signal: new AbortController().signal,
      deadlineAt: Date.now() + 10_000,
    };
    await expect(Promise.resolve(payment?.('KFC-MOCK-1001', context)))
      .resolves.toMatchObject({
        ok: false,
        errorCode: 'payment_failed',
      });
    await expect(Promise.resolve(payment?.('KFC-MOCK-1001', context)))
      .resolves.toMatchObject({
        ok: false,
        errorCode: 'payment_failed',
      });
    expect(scenario08.initialVerifiedState?.paymentAttempt).toMatchObject({
      method: 'zalopay_wallet',
      status: 'pending',
    });
  });
});
