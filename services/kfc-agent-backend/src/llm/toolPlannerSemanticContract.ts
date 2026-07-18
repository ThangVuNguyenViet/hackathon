import { defaultCommerceAgentPolicy } from '../config/commerceAgentPolicy.js';
import { parseToolArguments } from '../ordering/toolCatalog.js';
import { normalizeSearchText } from '../ordering/orderingDataPlanning.js';
import type { ToolCallRequest, ToolName } from '../ordering/types.js';
import type { ToolPlannerInput, ToolPlannerOutput } from './toolPlanner.js';
import { isToolName } from './toolPlannerNormalization.js';

export const plannerSemanticViolationCodes = [
  'tool_not_available',
  'invalid_tool_arguments',
  'verified_cart_required',
  'verified_fulfillment_required',
  'verified_order_required',
  'order_preview_required',
  'confirmation_required',
  'cancellation_status_check_required',
  'large_order_threshold_not_met',
  'large_order_handoff_required',
  'unclear_intent_mutation',
  'ungrounded_tool_arguments',
  'unjustified_discovery_tool',
  'unjustified_handoff',
  'raw_schema_invalid',
] as const;

export type PlannerSemanticViolationCode = (typeof plannerSemanticViolationCodes)[number];

export class PlannerContractError extends Error {
  constructor(
    readonly violations: PlannerSemanticViolationCode[],
    readonly priorPlan: ToolPlannerOutput,
  ) {
    super(`Planner contract rejected: ${violations.join(', ')}`);
    this.name = 'PlannerContractError';
  }
}

export function failClosedPlannerOutput(): ToolPlannerOutput {
  return {
    intent: 'unclear',
    entities: { asksClarification: true },
    toolCalls: [],
    responseClaims: [],
  };
}

export async function runPlannerWithSemanticReplan(
  input: ToolPlannerInput,
  planOnce: (input: ToolPlannerInput) => Promise<ToolPlannerOutput>,
): Promise<ToolPlannerOutput> {
  try {
    const output = await planOnce(input);
    const violations = plannerSemanticViolations(input, output);
    if (violations.length === 0) return output;
    throw new PlannerContractError(violations, output);
  } catch (error) {
    if (!(error instanceof PlannerContractError)) throw error;
    if (input.semanticViolations || input.policy?.maxSemanticReplans === 0) {
      return failClosedPlannerOutput();
    }
    return runPlannerWithSemanticReplan(
      { ...input, priorPlanForReview: error.priorPlan, semanticViolations: error.violations },
      planOnce,
    );
  }
}

export function rawSchemaPlannerError(cause: unknown): PlannerContractError {
  const error = new PlannerContractError(['raw_schema_invalid'], failClosedPlannerOutput());
  if (cause instanceof Error) error.cause = cause;
  return error;
}

function customerEvidence(input: ToolPlannerInput): string {
  return [...(input.consentTurns ?? input.recentTurns), { role: 'user' as const, text: input.state.latestUserMessage }]
    .filter((turn) => turn.role === 'user')
    .map((turn) => turn.text)
    .join('\n');
}

function isCustomerGrounded(value: string, evidence: string): boolean {
  const normalizedValue = normalizeSearchText(value);
  return normalizedValue.length > 0 && normalizeSearchText(evidence).includes(normalizedValue);
}

function hasCatalogEvidence(input: ToolPlannerInput): boolean {
  return (input.menuCatalogContext?.candidates.length ?? 0) > 0;
}

function isHandoffGrounded(input: ToolPlannerInput, output: ToolPlannerOutput, reasons: string[]): boolean {
  if (reasons.includes('human_support_requested') || reasons.includes('customer_requested_human')) {
    return output.entities.humanSupportRequested === true;
  }
  if (reasons.includes('abnormal_large_order')) {
    const requestedQuantity = output.entities.abnormalLargeOrderQuantity;
    return output.entities.abnormalLargeOrder === true &&
      typeof requestedQuantity === 'number' &&
      Number.isInteger(requestedQuantity) &&
      requestedQuantity >= (
        input.policy?.largeOrderQuantityThreshold ??
        defaultCommerceAgentPolicy.largeOrderQuantityThreshold
      );
  }
  if (reasons.includes('payment_failed')) return input.state.paymentAttempt?.status === 'failed';
  if (reasons.includes('order_cancellation_requested') || reasons.includes('submitted_order_cancellation')) {
    return Boolean(input.state.order);
  }
  return output.intent === 'complaint';
}

function confirmationSatisfied(
  input: ToolPlannerInput,
  output: ToolPlannerOutput,
  call: ToolCallRequest,
): boolean {
  if (call.toolName === 'placeOrder') {
    return output.entities.orderConfirmed === true || input.state.userConfirmedOrder === true;
  }
  if (call.toolName === 'acquireVoucher' || call.toolName === 'redeemReward') {
    return call.arguments.confirmed !== true || output.entities.membershipMutationConfirmed === true;
  }
  return false;
}

export function plannerSemanticViolations(
  input: ToolPlannerInput,
  output: ToolPlannerOutput,
  options: { rawToolArgumentsOnly?: boolean } = {},
): PlannerSemanticViolationCode[] {
  const violations = new Set<PlannerSemanticViolationCode>();
  const evidence = customerEvidence(input);
  const policy = input.policy ?? defaultCommerceAgentPolicy;
  const abnormalLargeOrderQuantity = output.entities.abnormalLargeOrderQuantity;
  const hasPolicyLargeOrder =
    output.entities.abnormalLargeOrder === true &&
    typeof abnormalLargeOrderQuantity === 'number' &&
    Number.isInteger(abnormalLargeOrderQuantity) &&
    abnormalLargeOrderQuantity >= policy.largeOrderQuantityThreshold;
  const hasLargeOrderHandoff = output.toolCalls.some(
    (call) =>
      call.toolName === 'handoff' &&
      Array.isArray(call.arguments.reasons) &&
      call.arguments.reasons.includes('abnormal_large_order'),
  );
  if (output.entities.abnormalLargeOrder === true && !hasPolicyLargeOrder) {
    violations.add('large_order_threshold_not_met');
  }
  if (hasPolicyLargeOrder && !hasLargeOrderHandoff) {
    violations.add('large_order_handoff_required');
  }
  if (
    (output.intent === 'unclear' || output.entities.asksClarification === true) &&
    !(
      output.savedAddressDecision?.decision === 'suggest' &&
      (output.catalogSelections?.length ?? 0) > 0
    ) &&
    output.toolCalls.some((call) =>
      call.toolName === 'updateCart' ||
      call.toolName === 'placeOrder' ||
      (
        (call.toolName === 'acquireVoucher' || call.toolName === 'redeemReward') &&
        call.arguments.confirmed === true
      )
    )
  ) {
    violations.add('unclear_intent_mutation');
  }

  for (const [callIndex, call] of output.toolCalls.entries()) {
    const earlierCalls = output.toolCalls.slice(0, callIndex);
    if (!input.availableTools.includes(call.toolName)) violations.add('tool_not_available');
    if (!parseToolArguments(call.toolName, call.arguments).success) violations.add('invalid_tool_arguments');
    if (options.rawToolArgumentsOnly) continue;

    if (
      ['quoteFulfillment', 'checkStoreAvailability', 'previewOrder', 'placeOrder'].includes(call.toolName) &&
      !input.state.cart
    ) violations.add('verified_cart_required');
    if (
      (call.toolName === 'previewOrder' || call.toolName === 'placeOrder') &&
      !input.state.fulfillment
    ) violations.add('verified_fulfillment_required');
    if (
      ['getOrderStatus', 'createPaymentLink', 'checkPaymentStatus'].includes(call.toolName) &&
      !input.state.order &&
      !(call.toolName === 'createPaymentLink' && earlierCalls.some(({ toolName }) => toolName === 'placeOrder'))
    ) violations.add('verified_order_required');
    if (
      call.toolName === 'placeOrder' &&
      !input.state.orderPreview &&
      !earlierCalls.some(({ toolName }) => toolName === 'previewOrder')
    ) violations.add('order_preview_required');
    if (
      policy.confirmationRequiredTools.includes(call.toolName) &&
      !confirmationSatisfied(input, output, call)
    ) violations.add('confirmation_required');

    if (call.toolName === 'collectInvoice') {
      const values = ['companyName', 'taxCode', 'email'].map((field) => call.arguments[field]);
      if (
        values.some((value) => typeof value !== 'string' || !isCustomerGrounded(value, evidence))
      ) violations.add('ungrounded_tool_arguments');
    }

    if (
      call.toolName === 'getOrderStatus' &&
      call.arguments.orderId !== input.state.order?.id &&
      !input.state.customerContext?.recentOrders.some(({ id }) => id === call.arguments.orderId)
    ) violations.add('ungrounded_tool_arguments');

    if (
      call.toolName === 'searchMenu' &&
      (
        output.entities.smallTalk === true ||
        (
          input.planningProfile === 'active_checkout' &&
          typeof call.arguments.query === 'string' &&
          call.arguments.query.trim().length > 0 &&
          !hasCatalogEvidence(input) &&
          normalizeSearchText(call.arguments.query) === normalizeSearchText(input.state.latestUserMessage)
        )
      )
    ) violations.add('unjustified_discovery_tool');

    if (call.toolName === 'handoff') {
      const reasons = Array.isArray(call.arguments.reasons)
        ? call.arguments.reasons.filter((reason): reason is string => typeof reason === 'string')
        : [];
      if (
        reasons.some((reason) =>
          reason === 'order_cancellation_requested' ||
          reason === 'submitted_order_cancellation'
        ) &&
        input.state.cancellationStatusChecked !== true
      ) {
        violations.add('cancellation_status_check_required');
      }
      if (
        reasons.includes('abnormal_large_order') &&
        !isHandoffGrounded(input, output, reasons)
      ) violations.add('large_order_threshold_not_met');
      else if (!isHandoffGrounded(input, output, reasons)) violations.add('unjustified_handoff');
    }
  }

  return [...violations];
}

export function priorPlanFromRawOutput(
  output: Omit<ToolPlannerOutput, 'toolCalls'> & {
    toolCalls: Array<{ toolName: string; arguments: Record<string, unknown> }>;
  },
): ToolPlannerOutput {
  return {
    ...output,
    toolCalls: output.toolCalls.filter((call): call is ToolCallRequest & { toolName: ToolName } => isToolName(call.toolName)),
  };
}
