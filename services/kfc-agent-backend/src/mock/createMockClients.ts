import type { ExternalClients, MessengerClient, ZaloClient } from '../clients/interfaces.js';
import type { Address, Cart, CartItem, MenuItem, Order, ToolResult } from '../domain/types.js';
import type { GeneratedFixtures } from '../fixtures/schema.js';
import { OrderingDataService } from '../ordering/orderingDataService.js';
import type { SelectedModifier } from '../ordering/types.js';

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

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/đ/g, 'd')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

const MENU_QUERY_STOPWORDS = new Set([
  'a',
  'cho',
  'co',
  'cua',
  'duoc',
  'giup',
  'ho',
  'khong',
  'minh',
  'muon',
  'toi',
  'em',
  'anh',
  'chi',
  'ban',
  'lay',
  'dat',
  'mua',
  'mon',
  'phan',
  'cai',
  'nha',
  'nhe',
  'them',
  'tu',
  'van',
]);

function toMenuSearchQuery(query: string): string {
  return normalizeSearchText(query)
    .match(/[a-z0-9]+/g)
    ?.filter((token) => !MENU_QUERY_STOPWORDS.has(token))
    .join(' ') ?? query;
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

export interface MockClientOptions {
  channelClients?: {
    messenger: MessengerClient;
    zalo: ZaloClient;
  };
}

export function createMockClients(fixtures: GeneratedFixtures, options: MockClientOptions = {}): ExternalClients {
  const data = new OrderingDataService(fixtures);
  const menuByCode = new Map(fixtures.menuItems.map((item) => [item.code, toMenuItem(item)]));
  const orders = new Map<string, Order>();
  const channelClients = options.channelClients ?? {
    messenger: {
      async sendText() {
        return fail('channel_client_not_configured', 'Messenger delivery must be provided by a live channel client');
      },
    },
    zalo: {
      async sendText() {
        return fail('channel_client_not_configured', 'Zalo delivery must be provided by a live channel client');
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

  return {
    menu: {
      async searchMenu(query) {
        return ok(data.searchMenu(toMenuSearchQuery(query)).map(toMenuItem));
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
      async updateCart(cart, itemCode, quantity, modifiers) {
        const item = menuByCode.get(itemCode);
        if (!item) return fail('item_not_found', `No menu item found for ${itemCode}`);
        if (!item.available) return fail('item_unavailable', `${item.name} is unavailable`);

        const withoutItem = cart.items.filter((cartItem) => cartItem.itemCode !== itemCode);
        const nextItems =
          quantity > 0
            ? [...withoutItem, { itemCode, name: item.name, quantity, unitPriceVnd: priceItem(item.priceVnd, modifiers) }]
            : withoutItem;
        return ok({ ...repriceCart(nextItems, cart.voucherCode, cart.deliveryFeeVnd), id: cart.id });
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
        const store = data.searchStores({ query: `${address.line1} ${address.district} ${address.city}` })[0] ?? data.searchStores({ city: address.city })[0];
        return ok({ storeId: store?.storeId ?? 'store_mock_nearest', etaMinutes: 25 });
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
        const store =
          data.searchStores({ query: `${input.address.line1} ${input.address.district} ${input.address.city}` })[0] ??
          data.searchStores({ city: input.address.city, district: input.address.district })[0];
        if (!store) return fail('store_not_found', 'No store matched the requested fulfillment address');
        const availability = data.checkItemsAvailable({
          storeId: store.storeId,
          disposition: input.method === 'pickup' ? 'pickup' : 'delivery',
          itemIds: input.itemCodes,
        });
        if (!availability.ok) return fail('items_unavailable', 'One or more items are unavailable for this store/disposition');
        return ok({
          method: input.method,
          disposition: input.method === 'pickup' ? 'pickup' : 'delivery',
          storeId: store.storeId,
          storeName: store.name,
          feeVnd: input.method === 'delivery' ? 18000 : 0,
          etaMinutes: input.method === 'delivery' ? 25 : 15,
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
      async createPaymentLink(order, method) {
        if (method === 'cod') return ok({ url: 'cod://pay-on-delivery', status: 'pending' });
        return ok({ url: `https://pay.mock/${method}/${order.id}`, status: 'pending' });
      },
      async checkPaymentStatus() {
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
        return ok([{ label: 'Recent address', line1: '123 Nguyen Trai', district: 'Quan 5', city: 'Ho Chi Minh' }]);
      },
      async getRecentOrder() {
        return ok(null);
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
