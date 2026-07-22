/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- boundary tests use opaque LangChain and runtime fixtures */
import type { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager';
import type { RunnableConfig } from '@langchain/core/runnables';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';
import type { StructuredTool } from '@langchain/core/tools';
import { END, GraphInterrupt, START, StateGraph } from '@langchain/langgraph';
import { MiddlewareError, StructuredOutputParsingError } from 'langchain';
import { describe, expect, it, vi } from 'vitest';
import {
  createKfcSemanticAgentNode,
  type KfcSemanticAgentLike,
  type KfcSemanticAgentNodeDependencies,
} from '../../src/agent/agentStateGraph.js';
import {
  createKfcAgent,
  KFC_CREATE_AGENT_RESPONSE_SCHEMA,
  KFC_CREATE_AGENT_SYSTEM_PROMPT,
} from '../../src/agent/kfcCreateAgent.js';
import { createKfcCreateAgentTools } from '../../src/agent/kfcCreateAgentTools.js';
import {
  canonicalToolCallSignature,
  relevantToolState,
} from '../../src/agent/agentToolCallLedger.js';
import type { KfcCreateAgentToolCoordinator } from '../../src/agent/kfcCreateAgentToolCoordinator.js';
import {
  boundedStructuredOutputFeedback,
  consumeSemanticCorrection,
  createKfcCreateAgentMiddleware,
  hasStructuredOutputParsingCause,
  KFC_HITL_INTERRUPT_ON,
  invokeProviderWithRetry,
  replaceKfcModelSystemContext,
  validateAuthoredToolBatch,
  visibleKfcTools,
} from '../../src/agent/kfcCreateAgentMiddleware.js';
import {
  createKfcCreateAgentRuntime,
  kfcCreateAgentContextSchema,
  type KfcCreateAgentContext,
} from '../../src/agent/kfcCreateAgentRuntime.js';
import {
  KfcAgentState,
  type KfcAgentStateUpdate,
  type KfcAgentStateValue,
} from '../../src/agent/agentStateSchema.js';
import { providerPortableToolSchema } from '../../src/agent/providerPortableToolSchema.js';
import { groundedResponseSchema } from '../../src/agent/responseGrounding.js';
import type { SingleAgentRuntimeContext } from '../../src/agent/singleAgentRuntime.js';
import { commerceToolDefinitions } from '../../src/agent/agentToolDefinitions.js';
import type { AgentGraphState } from '../../src/graph/state.js';
import type { ToolName } from '../../src/ordering/types.js';
import type { z } from 'zod';

const publication = {
  customerText: 'Xin chào',
  projectionDigest: 'a'.repeat(64),
  factualClaims: {
    evidenceReferences: [],
    disclosedLimitations: [],
    hasUnsupportedFactualClaim: false,
  },
  publicationDeclaration: {
    semanticRelevance: 'aligned' as const,
    privateDataDisclosure: 'none' as const,
    disclosureAuthorities: [],
    disclosesInternalMetadata: false,
  },
  selectedActionResponse: null,
};

class ScriptedChatModel extends BaseChatModel {
  readonly visibleTools: string[][];
  readonly calls: number[];
  private readonly outputs: Array<AIMessage | Error>;
  private readonly shared: { index: number };
  private tools: StructuredTool[] = [];

  constructor(input: {
    outputs: Array<AIMessage | Error>;
    visibleTools?: string[][];
    calls?: number[];
    shared?: { index: number };
  }) {
    super({});
    this.outputs = input.outputs;
    this.visibleTools = input.visibleTools ?? [];
    this.calls = input.calls ?? [];
    this.shared = input.shared ?? { index: 0 };
  }

  override _llmType(): string {
    return 'kfc-scripted-chat-model';
  }

  override bindTools(tools: StructuredTool[]): ScriptedChatModel {
    return new ScriptedChatModel({
      outputs: this.outputs,
      visibleTools: this.visibleTools,
      calls: this.calls,
      shared: this.shared,
    }).withTools(tools);
  }

  private withTools(tools: StructuredTool[]): ScriptedChatModel {
    this.tools = tools;
    return this;
  }

  override async _generate(
    _messages: unknown[],
    _options: this['ParsedCallOptions'],
    _runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    this.visibleTools.push(this.tools.map(({ name }) => name));
    this.calls.push(this.shared.index);
    const output = this.outputs[this.shared.index++];
    if (output instanceof Error) throw output;
    if (!output) throw new Error('script_exhausted');
    return {
      generations: [{ text: String(output.content), message: output }],
      llmOutput: {},
    };
  }
}

function runtime(
  overrides: Partial<ReturnType<typeof createKfcCreateAgentRuntime>> = {},
) {
  return createKfcCreateAgentRuntime({
    assertRuntimeActive: vi.fn(),
    ...overrides,
  });
}

function middlewareState(
  overrides: Partial<AgentGraphState> = {},
): AgentGraphState {
  return {
    sessionId: 'session-1',
    customerId: 'customer-1',
    channel: 'kfc',
    latestUserMessage: 'Xin chào',
    userConfirmedOrder: false,
    escalationReasons: [],
    retrievedEvidence: [],
    ...overrides,
  };
}

function context(
  input: {
    runtime?: ReturnType<typeof createKfcCreateAgentRuntime>;
    activeTools?: readonly ToolName[];
    resolveActiveToolNames?: () => ToolName[];
  } = {},
): KfcCreateAgentContext {
  return {
    runtime: {} as KfcCreateAgentContext['runtime'],
    state: middlewareState(),
    currentTurnToolTrace: [],
    createAgentRuntime: input.runtime ?? runtime(),
    resolveActiveToolNames:
      input.resolveActiveToolNames ??
      (() => [...(input.activeTools ?? ['searchMenu'])]),
  };
}

async function runWholeBatchValidation(
  runtimeContext: KfcCreateAgentContext,
  calls: Array<{
    id: string;
    name: string;
    args: Record<string, unknown>;
    type: 'tool_call';
  }>,
): Promise<void> {
  const validation = createKfcCreateAgentMiddleware().find(
    ({ name }) => name === 'KfcWholeBatchValidation',
  );
  const afterModel = validation?.afterModel;
  if (typeof afterModel !== 'function') {
    throw new Error('missing whole-batch validation hook');
  }
  await afterModel(
    {
      messages: [new AIMessage({ content: '', tool_calls: calls })],
    } as never,
    { context: runtimeContext } as never,
  );
}

describe('KFC createAgent middleware', () => {
  it('rejects incomplete runtime context before middleware dereferences it', () => {
    expect(
      kfcCreateAgentContextSchema.safeParse({
        resolveActiveToolNames: () => [],
      }).success,
    ).toBe(false);
  });

  it('rejects malformed usage and tool-call ledgers', () => {
    const invalidRuntimes = [
      runtime({ providerAttempts: { used: Number.NaN, limit: 6 } }),
      runtime({ providerRetry: { used: 0, limit: Number.POSITIVE_INFINITY } }),
      runtime({
        providerFailureDiagnostic: {
          stage: 'model_invoke',
          errorType: 'provider_secret_detail' as never,
        },
      }),
      runtime({ advertisedToolNames: [42 as never] }),
      runtime({
        toolCallLedger: [
          {
            signatureDigest: 'not-a-digest',
            toolName: 'searchMenu',
            effect: 'provider_read',
            receipt: null,
          },
        ],
      }),
    ];

    for (const invalidRuntime of invalidRuntimes) {
      expect(
        kfcCreateAgentContextSchema.safeParse(
          context({ runtime: invalidRuntime }),
        ).success,
      ).toBe(false);
    }
  });

  it('rejects array-shaped domain objects and malformed trace entries', () => {
    const valid = context();
    const invalidContexts = [
      { ...valid, runtime: [] },
      { ...valid, state: [] },
      { ...valid, currentTurnStatusOrder: [] },
      { ...valid, currentTurnToolTrace: [null] },
    ];

    for (const invalidContext of invalidContexts) {
      expect(
        kfcCreateAgentContextSchema.safeParse(invalidContext).success,
      ).toBe(false);
    }
  });

  it('keeps every currently active tool visible after prior use', () => {
    const tools = [
      { name: 'searchMenu' },
      { name: 'findStores' },
      { name: 'searchPromotions' },
    ] as StructuredTool[];

    expect(
      visibleKfcTools(tools, [
        'searchMenu',
        'findStores',
        'searchPromotions',
      ]).map(({ name }) => name),
    ).toEqual(['searchMenu', 'findStores', 'searchPromotions']);
  });

  it('accepts an authored batch of independent reads without consuming names', () => {
    const controls = runtime();
    const calls = [
      {
        id: 'b',
        name: 'findStores',
        args: { query: 'Quận 1', city: null, district: null },
      },
      {
        id: 'a',
        name: 'searchMenu',
        args: { scope: 'all', query: null, purpose: 'browse' },
      },
    ];

    expect(
      validateAuthoredToolBatch(calls, ['searchMenu', 'findStores'], controls),
    ).toEqual(calls);
    expect(controls.toolCallLedger).toEqual([]);
    expect(controls.semanticCorrections.used).toBe(0);
  });

  it('rejects mixed dependent and irreversible batches before execution', () => {
    const controls = runtime();

    expect(() =>
      validateAuthoredToolBatch(
        [
          { id: 'read', name: 'searchMenu', args: { query: '' } },
          { id: 'write', name: 'updateCart', args: { changes: [] } },
        ],
        ['searchMenu', 'updateCart'],
        controls,
      ),
    ).toThrow('agent_authored_tool_batch_invalid');
    expect(() =>
      validateAuthoredToolBatch(
        [
          { id: 'approval', name: 'placeOrder', args: {} },
          { id: 'read', name: 'searchMenu', args: { query: '' } },
        ],
        ['placeOrder', 'searchMenu'],
        controls,
      ),
    ).toThrow('agent_authored_tool_batch_invalid');
    expect(controls.semanticCorrections.used).toBe(0);
  });

  it('records dynamic -> retry -> physical -> provider for first call and retry', async () => {
    const sequence: string[] = [];
    const controls = runtime({ trace: (event) => sequence.push(event) });
    const provider = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('busy'), { status: 503 }))
      .mockResolvedValue(new AIMessage('ok'));

    await expect(
      invokeProviderWithRetry({
        request: {} as never,
        handler: provider,
        runtime: controls,
        delay: async () => {},
      }),
    ).resolves.toBeInstanceOf(AIMessage);
    expect(sequence).toEqual([
      'retry',
      'physical_guard',
      'provider',
      'retry',
      'physical_guard',
      'provider',
    ]);
    expect(controls.providerAttempts.used).toBe(2);
    expect(controls.providerRetry.used).toBe(1);
  });

  it('shares one retry across a turn and unwraps nested middleware causes', async () => {
    const controls = runtime();
    const inner = MiddlewareError.wrap(
      Object.assign(new Error('rate'), { status: 429 }),
      'inner',
    );
    const transient = MiddlewareError.wrap(inner, 'outer');
    const provider = vi.fn().mockRejectedValue(transient);

    await expect(
      invokeProviderWithRetry({
        request: {} as never,
        handler: provider,
        runtime: controls,
        delay: async () => {},
      }),
    ).rejects.toBe(transient);
    expect(provider).toHaveBeenCalledTimes(2);
    await expect(
      invokeProviderWithRetry({
        request: {} as never,
        handler: provider,
        runtime: controls,
        delay: async () => {},
      }),
    ).rejects.toBe(transient);
    expect(provider).toHaveBeenCalledTimes(3);
  });

  it('does not classify structured parsing as transient', async () => {
    const parsing = new StructuredOutputParsingError('publication', ['bad']);
    const provider = vi.fn().mockRejectedValue(parsing);
    const controls = runtime();

    await expect(
      invokeProviderWithRetry({
        request: {} as never,
        handler: provider,
        runtime: controls,
        delay: async () => {},
      }),
    ).rejects.toBe(parsing);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(
      hasStructuredOutputParsingCause(MiddlewareError.wrap(parsing, 'wrapped')),
    ).toBe(true);
  });

  it('bounds terminal structured-output correction feedback', () => {
    const feedback = boundedStructuredOutputFeedback(
      new StructuredOutputParsingError('publication', ['x'.repeat(1_000)]),
    );

    expect(feedback).toContain('provider-native structured output');
    expect(feedback.length).toBeLessThanOrEqual(512);
  });

  it('blocks a seventh physical attempt before the provider handler', async () => {
    const controls = runtime({ providerAttempts: { used: 6, limit: 6 } });
    const provider = vi.fn();

    await expect(
      invokeProviderWithRetry({
        request: {} as never,
        handler: provider,
        runtime: controls,
        delay: async () => {},
      }),
    ).rejects.toThrow('agent_provider_call_limit_exceeded');
    expect(provider).not.toHaveBeenCalled();
  });

  it('allows exactly one shared semantic correction', () => {
    const controls = runtime();

    consumeSemanticCorrection(controls);
    expect(controls.semanticCorrections.used).toBe(1);
    expect(() => consumeSemanticCorrection(controls)).toThrow(
      'agent_semantic_correction_limit_exceeded',
    );
  });

  it('registers the exact validated authored batch with the tool coordinator', async () => {
    const acceptBatch = vi.fn();
    const runtimeContext = context({
      runtime: runtime(),
      activeTools: ['searchMenu', 'findStores'],
    });
    runtimeContext.createAgentRuntime.advertisedToolNames = [
      'searchMenu',
      'findStores',
    ];
    runtimeContext.toolCoordinator = {
      acceptBatch,
      execute: vi.fn(),
      snapshot: vi.fn(),
    } as never as KfcCreateAgentToolCoordinator;
    const validation = createKfcCreateAgentMiddleware().find(
      ({ name }) => name === 'KfcWholeBatchValidation',
    );
    const calls = [
      {
        id: 'menu',
        name: 'searchMenu',
        args: { scope: 'all', query: null, purpose: 'browse' },
        type: 'tool_call' as const,
      },
      {
        id: 'stores',
        name: 'findStores',
        args: { query: 'Quận 1', city: null, district: null },
        type: 'tool_call' as const,
      },
    ];

    const afterModel = validation?.afterModel;
    if (typeof afterModel !== 'function') {
      throw new Error('missing whole-batch validation hook');
    }
    await afterModel(
      {
        messages: [new AIMessage({ content: '', tool_calls: calls })],
      } as never,
      { context: runtimeContext } as never,
    );

    expect(acceptBatch).toHaveBeenCalledOnce();
    expect(acceptBatch).toHaveBeenCalledWith([
      {
        id: 'menu',
        toolName: 'searchMenu',
        arguments: { scope: 'all', query: null, purpose: 'browse' },
        effect: 'provider_read',
        handling: { kind: 'execute' },
        signatureDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
      },
      {
        id: 'stores',
        toolName: 'findStores',
        arguments: { query: 'Quận 1', city: null, district: null },
        effect: 'provider_read',
        handling: { kind: 'execute' },
        signatureDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
      },
    ]);
  });

  it('rejects an exact unchanged non-poll read before tool execution', async () => {
    const activeToolNames = ['searchMenu'] as const;
    const state = middlewareState();
    const signatureDigest = await canonicalToolCallSignature({
      sessionId: state.sessionId,
      customerId: state.customerId,
      channel: state.channel,
      toolName: 'searchMenu',
      arguments: { scope: 'all', query: null, purpose: 'browse' },
      activeToolNames,
      relevantState: relevantToolState('searchMenu', state),
    });
    const controls = runtime({
      advertisedToolNames: [...activeToolNames],
      toolCallLedger: [
        {
          signatureDigest,
          toolName: 'searchMenu',
          effect: 'provider_read',
          receipt: null,
        },
      ],
    });
    const runtimeContext = context({
      runtime: controls,
      activeTools: activeToolNames,
    });
    runtimeContext.state = state;
    const acceptBatch = vi.fn();
    runtimeContext.toolCoordinator = {
      acceptBatch,
      execute: vi.fn(),
      snapshot: vi.fn(),
    } as never as KfcCreateAgentToolCoordinator;

    await expect(
      runWholeBatchValidation(runtimeContext, [
        {
          id: 'menu-repeat',
          name: 'searchMenu',
          args: { scope: 'all', query: null, purpose: 'browse' },
          type: 'tool_call',
        },
      ]),
    ).rejects.toThrow('agent_authored_tool_batch_no_progress');
    expect(acceptBatch).not.toHaveBeenCalled();
  });

  it('classifies an exact successful mutation as a cached receipt', async () => {
    const activeToolNames = ['updateCart'] as const;
    const state = middlewareState();
    const argumentsValue = {
      changes: [
        {
          itemCode: '20751',
          quantity: 1,
          modifiers: [],
        },
      ],
    };
    const signatureDigest = await canonicalToolCallSignature({
      sessionId: state.sessionId,
      customerId: state.customerId,
      channel: state.channel,
      toolName: 'updateCart',
      arguments: argumentsValue,
      activeToolNames,
      relevantState: relevantToolState('updateCart', state),
    });
    const cachedReceipt = {
      schemaVersion: 'kfc-checkpoint-tool-evidence-receipt-v2' as const,
      evidenceId: 'evidence:cart-original',
      evidenceDigest: 'c'.repeat(64),
      toolCallId: 'cart-original',
      toolName: 'updateCart' as const,
      executionOutcome: 'success' as const,
      result: 'audit_evidence_reference' as const,
    };
    const controls = runtime({
      advertisedToolNames: [...activeToolNames],
      toolCallLedger: [
        {
          signatureDigest,
          toolName: 'updateCart',
          effect: 'reversible_mutation',
          receipt: cachedReceipt,
        },
      ],
    });
    const runtimeContext = context({
      runtime: controls,
      activeTools: activeToolNames,
    });
    runtimeContext.state = state;
    const acceptBatch = vi.fn();
    runtimeContext.toolCoordinator = {
      acceptBatch,
      execute: vi.fn(),
      snapshot: vi.fn(),
    } as never as KfcCreateAgentToolCoordinator;

    await runWholeBatchValidation(runtimeContext, [
      {
        id: 'cart-retry',
        name: 'updateCart',
        args: argumentsValue,
        type: 'tool_call',
      },
    ]);

    expect(acceptBatch).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'cart-retry',
        toolName: 'updateCart',
        signatureDigest,
        effect: 'reversible_mutation',
        handling: { kind: 'cached', receipt: cachedReceipt },
      }),
    ]);
  });

  it('allows exact unchanged status polling to execute again', async () => {
    const activeToolNames = ['getOrderStatus'] as const;
    const state = middlewareState();
    const signatureDigest = await canonicalToolCallSignature({
      sessionId: state.sessionId,
      customerId: state.customerId,
      channel: state.channel,
      toolName: 'getOrderStatus',
      arguments: {},
      activeToolNames,
      relevantState: relevantToolState('getOrderStatus', state),
    });
    const controls = runtime({
      advertisedToolNames: [...activeToolNames],
      toolCallLedger: [
        {
          signatureDigest,
          toolName: 'getOrderStatus',
          effect: 'provider_read',
          receipt: null,
        },
      ],
    });
    const runtimeContext = context({
      runtime: controls,
      activeTools: activeToolNames,
    });
    runtimeContext.state = state;
    const acceptBatch = vi.fn();
    runtimeContext.toolCoordinator = {
      acceptBatch,
      execute: vi.fn(),
      snapshot: vi.fn(),
    } as never as KfcCreateAgentToolCoordinator;

    await runWholeBatchValidation(runtimeContext, [
      {
        id: 'status-repeat',
        name: 'getOrderStatus',
        args: {},
        type: 'tool_call',
      },
    ]);

    expect(acceptBatch).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'status-repeat',
        toolName: 'getOrderStatus',
        signatureDigest,
        effect: 'provider_read',
        handling: { kind: 'execute' },
      }),
    ]);
  });

  it('replaces stale publication context before each model call', () => {
    const systemPrompt = new SystemMessage('KFC system prompt');
    const staleContext = new SystemMessage(
      JSON.stringify({
        publication: { projectionDigest: 'old' },
        responseContract: { requiredShape: {} },
      }),
    );
    const customerMessage = new HumanMessage('Compare two combos');
    const latestContext = JSON.stringify({
      publication: { projectionDigest: 'latest' },
      responseContract: { requiredShape: {} },
    });

    const messages = replaceKfcModelSystemContext(
      [systemPrompt, staleContext, customerMessage],
      latestContext,
    );

    expect(messages).toHaveLength(3);
    expect(messages[0]).toBe(systemPrompt);
    expect(messages[1]).toBe(customerMessage);
    expect(messages[2]).toMatchObject({ content: latestContext });
  });

  it('registers HITL with approve/reject only and validation after it', () => {
    const middleware = createKfcCreateAgentMiddleware();
    const names = middleware.map(({ name }) => name);

    expect(names).toEqual([
      'KfcDynamicToolPolicy',
      'KfcOneTurnProviderRetry',
      'KfcPhysicalProviderAttemptGuard',
      'HumanInTheLoopMiddleware',
      'KfcWholeBatchValidation',
      'KfcFailClosedToolExecution',
      'KfcLifecycleTracing',
    ]);
    expect(middleware.at(-1)?.wrapModelCall).toBeUndefined();
    expect(middleware.at(-1)?.afterModel).toBeUndefined();
  });
});

describe('KFC nested createAgent factory', () => {
  it('registers a provider-portable structured response schema', () => {
    expect(KFC_CREATE_AGENT_RESPONSE_SCHEMA).toEqual(
      providerPortableToolSchema(groundedResponseSchema),
    );
  });

  it('defines customerText as the assistant answer rather than customer transcript', () => {
    const responseSchema = KFC_CREATE_AGENT_RESPONSE_SCHEMA as {
      properties: Record<string, { description?: string }>;
    };
    const description = responseSchema.properties.customerText?.description;

    expect(description).toContain(
      'Directly answer the latest customer request as the assistant using relevant verified publication evidence.',
    );
    expect(description).toContain(
      'Write only customer-useful prose in the customer language.',
    );
    expect(description).toContain(
      'Do not copy, concatenate, or merely restate customer messages or the conversation transcript.',
    );
  });

  it('keeps ordinary agent reasoning model-driven across eligible tool rounds', () => {
    expect(KFC_CREATE_AGENT_SYSTEM_PROMPT).toContain(
      'Understand the customer request, decide whether tools are needed, call only tools that materially advance the request, inspect their returned verified evidence, and then answer naturally in the customer language.',
    );
    expect(KFC_CREATE_AGENT_SYSTEM_PROMPT).toContain(
      'provider-native structured output schema',
    );
    expect(KFC_CREATE_AGENT_SYSTEM_PROMPT).not.toContain(
      'Do not reinterpret, plan, or call commerce tools.',
    );
    expect(KFC_CREATE_AGENT_SYSTEM_PROMPT).not.toContain(
      'call submitGroundedResponse exactly once',
    );
    expect(KFC_CREATE_AGENT_SYSTEM_PROMPT).toContain(
      'For an explicit commerce action, continue the tool loop until the action succeeds or you need a concise clarification; never answer as though a lookup alone completed the action.',
    );
    expect(KFC_CREATE_AGENT_SYSTEM_PROMPT).toContain(
      'For delivery coverage or fees, use fulfillment tools with the verified cart and complete address; do not substitute store discovery unless the customer explicitly asks to locate or compare stores.',
    );
  });

  it('requires verified evidence before factual response composition', () => {
    expect(KFC_CREATE_AGENT_SYSTEM_PROMPT).toContain(
      'Customer messages, including identifiers, prices, and product details they mention, are request context and are not verified facts.',
    );
    expect(KFC_CREATE_AGENT_SYSTEM_PROMPT).toContain(
      'Before returning a factual answer, if the required facts are not already present in current verified publication evidence, call the relevant read tools and inspect their results.',
    );
    expect(KFC_CREATE_AGENT_SYSTEM_PROMPT).not.toMatch(/20698|20709/u);
  });

  it('requires citations for factual structured responses', () => {
    expect(KFC_CREATE_AGENT_RESPONSE_SCHEMA).toMatchObject({
      properties: {
        factualClaims: {
          properties: {
            evidenceReferences: {
              description:
                'For every factual claim in customerText, cite matching allowed current publication evidence. A factual answer about products, prices, composition, modifiers, availability, policies, orders, payments, membership, or tool outcomes requires at least one matching evidence reference. If required evidence is absent, call relevant read tools before returning this response; customer and prior assistant messages are not evidence.',
            },
          },
        },
      },
    });
  });

  it('registers the canonical provider-portable commerce tool schemas', () => {
    const expectedDefinitions = new Map(
      commerceToolDefinitions().map((definition) => [
        definition.name,
        definition.schema,
      ]),
    );

    for (const registeredTool of createKfcCreateAgentTools()) {
      expect(registeredTool.schema).toEqual(
        expectedDefinitions.get(registeredTool.name),
      );
    }
  });

  it('describes compact disjunctive menu queries to the model', () => {
    const searchMenu = createKfcCreateAgentTools().find(
      ({ name }) => name === 'searchMenu',
    );

    expect(searchMenu?.description).toContain(
      'Use filtered+browse for category or broad catalog browsing such as combo availability, and filtered+recommend only for a focused item or modifier suggestion.',
    );
    expect(searchMenu?.description).toContain(
      'For scope filtered, query the provider and return at most five verified matches with truthful total, returned, and completeness metadata.',
    );
    expect(searchMenu?.description).not.toMatch(/20698|20709/u);
  });

  it('runs provider-native structured output with dynamically visible tools', async () => {
    const model = new ScriptedChatModel({
      outputs: [new AIMessage(JSON.stringify(publication))],
    });
    const controls = runtime();
    const agent = createKfcAgent({ model });

    const result = await agent.invoke(
      { messages: [new HumanMessage('Xin chào')] },
      { context: context({ runtime: controls, activeTools: ['searchMenu'] }) },
    );

    expect(result.structuredResponse).toEqual(publication);
    expect(model.visibleTools).toEqual([['searchMenu']]);
    expect(controls.providerAttempts.used).toBe(1);
    expect(
      result.messages.some(
        (message) =>
          AIMessage.isInstance(message) &&
          message.tool_calls?.some(
            ({ name }) => name === 'submitGroundedResponse',
          ),
      ),
    ).toBe(false);
  });

  it('uses the installed middleware chain for a physical retry', async () => {
    const sequence: string[] = [];
    const model = new ScriptedChatModel({
      outputs: [
        Object.assign(new Error('provider busy'), { status: 503 }),
        new AIMessage(JSON.stringify(publication)),
      ],
    });
    const controls = runtime({ trace: (event) => sequence.push(event) });
    const agent = createKfcAgent({ model });

    const result = await agent.invoke(
      { messages: [new HumanMessage('Xin chào')] },
      { context: context({ runtime: controls, activeTools: ['searchMenu'] }) },
    );

    expect(result.structuredResponse).toEqual(publication);
    expect(sequence).toEqual([
      'dynamic',
      'retry',
      'physical_guard',
      'provider',
      'retry',
      'physical_guard',
      'provider',
    ]);
    expect(controls.providerAttempts.used).toBe(2);
    expect(controls.providerRetry.used).toBe(1);
  });

  it('rejects an invalid irreversible batch before HITL or tool execution', async () => {
    const execute = vi.fn();
    const model = new ScriptedChatModel({
      outputs: [
        new AIMessage({
          content: '',
          tool_calls: [
            { id: 'place', name: 'placeOrder', args: {}, type: 'tool_call' },
            {
              id: 'read',
              name: 'searchMenu',
              args: { scope: 'all', query: null, purpose: 'browse' },
              type: 'tool_call',
            },
          ],
        }),
      ],
    });
    const controls = runtime();
    const agent = createKfcAgent({
      model,
      toolDependencies: { execute: execute as never },
    });

    await expect(
      agent.invoke(
        { messages: [new HumanMessage('Đặt và tìm menu')] },
        {
          context: context({
            runtime: controls,
            activeTools: ['searchMenu', 'placeOrder'],
          }),
        },
      ),
    ).rejects.toThrow('agent_authored_tool_batch_invalid');
    expect(execute).not.toHaveBeenCalled();
    expect(controls.semanticCorrections.used).toBe(0);
  });

  it('validates against the exact tools advertised for the model call', async () => {
    const execute = vi.fn();
    const resolveActiveToolNames = vi
      .fn<() => ToolName[]>()
      .mockReturnValueOnce(['searchMenu'])
      .mockReturnValue(['placeOrder']);
    const model = new ScriptedChatModel({
      outputs: [
        new AIMessage({
          content: '',
          tool_calls: [
            { id: 'place', name: 'placeOrder', args: {}, type: 'tool_call' },
          ],
        }),
      ],
    });
    const controls = runtime();
    const agent = createKfcAgent({
      model,
      toolDependencies: { execute: execute as never },
    });

    await expect(
      agent.invoke(
        { messages: [new HumanMessage('Đặt đơn')] },
        {
          context: context({
            runtime: controls,
            resolveActiveToolNames,
          }),
        },
      ),
    ).rejects.toThrow('agent_authored_tool_batch_invalid');
    expect(model.visibleTools).toEqual([['searchMenu']]);
    expect(execute).not.toHaveBeenCalled();
  });

  it('configures irreversible HITL review with approve and reject only', () => {
    expect(Object.keys(KFC_HITL_INTERRUPT_ON)).toEqual([
      'acquireVoucher',
      'redeemReward',
      'placeOrder',
      'createPaymentLink',
      'handoff',
      'resolveHandoff',
    ]);
    expect(
      Object.values(KFC_HITL_INTERRUPT_ON).map(
        ({ allowedDecisions }) => allowedDecisions,
      ),
    ).toEqual(Array.from({ length: 6 }, () => ['approve', 'reject']));
  });

  it('constructs the nested graph without a durable checkpointer', () => {
    const agent = createKfcAgent({
      model: new ScriptedChatModel({ outputs: [new AIMessage('{}')] }),
    });

    expect(agent).toBeDefined();
    expect(agent.checkpointer).toBeUndefined();
  });
});

function semanticAgentNode(
  input: KfcSemanticAgentNodeDependencies,
): ReturnType<typeof createKfcSemanticAgentNode> {
  return createKfcSemanticAgentNode(input);
}

function wrapperState(
  overrides: Partial<KfcAgentStateValue> = {},
): KfcAgentStateValue {
  return {
    messages: [new HumanMessage('Xin chào')],
    sessionId: 'session-1',
    customerId: 'customer-1',
    channel: 'kfc',
    text: 'Xin chào',
    externalMessageId: 'message-1',
    metadata: null,
    domainState: { sessionId: 'session-1' } as AgentGraphState,
    graphTrace: null,
    currentTurnToolTrace: [],
    currentUserTurn: null,
    currentTurnId: 'turn-1',
    turnToolTraceStartIndex: 0,
    turnToolTracePrefixDigest: null,
    modelPublicationAuthority: null,
    modelPublicationBundle: null,
    graphExecutedToolResults: [],
    currentTurnResponseEvidence: [],
    toolEvidenceReceipts: [],
    customerTurnCount: 1,
    turnDeadlineAt: Date.now() + 30_000,
    structuredAction: null,
    structuredActionRevisionValidated: false,
    structuredActionAfterTool: null,
    structuredActionOutcome: null,
    selectedActionResponseAuthority: null,
    selectedActionResponseReference: null,
    providerAttempts: 2,
    providerAttemptEvidence: [],
    providerRetries: 1,
    semanticCorrections: 0,
    toolCallLedger: [
      {
        signatureDigest: 'a'.repeat(64),
        toolName: 'searchMenu',
        effect: 'provider_read',
        receipt: null,
      },
    ],
    pendingToolCalls: [],
    queuedToolCalls: [],
    checkpointSafeApproval: null,
    providerFailure: null,
    providerFailureDiagnostic: null,
    validationError: null,
    correctionMessagesNeeded: false,
    approvalDecision: null,
    validatedApprovalActionDigest: null,
    responseText: null,
    responseProjectionDigest: null,
    responseFactualClaims: null,
    responsePublicationDeclaration: null,
    responsePublicationAttestation: null,
    responsePublicationValidated: false,
    output: null,
    failure: null,
    ...overrides,
  };
}

function runtimeContext(state: KfcAgentStateValue): SingleAgentRuntimeContext {
  return {
    turnInput: {
      sessionId: state.sessionId,
    } as SingleAgentRuntimeContext['turnInput'],
    turnTrace: {} as SingleAgentRuntimeContext['turnTrace'],
    externalCallContext: {
      signal: AbortSignal.timeout(30_000),
      deadlineAt: state.turnDeadlineAt,
    },
    abortExternalCalls: vi.fn(),
    disposeExternalCalls: vi.fn(),
  };
}

function wrapperDependencies(
  agent: KfcSemanticAgentLike,
): KfcSemanticAgentNodeDependencies {
  return {
    agent,
    runtimeContextForState: runtimeContext,
    resolveActiveToolNames: () => ['searchMenu'],
    assertRuntimeActive: vi.fn(),
  };
}

describe('KFC semantic_agent wrapper boundary', () => {
  it('maps actual outer channels into one shared nested runtime', async () => {
    const state = wrapperState();
    const invoke = vi.fn<KfcSemanticAgentLike['invoke']>(async () => ({
      messages: [new AIMessage('done')],
      structuredResponse: publication,
    }));
    const runtimeValue = runtimeContext(state);
    const node = semanticAgentNode({
      ...wrapperDependencies({ invoke }),
      runtimeContextForState: () => runtimeValue,
    });

    await node(state, { configurable: { thread_id: 'thread-1' } });

    const [input, config] = invoke.mock.calls[0]!;
    expect(input).not.toBeNull();
    if (!input) throw new Error('expected_initial_agent_input');
    expect(input.messages).toBe(state.messages);
    expect(config.context.runtime).toBe(runtimeValue);
    expect(config.context.state).toBe(state.domainState);
    expect(config.context.currentTurnToolTrace).toBe(
      state.currentTurnToolTrace,
    );
    const shared = config.context.createAgentRuntime;
    expect(shared.providerAttempts).toEqual({ used: 2, limit: 6 });
    expect(shared.providerRetry).toEqual({ used: 1, limit: 1 });
    expect(shared.semanticCorrections).toEqual({ used: 0, limit: 1 });
    expect(shared.advertisedToolNames).toEqual([]);
    expect(shared.toolCallLedger).toEqual(state.toolCallLedger);
    expect(shared.toolCallLedger).not.toBe(state.toolCallLedger);
  });

  it('spends one semantic correction on trusted grounded-response validation', async () => {
    const state = wrapperState();
    const invalidResponse = {
      ...publication,
      factualClaims: {
        ...publication.factualClaims,
        disclosedLimitations: [
          {
            limitationId: 'uncited_subjects_or_aspects_unknown' as const,
            coverageStatus: 'unknown_or_unverified' as const,
            evidenceSubject: 'Verified option',
            customerCriterion: 'not spicy',
            unverifiedAspect: 'spice level',
            customerDisclosure: 'The verified option is unverified.',
          },
        ],
      },
    };
    const invoke = vi
      .fn<KfcSemanticAgentLike['invoke']>()
      .mockResolvedValueOnce({
        messages: [new AIMessage('invalid')],
        structuredResponse: invalidResponse,
      })
      .mockResolvedValueOnce({
        messages: [new AIMessage('corrected')],
        structuredResponse: publication,
      });
    const validateStructuredResponse = vi
      .fn()
      .mockReturnValueOnce({
        ok: false,
        errorCode: 'agent_response_evidence_limitation_mismatch',
        correctable: true,
      })
      .mockReturnValueOnce({ ok: true });
    const node = semanticAgentNode({
      ...wrapperDependencies({ invoke }),
      validateStructuredResponse,
    });

    const update = await node(state, {
      configurable: { thread_id: 'thread-1' },
    });

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(validateStructuredResponse).toHaveBeenCalledTimes(2);
    const correctionInput = invoke.mock.calls[1]![0];
    expect(correctionInput).not.toBeNull();
    if (!correctionInput) throw new Error('expected_correction_agent_input');
    expect(correctionInput.messages.at(-1)).toEqual(
      expect.objectContaining({
        content: expect.stringContaining(
          'an included component whose criterion-relevant aspect remains unknown',
        ),
      }),
    );
    expect(update).toMatchObject({
      semanticCorrections: 1,
      responseText: publication.customerText,
      responseFactualClaims: publication.factualClaims,
    });
    expect(update).not.toHaveProperty('failure');
  });

  it('fails at the shared limit when the corrected grounded response is still invalid', async () => {
    const state = wrapperState();
    const invoke = vi.fn<KfcSemanticAgentLike['invoke']>().mockResolvedValue({
      messages: [new AIMessage('invalid')],
      structuredResponse: publication,
    });
    const validateStructuredResponse = vi.fn().mockReturnValue({
      ok: false,
      errorCode: 'agent_response_evidence_limitation_mismatch',
      correctable: true,
    });
    const node = semanticAgentNode({
      ...wrapperDependencies({ invoke }),
      validateStructuredResponse,
    });

    const update = await node(state, {
      configurable: { thread_id: 'thread-1' },
    });

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(validateStructuredResponse).toHaveBeenCalledTimes(2);
    expect(update).toMatchObject({
      semanticCorrections: 1,
      failure: 'agent_semantic_correction_limit_exceeded',
    });
  });

  it('does not retry non-correctable grounded-response authority failures', async () => {
    const state = wrapperState();
    const invoke = vi.fn<KfcSemanticAgentLike['invoke']>().mockResolvedValue({
      messages: [new AIMessage('invalid')],
      structuredResponse: publication,
    });
    const validateStructuredResponse = vi.fn().mockReturnValue({
      ok: false,
      errorCode: 'agent_model_publication_authority_invalid',
      correctable: false,
    });
    const node = semanticAgentNode({
      ...wrapperDependencies({ invoke }),
      validateStructuredResponse,
    });

    const update = await node(state, {
      configurable: { thread_id: 'thread-1' },
    });

    expect(invoke).toHaveBeenCalledOnce();
    expect(validateStructuredResponse).toHaveBeenCalledOnce();
    expect(update).toMatchObject({
      semanticCorrections: 0,
      failure: 'agent_model_publication_authority_invalid',
    });
  });

  it('uses and projects the latest coordinated publication snapshot', async () => {
    const state = wrapperState({
      modelPublicationAuthority: { authorityDigest: 'authority' } as never,
      modelPublicationBundle: { projectionDigest: 'initial' } as never,
    });
    const projectedDomainState = {
      sessionId: 'session-1',
      latestUserMessage: 'coordinated',
    } as AgentGraphState;
    const projectedTrace = [
      {
        toolName: 'searchMenu',
        arguments: { scope: 'all', query: null },
        ok: true,
        resultSummary: 'menu',
        provenance: [],
      },
    ] as KfcCreateAgentContext['currentTurnToolTrace'];
    const projectedExecutions = [
      {
        authorityDigest: 'authority',
        toolCallId: 'menu',
        result: { toolName: 'searchMenu', ok: true, value: null },
      },
    ] as never;
    const projectedEvidence = [
      {
        schemaVersion: 'kfc-current-turn-response-evidence-v1',
        evidenceId: 'evidence:menu',
        toolCallId: 'menu',
        toolName: 'searchMenu',
        claimKinds: [],
        value: null,
        digest: 'b'.repeat(64),
        authorityDigest: 'authority',
        currentTurnRevision: 'revision',
        privateData: false,
        executionOutcome: 'success',
      },
    ] as never;
    const projectedReceipts = [
      {
        schemaVersion: 'kfc-checkpoint-tool-evidence-receipt-v2',
        evidenceId: 'evidence:menu',
        evidenceDigest: 'b'.repeat(64),
        toolCallId: 'menu',
        toolName: 'searchMenu',
        executionOutcome: 'success',
        result: 'audit_evidence_reference',
      },
    ] as never;
    const projectedBundle = { projectionDigest: 'projected' } as never;
    const coordinator: KfcCreateAgentToolCoordinator = {
      acceptBatch: vi.fn(),
      execute: vi.fn(),
      snapshot: () => ({
        state: projectedDomainState,
        currentTurnToolTrace: projectedTrace,
        executions: projectedExecutions,
        evidence: projectedEvidence,
        receipts: projectedReceipts,
        bundle: projectedBundle,
        failed: false,
      }),
    };
    const resolveActiveToolNames = vi.fn(() => ['searchMenu'] as ToolName[]);
    const resolveModelSystemContext = vi.fn(() => 'latest context');
    const validateStructuredResponse = vi.fn(() => ({ ok: true as const }));
    const invoke = vi.fn<KfcSemanticAgentLike['invoke']>(
      async (_input, config) => {
        expect(config.context.toolCoordinator).toBe(coordinator);
        expect(config.context.resolveActiveToolNames()).toEqual(['searchMenu']);
        await config.context.resolveModelSystemContext?.();
        return {
          messages: [new AIMessage('done')],
          structuredResponse: publication,
        };
      },
    );
    const node = semanticAgentNode({
      ...wrapperDependencies({ invoke }),
      resolveActiveToolNames,
      resolveModelSystemContext,
      validateStructuredResponse,
      createToolCoordinator: vi.fn(() => coordinator),
    } as unknown as KfcSemanticAgentNodeDependencies);

    const update = await node(state, {
      configurable: { thread_id: 'thread-1' },
    });

    expect(resolveActiveToolNames).toHaveBeenCalledWith(
      expect.objectContaining({
        domainState: projectedDomainState,
        currentTurnToolTrace: projectedTrace,
        modelPublicationBundle: projectedBundle,
        graphExecutedToolResults: projectedExecutions,
        currentTurnResponseEvidence: projectedEvidence,
        toolEvidenceReceipts: projectedReceipts,
      }),
      expect.anything(),
    );
    expect(resolveModelSystemContext).toHaveBeenCalledWith(
      expect.objectContaining({
        domainState: projectedDomainState,
        currentTurnResponseEvidence: projectedEvidence,
      }),
      expect.anything(),
      projectedDomainState,
      projectedTrace,
    );
    expect(validateStructuredResponse).toHaveBeenCalledWith({
      state: expect.objectContaining({
        domainState: projectedDomainState,
        modelPublicationBundle: projectedBundle,
        currentTurnResponseEvidence: projectedEvidence,
      }),
      response: publication,
      runtime: expect.anything(),
    });
    expect(update).toMatchObject({
      domainState: projectedDomainState,
      currentTurnToolTrace: projectedTrace,
      modelPublicationAuthority: state.modelPublicationAuthority,
      modelPublicationBundle: projectedBundle,
      graphExecutedToolResults: projectedExecutions,
      currentTurnResponseEvidence: projectedEvidence,
      toolEvidenceReceipts: projectedReceipts,
    });
  });

  it('preserves the latest coordinated publication snapshot on failure', async () => {
    const state = wrapperState({
      modelPublicationAuthority: { authorityDigest: 'authority' } as never,
      modelPublicationBundle: { projectionDigest: 'initial' } as never,
    });
    const projectedDomainState = {
      sessionId: 'session-1',
      latestUserMessage: 'coordinated',
    } as AgentGraphState;
    const projectedTrace = [
      {
        toolName: 'searchMenu',
        arguments: { scope: 'all', query: null },
        ok: true,
        resultSummary: 'menu',
        provenance: [],
      },
    ] as KfcCreateAgentContext['currentTurnToolTrace'];
    const projectedExecutions = [{ toolCallId: 'menu' }] as never;
    const projectedEvidence = [{ evidenceId: 'evidence:menu' }] as never;
    const projectedReceipts = [{ toolCallId: 'menu' }] as never;
    const projectedBundle = { projectionDigest: 'projected' } as never;
    const coordinator: KfcCreateAgentToolCoordinator = {
      acceptBatch: vi.fn(),
      execute: vi.fn(),
      snapshot: () => ({
        state: projectedDomainState,
        currentTurnToolTrace: projectedTrace,
        executions: projectedExecutions,
        evidence: projectedEvidence,
        receipts: projectedReceipts,
        bundle: projectedBundle,
        failed: false,
      }),
    };
    const invoke = vi
      .fn<KfcSemanticAgentLike['invoke']>()
      .mockRejectedValue(new Error('agent_turn_deadline_exceeded'));
    const node = semanticAgentNode({
      ...wrapperDependencies({ invoke }),
      createToolCoordinator: vi.fn(() => coordinator),
    } as unknown as KfcSemanticAgentNodeDependencies);

    const update = await node(state, {
      configurable: { thread_id: 'thread-1' },
    });

    expect(update).toMatchObject({
      failure: 'agent_turn_deadline_exceeded',
      domainState: projectedDomainState,
      currentTurnToolTrace: projectedTrace,
      modelPublicationAuthority: state.modelPublicationAuthority,
      modelPublicationBundle: projectedBundle,
      graphExecutedToolResults: projectedExecutions,
      currentTurnResponseEvidence: projectedEvidence,
      toolEvidenceReceipts: projectedReceipts,
    });
    expect(update).not.toHaveProperty('messages');
    expect(update).not.toHaveProperty('responseText');
    expect(update).not.toHaveProperty('responseFactualClaims');
    expect(update).not.toHaveProperty('responsePublicationDeclaration');
    expect(update).not.toHaveProperty('selectedActionResponseReference');
    expect(coordinator.execute).not.toHaveBeenCalled();
  });

  it('maps mutated shared counters, ledger, messages, and publication back', async () => {
    const state = wrapperState();
    const originalLedger = structuredClone(state.toolCallLedger);
    const resultMessages = [new AIMessage('done')];
    const invoke = vi.fn<KfcSemanticAgentLike['invoke']>(
      async (_input, config) => {
        const shared = config.context.createAgentRuntime;
        shared.providerAttempts.used = 4;
        shared.providerRetry.used = 1;
        shared.semanticCorrections.used = 1;
        shared.advertisedToolNames = [];
        shared.toolCallLedger = [
          ...shared.toolCallLedger,
          {
            signatureDigest: 'b'.repeat(64),
            toolName: 'updateCart',
            effect: 'reversible_mutation',
            receipt: {
              schemaVersion: 'kfc-checkpoint-tool-evidence-receipt-v2',
              evidenceId: 'evidence:cart',
              evidenceDigest: 'c'.repeat(64),
              toolCallId: 'cart',
              toolName: 'updateCart',
              executionOutcome: 'success',
              result: 'audit_evidence_reference',
            },
          },
        ];
        return { messages: resultMessages, structuredResponse: publication };
      },
    );
    const node = semanticAgentNode(wrapperDependencies({ invoke }));

    const update = await node(state, {
      configurable: { thread_id: 'thread-1' },
    });

    expect(update).toMatchObject({
      messages: resultMessages,
      providerAttempts: 4,
      providerRetries: 1,
      semanticCorrections: 1,
      toolCallLedger: [
        ...originalLedger,
        expect.objectContaining({
          signatureDigest: 'b'.repeat(64),
          toolName: 'updateCart',
          effect: 'reversible_mutation',
        }),
      ],
      responseText: publication.customerText,
      responseFactualClaims: publication.factualClaims,
      responsePublicationDeclaration: publication.publicationDeclaration,
      selectedActionResponseReference: publication.selectedActionResponse,
    });
    expect(update).not.toHaveProperty('output');
    expect(state.toolCallLedger).toEqual(originalLedger);
  });

  it('forwards the complete config received from a real parent graph node', async () => {
    const state = wrapperState();
    const configs: Array<RunnableConfig & { context: KfcCreateAgentContext }> =
      [];
    const node = semanticAgentNode(
      wrapperDependencies({
        invoke: vi.fn(async (_input, config) => {
          configs.push(config);
          return { messages: [] };
        }),
      }),
    );
    const graph = new StateGraph(KfcAgentState)
      .addNode('semantic_agent', node)
      .addEdge(START, 'semantic_agent')
      .addEdge('semantic_agent', END)
      .compile();
    const callerCallback = {
      name: 'caller-config-callback',
      handleChainStart: vi.fn(),
    };
    const received: RunnableConfig = {
      configurable: {
        thread_id: 'parent-thread',
        checkpoint_id: 'parent-checkpoint',
        checkpoint_ns: '',
        tenant: 'kfc-vn',
      },
      callbacks: [callerCallback] as never,
      tags: ['production', 'kfc'],
      metadata: { requestId: 'request-1' },
      recursionLimit: 37,
      runName: 'caller-parent-run',
    };

    await graph.invoke(state, received);

    const forwardedCallbacks = configs[0]?.callbacks as
      { handlers?: unknown[] } | undefined;
    expect(forwardedCallbacks?.handlers).toContain(callerCallback);
    expect(configs[0]?.tags).toEqual(expect.arrayContaining(received.tags!));
    expect(configs[0]?.metadata).toMatchObject(received.metadata!);
    expect(configs[0]?.recursionLimit).toBe(37);
    expect(configs[0]?.configurable).toMatchObject({
      thread_id: 'parent-thread',
      checkpoint_id: undefined,
      checkpoint_ns: expect.stringMatching(/^semantic_agent:[0-9a-f-]{36}$/u),
      tenant: 'kfc-vn',
    });
  });

  it('does not resume a new child from an unrelated parent checkpoint', async () => {
    const state = wrapperState();
    const inputs: Array<Parameters<KfcSemanticAgentLike['invoke']>[0]> = [];
    const node = semanticAgentNode(
      wrapperDependencies({
        invoke: vi.fn(async (input) => {
          inputs.push(input);
          return { messages: [] };
        }),
      }),
    );

    await node(state, {
      configurable: {
        __pregel_resuming: true,
        checkpoint_ns: 'semantic_agent:child-task',
        checkpoint_map: { '': 'parent-checkpoint' },
      },
    });

    expect(inputs).toEqual([{ messages: state.messages }]);
  });

  it.each([
    {
      name: 'an explicit child checkpoint',
      configurable: {
        checkpoint_id: 'child-checkpoint',
        checkpoint_ns: 'semantic_agent:child-task',
      },
    },
    {
      name: 'the current child namespace in the checkpoint map',
      configurable: {
        checkpoint_ns: 'semantic_agent:child-task',
        checkpoint_map: {
          '': 'parent-checkpoint',
          'semantic_agent:child-task': 'child-checkpoint',
        },
      },
    },
  ])('resumes from $name', async ({ configurable }) => {
    const state = wrapperState();
    const inputs: Array<Parameters<KfcSemanticAgentLike['invoke']>[0]> = [];
    const node = semanticAgentNode(
      wrapperDependencies({
        invoke: vi.fn(async (input) => {
          inputs.push(input);
          return { messages: [] };
        }),
      }),
    );

    await node(state, { configurable });

    expect(inputs).toEqual([null]);
  });

  it('propagates GraphInterrupt unchanged', async () => {
    const state = wrapperState();
    const interruption = new GraphInterrupt([]);
    const node = semanticAgentNode(
      wrapperDependencies({
        invoke: vi.fn(async () => Promise.reject(interruption)),
      }),
    );

    await expect(
      node(state, {
        configurable: { thread_id: 'thread-1' },
      }),
    ).rejects.toBe(interruption);
  });

  it('corrects once after the active guard with one shared runtime and config', async () => {
    const events: string[] = [];
    const state = wrapperState();
    const parsing = new StructuredOutputParsingError('publication', ['bad']);
    let sharedAtFailure:
      KfcCreateAgentContext['createAgentRuntime'] | undefined;
    const invoke = vi
      .fn<KfcSemanticAgentLike['invoke']>()
      .mockImplementationOnce(async (_input, config) => {
        sharedAtFailure = config.context.createAgentRuntime;
        throw MiddlewareError.wrap(
          MiddlewareError.wrap(parsing, 'inner'),
          'outer',
        );
      })
      .mockImplementationOnce(async () => {
        events.push('corrected_invoke');
        return {
          messages: [new AIMessage('corrected')],
          structuredResponse: publication,
        };
      });
    const assertRuntimeActive = vi.fn(() => {
      expect(sharedAtFailure?.semanticCorrections.used).toBe(1);
      events.push('active');
    });
    const node = semanticAgentNode({
      ...wrapperDependencies({ invoke }),
      assertRuntimeActive,
    });

    const update = await node(state, {
      configurable: { thread_id: 'thread-1', tenant: 'kfc-vn' },
      metadata: { requestId: 'request-1' },
    });
    const shared = invoke.mock.calls[0]?.[1].context.createAgentRuntime;

    expect(update).toMatchObject({
      responseText: publication.customerText,
      semanticCorrections: 1,
    });
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[1]?.[1]).not.toBe(invoke.mock.calls[0]?.[1]);
    expect(invoke.mock.calls[1]?.[1].context.createAgentRuntime).toBe(shared);
    expect(invoke.mock.calls[1]?.[1].context).not.toHaveProperty(
      'toolCoordinator',
    );
    expect(invoke.mock.calls[1]?.[1].context.resolveActiveToolNames()).toEqual(
      [],
    );
    expect(assertRuntimeActive).toHaveBeenCalledOnce();
    expect(events).toEqual(['active', 'corrected_invoke']);
    const correctedInput = invoke.mock.calls[1]?.[0];
    expect(correctedInput).not.toBeNull();
    const correctedMessages = correctedInput?.messages ?? [];
    expect(correctedMessages.slice(0, state.messages.length)).toEqual(
      state.messages,
    );
    const feedback = correctedMessages.at(-1);
    expect(feedback).toBeInstanceOf(SystemMessage);
    expect(String(feedback?.content)).toContain(
      'provider-native structured output',
    );
    expect(String(feedback?.content).length).toBeLessThanOrEqual(512);
  });

  it('makes an empty private-evidence correction explicit', async () => {
    const state = wrapperState({
      modelPublicationBundle: {
        evidence: [{ evidenceId: 'menu_search_results', privateData: false }],
      } as never,
    });
    const invoke = vi.fn<KfcSemanticAgentLike['invoke']>().mockResolvedValue({
      messages: [new AIMessage('response')],
      structuredResponse: publication,
    });
    const validateStructuredResponse = vi
      .fn<
        NonNullable<
          KfcSemanticAgentNodeDependencies['validateStructuredResponse']
        >
      >()
      .mockResolvedValueOnce({
        ok: false,
        errorCode: 'agent_response_publication_rejected',
        correctable: true,
      })
      .mockResolvedValueOnce({ ok: true });
    const node = semanticAgentNode({
      ...wrapperDependencies({ invoke }),
      validateStructuredResponse,
    });

    const update = await node(state, {
      configurable: { thread_id: 'thread-1' },
    });

    expect(update).toMatchObject({
      responseText: publication.customerText,
      semanticCorrections: 1,
    });
    const correctionInput = invoke.mock.calls[1]?.[0];
    expect(correctionInput).not.toBeNull();
    const feedback = correctionInput?.messages.at(-1);
    expect(feedback).toBeInstanceOf(SystemMessage);
    expect(String(feedback?.content)).toContain(
      'publication.privateEvidenceIds is empty',
    );
    expect(String(feedback?.content)).toContain(
      'publicationDeclaration.disclosureAuthorities to []',
    );
    expect(String(feedback?.content)).toContain(
      'Public evidence citations never receive disclosure authorities',
    );
  });

  it('maps a second parsing failure to the shared correction limit', async () => {
    const state = wrapperState();
    const parsing = new StructuredOutputParsingError('publication', ['bad']);
    const invoke = vi
      .fn<KfcSemanticAgentLike['invoke']>()
      .mockRejectedValue(MiddlewareError.wrap(parsing, 'wrapped'));
    const node = semanticAgentNode(wrapperDependencies({ invoke }));

    const update = await node(state, {
      configurable: { thread_id: 'thread-1' },
    });

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(update).toMatchObject({
      semanticCorrections: 1,
      failure: 'agent_semantic_correction_limit_exceeded',
    });
  });

  it('does not re-enter when the actual correction channel is exhausted', async () => {
    const state = wrapperState({ semanticCorrections: 1 });
    const parsing = new StructuredOutputParsingError('publication', ['bad']);
    const invoke = vi
      .fn<KfcSemanticAgentLike['invoke']>()
      .mockRejectedValue(MiddlewareError.wrap(parsing, 'wrapped'));
    const node = semanticAgentNode(wrapperDependencies({ invoke }));

    const update = await node(state, {
      configurable: { thread_id: 'thread-1' },
    });

    expect(invoke).toHaveBeenCalledOnce();
    expect(update).toMatchObject({
      semanticCorrections: 1,
      failure: 'agent_semantic_correction_limit_exceeded',
    });
  });

  it('maps an unrelated error without correction or re-entry', async () => {
    const state = wrapperState();
    const invoke = vi
      .fn<KfcSemanticAgentLike['invoke']>()
      .mockRejectedValue(new Error('agent_tool_execution_failed'));
    const node = semanticAgentNode(wrapperDependencies({ invoke }));

    const update = await node(state, {
      configurable: { thread_id: 'thread-1' },
    });

    expect(invoke).toHaveBeenCalledOnce();
    expect(update).toMatchObject({
      semanticCorrections: 0,
      failure: 'agent_tool_execution_failed',
    });
  });
});
