import { describe, expect, it } from 'vitest';
import {
  OpenAIToolPlanner,
  repairPlannerToolPolicy,
  StaticToolPlanner,
} from '../../src/llm/toolPlanner.js';

describe('tool planners', () => {
  const policyInput = (latestUserMessage: string, state: Record<string, unknown> = {}) => ({
    state: {
      sessionId: 'policy', customerId: 'customer', latestUserMessage,
      intent: 'unclear' as const, userConfirmedOrder: false, escalationReasons: [], retrievedEvidence: [],
      ...state,
    },
    availableTools: ['searchMenu', 'getModifierOptions', 'updateCart', 'previewCart', 'recommendAddOns', 'getOrderStatus'] as const,
    recentTurns: [],
  });
  const policyOutput = (toolCalls: Array<{ toolName: any; arguments: Record<string, unknown> }>) => ({
    intent: 'ordering' as const, entities: {}, toolCalls, responseClaims: [] as const,
  });

  it('does not infer or rewrite tool plans from customer wording', () => {
    const output = {
      ...policyOutput([
        { toolName: 'getModifierOptions', arguments: { code: 'verified-item' } },
        { toolName: 'updateCart', arguments: { itemCode: 'verified-item', quantity: 1 } },
      ]),
      contextPolicy: { cart: 'active' as const, menuSearchResults: 'active' as const },
      entities: { cartMutationRequested: true, cartMutationConfirmed: true },
    };

    for (const latestUserMessage of [
      'short request',
      'another language and phrasing',
      'a phrase that resembles an address or checkout request',
    ]) {
      expect(repairPlannerToolPolicy(policyInput(latestUserMessage) as any, output as any)).toBe(output);
    }
  });

  it('does not fill missing commerce fields or synthesize tool calls', () => {
    const output = {
      ...policyOutput([{
        toolName: 'quoteFulfillment',
        arguments: {
          address: { district: 'provided district', city: 'provided city' },
          method: 'delivery',
          itemCodes: ['verified-item'],
        },
      }]),
      entities: {},
    };

    const repaired = repairPlannerToolPolicy(policyInput('customer message') as any, output as any);

    expect(repaired).toBe(output);
    expect(repaired.toolCalls).toEqual(output.toolCalls);
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
              entities: {
                voucherText: 'KFC50',
                orderConfirmed: 'true',
                reorderConfirmed: 'true',
                useSavedAddress: 'false',
              },
              toolCalls: [
                {
                  toolName: 'validateVoucher',
                  arguments: { voucherText: 'KFC50', subtotalVnd: 250000 },
                },
              ],
              responseClaims: ['promotion', 'Bạn hiện có 120 điểm thành viên.'],
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
        latestUserMessage: 'Mình có mã KFC50',
        intent: 'unclear',
        userConfirmedOrder: false,
        escalationReasons: [],
        retrievedEvidence: [],
      },
      availableTools: ['validateVoucher'],
      recentTurns: [{
        id: 'turn_with_presentation_metadata',
        sessionId: 's',
        channel: 'kfc',
        role: 'assistant',
        text: 'Visible conversation text',
        externalMessageId: null,
        externalUserId: null,
        deliveryStatus: 'sent',
        metadata: {
          rawEvent: { presentationOnlySecret: 'must-not-reach-commerce-planner' },
          genUi: {
            id: 'presentation-only-widget',
            widgetKind: 'supportHandoff',
            lifecycleStage: 'support',
            status: 'active',
            title: 'Presentation only',
            data: { presentationOnlySecret: 'must-not-reach-commerce-planner' },
            actions: [],
          },
        },
        createdAt: '2026-07-13T00:00:00.000Z',
      }],
      contextInventory: {
        cart: { available: true, itemCount: 2 },
        address: { available: false },
        fulfillment: { available: false },
        order: { available: false },
        payment: { available: false },
        menuSearchResults: { available: false, itemCount: 0 },
        customer: { available: false, savedAddressCount: 0, recentOrderCount: 0 },
      },
      menuCatalogContext: {
        query: 'fixture-backed request',
        candidates: [{
          code: 'fixture-code',
          itemId: 'fixture-item-id',
          productCode: 'fixture-product-code',
          name: 'Fixture Product',
          category: 'Fixture Category',
          description: 'Fixture description',
          priceVnd: 12345,
          available: true,
          verifiedForMutation: true,
          verificationQuery: 'Fixture Product',
          modifierGroups: [{
            groupId: 'fixture-group',
            name: 'Fixture choice',
            min: 1,
            max: 1,
            requiredSelections: [],
            options: [{
              modifierId: 'fixture-option',
              name: 'Fixture modifier',
              priceDeltaVnd: 0,
              default: false,
              quantity: 1,
              selectionBundle: [{ groupId: 'fixture-group', modifierId: 'fixture-option', quantity: 1 }],
            }],
          }],
        }],
      },
      fulfillmentLocationContext: {
        query: 'typed district',
        candidates: [{
          serviceAreaId: 'fixture-service-area',
          storeId: 'fixture-store',
          method: 'delivery',
          district: 'Fixture District',
          city: 'Fixture City',
          matchedDistrictAlias: 'typed district',
          matchSource: 'current_query',
          verifiedForQuote: true,
          source: {
            fixtureMode: 'demo_mock_seed',
            sourceFile: 'fixture-service-areas.json',
            sourceApi: 'mock://fixture-service-area',
          },
        }],
      },
    });
    expect(output.intent).toBe('voucher');
    expect(output.contextPolicy).toEqual({ membership: 'active', cart: 'active' });
    expect(output.responseClaims).toEqual(['promotion']);
    expect(output.entities).toMatchObject({
      orderConfirmed: true,
      reorderConfirmed: true,
      useSavedAddress: false,
    });
    expect(output.directResponse).toBeUndefined();
    expect(requestBody).toMatchObject({
      input: expect.stringContaining('"toolArgumentExamples"'),
      instructions: expect.stringContaining('planningPatterns'),
      max_output_tokens: 640,
      text: { format: { type: 'json_object' } },
    });
    expect(requestBody).toMatchObject({
      instructions: expect.stringContaining('change one of its configurable options'),
    });
    expect((requestBody as { instructions: string }).instructions).toContain('delivery address');
    expect((requestBody as { instructions: string }).instructions).toContain('do not answer with prose only');
    expect((requestBody as { instructions: string }).instructions).toContain('budget/group recommendation turns');
    expect((requestBody as { instructions: string }).instructions).toContain('flat modifierChoices');
    expect((requestBody as { instructions: string }).instructions).toContain('never as a customer selection');
    expect((requestBody as { instructions: string }).instructions).toContain(
      'do not ask the user for an order id when verified state already has one',
    );
    expect((requestBody as { instructions: string }).instructions).toContain('cart preview');
    const plannerRequest = requestBody as { input: string; instructions: string };
    const plannerInput = JSON.parse(plannerRequest.input) as {
      outputSchema: {
        entities: { smallTalk: boolean; orderConfirmed: boolean; addressDraft: { line1: string } };
        catalogSuggestion: { itemCode: string; source: string; decision: string };
        catalogSelections: Array<{
          requestFragment: string;
          replacesItemCodes: string[];
          modifierChoices: Array<{ name: string }>;
        }>;
        toolCalls: Array<{ arguments: Record<string, unknown> }>;
        responseClaims: string[];
      };
      toolArgumentExamples: {
        searchMenu: { query?: string };
        updateCart: { modifiers?: Array<Record<string, unknown>> };
        quoteFulfillment: { address?: unknown; itemCodes?: unknown };
      };
      planningPatterns: Array<{
        situation: string;
        toolSequence: string[];
        entities?: string[];
        context?: string[];
        constraints?: string[];
      }>;
      contextInventory: { cart: { available: boolean; itemCount: number } };
      menuCatalogContext: {
        candidates: Array<{
          code: string;
          modifierChoices: Array<{ name: string; selectionBundle: Array<Record<string, unknown>> }>;
          modifierGroups?: unknown;
        }>;
      };
      fulfillmentLocationContext: { candidates: Array<{ district: string; city: string }> };
      recentTurns: Array<{ role: string; text: string; metadata?: unknown }>;
    };
    expect(plannerInput.outputSchema.toolCalls[0]?.arguments).toEqual({
      query: '<specific item/category text or omit for full menu>',
    });
    expect(plannerInput.outputSchema.responseClaims).toEqual([]);
    expect(plannerInput.outputSchema.entities.smallTalk).toBe(false);
    expect(plannerInput.outputSchema.entities.orderConfirmed).toBe(false);
    expect(plannerInput.outputSchema.entities.addressDraft.line1).toContain('verbatim');
    expect(plannerInput.outputSchema.catalogSuggestion).toMatchObject({
      itemCode: expect.stringContaining('customer-evidence'),
      source: 'favorite|recent_order',
      decision: 'suggest|accept',
    });
    expect(plannerInput.outputSchema.catalogSelections[0]?.requestFragment).toContain('exact contiguous');
    expect(plannerInput.outputSchema.catalogSelections[0]?.replacesItemCodes[0]).toContain('active-cart code');
    expect(plannerInput.outputSchema.catalogSelections[0]?.modifierChoices[0]?.name).toContain('exact');
    expect(plannerInput.toolArgumentExamples.searchMenu.query).toBe('<specific item/category text; omit for full menu discovery>');
    expect(plannerInput.toolArgumentExamples.quoteFulfillment.address).toBeTruthy();
    expect(plannerInput.toolArgumentExamples.quoteFulfillment.itemCodes).toEqual(['<verified_menu_item_code>']);
    expect(plannerInput.toolArgumentExamples.updateCart.modifiers?.[0]).toEqual({
      groupId: '<verified_modifier_group_id>',
      modifierId: '<verified_modifier_option_id>',
      quantity: '<verified_option_quantity_or_customer_quantity>',
    });
    expect(plannerInput.contextInventory.cart).toEqual({ available: true, itemCount: 2 });
    expect(plannerInput.menuCatalogContext.candidates).toEqual([
      expect.objectContaining({
        code: 'fixture-code',
        modifierChoices: [{
          groupId: 'fixture-group',
          groupName: 'Fixture choice',
          name: 'Fixture modifier',
          priceDeltaVnd: 0,
          selectionBundle: [{ groupId: 'fixture-group', modifierId: 'fixture-option', quantity: 1 }],
        }],
      }),
    ]);
    expect(plannerInput.menuCatalogContext.candidates[0]?.modifierGroups).toBeUndefined();
    expect(plannerInput.fulfillmentLocationContext.candidates).toEqual([
      expect.objectContaining({ district: 'Fixture District', city: 'Fixture City' }),
    ]);
    expect(plannerInput.recentTurns).toEqual([{ role: 'assistant', text: 'Visible conversation text' }]);
    expect(plannerRequest.input).not.toContain('must-not-reach-commerce-planner');
    expect(plannerRequest.input).not.toContain('presentation-only-widget');
    expect(plannerInput.planningPatterns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          situation: expect.stringContaining('social turn'),
          entities: ['smallTalk'],
          toolSequence: [],
        }),
        expect.objectContaining({
          situation: expect.stringContaining('voucher'),
          toolSequence: expect.arrayContaining([expect.stringContaining('validateVoucher')]),
        }),
        expect.objectContaining({
          situation: expect.stringContaining('abnormal large order'),
          toolSequence: expect.arrayContaining([expect.stringContaining('handoff')]),
        }),
        expect.objectContaining({
          situation: expect.stringContaining('explicit order confirmation'),
          entities: ['orderConfirmed'],
          toolSequence: expect.arrayContaining([
            expect.stringContaining('previewOrder'),
            expect.stringContaining('createPaymentLink'),
          ]),
        }),
        expect.objectContaining({
          situation: expect.stringContaining('payment completion or failure'),
          toolSequence: ['checkPaymentStatus'],
        }),
      ]),
    );
    const groupBudgetPattern = plannerInput.planningPatterns.find((pattern) =>
      pattern.situation.includes('budget'),
    );
    expect(groupBudgetPattern?.toolSequence).toContain('searchMenu');
    const cartChangePattern = plannerInput.planningPatterns.find((pattern) =>
      pattern.situation.includes('size change'),
    );
    expect(cartChangePattern?.toolSequence).toEqual(['updateCart', 'previewCart']);
    expect(plannerRequest.instructions).toContain(
      'For group or budget discovery without a concrete item or category, call searchMenu with no query.',
    );
    expect(plannerRequest.instructions).toContain(
      'For broad best-seller discovery without a concrete item or category, call searchMenu with no query.',
    );
    const plannerPatternsAndSchema = JSON.stringify({
      toolArgumentExamples: plannerInput.toolArgumentExamples,
      planningPatterns: plannerInput.planningPatterns,
      outputSchema: plannerInput.outputSchema,
    });
    expect(`${plannerRequest.instructions}\n${plannerPatternsAndSchema}`).not.toMatch(
      /20751|20748|41141|41086|Combo Hợp Gu|Xô Cùng Tiệc|Burger Gà Zinger|Pepsi \(Lon\)|Known demo catalog codes|KFC50|KFC-MOCK-1001|Công ty ABC|0312345678|finance@abc/i,
    );
    expect(plannerRequest.instructions).toContain('Never infer catalog codes from examples.');
    expect(plannerRequest.instructions).toContain('modifierChoices to identify dishes compatible with a preference');
    expect(plannerRequest.instructions).toContain('mocked fulfillment API evidence, not a default address');
    expect(plannerRequest.instructions).toContain('contextInventory only reports whether hidden verified state exists');
    expect(`${plannerRequest.instructions}\n${plannerRequest.input}`).not.toMatch(/72 Lê Thánh Tôn|Quận 1/);
    expect(plannerRequest.instructions).toContain('For neutral greetings or small talk, set entities.smallTalk=true');
    expect(plannerRequest.instructions).toContain('do not ask the user for an order id');
    expect(plannerRequest.instructions).toContain('entities.orderConfirmed=true');
    expect(plannerRequest.instructions).toContain(
      'accepts replacing separate items with a verified combo',
    );
    expect(plannerRequest.instructions).not.toContain('For demo replay');
    expect(output.entities.orderConfirmed).toBe(true);
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

  it('uses a compact fulfillment profile for the structurally active address phase', async () => {
    let requestBody: any;
    const planner = new OpenAIToolPlanner({
      apiKey: 'test',
      model: 'gpt-test',
      fetchImpl: async (_url, init) => {
        requestBody = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({
          output_text: JSON.stringify({
            intent: 'ordering',
            entities: { asksClarification: true },
            toolCalls: [],
            responseClaims: [],
            directResponse: 'Need the remaining address fields.',
          }),
        }), { status: 200 });
      },
    });

    await planner.plan({
      ...(policyInput('typed address') as any),
      planningProfile: 'active_checkout',
      availableTools: ['updateCart', 'quoteFulfillment'],
    });

    expect(requestBody.max_output_tokens).toBe(640);
    expect(requestBody.instructions).toContain('checkout tool planner');
    expect(requestBody.instructions).toContain('copy it verbatim into addressDraft.line1');
    expect(requestBody.instructions).not.toContain('Membership requests use');
    const input = JSON.parse(requestBody.input);
    expect(Object.keys(input.toolArgumentExamples)).toEqual(['updateCart', 'quoteFulfillment']);
    expect(input.planningPatterns).toBeUndefined();
    expect(input.state.sessionId).toBeUndefined();
    expect(input.state.customerId).toBeUndefined();
    expect(input.state.retrievedEvidence).toBeUndefined();
  });

  it('uses a compact catalog-ordering profile that isolates each requested line and its modifiers', async () => {
    let requestBody: any;
    const planner = new OpenAIToolPlanner({
      apiKey: 'test',
      model: 'gpt-test',
      fetchImpl: async (_url, init) => {
        requestBody = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({
          output_text: JSON.stringify({
            intent: 'ordering',
            entities: { cartMutationRequested: true },
            toolCalls: [],
            responseClaims: [],
          }),
        }), { status: 200 });
      },
    });

    await planner.plan({
      ...(policyInput('three independently requested menu lines') as any),
      planningProfile: 'catalog_ordering',
      availableTools: ['searchMenu', 'getModifierOptions', 'updateCart'],
    });

    expect(requestBody.max_output_tokens).toBe(640);
    expect(requestBody.instructions).toContain('catalog-ordering tool planner');
    expect(requestBody.instructions).toContain('Match each phrase independently');
    expect(requestBody.instructions).toContain('every descriptor in that same phrase');
    expect(requestBody.instructions).toContain('selectionBundle exactly');
    expect(requestBody.instructions).toContain('never replace an additional standalone line');
    expect(requestBody.instructions).toContain('only from constraints the customer actually stated');
    expect(requestBody.instructions).toContain('exactly one available candidate satisfies every stated descriptor');
    expect(requestBody.instructions).toContain('source=favorite is authoritative');
    expect(requestBody.instructions).toContain('latest text omits product words');
    expect(requestBody.instructions).toContain('polite question-form request');
    expect(requestBody.instructions).not.toContain('Membership requests use');
    const input = JSON.parse(requestBody.input);
    expect(Object.keys(input.toolArgumentExamples)).toEqual(['searchMenu', 'getModifierOptions', 'updateCart']);
    expect(input.planningPatterns).toBeUndefined();
  });

  it('compiles typed AI catalog selections into exact fixture modifier bundles', async () => {
    const planner = new OpenAIToolPlanner({
      apiKey: 'test',
      model: 'gpt-test',
      fetchImpl: async () => new Response(JSON.stringify({
        output_text: JSON.stringify({
          intent: 'ordering',
          entities: { cartMutationRequested: true },
          catalogSelections: [{
            requestFragment: 'requested spicy fixture combo',
            itemCode: 'fixture-combo',
            quantity: 1,
            modifierChoices: [{ groupId: 'spice-group', name: 'Spicy fixture choice' }],
          }],
          toolCalls: [{ toolName: 'updateCart', arguments: { itemCode: 'fixture-combo', quantity: 1 } }],
          responseClaims: [],
        }),
      }), { status: 200 }),
    });

    const output = await planner.plan({
      ...(policyInput('please add requested spicy fixture combo') as any),
      planningProfile: 'catalog_ordering',
      availableTools: ['updateCart'],
      menuCatalogContext: {
        query: 'requested spicy fixture combo',
        candidates: [{
          code: 'fixture-combo',
          itemId: 'fixture-combo',
          productCode: 'fixture-combo',
          name: 'Fixture combo',
          category: 'Fixture category',
          description: 'Fixture description',
          priceVnd: 100,
          available: true,
          verifiedForMutation: true,
          verificationQuery: 'Fixture combo',
          modifierGroups: [{
            groupId: 'spice-group',
            name: 'Spice',
            min: 1,
            max: 1,
            requiredSelections: [{ groupId: 'parent-group', modifierId: 'parent-option', quantity: 1 }],
            options: [{
              modifierId: 'spicy-option',
              name: 'Spicy fixture choice',
              priceDeltaVnd: 0,
              default: false,
              quantity: 1,
              selectionBundle: [
                { groupId: 'parent-group', modifierId: 'parent-option', quantity: 1 },
                { groupId: 'spice-group', modifierId: 'spicy-option', quantity: 1 },
              ],
            }],
          }],
        }],
      },
    });

    expect(output.catalogSelections).toHaveLength(1);
    expect(output.toolCalls).toEqual([{
      toolName: 'updateCart',
      arguments: {
        itemCode: 'fixture-combo',
        quantity: 1,
        modifiers: [
          { groupId: 'parent-group', modifierId: 'parent-option', quantity: 1 },
          { groupId: 'spice-group', modifierId: 'spicy-option', quantity: 1 },
        ],
      },
    }]);
  });

  it('recovers a confirmed short modifier change across independent combo groups', async () => {
    const planner = new OpenAIToolPlanner({
      apiKey: 'test',
      model: 'gpt-test',
      fetchImpl: async () => new Response(JSON.stringify({
        output_text: JSON.stringify({
          intent: 'cart_edit',
          entities: { cartMutationConfirmed: true, asksClarification: true },
          catalogSelections: [{
            requestFragment: 'nâng cả 4 Pepsi lên size đại',
            itemCode: 'combo',
            quantity: 2,
            modifierChoices: [],
          }],
          toolCalls: [{ toolName: 'updateCart', arguments: { itemCode: 'combo', quantity: 2 } }],
          responseClaims: [],
        }),
      }), { status: 200 }),
    });
    const sizeOption = (groupId: string, modifierId: string) => ({
      modifierId,
      name: 'Pepsi (Đại)',
      searchAliases: ['size đại'],
      priceDeltaVnd: 7000,
      default: false,
      quantity: 1,
      selectionBundle: [{ groupId, modifierId, quantity: 1 }],
    });
    const standardOption = (groupId: string) => ({
      modifierId: `standard-${groupId}`,
      name: 'Pepsi (Tiêu Chuẩn)',
      priceDeltaVnd: 0,
      default: true,
      quantity: 1,
      selectionBundle: [{ groupId, modifierId: `standard-${groupId}`, quantity: 1 }],
    });

    const output = await planner.plan({
      ...(policyInput('Ok, nâng cả 4 Pepsi lên size đại luôn nhé.', {
        cart: {
          id: 'cart_combo',
          items: [{ itemCode: 'combo', name: 'Fixture combo', quantity: 2, unitPriceVnd: 100 }],
          subtotalVnd: 200, discountVnd: 0, deliveryFeeVnd: 0, totalVnd: 200, voucherCode: null,
        },
      }) as any),
      planningProfile: 'catalog_ordering',
      availableTools: ['updateCart'],
      menuCatalogContext: {
        query: 'size đại',
        candidates: [{
          code: 'combo', itemId: 'combo', productCode: 'combo', name: 'Fixture combo',
          category: 'Combo', description: 'Includes two drinks', priceVnd: 100,
          available: true, verifiedForMutation: true, verificationQuery: 'size đại',
          activeCartItem: true, activeCartQuantity: 2,
          modifierGroups: [
            {
              groupId: 'drink-1', name: 'Drink 1', min: 1, max: 1,
              options: [standardOption('drink-1'), sizeOption('drink-1', 'large-1')],
            },
            {
              groupId: 'drink-2', name: 'Drink 2', min: 1, max: 1,
              options: [standardOption('drink-2'), sizeOption('drink-2', 'large-2')],
            },
          ],
        }],
      },
    });

    expect(output.entities).toMatchObject({
      asksClarification: false,
      cartMutationRequested: true,
      cartMutationConfirmed: true,
    });
    expect(output.toolCalls).toEqual([{
      toolName: 'updateCart',
      arguments: {
        itemCode: 'combo',
        quantity: 2,
        modifiers: [
          { groupId: 'drink-1', modifierId: 'large-1', quantity: 1 },
          { groupId: 'drink-2', modifierId: 'large-2', quantity: 1 },
        ],
      },
    }]);
  });

  it('uses a durable verified combo proposal to replace its source cart lines', async () => {
    const planner = new OpenAIToolPlanner({
      apiKey: 'test',
      model: 'gpt-test',
      fetchImpl: async () => new Response(JSON.stringify({
        output_text: JSON.stringify({
          intent: 'cart_edit',
          entities: { cartMutationConfirmed: true },
          catalogSelections: [{
            requestFragment: '2 Fixture combo',
            itemCode: 'combo',
            quantity: 2,
            modifierChoices: [],
          }],
          toolCalls: [],
          responseClaims: [],
        }),
      }), { status: 200 }),
    });

    const output = await planner.plan({
      ...(policyInput('Đổi sang 2 Fixture combo giúp mình.', {
        cart: {
          id: 'cart_loose',
          items: [
            { itemCode: 'chicken', name: 'Chicken', quantity: 10, unitPriceVnd: 10 },
            { itemCode: 'pepsi', name: 'Pepsi', quantity: 4, unitPriceVnd: 5 },
          ],
          subtotalVnd: 120, discountVnd: 0, deliveryFeeVnd: 0, totalVnd: 120, voucherCode: null,
        },
        comboConversionProposal: {
          itemCode: 'combo', name: 'Fixture combo', quantity: 2,
          sourceItemCodes: ['chicken', 'pepsi'], sourceTotalVnd: 120, comboTotalVnd: 100, savingsVnd: 20,
        },
      }) as any),
      planningProfile: 'catalog_ordering',
      availableTools: ['updateCart'],
      menuCatalogContext: {
        query: '2 Fixture combo',
        candidates: [{
          code: 'combo', itemId: 'combo', productCode: 'combo', name: 'Fixture combo',
          category: 'Combo', description: 'Equivalent fixture combo', priceVnd: 50,
          available: true, verifiedForMutation: true, verificationQuery: 'Fixture combo', modifierGroups: [],
        }],
      },
    });

    expect(output.toolCalls).toEqual([
      { toolName: 'updateCart', arguments: { itemCode: 'chicken', quantity: 0 } },
      { toolName: 'updateCart', arguments: { itemCode: 'pepsi', quantity: 0 } },
      { toolName: 'updateCart', arguments: { itemCode: 'combo', quantity: 2 } },
    ]);
  });

  it('rejects an unverified catalog mutation atomically without failing independent reads', async () => {
    const planner = new OpenAIToolPlanner({
      apiKey: 'test',
      model: 'gpt-test',
      fetchImpl: async () => new Response(JSON.stringify({
        output_text: JSON.stringify({
          intent: 'ordering',
          entities: { cartMutationRequested: true },
          catalogSelections: [{
            requestFragment: 'combo đó',
            itemCode: 'unverified-item',
            quantity: 1,
            modifierChoices: [],
          }],
          toolCalls: [
            { toolName: 'updateCart', arguments: { itemCode: 'unverified-item', quantity: 1 } },
            { toolName: 'getMembershipProfile', arguments: {} },
          ],
          responseClaims: [],
          directResponse: 'Mình đã thêm món.',
        }),
      }), { status: 200 }),
    });

    const output = await planner.plan({
      ...(policyInput('Ok, thêm combo đó. Mình có điểm thành viên không?') as any),
      planningProfile: 'catalog_ordering',
      availableTools: ['updateCart', 'getMembershipProfile', 'listMembershipRewards'],
      menuCatalogContext: { query: 'combo đó', candidates: [] },
    });

    expect(output.catalogSelections).toEqual([]);
    expect(output.entities).toMatchObject({ asksClarification: true });
    expect(output.toolCalls).toEqual([{ toolName: 'getMembershipProfile', arguments: {} }]);
    expect(output.directResponse).toBeUndefined();
  });

  it('rejects a broader product when the customer directly names a visible catalog item', async () => {
    const planner = new OpenAIToolPlanner({
      apiKey: 'test',
      model: 'gpt-test',
      fetchImpl: async () => new Response(JSON.stringify({
        output_text: JSON.stringify({
          intent: 'ordering',
          entities: { cartMutationRequested: true },
          catalogSelections: [{
            requestFragment: '1 burger tôm',
            itemCode: 'shrimp-burger-combo',
            quantity: 1,
            modifierChoices: [],
          }],
          toolCalls: [{ toolName: 'updateCart', arguments: { itemCode: 'shrimp-burger-combo', quantity: 1 } }],
          responseClaims: [],
        }),
      }), { status: 200 }),
    });
    const candidate = (code: string, name: string, available: boolean) => ({
      code,
      itemId: code,
      productCode: code,
      name,
      category: 'Burger',
      description: name,
      priceVnd: 100,
      available,
      verifiedForMutation: true as const,
      verificationQuery: name,
      modifierGroups: [],
    });

    const output = await planner.plan({
      ...(policyInput('Cho mình 1 burger tôm') as any),
      planningProfile: 'catalog_ordering',
      availableTools: ['updateCart'],
      menuCatalogContext: {
        query: 'burger tôm',
        candidates: [
          candidate('shrimp-burger', 'Burger Tôm', false),
          candidate('shrimp-burger-combo', 'Combo Burger Tôm', true),
        ],
      },
    });

    expect(output.toolCalls).toEqual([]);
    expect(output.catalogSelections).toEqual([]);
    expect(output.entities).toMatchObject({ asksClarification: true });
  });

  it('requires a prior assistant offer before mutating a customer-profile item by reference', async () => {
    const favoriteCandidate = {
      code: 'favorite-combo',
      itemId: 'favorite-combo',
      productCode: 'favorite-combo',
      name: 'Combo Burger Zinger',
      category: 'Combo',
      description: 'Fixture favorite combo',
      priceVnd: 79000,
      available: true,
      verifiedForMutation: true as const,
      verificationQuery: 'Combo Burger Zinger',
      customerEvidenceSources: ['favorite'] as Array<'favorite' | 'recent_order'>,
      modifierGroups: [],
    };
    const plannerResponse = (requestFragment: string) => new Response(JSON.stringify({
      output_text: JSON.stringify({
        intent: 'ordering',
        entities: { cartMutationRequested: true, cartMutationConfirmed: true },
        catalogSelections: [{
          requestFragment,
          itemCode: 'favorite-combo',
          quantity: 1,
          modifierChoices: [],
        }],
        toolCalls: [
          { toolName: 'updateCart', arguments: { itemCode: 'favorite-combo', quantity: 1 } },
          { toolName: 'previewCart', arguments: {} },
        ],
        responseClaims: [],
      }),
    }), { status: 200 });

    const initialPlanner = new OpenAIToolPlanner({
      apiKey: 'test',
      model: 'gpt-test',
      fetchImpl: async () => plannerResponse('món mình hay ăn'),
    });
    const initial = await initialPlanner.plan({
      ...(policyInput('Khoan, lấy món mình hay ăn đi.') as any),
      planningProfile: 'catalog_ordering',
      availableTools: ['updateCart', 'previewCart'],
      menuCatalogContext: { query: 'món mình hay ăn', candidates: [favoriteCandidate] },
      recentTurns: [{ role: 'assistant', text: 'Bạn muốn đặt lại đơn gần nhất không?' } as any],
    });

    expect(initial.toolCalls).toEqual([]);
    expect(initial.entities).toMatchObject({
      asksClarification: true,
      cartMutationRequested: false,
      cartMutationConfirmed: false,
      reorderConfirmed: false,
      catalogSuggestion: {
        itemCode: 'favorite-combo',
        name: 'Combo Burger Zinger',
        sources: ['favorite'],
      },
    });

    const suggestionPlanner = new OpenAIToolPlanner({
      apiKey: 'test',
      model: 'gpt-test',
      fetchImpl: async () => new Response(JSON.stringify({
        output_text: JSON.stringify({
          intent: 'unclear',
          entities: { asksClarification: true },
          catalogSuggestion: { itemCode: 'favorite-combo', source: 'favorite', decision: 'suggest' },
          toolCalls: [],
          responseClaims: [],
        }),
      }), { status: 200 }),
    });
    const suggested = await suggestionPlanner.plan({
      ...(policyInput('Khoan, lấy món mình hay ăn đi.') as any),
      planningProfile: 'catalog_ordering',
      availableTools: ['updateCart', 'previewCart'],
      menuCatalogContext: { query: 'món mình hay ăn', candidates: [favoriteCandidate] },
    });

    expect(suggested.catalogSuggestion).toEqual({
      itemCode: 'favorite-combo',
      source: 'favorite',
      decision: 'suggest',
    });
    expect(suggested.entities).toMatchObject({
      asksClarification: true,
      catalogSuggestion: { itemCode: 'favorite-combo', name: 'Combo Burger Zinger' },
    });

    const confirmationPlanner = new OpenAIToolPlanner({
      apiKey: 'test',
      model: 'gpt-test',
      fetchImpl: async () => plannerResponse('combo đó'),
    });
    const confirmed = await confirmationPlanner.plan({
      ...(policyInput('Ok, thêm combo đó.') as any),
      planningProfile: 'catalog_ordering',
      availableTools: ['updateCart', 'previewCart'],
      menuCatalogContext: { query: 'combo đó', candidates: [favoriteCandidate] },
      recentTurns: [{ role: 'assistant', text: 'Món phù hợp là Combo Burger Zinger. Bạn xác nhận nhé.' } as any],
    });

    expect(confirmed.toolCalls).toEqual([
      { toolName: 'previewCart', arguments: {} },
      { toolName: 'updateCart', arguments: { itemCode: 'favorite-combo', quantity: 1 } },
    ]);

    const acceptedSuggestionPlanner = new OpenAIToolPlanner({
      apiKey: 'test',
      model: 'gpt-test',
      fetchImpl: async () => new Response(JSON.stringify({
        output_text: JSON.stringify({
          intent: 'ordering',
          entities: {},
          catalogSuggestion: { itemCode: 'favorite-combo', source: 'favorite', decision: 'accept' },
          toolCalls: [{ toolName: 'getMembershipProfile', arguments: {} }],
          responseClaims: [],
        }),
      }), { status: 200 }),
    });
    const acceptedSuggestion = await acceptedSuggestionPlanner.plan({
      ...(policyInput('Ok, thêm combo đó. Mình có điểm thành viên không?') as any),
      planningProfile: 'catalog_ordering',
      availableTools: ['updateCart', 'getMembershipProfile', 'listMembershipRewards'],
      menuCatalogContext: { query: 'combo đó', candidates: [favoriteCandidate] },
      recentTurns: [{ role: 'assistant', text: 'Món phù hợp là Combo Burger Zinger. Bạn xác nhận nhé.' } as any],
    });

    expect(acceptedSuggestion.entities).toMatchObject({
      asksClarification: false,
      cartMutationRequested: true,
      cartMutationConfirmed: true,
    });
    expect(acceptedSuggestion.toolCalls).toEqual([
      { toolName: 'getMembershipProfile', arguments: {} },
      { toolName: 'updateCart', arguments: { itemCode: 'favorite-combo', quantity: 1 } },
      { toolName: 'listMembershipRewards', arguments: {} },
    ]);
  });

  it('turns a saved-address reference into a validated suggest-then-accept decision without copying it into addressDraft', async () => {
    const savedAddress = {
      label: 'Địa chỉ cũ',
      line1: '123 Nguyễn Trãi',
      district: 'Quận 5',
      city: 'Hồ Chí Minh',
    };
    const response = () => new Response(JSON.stringify({
      output_text: JSON.stringify({
        contextPolicy: { customer: 'active', fulfillment: 'confirm_before_use' },
        entities: {
          intent: 'ordering',
          useSavedAddress: true,
          fulfillmentAccepted: false,
          addressDraft: savedAddress,
          fulfillmentRisk: 'untrusted-model-entity',
          toolCalls: [{
            toolName: 'quoteFulfillment',
            arguments: { address: savedAddress, method: 'delivery', itemCodes: ['41141'] },
          }],
          responseClaims: [],
          directResponse: 'unsafe direct response',
        },
      }),
    }), { status: 200 });
    const input = {
      ...(policyInput('Giao tới chỗ cũ nha', {
        customerContext: { savedAddresses: [savedAddress], favorites: [], recentOrders: [] },
      }) as any),
      planningProfile: 'active_checkout' as const,
      availableTools: ['quoteFulfillment'] as const,
    };

    const suggested = await new OpenAIToolPlanner({
      apiKey: 'test', model: 'gpt-test', fetchImpl: async () => response(),
    }).plan(input as any);

    expect(suggested.savedAddressDecision).toEqual({ addressIndex: 0, decision: 'suggest' });
    expect(suggested.entities).toMatchObject({
      savedAddressDecision: { addressIndex: 0, decision: 'suggest' },
      useSavedAddress: false,
      fulfillmentAccepted: false,
      asksClarification: true,
    });
    expect(suggested.entities).not.toHaveProperty('addressDraft');
    expect(suggested.entities).not.toHaveProperty('fulfillmentRisk');
    expect(suggested.toolCalls).toEqual([]);
    expect(suggested.directResponse).toBeUndefined();

    const accepted = await new OpenAIToolPlanner({
      apiKey: 'test', model: 'gpt-test', fetchImpl: async () => response(),
    }).plan({
      ...input,
      state: { ...input.state, latestUserMessage: 'Đúng rồi' },
      recentTurns: [{
        role: 'assistant',
        text: 'Mình tìm thấy 123 Nguyễn Trãi, Quận 5, Hồ Chí Minh. Bạn xác nhận nhé.',
        metadata: {
          genUi: {
            widgetKind: 'addressFulfillmentCheck',
            data: { address: savedAddress },
          },
        },
      } as any],
    } as any);

    expect(accepted.savedAddressDecision).toEqual({ addressIndex: 0, decision: 'accept' });
    expect(accepted.entities).toMatchObject({
      savedAddressDecision: { addressIndex: 0, decision: 'accept' },
      useSavedAddress: true,
      fulfillmentAccepted: true,
      asksClarification: false,
    });
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
