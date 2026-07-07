import type { ExternalClients, MessengerClient, ZaloClient } from '../clients/interfaces.js';
import type { Address, Cart, CartItem, MenuItem, Order, ToolResult } from '../domain/types.js';
import type { GeneratedFixtures } from '../fixtures/schema.js';

function ok<T>(value: T, message = 'ok'): ToolResult<T> {
  return { ok: true, value, message };
}

function fail<T>(errorCode: string, message: string): ToolResult<T> {
  return { ok: false, errorCode, message };
}

function toMenuItem(item: GeneratedFixtures['menuItems'][number]): MenuItem {
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

export interface MockClientOptions {
  channelClients?: {
    messenger: MessengerClient;
    zalo: ZaloClient;
  };
}

function priceCart(items: CartItem[], voucherCode: string | null, deliveryFeeVnd = 0): Cart {
  const subtotalVnd = items.reduce((sum, item) => sum + item.quantity * item.unitPriceVnd, 0);
  const discountVnd = voucherCode === 'KFC50' && subtotalVnd >= 199000 ? 50000 : 0;
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

export function createMockClients(fixtures: GeneratedFixtures, options: MockClientOptions = {}): ExternalClients {
  const menu = fixtures.menuItems.map(toMenuItem);
  const menuByCode = new Map(menu.map((item) => [item.code, item]));
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

  return {
    menu: {
      async searchMenu(query) {
        const lower = query.toLowerCase();
        const results = menu.filter((item) =>
          `${item.name} ${item.description} ${item.category}`.toLowerCase().includes(lower),
        );
        return ok(results);
      },
      async getItemDetails(code) {
        const item = menuByCode.get(code);
        return item ? ok(item) : fail('item_not_found', `No menu item found for ${code}`);
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
      async updateCart(cart, itemCode, quantity) {
        const item = menuByCode.get(itemCode);
        if (!item) return fail('item_not_found', `No menu item found for ${itemCode}`);
        if (!item.available) return fail('item_unavailable', `${item.name} is unavailable`);

        const withoutItem = cart.items.filter((cartItem) => cartItem.itemCode !== itemCode);
        const nextItems =
          quantity > 0
            ? [...withoutItem, { itemCode, name: item.name, quantity, unitPriceVnd: item.priceVnd }]
            : withoutItem;
        return ok({ ...priceCart(nextItems, cart.voucherCode, cart.deliveryFeeVnd), id: cart.id });
      },
      async previewCart(cart) {
        return ok({ ...priceCart(cart.items, cart.voucherCode, cart.deliveryFeeVnd), id: cart.id });
      },
    },
    recommendation: {
      async recommendAddOns() {
        return ok(menu.filter((item) => item.category === 'Snack').slice(0, 3));
      },
    },
    promotion: {
      async validateVoucher(cart, voucherCode) {
        if (voucherCode !== 'KFC50') return fail('voucher_invalid', 'Voucher is not recognized');
        if (cart.subtotalVnd < 199000) {
          return fail('voucher_minimum_not_met', 'KFC50 requires subtotal at least 199000 VND');
        }
        return ok({ ...priceCart(cart.items, voucherCode, cart.deliveryFeeVnd), id: cart.id }, 'voucher_applied');
      },
    },
    inventory: {
      async checkInventory(_storeId, itemCodes) {
        return ok(Object.fromEntries(itemCodes.map((code) => [code, menuByCode.get(code)?.available === true])));
      },
    },
    storeLocator: {
      async assignStore(_address: Address, _itemCodes: string[]) {
        return ok({ storeId: 'store_mock_nearest', etaMinutes: 25 });
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
