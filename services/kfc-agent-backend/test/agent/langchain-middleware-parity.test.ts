import type { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import {
  AIMessage,
  HumanMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';
import type { StructuredTool } from '@langchain/core/tools';
import { tool } from '@langchain/core/tools';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createKfcAgent } from '../../src/agent/kfcCreateAgent.js';
import { KfcAgentPack } from '../../src/businesses/kfc/pack.js';
import type { AgentGraphState } from '../../src/graph/state.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';

type ModelStep = BaseMessage | Error;
interface AuditModelState {
  calls: number;
  steps: ModelStep[];
  capturedMessages?: BaseMessage[][];
}

class AuditModel extends BaseChatModel {
  readonly shared: AuditModelState;

  constructor(shared: AuditModelState) {
    super({});
    this.shared = shared;
  }

  override _llmType(): string {
    return 'langchain-middleware-audit-model';
  }

  override bindTools(_tools: StructuredTool[]): AuditModel {
    return new AuditModel(this.shared);
  }

  override async _generate(
    _messages: BaseMessage[],
    _options: this['ParsedCallOptions'],
    _runManager?: CallbackManagerForLLMRun,
  ): Promise<ChatResult> {
    this.shared.capturedMessages?.push([..._messages]);
    const step = this.shared.steps[this.shared.calls];
    this.shared.calls += 1;
    if (step instanceof Error) throw step;
    if (!step) throw new Error('audit_model_script_exhausted');
    return {
      generations: [
        {
          text: typeof step.content === 'string' ? step.content : '',
          message: step,
        },
      ],
      llmOutput: {},
    };
  }
}

function createAuditAgent(
  model: AuditModel,
  tools: readonly StructuredTool[] = [],
) {
  return createKfcAgent({ model, tools });
}

describe('LangChain middleware parity decisions', () => {
  it('does not add an unaccounted model retry outside the physical-call and deadline authority', async () => {
    const transientFailure = new Error('provider_temporarily_unavailable');
    const shared = { calls: 0, steps: [transientFailure] };
    const agent = createAuditAgent(new AuditModel(shared));

    await expect(
      agent.invoke({ messages: [new HumanMessage('Xin chào')] }),
    ).rejects.toThrow('provider_temporarily_unavailable');
    expect(shared.calls).toBe(1);
  });

  it('does not retry an effect-capable tool behind application idempotency authority', async () => {
    let effectAttempts = 0;
    const effectFailure = new Error('commerce_provider_failed');
    const effectTool = tool(
      async () => {
        effectAttempts += 1;
        throw effectFailure;
      },
      {
        name: 'updateCart',
        description: 'Effect-capable test tool.',
        schema: z.object({}),
      },
    );
    const shared = {
      calls: 0,
      steps: [
        new AIMessage({
          content: '',
          tool_calls: [
            {
              id: 'effect-1',
              name: 'updateCart',
              args: {},
              type: 'tool_call',
            },
          ],
        }),
      ],
    };
    const agent = createAuditAgent(new AuditModel(shared), [effectTool]);

    await expect(
      agent.invoke({ messages: [new HumanMessage('Cập nhật giỏ hàng')] }),
    ).rejects.toThrow('commerce_provider_failed');
    expect(effectAttempts).toBe(1);
  });

  it('keeps the eight-tool run limit ahead of any oversized effect batch', async () => {
    let effectAttempts = 0;
    const effectTool = tool(
      async () => {
        effectAttempts += 1;
        return 'ok';
      },
      {
        name: 'updateCart',
        description: 'Effect-capable test tool.',
        schema: z.object({}),
      },
    );
    const shared = {
      calls: 0,
      steps: [
        new AIMessage({
          content: '',
          tool_calls: Array.from({ length: 9 }, (_, index) => ({
            id: `effect-${String(index)}`,
            name: 'updateCart',
            args: {},
            type: 'tool_call' as const,
          })),
        }),
      ],
    };
    const agent = createAuditAgent(new AuditModel(shared), [effectTool]);

    await expect(
      agent.invoke({ messages: [new HumanMessage('Cập nhật nhiều mục')] }),
    ).rejects.toThrow(/run limit exceeded \(9\/8 calls\)/u);
    expect(shared.calls).toBe(1);
    expect(effectAttempts).toBe(0);
  });

  it('keeps the six-model-call run limit as the physical model-call authority', async () => {
    let toolAttempts = 0;
    const readTool = tool(
      async () => {
        toolAttempts += 1;
        return 'verified';
      },
      {
        name: 'searchMenu',
        description: 'Read-only test tool.',
        schema: z.object({}),
      },
    );
    const shared = {
      calls: 0,
      steps: Array.from(
        { length: 7 },
        (_, index) =>
          new AIMessage({
            content: '',
            tool_calls: [
              {
                id: `read-${String(index)}`,
                name: 'searchMenu',
                args: {},
                type: 'tool_call',
              },
            ],
          }),
      ),
    };
    const agent = createAuditAgent(new AuditModel(shared), [readTool]);

    await expect(
      agent.invoke(
        { messages: [new HumanMessage('Tiếp tục tra cứu')] },
        { recursionLimit: 64 },
      ),
    ).rejects.toThrow(/run level call limit reached with 6 model calls/u);
    expect(shared.calls).toBe(6);
    expect(toolAttempts).toBe(6);
  });

  it('uses only the final twelve canonical messages without creating summary memory', async () => {
    const sessionId = 'kfc:middleware-history-audit';
    const customerId = 'middleware-history-audit';
    const store = new MemoryStore();
    let currentUserTurnId = '';
    for (let index = 0; index < 15; index += 1) {
      const role = index % 2 === 0 ? 'user' : 'assistant';
      const turn = await store.appendTurn({
        sessionId,
        channel: 'kfc',
        role,
        text: `canonical-turn-${String(index)}`,
        externalMessageId: role === 'user' ? `message-${String(index)}` : null,
        externalUserId: customerId,
        deliveryStatus: role === 'user' ? 'received' : 'sent',
        metadata: null,
      });
      if (role === 'user') currentUserTurnId = turn.id;
    }
    const publication = {
      customerText: 'Mình có thể hỗ trợ bạn.',
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
    const capturedMessages: BaseMessage[][] = [];
    const model = new AuditModel({
      calls: 0,
      steps: [new AIMessage(JSON.stringify(publication))],
      capturedMessages,
    });
    const state: AgentGraphState = {
      sessionId,
      customerId,
      channel: 'kfc',
      latestUserMessage: 'canonical-turn-14',
      userConfirmedOrder: false,
      escalationReasons: [],
      retrievedEvidence: [],
    };
    const pack = new KfcAgentPack({
      model,
      store,
      loadState: async () => state,
      executeTool: async () => {
        throw new Error('unexpected_tool_call');
      },
      resolveActiveToolNames: () => [],
    });

    await pack.runTurn({
      sessionId,
      customerId,
      channel: 'kfc',
      currentUserTurnId,
    });

    const canonicalMessages = (capturedMessages[0] ?? []).filter(
      (message) => message.getType() === 'human' || message.getType() === 'ai',
    );
    expect(canonicalMessages).toHaveLength(12);
    expect(canonicalMessages.map(({ content }) => content)).toEqual(
      Array.from(
        { length: 12 },
        (_, index) => `canonical-turn-${String(index + 3)}`,
      ),
    );
  });
});
