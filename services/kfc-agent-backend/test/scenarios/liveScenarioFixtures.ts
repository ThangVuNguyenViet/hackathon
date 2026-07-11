import type { Order } from '../../src/domain/types.js';
import type { AgentGraphState } from '../../src/graph/state.js';
import type { ContextPolicyDirective } from '../../src/graph/contextPolicy.js';
import type { MockClientOptions } from '../../src/mock/createMockClients.js';
import type { GeneratedFixtures } from '../../src/fixtures/schema.js';

function order(id: string, paymentStatus: Order['paymentStatus']): Order {
  return {
    id,
    status: paymentStatus === 'paid' ? 'preparing' : 'created',
    paymentStatus,
    assignedStoreId: 'store_kfc_nguyen_thi_minh_khai',
    createdAt: '2026-07-09T09:00:00.000Z',
    cart: {
      id: `cart_${id}`,
      items: [{ itemCode: '41141', name: 'Burger Gà Zinger', quantity: 1, unitPriceVnd: 55000 }],
      subtotalVnd: 55000, discountVnd: 0, deliveryFeeVnd: 18000, totalVnd: 73000, voucherCode: null,
    },
  };
}

export function liveScenarioFixtures(fileName: string): {
  initialVerifiedState?: Partial<AgentGraphState>;
  mockClientOptions?: MockClientOptions;
  contextPolicy?: ContextPolicyDirective;
  transformFixtures?: (fixtures: GeneratedFixtures) => GeneratedFixtures;
} {
  if (fileName.startsWith('03-')) {
    const savedAddress = {
      label: 'Địa chỉ cũ',
      line1: '123 Nguyễn Trãi',
      district: 'Quận 5',
      city: 'Hồ Chí Minh',
    };
    return {
      initialVerifiedState: {
        address: savedAddress,
        customerContext: { savedAddresses: [savedAddress], favorites: [], recentOrders: [] },
      },
      contextPolicy: { cart: 'active', fulfillment: 'active', customer: 'active' },
    };
  }
  if (fileName.startsWith('04-')) {
    const seededOrder = order('KFC-1024', 'paid');
    return {
      initialVerifiedState: { order: seededOrder, paymentAttempt: { method: 'momo', status: 'paid', paymentUrl: `https://pay.mock/momo/${seededOrder.id}` } },
      mockClientOptions: { initialOrders: [seededOrder] },
      contextPolicy: { order: 'active', payment: 'active' },
    };
  }
  if (fileName.startsWith('07-')) {
    const recentOrder = order('KFC-MOCK-1001', 'paid');
    recentOrder.cart.items.push({ itemCode: '41086', name: 'Pepsi (Lon)', quantity: 1, unitPriceVnd: 20000 });
    recentOrder.cart.subtotalVnd = 75000;
    recentOrder.cart.totalVnd = 93000;
    return {
      initialVerifiedState: { customerContext: { savedAddresses: [], favorites: [], recentOrders: [recentOrder] } },
      mockClientOptions: { initialOrders: [recentOrder] },
      contextPolicy: { recentOrder: 'active', cart: 'active' },
      transformFixtures: (fixtures) => ({
        ...fixtures,
        menuItems: [...fixtures.menuItems, {
          ...fixtures.menuItems[0]!, code: 'MOCK-PEACH-TEA', itemId: 'MOCK-PEACH-TEA', posItemId: 'MOCK-PEACH-TEA',
          productCode: 'MOCK-PEACH-TEA', category: 'Đồ uống', categoryId: 'mock-drinks', categoryUrl: '/mock-upstream/drinks',
          name: 'Trà Đào', description: 'Trà đào từ mocked upstream/API data', priceVnd: 25000,
          productUrlSlug: 'mock-peach-tea', builderUrl: '/mock-upstream/drinks/mock-peach-tea',
          provenance: {
            sourceFile: 'test/scenarios/liveScenarioFixtures.ts (mocked upstream/API data)',
            sourceApi: 'mock://scenario-07/menu',
            okfConceptId: 'menu/items/MOCK-PEACH-TEA',
            fixtureMode: 'public_crawl_seed',
          },
        }],
      }),
    };
  }
  if (fileName.startsWith('08-')) {
    const seededOrder = order('KFC-MOCK-1001', 'pending');
    return {
      initialVerifiedState: { order: seededOrder, paymentAttempt: { method: 'momo', status: 'pending', paymentUrl: `https://pay.mock/momo/${seededOrder.id}` } },
      mockClientOptions: {
        initialOrders: [seededOrder],
        paymentStatusProvider: () => ({ ok: false, errorCode: 'payment_failed', message: 'live_ai_payment_failed_fixture' }),
      },
      contextPolicy: { order: 'active', payment: 'active' },
    };
  }
  return {};
}
