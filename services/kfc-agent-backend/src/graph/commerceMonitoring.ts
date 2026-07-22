import { resolveMonitorSessionIntelligence } from '../monitor/sessionIntelligence.js';
import type { ToolTraceEntry } from '../ordering/types.js';
import type { AgentTurnInput } from './agentTurnState.js';
import type { AgentGraphState } from './state.js';
import { emitDashboardEvent } from './turnSupport.js';
import { hasSuccessfulToolResult } from './commerceExecution.js';
import {
  paymentAttemptForVerifiedOrder,
} from '../ordering/paymentOrderAuthority.js';

export function emitDerivedEvents(
  input: Pick<AgentTurnInput, 'sessionId' | 'dashboard'>,
  state: AgentGraphState,
  turnToolTrace: ToolTraceEntry[],
): void {
  const paymentAttempt = paymentAttemptForVerifiedOrder(
    state.paymentAttempt,
    state.order,
  );
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

  if (
    paymentAttempt?.paymentUrl &&
    paymentAttempt.method &&
    hasSuccessfulToolResult(turnToolTrace, ['createPaymentLink'])
  ) {
    emitDashboardEvent(input, 'payment_link_created', {
      method: paymentAttempt.method,
      status: paymentAttempt.status,
      url: paymentAttempt.paymentUrl,
    });
  }

  if (paymentAttempt?.status === 'failed' && hasSuccessfulToolResult(turnToolTrace, ['checkPaymentStatus'])) {
    emitDashboardEvent(input, 'payment_failed', {
      status: paymentAttempt.status,
    });
  }

  if (paymentAttempt?.status === 'paid' && hasSuccessfulToolResult(turnToolTrace, ['checkPaymentStatus'])) {
    emitDashboardEvent(input, 'payment_paid', {
      status: paymentAttempt.status,
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
