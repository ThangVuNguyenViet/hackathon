import { describe, expect, it } from 'vitest';
import { defaultCommerceAgentPolicy } from '../../src/config/commerceAgentPolicy.js';
import { OpenAIToolPlanner, type ToolPlannerInput, type ToolPlannerOutput } from '../../src/llm/toolPlanner.js';
import {
  PlannerContractError,
  plannerSemanticViolations,
  runPlannerWithSemanticReplan,
} from '../../src/llm/toolPlannerSemanticContract.js';

const baseInput = (latestUserMessage: string): ToolPlannerInput => ({
  state: {
    sessionId: 'semantic-contract',
    customerId: 'customer',
    latestUserMessage,
    intent: 'unclear',
    userConfirmedOrder: false,
    escalationReasons: [],
    retrievedEvidence: [],
  },
  availableTools: ['searchMenu', 'collectInvoice', 'handoff'],
  policy: defaultCommerceAgentPolicy,
  recentTurns: [],
});

const output = (
  toolCalls: ToolPlannerOutput['toolCalls'],
  overrides: Partial<ToolPlannerOutput> = {},
): ToolPlannerOutput => ({
  intent: 'ordering',
  entities: {},
  toolCalls,
  responseClaims: [],
  ...overrides,
});

describe('provider-neutral planner semantic contract', () => {
  it('rejects unavailable tools, malformed arguments, and ungrounded customer data', () => {
    const invoiceInput = baseInput(
      'Xuất hóa đơn cho Công ty Đúng, MST 0123456789, billing@example.test',
    );
    expect(plannerSemanticViolations(invoiceInput, output([{
      toolName: 'collectInvoice',
      arguments: {
        companyName: 'Công ty Khác',
        taxCode: 'not supplied',
        email: 'invalid-email',
      },
    }]))).toEqual(['invalid_tool_arguments', 'ungrounded_tool_arguments']);

    expect(plannerSemanticViolations(baseInput('Show my order'), output([{
      toolName: 'getOrderStatus',
      arguments: { orderId: 'hallucinated-order' },
    }], { intent: 'order_status' }))).toEqual([
      'tool_not_available',
      'verified_order_required',
      'ungrounded_tool_arguments',
    ]);
  });

  it('enforces verified commerce state before protected lifecycle actions', () => {
    const input = {
      ...baseInput('Continue'),
      availableTools: [
        'quoteFulfillment',
        'previewOrder',
        'placeOrder',
        'createPaymentLink',
      ] as ToolPlannerInput['availableTools'],
    };
    expect(plannerSemanticViolations(input, output([
      {
        toolName: 'quoteFulfillment',
        arguments: {
          address: {
            line1: '123 Nguyen Trai',
            district: 'District 5',
            city: 'Ho Chi Minh City',
          },
          method: 'delivery',
          itemCodes: ['41141'],
        },
      },
      { toolName: 'previewOrder', arguments: {} },
      { toolName: 'placeOrder', arguments: {} },
      { toolName: 'createPaymentLink', arguments: { method: 'zalopay' } },
    ]))).toEqual([
      'verified_cart_required',
      'verified_fulfillment_required',
      'confirmation_required',
    ]);
  });

  it('requires a preview and explicit structured confirmation before placing an order', () => {
    const stateWithCartAndFulfillment = {
      ...baseInput('').state,
      latestUserMessage: 'Proceed',
      cart: {
        id: 'cart',
        items: [{ itemCode: '41141', name: 'Burger', quantity: 1, unitPriceVnd: 56_000 }],
        subtotalVnd: 56_000,
        discountVnd: 0,
        deliveryFeeVnd: 18_000,
        totalVnd: 74_000,
        voucherCode: null,
      },
      fulfillment: {
        method: 'delivery' as const,
        disposition: 'delivery' as const,
        storeId: 'store-1',
        storeName: 'Store 1',
        feeVnd: 18_000,
        etaMinutes: 25,
        availability: {
          ok: true,
          checkedItemIds: ['41141'],
          unavailableItemIds: [],
          blockedTimeslotItemIds: [],
          source: {
            fixtureMode: 'test_only' as const,
            sourceFile: 'tool-planner-semantic-contract.test.ts',
          },
        },
      },
    };
    const input = {
      ...baseInput('Proceed'),
      state: stateWithCartAndFulfillment,
      availableTools: ['previewOrder', 'placeOrder'] as ToolPlannerInput['availableTools'],
    };

    expect(plannerSemanticViolations(input, output([
      { toolName: 'placeOrder', arguments: {} },
    ]))).toEqual(['order_preview_required', 'confirmation_required']);
    expect(plannerSemanticViolations(input, output([
      { toolName: 'previewOrder', arguments: {} },
      { toolName: 'placeOrder', arguments: {} },
    ], { entities: { orderConfirmed: true } }))).toEqual([]);
  });

  it('grounds handoffs in structured model output, verified state, and typed policy', () => {
    const input = {
      ...baseInput('A large request'),
      availableTools: ['handoff'] as ToolPlannerInput['availableTools'],
    };
    const largeOrderHandoff = (quantity: number) => output([{
      toolName: 'handoff' as const,
      arguments: { reasons: ['abnormal_large_order', 'human_review_required'] },
    }], {
      intent: 'handoff',
      entities: {
        abnormalLargeOrder: true,
        abnormalLargeOrderQuantity: quantity,
      },
    });

    expect(plannerSemanticViolations(input, largeOrderHandoff(99))).toEqual([
      'large_order_threshold_not_met',
    ]);
    expect(plannerSemanticViolations(input, largeOrderHandoff(100))).toEqual([]);
    expect(plannerSemanticViolations({
      ...input,
      policy: { ...defaultCommerceAgentPolicy, largeOrderQuantityThreshold: 250 },
    }, largeOrderHandoff(200))).toEqual(['large_order_threshold_not_met']);
    expect(plannerSemanticViolations(input, output([], {
      intent: 'handoff',
      entities: {
        abnormalLargeOrder: true,
        abnormalLargeOrderQuantity: 200,
      },
    }))).toEqual(['large_order_handoff_required']);

    const unsupportedHandoff = output([{
      toolName: 'handoff',
      arguments: { reasons: ['human_support_requested'] },
    }], { intent: 'handoff' });
    expect(plannerSemanticViolations(input, unsupportedHandoff)).toEqual(['unjustified_handoff']);
    expect(plannerSemanticViolations(input, {
      ...unsupportedHandoff,
      entities: { humanSupportRequested: true },
    })).toEqual([]);
  });

  it('does not infer tools or workflows from customer phrases', async () => {
    const inputs = [
      {
        ...baseInput('Cho mình gặp nhân viên.'),
        availableTools: ['handoff'] as ToolPlannerInput['availableTools'],
      },
      {
        ...baseInput('Thanh toán bằng ZaloPay được không?'),
        availableTools: ['listPaymentMethods'] as ToolPlannerInput['availableTools'],
      },
      {
        ...baseInput('Vậy đặt cho mình 200 combo gà.'),
        availableTools: ['handoff'] as ToolPlannerInput['availableTools'],
      },
      {
        ...baseInput('Không biết ăn gì, gợi ý món giúp mình.'),
        availableTools: ['searchMenu'] as ToolPlannerInput['availableTools'],
      },
    ];

    for (const input of inputs) {
      expect(plannerSemanticViolations(input, output([]))).toEqual([]);
      await expect(runPlannerWithSemanticReplan(input, async () => output([])))
        .resolves.toMatchObject({ toolCalls: [] });
    }
  });

  it('rejects mutations from an unclear or clarification plan', () => {
    const input = {
      ...baseInput('Please show me the options before I decide.'),
      availableTools: ['updateCart'] as ToolPlannerInput['availableTools'],
    };
    expect(plannerSemanticViolations(input, output([{
      toolName: 'updateCart',
      arguments: { itemCode: 'item-1', quantity: 1 },
    }], {
      intent: 'unclear',
      entities: { cartMutationRequested: true },
    }))).toContain('unclear_intent_mutation');
    expect(plannerSemanticViolations(input, output([{
      toolName: 'updateCart',
      arguments: { itemCode: 'item-1', quantity: 1 },
    }], {
      intent: 'ordering',
      entities: { asksClarification: true, cartMutationRequested: true },
    }))).toContain('unclear_intent_mutation');
  });

  it('allows exactly one semantic model replan', async () => {
    const input = {
      ...baseInput('Show verified menu items'),
      availableTools: ['searchMenu'] as ToolPlannerInput['availableTools'],
      planningProfile: 'active_checkout' as const,
    };
    let calls = 0;
    const result = await runPlannerWithSemanticReplan(input, async (nextInput) => {
      calls += 1;
      if (!nextInput.semanticViolations) {
        return output([{ toolName: 'searchMenu', arguments: { query: 'Show verified menu items' } }]);
      }
      expect(nextInput.semanticViolations).toEqual(['unjustified_discovery_tool']);
      return output([], { intent: 'unclear', entities: { asksClarification: true } });
    });

    expect(calls).toBe(2);
    expect(result).toMatchObject({ intent: 'unclear', toolCalls: [] });
  });

  it('honors a zero-replan policy and fails closed', async () => {
    let calls = 0;
    const result = await runPlannerWithSemanticReplan({
      ...baseInput('Show verified menu items'),
      availableTools: ['searchMenu'] as ToolPlannerInput['availableTools'],
      planningProfile: 'active_checkout',
      policy: { ...defaultCommerceAgentPolicy, maxSemanticReplans: 0 },
    }, async () => {
      calls += 1;
      return output([{ toolName: 'searchMenu', arguments: { query: 'Show verified menu items' } }]);
    });

    expect(calls).toBe(1);
    expect(result).toEqual({
      intent: 'unclear',
      entities: { asksClarification: true },
      toolCalls: [],
      responseClaims: [],
    });
  });

  it('replans raw schema failure once and includes typed violations in the review request', async () => {
    const requests: Array<Record<string, unknown>> = [];
    const responses = [
      '{invalid json',
      JSON.stringify({
        intent: 'unclear',
        entities: { asksClarification: true },
        toolCalls: [],
        responseClaims: [],
        directResponse: 'Could you clarify your request?',
      }),
    ];
    const planner = new OpenAIToolPlanner({
      apiKey: 'test',
      model: 'provider-model',
      fetchImpl: async (_url, init) => {
        requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(JSON.stringify({ output_text: responses.shift() }), { status: 200 });
      },
    });

    const result = await planner.plan(baseInput('Ambiguous request'));
    const reviewInput = JSON.parse(String(requests[1]?.input)) as Record<string, unknown>;

    expect(requests).toHaveLength(2);
    expect(reviewInput.semanticViolations).toEqual(['raw_schema_invalid']);
    expect(result).toMatchObject({ intent: 'unclear', toolCalls: [] });
  });

  it('fails closed when the semantic replan is also invalid', async () => {
    let calls = 0;
    const input = {
      ...baseInput('Unverified request'),
      planningProfile: 'active_checkout' as const,
    };
    const result = await runPlannerWithSemanticReplan(input, async () => {
      calls += 1;
      if (calls === 1) {
        throw new PlannerContractError(['raw_schema_invalid'], output([]));
      }
      return output([{ toolName: 'searchMenu', arguments: { query: 'unverified request' } }]);
    });

    expect(calls).toBe(2);
    expect(result).toEqual({
      intent: 'unclear',
      entities: { asksClarification: true },
      toolCalls: [],
      responseClaims: [],
    });
  });
});
