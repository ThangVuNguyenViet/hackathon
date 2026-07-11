import type { Order } from '../../src/domain/types.js';
import type { AgentGraphState } from '../../src/graph/state.js';
import type { MockClientOptions } from '../../src/mock/createMockClients.js';

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
} {
  if (fileName.startsWith('04-')) {
    const seededOrder = order('KFC-1024', 'paid');
    return {
      initialVerifiedState: { order: seededOrder, paymentAttempt: { method: 'momo', status: 'paid', paymentUrl: `https://pay.mock/momo/${seededOrder.id}` } },
      mockClientOptions: { initialOrders: [seededOrder] },
    };
  }
  if (fileName.startsWith('07-')) {
    const recentOrder = order('KFC-MOCK-1001', 'paid');
    return {
      initialVerifiedState: { customerContext: { savedAddresses: [], favorites: [], recentOrders: [recentOrder] } },
      mockClientOptions: { initialOrders: [recentOrder] },
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
    };
  }
  return {};
}
