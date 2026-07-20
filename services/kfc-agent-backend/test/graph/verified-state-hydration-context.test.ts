import { describe, expect, it, vi } from 'vitest';
import type { ExternalCallContext } from '../../src/clients/interfaces.js';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import type { AgentTurnInput } from '../../src/graph/agentTurnState.js';
import {
  buildVerifiedStateSnapshot,
  hydrateRecentOrderContext,
} from '../../src/graph/verifiedState.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import { controlledCustomerAccess } from '../fixtures/controlledCustomerAccess.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';

describe('verified state hydration external-call context', () => {
  it('never prefetches saved addresses and passes caller context through remaining reads', async () => {
    const sessionId = 'kfc:hydration-context';
    const customerId = 'hydration-context';
    const externalCallContext: ExternalCallContext = {
      signal: new AbortController().signal,
      deadlineAt: Date.now() + 10_000,
    };
    const baseClients = createMockClients(createTestFixtures());
    const savedAddresses = vi.fn(async (
      _customerId: string,
      receivedContext: ExternalCallContext,
    ) => {
      expect(receivedContext).toBe(externalCallContext);
      return { ok: true, value: [], message: 'addresses' };
    });
    const getFavoriteItems = vi.fn(async (
      _customerId: string,
      receivedContext: ExternalCallContext,
    ) => {
      expect(receivedContext).toBe(externalCallContext);
      return { ok: true, value: [], message: 'favorites' };
    });
    const getRecentOrder = vi.fn(async (
      _customerId: string,
      receivedContext: ExternalCallContext,
    ) => {
      expect(receivedContext).toBe(externalCallContext);
      return { ok: true, value: null, message: 'recent order' };
    });
    const input = {
      sessionId,
      customerId,
      channel: 'kfc',
      text: 'status',
      accessContext: controlledCustomerAccess({ sessionId, customerId }),
      clients: {
        ...baseClients,
        customer: {
          getSavedAddresses: savedAddresses,
          getFavoriteItems,
          getRecentOrder,
        },
      },
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
    } satisfies AgentTurnInput;

    await hydrateRecentOrderContext(
      input,
      {},
      {
        customer: 'active',
        recentOrder: 'active',
        order: 'active',
      },
      externalCallContext,
    );

    expect(savedAddresses).not.toHaveBeenCalled();
    expect(getFavoriteItems).toHaveBeenCalledOnce();
    expect(getRecentOrder).toHaveBeenCalledOnce();
  });

  it('scrubs saved addresses from hydrated and persisted verified state', async () => {
    const sessionId = 'kfc:hydration-saved-address-scrub';
    const customerId = 'hydration-saved-address-scrub';
    const baseClients = createMockClients(createTestFixtures());
    const savedAddresses = vi.fn();
    const input = {
      sessionId,
      customerId,
      channel: 'kfc',
      text: 'status',
      accessContext: controlledCustomerAccess({ sessionId, customerId }),
      clients: {
        ...baseClients,
        customer: {
          ...baseClients.customer,
          getSavedAddresses: savedAddresses,
        },
      },
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
    } satisfies AgentTurnInput;
    const privateAddress = {
      label: 'Private saved label Ω',
      line1: 'Private provider street Ω',
      district: 'Quận 7',
      city: 'Hồ Chí Minh',
    };
    const hydrated = await hydrateRecentOrderContext(
      input,
      {
        customerContext: {
          savedAddresses: [privateAddress],
          favorites: [],
          recentOrders: [],
        },
      },
      {},
      {
        signal: new AbortController().signal,
        deadlineAt: Date.now() + 10_000,
      },
    );

    expect(savedAddresses).not.toHaveBeenCalled();
    expect(hydrated.customerContext?.savedAddresses).toEqual([]);
    expect(
      buildVerifiedStateSnapshot({
        sessionId,
        customerId,
        channel: 'kfc',
        latestUserMessage: '',
        userConfirmedOrder: false,
        escalationReasons: [],
        retrievedEvidence: [],
        toolTrace: [],
        customerContext: {
          savedAddresses: [privateAddress],
          favorites: [],
          recentOrders: [],
        },
      }).customerContext?.savedAddresses,
    ).toEqual([]);
  });
});
