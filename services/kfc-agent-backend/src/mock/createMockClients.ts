import type { CartChange, ExternalClients, MessengerClient, ZaloClient } from '../clients/interfaces.js';
import type { Address, Cart, CartItem, MenuItem, Order, ToolResult } from '../domain/types.js';
import type { GeneratedFixtures } from '../fixtures/schema.js';
import { OrderingDataService } from '../ordering/orderingDataService.js';
import type { FulfillmentMethod, SelectedModifier } from '../ordering/types.js';

function ok<T>(value: T, message = 'ok'): ToolResult<T> {
  return { ok: true, value, message };
}

function fail<T>(errorCode: string, message: string): ToolResult<T> {
  return { ok: false, errorCode, message };
}

function toMenuItem(item: MenuItem): MenuItem {
  return {
    code: item.code,
    category: item.category,
    name: item.name,
    description: item.description,
    priceVnd: item.priceVnd,
    originalPriceVnd: item.originalPriceVnd,
    imageUrl: item.imageUrl,
    available: item.available,
  };
}

function priceCart(items: CartItem[], voucherCode: string | null, deliveryFeeVnd = 0, discountVnd = 0): Cart {
  const subtotalVnd = items.reduce((sum, item) => sum + item.quantity * item.unitPriceVnd, 0);
  return {
    id: 'cart_mock',
    items,
    subtotalVnd,
    discountVnd,
    deliveryFeeVnd,
    totalVnd: Math.max(0, subtotalVnd - discountVnd + deliveryFeeVnd),
    voucherCode,
  };
}

function priceItem(basePriceVnd: number, modifiers?: SelectedModifier[]): number {
  return basePriceVnd + (modifiers?.reduce((sum, modifier) => sum + modifier.priceDeltaVnd * modifier.quantity, 0) ?? 0);
}

function normalizeFixtureSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/đ/g, 'd')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function canUseDemoFallbackStore(address: Address): boolean {
  const addressText = normalizeFixtureSearchText([address.line1, address.district, address.city].filter(Boolean).join(' '));
  return addressText.includes('sunrise city') || addressText.includes('quan 7');
}

export interface MockClientOptions {
  channelClients?: {
    messenger: MessengerClient;
    zalo: ZaloClient;
  };
  initialOrders?: Order[];
  recentOrderProvider?: (customerId: string) => Promise<ToolResult<Order | null>> | ToolResult<Order | null>;
  orderStatusProvider?: (orderId: string) => Promise<ToolResult<Order>> | ToolResult<Order>;
  paymentStatusProvider?: (
    orderId: string,
  ) => Promise<ToolResult<{ status: 'pending' | 'paid' | 'failed' }>> | ToolResult<{ status: 'pending' | 'paid' | 'failed' }>;
  fulfillmentQuoteProvider?: (
    input: {
      address: Address;
      method: FulfillmentMethod;
      itemCodes: string[];
      storeId: string;
      storeName: string;
    },
  ) => Promise<ToolResult<{ feeVnd: number; etaMinutes: number }>> | ToolResult<{ feeVnd: number; etaMinutes: number }>;
}

export function createMockClients(fixtures: GeneratedFixtures, options: MockClientOptions = {}): ExternalClients {
  const data = new OrderingDataService(fixtures);
  const menuByCode = new Map(fixtures.menuItems.map((item) => [item.code, toMenuItem(item)]));
  const orders = new Map<string, Order>();
  for (const order of options.initialOrders ?? []) {
    orders.set(order.id, order);
  }
  const channelClients = options.channelClients ?? {
    messenger: {
      async sendText() {
        return fail('channel_client_not_configured', 'Messenger delivery must be provided by a live channel client');
      },
      async sendSenderAction() {
        return fail('channel_client_not_configured', 'Messenger delivery must be provided by a live channel client');
      },
      async getProfile() {
        return fail('channel_client_not_configured', 'Messenger profile lookup must be provided by a live channel client');
      },
    },
    zalo: {
      async sendText() {
        return fail('channel_client_not_configured', 'Zalo delivery must be provided by a live channel client');
      },
      async getProfile() {
        return fail('channel_client_not_configured', 'Zalo profile lookup must be provided by a live channel client');
      },
    },
  };
  const repriceCart = (items: CartItem[], voucherCode: string | null, deliveryFeeVnd = 0): Cart => {
    const subtotalVnd = items.reduce((sum, item) => sum + item.quantity * item.unitPriceVnd, 0);
    if (!voucherCode) return priceCart(items, null, deliveryFeeVnd, 0);

    const validation = data.validateVoucherInput({ inputCodeOrText: voucherCode, subtotalVnd });
    if (!validation.ok) return priceCart(items, null, deliveryFeeVnd, 0);
    return priceCart(items, validation.publicCode, deliveryFeeVnd, validation.discountVnd);
  };
  const validateModifiers = (change: CartChange): ToolResult<undefined> => {
    if (!change.modifiers?.length) return ok(undefined);
    const tree = data.getModifierTree(change.itemCode);
    if (!tree) return fail('modifiers_not_found', `No modifier tree found for ${change.itemCode}`);
    for (const modifier of change.modifiers) {
      const group = tree.modifierGroups.find((candidate) => candidate.groupId === modifier.groupId);
      const option = group?.options.find((candidate) => candidate.modifierId === modifier.modifierId);
      if (!group || !option || option.priceDeltaVnd !== modifier.priceDeltaVnd) {
        return fail('invalid_modifier', `Modifier ${modifier.modifierId} is not verified for ${change.itemCode}`);
      }
    }
    return ok(undefined);
  };
  const applyCartChanges = async (cart: Cart, changes: CartChange[]): Promise<ToolResult<Cart>> => {
    for (const change of changes) {
      if (!Number.isInteger(change.quantity) || change.quantity < 0) {
        return fail('invalid_quantity', `Invalid quantity for ${change.itemCode}`);
      }
      const item = menuByCode.get(change.itemCode);
      if (!item) return fail('item_not_found', `No menu item found for ${change.itemCode}`);
      if (!item.available) return fail('item_unavailable', `${item.name} is unavailable`);
      const modifierValidation = validateModifiers(change);
      if (!modifierValidation.ok) {
        return fail(modifierValidation.errorCode ?? 'invalid_modifier', modifierValidation.message);
      }
    }

    let nextItems = [...cart.items];
    for (const change of changes) {
      const item = menuByCode.get(change.itemCode)!;
      nextItems = nextItems.filter((cartItem) => cartItem.itemCode !== change.itemCode);
      if (change.quantity > 0) {
        nextItems.push({
          itemCode: change.itemCode,
          name: item.name,
          quantity: change.quantity,
          unitPriceVnd: priceItem(item.priceVnd, change.modifiers),
        });
      }
    }
    return ok({ ...repriceCart(nextItems, cart.voucherCode, cart.deliveryFeeVnd), id: cart.id });
  };
  const resolveStore = (address: Address, itemCodes: string[] = [], method: FulfillmentMethod = 'delivery') => {
    const matched = data.searchStores({
      query: [address.line1, address.district, address.city].filter(Boolean).join(' '),
    })[0];
    if (matched) return matched;
    if (!canUseDemoFallbackStore(address)) return undefined;

    return fixtures.stores.find((store) => {
      if (itemCodes.length === 0) return true;
      return data.checkItemsAvailable({
        storeId: store.storeId,
        disposition: method === 'pickup' ? 'pickup' : 'delivery',
        itemIds: itemCodes,
      }).ok;
    });
  };

  return {
    menu: {
      async searchMenu(query) {
        return ok(data.searchMenu(query).map(toMenuItem));
      },
      async getItemDetails(code) {
        const item = data.getMenuItem(code);
        return item ? ok(toMenuItem(item)) : fail('item_not_found', `No menu item found for ${code}`);
      },
      async getModifierOptions(code) {
        const tree = data.getModifierTree(code);
        return tree ? ok(tree) : fail('modifiers_not_found', `No modifier tree found for ${code}`);
      },
    },
    cart: {
      async createCart(sessionId) {
        return ok({
          id: `cart_${sessionId}`,
          items: [],
          subtotalVnd: 0,
          discountVnd: 0,
          deliveryFeeVnd: 0,
          totalVnd: 0,
          voucherCode: null,
        });
      },
      applyChanges: applyCartChanges,
      async updateCart(cart, itemCode, quantity, modifiers) {
        return applyCartChanges(cart, [{ itemCode, quantity, modifiers }]);
      },
      async previewCart(cart) {
        return ok({ ...repriceCart(cart.items, cart.voucherCode, cart.deliveryFeeVnd), id: cart.id });
      },
    },
    recommendation: {
      async recommendAddOns() {
        return ok(data.recommendAddOns().map(toMenuItem));
      },
    },
    promotion: {
      async searchPromotions(query) {
        return ok(data.searchPromotionOffers({ query }));
      },
      async explainPromotion(offerId) {
        const offer = data.explainPromotion(offerId);
        return offer ? ok(offer) : fail('promotion_not_found', `No promotion found for ${offerId}`);
      },
      async validateVoucher(cart, voucherCode) {
        const validation = data.validateVoucherInput({ inputCodeOrText: voucherCode, subtotalVnd: cart.subtotalVnd });
        if (!validation.ok) return fail(validation.reason, 'Voucher could not be validated from public fixture data');
        return ok(
          { ...priceCart(cart.items, validation.publicCode, cart.deliveryFeeVnd, validation.discountVnd), id: cart.id },
          'voucher_applied',
        );
      },
      async validateVoucherInput(cart, inputCodeOrText) {
        return ok(data.validateVoucherInput({ inputCodeOrText, subtotalVnd: cart.subtotalVnd }));
      },
    },
    membership: {
      async getProfile() {
        const profile = data.getMembershipProfile();
        return profile ? ok(profile) : fail('membership_profile_not_found', 'No membership profile snapshot fixture is available');
      },
      async listRewards(input) {
        return ok(data.listMembershipRewards(input.query));
      },
      async listWallet(input) {
        return ok(data.listMembershipWallet(input.status));
      },
      async getPointHistory(input) {
        const history = data.getMembershipPointHistory(input.days);
        return history ? ok(history) : fail('membership_point_history_not_found', 'No membership point history fixture is available');
      },
      async listTools(input) {
        return ok(data.listMembershipTools(input.sideEffect));
      },
      async acquireVoucher(input) {
        if (!input.confirmed) {
          const preview = data.acquireMembershipVoucher(input);
          return preview
            ? fail('confirmation_required', preview.message)
            : fail('membership_reward_not_found', `No membership reward found for ${input.rewardId}`);
        }
        const result = data.acquireMembershipVoucher(input);
        return result ? ok(result, 'voucher_acquired') : fail('membership_reward_not_found', `No membership reward found for ${input.rewardId}`);
      },
      async redeemReward(input) {
        if (!input.confirmed) {
          const preview = data.redeemMembershipReward(input);
          return preview
            ? fail('confirmation_required', preview.message)
            : fail('membership_voucher_not_found', `No membership voucher found for ${input.voucherId}`);
        }
        const result = data.redeemMembershipReward(input);
        return result ? ok(result, 'reward_redeemed') : fail('membership_voucher_not_found', `No membership voucher found for ${input.voucherId}`);
      },
    },
    inventory: {
      async checkInventory(storeId, itemCodes, disposition) {
        if (disposition) {
          const availability = data.checkItemsAvailable({ storeId, disposition, itemIds: itemCodes });
          const unavailable = new Set([...availability.unavailableItemIds, ...availability.blockedTimeslotItemIds]);
          return ok(Object.fromEntries(itemCodes.map((code) => [code, !unavailable.has(code)])));
        }

        const pickup = data.checkItemsAvailable({ storeId, disposition: 'pickup', itemIds: itemCodes });
        const delivery = data.checkItemsAvailable({ storeId, disposition: 'delivery', itemIds: itemCodes });
        const unavailable = new Set([
          ...pickup.unavailableItemIds,
          ...pickup.blockedTimeslotItemIds,
          ...delivery.unavailableItemIds,
          ...delivery.blockedTimeslotItemIds,
        ]);
        return ok(Object.fromEntries(itemCodes.map((code) => [code, !unavailable.has(code)])));
      },
    },
    storeLocator: {
      async assignStore(address: Address, _itemCodes: string[]) {
        const store = resolveStore(address, _itemCodes, 'delivery');
        if (!store) return fail('store_not_found', 'No store matched the requested fulfillment address');
        return ok({ storeId: store.storeId });
      },
      async findStores(input) {
        return ok(
          data.searchStores(input).map((store) => ({
            storeId: store.storeId,
            name: store.name,
            address: store.address,
            city: store.city,
          })),
        );
      },
    },
    fulfillment: {
      async quoteFulfillment(input) {
        const store = resolveStore(input.address, input.itemCodes, input.method);
        if (!store) return fail('store_not_found', 'No store matched the requested fulfillment address');
        const availability = data.checkItemsAvailable({
          storeId: store.storeId,
          disposition: input.method === 'pickup' ? 'pickup' : 'delivery',
          itemIds: input.itemCodes,
        });
        if (!availability.ok) return fail('items_unavailable', 'One or more items are unavailable for this store/disposition');
        if (!options.fulfillmentQuoteProvider) {
          return fail('fulfillment_quote_unavailable', 'Fulfillment fee and ETA require an injected fulfillment quote provider');
        }
        const quote = await options.fulfillmentQuoteProvider({
          address: input.address,
          method: input.method,
          itemCodes: input.itemCodes,
          storeId: store.storeId,
          storeName: store.name,
        });
        if (!quote.ok) {
          return fail(quote.errorCode ?? 'fulfillment_quote_unavailable', quote.message);
        }
        return ok({
          method: input.method,
          disposition: input.method === 'pickup' ? 'pickup' : 'delivery',
          storeId: store.storeId,
          storeName: store.name,
          feeVnd: quote.value!.feeVnd,
          etaMinutes: quote.value!.etaMinutes,
          availability,
        });
      },
    },
    content: {
      async searchContent(kind, query) {
        return ok(data.searchContent(kind, query));
      },
      async answerAllergenQuestion(query) {
        return ok(data.getAllergenEvidence(query));
      },
    },
    invoice: {
      async collectInvoice(input) {
        if (!input.companyName || !input.taxCode || !input.email) {
          return fail('invoice_fields_missing', 'Company name, tax code, and email are required for invoice requests');
        }
        return ok({ companyName: input.companyName, taxCode: input.taxCode, email: input.email });
      },
    },
    oms: {
      async previewOrder(input) {
        return ok({
          id: 'KFC-MOCK-PREVIEW',
          cart: input.cart,
          status: 'previewed',
          paymentStatus: 'not_started',
          assignedStoreId: input.storeId,
          createdAt: new Date('2026-07-07T00:00:00.000Z').toISOString(),
        });
      },
      async placeOrder(input) {
        if (!input.userConfirmed) {
          return fail('confirmation_required', 'User confirmation is required before order placement');
        }

        const order: Order = { ...input.preview, id: 'KFC-MOCK-1001', status: 'created', paymentStatus: 'pending' };
        orders.set(order.id, order);
        return ok(order, 'order_created');
      },
      async getOrderStatus(orderId) {
        if (options.orderStatusProvider) return await options.orderStatusProvider(orderId);
        const order = orders.get(orderId);
        return order ? ok(order) : fail('order_not_found', `Order ${orderId} was not found`);
      },
      async cancelOrder(orderId) {
        const order = orders.get(orderId);
        if (!order) return fail('order_not_found', `Order ${orderId} was not found`);

        const cancelled: Order = { ...order, status: 'cancelled' };
        orders.set(orderId, cancelled);
        return ok(cancelled, 'order_cancelled');
      },
    },
    payment: {
      async listMethods(input) {
        return ok(data.listPaymentMethods(input));
      },
      async createPaymentLink(order, method) {
        const paymentMethod = data.getPaymentMethodForLink(method);
        if (!paymentMethod || !paymentMethod.supported) {
          const label = paymentMethod?.displayName ?? method;
          return fail(
            'payment_method_unsupported',
            `${label} is not listed in KFC Vietnam website checkout payment methods`,
          );
        }
        if (method === 'cod') return ok({ url: 'cod://pay-on-delivery', status: 'pending' });
        return ok({ url: `https://pay.mock/${method}/${order.id}`, status: 'pending' });
      },
      async checkPaymentStatus(orderId) {
        if (options.paymentStatusProvider) {
          return options.paymentStatusProvider(orderId);
        }
        return fail('payment_failed', 'Mock payment is configured to fail until retried or changed to COD');
      },
    },
    delivery: {
      async quoteDelivery() {
        return ok({ feeVnd: 18000, etaMinutes: 25 });
      },
    },
    customer: {
      async getSavedAddresses() {
        return ok([{ label: 'Recent address', line1: 'Sunrise City', district: 'Quan 7', city: 'Ho Chi Minh' }]);
      },
      async getRecentOrder(customerId) {
        if (options.recentOrderProvider) return await options.recentOrderProvider(customerId);
        return ok([...orders.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null);
      },
    },
    loyalty: {
      async lookupLoyalty() {
        return ok({ points: 120 });
      },
    },
    handoff: {
      async escalateToHuman(sessionId, reasons) {
        return ok({ escalationId: `handoff_${sessionId}_${reasons.join('_')}` });
      },
    },
    feedback: {
      async recordFeedback(sessionId, _message) {
        return ok({ feedbackId: `feedback_${sessionId}` });
      },
    },
    messenger: channelClients.messenger,
    zalo: channelClients.zalo,
  };
}
