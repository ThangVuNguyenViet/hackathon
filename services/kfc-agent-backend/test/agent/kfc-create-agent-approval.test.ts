/* eslint-disable @typescript-eslint/no-unsafe-type-assertion -- RED boundary composes opaque LangGraph state and agent fixtures */
import type { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import {
  AIMessage,
  HumanMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { CheckpointTuple } from '@langchain/langgraph-checkpoint';
import type { StructuredTool } from '@langchain/core/tools';
import {
  Command,
  END,
  MemorySaver,
  START,
  StateGraph,
} from '@langchain/langgraph';
import { describe, expect, it, vi } from 'vitest';
import {
  createKfcSemanticAgentNode,
  type KfcSemanticAgentLike,
} from '../../src/agent/agentStateGraph.js';
import { createKfcAgent } from '../../src/agent/kfcCreateAgent.js';
import type { KfcCreateAgentContext } from '../../src/agent/kfcCreateAgentRuntime.js';
import {
  KfcAgentState,
  type KfcAgentStateUpdate,
  type KfcAgentStateValue,
} from '../../src/agent/agentStateSchema.js';
import type { SingleAgentRuntimeContext } from '../../src/agent/singleAgentRuntime.js';
import type { AgentGraphState } from '../../src/graph/state.js';
import type { ToolName } from '../../src/ordering/types.js';

const publication = {
  customerText: 'The order was not changed.',
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

class ApprovalModel extends BaseChatModel {
  private index = 0;
  private readonly outputs: AIMessage[];
  readonly calls: number[] = [];

  constructor(outputs: AIMessage[]) {
    super({});
    this.outputs = outputs;
  }

  override _llmType(): string {
    return 'kfc-approval-model';
  }

  override bindTools(_tools: StructuredTool[]): ApprovalModel {
    return this;
  }

  override async _generate(
    _messages: unknown[],
    _options: this['ParsedCallOptions'],
    _runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    this.calls.push(this.index);
    const message = this.outputs[this.index++];
    if (!message) throw new Error('approval_model_script_exhausted');
    return {
      generations: [{ text: String(message.content), message }],
      llmOutput: {},
    };
  }
}

function state(): KfcAgentStateValue {
  return {
    messages: [new HumanMessage('Đặt đơn')],
    sessionId: 'approval-session',
    customerId: 'approval-customer',
    channel: 'kfc',
    text: 'Đặt đơn',
    externalMessageId: 'approval-message',
    metadata: null,
    domainState: { sessionId: 'approval-session' } as AgentGraphState,
    graphTrace: null,
    currentTurnToolTrace: [],
    currentUserTurn: null,
    currentTurnId: 'approval-turn',
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
    providerAttempts: 0,
    providerAttemptEvidence: [],
    providerRetries: 0,
    semanticCorrections: 0,
    toolCallLedger: [],
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
  };
}

function runtimeContext(value: KfcAgentStateValue): SingleAgentRuntimeContext {
  return {
    turnInput: {
      sessionId: value.sessionId,
    } as SingleAgentRuntimeContext['turnInput'],
    turnTrace: {} as SingleAgentRuntimeContext['turnTrace'],
    externalCallContext: {
      signal: AbortSignal.timeout(30_000),
      deadlineAt: value.turnDeadlineAt,
    },
    abortExternalCalls: vi.fn(),
    disposeExternalCalls: vi.fn(),
    state:
      value.domainState ?? ({ sessionId: value.sessionId } as AgentGraphState),
  };
}

async function fixture() {
  const execute = vi.fn(async () => ({
    toolName: 'placeOrder',
    ok: true,
    message: 'authoritative executor accepted action',
    provenance: [],
  }));
  const model = new ApprovalModel([
    new AIMessage({
      content: '',
      tool_calls: [
        {
          id: 'place-order-1',
          name: 'placeOrder',
          args: {},
          type: 'tool_call',
        },
      ],
    }),
    new AIMessage(JSON.stringify(publication)),
  ]);
  const realAgent = createKfcAgent({
    model,
    toolDependencies: { execute: execute as never },
  });
  const nestedConfigs: RunnableConfig[] = [];
  const nestedInputs: Array<Parameters<KfcSemanticAgentLike['invoke']>[0]> = [];
  const nested: KfcSemanticAgentLike = {
    invoke: async (input, config) => {
      nestedInputs.push(input);
      nestedConfigs.push(config);
      const result = await realAgent.invoke(input, config);
      return result as {
        messages: BaseMessage[];
        structuredResponse?: typeof publication;
      };
    },
  };
  const wrapper = createKfcSemanticAgentNode({
    agent: nested,
    runtimeContextForState: runtimeContext,
    resolveActiveToolNames: () => ['placeOrder'],
    assertRuntimeActive: vi.fn(),
  });
  const checkpointer = new MemorySaver();
  const graph = new StateGraph(KfcAgentState)
    .addNode('semantic_agent', wrapper)
    .addEdge(START, 'semantic_agent')
    .addEdge('semantic_agent', END)
    .compile({ checkpointer });
  const config = {
    configurable: {
      thread_id: 'approval-parent-thread',
      checkpoint_ns: '',
      tenant: 'kfc-vn',
    },
    recursionLimit: 32,
  } satisfies RunnableConfig;
  const paused = await graph.invoke(state(), config);
  return {
    checkpointer,
    config,
    execute,
    graph,
    model,
    nestedConfigs,
    nestedInputs,
    paused,
  };
}

function interruptsFrom(paused: KfcAgentStateValue) {
  return (
    (
      paused as KfcAgentStateValue & {
        __interrupt__?: Array<{ value: unknown }>;
      }
    ).__interrupt__ ?? []
  );
}

async function checkpointsForThread(
  checkpointer: MemorySaver,
  threadId: string,
): Promise<CheckpointTuple[]> {
  const checkpoints: CheckpointTuple[] = [];
  for await (const tuple of checkpointer.list({
    configurable: { thread_id: threadId },
  })) {
    checkpoints.push(tuple);
  }
  return checkpoints;
}

function parentChainReaches(
  tuple: CheckpointTuple,
  checkpointsById: ReadonlyMap<string, CheckpointTuple>,
  ancestorIds: ReadonlySet<string>,
): boolean {
  const visited = new Set<string>();
  let parentId = tuple.parentConfig?.configurable?.checkpoint_id;
  while (parentId && !visited.has(parentId)) {
    if (ancestorIds.has(parentId)) return true;
    visited.add(parentId);
    parentId =
      checkpointsById.get(parentId)?.parentConfig?.configurable?.checkpoint_id;
  }
  return false;
}

describe('semantic_agent native HITL approval boundary', () => {
  it('emits one real nested approve/reject interrupt for one action', async () => {
    const result = await fixture();
    const interrupts = interruptsFrom(result.paused);

    expect(interrupts).toHaveLength(1);
    expect(interrupts[0]?.value).toMatchObject({
      actionRequests: [{ name: 'placeOrder', args: {} }],
      reviewConfigs: [
        {
          actionName: 'placeOrder',
          allowedDecisions: ['approve', 'reject'],
        },
      ],
    });
    expect(result.nestedConfigs[0]?.configurable?.checkpoint_ns).toMatch(
      /^semantic_agent:[0-9a-f-]{36}$/u,
    );
    expect(result.execute).not.toHaveBeenCalled();
  });

  it('rejects with standard Command decisions on the same nested checkpoint lineage', async () => {
    const result = await fixture();
    const nestedNamespace = String(
      result.nestedConfigs[0]?.configurable?.checkpoint_ns ?? '',
    );
    const beforeResume = await checkpointsForThread(
      result.checkpointer,
      'approval-parent-thread',
    );
    const nestedBefore = beforeResume.filter(
      (tuple) => tuple.config.configurable?.checkpoint_ns === nestedNamespace,
    );
    const preResumeIds = new Set(
      nestedBefore.flatMap((tuple) =>
        tuple.config.configurable?.checkpoint_id
          ? [tuple.config.configurable.checkpoint_id]
          : [],
      ),
    );

    expect(nestedNamespace).toMatch(/^semantic_agent:/u);
    expect(nestedBefore.length).toBeGreaterThan(0);
    expect(
      nestedBefore.every(
        (tuple) =>
          tuple.config.configurable?.thread_id === 'approval-parent-thread',
      ),
    ).toBe(true);

    const resumed = await result.graph.invoke(
      new Command({
        resume: { decisions: [{ type: 'reject' }] },
      }),
      result.config,
    );
    const afterResume = await checkpointsForThread(
      result.checkpointer,
      'approval-parent-thread',
    );
    const nestedAfter = afterResume.filter(
      (tuple) => tuple.config.configurable?.checkpoint_ns === nestedNamespace,
    );
    const checkpointsById = new Map(
      nestedAfter.flatMap((tuple) => {
        const checkpointId = tuple.config.configurable?.checkpoint_id;
        return checkpointId ? [[checkpointId, tuple] as const] : [];
      }),
    );
    const newlyWritten = nestedAfter.filter((tuple) => {
      const checkpointId = tuple.config.configurable?.checkpoint_id;
      return checkpointId !== undefined && !preResumeIds.has(checkpointId);
    });

    expect(result.execute).not.toHaveBeenCalled();
    expect(resumed.responseText).toBe(publication.customerText);
    expect(result.nestedConfigs).toHaveLength(2);
    expect(result.nestedInputs).toHaveLength(2);
    expect(result.nestedInputs[0]).not.toBeNull();
    expect(result.nestedConfigs[1]?.configurable).toMatchObject({
      __pregel_resuming: true,
      checkpoint_map: { '': expect.any(String) },
      checkpoint_ns: nestedNamespace,
      __pregel_scratchpad: {
        nullResume: { decisions: [{ type: 'reject' }] },
      },
    });
    expect(result.nestedInputs[1]).toBeNull();
    expect(
      result.nestedConfigs.every(
        (config) =>
          config.configurable?.thread_id === 'approval-parent-thread' &&
          config.configurable?.checkpoint_ns === nestedNamespace,
      ),
    ).toBe(true);
    expect(newlyWritten.length).toBeGreaterThan(0);
    expect(
      newlyWritten.every((tuple) =>
        parentChainReaches(tuple, checkpointsById, preResumeIds),
      ),
    ).toBe(true);
    expect(
      nestedAfter.every(
        (tuple) =>
          tuple.config.configurable?.checkpoint_ns === nestedNamespace &&
          tuple.config.configurable?.thread_id === 'approval-parent-thread',
      ),
    ).toBe(true);
  });

  it('approved HITL reaches the injected commerce executor once for one resume', async () => {
    // Signed authority, fences, CAS, idempotency, and duplicate resumes remain
    // authoritative in the existing native confirmation and ordering suites.
    const result = await fixture();

    const resumed = await result.graph.invoke(
      new Command({
        resume: { decisions: [{ type: 'approve' }] },
      }),
      result.config,
    );

    expect(result.execute).toHaveBeenCalledOnce();
    expect(resumed.responseText).toBe(publication.customerText);
    expect(result.model.calls).toHaveLength(2);
  });
});
