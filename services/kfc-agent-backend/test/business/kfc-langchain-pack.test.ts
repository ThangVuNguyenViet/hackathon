import type { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager';
import { CallbackManager } from '@langchain/core/callbacks/manager';
import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import {
  AIMessage,
  HumanMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';
import type { StructuredTool } from '@langchain/core/tools';
import { describe, expect, it, vi } from 'vitest';
import { KfcAgentPack } from '../../src/businesses/kfc/pack.js';
import type { AgentGraphState } from '../../src/graph/state.js';
import { toolNames } from '../../src/ordering/toolCatalog.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';

const publication = {
  customerText: 'Mình cần bạn xác nhận trước khi tiếp tục.',
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

const menuPublication = {
  ...publication,
  customerText: 'Mình đã tìm thấy Combo Gà Rán.',
  factualClaims: {
    ...publication.factualClaims,
    evidenceReferences: [
      { evidenceId: 'menu:combo-ga-ran', claimKinds: ['product'] },
    ],
  },
};

interface ScriptedModelCall {
  readonly messages: BaseMessage[];
  readonly toolNames: string[];
}

class ScriptedKfcChatModel extends BaseChatModel {
  readonly calls: ScriptedModelCall[];
  private readonly outputs: BaseMessage[];
  private readonly shared: { index: number };
  private tools: StructuredTool[] = [];

  constructor(input: {
    outputs: BaseMessage[];
    calls?: ScriptedModelCall[];
    shared?: { index: number };
  }) {
    super({});
    this.outputs = input.outputs;
    this.calls = input.calls ?? [];
    this.shared = input.shared ?? { index: 0 };
  }

  override _llmType(): string {
    return 'scripted-kfc-chat-model';
  }

  override bindTools(tools: StructuredTool[]): ScriptedKfcChatModel {
    const bound = new ScriptedKfcChatModel({
      outputs: this.outputs,
      calls: this.calls,
      shared: this.shared,
    });
    bound.tools = tools;
    return bound;
  }

  override async _generate(
    messages: BaseMessage[],
    _options: this['ParsedCallOptions'],
    _runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    this.calls.push({
      messages: [...messages],
      toolNames: this.tools.map(({ name }) => name),
    });
    const output = this.outputs[this.shared.index++];
    if (!output) throw new Error('script_exhausted');
    return {
      generations: [
        {
          text: typeof output.content === 'string' ? output.content : '',
          message: output,
        },
      ],
      llmOutput: {},
    };
  }
}

function state(latestUserMessage: string): AgentGraphState {
  return {
    sessionId: 'kfc:core',
    customerId: 'customer-1',
    channel: 'kfc',
    latestUserMessage,
    userConfirmedOrder: false,
    escalationReasons: [],
    retrievedEvidence: [],
  };
}

async function canonicalStore(): Promise<{
  store: MemoryStore;
  currentUserTurnId: string;
}> {
  const store = new MemoryStore();
  await store.appendTurn({
    sessionId: 'kfc:core',
    channel: 'kfc',
    role: 'user',
    text: 'Trước đó tôi hỏi gì?',
    externalMessageId: 'old-user',
    externalUserId: 'customer-1',
    deliveryStatus: 'received',
    metadata: null,
  });
  await store.appendTurn({
    sessionId: 'kfc:core',
    channel: 'kfc',
    role: 'assistant',
    text: 'Bạn đang tìm món cho bữa trưa.',
    externalMessageId: null,
    externalUserId: 'customer-1',
    deliveryStatus: 'sent',
    metadata: null,
  });
  const current = await store.appendTurn({
    sessionId: 'kfc:core',
    channel: 'kfc',
    role: 'user',
    text: 'Tìm combo gà rán.',
    externalMessageId: 'current-user',
    externalUserId: 'customer-1',
    deliveryStatus: 'received',
    metadata: null,
  });
  return { store, currentUserTurnId: current.id };
}

describe('KFC LangChain business pack', () => {
  it('runs one createAgent loop over canonical history and returns verified KFC projection', async () => {
    const { store, currentUserTurnId } = await canonicalStore();
    const model = new ScriptedKfcChatModel({
      outputs: [
        new AIMessage({
          content: '',
          tool_calls: [
            {
              id: 'menu-1',
              name: 'searchMenu',
              args: { scope: 'filtered', query: 'combo gà rán' },
              type: 'tool_call',
            },
          ],
        }),
        new AIMessage(JSON.stringify(menuPublication)),
      ],
    });
    const executeTool = vi.fn(async ({ state: activeState }) => {
      activeState.menuSearchResults = [
        {
          code: 'combo-ga-ran',
          name: 'Combo Gà Rán',
          categoryId: 'combo',
          category: 'Combo',
          description: '',
          priceVnd: 89_000,
          originalPriceVnd: null,
          imageUrl: '',
          available: true,
          isCustomize: false,
          hasModifiers: false,
        },
      ];
      return {
        evidenceId: 'menu:combo-ga-ran',
        result: {
          ok: true,
          toolName: 'searchMenu',
          value: { total: 1 },
          message: 'Found one verified menu item',
          provenance: [],
        },
      };
    });
    const pack = new KfcAgentPack({
      model,
      store,
      loadState: async () => state('Tìm combo gà rán.'),
      executeTool,
      resolveActiveToolNames: () => [...toolNames],
    });

    const result = await pack.runTurn({
      sessionId: 'kfc:core',
      customerId: 'customer-1',
      channel: 'kfc',
      currentUserTurnId,
    });

    expect(result.status).toBe('completed');
    expect(result.responseText).toBe(menuPublication.customerText);
    expect(result.state.menuSearchResults?.[0]?.name).toBe('Combo Gà Rán');
    expect(result.genUi?.widgetKind).toBe('smartMenuPicker');
    expect(result.toolCalls).toEqual([
      expect.objectContaining({
        id: 'menu-1',
        name: 'searchMenu',
        effect: 'provider_read',
        status: 'success',
        evidenceId: 'menu:combo-ga-ran',
      }),
    ]);
    expect(executeTool).toHaveBeenCalledOnce();
    expect(model.calls).toHaveLength(2);
    expect(model.calls[0]?.toolNames).toEqual([...toolNames]);
    const prompt = JSON.stringify(
      model.calls[0]!.messages.map(({ content }) => content),
    );
    expect(prompt).toContain('Trước đó tôi hỏi gì?');
    expect(prompt).toContain('Bạn đang tìm món cho bữa trưa.');
    expect(prompt).toContain('Tìm combo gà rán.');
    expect(
      model.calls[0]!.messages.some((message) =>
        HumanMessage.isInstance(message),
      ),
    ).toBe(true);
    expect(await store.listTurns('kfc:core')).toHaveLength(3);
  });

  it('turns an irreversible typed tool call into a pending confirmation without executing it', async () => {
    const { store, currentUserTurnId } = await canonicalStore();
    const model = new ScriptedKfcChatModel({
      outputs: [
        new AIMessage({
          content: '',
          tool_calls: [
            {
              id: 'order-1',
              name: 'placeOrder',
              args: {},
              type: 'tool_call',
            },
          ],
        }),
        new AIMessage(JSON.stringify(publication)),
      ],
    });
    const executeTool = vi.fn();
    const pack = new KfcAgentPack({
      model,
      store,
      loadState: async () => state('Đặt đơn này.'),
      executeTool,
      resolveActiveToolNames: () => [...toolNames],
    });

    const result = await pack.runTurn({
      sessionId: 'kfc:core',
      customerId: 'customer-1',
      channel: 'kfc',
      currentUserTurnId,
    });

    expect(result).toMatchObject({
      status: 'confirmation_required',
      pendingConfirmation: {
        action: {
          id: 'order-1',
          toolName: 'placeOrder',
          arguments: {},
        },
      },
    });
    expect(result.toolCalls).toEqual([
      expect.objectContaining({
        id: 'order-1',
        name: 'placeOrder',
        effect: 'irreversible_mutation',
        status: 'confirmation_required',
      }),
    ]);
    expect(executeTool).not.toHaveBeenCalled();
    expect(await store.listTurns('kfc:core')).toHaveLength(3);
  });

  it('derives visible tools only from the injected trusted state policy', async () => {
    const { store, currentUserTurnId } = await canonicalStore();
    const model = new ScriptedKfcChatModel({
      outputs: [new AIMessage(JSON.stringify(publication))],
    });
    const pack = new KfcAgentPack({
      model,
      store,
      loadState: async () => state('Chỉ xem thực đơn.'),
      executeTool: vi.fn(),
      resolveActiveToolNames: () => ['searchMenu'],
    });

    await pack.runTurn({
      sessionId: 'kfc:core',
      customerId: 'customer-1',
      channel: 'kfc',
      currentUserTurnId,
    });

    expect(model.calls[0]?.toolNames).toEqual(['searchMenu']);
  });

  it('nests the createAgent and model runs under the application trace callback parent', async () => {
    const { store, currentUserTurnId } = await canonicalStore();
    const model = new ScriptedKfcChatModel({
      outputs: [new AIMessage(JSON.stringify(publication))],
    });
    const applicationRunId = crypto.randomUUID();
    const runs: Array<{
      kind: 'chain' | 'model';
      runId: string;
      parentRunId?: string;
    }> = [];
    const handler = BaseCallbackHandler.fromMethods({
      handleChainStart(
        _chain: unknown,
        _inputs: unknown,
        runId: string,
        parentRunId?: string,
        _tags?: string[],
        _metadata?: Record<string, unknown>,
      ) {
        runs.push({ kind: 'chain', runId, parentRunId });
      },
      handleChatModelStart(
        _model: unknown,
        _messages: unknown,
        runId: string,
        parentRunId?: string,
      ) {
        runs.push({ kind: 'model', runId, parentRunId });
      },
    });
    const callbacks = new CallbackManager(applicationRunId);
    callbacks.addHandler(handler, true);
    const pack = new KfcAgentPack({
      model,
      store,
      loadState: async () => state('Chỉ xem thực đơn.'),
      executeTool: vi.fn(),
      resolveActiveToolNames: () => ['searchMenu'],
    });

    await pack.runTurn({
      sessionId: 'kfc:core',
      customerId: 'customer-1',
      channel: 'kfc',
      currentUserTurnId,
      traceCallbacks: callbacks,
    });

    const byId = new Map(runs.map((run) => [run.runId, run]));
    const reachesApplicationTrace = (run: (typeof runs)[number]): boolean => {
      let parentRunId = run.parentRunId;
      const visited = new Set<string>();
      while (parentRunId && !visited.has(parentRunId)) {
        if (parentRunId === applicationRunId) return true;
        visited.add(parentRunId);
        parentRunId = byId.get(parentRunId)?.parentRunId;
      }
      return false;
    };

    expect(runs.some(({ kind }) => kind === 'chain')).toBe(true);
    expect(runs.some(({ kind }) => kind === 'model')).toBe(true);
    expect(
      runs.every(reachesApplicationTrace),
      JSON.stringify(runs, null, 2),
    ).toBe(true);
  });
});
