import type {
  DashboardEvent,
  SessionUpdateType
} from '../domain/types.js';
import {
  paymentAttemptForVerifiedOrder,
} from '../ordering/paymentOrderAuthority.js';
import {
  createUnverifiedCustomerAccessContext
} from '../security/customerAccessContext.js';
import {
  type AgentTurnInput,
  type IrreversibleConfirmationBinding
} from './agentTurnState.js';
import {
  agentTraceProbeRunId,
  agentTraceScenarioId,
} from './agentTraceContext.js';
import type { AgentGraphState } from './state.js';
export const verifiedStateSnapshotSourceType = 'graph:verified_state';

export function emitDashboardEvent(
  input: Pick<AgentTurnInput, 'sessionId' | 'dashboard'>,
  type: DashboardEvent['type'],
  payload: Record<string, unknown>,
): void {
  input.dashboard.emitEvent({
    id: `dash_${input.sessionId}_${type}_${Date.now()}_${crypto.randomUUID()}`,
    sessionId: input.sessionId,
    type,
    payload,
    createdAt: new Date().toISOString(),
  });
}

export function toolExecutionContext(input: AgentTurnInput, clientMessageId?: string) {
  const scenarioId = traceScenarioId(input) ?? 'live-agent';
  return {
    runGuard: input.runGuard,
    runFence: input.runGuard?.commitFence,
    accessContext: input.accessContext ?? createUnverifiedCustomerAccessContext(input),
    guestCheckoutAuthority: input.guestCheckoutAuthority,
    confirmationResume: input.confirmationResume !== undefined,
    externalMessageId: input.externalMessageId,
    sessionId: input.sessionId,
    clientMessageId: clientMessageId ?? input.externalMessageId ?? `turn-${crypto.randomUUID()}`,
    commerceTraceId: crypto.randomUUID(),
    commerceScenarioId: scenarioId,
  };
}

export async function isRunStillCurrent(input: AgentTurnInput): Promise<boolean> {
  return input.runGuard ? input.runGuard.isCurrent() : true;
}

export function emitSessionUpdate(input: AgentTurnInput, payload: Record<string, unknown> & { updateType: SessionUpdateType; }): void {
  emitDashboardEvent(input, 'session_updated', payload);
}

export function pushEscalationReasons(state: AgentGraphState, reasons: string[]): void {
  const seen = new Set(state.escalationReasons);
  for (const reason of reasons) {
    if (seen.has(reason)) continue;
    seen.add(reason);
    state.escalationReasons.push(reason);
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export async function stateRevision(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(value ?? null)));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function confirmationBinding(
  input: AgentTurnInput,
  state: Pick<AgentGraphState, 'cart' | 'fulfillment' | 'paymentAttempt' | 'selectedPaymentMethod'>,
): Promise<IrreversibleConfirmationBinding> {
  const authority = input.confirmationAuthority ?? input.clients.confirmationAuthority;
  if (!authority) throw new Error('confirm_order requires trusted commerce confirmation authority');
  if (!input.confirmationRequestId) throw new Error('confirm_order requires a server-generated confirmation request id');
  return {
    kind: 'confirm_order',
    requestId: input.confirmationRequestId,
    environment: authority.environment,
    scenarioId: authority.scenarioId,
    catalogObservationId: authority.catalogObservationId,
    catalogObservationHash: authority.catalogObservationHash,
    cartRevision: await stateRevision(state.cart),
    fulfillmentRevision: await stateRevision(state.fulfillment),
    paymentRevision: await stateRevision({
      paymentAttempt: state.paymentAttempt,
      selectedPaymentMethod: state.selectedPaymentMethod,
    }),
    providerRevision: authority.providerRevision,
  };
}

export async function bindingFingerprint(binding: IrreversibleConfirmationBinding): Promise<string> {
  return stateRevision(binding);
}

export function traceScenarioId(input: AgentTurnInput): string | undefined {
  return agentTraceScenarioId(input.traceContext);
}

export function traceProbeRunId(input: AgentTurnInput): string | undefined {
  return agentTraceProbeRunId(input.traceContext);
}

export function traceStateSummary(state: AgentGraphState): Record<string, unknown> {
  const paymentAttempt = paymentAttemptForVerifiedOrder(
    state.paymentAttempt,
    state.order,
  );
  return {
    cartItems: state.cart?.items.map((item) => ({ itemCode: item.itemCode, quantity: item.quantity })) ?? [],
    orderId: state.order?.id ?? null,
    paymentStatus: paymentAttempt?.status ?? state.order?.paymentStatus ?? null,
    handoffId: state.handoff?.escalationId ?? null,
    fulfillmentStoreId: state.fulfillment?.storeId ?? null,
    escalationReasons: [...state.escalationReasons],
    toolNames: state.toolTrace?.map((entry) => entry.toolName) ?? [],
  };
}
