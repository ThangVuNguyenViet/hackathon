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
      channel: 'kfc',
      presentationMode: 'structured_companion',
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
        recentTurns: [
          {
            id: 'turn_prior',
            sessionId: 'session_1',
            channel: 'messenger',
            role: 'user',
            text: 'Lần trước giao tới Landmark 81',
            externalMessageId: 'mid_prior',
            externalUserId: 'customer_1',
            deliveryStatus: 'received',
            metadata: null,
            createdAt: '2026-07-09T00:00:00.000Z',
          },
        ],
        toolTrace: [
          {
            toolName: 'searchMenu',
            arguments: { query: 'Combo 99K' },
            ok: true,
            resultSummary: '1 item matched',
            provenance: [],
          },
        ],
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
    expect(body.instructions).toContain('Do not change business decisions or invent facts outside state/toolTrace.');
    expect(body.instructions).toContain('280 characters');
    expect(body.instructions).toContain('Do not enumerate menu or cart items');
    expect(body.input).toContain('Combo 99K');
    expect(body.input).toContain('Landmark 81');
    expect(body.input).toContain('"verifiedFallback"');
    expect(body.input).toContain('"toolTrace"');
  });

  it('requires standalone channel prose to name verified choices without hidden UI', async () => {
    let requestBody: { instructions: string } | undefined;
    const composer = new OpenAIResponseComposer({
      apiKey: 'test_key',
      model: 'gpt-4.1',
      fetchImpl: (async (_url, init) => {
        requestBody = JSON.parse(String(init?.body)) as { instructions: string };
        return new Response(JSON.stringify({ output_text: 'Combo Hợp Gu 99K có giá 99.000đ.' }), { status: 200 });
      }) as typeof fetch,
    });

    await composer.composeResponse({
      channel: 'messenger',
      presentationMode: 'standalone_text',
      replyIntent: 'general_reply',
      fallbackText: 'Mình đã tìm thấy món phù hợp.',
      state: {
        sessionId: 'session_1',
        customerId: 'customer_1',
        channel: 'messenger',
        latestUserMessage: 'cho tôi xem món ăn',
        intent: 'ordering',
        userConfirmedOrder: false,
        escalationReasons: [],
        retrievedEvidence: [],
        menuSearchResults: [
          {
            code: '20751',
            name: 'Combo Hợp Gu 99K',
            category: 'Ưu Đãi',
            description: '3 Miếng Gà Rán + 1 Burger Tôm',
            priceVnd: 99_000,
            originalPriceVnd: null,
            imageUrl: 'https://example.test/combo.jpg',
            available: true,
          },
        ],
      },
    });

    expect(requestBody?.instructions).toContain('explicitly name verified choices');
    expect(requestBody?.instructions).toContain('must not depend on hidden UI');
    expect(requestBody?.instructions).not.toContain('Do not enumerate menu or cart items');
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
        channel: 'messenger',
        presentationMode: 'standalone_text',
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
