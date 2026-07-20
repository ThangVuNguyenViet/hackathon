import { fakeModel } from '@langchain/core/testing';
import { describe, expect, it, vi } from 'vitest';
import catalogPayload from '../../fixtures/catalog-baselines/kfcvn-generic-menu@2026-07-10.raw.json' with { type: 'json' };
import { buildServer, type BuildServerOptions } from '../../src/api/server.js';
import { createRouteCommerceRuntime } from '../../src/api/routeCommerceRuntime.js';
import type { ExternalCallContext } from '../../src/clients/interfaces.js';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import { loadBundledGeneratedFixtures } from '../../src/fixtures/bundledFixtures.js';
import { loadPriorVerifiedState } from '../../src/graph/verifiedState.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import {
  groundedResponseModelReply,
} from '../fixtures/groundedResponse.js';
import { testAgent } from '../fixtures/testAgent.js';

function gatewayOptions(fetchImpl: typeof fetch, store: MemoryStore): BuildServerOptions {
  const provider = createMockClients(loadBundledGeneratedFixtures());
  return {
    store,
    ...testAgent(
      fakeModel()
        .respond(groundedResponseModelReply({
          customerText: 'Catalog model response.',
        })),
    ),
    readiness: { commerce: { mode: 'gateway' } },
    catalog: {
      environment: 'sandbox',
      sourceUrl: 'https://catalog.example/menu',
      fallbackTtlSeconds: 300,
      fetchImpl,
    },
    kfcCommerceGateway: { oms: provider.oms, payment: provider.payment },
    kfcCommerceProvider: {
      cart: provider.cart,
      inventory: provider.inventory,
      storeLocator: provider.storeLocator,
      fulfillment: provider.fulfillment,
    },
  };
}

const message = (clientMessageId: string, text = 'xin chào') => ({
  sessionId: 'kfc:catalog_pin_customer',
  customerId: 'catalog_pin_customer',
  clientMessageId,
  text,
});

describe('gateway catalog runtime', () => {
  it('persists a journey pin across handler instances and retries after an initial fetch failure', async () => {
    const store = new MemoryStore();
    const fetchImpl = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new Error('provider unavailable'))
      .mockResolvedValue(new Response(JSON.stringify(catalogPayload)));

    const failed = await buildServer(gatewayOptions(fetchImpl, store)).inject({
      method: 'POST', url: '/chat/kfc/message', payload: message('first'),
    });
    expect(failed.statusCode).toBe(500);

    const first = await buildServer(gatewayOptions(fetchImpl, store)).inject({
      method: 'POST', url: '/chat/kfc/message', payload: message('second'),
    });
    const resumed = await buildServer(gatewayOptions(fetchImpl, store)).inject({
      method: 'POST', url: '/chat/kfc/message', payload: message('third'),
    });

    expect(first.statusCode).toBe(200);
    expect(resumed.statusCode).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect((await store.listEvents('kfc:catalog_pin_customer')).filter(
      (event) => event.sourceType === 'catalog_observation_pinned',
    )).toHaveLength(1);
  });

  it('fails closed for fixture-only commerce while retaining static content', async () => {
    const store = new MemoryStore();
    const options = gatewayOptions(
      vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(catalogPayload))),
      store,
    );
    const server = buildServer({
      ...options,
      ...testAgent(
        fakeModel()
          .respondWithTools([
            {
              name: 'searchPromotions',
              args: { scope: 'filtered', query: 'KFC50' },
            },
            {
              name: 'answerAllergenQuestion',
              args: { query: 'bắt đầu' },
            },
          ])
          .respond(groundedResponseModelReply({
            customerText: 'Catalog boundary response.',
          })),
      ),
    });

    const response = await server.inject({
      method: 'POST', url: '/chat/kfc/message', payload: message('boundary', 'Khuyến mãi và dị ứng'),
    });

    expect(
      response.statusCode,
      JSON.stringify(response.json()),
    ).toBe(200);
    expect(response.json()).not.toHaveProperty('state');
    expect((await loadPriorVerifiedState(
      store,
      'kfc:catalog_pin_customer',
    )).toolTrace).toEqual(expect.arrayContaining([
      expect.objectContaining({ toolName: 'searchPromotions', ok: false, resultSummary: 'commerce_provider_not_configured' }),
      expect.objectContaining({ toolName: 'answerAllergenQuestion', ok: true }),
    ]));
  });

  it('bounds the initial session pin with a finite typed timeout', async () => {
    const store = new MemoryStore();
    let receivedSignal: AbortSignal | undefined;
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        receivedSignal = init?.signal ?? undefined;
        const rejectAbort = () => reject(receivedSignal?.reason);
        receivedSignal?.addEventListener('abort', rejectAbort, {
          once: true,
        });
      }),
    );
    const options = gatewayOptions(fetchImpl, store);
    options.readiness = {
      commerce: {
        mode: 'gateway',
        timeoutMs: 10,
      },
    };

    const response = await buildServer(options).inject({
      method: 'POST',
      url: '/chat/kfc/message',
      payload: message('catalog-timeout'),
    });

    expect(response.statusCode).toBe(500);
    expect(receivedSignal?.aborted).toBe(true);
    expect(receivedSignal?.reason).toMatchObject({
      name: 'TimeoutError',
      message: 'Initial catalog pin timed out',
    });
  });

  it('forwards one tool-call context through refresh, revalidation, and provider mutation', async () => {
    const store = new MemoryStore();
    const fetchSignals: AbortSignal[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      if (!init?.signal) throw new Error('catalog_signal_missing');
      fetchSignals.push(init.signal);
      return new Response(JSON.stringify(catalogPayload), {
        headers: { 'cache-control': 'max-age=0' },
      });
    });
    const options = gatewayOptions(fetchImpl, store);
    const provider = createMockClients(loadBundledGeneratedFixtures());
    let providerContext: ExternalCallContext | undefined;
    options.kfcCommerceProvider = {
      cart: {
        ...provider.cart,
        createCart: (sessionId, externalCallContext) => {
          providerContext = externalCallContext;
          return provider.cart.createCart(sessionId, externalCallContext);
        },
        updateCart: (
          cart,
          itemCode,
          quantity,
          modifiers,
          externalCallContext,
        ) => {
          providerContext = externalCallContext;
          return provider.cart.updateCart(
            cart,
            itemCode,
            quantity,
            modifiers,
            externalCallContext,
          );
        },
      },
      inventory: provider.inventory,
      storeLocator: provider.storeLocator,
      fulfillment: provider.fulfillment,
    };
    const runtime = createRouteCommerceRuntime({
      options,
      store,
      dashboard: new DashboardEventBus(),
    });
    const clients = await runtime.withConfiguredCommerce(
      'kfc:catalog-context',
      provider,
    );
    const callerContext: ExternalCallContext = {
      signal: new AbortController().signal,
      deadlineAt: Date.now() + 10_000,
    };
    await clients.menu.searchMenu('Burger Gà Zinger', callerContext);
    const created = await clients.cart.createCart(
      'kfc:catalog-context',
      callerContext,
    );
    if (!created.value) throw new Error('test_cart_missing');
    await clients.cart.updateCart(
      created.value,
      '41141',
      1,
      undefined,
      callerContext,
    );

    expect(providerContext).toBeDefined();
    expect(fetchSignals.length).toBeGreaterThanOrEqual(3);
    expect(providerContext).toBe(callerContext);
    expect(fetchSignals[0]).not.toBe(callerContext.signal);
    expect(fetchSignals.slice(1)).toEqual(
      fetchSignals.slice(1).map(() => callerContext.signal),
    );
  });
});
