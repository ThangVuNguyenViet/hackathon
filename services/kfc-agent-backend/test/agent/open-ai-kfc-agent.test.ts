import { describe, expect, it, vi } from 'vitest';
import {
  OpenAiKfcAgent,
} from '../../src/agent/openAiKfcAgent.js';
import { type FunctionTool, type OpenAIClient } from '@kfc/openai-agents-runtime';
import {
  createKfcOpenAiAgentsTools,
  type KfcCanonicalTool,
  type KfcOpenAiAgentRunContext,
} from '../../src/agent/kfcOpenAiTools.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import type { ToolName } from '../../src/ordering/types.js';

function assistantMessage(text: string, usage = { input_tokens: 4, output_tokens: 6, total_tokens: 10 }) {
  return {
    id: crypto.randomUUID(),
    object: 'response',
    created_at: 0,
    model: 'gpt-4.1-mini',
    output: [{
      id: crypto.randomUUID(),
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text }],
    }],
    output_text: text,
    usage,
  };
}

function functionCall(name: string, arguments_: Record<string, unknown>) {
  return {
    id: crypto.randomUUID(),
    object: 'response',
    created_at: 0,
    model: 'gpt-4.1-mini',
    output: [{
      id: crypto.randomUUID(),
      type: 'function_call',
      call_id: crypto.randomUUID(),
      name,
      arguments: JSON.stringify(arguments_),
    }],
    output_text: '',
    usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 },
  };
}

function sequencedClient(
  responses: unknown[],
  requests: Array<Record<string, unknown>> = [],
): OpenAIClient {
  return {
    responses: {
      create: async (request: Record<string, unknown>) => {
        requests.push(structuredClone(request));
        const response = responses.shift();
        if (!response) throw new Error('Unexpected additional SDK model request');
        return response;
      },
    },
  } as unknown as OpenAIClient;
}

function canonicalTool(input: {
  name: ToolName;
  execute: (arguments_: Record<string, unknown>) => Promise<unknown>;
}): FunctionTool<KfcOpenAiAgentRunContext> {
  const canonical: KfcCanonicalTool = {
    definition: {
      type: 'function',
      name: input.name,
      description: `Run ${input.name}.`,
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
        additionalProperties: false,
      },
      strict: true,
    },
    execute: input.execute,
  };
  return createKfcOpenAiAgentsTools([canonical])[0]!;
}

function createTurn(input: Partial<Parameters<OpenAiKfcAgent['respond']>[0]> = {}) {
  return {
    sessionId: 'kfc:runner_test',
    customerId: 'runner_test',
    channel: 'kfc' as const,
    text: 'Tìm combo',
    externalMessageId: crypto.randomUUID(),
    metadata: null,
    store: new MemoryStore(),
    tools: [],
    ...input,
  };
}

describe('OpenAiKfcAgent SDK Runner', () => {
  it('continues from an SDK function result to a customer response', async () => {
    const executed: Array<Record<string, unknown>> = [];
    const agent = new OpenAiKfcAgent({
      client: sequencedClient([
        functionCall('searchMenu', { query: 'combo' }),
        assistantMessage('Mình tìm thấy Combo Hợp Gu 99K.'),
      ]),
      model: 'gpt-4.1-mini',
    });

    const result = await agent.respond(createTurn({
      tools: [canonicalTool({
        name: 'searchMenu',
        execute: async (arguments_) => {
          executed.push(arguments_);
          return { toolName: 'searchMenu', ok: true, value: { total: 1 } };
        },
      })],
    }));

    expect(executed).toEqual([{ query: 'combo', mode: 'search' }]);
    expect(result).toMatchObject({
      responseText: 'Mình tìm thấy Combo Hợp Gu 99K.',
      toolCalls: [
        { name: 'searchMenu', arguments: { query: 'combo' } },
      ],
      usage: { inputTokens: 8, outputTokens: 8, totalTokens: 16 },
    });
  });

  it('uses invokeFunctionTool for a trusted action before the model replies', async () => {
    const executed: Array<Record<string, unknown>> = [];
    const requests: Array<Record<string, unknown>> = [];
    const agent = new OpenAiKfcAgent({
      client: sequencedClient([assistantMessage('Đã cập nhật giỏ hàng.')], requests),
      model: 'gpt-4.1-mini',
    });

    const result = await agent.respond(createTurn({
      tools: [canonicalTool({
        name: 'updateCart',
        execute: async (arguments_) => {
          executed.push(arguments_);
          return { toolName: 'updateCart', ok: true, value: { items: [] } };
        },
      })],
      requiredToolCalls: [{
        name: 'updateCart',
        arguments: {
          changes: [{
            itemCode: '20751',
            orderedMenuItemQuantity: 1,
            modifiers: null,
          }],
        },
      }],
      allowModelToolCalls: false,
    }));

    expect(executed).toEqual([{
      changes: [{
        itemCode: '20751',
        orderedMenuItemQuantity: 1,
        modifiers: null,
      }],
    }]);
    expect(result.toolCalls).toHaveLength(1);
    expect(requests[0]?.tools).toEqual([]);
    expect(requests[0]?.instructions).toContain('Verified trusted KFC action result');
  });

  it('keeps verified business state in SDK instructions instead of a second transcript item', async () => {
    const requests: Array<Record<string, unknown>> = [];
    const store = new MemoryStore();
    const agent = new OpenAiKfcAgent({
      client: sequencedClient([assistantMessage('Mình đã thấy giỏ hàng của bạn.')], requests),
      model: 'gpt-4.1-mini',
    });

    await agent.respond(createTurn({
      store,
      verifiedBusinessContext: {
        cart: { items: [{ itemCode: '20706', name: 'Combo Gà No 279k', quantity: 1 }] },
      },
    }));

    expect(requests[0]?.instructions).toContain('reuse these exact identifiers');
    expect(requests[0]?.input).toEqual([
      expect.objectContaining({
        role: 'user',
        content: [{ type: 'input_text', text: 'Tìm combo' }],
      }),
    ]);
    expect((await store.listTurns('kfc:runner_test')).map((turn) => turn.role)).toEqual([
      'user',
      'assistant',
    ]);
  });

  it('sanitizes verified identifiers before persisting the customer response', async () => {
    const store = new MemoryStore();
    const agent = new OpenAiKfcAgent({
      client: sequencedClient([assistantMessage('Đã thêm 20751 với mã 558900.')]),
      model: 'gpt-4.1-mini',
    });

    const result = await agent.respond(createTurn({
      store,
      verifiedBusinessContext: {
        cart: {
          items: [{ itemCode: '20751', name: 'Combo Hợp Gu 99K' }],
          modifierGroups: [{ groupId: 'group_7', name: 'Chọn sốt', options: [{ modifierId: '558900', name: 'Sốt Cay' }] }],
        },
      },
    }));

    expect(result.responseText).toBe('Đã thêm Combo Hợp Gu 99K với mã Sốt Cay.');
    expect((await store.listTurns('kfc:runner_test')).at(-1)?.text).toBe(result.responseText);
  });

  it('preserves quantities while removing structural labels and replacing item identifiers', async () => {
    const agent = new OpenAiKfcAgent({
      client: sequencedClient([assistantMessage('Giỏ có 2 phần 20751, giá 258000đ; Drink 1 Pepsi Tiêu Chuẩn và Side main khoai tây.')]),
      model: 'gpt-4.1-mini',
    });
    const result = await agent.respond(createTurn({ verifiedBusinessContext: {
      cart: { items: [{ itemCode: '20751', name: 'Combo Hợp Gu 99K', modifierGroups: [
        { groupId: '1', name: 'Drink 1', options: [] }, { groupId: '2', name: 'Side main', options: [] },
      ] }] },
    } }));
    expect(result.responseText).toBe('Giỏ có 2 phần Combo Hợp Gu 99K, giá 258000đ; Pepsi Tiêu Chuẩn và khoai tây.');
  });

  it('keeps a numeric identifier unchanged at a currency boundary', async () => {
    const agent = new OpenAiKfcAgent({
      client: sequencedClient([assistantMessage('Mã 258000 có giá 258000 VND.')]), model: 'gpt-4.1-mini',
    });
    const result = await agent.respond(createTurn({ verifiedBusinessContext: {
      item: { itemCode: '258000', name: 'Combo Được Xác Minh', priceVnd: 258000 },
    } }));
    expect(result.responseText).toBe('Mã Combo Được Xác Minh có giá 258000 VND.');
  });

  it('replaces a verified commune code before persistence', async () => {
    const agent = new OpenAiKfcAgent({
      client: sequencedClient([assistantMessage('Mình đã ghi nhận 27004.')]), model: 'gpt-4.1-mini',
    });
    const result = await agent.respond(createTurn({ verifiedBusinessContext: {
      deliveryAddressDraft: { communeCode: '27004', communeName: 'Phường Tân Bình' },
    } }));
    expect(result.responseText).toBe('Mình đã ghi nhận Phường Tân Bình.');
  });

  it('uses durable conversation history as the SDK model input', async () => {
    const store = new MemoryStore();
    await store.appendTurn({
      sessionId: 'kfc:history_sdk', channel: 'kfc', role: 'user', text: 'Xin chào',
      externalMessageId: 'history_1', externalUserId: 'history_sdk', deliveryStatus: 'received', metadata: null,
    });
    await store.appendTurn({
      sessionId: 'kfc:history_sdk', channel: 'kfc', role: 'assistant', text: 'Chào bạn!',
      externalMessageId: null, externalUserId: 'history_sdk', deliveryStatus: 'sent', metadata: null,
    });
    const requests: Array<Record<string, unknown>> = [];
    const agent = new OpenAiKfcAgent({
      client: sequencedClient([assistantMessage('Mình có thể giúp bạn chọn món.')], requests),
      model: 'gpt-4.1-mini',
    });

    await agent.respond(createTurn({
      sessionId: 'kfc:history_sdk', customerId: 'history_sdk', externalMessageId: 'history_2',
      text: 'Tư vấn món cho 4 người', store,
    }));

    expect(requests[0]?.input).toEqual([
      expect.objectContaining({
        role: 'user', content: [{ type: 'input_text', text: 'Xin chào' }],
      }),
      expect.objectContaining({
        role: 'assistant', content: [expect.objectContaining({ type: 'output_text', text: 'Chào bạn!' })],
      }),
      expect.objectContaining({
        role: 'user', content: [{ type: 'input_text', text: 'Tư vấn món cho 4 người' }],
      }),
    ]);
  });

  it('does not retry a failed cart mutation without a fresh model tool call', async () => {
    const executed = vi.fn(async () => ({
      ok: false, errorCode: 'provider_failed', message: 'Unknown execution outcome',
    }));
    const requests: Array<Record<string, unknown>> = [];
    const agent = new OpenAiKfcAgent({
      client: sequencedClient([
        functionCall('updateCart', {
          changes: [{ itemCode: '20751', orderedMenuItemQuantity: 1, modifiers: null }],
        }),
        assistantMessage('Mình chưa thể cập nhật giỏ hàng.'),
      ], requests),
      model: 'gpt-4.1-mini',
    });

    const result = await agent.respond(createTurn({
      tools: [canonicalTool({ name: 'updateCart', execute: executed })],
    }));

    expect(executed).toHaveBeenCalledTimes(1);
    expect(requests).toHaveLength(2);
    expect(result.toolCalls).toEqual([
      expect.objectContaining({ name: 'updateCart', result: expect.objectContaining({ errorCode: 'provider_failed' }) }),
    ]);
  });

  it('continues a confirmed payment through the SDK tool chain in one turn', async () => {
    const requestedTools: string[] = [];
    const methodId = 'provider_method_from_list_result';
    const agent = new OpenAiKfcAgent({
      client: sequencedClient([
        functionCall('listPaymentMethods', { query: 'Momo' }),
        functionCall('previewOrder', {}),
        functionCall('placeOrder', {}),
        functionCall('createPaymentLink', { methodId }),
        assistantMessage('Đơn đã được tạo và liên kết thanh toán đã sẵn sàng.'),
      ]),
      model: 'gpt-4.1-mini',
    });
    const makeTool = (name: ToolName) => canonicalTool({
      name,
      execute: async () => {
        requestedTools.push(name);
        return { ok: true, value: { methodId, status: 'pending' } };
      },
    });

    const result = await agent.respond(createTurn({
      text: 'Đúng rồi, đặt đơn và gửi liên kết thanh toán Momo.',
      tools: [
        makeTool('listPaymentMethods'), makeTool('previewOrder'),
        makeTool('placeOrder'), makeTool('createPaymentLink'),
      ],
    }));

    expect(requestedTools).toEqual([
      'listPaymentMethods', 'previewOrder', 'placeOrder', 'createPaymentLink',
    ]);
    expect(result.toolCalls.at(-1)).toMatchObject({
      name: 'createPaymentLink', arguments: { methodId },
    });
  });

  it('presents a successful handoff as the verified receipt, not a model timing promise', async () => {
    const agent = new OpenAiKfcAgent({
      client: sequencedClient([
        functionCall('handoff', { reasons: ['Đơn số lượng lớn'] }),
        assistantMessage('Mình đã chuyển cho nhân viên và họ sẽ phản hồi bạn ngay.'),
      ]),
      model: 'gpt-4.1-mini',
    });

    const result = await agent.respond(createTurn({
      tools: [canonicalTool({
        name: 'handoff',
        execute: async () => ({
          toolName: 'handoff', ok: true, value: { escalationId: 'esc_internal_1' },
        }),
      })],
    }));

    expect(result.responseText).toBe(
      'Yêu cầu gặp nhân viên của bạn đã được ghi nhận và đang chờ nhân viên tiếp nhận. Hiện chưa có thời gian phản hồi được xác minh.',
    );
  });
});
