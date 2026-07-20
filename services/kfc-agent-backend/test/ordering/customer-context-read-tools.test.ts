import { isToolMessage } from '@langchain/core/messages';
import { fakeModel } from '@langchain/core/testing';
import { MemorySaver } from '@langchain/langgraph';
import { describe, expect, it, vi } from 'vitest';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import type {
  ExternalCallContext,
  ExternalClients,
} from '../../src/clients/interfaces.js';
import type {
  Address,
  CustomerAccessContext,
  MenuItem,
  Order,
  ToolResult,
} from '../../src/domain/types.js';
import type { AgentTurnInput } from '../../src/graph/agentTurnState.js';
import { runAgentTurn } from '../../src/graph/buildGraph.js';
import type { AgentGraphState } from '../../src/graph/state.js';
import {
  applyToolResultToState,
  buildVerifiedStateSnapshot,
} from '../../src/graph/verifiedState.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import {
  executeAgentToolCall,
  type AgentToolExecutorContext,
} from '../../src/ordering/agentToolExecutor.js';
import {
  agentToolArgumentSchemas,
  agentToolDescriptions,
  toolArgumentSchemas,
  toolNames,
} from '../../src/ordering/toolCatalog.js';
import {
  getToolBoundary,
  responseVerificationRequirementForTool,
} from '../../src/ordering/toolBoundaries.js';
import type {
  AgentToolCallResult,
  ToolCallRequest,
  ToolCallResult,
  ToolTraceEntry,
} from '../../src/ordering/types.js';
import { controlledCustomerAccess } from '../fixtures/controlledCustomerAccess.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';
import {
  groundedResponseModelReply,
  groundedResponseVerifierModel,
} from '../fixtures/groundedResponse.js';

const customerReadToolNames = [
  'getSavedAddresses',
  'getRecentOrder',
  'getFavoriteItems',
] as const;

function externalCallContext(): ExternalCallContext {
  return {
    signal: new AbortController().signal,
    deadlineAt: Date.now() + 60_000,
  };
}

function state(overrides: Partial<AgentGraphState> = {}): AgentGraphState {
  return {
    sessionId: 'customer-context-session',
    customerId: 'authenticated-customer',
    channel: 'kfc',
    latestUserMessage: '',
    userConfirmedOrder: false,
    escalationReasons: [],
    retrievedEvidence: [],
    toolTrace: [],
    ...overrides,
  };
}

function access(overrides: Partial<CustomerAccessContext> = {}):
  CustomerAccessContext {
  return {
    ...controlledCustomerAccess({
      sessionId: 'customer-context-session',
      customerId: 'authenticated-customer',
    }),
    ...overrides,
  };
}

function executorContext(
  currentState: AgentGraphState,
  overrides: Partial<AgentToolExecutorContext> = {},
): AgentToolExecutorContext {
  return {
    state: currentState,
    accessContext: access(),
    externalCallContext: externalCallContext(),
    ...overrides,
  };
}

function turnInput(
  clients: ExternalClients,
  accessContext: CustomerAccessContext,
): AgentTurnInput {
  return {
    sessionId: 'customer-context-session',
    customerId: 'authenticated-customer',
    channel: 'kfc',
    text: 'Use authenticated customer context',
    accessContext,
    clients,
    store: new MemoryStore(),
    dashboard: new DashboardEventBus(),
  };
}

function recentOrder(): Order {
  return {
    id: 'recent-order-provider-1',
    cart: {
      id: 'historical-cart-provider-1',
      items: [{
        itemCode: '20751',
        name: 'Verified recent item',
        quantity: 1,
        unitPriceVnd: 99_000,
      }],
      subtotalVnd: 99_000,
      discountVnd: 0,
      deliveryFeeVnd: 18_000,
      totalVnd: 117_000,
      voucherCode: null,
    },
    status: 'created',
    paymentStatus: 'pending',
    assignedStoreId: 'KFCVN0318',
    createdAt: '2026-07-20T00:00:00.000Z',
  };
}

function applySuccessfulResult(
  input: AgentTurnInput,
  currentState: AgentGraphState,
  result: AgentToolCallResult,
  currentTurnToolTrace: ToolTraceEntry[],
): void {
  if (
    !result.ok ||
    !customerReadToolNames.includes(
      result.toolName as (typeof customerReadToolNames)[number],
    )
  ) {
    throw new Error('customer context read result was not successful');
  }
  applyToolResultToState(
    input,
    currentState,
    result as ToolCallResult,
    {},
    currentTurnToolTrace,
  );
}

describe('authenticated customer-context read tools', () => {
  it.each(customerReadToolNames)(
    'exposes %s with a strict empty-object model schema',
    (toolName) => {
      expect(toolNames).toContain(toolName);
      expect(toolArgumentSchemas[toolName].safeParse({}).success).toBe(true);
      expect(agentToolArgumentSchemas[toolName].safeParse({}).success)
        .toBe(true);
      expect(
        toolArgumentSchemas[toolName].safeParse({
          customerId: 'attacker-selected-customer',
        }).success,
      ).toBe(false);
      expect(
        agentToolArgumentSchemas[toolName].safeParse({
          customerId: 'attacker-selected-customer',
        }).success,
      ).toBe(false);
      expect(agentToolDescriptions[toolName]).toContain('authenticated');
      expect(agentToolDescriptions[toolName]).toContain('read-only evidence');
      expect(getToolBoundary(toolName)).toBe('customer');
      expect(responseVerificationRequirementForTool(toolName))
        .toBe('online_semantic');
    },
  );

  it.each([
    ['missing', undefined, 'authentication_required'],
    [
      'mismatched customer',
      access({ kfcSubjectRef: 'different-customer' }),
      'access_context_mismatch',
    ],
    [
      'expired',
      access({
        authenticationEvidence: {
          state: 'verified',
          method: 'controlled-test',
          issuer: 'controlled-test',
          audience: 'kfc-agent-backend',
          authenticatedAt: '2026-07-14T00:00:00.000Z',
          expiresAt: '2026-07-15T00:00:00.000Z',
          evidenceRef: 'expired-evidence',
        },
      }),
      'authentication_required',
    ],
  ] as const)(
    'rejects %s access before the customer provider is called',
    async (_label, accessContext, errorCode) => {
      const provider = vi.fn(() => ({
        ok: true,
        value: [],
        message: 'must not be reached',
      }));
      const clients = createMockClients(createTestFixtures(), {
        savedAddressesProvider: provider,
      });

      const result = await executeAgentToolCall(
        clients,
        { toolName: 'getSavedAddresses', arguments: {} },
        executorContext(state(), { accessContext }),
      );

      expect(result).toMatchObject({ ok: false, errorCode });
      expect(provider).not.toHaveBeenCalled();
    },
  );

  it('injects the exact authenticated customer id and shared external-call context', async () => {
    const callContext = externalCallContext();
    const provider = vi.fn(
      (
        customerId: string,
        receivedContext: ExternalCallContext,
      ): ToolResult<Address[]> => ({
        ok: true,
        value: [{
          label: 'Provider address',
          line1: '60 Phạm Văn Nghị',
          district: 'Quận 7',
          city: 'Hồ Chí Minh',
        }],
        message:
          `private upstream prose for ${customerId} must not reach the model`,
      }),
    );
    const clients = createMockClients(createTestFixtures(), {
      savedAddressesProvider: provider,
    });

    const result = await executeAgentToolCall(
      clients,
      { toolName: 'getSavedAddresses', arguments: {} },
      executorContext(state(), { externalCallContext: callContext }),
    );

    expect(result).toMatchObject({
      ok: true,
      toolName: 'getSavedAddresses',
      value: [{ label: 'Provider address' }],
      message: 'Retrieved 1 verified saved-address record(s)',
    });
    expect(provider).toHaveBeenCalledWith(
      'authenticated-customer',
      callContext,
    );
    expect(JSON.stringify(result)).not.toContain('private upstream prose');
  });

  it('requires order:read in addition to customer:read for recent-order evidence', async () => {
    const provider = vi.fn(() => ({
      ok: true,
      value: recentOrder(),
      message: 'must not be reached',
    }));
    const clients = createMockClients(createTestFixtures(), {
      recentOrderProvider: provider,
    });
    const customerOnly = access({ authorizedScopes: ['customer:read'] });

    await expect(executeAgentToolCall(
      clients,
      { toolName: 'getRecentOrder', arguments: {} },
      executorContext(state(), { accessContext: customerOnly }),
    )).resolves.toMatchObject({
      ok: false,
      errorCode: 'authorization_required',
    });
    expect(provider).not.toHaveBeenCalled();
  });

  it('returns typed empty and null evidence without inventing customer history', async () => {
    const clients = createMockClients(createTestFixtures(), {
      savedAddressesProvider: () => ({
        ok: true,
        value: [],
        message: 'upstream empty addresses',
      }),
      recentOrderProvider: () => ({
        ok: true,
        value: null,
        message: 'upstream empty order',
      }),
      favoriteItemsProvider: () => ({
        ok: true,
        value: [],
        message: 'upstream empty favorites',
      }),
    });
    const currentState = state();
    const context = executorContext(currentState);

    await expect(executeAgentToolCall(
      clients,
      { toolName: 'getSavedAddresses', arguments: {} },
      context,
    )).resolves.toMatchObject({ ok: true, value: [] });
    await expect(executeAgentToolCall(
      clients,
      { toolName: 'getRecentOrder', arguments: {} },
      context,
    )).resolves.toMatchObject({ ok: true, value: null });
    await expect(executeAgentToolCall(
      clients,
      { toolName: 'getFavoriteItems', arguments: {} },
      context,
    )).resolves.toMatchObject({ ok: true, value: [] });
  });

  it('fails closed on provider failure, rejection, or a missing typed result without exposing provider details', async () => {
    const failedClients = createMockClients(createTestFixtures(), {
      recentOrderProvider: () => ({
        ok: false,
        errorCode: 'private-provider-code',
        message: 'private provider failure includes customer facts',
        provenance: [{
          fixtureMode: 'provider_runtime',
          sourceFile: 'secret-private-provenance-file',
          sourceApi: 'secret-private-provenance-api',
        }],
      }),
    });
    const rejectedClients = createMockClients(createTestFixtures(), {
      recentOrderProvider: async () => {
        throw new Error(
          'private rejected promise includes authenticated-customer facts',
        );
      },
    });
    const missingClients = createMockClients(createTestFixtures(), {
      recentOrderProvider: () => ({
        ok: true,
        value: undefined,
        message: 'private provider result omission',
      }),
    });
    const request = {
      toolName: 'getRecentOrder',
      arguments: {},
    } satisfies ToolCallRequest;

    const failed = await executeAgentToolCall(
      failedClients,
      request,
      executorContext(state()),
    );
    const rejected = await executeAgentToolCall(
      rejectedClients,
      request,
      executorContext(state()),
    );
    const missing = await executeAgentToolCall(
      missingClients,
      request,
      executorContext(state()),
    );

    expect(failed).toMatchObject({
      ok: false,
      errorCode: 'customer_context_provider_failed',
      message: 'Authenticated customer-context lookup failed',
    });
    expect(rejected).toMatchObject({
      ok: false,
      errorCode: 'customer_context_provider_failed',
      message: 'Authenticated customer-context lookup failed',
    });
    expect(missing).toMatchObject({
      ok: false,
      errorCode: 'customer_context_result_missing',
      message:
        'Authenticated customer-context lookup returned no typed result',
    });
    expect([failed, rejected, missing].map(({ provenance }) => provenance))
      .toEqual([
        [{
          fixtureMode: 'provider_runtime',
          sourceFile: 'src/ordering/customerContextReadTools.ts',
          sourceApi: 'customer-context-provider:getRecentOrder',
        }],
        [{
          fixtureMode: 'provider_runtime',
          sourceFile: 'src/ordering/customerContextReadTools.ts',
          sourceApi: 'customer-context-provider:getRecentOrder',
        }],
        [{
          fixtureMode: 'provider_runtime',
          sourceFile: 'src/ordering/customerContextReadTools.ts',
          sourceApi: 'customer-context-provider:getRecentOrder',
        }],
      ]);
    expect(JSON.stringify([failed, rejected, missing])).not.toContain(
      'authenticated-customer',
    );
    expect(JSON.stringify([failed, rejected, missing])).not.toContain(
      'private',
    );
  });

  it('runtime-validates provider values and projects only response-safe fields', async () => {
    const fixtures = createTestFixtures();
    const favorite = {
      ...fixtures.menuItems[0]!,
      internalCustomerScore: 0.98,
    } as MenuItem;
    const addressWithPrivateExtras = {
      label: 'Home',
      line1: '10 Nguyễn Huệ',
      district: 'Quận 1',
      city: 'Hồ Chí Minh',
      phoneNumber: 'must-not-be-projected',
      providerInternalNote: 'must-not-be-projected',
    } as Address;
    const orderWithInternalFields = {
      ...recentOrder(),
      posTicketId: 'must-not-be-projected',
      commerceOrderId: 'must-not-be-projected',
      providerInternalNote: 'must-not-be-projected',
    } as Order;
    const clients = createMockClients(fixtures, {
      savedAddressesProvider: () => ({
        ok: true,
        value: [addressWithPrivateExtras],
        message: 'upstream addresses',
      }),
      recentOrderProvider: () => ({
        ok: true,
        value: orderWithInternalFields,
        message: 'upstream order',
      }),
      favoriteItemsProvider: () => ({
        ok: true,
        value: [favorite],
        message: 'upstream favorites',
      }),
    });
    const context = executorContext(state());

    const addresses = await executeAgentToolCall(
      clients,
      { toolName: 'getSavedAddresses', arguments: {} },
      context,
    );
    const order = await executeAgentToolCall(
      clients,
      { toolName: 'getRecentOrder', arguments: {} },
      context,
    );
    const favorites = await executeAgentToolCall(
      clients,
      { toolName: 'getFavoriteItems', arguments: {} },
      context,
    );

    expect(addresses).toMatchObject({
      ok: true,
      value: [{
        label: 'Home',
        line1: '10 Nguyễn Huệ',
        district: 'Quận 1',
        city: 'Hồ Chí Minh',
      }],
    });
    expect(order).toMatchObject({
      ok: true,
      value: {
        id: 'recent-order-provider-1',
        cart: { id: 'historical-cart-provider-1' },
      },
    });
    expect(favorites).toMatchObject({
      ok: true,
      value: [{
        code: favorite.code,
        categoryId: favorite.categoryId,
        name: favorite.name,
        priceVnd: favorite.priceVnd,
      }],
    });
    expect(JSON.stringify([addresses, order, favorites])).not.toContain(
      'must-not-be-projected',
    );
    if (!favorites.ok || favorites.toolName !== 'getFavoriteItems') {
      throw new Error('favorite evidence missing');
    }
    expect(JSON.stringify(favorites.value)).not.toContain('provenance');
    expect(JSON.stringify(favorites.value)).not.toContain(
      'internalCustomerScore',
    );
  });

  it('keeps status-only ETA out of the getRecentOrder result and real ToolMessage', async () => {
    const now = Date.now();
    const orderWithStatusEvidence: Order = {
      ...recentOrder(),
      deliveryEstimate: {
        kind: 'remaining_delivery_window',
        minMinutes: 25,
        maxMinutes: 30,
        observedAt: new Date(now - 1_000).toISOString(),
        expiresAt: new Date(now + 5 * 60_000).toISOString(),
        providerRevision: 'customer-client:status-only-revision',
      },
    };
    const clients = createMockClients(createTestFixtures());
    clients.customer.getRecentOrder = async () => ({
      ok: true,
      value: orderWithStatusEvidence,
      message: 'provider recent order includes ETA 25 minutes',
      provenance: [],
    });
    const trustedAccess = access();
    const direct = await executeAgentToolCall(
      clients,
      { toolName: 'getRecentOrder', arguments: {} },
      executorContext(state(), { accessContext: trustedAccess }),
    );

    expect(direct).toMatchObject({
      ok: true,
      toolName: 'getRecentOrder',
      value: {
        id: orderWithStatusEvidence.id,
        status: orderWithStatusEvidence.status,
      },
    });
    expect(JSON.stringify(direct)).not.toContain('deliveryEstimate');
    expect(JSON.stringify(direct)).not.toContain(
      'customer-client:status-only-revision',
    );
    expect(JSON.stringify(direct)).not.toContain(
      'provider recent order includes ETA 25 minutes',
    );

    const model = fakeModel()
      .respondWithTools([{ name: 'getRecentOrder', args: {} }])
      .respond(groundedResponseModelReply({
        customerText: 'I can help with the verified account context.',
      }));
    await runAgentTurn({
      ...turnInput(clients, trustedAccess),
      externalMessageId: 'customer-context-status-evidence',
      agentModel: model,
      responseVerifierModel: groundedResponseVerifierModel(),
      checkpointer: new MemorySaver(),
    });

    const toolMessage = model.calls[1]?.messages.find(isToolMessage);
    expect(toolMessage).toBeDefined();
    if (!toolMessage || typeof toolMessage.content !== 'string') {
      throw new Error('real_recent_order_tool_message_missing');
    }
    const receipt = JSON.parse(
      toolMessage.content,
    ) as Record<string, unknown>;
    expect(receipt).toEqual({
      schemaVersion: 'kfc-checkpoint-tool-evidence-receipt-v2',
      evidenceId: expect.stringMatching(
        /^current:getRecentOrder:[a-f0-9]{64}$/u,
      ),
      evidenceDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
      toolCallId: expect.any(String),
      toolName: 'getRecentOrder',
      executionOutcome: 'success',
      result: 'audit_evidence_reference',
    });
    expect(receipt.evidenceId).toBe(
      `current:getRecentOrder:${receipt.evidenceDigest}`,
    );
    expect(toolMessage.content).not.toContain('"status":"created"');
    expect(toolMessage.content).not.toContain('deliveryEstimate');
    expect(toolMessage.content).not.toContain(
      'customer-client:status-only-revision',
    );
    expect(toolMessage.content).not.toContain(
      'provider recent order includes ETA 25 minutes',
    );
  });

  it('fails closed when a provider success payload violates the runtime schema', async () => {
    const clients = createMockClients(createTestFixtures(), {
      savedAddressesProvider: () => ({
        ok: true,
        value: [{
          label: 'Invalid address',
          line1: '',
          district: 'Quận 1',
          city: 'Hồ Chí Minh',
        }],
        message: 'invalid provider payload',
      }),
    });

    await expect(executeAgentToolCall(
      clients,
      { toolName: 'getSavedAddresses', arguments: {} },
      executorContext(state()),
    )).resolves.toMatchObject({
      ok: false,
      errorCode: 'customer_context_result_invalid',
      message:
        'Authenticated customer-context lookup returned an invalid result',
    });
  });

  it('reads fresh provider evidence without copying historical context into active state or durable snapshots', async () => {
    const firstAddress: Address = {
      label: 'Fresh provider address 1',
      line1: '1 Nguyễn Huệ',
      district: 'Quận 1',
      city: 'Hồ Chí Minh',
    };
    const secondAddress: Address = {
      label: 'Fresh provider address 2',
      line1: '2 Lê Lợi',
      district: 'Quận 1',
      city: 'Hồ Chí Minh',
    };
    const provider = vi
      .fn<() => ToolResult<Address[]>>()
      .mockReturnValueOnce({
        ok: true,
        value: [firstAddress],
        message: 'first upstream result',
        provenance: [{
          fixtureMode: 'provider_runtime',
          sourceFile: 'secret-private-provenance-file',
          sourceUrl:
            'https://private.example.test/customer/secret-private-provenance',
          sourceApi: 'secret-private-provenance-api',
        }],
      })
      .mockReturnValueOnce({
        ok: true,
        value: [secondAddress],
        message: 'second upstream result',
      });
    const clients = createMockClients(createTestFixtures(), {
      savedAddressesProvider: provider,
    });
    const activeAddress: Address = {
      label: 'Active address',
      line1: '99 Active Street',
      district: 'Quận 3',
      city: 'Hồ Chí Minh',
    };
    const activeOrder = recentOrder();
    const currentState = state({
      address: activeAddress,
      cart: activeOrder.cart,
      order: activeOrder,
      customerContext: undefined,
    });
    const trustedAccess = access();
    const input = turnInput(clients, trustedAccess);
    const trace: ToolTraceEntry[] = [];

    const first = await executeAgentToolCall(
      clients,
      { toolName: 'getSavedAddresses', arguments: {} },
      executorContext(currentState, { accessContext: trustedAccess }),
    );
    applySuccessfulResult(input, currentState, first, trace);
    const second = await executeAgentToolCall(
      clients,
      { toolName: 'getSavedAddresses', arguments: {} },
      executorContext(currentState, { accessContext: trustedAccess }),
    );
    applySuccessfulResult(input, currentState, second, trace);

    expect(first).toMatchObject({ ok: true, value: [firstAddress] });
    expect(second).toMatchObject({ ok: true, value: [secondAddress] });
    expect(provider).toHaveBeenCalledTimes(2);
    expect(currentState).toMatchObject({
      address: activeAddress,
      cart: activeOrder.cart,
      order: activeOrder,
    });
    expect(currentState.customerContext).toBeUndefined();
    expect(trace.map(({ toolName }) => toolName)).toEqual([
      'getSavedAddresses',
      'getSavedAddresses',
    ]);
    expect(trace.map(({ provenance }) => provenance)).toEqual([
      [{
        fixtureMode: 'provider_runtime',
        sourceFile: 'src/ordering/customerContextReadTools.ts',
        sourceApi: 'customer-context-provider:getSavedAddresses',
      }],
      [{
        fixtureMode: 'provider_runtime',
        sourceFile: 'src/ordering/customerContextReadTools.ts',
        sourceApi: 'customer-context-provider:getSavedAddresses',
      }],
    ]);
    const persisted = buildVerifiedStateSnapshot(currentState);
    expect(persisted.customerContext).toBeUndefined();
    expect(JSON.stringify(persisted)).not.toContain(firstAddress.line1);
    expect(JSON.stringify(persisted)).not.toContain(secondAddress.line1);
    expect(JSON.stringify([first, trace, persisted])).not.toContain(
      'secret-private-provenance',
    );
    expect(JSON.stringify([first, trace, persisted])).not.toContain(
      'private.example.test',
    );
  });
});
