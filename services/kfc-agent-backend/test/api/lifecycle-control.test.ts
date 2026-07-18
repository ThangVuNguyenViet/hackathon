import { describe, expect, it } from 'vitest';
import { buildServer } from '../../src/api/server.js';
import { LifecycleError, MemoryLifecycleRepository, SandboxLifecycleControls, lifecycleBinding } from '../../src/commerce/lifecycleProvider.js';
import { StaticToolPlanner } from '../../src/llm/toolPlanner.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import { createTestResponseComposer } from '../fixtures/testResponseComposer.js';

describe('sandbox lifecycle control routes', () => {
  it('is absent in production and enforces auth, revision, binding, and idempotency in sandbox', async () => {
    const repository = new MemoryLifecycleRepository();
    const controls = new SandboxLifecycleControls(repository);
    const lifecycle = {
      environment: 'sandbox' as const,
      controls,
      createInput: async (sessionId: string) => ({
        environment: 'sandbox' as const, scenarioDefinitionVersion: 'proof-v1', releaseId: 'release-1',
        catalogObservationId: 'catalog-1', catalogHash: 'hash-1', customerBinding: 'customer-hash',
        sessionBinding: `hash:${sessionId}`, paymentPolicy: 'prepaid' as const, fulfillmentPolicy: 'delivery' as const,
        logicalTime: 1, expiresAt: 100,
      }),
      binding: async (instanceId: string) => {
        const instance = await repository.get('sandbox', instanceId);
        if (!instance) throw new LifecycleError('not_found', 'Lifecycle instance not found');
        return lifecycleBinding(instance);
      },
    };
    expect((await buildServer().inject({ method: 'POST', url: '/admin/lifecycle/sessions/kfc%3Acustomer/instances' })).statusCode).toBe(404);
    expect((await buildServer({ demoAdminToken: 'proof-token' }).inject({
      method: 'POST',
      url: '/admin/proof/kfc/sessions/kfc%3Acustomer/preconditions',
      headers: { authorization: 'Bearer proof-token' },
      payload: { customerId: 'customer', authenticated: true },
    })).statusCode).toBe(404);

    const store = new MemoryStore();
    const server = buildServer({
      store,
      demoAdminToken: 'proof-token',
      lifecycle,
      responseComposer: createTestResponseComposer('Lifecycle model response.'),
      toolPlanner: new StaticToolPlanner([{
        intent: 'ordering',
        entities: { cartMutationRequested: true },
        toolCalls: [{ toolName: 'updateCart', arguments: { itemCode: '41141', quantity: 1 } }],
        responseClaims: [],
      }]),
    });
    expect((await server.inject({
      method: 'POST',
      url: '/admin/proof/kfc/sessions/kfc%3Acustomer/preconditions',
      payload: { customerId: 'customer', authenticated: true },
    })).statusCode).toBe(401);
    expect((await server.inject({ method: 'POST', url: '/admin/lifecycle/sessions/kfc%3Acustomer/instances' })).statusCode).toBe(401);
    const created = await server.inject({ method: 'POST', url: '/admin/lifecycle/sessions/kfc%3Acustomer/instances', headers: { authorization: 'Bearer proof-token' } });
    expect(created.statusCode).toBe(201);
    const instanceId = created.json().instanceId as string;
    const event = { expectedRevision: 0, idempotencyKey: 'payment-1', event: { type: 'payment_pending', attemptId: 'attempt-1' } };
    const first = await server.inject({ method: 'POST', url: `/admin/lifecycle/instances/${instanceId}/events`, headers: { authorization: 'Bearer proof-token' }, payload: event });
    const replay = await server.inject({ method: 'POST', url: `/admin/lifecycle/instances/${instanceId}/events`, headers: { authorization: 'Bearer proof-token' }, payload: event });
    const stale = await server.inject({ method: 'POST', url: `/admin/lifecycle/instances/${instanceId}/events`, headers: { authorization: 'Bearer proof-token' }, payload: { ...event, idempotencyKey: 'payment-2' } });
    expect(first.json()).toMatchObject({ revision: 1, state: { payment: { status: 'pending' } } });
    expect(replay.json()).toEqual(first.json());
    expect(stale.statusCode).toBe(409);

    const preconditions = await server.inject({
      method: 'POST',
      url: '/admin/proof/kfc/sessions/kfc%3Acustomer/preconditions',
      headers: { authorization: 'Bearer proof-token' },
      payload: {
        customerId: 'customer',
        authenticated: true,
        verifiedState: { customerContext: { savedAddresses: [], favorites: [], recentOrders: [] } },
        providerProfile: { unavailableItemCodes: ['41141'] },
      },
    });
    expect(preconditions.statusCode).toBe(201);
    expect((await store.listEvents('kfc:customer')).map(({ sourceType }) => sourceType)).toEqual(expect.arrayContaining([
      'proof:kfc_preconditions',
      'graph:verified_state',
    ]));
    expect((await store.listEvents('kfc:customer')).find(({ sourceType }) => sourceType === 'proof:kfc_preconditions')?.payload).toMatchObject({
      providerProfile: { unavailableItemCodes: ['41141'] },
    });

    const ordinaryChat = await server.inject({
      method: 'POST',
      url: '/chat/kfc/message',
      payload: {
        sessionId: 'kfc:customer',
        customerId: 'customer',
        clientMessageId: 'ordinary-chat-1',
        text: 'Thêm Burger Gà Zinger',
      },
    });
    expect(ordinaryChat.statusCode).toBe(200);
    expect(ordinaryChat.json().state.toolTrace).toEqual(expect.arrayContaining([
      expect.objectContaining({ toolName: 'updateCart', ok: false }),
    ]));

    const clearedSession = 'kfc:cleared';
    for (const providerProfile of [{ unavailableItemCodes: ['41141'] }, null]) {
      expect((await server.inject({
        method: 'POST',
        url: `/admin/proof/kfc/sessions/${encodeURIComponent(clearedSession)}/preconditions`,
        headers: { authorization: 'Bearer proof-token' },
        payload: { customerId: 'cleared', authenticated: true, providerProfile },
      })).statusCode).toBe(201);
    }
    const clearedChat = await server.inject({
      method: 'POST', url: '/chat/kfc/message',
      payload: { sessionId: clearedSession, customerId: 'cleared', clientMessageId: 'cleared-1', text: 'Thêm Burger Gà Zinger' },
    });
    expect(clearedChat.json().state.toolTrace).toEqual(expect.arrayContaining([
      expect.objectContaining({ toolName: 'updateCart', ok: true }),
    ]));

    const expiredSession = 'kfc:expired';
    await store.appendEvent(expiredSession, 'proof:kfc_preconditions', {
      customerId: 'expired', authenticated: true, expiresAt: new Date(Date.now() - 1_000).toISOString(),
      orderId: null, providerProfile: { unavailableItemCodes: ['41141'] },
    });
    const expiredChat = await server.inject({
      method: 'POST', url: '/chat/kfc/message',
      payload: { sessionId: expiredSession, customerId: 'expired', clientMessageId: 'expired-1', text: 'Thêm Burger Gà Zinger' },
    });
    expect(expiredChat.json().state.toolTrace).toEqual(expect.arrayContaining([
      expect.objectContaining({ toolName: 'updateCart', ok: true }),
    ]));

    const rejectedSession = 'kfc:rejected';
    const rejected = await server.inject({
      method: 'POST',
      url: `/admin/proof/kfc/sessions/${encodeURIComponent(rejectedSession)}/preconditions`,
      headers: { authorization: 'Bearer proof-token' },
      payload: {
        customerId: 'rejected', authenticated: true, orderId: 'order-rejected',
        providerProfile: {
          orders: [{
            id: 'order-rejected',
            cart: { id: 'cart-rejected', items: [], subtotalVnd: 0, discountVnd: 0, deliveryFeeVnd: 0, totalVnd: 0, voucherCode: null },
            status: 'created', paymentStatus: 'failed', assignedStoreId: 'store-1', createdAt: '2026-07-15T00:00:00.000Z',
          }],
          paymentFailureOrderIds: ['order-rejected'],
        },
      },
    });
    expect(rejected.statusCode).toBe(409);
    expect((await store.listEvents(rejectedSession)).filter(({ sourceType }) => sourceType === 'proof:kfc_preconditions')).toEqual([]);
  });
});
