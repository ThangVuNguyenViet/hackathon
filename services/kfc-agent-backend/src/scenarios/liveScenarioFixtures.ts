import type { AgentState } from '../agent/agentState.js';
import type { MenuItem, Order } from '../domain/types.js';
import type { GeneratedFixtures } from '../fixtures/schema.js';
import type {
  MockClientOptions,
  MockedUpstreamApiProfile,
} from '../mock/createMockClients.js';

export interface LiveScenarioFixtureOptions {
  initialVerifiedState?: Partial<AgentState>;
  mockClientOptions?: MockClientOptions;
  mockedUpstreamApiForTurn?: (
    turnIndex: number,
  ) => MockedUpstreamApiProfile | undefined;
  transformFixtures?: (fixtures: GeneratedFixtures) => GeneratedFixtures;
}

function order(id: string, paymentStatus: Order['paymentStatus']): Order {
  return {
    id,
    status: paymentStatus === 'paid' ? 'preparing' : 'created',
    paymentStatus,
    assignedStoreId: 'store_kfc_nguyen_thi_minh_khai',
    createdAt: '2026-07-09T09:00:00.000Z',
    cart: {
      id: `cart_${id}`,
      items: [
        {
          itemCode: '41141',
          name: 'Burger Gà Zinger',
          quantity: 1,
          unitPriceVnd: 55_000,
        },
      ],
      subtotalVnd: 55_000,
      discountVnd: 0,
      deliveryFeeVnd: 18_000,
      totalVnd: 73_000,
      voucherCode: null,
    },
  };
}

export function liveScenarioFixtures(
  fileName: string,
): LiveScenarioFixtureOptions {
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
        if (turnIndex === 5) {
          return { deliveryFeeVnd: 18_000, deliveryEtaMinutes: 45 };
        }
        if (turnIndex === 7) return { unavailableItemCodes: ['41141'] };
        return undefined;
      },
    };
  }

  if (fileName.startsWith('04-')) {
    const seededOrder = order('KFC-1024', 'paid');
    return {
      initialVerifiedState: {
        order: seededOrder,
        paymentAttempt: {
          orderId: seededOrder.id,
          method: 'zalopay_wallet',
          status: 'paid',
          paymentUrl: `https://pay.mock/zalopay_wallet/${seededOrder.id}`,
        },
      },
      mockClientOptions: {
        initialOrders: [seededOrder],
        orderStatusProvider: () => {
          const observedAt = Date.now();
          return {
            ok: true,
            value: {
              ...seededOrder,
              deliveryEstimate: {
                kind: 'remaining_delivery_window' as const,
                minMinutes: 25,
                maxMinutes: 30,
                observedAt: new Date(observedAt).toISOString(),
                expiresAt: new Date(observedAt + 5 * 60_000).toISOString(),
                providerRevision: 'mock-oms:KFC-1024:status-v1',
              },
            },
            message: 'mock_oms_order_status',
          };
        },
      },
    };
  }

  if (fileName.startsWith('07-')) {
    const recentOrder = order('KFC-MOCK-1001', 'paid');
    recentOrder.cart.items[0]!.unitPriceVnd = 56_000;
    recentOrder.cart.items.push({
      itemCode: '41086',
      name: 'Pepsi (Lon)',
      quantity: 1,
      unitPriceVnd: 20_000,
    });
    recentOrder.cart.subtotalVnd = 76_000;
    recentOrder.cart.totalVnd = 94_000;
    const favoriteCombo: MenuItem = {
      code: '20698',
      itemId: '20698',
      productCode: 'D-B.ZINGER-FF',
      category: 'Combo 1 Người',
      categoryId: '20001',
      name: 'Combo Burger Zinger',
      description:
        '1 Burger zinger + 1 Khoai tây chiên (vừa) + 1 Ly Pepsi (tiêu chuẩn)',
      priceVnd: 79_000,
      originalPriceVnd: null,
      imageUrl:
        'https://static.kfcvietnam.com.vn/images/items/lg/D-B.ZINGER-FF.jpg',
      available: true,
      isCustomize: true,
      isQuickCombo: true,
      hasModifiers: true,
    };
    const sourceFile = 'src/scenarios/liveScenarioFixtures.ts';
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
      transformFixtures: (fixtures) => ({
        ...fixtures,
        membershipProfileSnapshots: fixtures.membershipProfileSnapshots.map(
          (snapshot, index) =>
            index === 0
              ? {
                  ...snapshot,
                  points: 120,
                  evidenceText: 'Membership provider: 120 points, MEMBER tier.',
                  sourceFile,
                  provenance: {
                    ...snapshot.provenance,
                    sourceFile,
                    fixtureMode: 'demo_mock_seed',
                  },
                }
              : snapshot,
        ),
        menuModifiers: fixtures.menuModifiers.map((modifier) =>
          modifier.itemCode === '20698'
            ? {
                ...modifier,
                modifierGroups: modifier.modifierGroups.map((group) =>
                  group.groupId === '3'
                    ? {
                        ...group,
                        options: [
                          ...group.options,
                          {
                            modifierId: 'MOCK-PEACH-TEA-MODIFIER',
                            name: 'Trà Đào',
                            priceDeltaVnd: 10_000,
                            default: false,
                            quantity: 1,
                            posItemId: 'MOCK-PEACH-TEA-POS',
                            imageName: 'MOCK-PEACH-TEA',
                            modifierGroups: [],
                          },
                        ],
                      }
                    : group,
                ),
                provenance: {
                  sourceFile,
                  fixtureMode: 'public_crawl_seed',
                },
              }
            : modifier,
        ),
        menuItems: [
          ...fixtures.menuItems,
          {
            ...fixtures.menuItems[0]!,
            code: 'MOCK-PEACH-TEA',
            itemId: 'MOCK-PEACH-TEA',
            posItemId: 'MOCK-PEACH-TEA',
            productCode: 'MOCK-PEACH-TEA',
            category: 'Đồ uống',
            categoryId: 'mock-drinks',
            categoryUrl: '/mock-upstream/drinks',
            name: 'Trà Đào',
            description: 'Trà đào từ dữ liệu nhà cung cấp',
            priceVnd: 25_000,
            productUrlSlug: 'mock-peach-tea',
            builderUrl: 'https://mock.invalid/drinks/mock-peach-tea',
            provenance: {
              sourceFile,
              sourceApi: 'https://mock.invalid/scenario-07/menu',
              fixtureMode: 'public_crawl_seed',
            },
          },
        ],
      }),
    };
  }

  if (fileName.startsWith('08-')) {
    const seededOrder = order('KFC-MOCK-1001', 'pending');
    return {
      initialVerifiedState: {
        order: seededOrder,
        paymentAttempt: {
          orderId: seededOrder.id,
          method: 'zalopay_wallet',
          status: 'pending',
          paymentUrl: `https://pay.mock/zalopay_wallet/${seededOrder.id}`,
        },
      },
      mockClientOptions: {
        initialOrders: [seededOrder],
        paymentStatusProvider: () => ({
          ok: false,
          errorCode: 'payment_failed',
          message: 'live_ai_payment_failed_fixture',
        }),
      },
    };
  }

  return {};
}
