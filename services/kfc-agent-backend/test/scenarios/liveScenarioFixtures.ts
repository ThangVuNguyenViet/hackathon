import type { MenuItem, Order } from '../../src/domain/types.js';
import type { AgentGraphState } from '../../src/graph/state.js';
import type { ContextPolicyDirective } from '../../src/graph/contextPolicy.js';
import type { MockClientOptions, MockedUpstreamApiProfile } from '../../src/mock/createMockClients.js';
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
  mockedUpstreamApiForTurn?: (turnIndex: number) => MockedUpstreamApiProfile | undefined;
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
      mockClientOptions: {
        savedAddressesProvider: () => ({
          ok: true,
          value: [savedAddress],
          message: 'scenario_saved_addresses',
        }),
      },
      mockedUpstreamApiForTurn: (turnIndex) => {
        if (turnIndex === 1) return { unavailableItemCodes: ['41140'] };
        if (turnIndex === 5) return { deliveryFeeVnd: 18_000, deliveryEtaMinutes: 45 };
        if (turnIndex === 7) return { unavailableItemCodes: ['41141'] };
        return undefined;
      },
      contextPolicy: { cart: 'active', fulfillment: 'active', customer: 'active' },
    };
  }
  if (fileName.startsWith('04-')) {
    const seededOrder = order('KFC-1024', 'paid');
    return {
      initialVerifiedState: { order: seededOrder, paymentAttempt: { orderId: seededOrder.id, method: 'zalopay_wallet', status: 'paid', paymentUrl: `https://pay.mock/zalopay_wallet/${seededOrder.id}` } },
      mockClientOptions: {
        initialOrders: [seededOrder],
        orderStatusProvider: () => {
          const estimateObservedAt = Date.now();
          return {
            ok: true,
            value: {
              ...seededOrder,
              deliveryEstimate: {
                kind: 'remaining_delivery_window',
                minMinutes: 25,
                maxMinutes: 30,
                observedAt: new Date(estimateObservedAt).toISOString(),
                expiresAt:
                  new Date(estimateObservedAt + 5 * 60_000).toISOString(),
                providerRevision: 'mock-oms:KFC-1024:status-v1',
              },
            },
            message: 'mock_oms_order_status',
          };
        },
      },
      contextPolicy: { order: 'active', payment: 'active' },
    };
  }
  if (fileName.startsWith('07-')) {
    const recentOrder = order('KFC-MOCK-1001', 'paid');
    recentOrder.cart.items[0]!.unitPriceVnd = 56000;
    recentOrder.cart.items.push({ itemCode: '41086', name: 'Pepsi (Lon)', quantity: 1, unitPriceVnd: 20000 });
    recentOrder.cart.subtotalVnd = 76000;
    recentOrder.cart.totalVnd = 94000;
    const favoriteCombo: MenuItem = {
      code: '20698',
      itemId: '20698',
      productCode: 'D-B.ZINGER-FF',
      category: 'Combo 1 Người',
      categoryId: '20001',
      name: 'Combo Burger Zinger',
      description: '1 Burger zinger + 1 Khoai tây chiên (vừa) + 1 Ly Pepsi (tiêu chuẩn)',
      priceVnd: 79000,
      originalPriceVnd: null,
      imageUrl: 'https://static.kfcvietnam.com.vn/images/items/lg/D-B.ZINGER-FF.jpg',
      available: true,
      isCustomize: true,
      isQuickCombo: true,
      hasModifiers: true,
    };
    return {
      mockClientOptions: {
        initialOrders: [recentOrder],
        recentOrderProvider: () => ({
          ok: true,
          value: recentOrder,
          message: 'scenario_recent_order',
        }),
        favoriteItemsProvider: () => ({
          ok: true,
          value: [favoriteCombo],
          message: 'scenario_favorite_items',
        }),
      },
      contextPolicy: { recentOrder: 'active', cart: 'active' },
      transformFixtures: (fixtures) => ({
        ...fixtures,
        membershipProfileSnapshots: fixtures.membershipProfileSnapshots.map((snapshot, index) => index === 0
          ? {
              ...snapshot,
              points: 120,
              evidenceText: 'Membership provider: 120 points, MEMBER tier.',
              sourceFile: 'test/scenarios/liveScenarioFixtures.ts (scenario provider data)',
              provenance: {
                ...snapshot.provenance,
                sourceFile: 'test/scenarios/liveScenarioFixtures.ts (scenario provider data)',
                fixtureMode: 'demo_mock_seed',
              },
            }
          : snapshot),
        menuModifiers: fixtures.menuModifiers.map((modifier) => modifier.itemCode === '20698'
          ? {
              ...modifier,
              modifierGroups: modifier.modifierGroups.map((group) => group.groupId === '3'
                ? {
                    ...group,
                    options: [...group.options, {
                      modifierId: 'MOCK-PEACH-TEA-MODIFIER',
                      name: 'Trà Đào',
                      priceDeltaVnd: 10000,
                      default: false,
                      quantity: 1,
                      posItemId: 'MOCK-PEACH-TEA-POS',
                      imageName: 'MOCK-PEACH-TEA',
                      modifierGroups: [],
                    }],
                  }
                : group),
              provenance: {
                sourceFile: 'test/scenarios/liveScenarioFixtures.ts (scenario provider modifier data)',
                fixtureMode: 'public_crawl_seed',
              },
            }
          : modifier),
        menuItems: [...fixtures.menuItems, {
          ...fixtures.menuItems[0]!, code: 'MOCK-PEACH-TEA', itemId: 'MOCK-PEACH-TEA', posItemId: 'MOCK-PEACH-TEA',
          productCode: 'MOCK-PEACH-TEA', category: 'Đồ uống', categoryId: 'mock-drinks', categoryUrl: '/mock-upstream/drinks',
          name: 'Trà Đào', description: 'Trà đào từ dữ liệu nhà cung cấp', priceVnd: 25000,
          productUrlSlug: 'mock-peach-tea', builderUrl: 'https://mock.invalid/drinks/mock-peach-tea',
          provenance: {
            sourceFile: 'test/scenarios/liveScenarioFixtures.ts (mocked upstream/API data)',
            sourceApi: 'https://mock.invalid/scenario-07/menu',
            fixtureMode: 'public_crawl_seed',
          },
        }],
      }),
    };
  }
  if (fileName.startsWith('08-')) {
    const seededOrder = order('KFC-MOCK-1001', 'pending');
    return {
      initialVerifiedState: { order: seededOrder, paymentAttempt: { orderId: seededOrder.id, method: 'zalopay_wallet', status: 'pending', paymentUrl: `https://pay.mock/zalopay_wallet/${seededOrder.id}` } },
      mockClientOptions: {
        initialOrders: [seededOrder],
        paymentStatusProvider: () => ({
          ok: false,
          errorCode: 'payment_failed',
          message: 'live_ai_payment_failed_fixture',
        }),
      },
      contextPolicy: { order: 'active', payment: 'active' },
    };
  }
  return {};
}
