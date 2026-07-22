import { describe, expect, it } from 'vitest';
import { createMockClients } from '../../src/mock/createMockClients.js';
import { loadGeneratedFixtures } from '../../src/fixtures/loadFixtures.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';

const fixtures = createTestFixtures();

describe('mock clients', () => {
  it('creates a distinct escalation for each handoff request', async () => {
    const clients = createMockClients(fixtures);
    const first = await clients.handoff.escalateToHuman('session_1', ['order_cancellation_requested']);
    const second = await clients.handoff.escalateToHuman('session_1', ['order_cancellation_requested']);

    expect(first.value?.escalationId).not.toBe(second.value?.escalationId);
  });

  it('exposes fixture-backed fulfillment location evidence without a default address', async () => {
    const clients = createMockClients(fixtures);
    const matched = await clients.fulfillment.getPlanningContext({
      query: 'Giao tới Quận 7',
      method: 'delivery',
      maxCandidates: 4,
    });
    const unmatched = await clients.fulfillment.getPlanningContext({
      query: 'Giao tới địa chỉ này',
      method: 'delivery',
      maxCandidates: 4,
    });

    expect(matched.value?.candidates).toEqual([
      expect.objectContaining({ district: 'Quận 7', city: 'Hồ Chí Minh', verifiedForQuote: true }),
    ]);
    expect(unmatched.value?.candidates).toEqual([]);
  });

  it('searches Vietnamese menu fixtures and builds priced carts', async () => {
    const clients = createMockClients(fixtures);
    const search = await clients.menu.searchMenu({ query: 'Combo 99K' });
    expect(search.ok).toBe(true);
    expect(search.value?.items[0]?.code).toBe('20751');

    const cart = await clients.cart.createCart('session_1');
    const updated = await clients.cart.updateCart(cart.value!, '20751', 2);
    expect(updated.value?.subtotalVnd).toBe(198000);
  });

  it('applies a multi-item cart change atomically and rolls back invalid changes', async () => {
    const clients = createMockClients(await loadGeneratedFixtures(process.cwd()));
    const original = (await clients.cart.createCart('atomic_cart')).value!;
    const applyChanges = (clients.cart as any).applyChanges.bind(clients.cart);

    const changed = await applyChanges(original, [
      { itemCode: '41037', quantity: 3 },
      { itemCode: '41035', quantity: 1 },
      { itemCode: '41074', quantity: 4 },
    ]);
    expect(changed.value).toMatchObject({ subtotalVnd: 404000 });

    const rejected = await applyChanges(changed.value, [
      { itemCode: '41037', quantity: 0 },
      { itemCode: 'missing-item', quantity: 1 },
    ]);
    expect(rejected).toMatchObject({ ok: false, errorCode: 'item_not_found' });
    expect(changed.value.items).toEqual([
      expect.objectContaining({ itemCode: '41037', quantity: 3 }),
      expect.objectContaining({ itemCode: '41035', quantity: 1 }),
      expect.objectContaining({ itemCode: '41074', quantity: 4 }),
    ]);
  });

  it('atomically replaces individual items with two customized combos for 286000 VND', async () => {
    const clients = createMockClients(await loadGeneratedFixtures(process.cwd()));
    const original = (await clients.cart.createCart('combo_cart')).value!;
    const applyChanges = (clients.cart as any).applyChanges.bind(clients.cart);
    const individual = (await applyChanges(original, [
      { itemCode: '41037', quantity: 3 },
      { itemCode: '41035', quantity: 1 },
      { itemCode: '41074', quantity: 4 },
    ])).value!;
    const modifierTree = (await clients.menu.getModifierOptions('20752')).value!;
    const largePepsi = modifierTree.modifierGroups.flatMap((group) => {
      const option = group.options.find((candidate) => candidate.modifierId === '41091');
      if (!option) return [];
      return {
        groupId: group.groupId,
        groupName: group.name,
        modifierId: option.modifierId,
        modifierName: option.name,
        quantity: 1,
        priceDeltaVnd: option.priceDeltaVnd,
      };
    });

    const converted = await applyChanges(individual, [
      { itemCode: '41037', quantity: 0 },
      { itemCode: '41035', quantity: 0 },
      { itemCode: '41074', quantity: 0 },
      { itemCode: '20752', quantity: 2, modifiers: largePepsi },
    ]);
    expect(converted.value).toMatchObject({
      items: [{ itemCode: '20752', quantity: 2, unitPriceVnd: 143000 }],
      totalVnd: 286000,
    });
  });

  it('resolves flat nested modifier selections from fixture evidence', async () => {
    const clients = createMockClients(await loadGeneratedFixtures(process.cwd()));
    const cart = (await clients.cart.createCart('nested_modifier_cart')).value!;
    const updated = await clients.cart.updateCart(cart, '20752', 1, [
      { groupId: '1', modifierId: '41106' },
      { groupId: '60266', modifierId: '70258', quantity: 5 },
      { groupId: '2', modifierId: '41089' },
      { groupId: '3', modifierId: '41089' },
    ]);

    expect(updated.ok).toBe(true);
    expect(updated.value?.items[0]).toMatchObject({
      itemCode: '20752',
      unitPriceVnd: 129000,
      modifiers: expect.arrayContaining([
        expect.objectContaining({ groupId: '60266', modifierId: '70258', modifierName: 'Gà Giòn Cay', quantity: 5 }),
      ]),
    });

    const nestedSelectionWithImplicitVerifiedParent = await clients.cart.updateCart(cart, '20752', 1, [
      { groupId: '60266', modifierId: '70258', quantity: 5 },
    ]);
    expect(nestedSelectionWithImplicitVerifiedParent).toMatchObject({ ok: true });
    expect(nestedSelectionWithImplicitVerifiedParent.value?.items[0]?.modifiers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ groupId: '1', modifierId: '41106' }),
        expect.objectContaining({ groupId: '60266', modifierId: '70258', modifierName: 'Gà Giòn Cay' }),
      ]),
    );
  });

  it('matches menu items from AI-normalized item text', async () => {
    const clients = createMockClients(fixtures);
    const search = await clients.menu.searchMenu({ query: 'Combo Hợp Gu 99K' });
    const addMoreSearch = await clients.menu.searchMenu({ query: 'Combo Hợp Gu 99K' });

    expect(search.ok).toBe(true);
    expect(search.value?.items[0]?.code).toBe('20751');
    expect(addMoreSearch.value?.items[0]?.code).toBe('20751');
  });

  it('honors store item exclusions when checking inventory', async () => {
    const clients = createMockClients(
      createTestFixtures({
        storeAvailability: [
          {
            storeId: 'KFCVN0002',
            storeName: 'KFC BIG C ĐỒNG NAI',
            pickup: { excludedItemIds: ['20751'], timeslotExclusions: [] },
            delivery: { excludedItemIds: [], timeslotExclusions: [] },
            provenance: {
              sourceFile: 'availability.json',
              sourceApi: 'https://api.kfcvietnam.com.vn/stores',
              fixtureMode: 'public_crawl_seed',
            },
          },
        ],
      }),
    );

    const availability = await clients.inventory.checkInventory('KFCVN0002', ['20751']);
    expect(availability.value).toEqual({ '20751': false });
  });

  it('applies one turn-scoped mocked upstream profile consistently across menu, cart, inventory, and fulfillment', async () => {
    let profile = {
      unavailableItemCodes: ['20751'],
    } as {
      unavailableItemCodes?: string[];
      deliveryFeeVnd?: number;
      deliveryEtaMinutes?: number;
    };
    const clients = createMockClients(fixtures, {
      mockedUpstreamApiProvider: () => profile,
    });
    const planning = await clients.menu.getPlanningContext({
      query: 'Combo Hợp Gu 99K',
      activeItemCodes: [],
      maxCandidates: 6,
    });
    const cart = (await clients.cart.createCart('turn_scoped_profile')).value!;
    const update = await clients.cart.updateCart(cart, '20751', 1);
    const inventory = await clients.inventory.checkInventory('KFCVN0002', ['20751'], 'delivery');

    expect(planning.value?.candidates.find((candidate) => candidate.code === '20751')?.available).toBe(false);
    expect(update).toMatchObject({ ok: false, errorCode: 'item_unavailable' });
    expect(inventory.value).toEqual({ '20751': false });

    profile = { deliveryFeeVnd: 27_000, deliveryEtaMinutes: 45 };
    const quote = await clients.fulfillment.quoteFulfillment({
      address: { label: 'Home', line1: 'Big C Đồng Nai', district: 'Biên Hòa', city: 'ĐỒNG NAI' },
      method: 'delivery',
      itemCodes: ['20751'],
    });
    expect(quote.value).toMatchObject({ feeVnd: 27_000, etaMinutes: 45 });
  });

  it('rejects order placement without explicit confirmation', async () => {
    const clients = createMockClients(fixtures);
    const cart = (await clients.cart.createCart('session_1')).value!;
    const updated = (await clients.cart.updateCart(cart, '20751', 1)).value!;
    const preview = (
      await clients.oms.previewOrder({
        cart: updated,
        address: { label: 'Home', line1: '23 Nguyen Huu Tho', district: 'Quan 7', city: 'Ho Chi Minh' },
        storeId: 'KFCVN0002',
      })
    ).value!;

    const placed = await clients.oms.placeOrder({ preview, userConfirmed: false });
    expect(placed.ok).toBe(false);
    expect(placed.errorCode).toBe('confirmation_required');
  });

  it('does not fake channel delivery unless explicit channel clients are injected', async () => {
    const clients = createMockClients(fixtures);
    const sent = await clients.messenger.sendText('psid_1', 'Xin chao');
    expect(sent.ok).toBe(false);
    expect(sent.errorCode).toBe('channel_client_not_configured');

    const injected = createMockClients(fixtures, {
      channelClients: {
        messenger: {
          async sendText() {
            return { ok: true, value: { messageId: 'live_messenger_message' }, message: 'sent' };
          },
          async sendSenderAction() {
            return { ok: true, value: { recipientId: 'psid_1' }, message: 'typing_on' };
          },
          async getProfile() {
            return { ok: false, errorCode: 'not_needed', message: 'not used in this test' };
          },
        },
        zalo: {
          async sendText() {
            return { ok: true, value: { messageId: 'live_zalo_message' }, message: 'sent' };
          },
          async getProfile() {
            return { ok: false, errorCode: 'not_needed', message: 'not used in this test' };
          },
        },
      },
    });

    expect((await injected.messenger.sendText('psid_1', 'Xin chao')).value?.messageId).toBe('live_messenger_message');
  });

  it('returns modifier options from generated fixture data', async () => {
    const clients = createMockClients(fixtures);
    const details = await clients.menu.getModifierOptions('20751');
    expect(details.ok).toBe(true);
    expect(details.value?.modifierGroups.length).toBeGreaterThan(0);
  });

  it('keeps menu search compact while item details expose fixture-backed modifier metadata', async () => {
    const generated = await loadGeneratedFixtures(process.cwd());
    const tree = generated.menuModifiers.find((candidate) => candidate.modifierGroups[0]?.options[0]);
    expect(tree).toBeDefined();
    const item = generated.menuItems.find((candidate) => candidate.itemId === tree!.itemId);
    expect(item).toBeDefined();
    const clients = createMockClients(generated);

    const search = await clients.menu.searchMenu({ query: item!.name });
    const result = search.value?.items.find((candidate) => candidate.code === item!.code);
    const details = await clients.menu.getItemDetails(item!.code);

    expect(result).toMatchObject({
      isCustomize: item!.isCustomize,
      hasModifiers: true,
    });
    expect(result).not.toHaveProperty('modifierGroups');
    expect(details.value?.modifierGroups).toEqual(expect.any(Array));
  });

  it('applies fixture-backed demo-stable KFC50 validation', async () => {
    const clients = createMockClients(fixtures);
    const cart = (await clients.cart.createCart('session_1')).value!;
    const updated = (await clients.cart.updateCart(cart, '20751', 3)).value!;
    const validation = await clients.promotion.validateVoucher(updated, 'KFC50');
    expect(validation.ok).toBe(true);
    expect(validation.value).toMatchObject({
      voucherCode: 'KFC50',
      discountVnd: 50000,
    });
  });

  it('serves authenticated membership fixtures and gates account-mutating reward actions', async () => {
    const clients = createMockClients(fixtures);

    const rewards = await clients.membership.listRewards({ query: '10k' });
    expect(rewards.value?.[0]).toMatchObject({
      rewardId: 'reward-discount-10k',
      pointsCost: 3000,
    });

    const tools = await clients.membership.listTools({ sideEffect: 'reward_redemption' });
    expect(tools.value?.[0]).toMatchObject({
      toolName: 'redeemReward',
      endpointPath: '/voucherify/redeem-reward',
      requiresUserConfirmation: true,
    });

    const unconfirmedAcquire = await clients.membership.acquireVoucher({
      rewardId: 'reward-discount-10k',
      confirmed: false,
    });
    expect(unconfirmedAcquire.ok).toBe(false);
    expect(unconfirmedAcquire.errorCode).toBe('confirmation_required');

    const confirmedRedeem = await clients.membership.redeemReward({
      voucherId: 'wallet-new-member-25k',
      channel: 'kiosk',
      confirmed: true,
    });
    expect(confirmedRedeem.ok).toBe(true);
    expect(confirmedRedeem.value).toMatchObject({
      status: 'completed',
      targetId: 'wallet-new-member-25k',
    });
  });

  it('fails store assignment when the address cannot be resolved from fixtures', async () => {
    const clients = createMockClients(fixtures);
    const assignment = await clients.storeLocator.assignStore(
      { label: 'Home', line1: 'No KFC service area', district: 'No district', city: 'No city' },
      ['20751'],
    );
    expect(assignment.ok).toBe(false);
    expect(assignment.errorCode).toBe('store_not_found');
  });

  it('does not substitute the first fixture store for a named district or building', async () => {
    const clients = createMockClients(fixtures);
    const assignment = await clients.storeLocator.assignStore(
      { label: 'Home', line1: 'Sunrise City', district: 'Quận 12', city: 'Hồ Chí Minh' },
      ['20751'],
    );
    expect(assignment.ok).toBe(false);
    expect(assignment.errorCode).toBe('store_not_found');
  });

  it('resolves a typed address only through an explicit fixture-backed service area', async () => {
    const clients = createMockClients(fixtures, {
      fulfillmentQuoteProvider: async (input) => {
        expect(input.storeId).toBe('KFCVN0318');
        expect(input.address).toEqual({
          label: 'Sunrise City',
          line1: '23 Nguyễn Hữu Thọ, phường Tân Hưng',
          district: 'Quận 7',
          city: 'Hồ Chí Minh',
        });
        return { ok: true, value: { feeVnd: 19000, etaMinutes: 33 }, message: 'service_area_quote' };
      },
    });
    const quote = await clients.fulfillment.quoteFulfillment({
      address: {
        label: 'Sunrise City',
        line1: '23 Nguyễn Hữu Thọ, phường Tân Hưng',
        district: 'Quận 7',
        city: 'Hồ Chí Minh',
      },
      method: 'delivery',
      itemCodes: ['20751'],
    });

    expect(quote.ok).toBe(true);
    expect(quote.value).toMatchObject({ storeId: 'KFCVN0318', feeVnd: 19000, etaMinutes: 33 });
  });

  it('quotes fulfillment only when a quote seam provides fee and eta data', async () => {
    const clients = createMockClients(fixtures, {
      fulfillmentQuoteProvider: async (input) => {
        expect(input.storeId).toBe('KFCVN0002');
        expect(input.itemCodes).toEqual(['20751']);
        return { ok: true, value: { feeVnd: 31000, etaMinutes: 42 }, message: 'quoted' };
      },
    });
    const quote = await clients.fulfillment.quoteFulfillment({
      address: { label: 'Home', line1: 'Big C Đồng Nai', district: 'Biên Hòa', city: 'ĐỒNG NAI' },
      method: 'delivery',
      itemCodes: ['20751'],
    });
    expect(quote.ok).toBe(true);
    expect(quote.value?.storeId).toBe('KFCVN0002');
    expect(quote.value?.feeVnd).toBe(31000);
    expect(quote.value?.etaMinutes).toBe(42);
    expect(quote.value?.availability.checkedItemIds).toEqual(['20751']);
  });

  it('uses an exact fixture-backed quote when no provider override is configured', async () => {
    const clients = createMockClients(fixtures);
    const quote = await clients.fulfillment.quoteFulfillment({
      address: { label: 'Home', line1: 'Big C Đồng Nai', district: 'Biên Hòa', city: 'ĐỒNG NAI' },
      method: 'delivery',
      itemCodes: ['20751'],
    });
    expect(quote.ok).toBe(true);
    expect(quote.value).toMatchObject({ storeId: 'KFCVN0002', feeVnd: 18000, etaMinutes: 35 });
  });

  it('fails fulfillment quoting when no exact quote fixture or provider is configured', async () => {
    const clients = createMockClients({ ...fixtures, fulfillmentQuotes: [] });
    const quote = await clients.fulfillment.quoteFulfillment({
      address: { label: 'Home', line1: 'Big C Đồng Nai', district: 'Biên Hòa', city: 'ĐỒNG NAI' },
      method: 'delivery',
      itemCodes: ['20751'],
    });
    expect(quote.ok).toBe(false);
    expect(quote.errorCode).toBe('fulfillment_quote_unavailable');
  });

  it('uses the injected recent order provider when configured', async () => {
    const clients = createMockClients(fixtures, {
      recentOrderProvider: (customerId) => {
        expect(customerId).toBe('psid_recent_order');
        return { ok: true, value: null, message: 'no_recent_order_for_test' };
      },
    });

    const recentOrder = await clients.customer.getRecentOrder('psid_recent_order');

    expect(recentOrder).toMatchObject({
      ok: true,
      value: null,
      message: 'no_recent_order_for_test',
    });
  });

  it('returns no favorite items by default and uses an injected customer provider when configured', async () => {
    const defaultClients = createMockClients(fixtures);
    await expect(defaultClients.customer.getFavoriteItems('anonymous')).resolves.toMatchObject({
      ok: true,
      value: [],
    });

    const favorite = fixtures.menuItems[0]!;
    const clients = createMockClients(fixtures, {
      favoriteItemsProvider: (customerId) => {
        expect(customerId).toBe('member_with_favorite');
        return { ok: true, value: [favorite], message: 'customer_favorites_fixture' };
      },
    });

    await expect(clients.customer.getFavoriteItems('member_with_favorite')).resolves.toMatchObject({
      ok: true,
      value: [favorite],
      message: 'customer_favorites_fixture',
    });
  });

  it('answers allergen questions from content fixtures', async () => {
    const clients = createMockClients(fixtures);
    const evidence = await clients.content.answerAllergenQuestion('phô mai');
    expect(evidence.ok).toBe(true);
    expect(evidence.value?.[0]?.kind).toBe('allergen');
  });
});
