import { describe, expect, it } from 'vitest';
import {
  ensureAcceptedComboModifierLookup,
  OpenAIToolPlanner,
  repairPlannerToolPolicy,
  StaticToolPlanner,
} from '../../src/llm/toolPlanner.js';

describe('tool planners', () => {
  const policyInput = (latestUserMessage: string, state: Record<string, unknown> = {}) => ({
    state: {
      sessionId: 'policy', customerId: 'customer', channel: 'kfc' as const, latestUserMessage,
      intent: 'unclear' as const, userConfirmedOrder: false, escalationReasons: [], retrievedEvidence: [],
      ...state,
    },
    availableTools: ['searchMenu', 'getModifierOptions', 'updateCart', 'previewCart', 'recommendAddOns', 'getOrderStatus'] as const,
    recentTurns: [],
  });
  const policyOutput = (toolCalls: Array<{ toolName: any; arguments: Record<string, unknown> }>) => ({
    intent: 'ordering' as const, entities: {}, toolCalls, responseClaims: [] as const,
  });

  it('repairs general verified-state tool policy without scenario-specific replies', () => {
    const generic = repairPlannerToolPolicy(
      policyInput('Cho mình combo gà đi.') as any,
      policyOutput([{ toolName: 'updateCart', arguments: { itemCode: '41141', quantity: 1 } }]) as any,
    );
    expect(generic.toolCalls.map((call) => call.toolName)).toEqual(['searchMenu']);

    const groupBudget = repairPlannerToolPolicy(
      policyInput('Đặt bữa trưa cho 10 người với ngân sách 300k') as any,
      policyOutput([{ toolName: 'recommendAddOns', arguments: {} }]) as any,
    );
    expect(groupBudget.toolCalls.map((call) => call.toolName)).toContain('searchMenu');

    const concreteGroup = repairPlannerToolPolicy(
      policyInput('Combo nhóm cho 10 người', { menuSearchResults: [{ code: 'COMBO-10', name: 'Combo Nhóm 10 Người' }] }) as any,
      policyOutput([{ toolName: 'searchMenu', arguments: {} }]) as any,
    );
    expect(concreteGroup.toolCalls).toContainEqual({ toolName: 'updateCart', arguments: { itemCode: 'COMBO-10', quantity: 1 } });
    expect(concreteGroup.toolCalls.map((call) => call.toolName)).toContain('previewCart');

    const continuation = repairPlannerToolPolicy(
      policyInput('Tiếp tục đặt') as any,
      policyOutput([{ toolName: 'previewOrder', arguments: {} }, { toolName: 'placeOrder', arguments: {} }]) as any,
    );
    expect(continuation.toolCalls.map((call) => call.toolName)).toEqual(['previewOrder']);

    const selected = repairPlannerToolPolicy(
      policyInput('Vậy lấy Zinger Burger', { menuSearchResults: [{ code: '41141', name: 'Zinger Burger' }] }) as any,
      policyOutput([{ toolName: 'searchMenu', arguments: { query: 'Zinger Burger' } }]) as any,
    );
    expect(selected.toolCalls).toContainEqual({ toolName: 'updateCart', arguments: { itemCode: '41141', quantity: 1 } });
    expect(selected.contextPolicy).toMatchObject({ cart: 'active', menuSearchResults: 'active' });
    expect(selected.entities).toMatchObject({ cartMutationRequested: true, cartMutationConfirmed: true });

    const negatedSelection = repairPlannerToolPolicy(
      policyInput('Không cần thêm món tráng miệng. Hôm nay có ưu đãi gì phù hợp không?', {
        menuSearchResults: [{ code: '20751', name: 'Combo Hợp Gu 99K' }],
      }) as any,
      policyOutput([{ toolName: 'updateCart', arguments: { itemCode: '20751', quantity: 1 } }]) as any,
    );
    expect(negatedSelection.toolCalls).not.toContainEqual(
      expect.objectContaining({ toolName: 'updateCart' }),
    );

    const conditionalComparison = repairPlannerToolPolicy(
      policyInput('Món gà nào bán chạy? Nếu gọi lẻ thì cho mình 10 miếng gà rán và 4 Pepsi tiêu chuẩn.') as any,
      policyOutput([
        { toolName: 'searchMenu', arguments: { query: '10 miếng gà 4 Pepsi' } },
        { toolName: 'updateCart', arguments: { itemCode: '20751', quantity: 1 } },
        { toolName: 'previewCart', arguments: {} },
      ]) as any,
    );
    expect(conditionalComparison.toolCalls.map((call) => call.toolName)).toEqual([
      'searchMenu',
      'recommendAddOns',
    ]);
    expect(conditionalComparison.entities).toMatchObject({
      cartMutationRequested: false,
      cartMutationConfirmed: false,
    });

    const readOnlyComparison = repairPlannerToolPolicy(
      policyInput('Nếu gọi lẻ thì có tiết kiệm hơn combo không?') as any,
      policyOutput([{ toolName: 'updateCart', arguments: { itemCode: '20751', quantity: 1 } }]) as any,
    );
    expect(readOnlyComparison.toolCalls.map((call) => call.toolName)).toEqual(['recommendAddOns']);
    expect(readOnlyComparison.entities).toMatchObject({ cartMutationRequested: false, cartMutationConfirmed: false });

    const ambiguousSelection = repairPlannerToolPolicy(
      policyInput('Cho mình cái đó đi.') as any,
      policyOutput([
        { toolName: 'updateCart', arguments: { itemCode: '20751', quantity: 1 } },
        { toolName: 'previewCart', arguments: {} },
      ]) as any,
    );
    expect(ambiguousSelection.toolCalls).toEqual([]);
    expect(ambiguousSelection.contextPolicy).toMatchObject({ cart: 'confirm_before_use', recentTurns: 'active' });
    expect(ambiguousSelection.entities).toMatchObject({ asksClarification: true, cartMutationRequested: false });

    const selectionAwaitingLookup = repairPlannerToolPolicy(
      policyInput('Vậy lấy Zinger Burger, giao tới chỗ cũ nha.') as any,
      policyOutput([{ toolName: 'searchMenu', arguments: { query: 'Zinger Burger' } }]) as any,
    );
    expect(selectionAwaitingLookup.toolCalls).toEqual([
      { toolName: 'searchMenu', arguments: { query: 'Zinger Burger' } },
    ]);
    expect(selectionAwaitingLookup.contextPolicy).toMatchObject({ cart: 'active', menuSearchResults: 'active' });
    expect(selectionAwaitingLookup.entities).toMatchObject({
      cartMutationRequested: true,
      cartMutationConfirmed: true,
    });

    const acceptedUpsize = repairPlannerToolPolicy(
      policyInput('Ok, nâng cả 4 Pepsi lên size đại luôn nhé.', {
        cart: {
          id: 'cart_combo',
          items: [{ itemCode: '20752', name: 'Combo Đẫy Đà 129K', quantity: 2, unitPriceVnd: 129000 }],
          subtotalVnd: 258000, discountVnd: 0, deliveryFeeVnd: 0, totalVnd: 258000, voucherCode: null,
        },
        menuModifierOptions: {
          itemCode: '20752', itemId: '20752', productCode: 'combo', name: 'Combo Đẫy Đà 129K',
          modifierGroups: [
            { groupId: '2', name: 'Drink 1', min: 1, max: 1, depth: 0, options: [
              { modifierId: '41091', name: 'Pepsi (Đại)', priceDeltaVnd: 7000, default: false, quantity: 1, posItemId: 'p1', imageName: 'pepsi', modifierGroups: [] },
            ] },
            { groupId: '3', name: 'Drink 2', min: 1, max: 1, depth: 0, options: [
              { modifierId: '41091', name: 'Pepsi (Đại)', priceDeltaVnd: 7000, default: false, quantity: 1, posItemId: 'p2', imageName: 'pepsi', modifierGroups: [] },
            ] },
          ],
          provenance: { sourceFile: 'fixture', fixtureMode: 'public_crawl_seed' },
        },
      }) as any,
      policyOutput([{ toolName: 'searchMenu', arguments: { query: 'Pepsi size đại' } }]) as any,
    );
    expect(acceptedUpsize.contextPolicy).toMatchObject({ cart: 'active' });
    expect(acceptedUpsize.entities).toMatchObject({ cartMutationRequested: true, cartMutationConfirmed: true });
    expect(acceptedUpsize.toolCalls).toEqual([
      {
        toolName: 'updateCart',
        arguments: {
          itemCode: '20752',
          quantity: 2,
          modifiers: [
            { groupId: '2', groupName: 'Drink 1', modifierId: '41091', modifierName: 'Pepsi (Đại)', quantity: 1, priceDeltaVnd: 7000 },
            { groupId: '3', groupName: 'Drink 2', modifierId: '41091', modifierName: 'Pepsi (Đại)', quantity: 1, priceDeltaVnd: 7000 },
          ],
        },
      },
      { toolName: 'previewCart', arguments: {} },
    ]);

    const cancellation = repairPlannerToolPolicy(
      policyInput('Mình muốn hủy đơn vừa đặt', { order: { id: 'KFC-1' } }) as any,
      policyOutput([]) as any,
    );
    expect(cancellation.toolCalls).toContainEqual({ toolName: 'getOrderStatus', arguments: { orderId: 'KFC-1' } });

    const reorder = repairPlannerToolPolicy(
      policyInput('Đặt lại đơn lần trước cho mình', {
        customerContext: { recentOrders: [{ cart: { items: [{ itemCode: '41141', quantity: 2 }] } }] },
      }) as any,
      policyOutput([]) as any,
    );
    expect(reorder.toolCalls).toContainEqual({ toolName: 'updateCart', arguments: { itemCode: '41141', quantity: 2 } });
    expect(reorder.toolCalls.map((call) => call.toolName)).toContain('previewCart');

    const replacement = repairPlannerToolPolicy(
      policyInput('Bỏ Pepsi ra, đổi thành trà đào', { cart: { items: [{ itemCode: 'PEPSI', name: 'Pepsi' }] } }) as any,
      policyOutput([{ toolName: 'searchMenu', arguments: { query: 'trà đào' } }]) as any,
    );
    expect(replacement.toolCalls).toContainEqual({ toolName: 'updateCart', arguments: { itemCode: 'PEPSI', quantity: 0 } });

    const replacementAwaitingCartContext = repairPlannerToolPolicy(
      policyInput('Bỏ Pepsi ra, đổi thành trà đào được không?') as any,
      policyOutput([{ toolName: 'searchMenu', arguments: { query: 'trà đào' } }]) as any,
    );
    expect(replacementAwaitingCartContext.contextPolicy).toMatchObject({ cart: 'active' });
    expect(replacementAwaitingCartContext.entities).toMatchObject({
      cartMutationRequested: true,
      cartMutationConfirmed: true,
    });
    expect(replacementAwaitingCartContext.toolCalls).toEqual([
      { toolName: 'searchMenu', arguments: { query: 'trà đào' } },
      { toolName: 'previewCart', arguments: {} },
    ]);
  });

  it('grounds an accepted combo conversion with modifier options', () => {
    const output = ensureAcceptedComboModifierLookup(
      {
        state: {
          sessionId: 's',
          customerId: 'c',
          channel: 'kfc',
          latestUserMessage: 'Hợp lý đó, đổi sang 2 Combo Đẫy Đà 129K giúp mình.',
          intent: 'ordering',
          userConfirmedOrder: false,
          escalationReasons: [],
          retrievedEvidence: [],
        },
        availableTools: ['updateCart', 'getModifierOptions', 'previewCart'],
        recentTurns: [],
      },
      {
        intent: 'ordering',
        entities: { cartMutationRequested: true },
        toolCalls: [{ toolName: 'updateCart', arguments: { itemCode: 'verified-combo', quantity: 2 } }],
        responseClaims: [],
      },
    );

    expect(output.toolCalls).toEqual([
      { toolName: 'updateCart', arguments: { itemCode: 'verified-combo', quantity: 2 } },
      { toolName: 'getModifierOptions', arguments: { code: 'verified-combo' } },
      { toolName: 'previewCart', arguments: {} },
    ]);
  });

  it('repairs an accepted combo conversion into one complete replacement plan', () => {
    const converted = repairPlannerToolPolicy(
      policyInput('Hợp lý đó, đổi sang 2 Combo Đẫy Đà 129K giúp mình.', {
        cart: {
          id: 'cart_individual',
          items: [
            { itemCode: '41037', name: '3 Miếng Gà Rán', quantity: 3, unitPriceVnd: 105000 },
            { itemCode: '41035', name: '1 Miếng Gà Rán', quantity: 1, unitPriceVnd: 37000 },
            { itemCode: '41074', name: 'Pepsi (Tiêu Chuẩn)', quantity: 4, unitPriceVnd: 13000 },
          ],
        },
        menuSearchResults: [{ code: '20752', name: 'Combo Đẫy Đà 129K' }],
      }) as any,
      policyOutput([]) as any,
    );

    expect(converted.toolCalls).toEqual([
      { toolName: 'updateCart', arguments: { itemCode: '41037', quantity: 0 } },
      { toolName: 'updateCart', arguments: { itemCode: '41035', quantity: 0 } },
      { toolName: 'updateCart', arguments: { itemCode: '41074', quantity: 0 } },
      { toolName: 'updateCart', arguments: { itemCode: '20752', quantity: 2 } },
      { toolName: 'getModifierOptions', arguments: { code: '20752' } },
      { toolName: 'previewCart', arguments: {} },
    ]);
  });

  it('returns queued static plans for unit tests', async () => {
    const planner = new StaticToolPlanner([
      {
        intent: 'ordering',
        entities: { itemText: 'Combo Hợp Gu 99K' },
        toolCalls: [{ toolName: 'searchMenu', arguments: { query: 'Combo Hợp Gu 99K' } }],
        responseClaims: [],
      },
    ]);
    const output = await planner.plan({
      state: {
        sessionId: 's',
        customerId: 'c',
        channel: 'kfc',
        latestUserMessage: 'Cho mình Combo Hợp Gu 99K',
        intent: 'unclear',
        userConfirmedOrder: false,
        escalationReasons: [],
        retrievedEvidence: [],
      },
      availableTools: ['searchMenu'],
      recentTurns: [],
    });
    expect(output.toolCalls[0]?.toolName).toBe('searchMenu');
  });

  it('parses OpenAI Responses output JSON', async () => {
    let requestBody: unknown;
    const planner = new OpenAIToolPlanner({
      apiKey: 'test',
      model: 'gpt-test',
      fetchImpl: async (_url, init) => {
        requestBody = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              intent: 'voucher',
              contextPolicy: { membership: 'active', cart: 'active' },
              entities: { voucherText: 'KFC50' },
              toolCalls: [
                {
                  toolName: 'validateVoucher',
                  arguments: { voucherText: 'KFC50', subtotalVnd: 250000 },
                },
              ],
              responseClaims: ['promotion'],
              directResponse: null,
            }),
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
    });

    const output = await planner.plan({
      state: {
        sessionId: 's',
        customerId: 'c',
        channel: 'kfc',
        latestUserMessage: 'Mình có mã KFC50',
        intent: 'unclear',
        userConfirmedOrder: false,
        escalationReasons: [],
        retrievedEvidence: [],
      },
      availableTools: ['validateVoucher'],
      recentTurns: [],
    });
    expect(output.intent).toBe('voucher');
    expect(output.contextPolicy).toEqual({ membership: 'active', cart: 'active' });
    expect(output.responseClaims).toContain('promotion');
    expect(output.directResponse).toBeUndefined();
    expect(requestBody).toMatchObject({
      input: expect.stringContaining('"toolArgumentExamples"'),
      instructions: expect.stringContaining('planningExamples'),
    });
    expect(requestBody).toMatchObject({
      instructions: expect.stringContaining('changing drinks'),
    });
    expect((requestBody as { instructions: string }).instructions).toContain('delivery address');
    expect((requestBody as { instructions: string }).instructions).toContain('do not answer with prose only');
    expect((requestBody as { instructions: string }).instructions).toContain('budget/group recommendation turns');
    expect((requestBody as { instructions: string }).instructions).toContain(
      'do not ask the user for an order id when verified state already has one',
    );
    expect((requestBody as { instructions: string }).instructions).toContain('cart preview');
    const plannerRequest = requestBody as { input: string; instructions: string };
    const plannerInput = JSON.parse(plannerRequest.input) as {
      outputSchema: {
        entities: { smallTalk: string };
        toolCalls: Array<{ arguments: Record<string, unknown> }>;
        responseClaims: string[];
      };
      toolArgumentExamples: { searchMenu: { query?: string }; quoteFulfillment: { address?: unknown; itemCodes?: unknown } };
      planningExamples: Array<{
        user: string;
        entities?: Record<string, unknown>;
        contextPolicy?: Record<string, unknown>;
        toolCalls: Array<{ toolName: string; arguments: Record<string, unknown> }>;
      }>;
    };
    expect(plannerInput.outputSchema.toolCalls[0]?.arguments).toEqual({
      query: '<specific item/category text or omit for full menu>',
    });
    expect(plannerInput.outputSchema.responseClaims).toEqual([]);
    expect(plannerInput.outputSchema.entities.smallTalk).toContain('greetings');
    expect(plannerInput.toolArgumentExamples.searchMenu.query).toBe('<specific item/category text; omit for full menu discovery>');
    expect(plannerInput.toolArgumentExamples.quoteFulfillment.address).toBeTruthy();
    expect(plannerInput.toolArgumentExamples.quoteFulfillment.itemCodes).toEqual(['<verified_menu_item_code>']);
    expect(plannerInput.planningExamples).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entities: { smallTalk: true },
          toolCalls: [],
        }),
        expect.objectContaining({
          user: expect.stringContaining('mã giảm giá'),
          toolCalls: expect.arrayContaining([expect.objectContaining({ toolName: 'validateVoucher' })]),
        }),
        expect.objectContaining({
          user: expect.stringContaining('số lượng rất lớn'),
          toolCalls: expect.arrayContaining([expect.objectContaining({ toolName: 'handoff' })]),
        }),
        expect.objectContaining({
          user: expect.stringContaining('Xác nhận đơn'),
          entities: expect.objectContaining({ orderConfirmed: true }),
          toolCalls: expect.arrayContaining([
            expect.objectContaining({ toolName: 'placeOrder' }),
            expect.objectContaining({ toolName: 'createPaymentLink' }),
          ]),
        }),
        expect.objectContaining({
          user: expect.stringContaining('thanh toán rồi mà báo lỗi'),
          toolCalls: expect.arrayContaining([expect.objectContaining({ toolName: 'checkPaymentStatus' })]),
        }),
      ]),
    );
    const groupBudgetExample = plannerInput.planningExamples.find((example) =>
      example.user.includes('ngân sách'),
    );
    expect(groupBudgetExample?.toolCalls).toContainEqual({
      toolName: 'searchMenu',
      arguments: {},
    });
    const comboConversionExample = plannerInput.planningExamples.find((example) =>
      example.user.includes('đổi sang combo'),
    );
    expect(comboConversionExample?.toolCalls.map((call) => call.toolName)).toEqual([
      'updateCart',
      'getModifierOptions',
      'previewCart',
    ]);
    expect(plannerRequest.instructions).toContain(
      'For group or budget discovery without a concrete item or category, call searchMenu with no query.',
    );
    expect(plannerRequest.instructions).toContain(
      'For broad best-seller discovery without a concrete item or category, call searchMenu with no query.',
    );
    const plannerExamplesAndSchema = JSON.stringify({
      toolArgumentExamples: plannerInput.toolArgumentExamples,
      planningExamples: plannerInput.planningExamples,
      outputSchema: plannerInput.outputSchema,
    });
    expect(`${plannerRequest.instructions}\n${plannerExamplesAndSchema}`).not.toMatch(
      /20751|20748|41141|41086|Combo Hợp Gu|Xô Cùng Tiệc|Burger Gà Zinger|Pepsi \(Lon\)|Known demo catalog codes|KFC50|KFC-MOCK-1001|Công ty ABC|0312345678|finance@abc/i,
    );
    expect(plannerRequest.instructions).toContain('Never infer catalog codes from examples.');
    expect(plannerRequest.instructions).toContain('For neutral greetings or small talk, set entities.smallTalk=true');
    expect(plannerRequest.instructions).toContain('ask for the order id');
    expect(plannerRequest.instructions).toContain('entities.orderConfirmed=true');
    expect(plannerRequest.instructions).toContain(
      'accepts replacing separate items with a verified combo',
    );
    expect(plannerRequest.instructions).not.toContain('For demo replay');
  });

  it('retries transient network failures before returning a planner response', async () => {
    let attempts = 0;
    const planner = new OpenAIToolPlanner({
      apiKey: 'test',
      model: 'gpt-test',
      fetchImpl: async () => {
        attempts += 1;
        if (attempts < 3) throw new TypeError('fetch failed');
        return new Response(JSON.stringify({ output_text: JSON.stringify({ intent: 'unclear', entities: {}, toolCalls: [], responseClaims: [] }) }), { status: 200 });
      },
    });

    await expect(planner.plan(policyInput('Xin chào') as any)).resolves.toMatchObject({ toolCalls: [] });
    expect(attempts).toBe(3);
  });

  it('rejects model output with an unknown tool name', async () => {
    const planner = new OpenAIToolPlanner({
      apiKey: 'test',
      model: 'gpt-test',
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              intent: 'ordering',
              entities: {},
              toolCalls: [{ toolName: 'fakeTool', arguments: {} }],
              responseClaims: [],
            }),
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    });

    await expect(
      planner.plan({
        state: {
          sessionId: 's',
          customerId: 'c',
          channel: 'kfc',
          latestUserMessage: 'Gọi món giúp mình',
          intent: 'unclear',
          userConfirmedOrder: false,
          escalationReasons: [],
          retrievedEvidence: [],
        },
        availableTools: ['searchMenu'],
        recentTurns: [],
      }),
    ).rejects.toThrow('OpenAI tool planner proposed unknown tool: fakeTool');
  });

  it('rejects model output with an unavailable tool name', async () => {
    const planner = new OpenAIToolPlanner({
      apiKey: 'test',
      model: 'gpt-test',
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              intent: 'voucher',
              entities: {},
              toolCalls: [{ toolName: 'validateVoucher', arguments: { voucherText: 'KFC50', subtotalVnd: 1 } }],
              responseClaims: [],
            }),
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    });

    await expect(
      planner.plan({
        state: {
          sessionId: 's',
          customerId: 'c',
          channel: 'kfc',
          latestUserMessage: 'Mình có mã KFC50',
          intent: 'unclear',
          userConfirmedOrder: false,
          escalationReasons: [],
          retrievedEvidence: [],
        },
        availableTools: ['searchMenu'],
        recentTurns: [],
      }),
    ).rejects.toThrow('OpenAI tool planner proposed unavailable tool: validateVoucher');
  });

  it('rejects blank Responses output text', async () => {
    const planner = new OpenAIToolPlanner({
      apiKey: 'test',
      model: 'gpt-test',
      fetchImpl: async () =>
        new Response(JSON.stringify({ output_text: '   ' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    });

    await expect(
      planner.plan({
        state: {
          sessionId: 's',
          customerId: 'c',
          channel: 'kfc',
          latestUserMessage: 'Xin chào',
          intent: 'unclear',
          userConfirmedOrder: false,
          escalationReasons: [],
          retrievedEvidence: [],
        },
        availableTools: ['searchMenu'],
        recentTurns: [],
      }),
    ).rejects.toThrow('OpenAI tool planning returned no text');
  });

  it('surfaces OpenAI HTTP error messages', async () => {
    const planner = new OpenAIToolPlanner({
      apiKey: 'test',
      model: 'gpt-test',
      fetchImpl: async () =>
        new Response(JSON.stringify({ error: { message: 'bad request' } }), {
          status: 400,
          statusText: 'Bad Request',
          headers: { 'content-type': 'application/json' },
        }),
    });

    await expect(
      planner.plan({
        state: {
          sessionId: 's',
          customerId: 'c',
          channel: 'kfc',
          latestUserMessage: 'Xin chào',
          intent: 'unclear',
          userConfirmedOrder: false,
          escalationReasons: [],
          retrievedEvidence: [],
        },
        availableTools: ['searchMenu'],
        recentTurns: [],
      }),
    ).rejects.toThrow('OpenAI tool planning failed: bad request');
  });
});
