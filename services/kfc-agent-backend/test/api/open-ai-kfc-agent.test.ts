import { describe, expect, it } from 'vitest';
import { OpenAiKfcAgent } from '../../src/agent/openAiKfcAgent.js';
import { buildServer } from '../../src/api/server.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';

describe('OpenAI KFC chat API', () => {
  it('routes first-party chat through the direct Responses agent', async () => {
    const store = new MemoryStore();
    const openAiAgent = new OpenAiKfcAgent({
      client: {
        responses: {
          create: async () => ({
            output: [],
            output_text: 'Mình sẽ giúp bạn chọn món thật đơn giản.',
            usage: { input_tokens: 10, output_tokens: 8, total_tokens: 18 },
          }),
        },
      },
      model: 'gpt-4.1-mini',
    });
    const server = buildServer({
      store,
      fixtures: createTestFixtures(),
      openAiAgent,
      readiness: {
        plannerConfigured: true,
        plannerProvider: 'openai',
        commerce: { mode: 'fixture', requiredCapabilities: ['orders', 'payment'] },
      },
    });

    const response = await server.inject({
      method: 'POST',
      url: '/chat/kfc/message',
      payload: {
        sessionId: 'kfc:customer_1',
        customerId: 'customer_1',
        clientMessageId: 'message_1',
        text: 'Không biết ăn gì, tư vấn giúp mình.',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      agentRuntime: 'openai-responses',
      responseText: 'Mình sẽ giúp bạn chọn món thật đơn giản.',
      presentation: {
        profile: 'genui',
        text: 'Mình sẽ giúp bạn chọn món thật đơn giản.',
      },
      usage: { inputTokens: 10, outputTokens: 8, totalTokens: 18 },
      toolCalls: [],
    });
    expect(response.json().presentation).not.toHaveProperty('genUi');
    expect((await store.listTurns('kfc:customer_1')).map((turn) => turn.role)).toEqual([
      'user',
      'assistant',
    ]);
  });

  it('projects successful direct tool evidence into the existing GenUI contract', async () => {
    const store = new MemoryStore();
    let responseIndex = 0;
    const requests: Array<Record<string, unknown>> = [];
    const openAiAgent = new OpenAiKfcAgent({
      client: {
        responses: {
          create: async (request) => {
            requests.push(request);
            responseIndex += 1;
            switch (responseIndex) {
              case 1:
                return {
                  output: [{
                    type: 'function_call',
                    call_id: 'call_menu',
                    name: 'searchMenu',
                    arguments: JSON.stringify({ query: 'Combo Hợp Gu' }),
                  }],
                  output_text: '',
                };
              case 2:
                return {
                  output: [],
                  output_text: 'Mời bạn chọn combo phù hợp.',
                  usage: { input_tokens: 20, output_tokens: 6, total_tokens: 26 },
                };
              case 3:
                return {
                  output: [{
                    type: 'function_call',
                    call_id: 'call_cart',
                    name: 'updateCart',
                    arguments: JSON.stringify({
                      changes: [{ itemCode: '20751', quantity: 2 }],
                    }),
                  }],
                  output_text: '',
                };
              default:
                return {
                  output: [],
                  output_text: 'Đã thêm 2 combo vào giỏ.',
                  usage: { input_tokens: 30, output_tokens: 8, total_tokens: 38 },
                };
            }
          },
        },
      },
      model: 'gpt-4.1-mini',
    });
    const server = buildServer({
      store,
      fixtures: createTestFixtures(),
      openAiAgent,
    });

    const response = await server.inject({
      method: 'POST',
      url: '/chat/kfc/message',
      payload: {
        sessionId: 'kfc:genui_customer',
        customerId: 'genui_customer',
        clientMessageId: 'genui_message_1',
        text: 'Cho mình xem combo.',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({
      agentRuntime: 'openai-responses',
      responseText: 'Mời bạn chọn combo phù hợp.',
      genUi: {
        widgetKind: 'smartMenuPicker',
        data: {
          items: [expect.objectContaining({ code: '20751', name: 'Combo Hợp Gu 99K' })],
        },
      },
      presentation: {
        profile: 'genui',
        genUi: { widgetKind: 'smartMenuPicker' },
      },
    });
    expect((await store.listTurns('kfc:genui_customer')).at(-1)?.metadata?.genUi)
      .toMatchObject({ widgetKind: 'smartMenuPicker' });

    const actionResponse = await server.inject({
      method: 'POST',
      url: '/chat/kfc/genui-action',
      payload: {
        sessionId: 'kfc:genui_customer',
        customerId: 'genui_customer',
        clientMessageId: 'genui_action_1',
        action: {
          attachmentId: body.genUi.id,
          actionId: 'add_items',
          payload: { items: [{ itemCode: '20751', quantity: 2 }] },
        },
      },
    });

    expect(actionResponse.statusCode).toBe(200);
    expect(actionResponse.json()).toMatchObject({
      responseText: 'Đã thêm 2 combo vào giỏ.',
      genUi: {
        widgetKind: 'cartBuilder',
        data: {
          cart: {
            items: [expect.objectContaining({ itemCode: '20751', quantity: 2 })],
            totalVnd: 198000,
          },
        },
      },
    });
    expect(requests[2]?.input).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'developer',
        content: 'Verified GenUI customer action: {"kind":"cart_batch_update","items":[{"itemCode":"20751","quantity":2}]}',
      }),
    ]));
  });
});
