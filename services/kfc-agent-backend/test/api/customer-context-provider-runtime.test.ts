import { describe, expect, it, vi } from 'vitest';
import catalogPayload from '../../fixtures/catalog-baselines/kfcvn-generic-menu@2026-07-10.raw.json' with { type: 'json' };
import { createRouteCommerceRuntime } from '../../src/api/routeCommerceRuntime.js';
import type { ExternalCallContext } from '../../src/clients/interfaces.js';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import { loadBundledGeneratedFixtures } from '../../src/fixtures/bundledFixtures.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';

describe('gateway customer-context provider wiring', () => {
  it('uses the configured real customer provider instead of the unavailable fallback', async () => {
    const provider = createMockClients(loadBundledGeneratedFixtures());
    const externalCallContext: ExternalCallContext = {
      signal: new AbortController().signal,
      deadlineAt: Date.now() + 10_000,
    };
    const getSavedAddresses = vi.fn(
      provider.customer.getSavedAddresses.bind(provider.customer),
    );
    const customer = {
      ...provider.customer,
      getSavedAddresses,
    };
    const runtime = createRouteCommerceRuntime({
      options: {
        readiness: { commerce: { mode: 'gateway' } },
        catalog: {
          environment: 'sandbox',
          sourceUrl: 'https://catalog.example/menu',
          fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(
            new Response(JSON.stringify(catalogPayload)),
          ),
        },
        kfcCommerceGateway: {
          oms: provider.oms,
          payment: provider.payment,
        },
        kfcCommerceProvider: {
          cart: provider.cart,
          inventory: provider.inventory,
          storeLocator: provider.storeLocator,
          fulfillment: provider.fulfillment,
          customer,
        },
      },
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
    });
    const clients = await runtime.withConfiguredCommerce(
      'kfc:customer-provider',
      provider,
    );

    await expect(clients.customer.getSavedAddresses(
      'authenticated-customer',
      externalCallContext,
    )).resolves.toMatchObject({ ok: true, value: [] });
    expect(getSavedAddresses).toHaveBeenCalledWith(
      'authenticated-customer',
      externalCallContext,
    );
  });
});
