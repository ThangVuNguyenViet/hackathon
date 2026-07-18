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

  it('rejects order-status reads without a verified order', async () => {
    const input = {
      ...baseInput('Đơn gì mà lâu quá vậy, bực mình thật.'),
      availableTools: ['getOrderStatus'] as ToolPlannerInput['availableTools'],
    };
    const ungrounded = output([{
      toolName: 'getOrderStatus',
      arguments: { orderId: 'hallucinated-order' },
    }], { intent: 'order_status' });

    expect(plannerSemanticViolations(input, ungrounded)).toEqual(['ungrounded_tool_arguments']);
    await expect(runPlannerWithSemanticReplan(input, async (nextInput) =>
      nextInput.semanticViolations ? output([]) : ungrounded
    )).resolves.toMatchObject({ toolCalls: [] });
    expect(plannerSemanticViolations({
      ...input,
      state: {
        ...input.state,
        order: {
          id: 'verified-order',
          cart: {
            id: 'cart',
            items: [],
            subtotalVnd: 0,
            discountVnd: 0,
            deliveryFeeVnd: 0,
            totalVnd: 0,
            voucherCode: null,
          },
          status: 'preparing',
          paymentStatus: 'paid',
          assignedStoreId: 'store',
          createdAt: '2026-07-18T00:00:00.000Z',
        },
      },
    }, output([{
      toolName: 'getOrderStatus',
      arguments: { orderId: 'verified-order' },
    }], { intent: 'order_status' }))).toEqual([]);
  });

  it('keeps a separate reorder redirect from re-reading the submitted order', async () => {
    const input = {
      ...baseInput('Chưa hủy, cho mình đặt lại đơn lần trước cho đồng nghiệp.'),
      availableTools: ['getOrderStatus', 'handoff'] as ToolPlannerInput['availableTools'],
      state: {
        ...baseInput('').state,
        latestUserMessage: 'Chưa hủy, cho mình đặt lại đơn lần trước cho đồng nghiệp.',
        order: {
          id: 'KFC-1024',
          cart: {
            id: 'submitted-cart',
            items: [],
            subtotalVnd: 0,
            discountVnd: 0,
            deliveryFeeVnd: 0,
            totalVnd: 0,
            voucherCode: null,
          },
          status: 'preparing' as const,
          paymentStatus: 'paid' as const,
          assignedStoreId: 'store',
          createdAt: '2026-07-18T00:00:00.000Z',
        },
      },
    };
    const unrelatedStatusRead = output([{
      toolName: 'getOrderStatus',
      arguments: { orderId: 'KFC-1024' },
    }], { intent: 'order_status' });

    expect(plannerSemanticViolations(input, unrelatedStatusRead)).toEqual(['unjustified_order_status_read']);
    await expect(runPlannerWithSemanticReplan(input, async () => unrelatedStatusRead)).resolves.toMatchObject({
      intent: 'ordering',
      contextPolicy: { recentOrder: 'confirm_before_use' },
      entities: { asksClarification: true, reorderConfirmationRequested: true },
      toolCalls: [],
    });
    expect(plannerSemanticViolations({
      ...input,
      state: {
        ...input.state,
        latestUserMessage: 'Nếu đơn đang giao rồi thì sao, mình vẫn muốn hủy đơn.',
      },
    }, output([{
      toolName: 'getOrderStatus',
      arguments: { orderId: 'KFC-1024' },
    }], { intent: 'order_status' }))).toEqual([]);
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

  it('recovers an explicit human request without escalating employee references', async () => {
    const input = {
      ...baseInput('Cho mình gặp nhân viên.'),
      availableTools: ['handoff'] as ToolPlannerInput['availableTools'],
    };
    expect(plannerSemanticViolations(input, output([]))).toEqual(['missing_required_handoff']);
    await expect(runPlannerWithSemanticReplan(input, async () => output([]))).resolves.toMatchObject({
      intent: 'handoff',
      entities: { humanSupportRequested: true },
      toolCalls: [{ toolName: 'handoff', arguments: { reasons: ['human_support_requested'] } }],
    });
    expect(plannerSemanticViolations({
      ...input,
      state: { ...input.state, latestUserMessage: 'Mình muốn khiếu nại thái độ nhân viên.' },
    }, output([]))).toEqual([]);
    expect(plannerSemanticViolations({
      ...input,
      state: { ...input.state, latestUserMessage: 'Cho mình số điện thoại nhân viên.' },
    }, output([]))).toEqual([]);
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

  it('compiles a verified saved-address confirmation into only the required fulfillment quote', async () => {
    const savedAddress = {
      label: 'Địa chỉ cũ',
      line1: '123 Nguyễn Trãi',
      district: 'Quận 5',
      city: 'Hồ Chí Minh',
    };
    const input = {
      ...baseInput('Đúng rồi.'),
      availableTools: ['quoteFulfillment', 'listPaymentMethods'] as ToolPlannerInput['availableTools'],
      state: {
        ...baseInput('').state,
        latestUserMessage: 'Đúng rồi.',
        customerContext: { savedAddresses: [savedAddress], favorites: [], recentOrders: [] },
        cart: {
          id: 'cart',
          items: [{ itemCode: '41141', name: 'Burger Gà Zinger', quantity: 1, unitPriceVnd: 56_000 }],
          subtotalVnd: 56_000,
          discountVnd: 0,
          deliveryFeeVnd: 0,
          totalVnd: 56_000,
          voucherCode: null,
        },
      },
      recentTurns: [
        { role: 'user' as const, text: 'Vậy lấy Zinger Burger, giao tới địa chỉ đã lưu nha.' },
        { role: 'assistant' as const, text: 'Mình đã cập nhật món bạn chọn vào giỏ.' },
      ] as ToolPlannerInput['recentTurns'],
    };
    const missingQuote = output([], {
      entities: { addressChangeRequested: true },
    });
    expect(plannerSemanticViolations(input, missingQuote)).toEqual(['missing_fulfillment_quote']);
    await expect(runPlannerWithSemanticReplan(input, async () => missingQuote)).resolves.toMatchObject({
      intent: 'ordering',
      savedAddressDecision: { addressIndex: 0, decision: 'accept' },
      entities: {
        savedAddressDecision: { addressIndex: 0, decision: 'accept' },
        useSavedAddress: true,
        fulfillmentAccepted: true,
      },
      toolCalls: [{
        toolName: 'quoteFulfillment',
        arguments: {
          address: savedAddress,
          method: 'delivery',
          itemCodes: ['41141'],
        },
      }],
    });

    const quoteWithUnrelatedPaymentRead = output([
      {
        toolName: 'quoteFulfillment',
        arguments: { address: savedAddress, method: 'delivery', itemCodes: ['41141'] },
      },
      { toolName: 'listPaymentMethods', arguments: {} },
    ]);
    expect(plannerSemanticViolations(input, quoteWithUnrelatedPaymentRead)).toEqual(['unjustified_discovery_tool']);
    await expect(runPlannerWithSemanticReplan(input, async () => quoteWithUnrelatedPaymentRead)).resolves.toMatchObject({
      toolCalls: [{ toolName: 'quoteFulfillment' }],
    });

    expect(plannerSemanticViolations({
      ...input,
      recentTurns: [
        { role: 'assistant' as const, text: 'Bạn muốn tiếp tục không?' },
      ] as ToolPlannerInput['recentTurns'],
    }, output([]))).toEqual([]);
  });

  it('recovers a verified read-only recommendation without treating a decline as a request', async () => {
    const recommendationInput = {
      ...baseInput('Không biết ăn gì, gợi ý cho nhóm 4 người với, ngân sách khoảng 300k.'),
      availableTools: ['searchMenu', 'listPaymentMethods'] as ToolPlannerInput['availableTools'],
      menuCatalogContext: {
        query: 'combo nhóm',
        candidates: [{
          code: 'combo-group', itemId: 'combo-group', productCode: 'combo-group', name: 'Combo nhóm',
          category: 'Combo', description: 'Verified group combo', priceVnd: 300_000, originalPriceVnd: null,
          imageUrl: 'https://example.test/combo.jpg', available: true, verifiedForMutation: true as const,
          verificationQuery: 'combo nhóm', isQuickCombo: true, modifierGroups: [],
        }],
      },
    };
    expect(plannerSemanticViolations(recommendationInput, output([]))).toEqual(['missing_recommendation_read']);
    await expect(runPlannerWithSemanticReplan(recommendationInput, async () => output([]))).resolves.toMatchObject({
      intent: 'ordering',
      toolCalls: [{ toolName: 'searchMenu', arguments: { query: 'Combo' } }],
    });
    const mixedReadInput = {
      ...recommendationInput,
      state: { ...recommendationInput.state, latestUserMessage: 'Gợi ý món và cho mình xem cách thanh toán bằng thẻ.' },
    };
    await expect(runPlannerWithSemanticReplan(mixedReadInput, async () => output([]))).resolves.toMatchObject({
      toolCalls: [{ toolName: 'searchMenu' }, { toolName: 'listPaymentMethods' }],
    });
    expect(plannerSemanticViolations({
      ...recommendationInput,
      state: { ...recommendationInput.state, latestUserMessage: 'Không cần gợi ý món khác.' },
    }, output([]))).toEqual([]);
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
    expect(plannerSemanticViolations(unverifiedMetadataInput, metadataPlan)).toEqual([]);
    await expect(runPlannerWithSemanticReplan(unverifiedMetadataInput, async () => metadataPlan)).resolves.toMatchObject({
      toolCalls: [expect.objectContaining({ toolName: 'checkStoreAvailability' })],
    });
    expect(plannerSemanticViolations(metadataInput, metadataPlan)).toEqual(['unjustified_availability_recheck']);
    await expect(runPlannerWithSemanticReplan(metadataInput, async () => metadataPlan)).resolves.toMatchObject({
      toolCalls: [],
    });
    const prematureCheckoutPlan = output(
      [
        metadataPlan.toolCalls[0]!,
        { toolName: 'previewOrder', arguments: {} },
        { toolName: 'placeOrder', arguments: {} },
        { toolName: 'createPaymentLink', arguments: { method: 'zalopay' } },
      ],
      { entities: { fulfillmentAccepted: true, orderConfirmed: true } },
    );
    expect(plannerSemanticViolations(metadataInput, prematureCheckoutPlan)).toEqual([
      'unjustified_checkout_execution',
    ]);
    await expect(runPlannerWithSemanticReplan(metadataInput, async () => prematureCheckoutPlan)).resolves.toMatchObject({
      entities: { fulfillmentAccepted: false, orderConfirmed: false },
      toolCalls: [],
    });
    const entityOnlyCheckoutPlan = output([], {
      entities: { fulfillmentAccepted: true, orderConfirmed: true },
    });
    expect(plannerSemanticViolations(metadataInput, entityOnlyCheckoutPlan)).toEqual([
      'unjustified_checkout_execution',
    ]);
    await expect(runPlannerWithSemanticReplan(metadataInput, async () => entityOnlyCheckoutPlan)).resolves.toMatchObject({
      entities: { fulfillmentAccepted: false, orderConfirmed: false },
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
