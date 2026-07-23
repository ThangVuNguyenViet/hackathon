import { describe, expect, it } from 'vitest';
import { OpenAiKfcAgent } from '../../src/agent/openAiKfcAgent.js';
import { buildServer } from '../../src/api/server.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';

function sandboxIdentityLifecycle() {
  const unused = async (): Promise<never> => {
    throw new Error('Lifecycle operations are not used by direct-agent tests');
  };
  return {
    environment: 'sandbox' as const,
    controls: { create: unused, get: unused, transition: unused },
    createInput: unused,
    binding: unused,
  };
}

function requestToolNames(request: Record<string, unknown> | undefined) {
  const tools = request?.tools;
  if (!Array.isArray(tools)) return [];
  return tools.flatMap((tool) => {
    if (typeof tool !== 'object' || tool === null || !('name' in tool)) {
      return [];
    }
    return typeof tool.name === 'string' ? [tool.name] : [];
  });
}

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
        agentConfigured: true,
        commerce: {
          mode: 'fixture',
          requiredCapabilities: ['orders', 'payment'],
        },
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
    });
    expect(response.json()).not.toHaveProperty('toolCalls');
    expect(response.json().presentation).not.toHaveProperty('genUi');
    expect(
      (await store.listTurns('kfc:customer_1')).map((turn) => turn.role),
    ).toEqual(['user', 'assistant']);
  });

  it('persists an explicitly empty cart after a trusted GenUI removal', async () => {
    const store = new MemoryStore();
    let responseIndex = 0;
    const openAiAgent = new OpenAiKfcAgent({
      client: {
        responses: {
          create: async () => {
            responseIndex += 1;
            if (responseIndex === 1) {
              return {
                output: [
                  {
                    type: 'function_call',
                    call_id: 'call_menu',
                    name: 'searchMenu',
                    arguments: JSON.stringify({ query: 'Combo Hợp Gu' }),
                  },
                ],
                output_text: '',
              };
            }
            return {
              output: [],
              output_text:
                responseIndex === 2
                  ? 'Mời bạn chọn combo.'
                  : responseIndex === 3
                    ? 'Đã thêm combo vào giỏ.'
                    : 'Giỏ hàng của bạn hiện đã trống.',
            };
          },
        },
      },
      model: 'gpt-4.1-mini',
    });
    const server = buildServer({
      store,
      fixtures: createTestFixtures(),
      openAiAgent,
      readiness: {
        commerce: {
          mode: 'fixture',
          requiredCapabilities: ['orders', 'payment'],
        },
      },
    });

    const menuResponse = await server.inject({
      method: 'POST',
      url: '/chat/kfc/message',
      payload: {
        sessionId: 'kfc:empty_cart:genui',
        customerId: 'empty_cart',
        clientMessageId: 'empty_cart_menu',
        text: 'Cho mình xem combo.',
      },
    });
    const menuBody = menuResponse.json();
    const addResponse = await server.inject({
      method: 'POST',
      url: '/chat/kfc/genui-action',
      payload: {
        sessionId: 'kfc:empty_cart:genui',
        customerId: 'empty_cart',
        clientMessageId: 'empty_cart_add',
        action: {
          attachmentId: menuBody.genUi.id,
          actionId: 'add_items',
          payload: { items: [{ itemCode: '20751', quantity: 1 }] },
        },
      },
    });
    const cartBody = addResponse.json();
    const removeResponse = await server.inject({
      method: 'POST',
      url: '/chat/kfc/genui-action',
      payload: {
        sessionId: 'kfc:empty_cart:genui',
        customerId: 'empty_cart',
        clientMessageId: 'empty_cart_remove',
        action: {
          attachmentId: cartBody.genUi.id,
          actionId: 'update_cart',
          payload: { items: [{ itemCode: '20751', quantity: 0 }] },
        },
      },
    });

    expect(removeResponse.statusCode, removeResponse.body).toBe(200);
    expect(removeResponse.json()).not.toHaveProperty('genUi');
    const verifiedStates = (await store.listEvents('kfc:empty_cart:genui'))
      .filter(({ sourceType }) => sourceType === 'graph:verified_state')
      .map(({ payload }) => payload.verifiedState);
    expect(verifiedStates.at(-1)).toMatchObject({
      cart: { items: [] },
    });
  });

  it('projects direct tool evidence and completes a trusted GenUI order confirmation', async () => {
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
                  output: [
                    {
                      type: 'function_call',
                      call_id: 'call_menu',
                      name: 'searchMenu',
                      arguments: JSON.stringify({ query: 'Combo Hợp Gu' }),
                    },
                  ],
                  output_text: '',
                };
              case 2:
                return {
                  output: [],
                  output_text: 'Mời bạn chọn combo phù hợp.',
                  usage: {
                    input_tokens: 20,
                    output_tokens: 6,
                    total_tokens: 26,
                  },
                };
              case 3:
                return {
                  output: [],
                  output_text: 'Đã thêm 2 combo vào giỏ.',
                  usage: {
                    input_tokens: 30,
                    output_tokens: 8,
                    total_tokens: 38,
                  },
                };
              case 4:
                return {
                  output: [
                    {
                      type: 'function_call',
                      call_id: 'call_fulfillment',
                      name: 'quoteFulfillment',
                      arguments: JSON.stringify({
                        method: 'delivery',
                        address: {
                          label: null,
                          line1: '12 Nguyễn Văn Linh',
                          district: 'Quận 7',
                          city: 'Hồ Chí Minh',
                        },
                      }),
                    },
                  ],
                  output_text: '',
                };
              case 5:
                return {
                  output: [],
                  output_text: 'Mình đã kiểm tra giao hàng đến Quận 7.',
                };
              case 6:
                return {
                  output: [],
                  output_text: 'Mời bạn kiểm tra lại đơn hàng.',
                };
              case 7:
                return {
                  output: [],
                  output_text: 'Đơn hàng đã được đặt thành công.',
                };
              case 8:
                return {
                  output: [],
                  output_text: 'Mời bạn chọn phương thức thanh toán.',
                };
              case 9:
                return {
                  output: [],
                  output_text: 'Đã chọn Ví ZaloPay.',
                };
              default:
                throw new Error('Unexpected extra Responses API call');
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
      readiness: {
        commerce: {
          mode: 'fixture',
          requiredCapabilities: ['orders', 'payment'],
        },
      },
    });

    const response = await server.inject({
      method: 'POST',
      url: '/chat/kfc/message',
      payload: {
        sessionId: 'kfc:genui_customer:genui',
        customerId: 'genui_customer',
        clientMessageId: 'genui_message_1',
        text: 'Cho mình xem combo.',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(requestToolNames(requests[0])).not.toContain('showGenUi');
    const body = response.json();
    expect(body).toMatchObject({
      agentRuntime: 'openai-responses',
      responseText: 'Mời bạn chọn combo phù hợp.',
      genUi: {
        widgetKind: 'smartMenuPicker',
        data: {
          items: [
            expect.objectContaining({
              code: '20751',
              name: 'Combo Hợp Gu 99K',
            }),
          ],
        },
      },
      presentation: {
        profile: 'genui',
        genUi: { widgetKind: 'smartMenuPicker' },
      },
    });
    expect(
      (await store.listTurns('kfc:genui_customer:genui')).at(-1)?.metadata
        ?.genUi,
    ).toMatchObject({ widgetKind: 'smartMenuPicker' });

    const actionResponse = await server.inject({
      method: 'POST',
      url: '/chat/kfc/genui-action',
      payload: {
        sessionId: 'kfc:genui_customer:genui',
        customerId: 'genui_customer',
        clientMessageId: 'genui_action_1',
        action: {
          attachmentId: body.genUi.id,
          actionId: 'add_items',
          payload: { items: [{ itemCode: '20751', quantity: 2 }] },
        },
      },
    });

    expect(actionResponse.statusCode, actionResponse.body).toBe(200);
    expect(actionResponse.json()).toMatchObject({
      responseText: 'Đã thêm 2 combo vào giỏ.',
      genUi: {
        widgetKind: 'cartBuilder',
        data: {
          cart: {
            items: [
              expect.objectContaining({ itemCode: '20751', quantity: 2 }),
            ],
            totalVnd: 198000,
          },
        },
      },
    });
    expect(requests[2]?.input).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'developer',
          content:
            'Verified GenUI customer action: {"kind":"cart_batch_update","items":[{"itemCode":"20751","quantity":2}]}',
        }),
        expect.objectContaining({
          type: 'function_call',
          name: 'updateCart',
          arguments: JSON.stringify({
            changes: [{ itemCode: '20751', quantity: 2, modifiers: [] }],
          }),
        }),
        expect.objectContaining({
          type: 'function_call_output',
          output: expect.stringContaining('"toolName":"updateCart"'),
        }),
      ]),
    );
    expect(requests[2]?.tools).toEqual([]);

    const resumedServer = buildServer({
      store,
      fixtures: createTestFixtures(),
      openAiAgent,
      readiness: {
        commerce: {
          mode: 'fixture',
          requiredCapabilities: ['orders', 'payment'],
        },
      },
    });
    const addressResponse = await resumedServer.inject({
      method: 'POST',
      url: '/chat/kfc/message',
      payload: {
        sessionId: 'kfc:genui_customer:genui',
        customerId: 'genui_customer',
        clientMessageId: 'genui_address_1',
        text: '12 Nguyễn Văn Linh, Quận 7, TP Hồ Chí Minh',
      },
    });

    expect(addressResponse.statusCode, addressResponse.body).toBe(200);
    expect(addressResponse.json()).toMatchObject({
      responseText: 'Mình đã kiểm tra giao hàng đến Quận 7.',
      genUi: {
        widgetKind: 'addressFulfillmentCheck',
        data: {
          cart: {
            items: [
              expect.objectContaining({ itemCode: '20751', quantity: 2 }),
            ],
          },
        },
      },
    });
    expect(requests[3]?.input).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'developer',
          content: expect.stringContaining('"itemCode":"20751"'),
        }),
      ]),
    );

    const acceptedFulfillmentResponse = await resumedServer.inject({
      method: 'POST',
      url: '/chat/kfc/genui-action',
      payload: {
        sessionId: 'kfc:genui_customer:genui',
        customerId: 'genui_customer',
        clientMessageId: 'genui_accept_fulfillment_1',
        action: {
          attachmentId: addressResponse.json().genUi.id,
          actionId: 'accept_fulfillment',
          value: 'accepted',
        },
      },
    });

    expect(
      acceptedFulfillmentResponse.statusCode,
      acceptedFulfillmentResponse.body,
    ).toBe(200);
    expect(acceptedFulfillmentResponse.json().genUi).toMatchObject({
      widgetKind: 'orderReviewConfirm',
    });

    const confirmedOrderResponse = await resumedServer.inject({
      method: 'POST',
      url: '/chat/kfc/genui-action',
      payload: {
        sessionId: 'kfc:genui_customer:genui',
        customerId: 'genui_customer',
        clientMessageId: 'genui_confirm_order_1',
        action: {
          attachmentId: acceptedFulfillmentResponse.json().genUi.id,
          actionId: 'confirm_order',
          value: 'confirmed',
        },
      },
    });

    expect(confirmedOrderResponse.statusCode, confirmedOrderResponse.body).toBe(
      200,
    );
    expect(confirmedOrderResponse.json()).toMatchObject({
      responseText: 'Đơn hàng đã được đặt thành công.',
      genUi: {
        widgetKind: 'paymentOrderStatus',
        data: {
          order: expect.objectContaining({ status: 'created' }),
        },
      },
    });
    expect(requests[6]?.input).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'function_call',
          name: 'previewOrder',
          arguments: '{}',
        }),
        expect.objectContaining({
          type: 'function_call',
          name: 'placeOrder',
          arguments: '{}',
        }),
      ]),
    );

    const paymentMethodsResponse = await resumedServer.inject({
      method: 'POST',
      url: '/chat/kfc/genui-action',
      payload: {
        sessionId: 'kfc:genui_customer:genui',
        customerId: 'genui_customer',
        clientMessageId: 'genui_change_payment_method_1',
        action: {
          attachmentId: confirmedOrderResponse.json().genUi.id,
          actionId: 'change_payment_method',
        },
      },
    });

    expect(paymentMethodsResponse.statusCode, paymentMethodsResponse.body).toBe(
      200,
    );
    expect(paymentMethodsResponse.json().genUi).toMatchObject({
      widgetKind: 'paymentMethodPicker',
      data: {
        methods: expect.arrayContaining([
          expect.objectContaining({ methodId: expect.any(String) }),
        ]),
      },
    });

    const zaloPayMethodId = 'zalopay_wallet';
    expect(paymentMethodsResponse.json().genUi.data.methods).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ methodId: zaloPayMethodId }),
      ]),
    );
    const selectedPaymentResponse = await resumedServer.inject({
      method: 'POST',
      url: '/chat/kfc/genui-action',
      payload: {
        sessionId: 'kfc:genui_customer:genui',
        customerId: 'genui_customer',
        clientMessageId: 'genui_select_payment_method_1',
        action: {
          attachmentId: paymentMethodsResponse.json().genUi.id,
          actionId: 'select_payment_method',
          payload: { methodId: zaloPayMethodId },
        },
      },
    });

    expect(
      selectedPaymentResponse.statusCode,
      selectedPaymentResponse.body,
    ).toBe(200);
    expect(selectedPaymentResponse.json().genUi).toMatchObject({
      widgetKind: 'paymentOrderStatus',
      actions: expect.arrayContaining([
        expect.objectContaining({ id: 'open_payment' }),
      ]),
    });
  });

  it('keeps direct tool results text-only when the customer selects text mode', async () => {
    const store = new MemoryStore();
    let responseIndex = 0;
    const requests: Array<Record<string, unknown>> = [];
    const openAiAgent = new OpenAiKfcAgent({
      client: {
        responses: {
          create: async (request) => {
            requests.push(request);
            responseIndex += 1;
            return responseIndex === 1
              ? {
                  output: [
                    {
                      type: 'function_call',
                      call_id: 'call_text_menu',
                      name: 'searchMenu',
                      arguments: JSON.stringify({ query: 'Combo Hợp Gu' }),
                    },
                  ],
                  output_text: '',
                }
              : {
                  output: [],
                  output_text: 'Combo Hợp Gu 99K có giá 99.000đ.',
                };
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
        sessionId: 'kfc:text_customer:text',
        customerId: 'text_customer',
        clientMessageId: 'text_message_1',
        text: 'Gợi ý combo bằng chữ.',
        metadata: { showcaseResponseMode: 'text' },
      },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(requestToolNames(requests[0])).not.toContain('showGenUi');
    expect(requests[0]?.instructions).not.toContain('bắt buộc gọi showGenUi');
    expect(response.json()).toMatchObject({
      responseText: 'Combo Hợp Gu 99K có giá 99.000đ.',
      presentation: {
        profile: 'social',
        text: 'Combo Hợp Gu 99K có giá 99.000đ.',
      },
    });
    expect(response.json()).not.toHaveProperty('genUi');
    expect(response.json().presentation).not.toHaveProperty('genUi');
  });
});
