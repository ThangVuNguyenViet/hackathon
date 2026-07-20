import {
  isToolMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import { fakeModel } from '@langchain/core/testing';
import { MemorySaver } from '@langchain/langgraph';
import { describe, expect, it } from 'vitest';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import type { Order } from '../../src/domain/types.js';
import type { AgentTurnInput } from '../../src/graph/agentTurnState.js';
import { runAgentTurn } from '../../src/graph/buildGraph.js';
import type { AgentGraphState } from '../../src/graph/state.js';
import {
  buildModelPublicationBundle,
  issueModelPublicationAuthority,
} from '../../src/agent/modelPublicationProjection.js';
import {
  freshMessages,
  loadTurnState,
  persistCompletedTurn,
} from '../../src/agent/singleAgentRuntime.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import {
  hydrateRecentOrderContext,
  persistVerifiedStateSnapshot,
} from '../../src/graph/verifiedState.js';
import { createNoopAgentTracer } from '../../src/observability/agentTracing.js';
import { controlledCustomerAccess } from '../fixtures/controlledCustomerAccess.js';
import {
  groundedResponseModelReply,
} from '../fixtures/groundedResponse.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';

function orderWithEstimate(input: {
  observedAt: string;
  expiresAt: string;
  providerRevision: string;
}): Order {
  return {
    id: 'KFC-1024',
    status: 'preparing',
    paymentStatus: 'paid',
    assignedStoreId: 'store-1',
    createdAt: '2026-07-20T01:45:00.000Z',
    deliveryEstimate: {
      kind: 'remaining_delivery_window',
      minMinutes: 25,
      maxMinutes: 30,
      ...input,
    },
    cart: {
      id: 'cart-1',
      items: [],
      subtotalVnd: 0,
      discountVnd: 0,
      deliveryFeeVnd: 0,
      totalVnd: 0,
      voucherCode: null,
    },
  };
}

function graphState(order: Order): AgentGraphState {
  const currentUserTurn = {
    id: 'eta-status-turn',
    sessionId: 'eta-freshness-session',
    channel: 'kfc' as const,
    role: 'user' as const,
    text: 'Check the current order status',
    externalMessageId: 'eta-status-message',
    externalUserId: 'eta-user',
    deliveryStatus: 'received' as const,
    metadata: null,
    createdAt: '2026-07-20T00:00:00.000Z',
  };
  return {
    sessionId: currentUserTurn.sessionId,
    customerId: 'eta-customer',
    channel: currentUserTurn.channel,
    latestUserMessage: currentUserTurn.text,
    recentTurns: [currentUserTurn],
    order,
    userConfirmedOrder: false,
    escalationReasons: [],
    retrievedEvidence: [],
  };
}

async function responseEvidence(state: AgentGraphState) {
  const currentUserTurn = state.recentTurns
    ?.filter((turn) => turn.role === 'user')
    .at(-1);
  if (!currentUserTurn) throw new Error('current user turn missing');
  const authority = await issueModelPublicationAuthority({
    state,
    currentUserTurn,
    accessContext: controlledCustomerAccess({
      sessionId: state.sessionId,
      customerId: state.customerId,
      channel: state.channel,
    }),
  });
  return (await buildModelPublicationBundle({
    state,
    authority,
  })).evidence;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

function publicationContext(
  messages: BaseMessage[],
): Record<string, unknown> {
  for (const message of messages) {
    if (typeof message.content !== 'string') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(message.content);
    } catch {
      continue;
    }
    if (isRecord(parsed) && isRecord(parsed.publication)) {
      return parsed.publication;
    }
  }
  throw new Error('model_publication_context_missing');
}

function stateWithRecentOrder(
  activeOrder: Order,
  recentOrder: Order,
): AgentGraphState {
  return {
    ...graphState(activeOrder),
    customerContext: {
      savedAddresses: [],
      favorites: [],
      recentOrders: [recentOrder],
    },
  };
}

function turnInput(store: MemoryStore): AgentTurnInput {
  return {
    sessionId: 'eta-freshness-session',
    customerId: 'eta-customer',
    channel: 'kfc',
    text: 'Can you help with something else?',
    externalMessageId: 'eta-follow-up',
    clients: createMockClients(createTestFixtures()),
    store,
    dashboard: new DashboardEventBus(),
  };
}

describe('persisted order-status ETA freshness', () => {
  it('keeps unexpired ETA in publication evidence without provider metadata', async () => {
    const now = Date.now();
    const currentOrder = orderWithEstimate({
      observedAt: new Date(now - 1_000).toISOString(),
      expiresAt: new Date(now + 5 * 60_000).toISOString(),
      providerRevision: 'mock-oms:KFC-1024:current-revision',
    });
    const store = new MemoryStore();
    await persistVerifiedStateSnapshot(store, graphState(currentOrder));

    const input = turnInput(store);
    const loaded = await loadTurnState(input);
    const prompt = freshMessages(
      loaded.state,
      input,
      loaded.currentUserTurn,
    ).map((message) => String(message.content)).join('\n');
    const orderEvidence = (await responseEvidence(loaded.state))
      .find((entry) => entry.evidenceId === 'order');

    expect(loaded.state.order?.deliveryEstimate)
      .toEqual(currentOrder.deliveryEstimate);
    expect(prompt).not.toContain('current-revision');
    expect(orderEvidence?.value).toMatchObject({
      deliveryEstimate: {
        kind: 'remaining_delivery_window',
        minMinutes: 25,
        maxMinutes: 30,
        observedAt: currentOrder.deliveryEstimate?.observedAt,
        expiresAt: currentOrder.deliveryEstimate?.expiresAt,
      },
    });
    expect(JSON.stringify(orderEvidence)).not.toContain(
      'current-revision',
    );
  });

  it('removes expired ETA while loading state and building the next model prompt', async () => {
    const expiredOrder = orderWithEstimate({
      observedAt: '2026-07-14T00:00:00.000Z',
      expiresAt: '2026-07-14T00:05:00.000Z',
      providerRevision: 'mock-oms:KFC-1024:stale-revision',
    });
    const store = new MemoryStore();
    await persistVerifiedStateSnapshot(store, graphState(expiredOrder));

    const input = turnInput(store);
    const loaded = await loadTurnState(input);
    const messages = freshMessages(
      loaded.state,
      input,
      loaded.currentUserTurn,
    );
    const prompt = messages
      .map((message) => String(message.content))
      .join('\n');

    expect(loaded.state.order).toMatchObject({
      id: expiredOrder.id,
      status: expiredOrder.status,
    });
    expect(loaded.state.order?.deliveryEstimate).toBeUndefined();
    expect(prompt).not.toContain('stale-revision');
  });

  it('omits expired ETA from final response evidence while retaining order status', async () => {
    const expiredOrder = orderWithEstimate({
      observedAt: '2026-07-14T00:00:00.000Z',
      expiresAt: '2026-07-14T00:05:00.000Z',
      providerRevision: 'mock-oms:KFC-1024:stale-evidence',
    });

    const orderEvidence = (await responseEvidence(graphState(expiredOrder)))
      .find((entry) => entry.evidenceId === 'order');

    expect(orderEvidence?.value).toMatchObject({
      id: expiredOrder.id,
      status: expiredOrder.status,
    });
    expect((orderEvidence?.value as Order).deliveryEstimate).toBeUndefined();
    expect(JSON.stringify(orderEvidence)).not.toContain('stale-evidence');
  });

  it('removes expired ETA nested in persisted recent-order context', async () => {
    const now = Date.now();
    const activeOrder = orderWithEstimate({
      observedAt: new Date(now - 1_000).toISOString(),
      expiresAt: new Date(now + 5 * 60_000).toISOString(),
      providerRevision: 'mock-oms:KFC-1024:active-current',
    });
    const staleRecentOrder = orderWithEstimate({
      observedAt: '2026-07-14T00:00:00.000Z',
      expiresAt: '2026-07-14T00:05:00.000Z',
      providerRevision: 'mock-oms:KFC-1024:nested-stale',
    });
    const store = new MemoryStore();
    await persistVerifiedStateSnapshot(
      store,
      stateWithRecentOrder(activeOrder, staleRecentOrder),
    );

    const input = turnInput(store);
    const loaded = await loadTurnState(input);
    const prompt = freshMessages(
      loaded.state,
      input,
      loaded.currentUserTurn,
    ).map((message) => String(message.content)).join('\n');
    const evidence = await responseEvidence(loaded.state);

    expect(loaded.state.customerContext?.recentOrders[0])
      .toMatchObject({ id: staleRecentOrder.id, status: staleRecentOrder.status });
    expect(loaded.state.customerContext?.recentOrders[0])
      .not.toHaveProperty('deliveryEstimate');
    expect(prompt).not.toContain('nested-stale');
    expect(JSON.stringify(evidence)).not.toContain('nested-stale');
    expect(JSON.stringify(evidence)).not.toContain('active-current');
  });

  it('removes even unexpired ETA nested in non-status recent-order context', async () => {
    const now = Date.now();
    const activeOrder = orderWithEstimate({
      observedAt: new Date(now - 1_000).toISOString(),
      expiresAt: new Date(now + 5 * 60_000).toISOString(),
      providerRevision: 'mock-oms:KFC-1024:active-current',
    });
    const currentRecentOrder = orderWithEstimate({
      observedAt: new Date(now - 2_000).toISOString(),
      expiresAt: new Date(now + 4 * 60_000).toISOString(),
      providerRevision: 'mock-oms:KFC-1024:nested-current',
    });
    const store = new MemoryStore();
    await persistVerifiedStateSnapshot(
      store,
      stateWithRecentOrder(activeOrder, currentRecentOrder),
    );

    const input = turnInput(store);
    const loaded = await loadTurnState(input);
    const prompt = freshMessages(
      loaded.state,
      input,
      loaded.currentUserTurn,
    ).map((message) => String(message.content)).join('\n');
    const evidence = await responseEvidence(loaded.state);

    expect(loaded.state.customerContext?.recentOrders[0]).toMatchObject({
      id: currentRecentOrder.id,
      status: currentRecentOrder.status,
    });
    expect(loaded.state.customerContext?.recentOrders[0]?.deliveryEstimate)
      .toBeUndefined();
    expect(prompt).not.toContain('nested-current');
    expect(JSON.stringify(evidence)).not.toContain('nested-current');
    expect(JSON.stringify(evidence)).not.toContain('active-current');
  });

  it('removes expired ETA from final GenUI while retaining current order status', async () => {
    const expiredOrder = orderWithEstimate({
      observedAt: '2026-07-14T00:00:00.000Z',
      expiresAt: '2026-07-14T00:05:00.000Z',
      providerRevision: 'mock-oms:KFC-1024:genui-stale',
    });
    const store = new MemoryStore();
    const tracer = createNoopAgentTracer();
    const turnTrace = await tracer.startTurn({
      name: 'eta-genui-projection',
      inputs: {},
    });

    const output = await persistCompletedTurn({
      turnInput: {
        ...turnInput(store),
        responseProfile: 'genui',
      },
      turnTrace,
      state: graphState(expiredOrder),
      currentTurnToolTrace: [],
      responseText: 'Current order status is available.',
    });

    expect(output.state.order).toMatchObject({
      id: expiredOrder.id,
      status: expiredOrder.status,
    });
    expect(output.state.order?.deliveryEstimate).toBeUndefined();
    expect(output.genUi?.data.order).toMatchObject({
      id: expiredOrder.id,
      status: expiredOrder.status,
    });
    expect((output.genUi?.data.order as Order).deliveryEstimate)
      .toBeUndefined();
    expect(JSON.stringify(output.genUi)).not.toContain('genui-stale');
  });

  it('keeps stale provider ETA and message text out of the real ToolMessage', async () => {
    const verifiedOrder = orderWithEstimate({
      observedAt: '2026-07-14T00:00:00.000Z',
      expiresAt: '2026-07-14T00:05:00.000Z',
      providerRevision: 'persisted-copy-is-sanitized-before-the-turn',
    });
    verifiedOrder.deliveryEstimate = undefined;
    const staleProviderOrder = orderWithEstimate({
      observedAt: '2026-07-14T00:00:00.000Z',
      expiresAt: '2026-07-14T00:05:00.000Z',
      providerRevision: 'raw-provider-stale-revision',
    });
    staleProviderOrder.commerceOutcome =
      'Provider outcome says ETA 3 minutes';
    staleProviderOrder.commerceCustomerStatus =
      'Provider customer status revision is raw';
    staleProviderOrder.commerceProviderProvenance = {
      oms: {
        implementation: 'Provider implementation says ETA 2 minutes',
        source: 'raw-provider-order-provenance-revision',
      },
    };
    const store = new MemoryStore();
    await persistVerifiedStateSnapshot(store, graphState(verifiedOrder));

    const clients = createMockClients(createTestFixtures());
    clients.oms.getOrderStatus = async () => ({
      ok: true,
      value: staleProviderOrder,
      message:
        'Provider says ETA 5 minutes from raw-provider-stale-revision',
      provenance: [{
        fixtureMode: 'provider_runtime',
        sourceFile: 'Provider says ETA 4 minutes',
        sourceApi: 'raw-provider-provenance-revision',
      }],
    });
    const model = fakeModel()
      .respondWithTools([{
        name: 'getOrderStatus',
        args: {},
      }])
      .respond(groundedResponseModelReply({
        customerText: 'I checked the verified order status.',
      }));

    const output = await runAgentTurn({
      ...turnInput(store),
      clients,
      agentModel: model,
      checkpointer: new MemorySaver(),
      accessContext: controlledCustomerAccess({
        sessionId: 'eta-freshness-session',
        customerId: 'eta-customer',
      }),
    });

    const toolMessage = model.calls[1]?.messages.find(isToolMessage);
    expect(toolMessage).toBeDefined();
    if (
      !toolMessage ||
      typeof toolMessage.content !== 'string'
    ) {
      throw new Error('real_order_status_tool_message_missing');
    }
    const content: unknown = JSON.parse(toolMessage.content);
    const publication = publicationContext(
      model.calls[1]?.messages ?? [],
    );
    expect(content).toMatchObject({
      schemaVersion: 'kfc-checkpoint-tool-evidence-receipt-v2',
      executionOutcome: 'success',
      result: 'audit_evidence_reference',
      toolCallId: expect.any(String),
      toolName: 'getOrderStatus',
      evidenceId: expect.stringMatching(/^current:getOrderStatus:/u),
      evidenceDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
    expect(content).not.toHaveProperty('ok');
    expect(content).not.toHaveProperty('message');
    expect(content).not.toHaveProperty('value');
    expect(content).not.toHaveProperty('provenance');
    expect(publication.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        evidenceId: expect.stringMatching(/^current:getOrderStatus:/u),
        value: {
          status: staleProviderOrder.status,
          paymentStatus: staleProviderOrder.paymentStatus,
        },
      }),
    ]));
    expect(toolMessage.content).not.toContain('"deliveryEstimate"');
    expect(toolMessage.content).not.toContain('Provider says ETA 5 minutes');
    expect(toolMessage.content).not.toContain('Provider says ETA 4 minutes');
    expect(toolMessage.content).not.toContain('raw-provider-stale-revision');
    expect(toolMessage.content).not.toContain(
      'raw-provider-provenance-revision',
    );
    expect(toolMessage.content).not.toContain(
      'Provider outcome says ETA 3 minutes',
    );
    expect(toolMessage.content).not.toContain(
      'Provider customer status revision is raw',
    );
    expect(toolMessage.content).not.toContain(
      'Provider implementation says ETA 2 minutes',
    );
    expect(toolMessage.content).not.toContain(
      'raw-provider-order-provenance-revision',
    );
    expect(output.state.order).toMatchObject({
      id: verifiedOrder.id,
      status: staleProviderOrder.status,
    });
    expect(output.state.order?.deliveryEstimate).toBeUndefined();
  });

  it('does not hydrate status-only ETA through a custom recent-order client', async () => {
    const now = Date.now();
    const recentOrder = orderWithEstimate({
      observedAt: new Date(now - 1_000).toISOString(),
      expiresAt: new Date(now + 5 * 60_000).toISOString(),
      providerRevision: 'custom-recent-order:must-not-cross',
    });
    const store = new MemoryStore();
    const clients = createMockClients(createTestFixtures());
    clients.customer.getRecentOrder = async () => ({
      ok: true,
      value: recentOrder,
      message: 'custom_recent_order',
      provenance: [],
    });
    const input = {
      ...turnInput(store),
      clients,
      accessContext: controlledCustomerAccess({
        sessionId: 'eta-freshness-session',
        customerId: 'eta-customer',
      }),
    };

    const hydrated = await hydrateRecentOrderContext(
      input,
      {},
      {
        customer: 'active',
        recentOrder: 'active',
        order: 'active',
      },
      {
        signal: new AbortController().signal,
        deadlineAt: Date.now() + 10_000,
      },
    );

    expect(hydrated.order).toMatchObject({
      id: recentOrder.id,
      status: recentOrder.status,
    });
    expect(hydrated.order).not.toHaveProperty('deliveryEstimate');
    expect(hydrated.customerContext?.recentOrders[0]).toMatchObject({
      id: recentOrder.id,
      status: recentOrder.status,
    });
    expect(hydrated.customerContext?.recentOrders[0])
      .not.toHaveProperty('deliveryEstimate');
    expect(JSON.stringify(hydrated)).not.toContain(
      'custom-recent-order:must-not-cross',
    );
  });
});
