import { describe, expect, it, vi } from 'vitest';
import catalogPayload from '../../fixtures/catalog-baselines/kfcvn-generic-menu@2026-07-10.raw.json' with { type: 'json' };
import { buildServer, type BuildServerOptions } from '../../src/api/server.js';
import { loadBundledGeneratedFixtures } from '../../src/fixtures/bundledFixtures.js';
import { StaticToolPlanner } from '../../src/llm/toolPlanner.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import { createTestResponseComposer } from '../fixtures/testResponseComposer.js';

function gatewayOptions(fetchImpl: typeof fetch, store: MemoryStore): BuildServerOptions {
  const provider = createMockClients(loadBundledGeneratedFixtures());
  return {
    store,
    responseComposer: createTestResponseComposer('Catalog model response.'),
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
      toolPlanner: new StaticToolPlanner([{
        intent: 'voucher',
        contextPolicy: { promotion: 'active' },
        entities: {},
        toolCalls: [
          { toolName: 'searchPromotions', arguments: { query: 'KFC50' } },
          { toolName: 'answerAllergenQuestion', arguments: { query: 'bắt đầu' } },
        ],
        responseClaims: [],
      }]),
    });

    const response = await server.inject({
      method: 'POST', url: '/chat/kfc/message', payload: message('boundary', 'Khuyến mãi và dị ứng'),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().state.toolTrace).toEqual(expect.arrayContaining([
      expect.objectContaining({ toolName: 'searchPromotions', ok: false, resultSummary: 'commerce_provider_not_configured' }),
      expect.objectContaining({ toolName: 'answerAllergenQuestion', ok: true }),
    ]));
  });
});
