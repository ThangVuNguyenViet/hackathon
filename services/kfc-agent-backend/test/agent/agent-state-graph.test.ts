import {
  AIMessage,
  isAIMessage,
  isSystemMessage,
  isToolMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { fakeModel } from '@langchain/core/testing';
import { Command, MemorySaver } from '@langchain/langgraph';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  KFC_AGENT_GRAPH_NODE_NAMES,
  createKfcAgentStateGraph,
  type KfcAgentGraphInput,
} from '../../src/agent/agentStateGraph.js';
import {
  createAgentTurnExternalCallScope,
  type AgentTurnExternalCallScope,
  type SingleAgentRuntimeContext,
} from '../../src/agent/singleAgentRuntime.js';
import type {
  ExternalCallContext,
} from '../../src/clients/interfaces.js';
import {
  GROUNDED_RESPONSE_TOOL_NAME,
} from '../../src/agent/responseGrounding.js';
import {
  STRUCTURED_RESPONSE_CORRECTION_MESSAGE_ID,
  STRUCTURED_RESPONSE_REFERENCE_MESSAGE_ID,
} from '../../src/agent/structuredCustomerAction.js';
import {
  selectedActionResponseReferenceSchema,
  type SelectedActionResponseReference,
} from '../../src/agent/selectedActionResponseAuthority.js';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import { createTrustedCustomerActionEnvelope } from '../../src/domain/customerCommand.js';
import { kfcGenUiVerifiedStateRevision } from '../../src/genui/kfcGenUi.js';
import { runAgentTurn } from '../../src/graph/buildGraph.js';
import {
  stateRevision,
  toolExecutionContext,
} from '../../src/graph/turnSupport.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import { createNoopAgentTracer } from '../../src/observability/agentTracing.js';
import type { AgentTraceSpan } from '../../src/observability/agentTracing.js';
import {
  createCommerceApprovalReceipt,
  digestCommerceAction,
} from '../../src/ordering/approvalReceipt.js';
import {
  createCommerceApprovalExecutionFence,
} from '../../src/ordering/approvalExecutionFence.js';
import {
  buildCurrentAgentApprovalBinding,
} from '../../src/ordering/agentToolExecutor.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import type {
  CreateConfirmationPauseInput,
} from '../../src/persistence/contracts.js';
import type { CustomerAccessScope } from '../../src/domain/types.js';
import {
  agentCheckpointThreadId,
  langGraphConfigForRun,
} from '../../src/session/sessionContext.js';
import {
  controlledCustomerAccess,
} from '../fixtures/controlledCustomerAccess.js';
import {
  groundedResponseClaims,
  groundedResponseModelReply,
} from '../fixtures/groundedResponse.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';

interface ToolBindingModel {
  bindTools: NonNullable<BaseChatModel['bindTools']>;
}

function turnInput(model: ReturnType<typeof fakeModel>, sessionId: string) {
  return {
    sessionId,
    customerId: 'state-graph-customer',
    channel: 'kfc' as const,
    text: 'Help with my KFC order',
    externalMessageId: `${sessionId}-message`,
    checkpointRunId: `${sessionId}-server-checkpoint`,
    clients: createMockClients(createTestFixtures()),
    store: new MemoryStore(),
    dashboard: new DashboardEventBus(),
    checkpointer: new MemorySaver(),
    agentModel: model,
  };
}

function directGraphConfig(input: {
  sessionId: string;
  checkpointRunId: string;
}) {
  const logical = langGraphConfigForRun(
    input.sessionId,
    input.checkpointRunId,
  ).configurable;
  return {
    configurable: {
      thread_id: agentCheckpointThreadId({
        threadId: logical.thread_id,
        namespace: logical.checkpoint_ns,
      }),
    },
  };
}

async function seedCurrentUserTurn(
  input: ReturnType<typeof turnInput>,
): Promise<void> {
  await input.store.appendTurn({
    sessionId: input.sessionId,
    channel: input.channel,
    role: 'user',
    text: input.text,
    externalMessageId: input.externalMessageId,
    externalUserId: input.customerId,
    deliveryStatus: 'received',
    metadata: null,
  });
}

function approvalTurnInput(
  model: ReturnType<typeof fakeModel>,
  sessionId: string,
  scope: CustomerAccessScope,
) {
  const input = turnInput(model, sessionId);
  const accessContext = controlledCustomerAccess({
    sessionId,
    customerId: input.customerId,
    channel: input.channel,
  });
  accessContext.authorizedScopes.push(scope);
  return { ...input, accessContext };
}

function authenticatedTurnInput(
  model: ReturnType<typeof fakeModel>,
  sessionId: string,
) {
  const input = turnInput(model, sessionId);
  return {
    ...input,
    accessContext: controlledCustomerAccess({
      sessionId,
      customerId: input.customerId,
      channel: input.channel,
    }),
  };
}

function canonicalConfirmationRecord(
  output: Awaited<ReturnType<typeof runAgentTurn>>,
): CreateConfirmationPauseInput {
  const descriptor = Object.getOwnPropertyDescriptor(
    output.pause ?? {},
    'confirmationRecord',
  );
  const record: unknown = descriptor?.value;
  if (!isCanonicalConfirmationRecord(record)) {
    throw new Error('canonical confirmation record missing');
  }
  return record;
}

function isCanonicalConfirmationRecord(
  value: unknown,
): value is CreateConfirmationPauseInput {
  return (
    typeof value === 'object' &&
    value !== null &&
    'schemaVersion' in value &&
    value.schemaVersion === 'kfc-confirmation-pause-v1' &&
    'requestId' in value &&
    typeof value.requestId === 'string' &&
    'checkpointThreadId' in value &&
    typeof value.checkpointThreadId === 'string' &&
    'checkpointNamespace' in value &&
    typeof value.checkpointNamespace === 'string' &&
    'checkpointId' in value &&
    typeof value.checkpointId === 'string' &&
    'approvalBinding' in value &&
    typeof value.approvalBinding === 'object' &&
    value.approvalBinding !== null &&
    'approvalBindingDigest' in value &&
    typeof value.approvalBindingDigest === 'string'
  );
}

async function authenticatedResume(
  record: CreateConfirmationPauseInput,
  deadlineMs: number,
  decision: 'approve' | 'reject' = 'reject',
) {
  const signingSecret =
    'state-graph-resume-signing-secret-at-least-32-bytes';
  const commerceReceipt = await createCommerceApprovalReceipt({
    binding: record.approvalBinding,
    secret: signingSecret,
    decision,
    receiptId: record.requestId,
  });
  const approvalBindingDigest = await digestCommerceAction(
    record.approvalBinding,
  );
  const executionFence = await createCommerceApprovalExecutionFence({
    secret: signingSecret,
    claim: {
      schemaVersion: 'kfc-commerce-approval-execution-v1',
      operation: 'confirmation_resume',
      requestId: record.requestId,
      expectedSessionGeneration: 0,
      sessionAuthorityGeneration: 0,
      checkpointThreadId: record.checkpointThreadId,
      checkpointNamespace: record.checkpointNamespace,
      checkpointId: record.checkpointId,
      bindingFingerprint: approvalBindingDigest,
      approvalBindingDigest,
      providerIdempotencyKey:
        `confirmation:${record.requestId}:${record.action.toolName}:test`,
      attempt: 1,
      leaseToken: crypto.randomUUID(),
    },
  });
  const externalCallScope = createAgentTurnExternalCallScope(deadlineMs);
  return {
    externalCallScope,
    confirmationResume: {
      requestId: record.requestId,
      approved: decision === 'approve',
      action: record.action,
      checkpoint: {
        threadId: record.checkpointThreadId,
        namespace: record.checkpointNamespace,
        checkpointId: record.checkpointId,
      },
      commerceReceipt,
      executionFence,
      signingSecret,
      externalCallContext: externalCallScope.context,
      abortExternalCalls: externalCallScope.abort,
    },
  };
}

function verifiedCart() {
  return {
    id: 'cart-structured',
    items: [{
      itemCode: '20751',
      name: 'Verified item',
      quantity: 1,
      unitPriceVnd: 99_000,
    }],
    subtotalVnd: 99_000,
    discountVnd: 0,
    deliveryFeeVnd: 0,
    totalVnd: 99_000,
    voucherCode: null,
  };
}

function structuredActionReference(
  messages: BaseMessage[],
): SelectedActionResponseReference {
  const authorityMessage = messages.find(
    (message) =>
      isSystemMessage(message) &&
      message.id === STRUCTURED_RESPONSE_REFERENCE_MESSAGE_ID,
  );
  if (!authorityMessage || typeof authorityMessage.content !== 'string') {
    throw new Error('structured_action_reference_message_missing');
  }
  const parsed: unknown = JSON.parse(authorityMessage.content);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('selectedActionResponse' in parsed)
  ) {
    throw new Error('structured_action_reference_payload_invalid');
  }
  return selectedActionResponseReferenceSchema.parse(
    parsed.selectedActionResponse,
  );
}

function structuredGroundedResponse(
  messages: BaseMessage[],
  customerText: string,
): AIMessage {
  return groundedResponseModelReply({
      customerText,
      selectedActionResponse: structuredActionReference(messages),
    })(messages);
}

function captureBoundInvocationSignals(
  model: ReturnType<typeof fakeModel>,
): Array<AbortSignal | undefined> {
  const signals: Array<AbortSignal | undefined> = [];
  const bindTools = model.bindTools.bind(model);
  vi.spyOn(model, 'bindTools').mockImplementation((tools) => {
    const bound = bindTools(tools);
    const invoke = bound.invoke.bind(bound);
    vi.spyOn(bound, 'invoke').mockImplementation((messages, config) => {
      signals.push(config?.signal);
      return invoke(messages, config);
    });
    return bound;
  });
  return signals;
}

function boundToolNames(tools: unknown): string[] {
  if (!Array.isArray(tools)) return [];
  return tools.flatMap((candidate) => {
    if (
      typeof candidate !== 'object' ||
      candidate === null ||
      !('name' in candidate) ||
      typeof candidate.name !== 'string'
    ) {
      return [];
    }
    return [candidate.name];
  });
}

function isObjectRecord(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value);
}

function objectRecord(
  value: unknown,
): Record<string, unknown> | undefined {
  return isObjectRecord(value) ? value : undefined;
}

function boundSelectedActionSchema(tools: unknown): unknown {
  if (!Array.isArray(tools)) return undefined;
  const responseTool = tools.find((candidate) => {
    const record = objectRecord(candidate);
    return record?.name === GROUNDED_RESPONSE_TOOL_NAME;
  });
  const schema = objectRecord(objectRecord(responseTool)?.schema);
  const properties = objectRecord(schema?.properties);
  return properties?.selectedActionResponse;
}

async function expectPersistedFailure(
  store: MemoryStore,
  sessionId: string,
  errorCode: string,
): Promise<void> {
  expect(await store.listEvents(sessionId)).toContainEqual(
    expect.objectContaining({
      sourceType: 'agent:failed_closed',
      payload: expect.objectContaining({ errorCode }),
    }),
  );
}

async function invokeGraphDirect(
  input: SingleAgentRuntimeContext['turnInput'] & {
    agentModel: ReturnType<typeof fakeModel>;
    checkpointer: MemorySaver;
    checkpointRunId: string;
  },
  options: {
  deadlineMs?: number;
  externalCallScope?: AgentTurnExternalCallScope;
  turnTrace?: AgentTraceSpan;
  },
) {
  const turnTrace = options.turnTrace ??
    await createNoopAgentTracer().startTurn({
      name: 'state_graph_direct_test',
      inputs: {},
    });
  const externalCallScope =
    options.externalCallScope ??
    createAgentTurnExternalCallScope(options.deadlineMs);
  try {
    return await createKfcAgentStateGraph({
      model: input.agentModel,
      checkpointer: input.checkpointer,
      resolveRuntime: async () => ({
        turnInput: input,
        turnTrace,
        externalCallContext: externalCallScope.context,
        abortExternalCalls: externalCallScope.abort,
        disposeExternalCalls: externalCallScope.dispose,
      }),
    }).invoke({
      sessionId: input.sessionId,
      customerId: input.customerId,
      channel: input.channel,
      text: input.text,
      externalMessageId: input.externalMessageId ?? null,
      metadata: null,
      messages: [],
    }, directGraphConfig(input));
  } finally {
    externalCallScope.dispose();
  }
}

describe('KFC agent StateGraph', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('owns the complete model, tool, approval, retry, and persistence loop', () => {
    const graph = createKfcAgentStateGraph({
      model: fakeModel(),
      checkpointer: new MemorySaver(),
    }).getGraph().toJSON();

    expect(graph.nodes.map(({ id }: { id: string }) => id).sort()).toEqual(
      ['__start__', ...KFC_AGENT_GRAPH_NODE_NAMES, '__end__'].sort(),
    );
    expect(
      graph.edges.map(
        ({ source, target }: { source: string; target: string }) =>
          `${source}->${target}`,
      ).sort(),
    ).toEqual([
      '__start__->load_context',
      'call_model->fail_closed',
      'call_model->finalize_response',
      'call_model->record_provider_retry',
      'call_model->validate_tool_calls',
      'execute_tools->call_model',
      'execute_tools->execute_tools',
      'execute_tools->fail_closed',
      'execute_tools->record_semantic_correction',
      'execute_tools->request_approval',
      'execute_trusted_action->call_model',
      'execute_trusted_action->fail_closed',
      'execute_trusted_action->prepare_structured_action',
      'fail_closed->persist_and_project',
      'finalize_response->fail_closed',
      'finalize_response->persist_and_project',
      'finalize_response->record_semantic_correction',
      'load_context->call_model',
      'load_context->fail_closed',
      'load_context->prepare_structured_action',
      'persist_and_project->__end__',
      'prepare_structured_action->call_model',
      'prepare_structured_action->execute_trusted_action',
      'prepare_structured_action->fail_closed',
      'prepare_structured_action->request_approval',
      'record_provider_retry->call_model',
      'record_provider_retry->fail_closed',
      'record_semantic_correction->call_model',
      'record_semantic_correction->fail_closed',
      'request_approval->revalidate_approval',
      'revalidate_approval->call_model',
      'revalidate_approval->execute_tools',
      'revalidate_approval->execute_trusted_action',
      'revalidate_approval->fail_closed',
      'revalidate_approval->request_approval',
      'validate_tool_calls->execute_tools',
      'validate_tool_calls->fail_closed',
      'validate_tool_calls->finalize_response',
      'validate_tool_calls->record_semantic_correction',
      'validate_tool_calls->request_approval',
    ]);
  });

  it('advertises only the current public lifecycle tool profile', async () => {
    const model = fakeModel().respond(groundedResponseModelReply({
      customerText: 'How can I help?',
    }));
    const bindings: Array<{
      names: string[];
      selectedActionSchema: unknown;
      toolChoice: unknown;
    }> = [];
    const modelWithOptions: ToolBindingModel = model;
    const bindTools =
      modelWithOptions.bindTools.bind(modelWithOptions);
    vi.spyOn(modelWithOptions, 'bindTools').mockImplementation((
      tools,
      options,
    ) => {
      bindings.push({
        names: boundToolNames(tools),
        selectedActionSchema: boundSelectedActionSchema(tools),
        toolChoice: options?.tool_choice,
      });
      return bindTools(tools, options);
    });

    const result = await invokeGraphDirect(
      turnInput(model, 'state-graph-public-tool-profile'),
      {},
    );

    expect(result.failure).toBeNull();
    expect(bindings[0]).toEqual({
      names: [GROUNDED_RESPONSE_TOOL_NAME],
      selectedActionSchema: expect.objectContaining({
        type: 'object',
        additionalProperties: false,
      }),
      toolChoice: GROUNDED_RESPONSE_TOOL_NAME,
    });
    expect(bindings[0]?.selectedActionSchema)
      .not.toHaveProperty('anyOf');
    const planningProfile = bindings.find(
      ({ names }) => names.length > 1,
    );
    expect(planningProfile?.toolChoice).toEqual({
      type: 'allowed_tools',
      mode: 'required',
      tools: planningProfile?.names.map((name) => ({
        type: 'function',
        name,
      })),
    });
    expect(planningProfile?.selectedActionSchema).toEqual({
      type: 'null',
    });
    expect(planningProfile?.names).toEqual([
      'searchMenu',
      'findStores',
      'searchPromotions',
      'listPaymentMethods',
      'searchContentPolicy',
      'answerAllergenQuestion',
      'collectInvoice',
      GROUNDED_RESPONSE_TOOL_NAME,
    ]);
  });

  it('rejects a model-authored call that was not advertised', async () => {
    const model = fakeModel()
      .respondWithTools([{ name: 'getSavedAddresses', args: {} }])
      .respondWithTools([{ name: 'getSavedAddresses', args: {} }]);
    const bindings: string[][] = [];
    const bindTools = model.bindTools.bind(model);
    vi.spyOn(model, 'bindTools').mockImplementation((tools) => {
      bindings.push(boundToolNames(tools));
      return bindTools(tools);
    });
    const input = turnInput(model, 'state-graph-unadvertised-tool');

    const result = await invokeGraphDirect(input, {});

    expect(result.failure).toBe(
      'agent_semantic_correction_limit_exceeded',
    );
    expect(result.currentTurnToolTrace).toEqual([]);
    expect(
      bindings.filter((names) => names.length > 1),
    ).not.toEqual(expect.arrayContaining([
      expect.arrayContaining(['getSavedAddresses']),
    ]));
  });

  it('expands the next model tool profile from verified menu state', async () => {
    const model = fakeModel()
      .respondWithTools([{
        name: 'searchMenu',
        args: { scope: 'all', query: null },
      }])
      .respond(groundedResponseModelReply({
        customerText: 'The menu is ready.',
      }));
    const bindings: string[][] = [];
    const bindTools = model.bindTools.bind(model);
    vi.spyOn(model, 'bindTools').mockImplementation((tools) => {
      bindings.push(boundToolNames(tools));
      return bindTools(tools);
    });

    const result = await invokeGraphDirect(
      turnInput(model, 'state-graph-menu-tool-profile'),
      {},
    );

    expect(result.failure).toBeNull();
    expect(result.currentTurnToolTrace.map(({ toolName }) => toolName))
      .toEqual(['searchMenu']);
    const planningProfiles = bindings.filter((names) => names.length > 1);
    expect(planningProfiles).toHaveLength(2);
    expect(planningProfiles[0]).not.toEqual(expect.arrayContaining([
      'getItemDetails',
      'getModifierOptions',
      'updateCart',
    ]));
    expect(planningProfiles[1]).toEqual(expect.arrayContaining([
      'getItemDetails',
      'getModifierOptions',
      'updateCart',
    ]));
  });

  it('uses only the response-bound model for presentation actions', async () => {
    const baseModel = fakeModel();
    const planningModel = fakeModel().respond(
      new AIMessage('planning must not run'),
    );
    const responseModel = fakeModel().respond((messages) => {
      return structuredGroundedResponse(
        messages,
        'You can edit your verified cart.',
      );
    });
    const bindings: Array<{
      names: string[];
      selectedActionSchema: unknown;
      toolChoice: unknown;
    }> = [];
    const modelWithOptions: ToolBindingModel = baseModel;
    vi.spyOn(modelWithOptions, 'bindTools').mockImplementation((
      tools,
      options,
    ) => {
      const names = boundToolNames(tools);
      bindings.push({
        names,
        selectedActionSchema: boundSelectedActionSchema(tools),
        toolChoice: options?.tool_choice,
      });
      return (
        names.length === 1 &&
        names[0] === GROUNDED_RESPONSE_TOOL_NAME
          ? responseModel
          : planningModel
      ) as ReturnType<NonNullable<typeof baseModel.bindTools>>;
    });
    const input = turnInput(baseModel, 'state-graph-structured-edit-cart');
    const cart = verifiedCart();
    await seedCurrentUserTurn(input);
    await input.store.appendEvent(input.sessionId, 'graph:verified_state', {
      verifiedState: { cart, toolTrace: [] },
    });

    const output = await runAgentTurn({
      ...input,
      text: 'Place an order instead',
      trustedCustomerAction: createTrustedCustomerActionEnvelope({
        source: 'kfc_genui_action',
        assistantTurnId: 'assistant-structured',
        attachmentId: 'attachment-structured',
        actionDigest: 'a'.repeat(64),
        verifiedRevision: kfcGenUiVerifiedStateRevision({ cart }),
        lifecycle: 'one_shot',
        command: { kind: 'edit_cart' },
      }),
    });

    expect(planningModel.callCount).toBe(0);
    expect(responseModel.callCount).toBe(1);
    expect(bindings).toEqual([{
      names: [GROUNDED_RESPONSE_TOOL_NAME],
      selectedActionSchema: expect.objectContaining({
        type: 'object',
        additionalProperties: false,
      }),
      toolChoice: GROUNDED_RESPONSE_TOOL_NAME,
    }]);
    expect(bindings[0]?.selectedActionSchema)
      .not.toHaveProperty('anyOf');
    expect(responseModel.calls[0]?.messages.some(isToolMessage)).toBe(false);
    expect(output.genUi?.widgetKind).toBe('cartBuilder');
    expect(output.state.trustedPresentation).toEqual({
      preferredSurface: 'cart',
    });
    expect(output.state.toolTrace).toEqual([]);
  });

  it('keeps structured response retries off the planning model', async () => {
    const baseModel = fakeModel();
    const planningModel = fakeModel().respond(
      new AIMessage('planning must not run'),
    );
    const responseModel = fakeModel()
      .respond(Object.assign(new Error('temporary response outage'), {
        status: 503,
      }))
      .respond((messages) => {
        return structuredGroundedResponse(
          messages,
          'Your verified cart is ready to edit.',
        );
      });
    vi.spyOn(baseModel, 'bindTools').mockImplementation((tools) => {
      const names = (tools as Array<{ name?: string }>).flatMap(
        ({ name }) => name ? [name] : [],
      );
      return (
        names.length === 1 &&
        names[0] === GROUNDED_RESPONSE_TOOL_NAME
          ? responseModel
          : planningModel
      ) as ReturnType<NonNullable<typeof baseModel.bindTools>>;
    });
    const input = turnInput(baseModel, 'structured-response-retry');
    const cart = verifiedCart();
    const observations: string[] = [];
    await seedCurrentUserTurn(input);
    await input.store.appendEvent(input.sessionId, 'graph:verified_state', {
      verifiedState: { cart, toolTrace: [] },
    });

    const output = await runAgentTurn({
      ...input,
      observeRun: async ({ kind }) => {
        observations.push(kind);
      },
      trustedCustomerAction: createTrustedCustomerActionEnvelope({
        source: 'kfc_genui_action',
        assistantTurnId: 'assistant-retry',
        attachmentId: 'attachment-retry',
        actionDigest: 'b'.repeat(64),
        verifiedRevision: kfcGenUiVerifiedStateRevision({ cart }),
        lifecycle: 'one_shot',
        command: { kind: 'edit_cart' },
      }),
    });

    expect(output.responseText).toBe(
      'Your verified cart is ready to edit.',
    );
    expect(planningModel.callCount).toBe(0);
    expect(responseModel.callCount).toBe(2);
    expect(observations).toEqual([
      'response_composition',
      'response_composition',
    ]);
  });

  it('resumes an approved trusted payment action exactly once through call_model', async () => {
    const baseModel = fakeModel();
    const planningModel = fakeModel().respond(
      new AIMessage('planning must not run'),
    );
    let selectedActionResponse:
      SelectedActionResponseReference | undefined;
    const responseModel = fakeModel().respond((messages) => {
      selectedActionResponse = structuredActionReference(messages);
      return structuredGroundedResponse(
        messages,
        'The verified payment link is ready.',
      );
    });
    const bindings: string[][] = [];
    vi.spyOn(baseModel, 'bindTools').mockImplementation((tools) => {
      const names = (tools as Array<{ name?: string }>).flatMap(
        ({ name }) => name ? [name] : [],
      );
      bindings.push(names);
      return (
        names.length === 1 &&
        names[0] === GROUNDED_RESPONSE_TOOL_NAME
          ? responseModel
          : planningModel
      ) as ReturnType<NonNullable<typeof baseModel.bindTools>>;
    });
    const input = authenticatedTurnInput(
      baseModel,
      'state-graph-trusted-payment-approval',
    );
    input.accessContext.authorizedScopes.push(
      'payment:read',
      'payment:write',
    );
    await seedCurrentUserTurn(input);
    const cart = verifiedCart();
    const order = {
      id: 'state-graph-trusted-payment-order',
      cart,
      status: 'created' as const,
      paymentStatus: 'not_started' as const,
      assignedStoreId: 'state-graph-trusted-payment-store',
      createdAt: '2026-07-20T00:00:00.000Z',
    };
    const paymentMethod = createTestFixtures().paymentMethods[0]!;
    const collectionKey =
      'state-graph-trusted-payment-collection';
    const selectedPaymentMethod = {
      methodId: paymentMethod.methodId,
      collectionKey,
      collectionRevision:
        'state-graph-trusted-payment-collection-revision',
      providerRevision:
        input.clients.confirmationAuthority!.providerRevision,
    };
    const verifiedState = {
      cart,
      order,
      selectedPaymentMethod,
      paymentMethodEvidence: [paymentMethod],
      activeCollectionKeys: {
        listPaymentMethods: collectionKey,
      },
      verifiedCollections: {
        listPaymentMethods: {
          [collectionKey]: {
            key: collectionKey,
            revision: selectedPaymentMethod.collectionRevision,
            providerRevision:
              selectedPaymentMethod.providerRevision,
            result: {
              items: [paymentMethod],
              total: 1,
              returned: 1,
              complete: true,
              scope: { scope: 'all' as const },
            },
          },
        },
      },
      toolTrace: [],
    };
    await input.store.appendEvent(input.sessionId, 'graph:verified_state', {
      verifiedState,
    });
    const createPaymentLink = vi.spyOn(
      input.clients.payment,
      'createPaymentLink',
    );
    const trustedCustomerAction =
      createTrustedCustomerActionEnvelope({
        source: 'kfc_genui_action',
        assistantTurnId: 'assistant-trusted-payment-approval',
        attachmentId: 'attachment-trusted-payment-approval',
        actionDigest: 'd'.repeat(64),
        verifiedRevision:
          kfcGenUiVerifiedStateRevision(verifiedState),
        lifecycle: 'one_shot',
        command: { kind: 'continue_payment' },
      });

    const paused = await runAgentTurn({
      ...input,
      trustedCustomerAction,
    });
    const record = canonicalConfirmationRecord(paused);
    expect(createPaymentLink).not.toHaveBeenCalled();
    expect(planningModel.callCount).toBe(0);
    expect(responseModel.callCount).toBe(0);

    const resume = await authenticatedResume(
      record,
      1_000,
      'approve',
    );
    let output;
    try {
      output = await runAgentTurn({
        ...input,
        trustedCustomerAction,
        confirmationResume: resume.confirmationResume,
      });
    } finally {
      resume.externalCallScope.dispose();
    }

    expect(createPaymentLink).toHaveBeenCalledOnce();
    expect(planningModel.callCount).toBe(0);
    expect(responseModel.callCount).toBe(1);
    expect(bindings).toEqual([[GROUNDED_RESPONSE_TOOL_NAME]]);
    expect(output.responseText).toBe(
      'The verified payment link is ready.',
    );
    expect(output.state.paymentAttempt).toMatchObject({
      orderId: order.id,
      method: selectedPaymentMethod.methodId,
      status: 'pending',
    });
    expect(selectedActionResponse).toMatchObject({
      actionDigest: trustedCustomerAction.actionDigest,
      effect: { outcome: 'tool_succeeded' },
      assertion: 'mutation_completed',
    });
  });

  it.each([
    [
      'invalid typed output',
      new AIMessage({
        content: '',
        tool_calls: [{
          id: 'invalid-grounded-response',
          name: GROUNDED_RESPONSE_TOOL_NAME,
          args: { customerText: 'Missing claims.' },
        }],
      }),
    ],
    [
      'plain response',
      new AIMessage('Raw structured-action response is rejected.'),
    ],
  ] as const)(
    'keeps %s correction provider-valid and response-only',
    async (_label, rejectedResponse: BaseMessage) => {
      const baseModel = fakeModel();
      const planningModel = fakeModel().respond(
        new AIMessage('planning must not run'),
      );
      const responseModel = fakeModel()
        .respond(rejectedResponse)
        .respond((messages) => {
          return structuredGroundedResponse(
            messages,
            'Your verified cart remains ready to edit.',
          );
        });
      vi.spyOn(baseModel, 'bindTools').mockImplementation((tools) => {
        const names = (tools as Array<{ name?: string }>).flatMap(
          ({ name }) => name ? [name] : [],
        );
        return (
          names.length === 1 &&
          names[0] === GROUNDED_RESPONSE_TOOL_NAME
            ? responseModel
            : planningModel
        ) as ReturnType<NonNullable<typeof baseModel.bindTools>>;
      });
      const input = turnInput(
        baseModel,
        `structured-correction-${_label.replaceAll(' ', '-')}`,
      );
      const cart = verifiedCart();
      await seedCurrentUserTurn(input);
      await input.store.appendEvent(input.sessionId, 'graph:verified_state', {
        verifiedState: { cart, toolTrace: [] },
      });

      const output = await runAgentTurn({
        ...input,
        trustedCustomerAction: createTrustedCustomerActionEnvelope({
          source: 'kfc_genui_action',
          assistantTurnId: 'assistant-correction',
          attachmentId: 'attachment-correction',
          actionDigest: 'c'.repeat(64),
          verifiedRevision: kfcGenUiVerifiedStateRevision({ cart }),
          lifecycle: 'one_shot',
          command: { kind: 'edit_cart' },
        }),
      });

      expect(output.responseText).toBe(
        'Your verified cart remains ready to edit.',
      );
      expect(planningModel.callCount).toBe(0);
      expect(responseModel.callCount).toBe(2);
      expect(responseModel.calls[1]?.messages.some(isToolMessage)).toBe(false);
      expect(responseModel.calls[1]?.messages).toContainEqual(
        expect.objectContaining({
          id: STRUCTURED_RESPONSE_CORRECTION_MESSAGE_ID,
        }),
      );
      expect(
        responseModel.calls[1]?.messages.some(
          (message) =>
            isSystemMessage(message) &&
            message.id === STRUCTURED_RESPONSE_CORRECTION_MESSAGE_ID,
        ),
      ).toBe(true);
    },
  );

  it('reuses verified menu GenUI only when the current verified response cites its collection', async () => {
    const claims = groundedResponseClaims({
      evidenceReferences: [{
        evidenceId: 'active_collection:searchMenu',
        claimKinds: ['product', 'price', 'status'],
      }],
    });
    const model = fakeModel().respond(
      groundedResponseModelReply({
        customerText: 'The verified menu option is unavailable.',
        ...claims,
      }),
    );
    const input = {
      ...turnInput(model, 'state-graph-menu-response-authority'),
      responseProfile: 'genui' as const,
    };
    const items = [{
      code: '41140',
      name: 'Burger Tôm',
      description: 'Burger tôm',
      category: 'Burger',
      priceVnd: 45_000,
      originalPriceVnd: null,
      imageUrl: '',
      available: false,
    }];
    const menu = {
      key: 'menu:unavailable',
      revision: 'menu-revision',
      providerRevision: 'provider-revision',
      result: {
        items,
        total: 1,
        returned: 1,
        complete: true,
        scope: {
          scope: 'filtered' as const,
          query: 'opaque-catalog-query',
        },
      },
    };
    await input.store.appendEvent(input.sessionId, 'graph:verified_state', {
      verifiedState: {
        verifiedCollections: {
          searchMenu: {
            [menu.key]: menu,
          },
        },
        activeCollectionKeys: {
          searchMenu: menu.key,
        },
        activeMenuCollection: menu,
        menuSearchResults: items,
        toolTrace: [],
      },
    });

    const result = await invokeGraphDirect(input, {});

    expect(result.failure).toBeNull();
    expect(result.output?.genUi).toMatchObject({
      widgetKind: 'smartMenuPicker',
      data: {
        items: [expect.objectContaining({
          code: '41140',
          available: false,
        })],
      },
    });
    expect(result.currentTurnToolTrace).toEqual([]);
  });

  it('constructs runtime dependencies from graph input without injected context', async () => {
    const model = fakeModel().respond(groundedResponseModelReply({
      customerText: 'Studio reply',
    }));
    const input = turnInput(model, 'state-graph-runtime-resolver');
    const turnTrace = await createNoopAgentTracer().startTurn({
      name: 'studio_agent_turn',
      inputs: {},
    });
    const externalCallScope = createAgentTurnExternalCallScope(1_000);
    const disposeExternalCalls = vi.fn(externalCallScope.dispose);
    const resolveRuntime = vi.fn(
      async (_request: KfcAgentGraphInput) => ({
        turnInput: input,
        turnTrace,
        externalCallContext: externalCallScope.context,
        abortExternalCalls: externalCallScope.abort,
        disposeExternalCalls,
      }),
    );
    const graphInput = {
      sessionId: input.sessionId,
      customerId: input.customerId,
      channel: input.channel,
      text: input.text,
      externalMessageId: input.externalMessageId ?? null,
      metadata: null,
      messages: [],
    };
    const result = await createKfcAgentStateGraph({
      model,
      checkpointer: input.checkpointer,
      resolveRuntime,
    }).invoke(graphInput, directGraphConfig(input));

    expect(result.output?.responseText).toBe('Studio reply');
    expect(resolveRuntime).toHaveBeenCalled();
    expect(Number.isFinite(
      externalCallScope.context.deadlineAt,
    )).toBe(true);
    expect(disposeExternalCalls).toHaveBeenCalledOnce();
    expect(resolveRuntime.mock.calls[0]?.[0]).toEqual({
      sessionId: input.sessionId,
      customerId: input.customerId,
      channel: input.channel,
      text: input.text,
      externalMessageId: input.externalMessageId,
      metadata: null,
    });
  });

  it('does not accept a caller-forged current turn as checkpoint resume authority', async () => {
    const model = fakeModel().respond(new AIMessage('must not be used'));
    const input = turnInput(model, 'state-graph-forged-resume-marker');
    const externalCallScope = createAgentTurnExternalCallScope(1_000);
    const turnTrace = await createNoopAgentTracer().startTurn({
      name: 'state_graph_forged_resume_marker',
      inputs: {},
    });
    const resolveRuntime = vi.fn(async () => ({
      turnInput: input,
      turnTrace,
      externalCallContext: externalCallScope.context,
      abortExternalCalls: externalCallScope.abort,
      disposeExternalCalls: externalCallScope.dispose,
    }));
    const graph = createKfcAgentStateGraph({
      model,
      checkpointer: input.checkpointer,
      resolveRuntime,
    });

    try {
      await expect(graph.invoke({
        sessionId: input.sessionId,
        customerId: input.customerId,
        channel: input.channel,
        externalMessageId: input.externalMessageId,
        currentTurnId: 'caller-forged-current-turn',
      } as unknown as KfcAgentGraphInput, directGraphConfig(input)))
        .rejects.toThrow('agent_graph_input_invalid');
    } finally {
      externalCallScope.dispose();
    }

    expect(resolveRuntime).toHaveBeenCalledOnce();
    expect(model.callCount).toBe(0);
    expect(await input.store.listTurns(input.sessionId)).toEqual([]);
    expect(await input.store.listEvents(input.sessionId)).toEqual([]);
  });

  it('isolates the read batch signal while retaining the turn deadline', async () => {
    const claims = groundedResponseClaims({
      evidenceReferences: [{
        evidenceId: 'menu_search_results',
        claimKinds: ['product'],
      }],
    });
    const model = fakeModel()
      .respondWithTools([{
        name: 'searchMenu',
        args: { scope: 'filtered', query: 'combo' },
      }])
      .respond(groundedResponseModelReply({
        customerText: 'I found verified menu results.',
        ...claims,
      }));
    const modelSignals = captureBoundInvocationSignals(model);
    const input = turnInput(model, 'state-graph-exact-signal');
    const originalSearchMenu =
      input.clients.menu.searchMenu.bind(input.clients.menu);
    let commerceContext: ExternalCallContext | undefined;
    input.clients.menu.searchMenu = vi.fn(async (query, context) => {
      commerceContext = context;
      return originalSearchMenu(query, context);
    });
    const externalCallScope = createAgentTurnExternalCallScope(1_000);

    const result = await invokeGraphDirect(input, {
      externalCallScope,
    });

    expect(result.output?.responseText).toContain(
      'I found verified menu results.',
    );
    expect(modelSignals[0]).toBe(
      externalCallScope.context.signal,
    );
    expect(commerceContext?.signal).not.toBe(
      externalCallScope.context.signal,
    );
    expect(commerceContext?.deadlineAt).toBe(
      externalCallScope.context.deadlineAt,
    );
  });

  it('routes thrown tool errors through fail-closed persistence', async () => {
    const model = fakeModel().respondWithTools([{
      name: 'searchMenu',
      args: { scope: 'filtered', query: 'combo' },
    }]);
    const input = turnInput(model, 'state-graph-tool-error');
    input.clients.menu.searchMenu = async () => {
      throw new Error('provider exploded');
    };

    await expect(runAgentTurn(input)).rejects.toThrow(
      'agent_tool_execution_failed',
    );
    await expectPersistedFailure(
      input.store,
      input.sessionId,
      'agent_tool_execution_failed',
    );
  });

  it('routes thrown approval revalidation errors through fail-closed persistence', async () => {
    const model = fakeModel()
      .respondWithTools([{
        name: 'handoff',
        args: { reasons: ['customer requested support'] },
      }])
      .respond(new AIMessage('Order creation cancelled.'));
    const input = approvalTurnInput(
      model,
      'state-graph-approval-error',
      'handoff:write',
    );
    const paused = await runAgentTurn(input);
    const record = canonicalConfirmationRecord(paused);
    const revalidate = vi.fn(async (
      _providerBinding:
        Parameters<
          NonNullable<typeof input.clients.confirmationAuthority>['revalidate']
        >[0],
      _externalCallContext: ExternalCallContext,
    ) => {
      throw new Error('provider exploded');
    });
    input.clients.confirmationAuthority!.revalidate = revalidate;
    const resume = await authenticatedResume(record, 1_000);

    try {
      await expect(runAgentTurn({
        ...input,
        confirmationResume: resume.confirmationResume,
      })).rejects.toThrow('agent_approval_receipt_binding_mismatch');
    } finally {
      resume.externalCallScope.dispose();
    }
    expect(revalidate).toHaveBeenCalledOnce();
    expect(revalidate.mock.calls[0]?.[1]).toBe(
      resume.externalCallScope.context,
    );
    await expectPersistedFailure(
      input.store,
      input.sessionId,
      'agent_approval_receipt_binding_mismatch',
    );
  });

  it('starts approval resume with a fresh finite external-call deadline', async () => {
    const model = fakeModel()
      .respondWithTools([{
        name: 'handoff',
        args: { reasons: ['customer requested support'] },
      }])
      .respond(groundedResponseModelReply({
        customerText: 'I left the verified order unsubmitted.',
      }));
    const modelSignals = captureBoundInvocationSignals(model);
    const input = {
      ...approvalTurnInput(
        model,
        'state-graph-resume-deadline',
        'handoff:write',
      ),
      turnDeadlineMs: 250,
    };
    const paused = await runAgentTurn(input);
    const record = canonicalConfirmationRecord(paused);
    const authority = input.clients.confirmationAuthority!;
    const revalidate = vi.fn(authority.revalidate.bind(authority));
    input.clients.confirmationAuthority = { ...authority, revalidate };

    await new Promise((resolve) => setTimeout(resolve, 275));
    const resumeStartedAt = Date.now();
    const resume = await authenticatedResume(record, 250);
    let output;
    try {
      output = await runAgentTurn({
        ...input,
        confirmationResume: resume.confirmationResume,
      });
    } finally {
      resume.externalCallScope.dispose();
    }

    expect(output.responseText).toBe(
      'I left the verified order unsubmitted.',
    );
    expect(revalidate).toHaveBeenCalledOnce();
    const resumeContext = revalidate.mock.calls[0]?.[1];
    expect(resumeContext).toBe(resume.externalCallScope.context);
    expect(resumeContext?.deadlineAt).toBeGreaterThan(resumeStartedAt);
    expect(modelSignals.at(-1)).toBe(
      resumeContext?.signal,
    );
  });

  it('refreshes the checkpoint deadline on a raw Studio-style resume', async () => {
    vi.useFakeTimers();
    const model = fakeModel()
      .respondWithTools([{
        name: 'handoff',
        args: { reasons: ['customer requested support'] },
      }])
      .respond(groundedResponseModelReply({
        customerText: 'I left the verified order unsubmitted.',
      }));
    const modelSignals = captureBoundInvocationSignals(model);
    const baseInput = {
      ...approvalTurnInput(
        model,
        'state-graph-raw-studio-resume',
        'handoff:write',
      ),
      confirmationRequestId: '00000000-0000-4000-8000-000000000734',
    };
    let currentInput: SingleAgentRuntimeContext['turnInput'] = baseInput;
    let cachedRuntime: SingleAgentRuntimeContext | undefined;
    let latestRuntime: SingleAgentRuntimeContext | undefined;
    let forcedRuntime: SingleAgentRuntimeContext | undefined;
    const scopes: AgentTurnExternalCallScope[] = [];
    const turnTrace = await createNoopAgentTracer().startTurn({
      name: 'state_graph_raw_studio_resume',
      inputs: {},
    });
    const resolveRuntime = vi.fn(async () => {
      if (forcedRuntime) return forcedRuntime;
      if (cachedRuntime) return cachedRuntime;
      const scope = createAgentTurnExternalCallScope(
        scopes.length === 0 ? 25 : 500,
      );
      scopes.push(scope);
      const runtime: SingleAgentRuntimeContext = {
        turnInput: currentInput,
        turnTrace,
        externalCallContext: scope.context,
        abortExternalCalls: scope.abort,
        disposeExternalCalls: () => {
          scope.dispose();
          if (cachedRuntime === runtime) cachedRuntime = undefined;
        },
      };
      cachedRuntime = runtime;
      latestRuntime = runtime;
      return runtime;
    });
    const graph = createKfcAgentStateGraph({
      model,
      checkpointer: baseInput.checkpointer,
      resolveRuntime,
    });
    const config = directGraphConfig(baseInput);
    const paused = await graph.invoke({
      sessionId: baseInput.sessionId,
      customerId: baseInput.customerId,
      channel: baseInput.channel,
      text: baseInput.text,
      externalMessageId: baseInput.externalMessageId,
      metadata: null,
      messages: [],
    }, config);
    const pausedState = paused.domainState!;
    const action = {
      toolName: 'handoff' as const,
      arguments: { reasons: ['customer requested support'] },
    };
    const authority = baseInput.clients.confirmationAuthority!;
    const bindingScope = createAgentTurnExternalCallScope(1_000);
    const approvalBinding = await buildCurrentAgentApprovalBinding(
      baseInput.clients,
      action,
      {
        ...toolExecutionContext(baseInput),
        approval: {
          principal: {
            sessionId: baseInput.sessionId,
            customerId: baseInput.customerId,
            channel: baseInput.channel,
            authenticatedSubject: baseInput.accessContext.kfcSubjectRef,
            authenticationEvidenceRef:
              baseInput.accessContext.authenticationEvidence.state ===
                'verified'
                ? baseInput.accessContext.authenticationEvidence.evidenceRef
                : 'missing',
          },
        },
        externalCallContext: bindingScope.context,
        state: pausedState,
        cart: pausedState.cart,
        address: pausedState.address,
        order: pausedState.order,
        orderPreview: pausedState.orderPreview,
      },
    );
    bindingScope.dispose();
    if ('ok' in approvalBinding) {
      throw new Error(
        `raw_studio_approval_binding_failed:${
          approvalBinding.errorCode ?? 'unknown'
        }`,
      );
    }
    const revalidate = vi.fn(authority.revalidate.bind(authority));
    baseInput.clients.confirmationAuthority = { ...authority, revalidate };
    const signingSecret =
      'raw-studio-rejection-signing-secret-at-least-32-bytes';
    const commerceReceipt = await createCommerceApprovalReceipt({
      binding: approvalBinding,
      secret: signingSecret,
      decision: 'reject',
      receiptId: baseInput.confirmationRequestId,
    });
    const approvalBindingDigest = await digestCommerceAction(
      approvalBinding,
    );
    const pausedCheckpoint = await baseInput.checkpointer.getTuple(config);
    const pausedCheckpointConfig = pausedCheckpoint?.config.configurable;
    if (!pausedCheckpoint || !pausedCheckpointConfig) {
      throw new Error('paused checkpoint missing');
    }
    const executionFence = await createCommerceApprovalExecutionFence({
      secret: signingSecret,
      claim: {
        schemaVersion: 'kfc-commerce-approval-execution-v1',
        operation: 'confirmation_resume',
        requestId: commerceReceipt.receiptId,
        expectedSessionGeneration: 0,
        sessionAuthorityGeneration: 0,
        checkpointThreadId: pausedCheckpointConfig.thread_id,
        checkpointNamespace: pausedCheckpointConfig.checkpoint_ns ?? '',
        checkpointId: pausedCheckpoint.checkpoint.id,
        bindingFingerprint: approvalBindingDigest,
        approvalBindingDigest,
        providerIdempotencyKey:
          `confirmation:${commerceReceipt.receiptId}:handoff:test`,
        attempt: 1,
        leaseToken: crypto.randomUUID(),
      },
    });
    currentInput = {
      ...baseInput,
      confirmationResume: {
        requestId: commerceReceipt.receiptId,
        approved: false,
        action,
        commerceReceipt,
        executionFence,
        signingSecret,
      },
    };

    await vi.advanceTimersByTimeAsync(40);
    expect(paused.failure).toBeNull();
    expect(paused.turnDeadlineAt).toBeLessThanOrEqual(Date.now());
    const resumed = await graph.invoke(new Command({
      resume: { requestId: commerceReceipt.receiptId },
    }), config);

    expect(resumed.output?.responseText).toBe(
      'I left the verified order unsubmitted.',
    );
    expect(scopes).toHaveLength(2);
    expect(resumed.turnDeadlineAt).toBe(scopes[1]?.context.deadlineAt);
    expect(resumed.turnDeadlineAt).toBeGreaterThan(Date.now());
    expect(revalidate.mock.calls[0]?.[1]).toBe(scopes[1]?.context);
    expect(modelSignals.at(-1)).toBe(scopes[1]?.context.signal);
    const completedTurnCount =
      (await baseInput.store.listTurns(baseInput.sessionId)).length;
    const completedEventCount =
      (await baseInput.store.listEvents(baseInput.sessionId)).length;
    const completedModelCalls = model.callCount;
    if (!latestRuntime) throw new Error('resumed runtime missing');
    forcedRuntime = latestRuntime;
    await expect(graph.invoke({
      sessionId: baseInput.sessionId,
      customerId: baseInput.customerId,
      channel: baseInput.channel,
      externalMessageId: baseInput.externalMessageId,
      currentTurnId: 'forged-after-genuine-resume',
    } as unknown as KfcAgentGraphInput, directGraphConfig({
      sessionId: baseInput.sessionId,
      checkpointRunId: 'fresh-after-genuine-resume',
    }))).rejects.toThrow('agent_graph_input_invalid');
    expect(model.callCount).toBe(completedModelCalls);
    expect(await baseInput.store.listTurns(baseInput.sessionId))
      .toHaveLength(completedTurnCount);
    expect(await baseInput.store.listEvents(baseInput.sessionId))
      .toHaveLength(completedEventCount);
    scopes.at(-1)?.dispose();
  });

  it('fails approval revalidation directly at the resumed turn deadline', async () => {
    const model = fakeModel()
      .respondWithTools([{
        name: 'handoff',
        args: { reasons: ['customer requested support'] },
      }])
      .respond(new AIMessage('must not be used'));
    const input = {
      ...approvalTurnInput(
        model,
        'state-graph-resume-revalidation-deadline',
        'handoff:write',
      ),
      turnDeadlineMs: 100,
    };
    const paused = await runAgentTurn(input);
    const record = canonicalConfirmationRecord(paused);
    const revalidate = vi.fn(
      async (
        _providerBinding:
          Parameters<
            NonNullable<
              typeof input.clients.confirmationAuthority
            >['revalidate']
          >[0],
        context: ExternalCallContext,
      ) => new Promise<never>((_resolve, reject) => {
        const rejectWithReason = () => reject(context.signal.reason);
        context.signal.addEventListener('abort', rejectWithReason, {
          once: true,
        });
        if (context.signal.aborted) rejectWithReason();
      }),
    );
    input.clients.confirmationAuthority!.revalidate = revalidate;
    const resume = await authenticatedResume(record, 100);

    try {
      await expect(runAgentTurn({
        ...input,
        confirmationResume: resume.confirmationResume,
      })).rejects.toThrow('agent_turn_deadline_exceeded');
    } finally {
      resume.externalCallScope.dispose();
    }

    expect(model.callCount).toBe(1);
    expect(revalidate).toHaveBeenCalledOnce();
    await expectPersistedFailure(
      input.store,
      input.sessionId,
      'agent_turn_deadline_exceeded',
    );
  });

  it('stops after one transient retry and persists safe attempt evidence', async () => {
    const transient = Object.assign(new Error('secret provider detail'), {
      status: 503,
    });
    const model = fakeModel()
      .respond(transient)
      .respond(transient)
      .respond(new AIMessage('must not be used'));
    const input = turnInput(model, 'state-graph-provider-retry-limit');

    await expect(runAgentTurn(input)).rejects.toThrow(
      'agent_provider_call_failed:server_error',
    );

    expect(model.callCount).toBe(2);
    const failure = (await input.store.listEvents(input.sessionId)).find(
      (event) => event.sourceType === 'agent:failed_closed',
    );
    expect(failure?.payload).toEqual({
      errorCode: 'agent_provider_call_failed:server_error',
      providerAttempts: [
        {
          attempt: 1,
          purpose: 'agent_decision',
          outcome: 'error',
          errorClass: 'server_error',
          retryable: true,
        },
        {
          attempt: 2,
          purpose: 'agent_decision',
          outcome: 'error',
          errorClass: 'server_error',
          retryable: true,
        },
      ],
    });
    expect(JSON.stringify(failure?.payload)).not.toContain(
      'secret provider detail',
    );
  });

  it('does not call the provider after the turn deadline', async () => {
    const model = fakeModel().respond(new AIMessage('must not be used'));
    const input = {
      ...turnInput(model, 'state-graph-provider-deadline'),
      turnDeadlineMs: 0,
    };

    await expect(runAgentTurn(input)).rejects.toThrow(
      'agent_turn_deadline_exceeded',
    );

    expect(model.callCount).toBe(0);
    await expectPersistedFailure(
      input.store,
      input.sessionId,
      'agent_turn_deadline_exceeded',
    );
  });

  it('aborts an in-flight provider call at the turn deadline', async () => {
    const model = fakeModel();
    const generate = vi.spyOn(model, '_generate').mockImplementation(
      (_messages, options) => new Promise<never>((_resolve, reject) => {
        const signal = options?.signal;
        if (!signal) {
          reject(new Error('provider_abort_signal_missing'));
          return;
        }
        const rejectWithReason = () => reject(signal.reason);
        signal.addEventListener('abort', rejectWithReason, { once: true });
        if (signal.aborted) rejectWithReason();
      }),
    );
    vi.spyOn(model, 'bindTools').mockReturnValue(model);
    const input = {
      ...turnInput(model, 'state-graph-inflight-deadline'),
      turnDeadlineMs: 100,
    };

    await expect(runAgentTurn(input)).rejects.toThrow(
      'agent_turn_deadline_exceeded',
    );

    expect(generate).toHaveBeenCalledOnce();
    const failure = (await input.store.listEvents(input.sessionId)).find(
      (event) => event.sourceType === 'agent:failed_closed',
    );
    expect(failure?.payload).toEqual({
      errorCode: 'agent_turn_deadline_exceeded',
    });
  });

  it('discards a concurrent read batch without replanning or persistence after abort', async () => {
    const model = fakeModel()
      .respondWithTools([
        {
          name: 'searchMenu',
          args: { scope: 'filtered', query: 'combo' },
        },
        {
          name: 'findStores',
          args: { query: 'nearby', city: null, district: null },
        },
      ])
      .respond(new AIMessage('must not be used'));
    const input = {
      ...turnInput(model, 'state-graph-tool-deadline'),
      // Leave enough time for graph setup and the first model call so this
      // test measures cancellation of the in-flight provider reads.
      turnDeadlineMs: 500,
    };
    await input.store.appendEvent(input.sessionId, 'graph:verified_state', {
      verifiedState: {
        cart: verifiedCart(),
        toolTrace: [],
      },
    });
    let dispatchedContext: ExternalCallContext | undefined;
    const searchMenu = vi.fn(
      async (_query: string, context: ExternalCallContext) =>
        new Promise<never>((_resolve, reject) => {
          dispatchedContext = context;
          const rejectWithReason = () => reject(context.signal.reason);
          context.signal.addEventListener('abort', rejectWithReason, {
            once: true,
          });
          if (context.signal.aborted) rejectWithReason();
        }),
    );
    const findStores = vi.fn(input.clients.storeLocator.findStores);
    input.clients.menu.searchMenu = searchMenu;
    input.clients.storeLocator.findStores = findStores;

    await expect(runAgentTurn(input)).rejects.toThrow(
      'agent_turn_deadline_exceeded',
    );

    expect(model.callCount).toBe(1);
    expect(searchMenu).toHaveBeenCalledOnce();
    expect(findStores).toHaveBeenCalledOnce();
    expect(dispatchedContext).toEqual({
      signal: expect.any(AbortSignal),
      deadlineAt: expect.any(Number),
    });
    expect(dispatchedContext?.signal.aborted).toBe(true);
    const events = await input.store.listEvents(input.sessionId);
    expect(events.filter(
      ({ sourceType }) => sourceType === 'agent:failed_closed',
    )).toHaveLength(1);
    expect(events.filter(
      ({ sourceType }) => sourceType === 'graph:verified_state',
    )).toHaveLength(1);
  });

  it('rechecks run ownership after the planning observer before model dispatch', async () => {
    let current = true;
    const model = fakeModel().respond(new AIMessage('must not be used'));
    const input = {
      ...turnInput(model, 'state-graph-observer-superseded-model'),
      runGuard: { isCurrent: vi.fn(async () => current) },
      observeRun: vi.fn(async ({ kind }) => {
        if (kind === 'planning') current = false;
      }),
    };
    const externalCallScope = createAgentTurnExternalCallScope(1_000);

    const result = await invokeGraphDirect(input, { externalCallScope });

    expect(result.failure).toBe('customer_run_cancelled');
    expect(model.callCount).toBe(0);
    expect(externalCallScope.context.signal.aborted).toBe(true);
  });

  it('rechecks run ownership after the tool observer before commerce dispatch', async () => {
    let current = true;
    const model = fakeModel().respondWithTools([{
      name: 'searchMenu',
      args: { scope: 'filtered', query: 'combo' },
    }]);
    const input = {
      ...turnInput(model, 'state-graph-observer-superseded-tool'),
      runGuard: { isCurrent: vi.fn(async () => current) },
      observeRun: vi.fn(async ({ kind }) => {
        if (kind === 'tool') current = false;
      }),
    };
    const searchMenu = vi.fn(input.clients.menu.searchMenu);
    input.clients.menu.searchMenu = searchMenu;
    const externalCallScope = createAgentTurnExternalCallScope(1_000);

    const result = await invokeGraphDirect(input, { externalCallScope });

    expect(result.failure).toBe('customer_run_cancelled');
    expect(model.callCount).toBe(1);
    expect(searchMenu).not.toHaveBeenCalled();
    expect(externalCallScope.context.signal.aborted).toBe(true);
  });

  it('preserves authorized nullable address fields for provider dispatch and trace projection', async () => {
    const responseClaims = groundedResponseClaims();
    const model = fakeModel()
      .respondWithTools([{
        name: 'quoteFulfillment',
        args: {
          address: {
            label: null,
            line1: '60 Đ. Phạm Văn Nghị',
            district: 'Quận 7',
            city: 'Hồ Chí Minh',
          },
          method: 'delivery',
        },
      }])
      .respond(groundedResponseModelReply({
        customerText: 'Okay.',
        ...responseClaims,
      }));
    const input = turnInput(
      model,
      'state-graph-canonical-tool-arguments',
    );
    input.text =
      'Giao tới 60 Đ. Phạm Văn Nghị, Quận 7, Hồ Chí Minh.';
    await input.store.appendEvent(input.sessionId, 'graph:verified_state', {
      verifiedState: {
        cart: verifiedCart(),
        toolTrace: [],
      },
    });
    const quoteFulfillment = vi.fn(
      input.clients.fulfillment.quoteFulfillment,
    );
    input.clients.fulfillment.quoteFulfillment = quoteFulfillment;

    const result = await invokeGraphDirect(input, {});

    expect(result.failure).toBeNull();
    expect(quoteFulfillment).toHaveBeenCalledWith(
      {
        address: {
          label: null,
          line1: '60 Đ. Phạm Văn Nghị',
          district: 'Quận 7',
          city: 'Hồ Chí Minh',
        },
        method: 'delivery',
        itemCodes: ['20751'],
      },
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        deadlineAt: expect.any(Number),
      }),
    );
    expect(result.currentTurnToolTrace).toContainEqual(
      expect.objectContaining({
        toolName: 'quoteFulfillment',
        arguments: {
          address: {
            label: null,
            line1: '60 Đ. Phạm Văn Nghị',
            district: 'Quận 7',
            city: 'Hồ Chí Minh',
          },
          method: 'delivery',
        },
        publicationEvidenceAudit: expect.objectContaining({
          argumentsDigest: await stateRevision({
            address: {
              label: null,
              line1: '60 Đ. Phạm Văn Nghị',
              district: 'Quận 7',
              city: 'Hồ Chí Minh',
            },
            method: 'delivery',
          }),
        }),
      }),
    );
  });

  it('discards a late model result instead of checkpointing it with cancellation', async () => {
    const model = fakeModel().respond(new AIMessage('late response'));
    const generate = model._generate.bind(model);
    vi.spyOn(model, '_generate').mockImplementation(async (...args) => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return generate(...args);
    });
    vi.spyOn(model, 'bindTools').mockReturnValue(model);
    const input = turnInput(model, 'state-graph-late-model-result');

    const result = await invokeGraphDirect(input, { deadlineMs: 10 });

    expect(result.failure).toBe('agent_turn_deadline_exceeded');
    expect(result.messages.some(isAIMessage)).toBe(false);
    expect(result.providerAttempts).toBe(0);
    expect(result.providerAttemptEvidence).toEqual([]);
  });

  it('keeps verified state transactional when cancellation occurs during observation', async () => {
    let current = true;
    let verifiedStateObservations = 0;
    const model = fakeModel()
      .respondWithTools([{
        name: 'searchMenu',
        args: { scope: 'all', query: null },
      }])
      .respondWithTools([{
        name: 'updateCart',
        args: {
          changes: [{
            itemCode: '20751',
            quantity: 1,
            modifiers: [],
          }],
        },
      }]);
    const baseInput = turnInput(
      model,
      'state-graph-transactional-cancellation',
    );
    const runId = 'state-graph-transactional-cancellation-run';
    const run = await baseInput.store.createCustomerRun({
      id: runId,
      schemaVersion: 1,
      sessionId: baseInput.sessionId,
      customerId: baseInput.customerId,
      clientMessageId: runId,
      requestFingerprint: `${runId}-fingerprint`,
      generation: 1,
      status: 'running',
      phase: 'read_only_tool',
      nextEventSequence: 1,
      clientSchemaVersion: 1,
      acceptedAt: '2026-07-20T00:00:00.000Z',
      startedAt: '2026-07-20T00:00:00.000Z',
      terminalAt: null,
      updatedAt: '2026-07-20T00:00:00.000Z',
    });
    const {
      externalMessageId: _externalMessageId,
      ...inputWithoutExternalMessageId
    } = baseInput;
    const input = {
      ...inputWithoutExternalMessageId,
      runGuard: {
        isCurrent: vi.fn(async () => current),
        commitFence: {
          kind: 'customer_run' as const,
          runId,
          sessionAuthorityGeneration:
            run.sessionAuthorityGeneration,
        },
      },
      observeRun: vi.fn(async ({ kind }) => {
        if (kind !== 'verified_state') return;
        verifiedStateObservations += 1;
        if (verifiedStateObservations === 2) {
          current = false;
          await baseInput.store.updateCustomerRun(runId, {
            status: 'superseded',
            terminalAt: '2026-07-20T00:00:01.000Z',
          });
        }
      }),
    };
    const externalCallScope = createAgentTurnExternalCallScope(1_000);

    const result = await invokeGraphDirect(input, { externalCallScope });

    expect(result.failure).toBe('customer_run_cancelled');
    expect(result.domainState?.cart).toBeUndefined();
    expect(result.domainState?.toolTrace?.map(({ toolName }) => toolName))
      .toEqual(['searchMenu']);
    expect(result.currentTurnToolTrace.map(({ toolName }) => toolName))
      .toEqual(['searchMenu']);
    const snapshots = (await input.store.listEvents(input.sessionId)).filter(
      ({ sourceType }) => sourceType === 'graph:verified_state',
    );
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.payload).toHaveProperty(
      'verifiedState.cart',
      undefined,
    );
    expect(
      (await input.store.listTurns(input.sessionId))
        .filter(({ role }) => role === 'user'),
    ).toHaveLength(1);
    expect(
      (await input.store.listEvents(input.sessionId))
        .filter(
          ({ sourceType }) => sourceType === 'conversation_turn:user',
        ),
    ).toHaveLength(1);
    expect(externalCallScope.context.signal.aborted).toBe(true);
  });

  it('fails closed when the run observer rejects before inference', async () => {
    const model = fakeModel().respond(new AIMessage('must not be used'));
    const input = {
      ...turnInput(model, 'state-graph-observer-error'),
      observeRun: async () => {
        throw new Error('observer unavailable');
      },
    };

    await expect(runAgentTurn(input)).rejects.toThrow(
      'agent_run_observer_failed',
    );

    expect(model.callCount).toBe(0);
    await expectPersistedFailure(
      input.store,
      input.sessionId,
      'agent_run_observer_failed',
    );
  });

  it('does not disguise persistence-load failures as provider failures', async () => {
    const model = fakeModel().respond(new AIMessage('must not be used'));
    const input = turnInput(model, 'state-graph-store-error');
    vi.spyOn(input.store, 'listTurns').mockRejectedValueOnce(
      new Error('state store unavailable'),
    );

    await expect(runAgentTurn(input)).rejects.toThrow(
      'state store unavailable',
    );
    expect(model.callCount).toBe(0);
  });
});
