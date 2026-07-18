import { describe, expect, it } from 'vitest';
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
  it('rejects malformed and customer-ungrounded invoice arguments', () => {
    const input = baseInput('Xuất hóa đơn cho Công ty Đúng, MST 0123456789, billing@example.test');

    expect(plannerSemanticViolations(input, output([{
      toolName: 'collectInvoice',
      arguments: {
        companyName: 'Công ty Khác',
        taxCode: 'not supplied',
        email: 'invalid-email',
      },
    }]))).toEqual(['invalid_tool_arguments', 'ungrounded_tool_arguments']);
  });

  it('rejects discovery without catalog evidence and accepts verified discovery', () => {
    const input = { ...baseInput('unknown item'), planningProfile: 'active_checkout' as const };
    const plan = output([{ toolName: 'searchMenu', arguments: { query: 'unknown item' } }]);

    expect(plannerSemanticViolations(input, plan)).toEqual(['unjustified_discovery_tool']);
    expect(plannerSemanticViolations({
      ...input,
      menuCatalogContext: {
        query: input.state.latestUserMessage,
        candidates: [{
          code: 'verified', itemId: 'verified', productCode: 'verified', name: 'Verified item',
          category: 'Menu', description: 'Verified result', priceVnd: 1, originalPriceVnd: null,
          imageUrl: 'https://example.test/item.jpg', available: true, verifiedForMutation: true,
          verificationQuery: input.state.latestUserMessage, modifierGroups: [],
        }],
      },
    }, plan)).toEqual([]);
  });

  it('requires state or structured semantic evidence for handoff', () => {
    const input = baseInput('A privacy-sensitive request');
    const plan = output(
      [{ toolName: 'handoff', arguments: { reasons: ['human_support_requested'] } }],
      { intent: 'handoff' },
    );

    expect(plannerSemanticViolations(input, plan)).toEqual(['unjustified_handoff']);
    expect(plannerSemanticViolations(input, {
      ...plan,
      entities: { humanSupportRequested: true },
    })).toEqual([]);
  });

  it('recovers the required payment-method read without confusing payment status', async () => {
    const availabilityInput = {
      ...baseInput('Thanh toán bằng ZaloPay được không?'),
      availableTools: ['listPaymentMethods'] as ToolPlannerInput['availableTools'],
    };
    expect(plannerSemanticViolations(availabilityInput, output([]))).toEqual(['missing_payment_method_read']);
    await expect(runPlannerWithSemanticReplan(availabilityInput, async () => {
      throw new PlannerContractError(['raw_schema_invalid'], output([]));
    })).resolves.toMatchObject({
      intent: 'payment',
      toolCalls: [{ toolName: 'listPaymentMethods', arguments: {} }],
    });

    const statusInput = {
      ...baseInput('Thanh toán ZaloPay đã thành công chưa?'),
      availableTools: ['listPaymentMethods'] as ToolPlannerInput['availableTools'],
    };
    expect(plannerSemanticViolations(statusInput, output([]))).toEqual([]);
  });

  it('rejects a missed abnormal-order handoff and an unrelated repeated availability read', async () => {
    const abnormalInput = {
      ...baseInput('Vậy đặt cho mình 200 combo gà, giao trong 30 phút.'),
      availableTools: ['handoff'] as ToolPlannerInput['availableTools'],
    };
    expect(plannerSemanticViolations(abnormalInput, output([]))).toEqual(['missing_required_handoff']);
    expect(plannerSemanticViolations(abnormalInput, output([{
      toolName: 'handoff',
      arguments: { reasons: ['abnormal_large_order', 'human_review_required'] },
    }], {
      intent: 'handoff',
      entities: { abnormalLargeOrder: true },
    }))).toEqual([]);
    await expect(runPlannerWithSemanticReplan(abnormalInput, async () => output([]))).resolves.toMatchObject({
      intent: 'handoff',
      entities: { abnormalLargeOrder: true },
      toolCalls: [{ toolName: 'handoff', arguments: { reasons: ['abnormal_large_order', 'human_review_required'] } }],
    });
    await expect(runPlannerWithSemanticReplan(abnormalInput, async () => {
      throw new PlannerContractError(['raw_schema_invalid'], output([]));
    })).resolves.toMatchObject({
      intent: 'handoff',
      toolCalls: [{ toolName: 'handoff' }],
    });
    const mixedSafetyInput = {
      ...baseInput('Thanh toán 200 combo bằng ZaloPay được không?'),
      availableTools: ['listPaymentMethods', 'handoff'] as ToolPlannerInput['availableTools'],
    };
    await expect(runPlannerWithSemanticReplan(mixedSafetyInput, async () => output([]))).resolves.toMatchObject({
      intent: 'handoff',
      toolCalls: [{ toolName: 'handoff' }],
    });

    const metadataInput = {
      ...baseInput('Ghi chú giúp mình giao ở lễ tân, xuất hóa đơn công ty nhé.'),
      availableTools: ['checkStoreAvailability'] as ToolPlannerInput['availableTools'],
      state: {
        ...baseInput('').state,
        latestUserMessage: 'Ghi chú giúp mình giao ở lễ tân, xuất hóa đơn công ty nhé.',
        fulfillment: {
          method: 'delivery' as const,
          disposition: 'delivery' as const,
          storeId: 'store-1',
          storeName: 'Store 1',
          feeVnd: 18_000,
          etaMinutes: 25,
          availability: {
            ok: true,
            checkedItemIds: ['item-1'],
            unavailableItemIds: [],
            blockedTimeslotItemIds: [],
            source: { fixtureMode: 'test_only' as const, sourceFile: 'tool-planner-semantic-contract.test.ts' },
          },
        },
      },
    };
    const metadataPlan = output([{
      toolName: 'checkStoreAvailability',
      arguments: { storeId: 'store-1', itemCodes: ['item-1'], disposition: 'delivery' },
    }]);
    const unverifiedMetadataInput = {
      ...baseInput('Ghi chú giúp mình giao ở lễ tân, xuất hóa đơn công ty nhé.'),
      availableTools: ['checkStoreAvailability'] as ToolPlannerInput['availableTools'],
    };
    expect(plannerSemanticViolations(unverifiedMetadataInput, metadataPlan)).toEqual(['unjustified_availability_recheck']);
    expect(plannerSemanticViolations(metadataInput, metadataPlan)).toEqual(['unjustified_availability_recheck']);
    await expect(runPlannerWithSemanticReplan(metadataInput, async () => metadataPlan)).resolves.toMatchObject({
      toolCalls: [],
    });
    const prematureCheckoutPlan = output([
      metadataPlan.toolCalls[0]!,
      { toolName: 'previewOrder', arguments: {} },
      { toolName: 'placeOrder', arguments: {} },
      { toolName: 'createPaymentLink', arguments: { method: 'zalopay' } },
    ]);
    expect(plannerSemanticViolations(metadataInput, prematureCheckoutPlan)).toEqual([
      'unjustified_checkout_execution',
    ]);
    await expect(runPlannerWithSemanticReplan(metadataInput, async () => prematureCheckoutPlan)).resolves.toMatchObject({
      toolCalls: [],
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
    const planner = new OpenAIToolPlanner({
      apiKey: 'test',
      model: 'provider-model',
      fetchImpl: async () => {
        calls += 1;
        return new Response(JSON.stringify({ output_text: JSON.stringify({
          intent: 'ordering',
          entities: {},
          toolCalls: [{ toolName: 'searchMenu', arguments: { query: 'unverified request' } }],
          responseClaims: [],
        }) }), { status: 200 });
      },
    });

    await expect(planner.plan({
      ...baseInput('Unverified request'),
      planningProfile: 'active_checkout',
    })).resolves.toEqual({
      intent: 'unclear',
      entities: { asksClarification: true },
      toolCalls: [],
      responseClaims: [],
    });
    expect(calls).toBe(2);
  });
});
