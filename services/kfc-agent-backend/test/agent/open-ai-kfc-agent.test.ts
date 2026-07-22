import { describe, expect, it } from 'vitest';
import {
  OpenAiKfcAgent,
  runResponsesToolLoop,
} from '../../src/agent/openAiKfcAgent.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';

describe('runResponsesToolLoop', () => {
  it('keeps message history and returns tool output to the model until it answers', async () => {
    const requests: Array<Record<string, unknown>> = [];
    const responses = [
      {
        output: [
          {
            type: 'function_call',
            id: 'fc_1',
            call_id: 'call_1',
            name: 'searchMenu',
            arguments: '{"query":"combo cho 4 người"}',
          },
        ],
        output_text: '',
        usage: { input_tokens: 20, output_tokens: 5, total_tokens: 25 },
      },
      {
        output: [
          {
            type: 'message',
            id: 'msg_1',
            role: 'assistant',
            status: 'completed',
            content: [],
          },
        ],
        output_text: 'Mình tìm thấy một combo phù hợp.',
        usage: { input_tokens: 30, output_tokens: 10, total_tokens: 40 },
      },
    ];
    const execute = async (arguments_: Record<string, unknown>) => ({
      ok: true,
      query: arguments_.query,
    });

    const result = await runResponsesToolLoop({
      client: {
        responses: {
          create: async (request: Record<string, unknown>) => {
            requests.push(structuredClone(request));
            return responses.shift();
          },
        },
      },
      model: 'gpt-4.1-mini',
      instructions: 'Bạn là trợ lý KFC.',
      input: [
        { role: 'user', content: 'Xin chào' },
        { role: 'assistant', content: 'Chào bạn!' },
        { role: 'user', content: 'Gợi ý combo cho 4 người' },
      ],
      tools: [
        {
          definition: {
            type: 'function',
            name: 'searchMenu',
            description: 'Search the KFC menu.',
            parameters: {
              type: 'object',
              properties: { query: { type: 'string' } },
              required: ['query'],
              additionalProperties: false,
            },
            strict: true,
          },
          execute,
        },
      ],
      maxToolRounds: 12,
    });

    expect(requests).toHaveLength(2);
    expect(requests[0]?.input).toEqual([
      { role: 'user', content: 'Xin chào' },
      { role: 'assistant', content: 'Chào bạn!' },
      { role: 'user', content: 'Gợi ý combo cho 4 người' },
    ]);
    expect(requests[1]?.input).toEqual([
      { role: 'user', content: 'Xin chào' },
      { role: 'assistant', content: 'Chào bạn!' },
      { role: 'user', content: 'Gợi ý combo cho 4 người' },
      {
        type: 'function_call',
        id: 'fc_1',
        call_id: 'call_1',
        name: 'searchMenu',
        arguments: '{"query":"combo cho 4 người"}',
      },
      {
        type: 'function_call_output',
        call_id: 'call_1',
        output: '{"ok":true,"query":"combo cho 4 người"}',
      },
    ]);
    expect(result.responseText).toBe('Mình tìm thấy một combo phù hợp.');
    expect(result.toolCalls).toEqual([
      {
        name: 'searchMenu',
        arguments: { query: 'combo cho 4 người' },
        result: { ok: true, query: 'combo cho 4 người' },
      },
    ]);
    expect(result.usage).toEqual({ inputTokens: 50, outputTokens: 15, totalTokens: 65 });
  });
});

describe('OpenAiKfcAgent', () => {
  it('uses the existing conversation store as the model context', async () => {
    const store = new MemoryStore();
    await store.appendTurn({
      sessionId: 'kfc:customer_1',
      channel: 'kfc',
      role: 'user',
      text: 'Xin chào',
      externalMessageId: 'message_1',
      externalUserId: 'customer_1',
      deliveryStatus: 'received',
      metadata: null,
    });
    await store.appendTurn({
      sessionId: 'kfc:customer_1',
      channel: 'kfc',
      role: 'assistant',
      text: 'Chào bạn!',
      externalMessageId: null,
      externalUserId: 'customer_1',
      deliveryStatus: 'sent',
      metadata: null,
    });
    const requests: Array<Record<string, unknown>> = [];
    const agent = new OpenAiKfcAgent({
      client: {
        responses: {
          create: async (request: Record<string, unknown>) => {
            requests.push(structuredClone(request));
            return {
              output: [],
              output_text: 'Mình có thể giúp bạn chọn món.',
              usage: { input_tokens: 12, output_tokens: 8, total_tokens: 20 },
            };
          },
        },
      },
      model: 'gpt-4.1-mini',
    });

    const result = await agent.respond({
      sessionId: 'kfc:customer_1',
      customerId: 'customer_1',
      channel: 'kfc',
      text: 'Tư vấn món cho 4 người',
      externalMessageId: 'message_2',
      metadata: null,
      store,
      tools: [],
    });

    expect(requests[0]?.input).toEqual([
      { role: 'user', content: 'Xin chào' },
      { role: 'assistant', content: 'Chào bạn!' },
      { role: 'user', content: 'Tư vấn món cho 4 người' },
    ]);
    expect(result.responseText).toBe('Mình có thể giúp bạn chọn món.');
    expect((await store.listTurns('kfc:customer_1')).map(({ role, text }) => ({ role, text }))).toEqual([
      { role: 'user', text: 'Xin chào' },
      { role: 'assistant', text: 'Chào bạn!' },
      { role: 'user', text: 'Tư vấn món cho 4 người' },
      { role: 'assistant', text: 'Mình có thể giúp bạn chọn món.' },
    ]);
  });

  it('adds verified fixture business state without creating a second transcript', async () => {
    const store = new MemoryStore();
    const requests: Array<Record<string, unknown>> = [];
    const agent = new OpenAiKfcAgent({
      client: {
        responses: {
          create: async (request: Record<string, unknown>) => {
            requests.push(structuredClone(request));
            return { output: [], output_text: 'Mình tiếp tục với đúng combo trong giỏ.' };
          },
        },
      },
      model: 'gpt-4.1-mini',
    });

    await agent.respond({
      sessionId: 'kfc:customer_state',
      customerId: 'customer_state',
      channel: 'kfc',
      text: 'Đặt tiếp đơn này.',
      externalMessageId: 'state_message_1',
      metadata: null,
      store,
      tools: [],
      verifiedBusinessContext: {
        cart: { items: [{ itemCode: '20706', name: 'Combo Gà No 279k', quantity: 1 }] },
      },
    });

    expect(requests[0]?.input).toEqual([
      { role: 'user', content: 'Đặt tiếp đơn này.' },
      {
        role: 'developer',
        content: 'Verified current fixture business state; reuse these exact identifiers: {"cart":{"items":[{"itemCode":"20706","name":"Combo Gà No 279k","quantity":1}]}}',
      },
    ]);
    expect(requests[0]?.instructions).toContain('không tự tạo mã');
    expect(requests[0]?.instructions).toContain('không hỏi xác nhận lần nữa');
    expect((await store.listTurns('kfc:customer_state')).map((turn) => turn.role)).toEqual([
      'user',
      'assistant',
    ]);
  });
});
