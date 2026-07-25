import { describe, expect, it } from 'vitest';
import {
  OpenAiKfcAgent,
  runResponsesToolLoop,
} from '../../src/agent/openAiKfcAgent.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';

describe('runResponsesToolLoop', () => {
  it('allows the model to request independent tools in one response', async () => {
    const requests: Array<Record<string, unknown>> = [];
    const executions: string[] = [];
    const responses = [
      {
        output: [
          {
            type: 'function_call',
            call_id: 'call_menu',
            name: 'searchMenu',
            arguments: '{"query":"combo"}',
          },
          {
            type: 'function_call',
            call_id: 'call_cart',
            name: 'getCart',
            arguments: '{}',
          },
        ],
        output_text: '',
      },
      {
        output: [],
        output_text: 'Mình đã kiểm tra thực đơn và giỏ hàng.',
      },
    ];
    const tool = (name: string) => ({
      definition: {
        type: 'function' as const,
        name,
        description: name,
        parameters: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        strict: true,
      },
      execute: async () => {
        executions.push(name);
        return { toolName: name, ok: true, value: {} };
      },
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
      instructions: 'Use tools when useful.',
      input: [{ role: 'user', content: 'Kiểm tra giúp mình.' }],
      tools: [tool('searchMenu'), tool('getCart')],
      maxToolRounds: 4,
    });

    expect(requests[0]?.parallel_tool_calls).toBe(true);
    expect(executions).toEqual(['searchMenu', 'getCart']);
    expect(requests[1]?.input).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'function_call_output',
          call_id: 'call_menu',
        }),
        expect.objectContaining({
          type: 'function_call_output',
          call_id: 'call_cart',
        }),
      ]),
    );
    expect(result.responseText).toBe('Mình đã kiểm tra thực đơn và giỏ hàng.');
  });

  it('forces a corrected tool call after an empty retriable read result', async () => {
    const requests: Array<Record<string, unknown>> = [];
    const executedArguments: Array<Record<string, unknown>> = [];
    const responses = [
      {
        output: [
          {
            type: 'function_call',
            call_id: 'call_empty',
            name: 'searchMenu',
            arguments: '{"query":"nước trong combo"}',
          },
        ],
        output_text: '',
      },
      {
        output: [
          {
            type: 'function_call',
            call_id: 'call_broader',
            name: 'searchMenu',
            arguments: '{"query":"","category":"Thức Uống"}',
          },
        ],
        output_text: '',
      },
      {
        output: [],
        output_text: 'Mình tìm thấy các món nước bán riêng.',
      },
    ];

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
      input: [{ role: 'user', content: 'Thêm giúp mình một món nước.' }],
      tools: [
        {
          definition: {
            type: 'function',
            name: 'searchMenu',
            description: 'Search the KFC menu.',
            parameters: {
              type: 'object',
              properties: {
                query: { type: 'string' },
                category: { type: 'string' },
              },
              additionalProperties: false,
            },
            strict: true,
          },
          retryPolicy: {
            maxAttempts: 3,
            retryOn: [
              'empty_result',
              'tool_error',
              'invalid_arguments',
              'invalid_result',
            ],
          },
          execute: async (arguments_: Record<string, unknown>) => {
            executedArguments.push(arguments_);
            return executedArguments.length === 1
              ? {
                  toolName: 'searchMenu',
                  ok: true,
                  value: {
                    mode: 'search',
                    query: 'nước trong combo',
                    total: 0,
                    items: [],
                  },
                }
              : {
                  toolName: 'searchMenu',
                  ok: true,
                  value: {
                    mode: 'search',
                    query: '',
                    total: 1,
                    items: [{ code: 'DRINK', name: 'Pepsi' }],
                  },
                };
          },
        },
      ],
      maxToolRounds: 12,
    });

    expect(executedArguments).toEqual([
      { query: 'nước trong combo' },
      { query: '', category: 'Thức Uống' },
    ]);
    expect(requests.map((request) => request.tool_choice)).toEqual([
      'auto',
      'required',
      'auto',
    ]);
    expect(requests[1]?.input).toContainEqual(
      expect.objectContaining({
        type: 'function_call_output',
        call_id: 'call_empty',
        output: expect.stringContaining('"reason":"empty_result"'),
      }),
    );
    expect(requests[1]?.input).toContainEqual(
      expect.objectContaining({
        output: expect.stringContaining(
          '"instruction":"You must make another corrected read call before answering the customer',
        ),
      }),
    );
    expect(requests[1]?.input).toContainEqual(
      expect.objectContaining({
        output: expect.stringContaining(
          'Search requested standalone drinks, sides, or other add-ons independently',
        ),
      }),
    );
    expect(requests[1]?.input).toContainEqual(
      expect.objectContaining({
        output: expect.stringContaining(
          'An empty constrained result does not prove that the requested product is absent',
        ),
      }),
    );
    expect(requests[1]?.input).toContainEqual(
      expect.objectContaining({
        output: expect.stringContaining(
          'use category with an empty query for category-wide retrieval',
        ),
      }),
    );
    expect(requests[1]?.input).toContainEqual(
      expect.objectContaining({
        output: expect.stringContaining(
          'do not answer from an unconstrained product result as though the modifier requirement matched',
        ),
      }),
    );
    expect(result.responseText).toBe('Mình tìm thấy các món nước bán riêng.');
  });

  it('stops semantic recovery after three total failed attempts', async () => {
    const requests: Array<Record<string, unknown>> = [];
    let executionCount = 0;
    const responses = [
      {
        output: [
          {
            type: 'function_call',
            call_id: 'call_1',
            name: 'searchMenu',
            arguments: '{"query":"a"}',
          },
        ],
        output_text: '',
      },
      {
        output: [
          {
            type: 'function_call',
            call_id: 'call_2',
            name: 'searchMenu',
            arguments: '{"query":"b"}',
          },
        ],
        output_text: '',
      },
      {
        output: [
          {
            type: 'function_call',
            call_id: 'call_3',
            name: 'searchMenu',
            arguments: '{"query":"","category":"Thức Uống"}',
          },
        ],
        output_text: '',
      },
      {
        output: [],
        output_text: 'Mình chưa tìm được món phù hợp sau khi thử lại.',
      },
    ];

    await runResponsesToolLoop({
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
      input: [{ role: 'user', content: 'Tìm món nước.' }],
      tools: [
        {
          definition: {
            type: 'function',
            name: 'searchMenu',
            description: 'Search the KFC menu.',
            parameters: { type: 'object', properties: {} },
            strict: false,
          },
          retryPolicy: {
            maxAttempts: 3,
            retryOn: ['empty_result'],
          },
          execute: async () => {
            executionCount += 1;
            return { ok: true, value: { total: 0, items: [] } };
          },
        },
      ],
      maxToolRounds: 12,
    });

    expect(executionCount).toBe(3);
    expect(requests.map((request) => request.tool_choice)).toEqual([
      'auto',
      'required',
      'required',
      'none',
    ]);
    expect(requests[3]?.input).toContainEqual(
      expect.objectContaining({
        type: 'function_call_output',
        call_id: 'call_3',
        output: expect.stringContaining('"exhausted":true'),
      }),
    );
  });

  it('lets the model repair invalid JSON without executing the rejected call', async () => {
    const requests: Array<Record<string, unknown>> = [];
    let executionCount = 0;
    const responses = [
      {
        output: [
          {
            type: 'function_call',
            call_id: 'call_invalid',
            name: 'searchMenu',
            arguments: '{"query":',
          },
        ],
        output_text: '',
      },
      {
        output: [
          {
            type: 'function_call',
            call_id: 'call_valid',
            name: 'searchMenu',
            arguments: '{"query":"gà"}',
          },
        ],
        output_text: '',
      },
      { output: [], output_text: 'Mình tìm thấy món gà.' },
    ];

    await runResponsesToolLoop({
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
      input: [{ role: 'user', content: 'Tìm món gà.' }],
      tools: [
        {
          definition: {
            type: 'function',
            name: 'searchMenu',
            description: 'Search the KFC menu.',
            parameters: { type: 'object', properties: {} },
            strict: false,
          },
          retryPolicy: {
            maxAttempts: 3,
            retryOn: ['invalid_arguments'],
          },
          execute: async () => {
            executionCount += 1;
            return { ok: true, value: { total: 1, items: [{}] } };
          },
        },
      ],
      maxToolRounds: 12,
    });

    expect(executionCount).toBe(1);
    expect(requests.map((request) => request.tool_choice)).toEqual([
      'auto',
      'required',
      'auto',
    ]);
    expect(requests[1]?.input).toContainEqual(
      expect.objectContaining({
        output: expect.stringContaining('"reason":"invalid_arguments"'),
      }),
    );
  });

  it('does not force a retry after a mutation execution error', async () => {
    const requests: Array<Record<string, unknown>> = [];
    const responses = [
      {
        output: [
          {
            type: 'function_call',
            call_id: 'call_update',
            name: 'updateCart',
            arguments: '{"changes":[]}',
          },
        ],
        output_text: '',
      },
      { output: [], output_text: 'Mình chưa thể cập nhật giỏ hàng.' },
    ];

    await runResponsesToolLoop({
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
      input: [{ role: 'user', content: 'Cập nhật giỏ.' }],
      tools: [
        {
          definition: {
            type: 'function',
            name: 'updateCart',
            description: 'Update the cart.',
            parameters: { type: 'object', properties: {} },
            strict: false,
          },
          retryPolicy: {
            maxAttempts: 3,
            retryOn: ['invalid_arguments'],
          },
          execute: async () => ({
            ok: false,
            errorCode: 'provider_failed',
            message: 'Unknown execution outcome',
          }),
        },
      ],
      maxToolRounds: 12,
    });

    expect(requests.map((request) => request.tool_choice)).toEqual([
      'auto',
      'auto',
    ]);
  });

  it('returns a read-tool execution error to the model and retries safely', async () => {
    const requests: Array<Record<string, unknown>> = [];
    let executionCount = 0;
    const responses = [
      {
        output: [
          {
            type: 'function_call',
            call_id: 'call_failed_read',
            name: 'getModifierOptions',
            arguments: '{"code":"ITEM"}',
          },
        ],
        output_text: '',
      },
      {
        output: [
          {
            type: 'function_call',
            call_id: 'call_repaired_read',
            name: 'getModifierOptions',
            arguments: '{"code":"CORRECT_ITEM"}',
          },
        ],
        output_text: '',
      },
      { output: [], output_text: 'Mình đã kiểm tra được lựa chọn.' },
    ];

    await runResponsesToolLoop({
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
      input: [{ role: 'user', content: 'Kiểm tra lựa chọn.' }],
      tools: [
        {
          definition: {
            type: 'function',
            name: 'getModifierOptions',
            description: 'Read modifier options.',
            parameters: { type: 'object', properties: {} },
            strict: false,
          },
          retryPolicy: {
            maxAttempts: 3,
            retryOn: ['tool_error'],
          },
          execute: async () => {
            executionCount += 1;
            if (executionCount === 1) throw new Error('fixture read failed');
            return { ok: true, value: { modifierGroups: [{}] } };
          },
        },
      ],
      maxToolRounds: 12,
    });

    expect(executionCount).toBe(2);
    expect(requests.map((request) => request.tool_choice)).toEqual([
      'auto',
      'required',
      'auto',
    ]);
    expect(requests[1]?.input).toContainEqual(
      expect.objectContaining({
        output: expect.stringContaining('"reason":"tool_error"'),
      }),
    );
  });

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
    expect(result.usage).toEqual({
      inputTokens: 50,
      outputTokens: 15,
      totalTokens: 65,
    });
  });

  it('continues a confirmed named payment through the full tool chain in one turn', async () => {
    const requestedTools: string[] = [];
    const methodId = 'provider_method_from_list_result';
    const responses = [
      {
        output: [
          {
            type: 'function_call',
            call_id: 'call_methods',
            name: 'listPaymentMethods',
            arguments: '{"query":"phương thức khách vừa xác nhận"}',
          },
        ],
        output_text: '',
      },
      {
        output: [
          {
            type: 'function_call',
            call_id: 'call_preview',
            name: 'previewOrder',
            arguments: '{}',
          },
        ],
        output_text: '',
      },
      {
        output: [
          {
            type: 'function_call',
            call_id: 'call_place',
            name: 'placeOrder',
            arguments: '{}',
          },
        ],
        output_text: '',
      },
      {
        output: [
          {
            type: 'function_call',
            call_id: 'call_payment',
            name: 'createPaymentLink',
            arguments: JSON.stringify({ methodId }),
          },
        ],
        output_text: '',
      },
      {
        output: [],
        output_text: 'Đơn đã được tạo và liên kết thanh toán đã sẵn sàng.',
      },
    ];
    const tool = (name: string, value: unknown) => ({
      definition: {
        type: 'function' as const,
        name,
        description: name,
        parameters: {
          type: 'object',
          properties: {},
          additionalProperties: true,
        },
        strict: false,
      },
      execute: async () => {
        requestedTools.push(name);
        return value;
      },
    });

    const result = await runResponsesToolLoop({
      client: {
        responses: {
          create: async () => responses.shift(),
        },
      },
      model: 'gpt-4.1-mini',
      instructions: 'Bạn là trợ lý KFC.',
      input: [
        {
          role: 'user',
          content:
            'Đúng rồi, đặt đơn và gửi mình liên kết thanh toán bằng phương thức đó.',
        },
      ],
      tools: [
        tool('listPaymentMethods', {
          items: [{ methodId, supported: true }],
        }),
        tool('previewOrder', { id: 'preview' }),
        tool('placeOrder', { id: 'order' }),
        tool('createPaymentLink', { status: 'pending' }),
      ],
      maxToolRounds: 12,
    });

    expect(requestedTools).toEqual([
      'listPaymentMethods',
      'previewOrder',
      'placeOrder',
      'createPaymentLink',
    ]);
    expect(result.toolCalls.at(-1)).toMatchObject({
      name: 'createPaymentLink',
      arguments: { methodId },
    });
  });
});

describe('OpenAiKfcAgent', () => {
  async function captureDefaultInstructions(): Promise<string> {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new OpenAiKfcAgent({
      client: {
        responses: {
          create: async (request: Record<string, unknown>) => {
            requests.push(structuredClone(request));
            return { output: [], output_text: 'Mình đang hỗ trợ bạn.' };
          },
        },
      },
      model: 'gpt-4.1-mini',
    });

    await agent.respond({
      sessionId: `kfc:prompt_${crypto.randomUUID()}`,
      customerId: 'prompt_customer',
      channel: 'kfc',
      text: 'Mình cần hỗ trợ.',
      externalMessageId: crypto.randomUUID(),
      metadata: null,
      store: new MemoryStore(),
      tools: [],
    });

    return String(requests[0]?.instructions);
  }

  it('uses a compact English global contract for Vietnamese customer replies', async () => {
    const instructions = await captureDefaultInstructions();

    expect(instructions).toContain('# Role');
    expect(instructions).toContain('# Grounding');
    expect(instructions).toContain('# Actions');
    expect(instructions).toContain('# Customer response');
    expect(instructions).toContain('natural Vietnamese');
    expect(instructions).toContain(
      'do not mention other types even as context or optional extras',
    );
    expect(instructions.length).toBeLessThan(5_000);
    expect(instructions).not.toMatch(
      /[ÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ]/u,
    );
  });

  it('provides the hosted Python tool for model-owned budget arithmetic', async () => {
    const requests: Array<Record<string, unknown>> = [];
    const agent = new OpenAiKfcAgent({
      client: {
        responses: {
          create: async (request: Record<string, unknown>) => {
            requests.push(structuredClone(request));
            return { output: [], output_text: 'Đã tính xong.' };
          },
        },
      },
      model: 'gpt-4.1-mini',
    });

    await agent.respond({
      sessionId: `kfc:python_${crypto.randomUUID()}`,
      customerId: 'python_customer',
      channel: 'messenger',
      text: 'Chọn món sát ngân sách giúp mình.',
      externalMessageId: crypto.randomUUID(),
      metadata: null,
      store: new MemoryStore(),
      tools: [],
    });

    expect(requests[0]?.tools).toContainEqual({
      type: 'code_interpreter',
      container: { type: 'auto' },
    });
    expect(requests[0]?.instructions).toContain(
      'Use the Python tool for nontrivial combination arithmetic',
    );
    expect(requests[0]?.instructions).toContain(
      'must use the Python tool before answering',
    );
    expect(requests[0]?.instructions).toContain(
      'Recalculate the complete proposed total',
    );
    expect(requests[0]?.instructions).toContain(
      'Do not publish a multi-item numeric recommendation until Python arithmetic verifies',
    );
    expect(requests[0]?.instructions).toContain(
      'continue selecting and recalculating',
    );
  });

  it('reviews a tool-grounded draft once before publishing it', async () => {
    const requests: Array<Record<string, unknown>> = [];
    const responses = [
      {
        output: [
          {
            type: 'function_call',
            call_id: 'call_drinks',
            name: 'searchMenu',
            arguments: '{"category":"Thức Uống","query":""}',
          },
        ],
        output_text: '',
      },
      {
        output: [],
        output_text: 'Burger Tôm là một món đồ uống.',
      },
      {
        output: [],
        output_text: 'Mình tìm thấy Pepsi và 7Up trong danh sách đồ uống.',
      },
    ];

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
      instructions: 'You are a KFC assistant.',
      input: [{ role: 'user', content: 'Cho mình xem đồ uống.' }],
      tools: [
        {
          definition: {
            type: 'function',
            name: 'searchMenu',
            description: 'Search the KFC menu.',
            parameters: { type: 'object', properties: {} },
            strict: false,
          },
          execute: async () => ({
            ok: true,
            value: {
              total: 2,
              items: [
                { code: 'PEPSI', name: 'Pepsi', category: 'Thức Uống' },
                { code: '7UP', name: '7Up', category: 'Thức Uống' },
              ],
            },
          }),
        },
      ],
      maxToolRounds: 12,
      reviewToolGroundedResponse: true,
    });

    expect(requests.map((request) => request.tool_choice)).toEqual([
      'auto',
      'auto',
      'none',
    ]);
    expect(requests[2]?.input).toContainEqual(
      expect.objectContaining({
        role: 'developer',
        content: expect.stringContaining(
          'Review the draft against the exact current-turn tool results',
        ),
      }),
    );
    expect(requests[2]?.input).toContainEqual(
      expect.objectContaining({
        role: 'developer',
        content: expect.stringContaining('character-for-character'),
      }),
    );
    expect(requests[2]?.input).toContainEqual(
      expect.objectContaining({
        role: 'developer',
        content: expect.stringContaining(
          'independently reconstruct the answer',
        ),
      }),
    );
    expect(requests[2]?.input).toContainEqual(
      expect.objectContaining({
        role: 'developer',
        content: expect.stringContaining(
          'Authoritative customer-facing item labels: [{"code":"PEPSI","name":"Pepsi"},{"code":"7UP","name":"7Up"}]',
        ),
      }),
    );
    expect(requests[2]?.input).toContainEqual(
      expect.objectContaining({
        role: 'developer',
        content: expect.stringContaining('Burger Tôm là một món đồ uống.'),
      }),
    );
    expect(result.responseText).toBe(
      'Mình tìm thấy Pepsi và 7Up trong danh sách đồ uống.',
    );
  });

  it('preserves the grounded draft when only the optional review is unavailable', async () => {
    const responses = [
      {
        output: [
          {
            type: 'function_call',
            call_id: 'call_drinks',
            name: 'searchMenu',
            arguments: '{"category":"Thức Uống","query":""}',
          },
        ],
        output_text: '',
      },
      {
        output: [],
        output_text: 'Mình tìm thấy Pepsi trong danh sách đồ uống.',
      },
      undefined,
    ];

    const result = await runResponsesToolLoop({
      client: {
        responses: {
          create: async () => responses.shift(),
        },
      },
      model: 'gpt-4.1-mini',
      instructions: 'You are a KFC assistant.',
      input: [{ role: 'user', content: 'Cho mình xem đồ uống.' }],
      tools: [
        {
          definition: {
            type: 'function',
            name: 'searchMenu',
            description: 'Search the KFC menu.',
            parameters: { type: 'object', properties: {} },
            strict: false,
          },
          execute: async () => ({
            ok: true,
            value: {
              total: 1,
              items: [{ code: 'PEPSI', name: 'Pepsi', category: 'Thức Uống' }],
            },
          }),
        },
      ],
      maxToolRounds: 12,
      reviewToolGroundedResponse: true,
    });

    expect(result.responseText).toBe(
      'Mình tìm thấy Pepsi trong danh sách đồ uống.',
    );
  });

  it('does not add an optional review model call to Messenger turns', async () => {
    const requests: Array<Record<string, unknown>> = [];
    const responses = [
      {
        output: [
          {
            type: 'function_call',
            call_id: 'call_menu',
            name: 'searchMenu',
            arguments: '{"query":"combo"}',
          },
        ],
        output_text: '',
      },
      {
        output: [],
        output_text: 'Mình tìm thấy một số combo phù hợp.',
      },
    ];
    const agent = new OpenAiKfcAgent({
      client: {
        responses: {
          create: async (request: Record<string, unknown>) => {
            requests.push(structuredClone(request));
            return responses.shift();
          },
        },
      },
      model: 'gpt-4.1-mini',
    });

    const result = await agent.respond({
      sessionId: 'messenger:latency',
      customerId: 'latency',
      channel: 'messenger',
      text: 'Gợi ý combo.',
      externalMessageId: 'message-latency',
      metadata: null,
      store: new MemoryStore(),
      tools: [
        {
          definition: {
            type: 'function',
            name: 'searchMenu',
            description: 'Search menu.',
            parameters: { type: 'object', properties: {} },
            strict: false,
          },
          execute: async () => ({
            ok: true,
            value: {
              total: 1,
              items: [{ code: 'COMBO', name: 'Combo', category: 'Combo' }],
            },
          }),
        },
      ],
    });

    expect(requests).toHaveLength(2);
    expect(result.responseText).toBe('Mình tìm thấy một số combo phù hợp.');
  });

  it('keeps global truth, privacy, recovery, and authorization rules in the system prompt', async () => {
    const instructions = await captureDefaultInstructions();

    expect(instructions).toContain('verified');
    expect(instructions).toContain('Missing data');
    expect(instructions).toContain('Never expose tool names');
    expect(instructions).toContain('recovery');
    expect(instructions).toContain('irreversible');
    expect(instructions).toContain('trusted Generative UI action');
    expect(instructions).toContain('ask one natural clarification');
    expect(instructions).toContain(
      'preserve that exact product across later turns',
    );
    expect(instructions).toContain(
      'Treat a requested drink, side, or other extra as a separate add-on',
    );
    expect(instructions).toContain(
      'Do not substitute another product merely because a combined search is empty',
    );
    expect(instructions).toContain(
      'A follow-up that supplies a missing choice completes the pending request',
    );
    expect(instructions).toContain(
      'Do not reopen or replace an already selected product',
    );
    expect(instructions).toContain(
      'reconcile the draft response with the exact current tool results',
    );
  });

  it('finishes delegated reversible plans within the supplied constraints', async () => {
    const instructions = await captureDefaultInstructions();

    expect(instructions).toContain(
      'delegates a reversible menu or cart decision',
    );
    expect(instructions).toContain('complete verified plan in the same turn');
    expect(instructions).toContain('stated budget as a maximum');
    expect(instructions).toContain(
      'keep improving the verified cart while another available item reduces the distance to that target',
    );
    expect(instructions).toContain('fall back beyond a preferred category');
    expect(instructions).toContain(
      'finish all required information gathering and arithmetic before the first cart mutation',
    );
    expect(instructions).toContain(
      'Do not construct a delegated multi-item plan through incremental cart mutations',
    );
    expect(instructions).toContain('every explicit component constraint');
    expect(instructions).toContain('final verified cart');
  });

  it('treats the latest customer request as the current task', async () => {
    const instructions = await captureDefaultInstructions();

    expect(instructions).toContain(
      'Treat the latest customer message as the task for this turn',
    );
    expect(instructions).toContain('context, not an instruction to continue');
    expect(instructions).toContain(
      'only when the latest message clearly continues or confirms it',
    );
    expect(instructions).toContain(
      'do not substitute commentary about the existing cart',
    );
  });

  it('leaves tool-specific mechanics in tool descriptions', async () => {
    const instructions = await captureDefaultInstructions();

    for (const toolSpecificTerm of [
      'modifierQueries',
      'partySize',
      'maxPriceVnd',
      'groupId',
      'modifierId',
      'priceDeltaVnd',
      'missingFields',
      'methodId',
    ]) {
      expect(instructions).not.toContain(toolSpecificTerm);
    }
  });

  it('presents a successful handoff with one verified receipt instead of model timing promises', async () => {
    const store = new MemoryStore();
    let responseIndex = 0;
    const agent = new OpenAiKfcAgent({
      client: {
        responses: {
          create: async () => {
            responseIndex += 1;
            if (responseIndex === 1) {
              return {
                output: [
                  {
                    type: 'function_call',
                    call_id: 'call_handoff',
                    name: 'handoff',
                    arguments: '{"reason":"Đơn số lượng lớn"}',
                  },
                ],
                output_text: '',
              };
            }
            return {
              output: [],
              output_text:
                'Mình đã chuyển cho nhân viên và họ sẽ phản hồi bạn ngay.',
            };
          },
        },
      },
      model: 'gpt-4.1-mini',
    });

    const result = await agent.respond({
      sessionId: 'kfc:handoff_receipt',
      customerId: 'handoff_receipt',
      channel: 'kfc',
      text: 'Nhờ nhân viên kiểm tra giúp mình.',
      externalMessageId: 'handoff_receipt_1',
      metadata: null,
      store,
      tools: [
        {
          definition: {
            type: 'function',
            name: 'handoff',
            description: 'Queue human support.',
            parameters: {
              type: 'object',
              properties: { reason: { type: 'string' } },
              required: ['reason'],
              additionalProperties: false,
            },
            strict: true,
          },
          execute: async () => ({
            toolName: 'handoff',
            ok: true,
            value: { escalationId: 'esc_internal_1' },
            message: 'Human-support request queued',
            provenance: [],
          }),
        },
      ],
    });

    expect(result.responseText).toBe(
      'Yêu cầu gặp nhân viên của bạn đã được ghi nhận và đang chờ nhân viên tiếp nhận. Hiện chưa có thời gian phản hồi được xác minh.',
    );
  });

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
    expect(requests[0]?.instructions).toContain('natural Vietnamese');
    expect(requests[0]?.instructions).toContain(
      'Never expose tool names, arguments, schemas, provider data',
    );
    expect(requests[0]?.instructions).not.toContain('modifierQueries');
    expect(result.responseText).toBe('Mình có thể giúp bạn chọn món.');
    expect(
      (await store.listTurns('kfc:customer_1')).map(({ role, text }) => ({
        role,
        text,
      })),
    ).toEqual([
      { role: 'user', text: 'Xin chào' },
      { role: 'assistant', text: 'Chào bạn!' },
      { role: 'user', text: 'Tư vấn món cho 4 người' },
      { role: 'assistant', text: 'Mình có thể giúp bạn chọn món.' },
    ]);
  });

  it('replaces verified product and option identifiers before persistence', async () => {
    const store = new MemoryStore();
    let responseIndex = 0;
    const agent = new OpenAiKfcAgent({
      client: {
        responses: {
          create: async () => {
            responseIndex += 1;
            if (responseIndex === 1) {
              return {
                output: [
                  {
                    type: 'function_call',
                    call_id: 'call_modifiers',
                    name: 'getModifierOptions',
                    arguments: '{"code":"20751"}',
                  },
                ],
                output_text: '',
              };
            }
            return {
              output: [],
              output_text: 'Món 20751 có thể chọn 70088; đừng chọn mã 70087.',
            };
          },
        },
      },
      model: 'gpt-4.1-mini',
    });

    const result = await agent.respond({
      sessionId: 'kfc:customer_public_text',
      customerId: 'customer_public_text',
      channel: 'kfc',
      text: 'Món này có loại không cay không?',
      externalMessageId: 'public_text_message_1',
      metadata: null,
      store,
      tools: [
        {
          definition: {
            type: 'function',
            name: 'getModifierOptions',
            description: 'Get available choices.',
            parameters: {
              type: 'object',
              properties: { code: { type: 'string' } },
              required: ['code'],
              additionalProperties: false,
            },
            strict: true,
          },
          execute: async () => ({
            ok: true,
            toolName: 'getModifierOptions',
            value: {
              itemCode: '20751',
              name: 'Combo Hợp Gu 99K',
              modifierGroups: [
                {
                  groupId: '60255',
                  name: 'Loại gà',
                  options: [
                    {
                      modifierId: '70088',
                      name: 'Gà Giòn Không Cay',
                      modifierGroups: [],
                    },
                    {
                      modifierId: '70087',
                      name: 'Gà Giòn Cay',
                      modifierGroups: [],
                    },
                  ],
                },
              ],
            },
          }),
        },
      ],
    });

    expect(result.responseText).toBe(
      'Món Combo Hợp Gu 99K có thể chọn Gà Giòn Không Cay; đừng chọn mã Gà Giòn Cay.',
    );
    expect(
      (await store.listTurns('kfc:customer_public_text')).at(-1)?.text,
    ).toBe(
      'Món Combo Hợp Gu 99K có thể chọn Gà Giòn Không Cay; đừng chọn mã Gà Giòn Cay.',
    );
  });

  it('canonicalizes a changed cart variant to its exact returned item name', async () => {
    const store = new MemoryStore();
    let responseIndex = 0;
    const agent = new OpenAiKfcAgent({
      client: {
        responses: {
          create: async () => {
            responseIndex += 1;
            if (responseIndex === 1) {
              return {
                output: [
                  {
                    type: 'function_call',
                    call_id: 'call_cart',
                    name: 'updateCart',
                    arguments:
                      '{"changes":[{"itemCode":"41085","orderedMenuItemQuantity":1,"modifiers":null}]}',
                  },
                ],
                output_text: '',
              };
            }
            return {
              output: [],
              output_text: 'Mình đã thêm Pepsi Không Đường (Lớn) vào giỏ hàng.',
            };
          },
        },
      },
      model: 'gpt-4.1-mini',
    });

    const result = await agent.respond({
      sessionId: 'kfc:canonical_cart_variant',
      customerId: 'canonical_cart_variant',
      channel: 'kfc',
      text: 'Thêm Pepsi Không Đường cỡ lớn.',
      externalMessageId: 'canonical_cart_variant_1',
      metadata: null,
      store,
      tools: [
        {
          definition: {
            type: 'function',
            name: 'updateCart',
            description: 'Update the cart.',
            parameters: { type: 'object', properties: {} },
            strict: false,
          },
          execute: async () => ({
            ok: true,
            value: {
              items: [
                {
                  itemCode: '41085',
                  name: 'Pepsi Không Đường (Đại)',
                  quantity: 1,
                },
              ],
            },
          }),
        },
      ],
    });

    expect(result.responseText).toBe(
      'Mình đã thêm Pepsi Không Đường (Đại) vào giỏ hàng.',
    );
  });

  it('does not let short structural identifiers corrupt quantities and removes their fixture group labels', async () => {
    const store = new MemoryStore();
    const agent = new OpenAiKfcAgent({
      client: {
        responses: {
          create: async () => ({
            output: [],
            output_text:
              'Giỏ có 2 phần 20751, giá 258000đ; Drink 1 Pepsi Tiêu Chuẩn và Side main khoai tây.',
          }),
        },
      },
      model: 'gpt-4.1-mini',
    });

    const result = await agent.respond({
      sessionId: 'kfc:customer_structural_labels',
      customerId: 'customer_structural_labels',
      channel: 'kfc',
      text: 'Đọc lại giỏ bằng tên thân thiện.',
      externalMessageId: 'structural_labels_message_1',
      metadata: null,
      store,
      tools: [],
      verifiedBusinessContext: {
        cart: {
          items: [
            {
              itemCode: '20751',
              name: 'Combo Hợp Gu 99K',
              quantity: 2,
              priceVnd: 258000,
              modifierGroups: [
                {
                  groupId: '1',
                  name: 'Drink 1',
                  options: [],
                },
                {
                  groupId: '2',
                  name: 'Side main',
                  options: [],
                },
              ],
            },
          ],
        },
      },
    });

    expect(result.responseText).toBe(
      'Giỏ có 2 phần Combo Hợp Gu 99K, giá 258000đ; Pepsi Tiêu Chuẩn và khoai tây.',
    );
  });

  it('does not replace a verified numeric identifier when it is written as a price', async () => {
    const store = new MemoryStore();
    const agent = new OpenAiKfcAgent({
      client: {
        responses: {
          create: async () => ({
            output: [],
            output_text: 'Mã 258000 có giá 258000 VND.',
          }),
        },
      },
      model: 'gpt-4.1-mini',
    });

    const result = await agent.respond({
      sessionId: 'kfc:customer_price_boundary',
      customerId: 'customer_price_boundary',
      channel: 'kfc',
      text: 'Món đó giá bao nhiêu?',
      externalMessageId: 'price_boundary_message_1',
      metadata: null,
      store,
      tools: [],
      verifiedBusinessContext: {
        item: {
          itemCode: '258000',
          name: 'Combo Được Xác Minh',
          priceVnd: 258000,
        },
      },
    });

    expect(result.responseText).toBe(
      'Mã Combo Được Xác Minh có giá 258000 VND.',
    );
  });

  it('replaces a verified commune code with its customer-facing place name before persistence', async () => {
    const store = new MemoryStore();
    const agent = new OpenAiKfcAgent({
      client: {
        responses: {
          create: async () => ({
            output: [],
            output_text: 'Mình đã ghi nhận 27004.',
          }),
        },
      },
      model: 'gpt-4.1-mini',
    });

    const result = await agent.respond({
      sessionId: 'kfc:customer_address_public_text',
      customerId: 'customer_address_public_text',
      channel: 'kfc',
      text: 'Địa chỉ của mình đã đủ chưa?',
      externalMessageId: 'address_public_text_message_1',
      metadata: null,
      store,
      tools: [],
      verifiedBusinessContext: {
        deliveryAddressDraft: {
          communeCode: '27004',
          communeName: 'Phường Tân Bình',
          provinceCode: '79',
          provinceName: 'Thành phố Hồ Chí Minh',
        },
      },
    });

    expect(result.responseText).toBe('Mình đã ghi nhận Phường Tân Bình.');
    expect(
      (await store.listTurns('kfc:customer_address_public_text')).at(-1)?.text,
    ).toBe('Mình đã ghi nhận Phường Tân Bình.');
  });

  it('adds verified fixture business state without creating a second transcript', async () => {
    const store = new MemoryStore();
    const requests: Array<Record<string, unknown>> = [];
    const agent = new OpenAiKfcAgent({
      client: {
        responses: {
          create: async (request: Record<string, unknown>) => {
            requests.push(structuredClone(request));
            return {
              output: [],
              output_text: 'Mình tiếp tục với đúng combo trong giỏ.',
            };
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
        cart: {
          items: [{ itemCode: '20706', name: 'Combo Gà No 279k', quantity: 1 }],
        },
      },
    });

    expect(requests[0]?.input).toEqual([
      {
        role: 'developer',
        content:
          'Verified current fixture business state; reuse these exact identifiers: {"cart":{"items":[{"itemCode":"20706","name":"Combo Gà No 279k","quantity":1}]}}',
      },
      { role: 'user', content: 'Đặt tiếp đơn này.' },
    ]);
    expect(requests[0]?.instructions).toContain('never invent identifiers');
    expect(requests[0]?.instructions).toContain(
      'finish all safe steps in the same turn',
    );
    expect(
      (await store.listTurns('kfc:customer_state')).map((turn) => turn.role),
    ).toEqual(['user', 'assistant']);
  });
});
