import { describe, expect, it } from 'vitest';
import { OpenAIResponseComposer } from '../../src/llm/responseComposer.js';

describe('OpenAIResponseComposer', () => {
  it('calls the Responses API and returns output_text', async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const composer = new OpenAIResponseComposer({
      apiKey: 'test_key',
      model: 'gpt-4.1',
      baseUrl: 'https://openai.local/v1/',
      fetchImpl: (async (url, init) => {
        requests.push({ url: String(url), init: init ?? {} });
        return new Response(JSON.stringify({ output_text: 'Dạ mình đã thêm món vào giỏ.' }), { status: 200 });
      }) as typeof fetch,
    });

    const text = await composer.composeResponse({
      replyIntent: 'ask_fulfillment_method',
      fallbackText: 'Mình đã thêm món vào giỏ. Bạn muốn giao hàng hay đến cửa hàng nhận?',
      state: {
        sessionId: 'session_1',
        customerId: 'customer_1',
        channel: 'messenger',
        latestUserMessage: 'Cho mình 1 Combo 99K',
        intent: 'ordering',
        userConfirmedOrder: false,
        escalationReasons: [],
        retrievedEvidence: [],
      },
    });

    expect(text).toBe('Dạ mình đã thêm món vào giỏ.');
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe('https://openai.local/v1/responses');
    expect(requests[0]?.init.headers).toMatchObject({
      Authorization: 'Bearer test_key',
      'Content-Type': 'application/json',
    });

    const body = JSON.parse(String(requests[0]?.init.body)) as {
      model: string;
      instructions: string;
      input: string;
    };
    expect(body.model).toBe('gpt-4.1');
    expect(body.instructions).toContain('Do not change the business decision');
    expect(body.input).toContain('Combo 99K');
  });

  it('throws when OpenAI returns an error response', async () => {
    const composer = new OpenAIResponseComposer({
      apiKey: 'test_key',
      model: 'gpt-4.1',
      fetchImpl: (async () =>
        new Response(JSON.stringify({ error: { message: 'model unavailable' } }), {
          status: 400,
          statusText: 'Bad Request',
        })) as typeof fetch,
    });

    await expect(
      composer.composeResponse({
        replyIntent: 'ask_clarification',
        fallbackText: 'Mình cần thêm thông tin để hỗ trợ đúng.',
        state: {
          sessionId: 'session_1',
          customerId: 'customer_1',
          channel: 'messenger',
          latestUserMessage: 'hello',
          intent: 'unclear',
          userConfirmedOrder: false,
          escalationReasons: [],
          retrievedEvidence: [],
        },
      }),
    ).rejects.toThrow('OpenAI response composition failed: model unavailable');
  });
});
