import {
  projectToolProgressFamily,
} from '../customerRuns/progressProjection.js';
import { resolveMonitorSessionIntelligence } from '../monitor/sessionIntelligence.js';
import {
  type AgentTraceSpan
} from '../observability/agentTracing.js';
import { applySafetyGates } from '../ordering/safetyGates.js';
import { getToolBoundary } from '../ordering/toolBoundaries.js';
import { parseToolArguments } from '../ordering/toolCatalog.js';
import { executeToolCall } from '../ordering/toolExecutor.js';
import type { PaymentLinkMethod, ToolCallRequest, ToolCallResult, ToolName, ToolTraceEntry } from '../ordering/types.js';
import { cartItemCodes, shouldUseKnownAddressForFulfillment } from './addressContext.js';
import {
  type AgentTurnInput,
  type IrreversibleConfirmationBinding,
  type NaturalLanguagePlan
} from './agentTurnState.js';
import {
  contextPolicyIsActive,
  contextPolicyRequiresConfirmation,
  type ContextPolicyDirective
} from './contextPolicy.js';
import type { AgentGraphState } from './state.js';
import {
  bindingFingerprint,
  emitDashboardEvent,
  hasPlannerBooleanEntity,
  isRecord,
  isRunStillCurrent,
  paymentEvidenceDirectlyMatchesQuery,
  paymentLinkMethodFromFixtureId,
  plannerPaymentMethod,
  pushEscalationReasons,
  toolExecutionContext,
  tracePolicyDecision,
  traceStateSummary,
} from './turnSupport.js';
import { applyToolResultToState, hasSuccessfulCurrentTurnToolCall } from './verifiedState.js';

import { executeAndApplyTracedToolCall } from './commerceExecution.js';
import { hasSuccessfulToolResult } from './commerceExecution.js';

export function rememberPlannerPaymentMethod(state: AgentGraphState, checksPaymentMethodSupport = false): void {
  if (checksPaymentMethodSupport) return;
  const method = plannerPaymentMethod(state);
  if (!method || state.paymentAttempt?.paymentUrl) return;
  state.selectedPaymentMethod = method;
}

export function recoverSelectedPaymentMethodFromVerifiedLookup(state: AgentGraphState): PaymentLinkMethod | undefined {
  const lookup = [...(state.toolTrace ?? [])].reverse().find(
    (entry) =>
      entry.ok &&
      entry.toolName === 'listPaymentMethods' &&
      typeof entry.arguments.query === 'string' &&
      entry.arguments.query.trim().length > 0,
  );
  if (!lookup || typeof lookup.arguments.query !== 'string') return undefined;

  const matches = (state.paymentMethodEvidence ?? [])
    .filter((entry) => entry.supported && paymentEvidenceDirectlyMatchesQuery(entry, lookup.arguments.query as string))
    .map((entry) => paymentLinkMethodFromFixtureId(entry.methodId))
    .filter((method): method is PaymentLinkMethod => method !== undefined);
  return matches.length === 1 ? matches[0] : undefined;
}

export async function createPaymentLinkAfterOrderFromRememberedMethod(input: {
  turnInput: AgentTurnInput;
  state: AgentGraphState;
  currentTurnToolTrace: ToolTraceEntry[];
}): Promise<void> {
  if (!input.state.order || input.state.order.status !== 'created') return;
  const method = input.state.selectedPaymentMethod ?? recoverSelectedPaymentMethodFromVerifiedLookup(input.state);
  if (!method || input.state.paymentAttempt?.paymentUrl) return;

  input.state.selectedPaymentMethod = method;
  const call: ToolCallRequest = {
    toolName: 'createPaymentLink',
    arguments: { method },
  };
  await executeAndApplyTracedToolCall({ ...input, call });
}

export async function ensurePaymentStatusForCompletionClaim(input: {
  turnInput: AgentTurnInput;
  state: AgentGraphState;
  currentTurnToolTrace: ToolTraceEntry[];
}): Promise<void> {
  if (!isRecord(input.state.entities) || input.state.entities.paymentStatusClaimed !== 'paid') return;
  if (!input.state.order?.id) return;
  if (hasSuccessfulToolResult(input.currentTurnToolTrace, ['checkPaymentStatus'])) return;
  await executeAndApplyTracedToolCall({
    ...input,
    call: {
      toolName: 'checkPaymentStatus',
      arguments: { orderId: input.state.order.id },
    },
  });
}
