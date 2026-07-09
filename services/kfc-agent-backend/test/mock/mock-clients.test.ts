import { describe, expect, it } from 'vitest';
import { createMockClients } from '../../src/mock/createMockClients.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';

const fixtures = createTestFixtures();

describe('mock clients', () => {
  it('searches Vietnamese menu fixtures and builds priced carts', async () => {
    const clients = createMockClients(fixtures);
    const search = await clients.menu.searchMenu('Combo 99K');
    expect(search.ok).toBe(true);
    expect(search.value?.[0]?.code).toBe('20751');

    const cart = await clients.cart.createCart('session_1');
    const updated = await clients.cart.updateCart(cart.value!, '20751', 2);
    expect(updated.value?.subtotalVnd).toBe(198000);
  });

  it('matches menu items from AI-normalized item text', async () => {
    const clients = createMockClients(fixtures);
    const search = await clients.menu.searchMenu('Combo Hợp Gu 99K');
    const addMoreSearch = await clients.menu.searchMenu('Combo Hợp Gu 99K');

    expect(search.ok).toBe(true);
    expect(search.value?.[0]?.code).toBe('20751');
    expect(addMoreSearch.value?.[0]?.code).toBe('20751');
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
      { label: 'Home', line1: 'Unknown Plaza', district: 'District 1', city: 'Ho Chi Minh' },
      ['20751'],
    );
    expect(assignment.ok).toBe(false);
    expect(assignment.errorCode).toBe('store_not_found');
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

  it('fails fulfillment quoting when no quote seam is configured', async () => {
    const clients = createMockClients(fixtures);
    const quote = await clients.fulfillment.quoteFulfillment({
      address: { label: 'Home', line1: 'Big C Đồng Nai', district: 'Biên Hòa', city: 'ĐỒNG NAI' },
      method: 'delivery',
      itemCodes: ['20751'],
    });
    expect(quote.ok).toBe(false);
    expect(quote.errorCode).toBe('fulfillment_quote_unavailable');
  });

  it('answers allergen questions from content fixtures', async () => {
    const clients = createMockClients(fixtures);
    const evidence = await clients.content.answerAllergenQuestion('phô mai');
    expect(evidence.ok).toBe(true);
    expect(evidence.value?.[0]?.kind).toBe('allergen');
  });
});
