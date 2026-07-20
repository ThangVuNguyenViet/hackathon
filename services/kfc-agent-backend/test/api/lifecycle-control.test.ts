import { fakeModel } from '@langchain/core/testing';
import { describe, expect, it } from 'vitest';
import { createRouteCommerceRuntime } from '../../src/api/routeCommerceRuntime.js';
import { buildServer } from '../../src/api/server.js';
import { LifecycleError, MemoryLifecycleRepository, SandboxLifecycleControls, lifecycleBinding } from '../../src/commerce/lifecycleProvider.js';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import { loadPriorVerifiedState } from '../../src/graph/verifiedState.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import {
  groundedResponseModelReply,
} from '../fixtures/groundedResponse.js';
import { testAgent } from '../fixtures/testAgent.js';

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
    const model = fakeModel();
    for (const customerText of [
      'How else can I help?',
      'What would you like to do next?',
      'Would you like anything else?',
    ]) {
      model
        .respondWithTools([{
          name: 'searchMenu',
          args: { scope: 'filtered', query: 'Burger Gà Zinger' },
        }])
        .respondWithTools([{
          name: 'updateCart',
          args: {
            changes: [{
              itemCode: '41141',
              quantity: 1,
              modifiers: [],
            }],
          },
        }])
        .respond(groundedResponseModelReply({ customerText }));
    }
    const server = buildServer({
      store,
      demoAdminToken: 'proof-token',
      lifecycle,
      ...testAgent(model),
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
    const boundSession = 'kfc:bound';
    const boundOrder = {
      id: 'order-bound',
      cart: {
        id: 'cart-bound',
        items: [],
        subtotalVnd: 0,
        discountVnd: 0,
        deliveryFeeVnd: 0,
        totalVnd: 0,
        voucherCode: null,
      },
      status: 'created' as const,
      paymentStatus: 'pending' as const,
      assignedStoreId: 'store-1',
      createdAt: '2026-07-15T00:00:00.000Z',
    };
    const bound = await server.inject({
      method: 'POST',
      url:
        `/admin/proof/kfc/sessions/${encodeURIComponent(boundSession)}` +
        '/preconditions',
      headers: { authorization: 'Bearer proof-token' },
      payload: {
        customerId: 'bound',
        authenticated: true,
        orderId: boundOrder.id,
        providerProfile: {
          orders: [boundOrder],
          paymentStatuses: { [boundOrder.id]: 'failed' },
        },
      },
    });
    expect(bound.statusCode).toBe(201);
    expect(
      (await store.listEvents(boundSession)).find(
        ({ sourceType }) => sourceType === 'graph:verified_state',
      )?.payload,
    ).toMatchObject({
      verifiedState: {
        order: { id: boundOrder.id },
        paymentAttempt: {
          orderId: boundOrder.id,
          status: 'failed',
        },
      },
    });

    const mismatchSession = 'kfc:authority-mismatch';
    const mismatchStore = new MemoryStore();
    const mismatchServer = buildServer({
      store: mismatchStore,
      demoAdminToken: 'proof-token',
      lifecycle,
      mockClientOptions: {
        orderStatusProvider: () => ({
          ok: true,
          value: {
            ...boundOrder,
            id: 'different-canonical-order',
          },
          message: 'mismatched_order_authority',
        }),
        paymentStatusProvider: () => ({
          ok: true,
          value: { status: 'pending' },
          message: 'payment_status_for_requested_order',
        }),
      },
    });
    const mismatch = await mismatchServer.inject({
      method: 'POST',
      url:
        `/admin/proof/kfc/sessions/${encodeURIComponent(mismatchSession)}` +
        '/preconditions',
      headers: { authorization: 'Bearer proof-token' },
      payload: {
        customerId: 'authority-mismatch',
        authenticated: true,
        orderId: 'requested-order',
      },
    });
    expect(mismatch.statusCode).toBe(409);
    expect(mismatch.json()).toMatchObject({
      errorCode: 'kfc_proof_provider_order_authority_mismatch',
    });
    expect(await mismatchStore.listEvents(mismatchSession)).toEqual([]);

    const sandboxAccessContext = await createRouteCommerceRuntime({
      options: { lifecycle },
      store,
      dashboard: new DashboardEventBus(),
    }).kfcProofAccessContext('kfc:customer', 'customer');
    expect(sandboxAccessContext?.authorizedScopes).toEqual([
      'customer:read',
      'membership:read',
      'membership:write',
      'order:read',
      'order:write',
      'payment:read',
      'payment:write',
      'handoff:write',
    ]);

    const productionStore = new MemoryStore();
    await productionStore.appendEvent(
      'kfc:production-customer',
      'proof:kfc_preconditions',
      {
        customerId: 'production-customer',
        authenticated: true,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
    );
    const productionAccessContext = await createRouteCommerceRuntime({
      options: {
        lifecycle: {
          ...lifecycle,
          environment: 'production',
        },
      },
      store: productionStore,
      dashboard: new DashboardEventBus(),
    }).kfcProofAccessContext(
      'kfc:production-customer',
      'production-customer',
    );
    expect(productionAccessContext).toBeUndefined();

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
    expect(ordinaryChat.json()).not.toHaveProperty('state');
    expect((await loadPriorVerifiedState(
      store,
      'kfc:customer',
    )).toolTrace).toEqual(expect.arrayContaining([
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
    expect(clearedChat.json()).not.toHaveProperty('state');
    expect((await loadPriorVerifiedState(
      store,
      clearedSession,
    )).toolTrace).toEqual(expect.arrayContaining([
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
    expect(expiredChat.json()).not.toHaveProperty('state');
    expect((await loadPriorVerifiedState(
      store,
      expiredSession,
    )).toolTrace).toEqual(expect.arrayContaining([
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
