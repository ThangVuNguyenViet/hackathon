import { describe, expect, it } from 'vitest';
import { OpenAIResponseComposer, validateGenUiCompanionResponse } from '../../src/llm/responseComposer.js';

describe('OpenAIResponseComposer', () => {
  it('rejects a saved address that is not the current verified GenUI candidate', () => {
    const savedAddress = {
      label: 'Old address',
      line1: '123 Nguyen Trai',
      district: 'Quan 5',
      city: 'Ho Chi Minh',
    };
    const state = {
      sessionId: 'session_address_guard',
      customerId: 'customer_address_guard',
      channel: 'kfc' as const,
      latestUserMessage: 'Giao ve Nha Be',
      intent: 'ordering' as const,
      addressDraft: { district: 'Nha Be' },
      userConfirmedOrder: false,
      escalationReasons: [],
      retrievedEvidence: [],
      customerContext: { savedAddresses: [savedAddress], recentOrders: [], favorites: [] },
      entities: { suppressSavedAddressCandidate: true },
    };

    expect(validateGenUiCompanionResponse('Giao tới 123 Nguyễn Trãi nhé.', state)).toBe(false);
    expect(validateGenUiCompanionResponse('Bạn bổ sung số nhà và thành phố nhé.', state)).toBe(true);
    expect(validateGenUiCompanionResponse('Xác nhận 123 Nguyễn Trãi nhé.', {
      ...state,
      entities: { savedAddressDecision: { addressIndex: 0, decision: 'suggest' } },
    })).toBe(true);
  });

  it('rejects cart copy that substitutes an unverified variant or modifier', () => {
    const state = {
      sessionId: 'session_cart_guard',
      customerId: 'customer_cart_guard',
      channel: 'kfc' as const,
      latestUserMessage: 'Cho minh cai do di',
      intent: 'unclear' as const,
      userConfirmedOrder: false,
      escalationReasons: [],
      retrievedEvidence: [],
      cart: {
        id: 'cart_guard',
        items: [
          {
            itemCode: '41036',
            name: '2 Miếng Gà Rán',
            quantity: 1,
            unitPriceVnd: 74_000,
            modifiers: [{
              groupId: '60254',
              groupName: '2 COB',
              modifierId: '70012',
              modifierName: 'Gà Giòn Cay',
              quantity: 2,
              priceDeltaVnd: 0,
            }],
          },
          { itemCode: '41074', name: 'Pepsi (Tiêu Chuẩn)', quantity: 1, unitPriceVnd: 13_000 },
        ],
        subtotalVnd: 87_000,
        discountVnd: 0,
        deliveryFeeVnd: 0,
        totalVnd: 87_000,
        voucherCode: null,
      },
    };

    expect(validateGenUiCompanionResponse(
      'Đã chọn 2 Miếng Gà Rán (Gà Giòn Không Cay) và Pepsi Không Đường.',
      state,
    )).toBe(false);
    expect(validateGenUiCompanionResponse(
      'Đã chọn 2 Miếng Gà Rán Gà Giòn Cay và Pepsi Tiêu Chuẩn.',
      state,
    )).toBe(true);
    expect(validateGenUiCompanionResponse('Giỏ hiện tại vẫn được giữ nguyên.', state)).toBe(true);
  });

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
      prompt_cache_key: string;
      instructions: string;
      input: string;
    };
    expect(body.model).toBe('gpt-4.1');
    expect(body.prompt_cache_key).toMatch(/^kfc-vietnam:genui-companion-v1:shard-\d+$/);
    expect(body.instructions).toContain('Do not change business decisions or invent facts outside state/toolTrace.');
    expect(body.instructions).toContain('280 characters');
    expect(body.instructions).toContain('genui-companion-v1');
    expect(body.instructions).toContain('Do not enumerate menu, cart, payment, or order rows');
    expect(body.input).toContain('Combo 99K');
    expect(body.input).toContain('Landmark 81');
    expect(body.input).toContain('"verifiedFallback"');
    expect(body.input).toContain('"toolTrace"');
    expect(body.input).not.toContain('"channel"');
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

    expect(requestBody?.instructions).toContain('social-standalone-v1');
    expect(requestBody?.instructions).toContain('Explicitly name every choice');
    expect(requestBody?.instructions).toContain('must remain useful when no image');
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
    ).rejects.toThrow('OpenAI standalone social composition failed: model unavailable');
  });

  it('retries and rejects social output that depends on hidden UI', async () => {
    let calls = 0;
    const composer = new OpenAIResponseComposer({
      apiKey: 'test_key',
      model: 'gpt-4.1',
      fetchImpl: (async () => {
        calls += 1;
        return new Response(JSON.stringify({ output_text: 'Bấm nút bên dưới để tiếp tục.' }), { status: 200 });
      }) as typeof fetch,
    });

    await expect(composer.composeResponse({
      channel: 'messenger',
      presentationMode: 'standalone_text',
      replyIntent: 'general_reply',
      fallbackText: 'Bạn cho mình biết lựa chọn muốn tiếp tục.',
      state: {
        sessionId: 'session_1', customerId: 'customer_1', channel: 'messenger',
        latestUserMessage: 'tiếp tục', intent: 'unclear', userConfirmedOrder: false,
        escalationReasons: [], retrievedEvidence: [],
      },
    })).rejects.toThrow('invalid profile output');
    expect(calls).toBe(2);
  });
});
