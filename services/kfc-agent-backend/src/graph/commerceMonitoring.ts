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
import { hasSuccessfulToolResult } from './commerceExecution.js';

export function emitDerivedEvents(input: AgentTurnInput, state: AgentGraphState, turnToolTrace: ToolTraceEntry[]): void {
  if (state.cart && hasSuccessfulToolResult(turnToolTrace, ['updateCart', 'previewCart'])) {
    emitDashboardEvent(input, 'cart_changed', { cart: state.cart });
  }

  if (state.promotionContext?.validation?.ok && hasSuccessfulToolResult(turnToolTrace, ['validateVoucher'])) {
    emitDashboardEvent(input, 'voucher_applied', {
      validation: state.promotionContext.validation,
    });
  }

  if (
    state.promotionContext?.validation &&
    !state.promotionContext.validation.ok &&
    hasSuccessfulToolResult(turnToolTrace, ['validateVoucher'])
  ) {
    emitDashboardEvent(input, 'voucher_rejected', {
      validation: state.promotionContext.validation,
    });
  }

  if (state.orderPreview && hasSuccessfulToolResult(turnToolTrace, ['previewOrder'])) {
    emitDashboardEvent(input, 'order_previewed', { order: state.orderPreview });
  }

  if (state.order && hasSuccessfulToolResult(turnToolTrace, ['placeOrder'])) {
    emitDashboardEvent(input, 'order_created', { order: state.order });
  }

  if (state.paymentAttempt?.paymentUrl && state.paymentAttempt.method && hasSuccessfulToolResult(turnToolTrace, ['createPaymentLink'])) {
    emitDashboardEvent(input, 'payment_link_created', {
      method: state.paymentAttempt.method,
      status: state.paymentAttempt.status,
      url: state.paymentAttempt.paymentUrl,
    });
  }

  if (state.paymentAttempt?.status === 'failed' && hasSuccessfulToolResult(turnToolTrace, ['checkPaymentStatus'])) {
    emitDashboardEvent(input, 'payment_failed', {
      status: state.paymentAttempt.status,
    });
  }

  if (state.paymentAttempt?.status === 'paid' && hasSuccessfulToolResult(turnToolTrace, ['checkPaymentStatus'])) {
    emitDashboardEvent(input, 'payment_paid', {
      status: state.paymentAttempt.status,
    });
  }

  if (state.handoff && hasSuccessfulToolResult(turnToolTrace, ['handoff'])) {
    emitDashboardEvent(input, 'handoff_required', {
      escalationId: state.handoff.escalationId,
      reasons: state.handoff.reasons,
    });
  }
}

export async function emitSessionIntelligence(
  input: AgentTurnInput,
  state: AgentGraphState,
  customerTurnCount: number,
): Promise<void> {
  const sessionIntelligence = await resolveMonitorSessionIntelligence({
    state,
    dashboardEvents: input.dashboard.getEvents(input.sessionId),
    customerTurnCount,
  });
  emitDashboardEvent(input, 'session_intelligence_updated', {
    sessionIntelligence,
  });
}
