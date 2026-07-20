import { describe, expect, it, vi } from 'vitest';
import {
  executeParallelReadBatch,
  parallelReadBatchEligibility,
  type ParallelReadBatchCall,
} from '../../src/agent/parallelReadBatch.js';
import type {
  ExternalCallContext,
  ExternalClients,
} from '../../src/clients/interfaces.js';
import type {
  CustomerAccessContext,
  CustomerAccessScope,
  Order,
} from '../../src/domain/types.js';
import type { AgentGraphState } from '../../src/graph/state.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import {
  executeAgentToolCall,
  type AgentToolExecutorContext,
} from '../../src/ordering/agentToolExecutor.js';
import type {
  AgentToolCallResult,
  ToolName,
} from '../../src/ordering/types.js';
import { controlledCustomerAccess } from '../fixtures/controlledCustomerAccess.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';

const customerReadCalls = [
  {
    id: ' provider/saved-addresses 🔐 ',
    toolName: 'getSavedAddresses',
    arguments: {},
  },
  {
    id: 'provider/recent-order/01',
    toolName: 'getRecentOrder',
    arguments: {},
  },
  {
    id: 'provider:favorite-items:opaque',
    toolName: 'getFavoriteItems',
    arguments: {},
  },
] as const satisfies readonly ParallelReadBatchCall[];

function externalCallContext(): ExternalCallContext {
  return {
    signal: new AbortController().signal,
    deadlineAt: Date.now() + 10_000,
  };
}

function state(): AgentGraphState {
  return {
    sessionId: 'parallel-customer-session',
    customerId: 'state-owned-customer',
    channel: 'kfc',
    latestUserMessage: 'Read my authenticated customer context',
    userConfirmedOrder: false,
    escalationReasons: [],
    retrievedEvidence: [],
    toolTrace: [],
  };
}

function access(
  authorizedScopes: CustomerAccessScope[],
): CustomerAccessContext {
  return {
    ...controlledCustomerAccess({
      sessionId: 'parallel-customer-session',
      customerId: 'state-owned-customer',
    }),
    authorizedScopes,
  };
}

function recentOrder(): Order {
  return {
    id: 'provider-recent-order',
    cart: {
      id: 'provider-recent-cart',
      items: [],
      subtotalVnd: 0,
      discountVnd: 0,
      deliveryFeeVnd: 0,
      totalVnd: 0,
      voucherCode: null,
    },
    status: 'created',
    paymentStatus: 'pending',
    assignedStoreId: 'KFCVN0318',
    createdAt: '2026-07-20T00:00:00.000Z',
  };
}

function executorContext(input: {
  currentState: AgentGraphState;
  accessContext: CustomerAccessContext;
  externalCallContext: ExternalCallContext;
}): AgentToolExecutorContext {
  return {
    state: input.currentState,
    accessContext: input.accessContext,
    externalCallContext: input.externalCallContext,
  };
}

function providerSpies() {
  const favorite = createTestFixtures().menuItems[0]!;
  return {
    savedAddresses: vi.fn(
      (
        _customerId: string,
        _externalCallContext: ExternalCallContext,
      ) => ({
        ok: true as const,
        value: [{
          label: 'Home',
          line1: '10 Nguyễn Huệ',
          district: 'Quận 1',
          city: 'Hồ Chí Minh',
        }],
        message: 'private saved-address provider prose',
      }),
    ),
    recentOrder: vi.fn(
      (
        _customerId: string,
        _externalCallContext: ExternalCallContext,
      ) => ({
        ok: true as const,
        value: recentOrder(),
        message: 'private recent-order provider prose',
      }),
    ),
    favoriteItems: vi.fn(
      (
        _customerId: string,
        _externalCallContext: ExternalCallContext,
      ) => ({
        ok: true as const,
        value: [favorite],
        message: 'private favorite-item provider prose',
      }),
    ),
  };
}

function clientsWithProviders(
  providers: ReturnType<typeof providerSpies>,
): ExternalClients {
  return createMockClients(createTestFixtures(), {
    savedAddressesProvider: providers.savedAddresses,
    recentOrderProvider: providers.recentOrder,
    favoriteItemsProvider: providers.favoriteItems,
  });
}

async function executeCustomerReadBatch(input: {
  calls?: readonly ParallelReadBatchCall[];
  clients: ExternalClients;
  accessContext: CustomerAccessContext;
}): Promise<readonly {
  readonly id: string;
  readonly result: AgentToolCallResult;
}[]> {
  const currentState = state();
  const callContext = externalCallContext();
  const results = await executeParallelReadBatch({
    calls: input.calls ?? customerReadCalls,
    stateSnapshot: {
      sessionId: currentState.sessionId,
      customerId: currentState.customerId,
      channel: currentState.channel,
    },
    externalCallContext: callContext,
    execute: async (execution) => {
      expect(execution.stateSnapshot).toEqual({
        sessionId: 'parallel-customer-session',
        customerId: 'state-owned-customer',
        channel: 'kfc',
      });
      expect(Object.isFrozen(execution.stateSnapshot)).toBe(true);
      return executeAgentToolCall(
        input.clients,
        execution.request,
        executorContext({
          currentState,
          accessContext: input.accessContext,
          externalCallContext: execution.externalCallContext,
        }),
      );
    },
  });
  return results;
}

describe('parallel authenticated customer-context reads', () => {
  it('admits exactly the three strict empty-argument customer reads', () => {
    expect(parallelReadBatchEligibility(customerReadCalls)).toEqual({
      ok: true,
    });

    for (const call of customerReadCalls) {
      expect(parallelReadBatchEligibility([{
        ...call,
        arguments: {
          customerId: 'model-selected-customer',
        },
      } as unknown as ParallelReadBatchCall])).toEqual({
        ok: false,
        errorCode: 'parallel_read_batch_invalid_arguments',
      });
    }
  });

  it('executes one mixed three-read batch with exact call ids and state-owned customer authority', async () => {
    const providers = providerSpies();
    const results = await executeCustomerReadBatch({
      clients: clientsWithProviders(providers),
      accessContext: access(['customer:read', 'order:read']),
    });

    expect(results.map(({ id }) => id)).toEqual(
      customerReadCalls.map(({ id }) => id),
    );
    expect(results.map(({ result }) => result.toolName)).toEqual([
      'getSavedAddresses',
      'getRecentOrder',
      'getFavoriteItems',
    ]);
    expect(results.every(({ result }) => result.ok)).toBe(true);
    for (const provider of [
      providers.savedAddresses,
      providers.recentOrder,
      providers.favoriteItems,
    ]) {
      expect(provider).toHaveBeenCalledTimes(1);
      expect(provider.mock.calls[0]?.[0]).toBe('state-owned-customer');
    }
    const sharedContext = providers.savedAddresses.mock.calls[0]?.[1];
    expect(sharedContext).toBeDefined();
    expect(providers.recentOrder.mock.calls[0]?.[1]).toBe(sharedContext);
    expect(providers.favoriteItems.mock.calls[0]?.[1]).toBe(sharedContext);
    expect(JSON.stringify(results)).not.toContain('private');
    expect(JSON.stringify(results)).not.toContain(
      'model-selected-customer',
    );
  });

  it('isolates the recent-order order:read failure while authorized reads complete', async () => {
    const providers = providerSpies();
    const results = await executeCustomerReadBatch({
      clients: clientsWithProviders(providers),
      accessContext: access(['customer:read']),
    });

    expect(results).toMatchObject([
      {
        id: customerReadCalls[0].id,
        result: { ok: true, toolName: 'getSavedAddresses' },
      },
      {
        id: customerReadCalls[1].id,
        result: {
          ok: false,
          toolName: 'getRecentOrder',
          errorCode: 'authorization_required',
          message:
            'Customer access context does not grant order:read',
        },
      },
      {
        id: customerReadCalls[2].id,
        result: { ok: true, toolName: 'getFavoriteItems' },
      },
    ]);
    expect(providers.savedAddresses).toHaveBeenCalledTimes(1);
    expect(providers.recentOrder).not.toHaveBeenCalled();
    expect(providers.favoriteItems).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(results)).not.toContain('private');
  });

  it.each([
    ['getSavedAddresses', customerReadCalls[0].id],
    ['getRecentOrder', customerReadCalls[1].id],
    ['getFavoriteItems', customerReadCalls[2].id],
  ] satisfies readonly [ToolName, string][])(
    'retains an isolated typed authorization failure for %s without provider dispatch',
    async (toolName, id) => {
      const providers = providerSpies();
      const call = customerReadCalls.find(
        (candidate) => candidate.toolName === toolName,
      );
      if (!call) throw new Error('customer_read_call_fixture_missing');

      const results = await executeCustomerReadBatch({
        calls: [call],
        clients: clientsWithProviders(providers),
        accessContext: access([]),
      });

      expect(results).toMatchObject([{
        id,
        result: {
          ok: false,
          toolName,
          errorCode: 'authorization_required',
          message:
            'Customer access context does not grant customer:read',
          provenance: [],
        },
      }]);
      expect(providers.savedAddresses).not.toHaveBeenCalled();
      expect(providers.recentOrder).not.toHaveBeenCalled();
      expect(providers.favoriteItems).not.toHaveBeenCalled();
      expect(JSON.stringify(results)).not.toContain('private');
      expect(JSON.stringify(results)).not.toContain(
        'state-owned-customer',
      );
    },
  );
});
