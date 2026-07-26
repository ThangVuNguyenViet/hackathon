import {
  RunContext,
  invokeFunctionTool,
  type OpenAIClient,
} from '@kfc/openai-agents-runtime';
import { describe, expect, it, vi } from 'vitest';
import {
  createKfcOpenAiAgentsTools,
  type KfcCanonicalTool,
  type KfcOpenAiAgentRunContext,
} from '../../src/agent/kfcOpenAiTools.js';
import { OpenAiKfcAgent } from '../../src/agent/openAiKfcAgent.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';

describe('KFC OpenAI Agents SDK tools', () => {
  it('rejects invalid canonical arguments before trusted SDK execution and records safe evidence', async () => {
    const executed = vi.fn(async () => ({ ok: true }));
    const canonicalTool: KfcCanonicalTool = {
      definition: {
        type: 'function',
        name: 'updateCart',
        description: 'Update the cart.',
        parameters: { type: 'object' },
        strict: true,
      },
      execute: executed,
    };
    const context = new RunContext<KfcOpenAiAgentRunContext>({
      toolCalls: [],
      developerMessages: [],
    });
    const [updateCart] = createKfcOpenAiAgentsTools([canonicalTool]);

    for (const input of [
      {},
      { changes: 'wrong_type' },
      { changes: [], RAW_SECRET: 'RAW_SECRET' },
    ]) {
      await expect(
        invokeFunctionTool({
          tool: updateCart!,
          runContext: context,
          input: JSON.stringify(input),
        }),
      ).resolves.toBeDefined();
    }

    expect(executed).not.toHaveBeenCalled();
    expect(context.context.toolCalls).toHaveLength(3);
    expect(JSON.stringify(context.context.toolCalls)).not.toContain(
      'RAW_SECRET',
    );
    expect(context.context.toolCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'updateCart',
          result: expect.objectContaining({ errorCode: 'invalid_tool_input' }),
        }),
      ]),
    );
  });

  it('keeps Runner-selected failed calls trace-visible without leaking errors', async () => {
    const rawSecret = 'RAW_SECRET';
    const failingTool: KfcCanonicalTool = {
      definition: {
        type: 'function',
        name: 'updateCart',
        description: 'Update the cart.',
        parameters: { type: 'object' },
        strict: true,
      },
      execute: async () => {
        throw new Error(rawSecret);
      },
    };
    const context = new RunContext<KfcOpenAiAgentRunContext>({
      toolCalls: [],
      developerMessages: [],
    });
    const [updateCart] = createKfcOpenAiAgentsTools([failingTool]);

    const result = await invokeFunctionTool({
      tool: updateCart!,
      runContext: context,
      input: JSON.stringify({
        changes: [{ itemCode: '20751', quantity: 1, modifiers: [] }],
      }),
    });

    expect(JSON.stringify(result)).not.toContain(rawSecret);
    expect(JSON.stringify(context.context.toolCalls)).not.toContain(rawSecret);
    expect(context.context.toolCalls).toEqual([
      expect.objectContaining({
        name: 'updateCart',
        result: expect.objectContaining({ errorCode: 'tool_execution_failed' }),
      }),
    ]);
  });

  it('records a safe timeout result for a Runner-selected action', async () => {
    const rawSecret = 'RAW_SECRET';
    const authoritativeState = { completed: false };
    const slowTool: KfcCanonicalTool = {
      definition: {
        type: 'function',
        name: 'updateCart',
        description: 'Update the cart.',
        parameters: { type: 'object' },
        strict: true,
      },
      execute: async (_arguments, options) => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        if (options?.signal.aborted) return { ok: false, cancelled: true };
        authoritativeState.completed = true;
        return { rawSecret, ok: true };
      },
    };
    const context = new RunContext<KfcOpenAiAgentRunContext>({
      toolCalls: [],
      developerMessages: [],
    });
    const [updateCart] = createKfcOpenAiAgentsTools([slowTool], {
      timeoutMs: 1,
    });

    const result = await invokeFunctionTool({
      tool: updateCart!,
      runContext: context,
      input: JSON.stringify({
        changes: [{ itemCode: '20751', quantity: 1, modifiers: [] }],
      }),
    });

    expect(JSON.stringify(result)).not.toContain(rawSecret);
    expect(JSON.stringify(context.context.toolCalls)).not.toContain(rawSecret);
    expect(context.context.toolCalls).toEqual([
      expect.objectContaining({
        name: 'updateCart',
        result: expect.objectContaining({ errorCode: 'tool_timed_out' }),
      }),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 70));
    expect(context.context.toolCalls).toHaveLength(1);
    expect(context.context.toolCalls[0]?.result).toMatchObject({
      errorCode: 'tool_timed_out',
    });
    expect(authoritativeState).toEqual({ completed: false });
  });

  it('lets an irreversible provider action finish instead of reporting a false timeout', async () => {
    const effect = vi.fn();
    const placeOrder: KfcCanonicalTool = {
      definition: {
        type: 'function',
        name: 'placeOrder',
        description: 'Place order.',
        parameters: { type: 'object' },
        strict: true,
      },
      execute: async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        effect();
        return { toolName: 'placeOrder', ok: true, value: { id: 'order_1' } };
      },
    };
    const context = new RunContext<KfcOpenAiAgentRunContext>({
      toolCalls: [],
      developerMessages: [],
    });
    const [sdkTool] = createKfcOpenAiAgentsTools([placeOrder], {
      timeoutMs: 1,
    });
    const result = await invokeFunctionTool({
      tool: sdkTool!,
      runContext: context,
      input: '{}',
    });
    expect(result).toMatchObject({ toolName: 'placeOrder', ok: true });
    expect(effect).toHaveBeenCalledTimes(1);
    expect(context.context.toolCalls).toEqual([
      expect.objectContaining({
        name: 'placeOrder',
        result: expect.objectContaining({ ok: true }),
      }),
    ]);
  });

  it('normalizes repeated local-deadline cancellation results to safe timeouts', async () => {
    const read: KfcCanonicalTool = {
      definition: {
        type: 'function',
        name: 'searchMenu',
        description: 'Read.',
        parameters: { type: 'object' },
        strict: true,
      },
      execute: async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return { ok: false, errorCode: 'agent_tool_execution_cancelled' };
      },
    };
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const context = new RunContext<KfcOpenAiAgentRunContext>({
        toolCalls: [],
        developerMessages: [],
      });
      const [tool] = createKfcOpenAiAgentsTools([read], { timeoutMs: 1 });
      const result = await invokeFunctionTool({
        tool: tool!,
        runContext: context,
        input: '{"query":"gà"}',
      });
      expect(result).toMatchObject({ errorCode: 'tool_timed_out' });
      expect(context.context.toolCalls).toHaveLength(1);
    }
  });

  it('runs a trusted KFC action through the SDK with per-turn evidence', async () => {
    const executed: Array<Record<string, unknown>> = [];
    const canonicalTool: KfcCanonicalTool = {
      definition: {
        type: 'function',
        name: 'updateCart',
        description: 'Update the verified KFC cart.',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
          additionalProperties: false,
        },
        strict: true,
      },
      execute: async (arguments_) => {
        executed.push(arguments_);
        return {
          toolName: 'updateCart',
          ok: true,
          value: { items: [{ code: '20751', name: 'Combo Hợp Gu 99K' }] },
        };
      },
    };
    const context = new RunContext<KfcOpenAiAgentRunContext>({
      toolCalls: [],
      developerMessages: [],
    });
    const [updateCart] = createKfcOpenAiAgentsTools([canonicalTool]);

    const result = await invokeFunctionTool({
      tool: updateCart!,
      runContext: context,
      input: JSON.stringify({
        changes: [{ itemCode: '20751', quantity: 1, modifiers: [] }],
      }),
    });

    expect(executed).toEqual([
      { changes: [{ itemCode: '20751', quantity: 1, modifiers: [] }] },
    ]);
    expect(result).toMatchObject({
      toolName: 'updateCart',
      ok: true,
    });
    expect(context.context.toolCalls).toEqual([
      expect.objectContaining({
        name: 'updateCart',
        arguments: {
          changes: [{ itemCode: '20751', quantity: 1, modifiers: [] }],
        },
      }),
    ]);
  });

  it('returns an SDK Runner result without manually assembling model outputs', async () => {
    const agent = new OpenAiKfcAgent({
      client: {
        responses: {
          create: async () => ({
            id: 'resp_1',
            object: 'response',
            created_at: 0,
            model: 'gpt-4.1-mini',
            output: [
              {
                id: 'msg_1',
                type: 'message',
                role: 'assistant',
                status: 'completed',
                content: [{ type: 'output_text', text: 'Mình sẽ hỗ trợ bạn.' }],
              },
            ],
            output_text: 'Mình sẽ hỗ trợ bạn.',
            usage: { input_tokens: 3, output_tokens: 5, total_tokens: 8 },
          }),
        },
      } as unknown as OpenAIClient,
      model: 'gpt-4.1-mini',
    });

    const result = await agent.respond({
      sessionId: 'kfc:sdk_runner',
      customerId: 'sdk_runner',
      channel: 'kfc',
      text: 'Xin chào',
      externalMessageId: 'sdk_runner_1',
      metadata: null,
      store: new MemoryStore(),
      tools: [],
    });

    expect(result).toMatchObject({
      responseText: 'Mình sẽ hỗ trợ bạn.',
      usage: { inputTokens: 3, outputTokens: 5, totalTokens: 8 },
      toolCalls: [],
    });
  });
});
