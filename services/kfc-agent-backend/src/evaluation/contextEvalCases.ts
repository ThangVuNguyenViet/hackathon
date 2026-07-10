import type { Cart, CartItem, Order } from '../domain/types.js';
import type { ToolName } from '../ordering/types.js';

export const contextEvalDatasetName = 'kfc-context-relevance-golden-v1';
export const contextEvalSchemaVersion = 'kfc-context-eval-v1';

export type ContextRelevanceLabel = 'active' | 'confirm_before_use' | 'background_only' | 'irrelevant' | 'for_operator_only';

export interface ContextEvalInput {
  caseId: string;
  caseCategory:
    | 'greeting_small_talk'
    | 'menu_browsing'
    | 'ambiguous_cart_edit'
    | 'reorder_post_order'
    | 'loyalty_membership'
    | 'support_complaint'
    | 'human_handoff';
  channel: 'web_mock';
  language: 'vi-VN';
  turnsBefore: Array<{ role: 'user' | 'assistant'; text: string }>;
  latestUserMessage: string;
  preExistingContext: {
    cart?: Cart;
    recentOrder?: Order;
    membership?: { loyaltyPoints: number };
  };
  contextRelevance: Record<string, ContextRelevanceLabel>;
  allowedContextUses: string[];
  forbiddenContextUses: string[];
  mustUseTools: ToolName[];
  mustNotUseTools: ToolName[];
  expectedReplyBehavior: string;
}

export interface ContextEvalExpectedOutput {
  contextPolicy: string;
  expectedIntent: string;
  mustMention: string[];
  mustNotMention: string[];
  mustAskClarification: boolean;
  mustHandoff: boolean;
  mutationAllowed: boolean;
  allowedToolNames: ToolName[];
  forbiddenToolNames: ToolName[];
  qualityRubric: string[];
}

export interface ContextEvalCase {
  inputs: ContextEvalInput;
  outputs: ContextEvalExpectedOutput;
}

export interface ContextEvalStateSummary {
  cartItems: Array<Pick<CartItem, 'itemCode' | 'quantity'>>;
  orderId: string | null;
  paymentUrl: string | null;
  handoffId?: string | null;
}

export interface ContextEvalRunOutput {
  responseText: string;
  toolNames: string[];
  beforeState: ContextEvalStateSummary;
  afterState: ContextEvalStateSummary;
  replyIntent?: string;
}

export interface ContextEvalScores {
  context_relevance_pass: boolean;
  forbidden_context_absent: boolean;
  required_behavior_present: boolean;
  forbidden_tools_absent: boolean;
  required_tools_present: boolean;
  state_mutation_allowed: boolean;
}

function cart(items: CartItem[], id = 'cart_context_eval'): Cart {
  const subtotalVnd = items.reduce((sum, item) => sum + item.unitPriceVnd * item.quantity, 0);
  return {
    id,
    items,
    subtotalVnd,
    discountVnd: 0,
    deliveryFeeVnd: 0,
    totalVnd: subtotalVnd,
    voucherCode: null,
  };
}

const comboItem: CartItem = {
  itemCode: '20751',
  name: 'Combo Hợp Gu 99K',
  quantity: 1,
  unitPriceVnd: 99000,
};

const existingCart = cart([comboItem], 'cart_existing_context_eval');

const previousOrder: Order = {
  id: 'order_previous_context_eval',
  cart: existingCart,
  status: 'completed',
  paymentStatus: 'paid',
  assignedStoreId: 'KFCVN0002',
  createdAt: '2026-07-09T10:00:00.000Z',
};

const baseRubric = [
  'Reply is relevant to latest user message.',
  'Reply does not include irrelevant verified context.',
  'Reply does not mutate cart/order/payment state unless allowed.',
  'Reply stays natural for Messenger/Zalo.',
];

function caseWithDefaults(input: {
  caseId: ContextEvalInput['caseId'];
  caseCategory: ContextEvalInput['caseCategory'];
  latestUserMessage: string;
  contextPolicy: string;
  expectedIntent: string;
  preExistingContext?: ContextEvalInput['preExistingContext'];
  contextRelevance: ContextEvalInput['contextRelevance'];
  allowedContextUses?: string[];
  forbiddenContextUses?: string[];
  mustUseTools?: ToolName[];
  mustNotUseTools?: ToolName[];
  expectedReplyBehavior: string;
  mustMention?: string[];
  mustNotMention?: string[];
  mustAskClarification?: boolean;
  mustHandoff?: boolean;
  mutationAllowed?: boolean;
  allowedToolNames?: ToolName[];
  turnsBefore?: ContextEvalInput['turnsBefore'];
}): ContextEvalCase {
  const mustUseTools = input.mustUseTools ?? [];
  const forbiddenToolNames = input.mustNotUseTools ?? ['updateCart', 'previewOrder', 'placeOrder', 'createPaymentLink'];
  return {
    inputs: {
      caseId: input.caseId,
      caseCategory: input.caseCategory,
      channel: 'web_mock',
      language: 'vi-VN',
      turnsBefore: input.turnsBefore ?? [
        { role: 'user', text: 'Cho mình 1 Combo Hợp Gu 99K' },
        { role: 'assistant', text: 'Mình đã thêm Combo Hợp Gu 99K vào giỏ hàng.' },
      ],
      latestUserMessage: input.latestUserMessage,
      preExistingContext: input.preExistingContext ?? { cart: existingCart },
      contextRelevance: input.contextRelevance,
      allowedContextUses: input.allowedContextUses ?? [],
      forbiddenContextUses: input.forbiddenContextUses ?? [],
      mustUseTools,
      mustNotUseTools: forbiddenToolNames,
      expectedReplyBehavior: input.expectedReplyBehavior,
    },
    outputs: {
      contextPolicy: input.contextPolicy,
      expectedIntent: input.expectedIntent,
      mustMention: input.mustMention ?? [],
      mustNotMention: input.mustNotMention ?? [],
      mustAskClarification: input.mustAskClarification ?? false,
      mustHandoff: input.mustHandoff ?? false,
      mutationAllowed: input.mutationAllowed ?? false,
      allowedToolNames: input.allowedToolNames ?? mustUseTools,
      forbiddenToolNames,
      qualityRubric: baseRubric,
    },
  };
}

export const contextEvalCases: ContextEvalCase[] = [
  caseWithDefaults({
    caseId: 'ctx-greeting-existing-cart-001',
    caseCategory: 'greeting_small_talk',
    latestUserMessage: 'hi',
    contextPolicy: 'ignore_existing_cart',
    expectedIntent: 'greeting',
    contextRelevance: { cart: 'irrelevant', order: 'irrelevant', recentTurns: 'background_only' },
    forbiddenContextUses: ['cart_summary', 'delivery_next_step', 'payment_next_step', 'order_continuation'],
    expectedReplyBehavior: 'Greet neutrally. Do not mention existing cart or ordering next steps.',
    mustNotMention: ['Combo Hợp Gu 99K', 'giỏ hàng', 'địa chỉ giao hàng', 'thanh toán', 'xác nhận đơn'],
  }),
  caseWithDefaults({
    caseId: 'ctx-greeting-continue-cart-001',
    caseCategory: 'greeting_small_talk',
    latestUserMessage: 'tiếp tục đơn này',
    contextPolicy: 'resume_existing_cart',
    expectedIntent: 'cart_continue',
    contextRelevance: { cart: 'active', recentTurns: 'active' },
    allowedContextUses: ['cart_summary', 'delivery_next_step'],
    expectedReplyBehavior: 'Resume the current cart and ask for the next missing ordering detail.',
    mustMention: ['địa chỉ'],
    mutationAllowed: false,
    mustNotUseTools: ['previewOrder', 'placeOrder', 'createPaymentLink'],
  }),
  caseWithDefaults({
    caseId: 'ctx-menu-existing-cart-001',
    caseCategory: 'menu_browsing',
    latestUserMessage: 'menu có gì?',
    contextPolicy: 'fresh_menu_browsing',
    expectedIntent: 'menu_browsing',
    contextRelevance: { cart: 'irrelevant', menuSearchResults: 'active' },
    mustUseTools: ['searchMenu'],
    expectedReplyBehavior: 'Answer from menu browsing results and do not mention the existing cart.',
    mustNotMention: ['giỏ hàng', 'địa chỉ giao hàng', 'thanh toán'],
  }),
  caseWithDefaults({
    caseId: 'ctx-menu-add-current-cart-001',
    caseCategory: 'menu_browsing',
    latestUserMessage: 'xem menu rồi thêm vào giỏ hiện tại',
    contextPolicy: 'menu_with_active_cart',
    expectedIntent: 'menu_browsing_cart_add',
    contextRelevance: { cart: 'active', menuSearchResults: 'active' },
    allowedContextUses: ['current_cart'],
    mustUseTools: ['searchMenu'],
    expectedReplyBehavior: 'Treat cart as relevant because the user explicitly referenced adding to it.',
    mutationAllowed: true,
    mustNotUseTools: ['previewOrder', 'placeOrder', 'createPaymentLink'],
  }),
  caseWithDefaults({
    caseId: 'ctx-cart-edit-ambiguous-one-item-001',
    caseCategory: 'ambiguous_cart_edit',
    latestUserMessage: 'bỏ món đó',
    contextPolicy: 'clarify_ambiguous_cart_edit',
    expectedIntent: 'cart_edit',
    contextRelevance: { cart: 'confirm_before_use' },
    expectedReplyBehavior: 'Ask which item to remove or confirm the item by name before mutation.',
    mustAskClarification: true,
    mustNotUseTools: ['updateCart', 'previewOrder', 'placeOrder', 'createPaymentLink'],
  }),
  caseWithDefaults({
    caseId: 'ctx-cart-edit-named-item-001',
    caseCategory: 'ambiguous_cart_edit',
    latestUserMessage: 'bỏ Combo Hợp Gu 99K',
    contextPolicy: 'active_named_cart_edit',
    expectedIntent: 'cart_edit',
    contextRelevance: { cart: 'active' },
    mustUseTools: ['updateCart'],
    expectedReplyBehavior: 'Use verified cart tools because the target item is named.',
    mutationAllowed: true,
    mustNotUseTools: ['previewOrder', 'placeOrder', 'createPaymentLink'],
  }),
  caseWithDefaults({
    caseId: 'ctx-reorder-clarify-previous-order-001',
    caseCategory: 'reorder_post_order',
    latestUserMessage: 'đặt lại đơn cũ',
    contextPolicy: 'confirm_previous_order_before_use',
    expectedIntent: 'reorder',
    preExistingContext: { recentOrder: previousOrder },
    contextRelevance: { recentOrder: 'confirm_before_use', cart: 'irrelevant' },
    expectedReplyBehavior: 'Summarize the previous order and ask whether the customer wants to reorder it.',
    mustMention: ['Đơn hàng trước'],
    mustAskClarification: true,
  }),
  caseWithDefaults({
    caseId: 'ctx-reorder-confirmed-previous-order-001',
    caseCategory: 'reorder_post_order',
    latestUserMessage: 'đúng rồi, đặt lại đơn đó',
    contextPolicy: 'confirmed_previous_order_active',
    expectedIntent: 'reorder_confirmed',
    preExistingContext: { recentOrder: previousOrder },
    contextRelevance: { recentOrder: 'active', cart: 'active' },
    mustUseTools: ['updateCart'],
    expectedReplyBehavior: 'Resume confirmed previous-order context and proceed through verified cart flow.',
    mutationAllowed: true,
    mustNotUseTools: ['previewOrder', 'placeOrder', 'createPaymentLink'],
  }),
  caseWithDefaults({
    caseId: 'ctx-loyalty-existing-cart-001',
    caseCategory: 'loyalty_membership',
    latestUserMessage: 'mình có điểm không?',
    contextPolicy: 'membership_with_cart_applicability',
    expectedIntent: 'membership',
    preExistingContext: { cart: existingCart, membership: { loyaltyPoints: 120 } },
    contextRelevance: { membership: 'active', cart: 'background_only' },
    mustUseTools: ['getMembershipProfile'],
    expectedReplyBehavior: 'Answer points/rewards and mention whether rewards can apply to the current cart.',
    mustMention: ['điểm'],
    mutationAllowed: false,
    mustNotUseTools: ['updateCart', 'previewOrder', 'placeOrder', 'createPaymentLink', 'acquireVoucher', 'redeemReward'],
  }),
  caseWithDefaults({
    caseId: 'ctx-loyalty-apply-current-cart-001',
    caseCategory: 'loyalty_membership',
    latestUserMessage: 'dùng điểm này cho giỏ hiện tại',
    contextPolicy: 'membership_apply_current_cart',
    expectedIntent: 'membership_apply',
    preExistingContext: { cart: existingCart, membership: { loyaltyPoints: 120 } },
    contextRelevance: { membership: 'active', cart: 'active' },
    mustUseTools: ['getMembershipProfile'],
    expectedReplyBehavior: 'Treat cart as relevant and follow verified reward/voucher flow with required confirmation.',
    mustAskClarification: true,
    mutationAllowed: false,
    mustNotUseTools: ['updateCart', 'previewOrder', 'placeOrder', 'createPaymentLink', 'acquireVoucher', 'redeemReward'],
  }),
  caseWithDefaults({
    caseId: 'ctx-complaint-ignore-cart-001',
    caseCategory: 'support_complaint',
    latestUserMessage: 'mình muốn khiếu nại thái độ nhân viên',
    contextPolicy: 'complaint_ignore_unrelated_cart',
    expectedIntent: 'complaint',
    contextRelevance: { complaint: 'active', cart: 'irrelevant' },
    expectedReplyBehavior: 'Focus on the complaint and do not mention current cart items.',
    mustNotMention: ['Combo Hợp Gu 99K', 'giỏ hàng'],
  }),
  caseWithDefaults({
    caseId: 'ctx-complaint-cart-related-001',
    caseCategory: 'support_complaint',
    latestUserMessage: 'món trong giỏ hiện tại bị sai',
    contextPolicy: 'complaint_current_cart_related',
    expectedIntent: 'complaint_cart_related',
    contextRelevance: { complaint: 'active', cart: 'active' },
    allowedContextUses: ['current_cart'],
    expectedReplyBehavior: 'Treat cart context as relevant and ask a targeted support clarification.',
    mustAskClarification: true,
  }),
  caseWithDefaults({
    caseId: 'ctx-handoff-ignore-cart-001',
    caseCategory: 'human_handoff',
    latestUserMessage: 'gặp nhân viên',
    contextPolicy: 'direct_handoff_cart_operator_only',
    expectedIntent: 'handoff',
    contextRelevance: { handoff: 'active', cart: 'for_operator_only' },
    mustUseTools: ['handoff'],
    expectedReplyBehavior: 'Initiate handoff without cart summary.',
    mustHandoff: true,
    mustNotMention: ['Combo Hợp Gu 99K', 'giỏ hàng'],
    mutationAllowed: true,
    mustNotUseTools: ['updateCart', 'previewOrder', 'placeOrder', 'createPaymentLink'],
  }),
  caseWithDefaults({
    caseId: 'ctx-handoff-cart-related-001',
    caseCategory: 'human_handoff',
    latestUserMessage: 'gặp nhân viên về giỏ hiện tại',
    contextPolicy: 'direct_handoff_cart_related',
    expectedIntent: 'handoff_cart_related',
    contextRelevance: { handoff: 'active', cart: 'for_operator_only' },
    allowedContextUses: ['operator_cart_context'],
    mustUseTools: ['handoff'],
    expectedReplyBehavior: 'Initiate handoff and preserve cart context for operator without turning reply into a cart recap.',
    mustHandoff: true,
    mutationAllowed: true,
    mustNotUseTools: ['updateCart', 'previewOrder', 'placeOrder', 'createPaymentLink'],
  }),
];

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd');
}

function includesNeedle(haystack: string, needle: string): boolean {
  return normalize(haystack).includes(normalize(needle));
}

function sameCartItems(left: ContextEvalStateSummary['cartItems'], right: ContextEvalStateSummary['cartItems']): boolean {
  if (left.length !== right.length) return false;
  const serialize = (items: ContextEvalStateSummary['cartItems']) =>
    items.map((item) => `${item.itemCode}:${item.quantity}`).sort().join('|');
  return serialize(left) === serialize(right);
}

function hasStateMutation(output: ContextEvalRunOutput): boolean {
  return (
    !sameCartItems(output.beforeState.cartItems, output.afterState.cartItems) ||
    output.beforeState.orderId !== output.afterState.orderId ||
    output.beforeState.paymentUrl !== output.afterState.paymentUrl
  );
}

export function evaluateContextRun(testCase: ContextEvalCase, output: ContextEvalRunOutput): ContextEvalScores {
  const forbidden_context_absent = testCase.outputs.mustNotMention.every(
    (fragment) => !includesNeedle(output.responseText, fragment),
  );
  const requiredMentionsPresent = testCase.outputs.mustMention.every((fragment) =>
    includesNeedle(output.responseText, fragment),
  );
  const clarificationPresent = !testCase.outputs.mustAskClarification || output.replyIntent === 'ask_clarification';
  const handoffPresent = !testCase.outputs.mustHandoff || Boolean(output.afterState.handoffId);
  const required_behavior_present = requiredMentionsPresent && clarificationPresent && handoffPresent;
  const forbidden_tools_absent = testCase.outputs.forbiddenToolNames.every((toolName) => !output.toolNames.includes(toolName));
  const required_tools_present = testCase.inputs.mustUseTools.every((toolName) => output.toolNames.includes(toolName));
  const state_mutation_allowed = testCase.outputs.mutationAllowed || !hasStateMutation(output);
  return {
    context_relevance_pass:
      forbidden_context_absent &&
      required_behavior_present &&
      forbidden_tools_absent &&
      required_tools_present &&
      state_mutation_allowed,
    forbidden_context_absent,
    required_behavior_present,
    forbidden_tools_absent,
    required_tools_present,
    state_mutation_allowed,
  };
}
