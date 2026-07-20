import {
  AIMessage,
  isSystemMessage,
  type BaseMessage,
  type ToolCall,
} from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { fakeModel } from '@langchain/core/testing';
import { MemorySaver } from '@langchain/langgraph';
import type { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';
import {
  GROUNDED_RESPONSE_TOOL_NAME,
} from '../../src/agent/responseGrounding.js';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import type { Cart, Order } from '../../src/domain/types.js';
import { selectKfcGenUiAttachment } from '../../src/genui/kfcGenUiSelector.js';
import { runAgentTurn } from '../../src/graph/buildGraph.js';
import { stateRevision } from '../../src/graph/turnSupport.js';
import {
  loadPriorVerifiedState,
  verifiedStateToolTraceForPersistence,
} from '../../src/graph/verifiedState.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import {
  agentToolArgumentSchemas,
} from '../../src/ordering/toolCatalog.js';
import type {
  ToolName,
  ToolTraceEntry,
} from '../../src/ordering/types.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import {
  groundedResponseClaims,
  groundedResponseModelReply,
} from '../fixtures/groundedResponse.js';
import {
  controlledCustomerAccess,
} from '../fixtures/controlledCustomerAccess.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';

interface ToolBindingModel {
  bindTools: NonNullable<BaseChatModel['bindTools']>;
}

interface PublishedEvidence {
  evidenceId: string;
  publicationAuthority: string;
  privateData: boolean;
  value: unknown;
}

interface PublicationBundle {
  evidence: PublishedEvidence[];
}

interface PublicationResponseContract {
  selectedActionResponse: unknown;
  requiredShape: {
    factualClaims: {
      evidenceReferences: unknown;
      hasUnsupportedFactualClaim: unknown;
    };
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundToolNames(tools: unknown): string[] {
  if (!Array.isArray(tools)) return [];
  return tools.flatMap((candidate) =>
    isRecord(candidate) && typeof candidate.name === 'string'
      ? [candidate.name]
      : []
  );
}

function captureToolBindings(
  model: ReturnType<typeof fakeModel>,
): string[][] {
  const bindings: string[][] = [];
  const modelWithOptions: ToolBindingModel = model;
  const bindTools = modelWithOptions.bindTools.bind(modelWithOptions);
  vi.spyOn(modelWithOptions, 'bindTools').mockImplementation((
    tools,
    options,
  ) => {
    bindings.push(boundToolNames(tools));
    return bindTools(tools, options);
  });
  return bindings;
}

function parsedJson(message: BaseMessage): unknown {
  if (typeof message.content !== 'string') return undefined;
  try {
    return JSON.parse(message.content) as unknown;
  } catch {
    return undefined;
  }
}

function publicationBundle(
  messages: BaseMessage[],
): PublicationBundle | undefined {
  for (const message of [...messages].reverse()) {
    if (!isSystemMessage(message)) continue;
    const parsed = parsedJson(message);
    if (
      !isRecord(parsed) ||
      !isRecord(parsed.publication) ||
      !Array.isArray(parsed.publication.evidence)
    ) {
      continue;
    }
    const evidence = parsed.publication.evidence.flatMap((entry) =>
      isRecord(entry) &&
        typeof entry.evidenceId === 'string' &&
        typeof entry.publicationAuthority === 'string' &&
        typeof entry.privateData === 'boolean'
        ? [{
            evidenceId: entry.evidenceId,
            publicationAuthority: entry.publicationAuthority,
            privateData: entry.privateData,
            value: entry.value,
          }]
        : []);
    return { evidence };
  }
  return undefined;
}

function currentEvidence(
  messages: BaseMessage[],
  toolName: ToolName,
): PublishedEvidence | undefined {
  return publicationBundle(messages)?.evidence.find(
    (entry) =>
      entry.publicationAuthority === 'current_turn_authenticated' &&
      entry.evidenceId.startsWith(`current:${toolName}:`),
  );
}

function responseContract(
  messages: BaseMessage[],
): PublicationResponseContract | undefined {
  for (const message of [...messages].reverse()) {
    if (!isSystemMessage(message)) continue;
    const parsed = parsedJson(message);
    if (
      !isRecord(parsed) ||
      !isRecord(parsed.responseContract) ||
      !isRecord(parsed.responseContract.requiredShape) ||
      !isRecord(parsed.responseContract.requiredShape.factualClaims)
    ) {
      continue;
    }
    return {
      selectedActionResponse: parsed.responseContract.selectedActionResponse,
      requiredShape: {
        factualClaims: {
          evidenceReferences:
            parsed.responseContract.requiredShape.factualClaims
              .evidenceReferences,
          hasUnsupportedFactualClaim:
            parsed.responseContract.requiredShape.factualClaims
              .hasUnsupportedFactualClaim,
        },
      },
    };
  }
  return undefined;
}

async function serializedCheckpointHistory(
  checkpointer: MemorySaver,
): Promise<string> {
  const history: unknown[] = [];
  for await (
    const tuple of checkpointer.list({ configurable: {} })
  ) {
    history.push({
      checkpoint: tuple.checkpoint.channel_values,
      pendingWrites: tuple.pendingWrites,
    });
  }
  return JSON.stringify(history);
}

async function expectPrivateTraceAuditRecoverable(
  trace: ToolTraceEntry | undefined,
  rawTrace?: ToolTraceEntry,
): Promise<void> {
  expect(trace).toMatchObject({
    arguments: {
      privateArgumentsDigest:
        expect.stringMatching(/^[0-9a-f]{64}$/u),
    },
    publicationEvidenceAudit: {
      traceDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
      argumentsDigest:
        expect.stringMatching(/^[0-9a-f]{64}$/u),
    },
  });
  if (!trace?.publicationEvidenceAudit) {
    throw new Error('persisted_trace_audit_missing');
  }
  expect(trace.arguments.privateArgumentsDigest).toBe(
    trace.publicationEvidenceAudit.argumentsDigest,
  );
  await expect(stateRevision({
    toolName: trace.toolName,
    arguments: trace.arguments,
    ok: trace.ok,
    resultSummary: trace.resultSummary,
    provenance: trace.provenance,
  })).resolves.toBe(trace.publicationEvidenceAudit.traceDigest);
  if (rawTrace) {
    expect(verifiedStateToolTraceForPersistence(rawTrace)).toEqual(
      trace,
    );
  }
}

function authoredToolCall<Name extends ToolName>(
  name: Name,
  args: z.input<(typeof agentToolArgumentSchemas)[Name]>,
): ToolCall {
  return {
    name,
    args: agentToolArgumentSchemas[name].parse(args),
  };
}

function cart(id: string): Cart {
  return {
    id,
    items: [{
      itemCode: '20751',
      name: 'Provider order item',
      quantity: 1,
      unitPriceVnd: 99_000,
    }],
    subtotalVnd: 99_000,
    discountVnd: 0,
    deliveryFeeVnd: 18_000,
    totalVnd: 117_000,
    voucherCode: null,
  };
}

function order(input: {
  id: string;
  status?: Order['status'];
  paymentStatus?: Order['paymentStatus'];
}): Order {
  return {
    id: input.id,
    cart: cart(`${input.id}-cart`),
    status: input.status ?? 'created',
    paymentStatus: input.paymentStatus ?? 'pending',
    assignedStoreId: 'provider-store',
    createdAt: '2026-07-20T00:00:00.000Z',
  };
}

function groundedReply(input: {
  messages: BaseMessage[];
  tools: Array<{
    toolName: ToolName;
    claimKinds: Array<
      'order_id' | 'payment' | 'product' | 'status'
    >;
  }>;
  authorClaims: ReturnType<typeof groundedResponseClaims>;
  customerText: string;
}): AIMessage {
  const references = input.tools.flatMap(({ toolName, claimKinds }) => {
    const evidence = currentEvidence(input.messages, toolName);
    return evidence
      ? [{ evidenceId: evidence.evidenceId, claimKinds }]
      : [];
  });
  const disclosureAuthorities = input.tools.flatMap(({ toolName }) => {
    const evidence = currentEvidence(input.messages, toolName);
    return evidence?.privateData
      ? [{
          kind: 'publication_evidence' as const,
          evidenceId: evidence.evidenceId,
        }]
      : [];
  });
  input.authorClaims.evidenceReferences = references;
  return groundedResponseModelReply({
      customerText: input.customerText,
      evidenceReferences: references,
      publicationDeclaration: {
        semanticRelevance: 'aligned',
        privateDataDisclosure:
          disclosureAuthorities.length > 0 ? 'authorized' : 'none',
        disclosureAuthorities,
        disclosesInternalMetadata: false,
      },
    })(input.messages);
}

describe('maintained StateGraph authenticated order-context invariants', () => {
  it('reads one verified recent-order candidate with the ordinary nested response contract', async () => {
    const recent = order({ id: 'provider-personalized-candidate' });
    const recentOrderProvider = vi.fn(() => ({
      ok: true as const,
      value: recent,
      message: 'recent_order_candidate_observed',
    }));
    const clients = createMockClients(createTestFixtures(), {
      recentOrderProvider,
    });
    const authorClaims = groundedResponseClaims();
    const observedContracts: PublicationResponseContract[] = [];
    let submittedResponse: Record<string, unknown> | undefined;
    const model = fakeModel()
      .respond((messages) => {
        const contract = responseContract(messages);
        if (!contract) throw new Error('response_contract_missing');
        observedContracts.push(contract);
        return new AIMessage({
          content: '',
          tool_calls: [authoredToolCall('getRecentOrder', {})],
        });
      })
      .respond((messages) => {
        const contract = responseContract(messages);
        if (!contract) throw new Error('response_contract_missing');
        observedContracts.push(contract);
        const reply = groundedReply({
          messages,
          tools: [{
            toolName: 'getRecentOrder',
            claimKinds: ['order_id', 'product'],
          }],
          authorClaims,
          customerText:
            'Here is the exact verified recent-order candidate for confirmation.',
        });
        submittedResponse = isRecord(reply.tool_calls?.[0]?.args)
          ? reply.tool_calls[0]?.args
          : undefined;
        return reply;
      });
    const sessionId = 'kfc:personalized-candidate-contract';
    const customerId = 'personalized-candidate-contract';

    const output = await runAgentTurn({
      sessionId,
      customerId,
      channel: 'kfc',
      text: 'Please show the exact candidate from my recent order.',
      externalMessageId: 'personalized-candidate-contract-message',
      accessContext: controlledCustomerAccess({ sessionId, customerId }),
      clients,
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      checkpointer: new MemorySaver(),
      agentModel: model,
    });

    expect(recentOrderProvider).toHaveBeenCalledOnce();
    expect(model.callCount).toBe(2);
    expect(output.state.toolTrace?.map(({ toolName }) => toolName))
      .toEqual(['getRecentOrder']);
    expect(output.state.toolTrace?.map(({ toolName }) => toolName))
      .not.toEqual(expect.arrayContaining(['searchMenu', 'updateCart']));
    expect(output.state.cart).toBeUndefined();
    expect(observedContracts).toHaveLength(2);
    expect(observedContracts.every(
      ({ selectedActionResponse }) =>
        selectedActionResponse === null,
    )).toBe(true);
    expect(observedContracts[1]?.requiredShape.factualClaims)
      .toEqual({
        evidenceReferences: 'array',
        hasUnsupportedFactualClaim:
          'boolean required here, never at the top level',
      });
    expect(submittedResponse).toMatchObject({
      factualClaims: {
        evidenceReferences: [{
          evidenceId:
            expect.stringMatching(/^current:getRecentOrder:/u),
          claimKinds: ['order_id', 'product'],
        }],
        hasUnsupportedFactualClaim: false,
      },
      selectedActionResponse: null,
    });
    expect(submittedResponse).not.toHaveProperty(
      'hasUnsupportedFactualClaim',
    );
  });

  it('preserves an initial parallel private and public read batch in authored order', async () => {
    const recent = order({ id: 'provider-parallel-recent-order' });
    const recentOrderProvider = vi.fn(() => ({
      ok: true as const,
      value: recent,
      message: 'recent_order_observed',
    }));
    const clients = createMockClients(createTestFixtures(), {
      recentOrderProvider,
    });
    const searchMenu = vi.spyOn(clients.menu, 'searchMenu');
    const searchPromotions = vi.spyOn(
      clients.promotion,
      'searchPromotions',
    );
    const model = fakeModel()
      .respondWithTools([
        authoredToolCall('getRecentOrder', {}),
        authoredToolCall('searchMenu', { scope: 'all', query: null }),
        authoredToolCall('searchPromotions', {
          scope: 'all',
          query: null,
        }),
      ])
      .respond((messages) => groundedReply({
        messages,
        tools: [{
          toolName: 'getRecentOrder',
          claimKinds: ['order_id'],
        }],
        authorClaims: groundedResponseClaims(),
        customerText: 'The requested verified reads are complete.',
      }));
    const bindings = captureToolBindings(model);
    const sessionId = 'kfc:stategraph-parallel-initial-reads';
    const customerId = 'stategraph-parallel-initial-reads';

    const output = await runAgentTurn({
      sessionId,
      customerId,
      channel: 'kfc',
      text: 'Show my recent order, menu, and promotions.',
      externalMessageId: 'stategraph-parallel-initial-reads-message',
      accessContext: controlledCustomerAccess({ sessionId, customerId }),
      clients,
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      checkpointer: new MemorySaver(),
      agentModel: model,
    });

    expect(recentOrderProvider).toHaveBeenCalledOnce();
    expect(searchMenu).toHaveBeenCalledOnce();
    expect(searchPromotions).toHaveBeenCalledOnce();
    expect(output.state.toolTrace?.map(({ toolName }) => toolName)).toEqual([
      'getRecentOrder',
      'searchMenu',
      'searchPromotions',
    ]);
    expect(bindings[2]).toEqual(expect.arrayContaining([
      'getOrderStatus',
      'checkPaymentStatus',
      'getItemDetails',
      GROUNDED_RESPONSE_TOOL_NAME,
    ]));
    expect(bindings[2]).not.toEqual(expect.arrayContaining([
      'getRecentOrder',
      'searchMenu',
      'searchPromotions',
    ]));
  });

  it('uses current authenticated recent-order evidence to bind a model-authored order-status read', async () => {
    const recent = order({ id: 'provider-recent-order-status' });
    const observed = order({
      id: recent.id,
      status: 'preparing',
      paymentStatus: 'paid',
    });
    const recentOrderProvider = vi.fn(() => ({
      ok: true as const,
      value: recent,
      message: 'recent_order_observed',
    }));
    const orderStatusProvider = vi.fn((_orderId: string) => ({
      ok: true as const,
      value: observed,
      message: 'order_status_observed',
    }));
    const clients = createMockClients(createTestFixtures(), {
      recentOrderProvider,
      orderStatusProvider,
    });
    const authorClaims = groundedResponseClaims();
    const model = fakeModel()
      .respondWithTools([authoredToolCall('getRecentOrder', {})])
      .respondWithTools([authoredToolCall('getOrderStatus', {})])
      .respond((messages) => groundedReply({
        messages,
        tools: [
          { toolName: 'getRecentOrder', claimKinds: ['order_id'] },
          {
            toolName: 'getOrderStatus',
            claimKinds: ['status', 'payment'],
          },
        ],
        authorClaims,
        customerText:
          'The authenticated order and its current status were verified.',
      }));
    const bindings = captureToolBindings(model);
    const sessionId = 'kfc:stategraph-authenticated-order-status';
    const customerId = 'stategraph-authenticated-order-status';

    const output = await runAgentTurn({
      sessionId,
      customerId,
      channel: 'kfc',
      responseProfile: 'genui',
      text: 'Please check the current status of my latest order.',
      externalMessageId: 'stategraph-authenticated-order-status-message',
      accessContext: controlledCustomerAccess({ sessionId, customerId }),
      clients,
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      checkpointer: new MemorySaver(),
      agentModel: model,
    });

    expect(recentOrderProvider).toHaveBeenCalledOnce();
    expect(orderStatusProvider).toHaveBeenCalledOnce();
    expect(bindings.slice(2)).toEqual([
      ['getOrderStatus', 'checkPaymentStatus', GROUNDED_RESPONSE_TOOL_NAME],
      [GROUNDED_RESPONSE_TOOL_NAME],
    ]);
    expect(bindings[2]).not.toEqual(expect.arrayContaining([
      'searchMenu',
      'findStores',
      'searchPromotions',
    ]));
    expect(orderStatusProvider.mock.calls[0]?.[0]).toBe(recent.id);
    expect(
      output.state.toolTrace?.filter(({ ok }) => ok)
        .map(({ toolName, arguments: toolArguments }) => ({
          toolName,
          arguments: toolArguments,
        })),
    ).toEqual([
      { toolName: 'getRecentOrder', arguments: {} },
      {
        toolName: 'getOrderStatus',
        arguments: { orderId: recent.id },
      },
    ]);
    expect(output.state.customerContext).toBeUndefined();
    expect(output.state.order).toMatchObject({
      id: recent.id,
      status: observed.status,
      paymentStatus: observed.paymentStatus,
    });
    expect(output.genUi).toMatchObject({
      widgetKind: 'orderTrackingStatus',
      data: {
        order: {
          id: recent.id,
          status: observed.status,
          paymentStatus: observed.paymentStatus,
        },
      },
    });
    expect(authorClaims.evidenceReferences).toEqual([
      {
        evidenceId: expect.stringMatching(/^current:getRecentOrder:/u),
        claimKinds: ['order_id'],
      },
      {
        evidenceId: expect.stringMatching(/^current:getOrderStatus:/u),
        claimKinds: ['status', 'payment'],
      },
    ]);
  });

  it('rejects a late baseline read and corrects with response-only binding', async () => {
    const recent = order({ id: 'provider-late-baseline-order' });
    const recentOrderProvider = vi.fn(() => ({
      ok: true as const,
      value: recent,
      message: 'recent_order_observed',
    }));
    const clients = createMockClients(createTestFixtures(), {
      recentOrderProvider,
    });
    const searchMenu = vi.spyOn(clients.menu, 'searchMenu');
    const authorClaims = groundedResponseClaims();
    const model = fakeModel()
      .respondWithTools([authoredToolCall('getRecentOrder', {})])
      .respondWithTools([authoredToolCall('searchMenu', {
        scope: 'all',
        query: null,
      })])
      .respond((messages) => groundedReply({
        messages,
        tools: [{
          toolName: 'getRecentOrder',
          claimKinds: ['order_id'],
        }],
        authorClaims,
        customerText: 'The verified recent order is ready.',
      }));
    const bindings = captureToolBindings(model);
    const sessionId = 'kfc:stategraph-late-baseline-correction';
    const customerId = 'stategraph-late-baseline-correction';

    const output = await runAgentTurn({
      sessionId,
      customerId,
      channel: 'kfc',
      text: 'Check my latest order.',
      externalMessageId: 'stategraph-late-baseline-correction-message',
      accessContext: controlledCustomerAccess({ sessionId, customerId }),
      clients,
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      checkpointer: new MemorySaver(),
      agentModel: model,
    });

    expect(output.status).toBe('completed');
    expect(model.callCount).toBe(3);
    expect(output.state.toolTrace?.map(({ toolName }) => toolName))
      .toEqual(['getRecentOrder']);
    expect(searchMenu).not.toHaveBeenCalled();
    expect(bindings.slice(2)).toEqual([
      ['getOrderStatus', 'checkPaymentStatus', GROUNDED_RESPONSE_TOOL_NAME],
      [GROUNDED_RESPONSE_TOOL_NAME],
    ]);
  });

  it('uses recent-order evidence only to ask for reorder confirmation without mutating commerce state', async () => {
    const recent = order({ id: 'provider-recent-order-reorder' });
    const recentOrderProvider = vi.fn(() => ({
      ok: true as const,
      value: recent,
      message: 'recent_order_observed',
    }));
    const clients = createMockClients(createTestFixtures(), {
      recentOrderProvider,
    });
    const updateCart = vi.spyOn(clients.cart, 'updateCart');
    const previewOrder = vi.spyOn(clients.oms, 'previewOrder');
    const placeOrder = vi.spyOn(clients.oms, 'placeOrder');
    const createPaymentLink = vi.spyOn(
      clients.payment,
      'createPaymentLink',
    );
    const escalateToHuman = vi.spyOn(
      clients.handoff,
      'escalateToHuman',
    );
    const authorClaims = groundedResponseClaims();
    const model = fakeModel()
      .respondWithTools([authoredToolCall('getRecentOrder', {})])
      .respond((messages) => groundedReply({
        messages,
        tools: [{
          toolName: 'getRecentOrder',
          claimKinds: ['order_id', 'product'],
        }],
        authorClaims,
        customerText:
          'A prior order is available; please confirm before creating a new cart from it.',
      }));
    const sessionId = 'kfc:stategraph-reorder-confirmation';
    const customerId = 'stategraph-reorder-confirmation';

    const output = await runAgentTurn({
      sessionId,
      customerId,
      channel: 'kfc',
      responseProfile: 'genui',
      text: 'Please reorder what I had last time.',
      externalMessageId: 'stategraph-reorder-confirmation-message',
      accessContext: controlledCustomerAccess({ sessionId, customerId }),
      clients,
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      checkpointer: new MemorySaver(),
      agentModel: model,
    });

    expect(recentOrderProvider).toHaveBeenCalledOnce();
    expect(output.status).toBe('completed');
    expect(output.responseText.length).toBeGreaterThan(0);
    expect(
      output.state.toolTrace?.map(({ toolName }) => toolName),
    ).toEqual(['getRecentOrder']);
    expect(output.state.cart).toBeUndefined();
    expect(output.state.order).toBeUndefined();
    expect(output.state).not.toHaveProperty('pendingReorder');
    expect(output.state.customerContext).toBeUndefined();
    expect(output.genUi).toBeUndefined();
    expect(updateCart).not.toHaveBeenCalled();
    expect(previewOrder).not.toHaveBeenCalled();
    expect(placeOrder).not.toHaveBeenCalled();
    expect(createPaymentLink).not.toHaveBeenCalled();
    expect(escalateToHuman).not.toHaveBeenCalled();
    expect(authorClaims.evidenceReferences).toEqual([{
      evidenceId: expect.stringMatching(/^current:getRecentOrder:/u),
      claimKinds: ['order_id', 'product'],
    }]);
  });

  it('binds a model-authored payment-status read to transient recent-order evidence and grounds the payment/order GenUI', async () => {
    const recent = order({ id: 'provider-recent-order-payment' });
    const recentOrderProvider = vi.fn(() => ({
      ok: true as const,
      value: recent,
      message: 'recent_order_observed',
    }));
    const paymentStatusProvider = vi.fn((_orderId: string) => ({
      ok: true as const,
      value: { status: 'pending' as const },
      message: 'payment_status_observed',
    }));
    const clients = createMockClients(createTestFixtures(), {
      recentOrderProvider,
      paymentStatusProvider,
    });
    const authorClaims = groundedResponseClaims();
    const model = fakeModel()
      .respondWithTools([authoredToolCall('getRecentOrder', {})])
      .respondWithTools([authoredToolCall('checkPaymentStatus', {})])
      .respond((messages) => groundedReply({
        messages,
        tools: [
          { toolName: 'getRecentOrder', claimKinds: ['order_id'] },
          {
            toolName: 'checkPaymentStatus',
            claimKinds: ['payment', 'status'],
          },
        ],
        authorClaims,
        customerText:
          'The authenticated order and its current payment status were verified.',
      }));
    const bindings = captureToolBindings(model);
    const sessionId = 'kfc:stategraph-authenticated-payment-status';
    const customerId = 'stategraph-authenticated-payment-status';
    const store = new MemoryStore();
    const checkpointer = new MemorySaver();

    const output = await runAgentTurn({
      sessionId,
      customerId,
      channel: 'kfc',
      responseProfile: 'genui',
      text: 'Please verify whether my latest order payment completed.',
      externalMessageId: 'stategraph-authenticated-payment-status-message',
      accessContext: controlledCustomerAccess({ sessionId, customerId }),
      clients,
      store,
      dashboard: new DashboardEventBus(),
      checkpointer,
      agentModel: model,
    });

    expect(recentOrderProvider).toHaveBeenCalledOnce();
    expect(paymentStatusProvider).toHaveBeenCalledOnce();
    expect(bindings.slice(2)).toEqual([
      ['getOrderStatus', 'checkPaymentStatus', GROUNDED_RESPONSE_TOOL_NAME],
      [GROUNDED_RESPONSE_TOOL_NAME],
    ]);
    expect(paymentStatusProvider.mock.calls[0]?.[0]).toBe(recent.id);
    expect(
      output.state.toolTrace?.filter(({ ok }) => ok)
        .map(({ toolName, arguments: toolArguments }) => ({
          toolName,
          arguments: toolArguments,
        })),
    ).toEqual([
      { toolName: 'getRecentOrder', arguments: {} },
      {
        toolName: 'checkPaymentStatus',
        arguments: { orderId: recent.id },
      },
    ]);
    expect(output.state.customerContext).toBeUndefined();
    expect(output.state.order).toBeUndefined();
    expect(output.state.paymentAttempt).toBeUndefined();
    expect(output.genUi).toMatchObject({
      widgetKind: 'paymentOrderStatus',
      data: {
        order: {
          id: recent.id,
          status: recent.status,
          paymentStatus: recent.paymentStatus,
        },
        paymentAttempt: {
          status: 'pending',
        },
      },
    });
    expect(authorClaims.evidenceReferences).toEqual([
      {
        evidenceId: expect.stringMatching(/^current:getRecentOrder:/u),
        claimKinds: ['order_id'],
      },
      {
        evidenceId: expect.stringMatching(/^current:checkPaymentStatus:/u),
        claimKinds: ['payment', 'status'],
      },
    ]);
    const turns = await store.listTurns(sessionId);
    const persistedAttachment = turns.find(
      ({ id }) => id === output.assistantTurnId,
    )?.metadata?.genUi;
    expect(persistedAttachment).toMatchObject({
      widgetKind: 'paymentOrderStatus',
      data: {
        paymentAttempt: {
          status: 'pending',
        },
      },
    });
    expect(persistedAttachment?.data).not.toHaveProperty('order');
    expect(
      (await loadPriorVerifiedState(store, sessionId)).paymentAttempt,
    ).toBeUndefined();
    const persistedState = await loadPriorVerifiedState(store, sessionId);
    const persistedPaymentStatusTrace =
      persistedState.toolTrace?.find(
        ({ toolName }) => toolName === 'checkPaymentStatus',
      );
    await expectPrivateTraceAuditRecoverable(
      persistedPaymentStatusTrace,
      output.state.toolTrace?.find(
        ({ toolName }) => toolName === 'checkPaymentStatus',
      ),
    );
    for (const privateOrderValue of [
      recent.id,
      recent.cart.id,
      recent.cart.items[0]!.name,
    ]) {
      expect(JSON.stringify(turns.map(({ metadata }) => metadata)))
        .not.toContain(privateOrderValue);
      expect(await serializedCheckpointHistory(checkpointer))
        .not.toContain(privateOrderValue);
      expect(JSON.stringify(await store.listEvents(sessionId)))
        .not.toContain(privateOrderValue);
    }
  });

  it.each(['social', 'genui'] as const)(
    'keeps a failed current payment check distinct from durable pending state in %s presentation',
    async (responseProfile) => {
      const knownOrder = order({
        id: `provider-payment-failed-${responseProfile}`,
      });
      const durablePaymentAttempt = {
        orderId: knownOrder.id,
        method: 'zalopay_wallet',
        status: 'pending' as const,
        paymentUrl:
          `https://pay.mock/zalopay/${knownOrder.id}`,
      };
      const paymentStatusProvider = vi.fn((_orderId: string) => ({
        ok: false as const,
        errorCode: 'payment_failed',
        message: 'provider_payment_failed',
      }));
      const clients = createMockClients(createTestFixtures(), {
        initialOrders: [knownOrder],
        paymentStatusProvider,
      });
      const authorClaims = groundedResponseClaims();
      let issuedPaymentEvidence: PublishedEvidence | undefined;
      const model = fakeModel()
        .respondWithTools([authoredToolCall('checkPaymentStatus', {})])
        .respond((messages) => {
          issuedPaymentEvidence =
            currentEvidence(messages, 'checkPaymentStatus');
          return groundedReply({
            messages,
            tools: [{
              toolName: 'checkPaymentStatus',
              claimKinds: ['payment', 'status'],
            }],
            authorClaims,
            customerText:
              'The current payment check failed; the existing payment attempt is still pending.',
          });
        });
      const sessionId =
        `kfc:stategraph-payment-failed-${responseProfile}`;
      const customerId =
        `stategraph-payment-failed-${responseProfile}`;
      const store = new MemoryStore();
      const checkpointer = new MemorySaver();
      await store.appendEvent(sessionId, 'graph:verified_state', {
        verifiedState: {
          order: knownOrder,
          paymentAttempt: durablePaymentAttempt,
          toolTrace: [],
        },
      });

      const output = await runAgentTurn({
        sessionId,
        customerId,
        channel: 'kfc',
        responseProfile,
        text: 'Please check why my payment did not complete.',
        externalMessageId:
          `stategraph-payment-failed-${responseProfile}-message`,
        accessContext: controlledCustomerAccess({
          sessionId,
          customerId,
        }),
        clients,
        store,
        dashboard: new DashboardEventBus(),
        checkpointer,
        agentModel: model,
      });

      expect(paymentStatusProvider).toHaveBeenCalledOnce();
      expect(paymentStatusProvider.mock.calls[0]?.[0])
        .toBe(knownOrder.id);
      expect(output.state.toolTrace).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            toolName: 'checkPaymentStatus',
            arguments: { orderId: knownOrder.id },
            ok: false,
            resultSummary: 'payment_failed',
          }),
        ]),
      );
      expect(output.state.order).toMatchObject({
        id: knownOrder.id,
        paymentStatus: 'pending',
      });
      expect(output.state.paymentAttempt).toEqual(
        durablePaymentAttempt,
      );
      expect(
        (await loadPriorVerifiedState(store, sessionId)).paymentAttempt,
      ).toEqual(durablePaymentAttempt);
      expect(await serializedCheckpointHistory(checkpointer))
        .not.toContain('provider_payment_failed');
      expect(issuedPaymentEvidence?.value).toEqual({
        ok: false,
        errorCode: 'payment_failed',
      });
      expect(authorClaims.evidenceReferences).toEqual([{
        evidenceId:
          expect.stringMatching(/^current:checkPaymentStatus:/u),
        claimKinds: ['payment', 'status'],
      }]);

      if (responseProfile === 'genui') {
        expect(output.genUi).toMatchObject({
          widgetKind: 'paymentOrderStatus',
          data: {
            order: {
              id: knownOrder.id,
              paymentStatus: 'pending',
            },
            paymentAttempt: {
              method: durablePaymentAttempt.method,
              status: 'pending',
            },
            paymentStatusEvidence: {
              resolution: 'current_tool',
              statuses: {
                order: 'pending',
                paymentAttempt: 'pending',
              },
              currentCheck: {
                executionOutcome: 'error',
                errorCode: 'payment_failed',
              },
            },
          },
        });
        expect(output.genUi?.data.paymentStatusEvidence)
          .not.toHaveProperty('selectedStatus');
        expect(output.genUi?.data.paymentStatusEvidence)
          .not.toHaveProperty('selectedSource');
        expect(output.genUi?.actions.map(({ id }) => id)).toEqual([
          'change_payment_method',
        ]);
      } else {
        expect(output.genUi).toBeUndefined();
      }
    },
  );

  it('keeps transient current-order context in a failed payment-check GenUI without persisting it', async () => {
    const recent = {
      ...order({
        id: 'provider-recent-order-payment-failed',
      }),
      commerceOrderId: 'private-transient-commerce-order',
      omsOrderId: 'private-transient-oms-order',
      commerceEnvironment: 'production' as const,
      commerceProviderProvenance: {
        oms: {
          implementation: 'private-transient-implementation',
          source: 'private-transient-source',
        },
      },
    };
    const durablePaymentAttempt = {
      orderId: 'unrelated-durable-order',
      method: 'zalopay_wallet',
      status: 'pending' as const,
      paymentUrl: 'https://pay.mock/opaque-payment-link',
    };
    const recentOrderProvider = vi.fn(() => ({
      ok: true as const,
      value: recent,
      message: 'recent_order_observed',
    }));
    const paymentStatusProvider = vi.fn((_orderId: string) => ({
      ok: false as const,
      errorCode: 'payment_failed',
      message: 'provider_payment_failed',
    }));
    const clients = createMockClients(createTestFixtures(), {
      recentOrderProvider,
      paymentStatusProvider,
    });
    const authorClaims = groundedResponseClaims();
    const model = fakeModel()
      .respondWithTools([authoredToolCall('getRecentOrder', {})])
      .respondWithTools([authoredToolCall('checkPaymentStatus', {})])
      .respond((messages) => groundedReply({
        messages,
        tools: [
          { toolName: 'getRecentOrder', claimKinds: ['order_id'] },
          {
            toolName: 'checkPaymentStatus',
            claimKinds: ['payment', 'status'],
          },
        ],
        authorClaims,
        customerText:
          'The authenticated payment check failed for the current order.',
      }));
    const sessionId =
      'kfc:stategraph-transient-payment-failed';
    const customerId =
      'stategraph-transient-payment-failed';
    const store = new MemoryStore();
    const checkpointer = new MemorySaver();
    await store.appendEvent(sessionId, 'graph:verified_state', {
      verifiedState: {
        paymentAttempt: durablePaymentAttempt,
        toolTrace: [],
      },
    });

    const output = await runAgentTurn({
      sessionId,
      customerId,
      channel: 'kfc',
      responseProfile: 'genui',
      text: 'Please check my latest order payment.',
      externalMessageId:
        'stategraph-transient-payment-failed-message',
      accessContext: controlledCustomerAccess({
        sessionId,
        customerId,
      }),
      clients,
      store,
      dashboard: new DashboardEventBus(),
      checkpointer,
      agentModel: model,
    });

    expect(recentOrderProvider).toHaveBeenCalledOnce();
    expect(paymentStatusProvider).toHaveBeenCalledOnce();
    expect(paymentStatusProvider.mock.calls[0]?.[0]).toBe(recent.id);
    expect(output.state.order).toBeUndefined();
    expect(output.state.paymentAttempt).toBeUndefined();
    expect(
      (await loadPriorVerifiedState(store, sessionId)).paymentAttempt,
    ).toBeUndefined();
    expect(output.genUi).toMatchObject({
      widgetKind: 'paymentOrderStatus',
      data: {
        order: {
          id: recent.id,
          paymentStatus: 'pending',
          amountVnd: recent.cart.totalVnd,
        },
        paymentAttempt: null,
        paymentStatusEvidence: {
          resolution: 'current_tool',
          statuses: {
            order: 'pending',
          },
          currentCheck: {
            executionOutcome: 'error',
            errorCode: 'payment_failed',
          },
        },
      },
    });
    expect(output.genUi?.data.paymentAttempt).toBeNull();
    expect(output.genUi?.data.paymentStatusEvidence)
      .not.toHaveProperty('selectedStatus');
    expect(output.genUi?.data.paymentStatusEvidence)
      .not.toHaveProperty('selectedSource');
    expect(output.genUi?.actions.map(({ id }) => id)).toEqual([
      'change_payment_method',
    ]);
    for (const privateOrderValue of [
      recent.cart.id,
      recent.cart.items[0]!.itemCode,
      recent.cart.items[0]!.name,
      recent.assignedStoreId,
      recent.commerceOrderId,
      recent.omsOrderId,
      recent.commerceProviderProvenance.oms.implementation,
      recent.commerceProviderProvenance.oms.source,
    ]) {
      expect(JSON.stringify(output.genUi)).not.toContain(
        privateOrderValue,
      );
    }
    const turns = await store.listTurns(sessionId);
    const persistedAttachment = turns.find(
      ({ id }) => id === output.assistantTurnId,
    )?.metadata?.genUi;
    expect(persistedAttachment?.data).not.toHaveProperty('order');
    expect(persistedAttachment?.data.paymentAttempt).toBeNull();
    const persistedState = await loadPriorVerifiedState(store, sessionId);
    const persistedPaymentStatusTrace =
      persistedState.toolTrace?.find(
        ({ toolName }) => toolName === 'checkPaymentStatus',
      );
    await expectPrivateTraceAuditRecoverable(
      persistedPaymentStatusTrace,
      output.state.toolTrace?.find(
        ({ toolName }) => toolName === 'checkPaymentStatus',
      ),
    );
    const nextTurnAttachment = selectKfcGenUiAttachment({
      state: {
        ...output.state,
        paymentAttempt: persistedState.paymentAttempt,
        latestUserMessage: 'What can I do next?',
      },
      turnToolNames: [],
      issuedAt: new Date('2026-07-20T00:00:00.000Z'),
    });
    expect(nextTurnAttachment?.widgetKind).not.toBe('paymentOrderStatus');
    expect(nextTurnAttachment?.actions.map(({ id }) => id)).not.toContain(
      'open_payment',
    );
    expect(JSON.stringify(nextTurnAttachment)).not.toContain(
      durablePaymentAttempt.paymentUrl,
    );
    for (const privateOrderValue of [
      recent.id,
      recent.cart.id,
      recent.cart.items[0]!.name,
    ]) {
      expect(JSON.stringify(turns.map(({ metadata }) => metadata)))
        .not.toContain(privateOrderValue);
      expect(await serializedCheckpointHistory(checkpointer))
        .not.toContain(privateOrderValue);
      expect(JSON.stringify(await store.listEvents(sessionId)))
        .not.toContain(privateOrderValue);
    }
  });
});
