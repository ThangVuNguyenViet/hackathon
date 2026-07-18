import { parseToolArguments } from '../ordering/toolCatalog.js';
import { normalizeSearchText } from '../ordering/orderingDataPlanning.js';
import type { ToolCallRequest, ToolName } from '../ordering/types.js';
import type { ToolPlannerInput, ToolPlannerOutput } from './toolPlanner.js';
import { isToolName } from './toolPlannerNormalization.js';

export const plannerSemanticViolationCodes = [
  'invalid_tool_arguments',
  'ungrounded_tool_arguments',
  'unjustified_discovery_tool',
  'unjustified_availability_recheck',
  'unjustified_checkout_execution',
  'unjustified_handoff',
  'missing_required_handoff',
  'missing_payment_method_read',
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
    if (
      input.availableTools.includes('handoff') &&
      explicitlyRequestsAbnormalQuantity(input)
    ) {
      return {
        intent: 'handoff',
        contextPolicy: { handoff: 'active' },
        entities: { abnormalLargeOrder: true },
        toolCalls: [{
          toolName: 'handoff',
          arguments: { reasons: ['abnormal_large_order', 'human_review_required'] },
        }],
        responseClaims: [],
      };
    }
    if (
      input.availableTools.includes('listPaymentMethods') &&
      explicitlyRequestsPaymentMethodAvailability(input)
    ) {
      return {
        intent: 'payment',
        entities: {},
        toolCalls: [{ toolName: 'listPaymentMethods', arguments: {} }],
        responseClaims: [],
      };
    }
    if (error.violations.every((violation) =>
      violation === 'unjustified_availability_recheck' || violation === 'unjustified_checkout_execution'
    )) {
      return {
        ...error.priorPlan,
        entities: {
          ...error.priorPlan.entities,
          fulfillmentAccepted: false,
          orderConfirmed: false,
        },
        toolCalls: error.priorPlan.toolCalls.filter(({ toolName }) =>
          !['checkStoreAvailability', 'previewOrder', 'placeOrder', 'createPaymentLink'].includes(toolName)
        ),
      };
    }
    if (input.semanticViolations) return failClosedPlannerOutput();
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

function explicitlyRequestsAbnormalQuantity(input: ToolPlannerInput): boolean {
  const text = normalizeSearchText(input.state.latestUserMessage);
  return [...text.matchAll(/\b(\d+)\s*(?:combo|phan|suat|goi|mon|items?|packs?)\b/g)]
    .some((match) => Number(match[1]) >= 100);
}

function explicitlyRequestsPaymentMethodAvailability(input: ToolPlannerInput): boolean {
  const text = normalizeSearchText(input.state.latestUserMessage);
  return /\b(?:thanh toan|tra tien)\b/.test(text) &&
    /\b(?:phuong thuc|cach|momo|zalopay|the|card|cod|tien mat)\b/.test(text) &&
    !/\b(?:trang thai|thanh cong|that bai|da tra|da thanh toan|pending)\b/.test(text);
}

function requestsCheckoutMetadataWithoutAvailability(input: ToolPlannerInput): boolean {
  const text = normalizeSearchText(input.state.latestUserMessage);
  return /\b(?:hoa don|ma so thue|ghi chu|le tan|loi nhan|huong dan giao)\b/.test(text) &&
    !/\b(?:cua hang|phuc vu|ton kho|con hang|availability|available|store)\b/.test(text);
}

function isHandoffGrounded(input: ToolPlannerInput, output: ToolPlannerOutput, reasons: string[]): boolean {
  if (reasons.includes('human_support_requested') || reasons.includes('customer_requested_human')) {
    return output.entities.humanSupportRequested === true;
  }
  if (reasons.includes('abnormal_large_order')) return output.entities.abnormalLargeOrder === true;
  if (reasons.includes('payment_failed')) return input.state.paymentAttempt?.status === 'failed';
  if (reasons.includes('order_cancellation_requested') || reasons.includes('submitted_order_cancellation')) {
    return Boolean(input.state.order);
  }
  return output.intent === 'complaint';
}

export function plannerSemanticViolations(
  input: ToolPlannerInput,
  output: ToolPlannerOutput,
  options: { rawToolArgumentsOnly?: boolean } = {},
): PlannerSemanticViolationCode[] {
  const violations = new Set<PlannerSemanticViolationCode>();
  const evidence = customerEvidence(input);
  const hasAbnormalOrderHandoff = output.toolCalls.some(
    (call) =>
      call.toolName === 'handoff' &&
      Array.isArray(call.arguments.reasons) &&
      call.arguments.reasons.includes('abnormal_large_order'),
  );

  if (
    input.availableTools.includes('handoff') &&
    explicitlyRequestsAbnormalQuantity(input) &&
    !hasAbnormalOrderHandoff
  ) violations.add('missing_required_handoff');
  if (
    input.availableTools.includes('listPaymentMethods') &&
    explicitlyRequestsPaymentMethodAvailability(input) &&
    !output.toolCalls.some(({ toolName }) => toolName === 'listPaymentMethods')
  ) violations.add('missing_payment_method_read');

  for (const call of output.toolCalls) {
    if (!parseToolArguments(call.toolName, call.arguments).success) violations.add('invalid_tool_arguments');
    if (options.rawToolArgumentsOnly) continue;

    if (call.toolName === 'collectInvoice') {
      const values = ['companyName', 'taxCode', 'email'].map((field) => call.arguments[field]);
      if (
        values.some((value) => typeof value !== 'string' || !isCustomerGrounded(value, evidence))
      ) violations.add('ungrounded_tool_arguments');
    }

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

    if (
      call.toolName === 'checkStoreAvailability' &&
      requestsCheckoutMetadataWithoutAvailability(input) &&
      !output.toolCalls.some(({ toolName }) => toolName === 'previewOrder' || toolName === 'placeOrder')
    ) violations.add('unjustified_availability_recheck');

    if (
      ['previewOrder', 'placeOrder', 'createPaymentLink'].includes(call.toolName) &&
      requestsCheckoutMetadataWithoutAvailability(input)
    ) violations.add('unjustified_checkout_execution');

    if (call.toolName === 'handoff') {
      const reasons = Array.isArray(call.arguments.reasons)
        ? call.arguments.reasons.filter((reason): reason is string => typeof reason === 'string')
        : [];
      if (!isHandoffGrounded(input, output, reasons)) violations.add('unjustified_handoff');
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
