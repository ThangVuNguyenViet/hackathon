import { describe, expect, it } from 'vitest';
import {
  contextEvalCases,
  contextEvalDatasetName,
  evaluateContextRun,
  type ContextEvalRunOutput,
} from '../../src/evaluation/contextEvalCases.js';

describe('context eval cases', () => {
  it('defines the 14 golden context relevance cases', () => {
    expect(contextEvalDatasetName).toBe('kfc-context-relevance-golden-v1');
    expect(contextEvalCases.map((testCase) => testCase.inputs.caseId)).toEqual([
      'ctx-greeting-existing-cart-001',
      'ctx-greeting-continue-cart-001',
      'ctx-menu-existing-cart-001',
      'ctx-menu-add-current-cart-001',
      'ctx-cart-edit-ambiguous-one-item-001',
      'ctx-cart-edit-named-item-001',
      'ctx-reorder-clarify-previous-order-001',
      'ctx-reorder-confirmed-previous-order-001',
      'ctx-loyalty-existing-cart-001',
      'ctx-loyalty-apply-current-cart-001',
      'ctx-complaint-ignore-cart-001',
      'ctx-complaint-cart-related-001',
      'ctx-handoff-ignore-cart-001',
      'ctx-handoff-cart-related-001',
    ]);

    const greetingCase = contextEvalCases.find((testCase) => testCase.inputs.caseId === 'ctx-greeting-existing-cart-001');
    expect(greetingCase?.outputs.mustNotMention).toEqual(
      expect.arrayContaining(['Combo Hợp Gu 99K', 'giỏ hàng', 'địa chỉ giao hàng', 'thanh toán', 'xác nhận đơn']),
    );
    expect(greetingCase?.outputs.forbiddenToolNames).toEqual(
      expect.arrayContaining(['updateCart', 'previewOrder', 'placeOrder', 'createPaymentLink']),
    );
  });

  it('passes deterministic evaluator output for a clean neutral greeting', () => {
    const testCase = contextEvalCases.find((candidate) => candidate.inputs.caseId === 'ctx-greeting-existing-cart-001');
    expect(testCase).toBeDefined();
    const output: ContextEvalRunOutput = {
      responseText: 'Chào bạn! Bạn cần mình giúp gì thêm không?',
      toolNames: [],
      beforeState: { cartItems: [{ itemCode: '20751', quantity: 1 }], orderId: null, paymentUrl: null },
      afterState: { cartItems: [{ itemCode: '20751', quantity: 1 }], orderId: null, paymentUrl: null },
    };

    expect(evaluateContextRun(testCase!, output)).toMatchObject({
      context_relevance_pass: true,
      forbidden_context_absent: true,
      forbidden_tools_absent: true,
      state_mutation_allowed: true,
      required_behavior_present: true,
    });
  });

  it('fails deterministic evaluator output for forbidden context, tools, and mutation', () => {
    const testCase = contextEvalCases.find((candidate) => candidate.inputs.caseId === 'ctx-greeting-existing-cart-001');
    expect(testCase).toBeDefined();
    const output: ContextEvalRunOutput = {
      responseText: 'Mình vẫn giữ Combo Hợp Gu 99K trong giỏ hàng.',
      toolNames: ['updateCart'],
      beforeState: { cartItems: [{ itemCode: '20751', quantity: 1 }], orderId: null, paymentUrl: null },
      afterState: { cartItems: [{ itemCode: '20751', quantity: 2 }], orderId: null, paymentUrl: null },
    };

    expect(evaluateContextRun(testCase!, output)).toMatchObject({
      context_relevance_pass: false,
      forbidden_context_absent: false,
      forbidden_tools_absent: false,
      state_mutation_allowed: false,
    });
  });

  it('requires structured reply intent for clarification checks', () => {
    const testCase = contextEvalCases.find((candidate) => candidate.inputs.caseId === 'ctx-cart-edit-ambiguous-one-item-001');
    expect(testCase).toBeDefined();
    const output: ContextEvalRunOutput = {
      responseText: 'Bạn muốn bỏ món nào trong giỏ hàng hiện tại?',
      toolNames: [],
      beforeState: { cartItems: [{ itemCode: '20751', quantity: 1 }], orderId: null, paymentUrl: null },
      afterState: { cartItems: [{ itemCode: '20751', quantity: 1 }], orderId: null, paymentUrl: null },
      replyIntent: 'general_reply',
    };

    expect(evaluateContextRun(testCase!, output).required_behavior_present).toBe(false);
  });
});
