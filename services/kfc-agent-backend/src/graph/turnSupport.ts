import type { CustomerCommand } from '../domain/customerCommand.js';
import type {
  Cart,
  ConversationTurnMetadata,
  DashboardEvent,
  SessionUpdateType
} from '../domain/types.js';
import type { SmallTalkRouterOutput } from '../llm/smallTalkRouter.js';
import type { CommercePlannerState } from '../llm/toolPlanner.js';
import {
  type AgentTraceSpan
} from '../observability/agentTracing.js';
import type { PaymentLinkMethod, ToolCallRequest } from '../ordering/types.js';
import {
  createUnverifiedCustomerAccessContext
} from '../security/customerAccessContext.js';
import {
  type AgentTurnInput,
  type IrreversibleConfirmationBinding
} from './agentTurnState.js';
import type { AgentGraphState } from './state.js';
export const verifiedStateSnapshotSourceType = 'graph:verified_state';

export function emitDashboardEvent(input: AgentTurnInput, type: DashboardEvent['type'], payload: Record<string, unknown>): void {
  input.dashboard.emitEvent({
    id: `dash_${input.sessionId}_${type}_${Date.now()}_${crypto.randomUUID()}`,
    sessionId: input.sessionId,
    type,
    payload,
    createdAt: new Date().toISOString(),
  });
}

export function toolExecutionContext(input: AgentTurnInput, clientMessageId?: string) {
  const scenarioId =
    typeof input.metadata?.rawEvent?.scenarioId === 'string'
      ? input.metadata.rawEvent.scenarioId
      : 'live-agent';
  return {
    runGuard: input.runGuard,
    accessContext: input.accessContext ?? createUnverifiedCustomerAccessContext(input),
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
  const scenarioId = input.metadata?.rawEvent?.scenarioId;
  return typeof scenarioId === 'string' ? scenarioId : undefined;
}

export function traceProbeRunId(input: AgentTurnInput): string | undefined {
  const probeRunId = input.metadata?.rawEvent?.probeRunId;
  return typeof probeRunId === 'string' ? probeRunId : undefined;
}

export function traceSessionReference(sessionId: string): string {
  let hash = 2166136261;
  for (const character of sessionId) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `session_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function traceStateSummary(state: AgentGraphState): Record<string, unknown> {
  return {
    intent: state.intent,
    cartItems: state.cart?.items.map((item) => ({ itemCode: item.itemCode, quantity: item.quantity })) ?? [],
    orderId: state.order?.id ?? null,
    paymentStatus: state.paymentAttempt?.status ?? state.order?.paymentStatus ?? null,
    handoffId: state.handoff?.escalationId ?? null,
    fulfillmentStoreId: state.fulfillment?.storeId ?? null,
    escalationReasons: [...state.escalationReasons],
    toolNames: state.toolTrace?.map((entry) => entry.toolName) ?? [],
  };
}

export async function tracePolicyDecision(
  turnTrace: AgentTraceSpan | undefined,
  input: {
    proposedToolNames: string[];
    allowedToolNames: string[];
    blockedReasons: string[];
    confirmationRequired?: boolean;
  },
): Promise<void> {
  if (!turnTrace) return;
  const span = await turnTrace.startSpan({
    name: 'policy_gate',
    runType: 'chain',
    inputs: { proposedToolNames: input.proposedToolNames },
  });
  await span.end({
    allowedToolNames: input.allowedToolNames,
    blockedReasons: input.blockedReasons,
    confirmationRequired: input.confirmationRequired ?? false,
  });
}

export async function routeSmallTalk(
  input: AgentTurnInput,
  turnTrace: AgentTraceSpan,
): Promise<SmallTalkRouterOutput | undefined> {
  if (!input.smallTalkRouter) return undefined;
  const routerInput = {
    latestUserMessage: input.text,
    channel: input.channel,
    hasStructuredAction: Boolean(input.metadata?.customerCommand),
  };
  const spanPromise = turnTrace.startSpan({
    name: 'small_talk_router',
    runType: 'llm',
    inputs: { routerInput },
    metadata: {
      component: 'SmallTalkRouter',
      model: input.smallTalkRouter.model ?? null,
      promptVersion: input.smallTalkRouter.promptVersion ?? null,
    },
    tags: ['agent-router'],
  });
  const routePromise = input.smallTalkRouter.route(routerInput);
  const span = await spanPromise;
  try {
    const output = await routePromise;
    await span.end({ routerOutput: output });
    return output;
  } catch (error) {
    await span.fail(error);
    await input.store.appendEvent(input.sessionId, 'llm:small_talk_router_failed', {
      message: error instanceof Error ? error.message : 'Unknown small-talk router failure',
    });
    return { decision: 'continue_to_planner' };
  }
}

export function hasPlannerBooleanEntity(state: AgentGraphState, key: string): boolean {
  return isRecord(state.entities) && state.entities[key] === true;
}

export function commercePlannerState(state: AgentGraphState): CommercePlannerState {
  const { channel: _channel, recentTurns: _recentTurns, ...commerceState } = state;
  return commerceState;
}

export function plannerPaymentMethod(state: AgentGraphState): PaymentLinkMethod | undefined {
  const method = isRecord(state.entities) ? state.entities.paymentMethod : undefined;
  return method === 'momo' || method === 'zalopay' || method === 'card' || method === 'cod' ? method : undefined;
}

export function paymentMethodFixtureId(method: PaymentLinkMethod): string {
  switch (method) {
    case 'cod':
      return 'cash_on_delivery';
    case 'card':
      return 'visa_master_card';
    case 'zalopay':
      return 'zalopay_wallet';
    case 'momo':
      return 'momo_wallet';
  }
}

export function paymentLinkMethodFromFixtureId(methodId: string): PaymentLinkMethod | undefined {
  if (methodId === 'cash_on_delivery') return 'cod';
  if (methodId === 'visa_master_card') return 'card';
  if (methodId === 'zalopay_wallet') return 'zalopay';
  if (methodId === 'momo_wallet') return 'momo';
  return undefined;
}

export function paymentEvidenceDirectlyMatchesQuery(
  evidence: NonNullable<AgentGraphState['paymentMethodEvidence']>[number],
  query: string,
): boolean {
  const queryTokens = normalizedIntentText(query).match(/[a-z0-9]+/g) ?? [];
  if (queryTokens.length === 0) return false;
  const directFields = normalizedIntentText(
    `${evidence.methodId} ${evidence.displayName} ${evidence.category}`,
  );
  return queryTokens.every((token) => directFields.includes(token));
}

export function findPaymentEvidenceForLinkMethod(
  evidence: AgentGraphState['paymentMethodEvidence'],
  method: PaymentLinkMethod,
): NonNullable<AgentGraphState['paymentMethodEvidence']>[number] | undefined {
  return evidence?.find((entry) => entry.methodId === paymentMethodFixtureId(method));
}

export function customerCommand(
  metadata: ConversationTurnMetadata | null | undefined,
): CustomerCommand | undefined {
  return metadata?.customerCommand;
}

export function paymentMethodFromCustomerCommand(
  command: CustomerCommand,
): PaymentLinkMethod | undefined {
  if (command?.kind !== 'select_payment_method') return undefined;
  const methodId = command.methodId;
  if (methodId === 'momo_wallet') return 'momo';
  if (methodId === 'zalopay_wallet') return 'zalopay';
  if (methodId === 'visa_master_card') return 'card';
  if (methodId === 'cash_on_delivery') return 'cod';
  return undefined;
}

export function commandCartUpdateToToolCall(command: CustomerCommand): ToolCallRequest | undefined {
  if (command?.kind !== 'cart_update') return undefined;
  return {
    toolName: 'updateCart',
    arguments: {
      itemCode: command.itemCode,
      quantity: command.quantity,
    },
  };
}

export interface StructuredModifierSelection {
  itemCode: string;
  groupId: string;
  modifierId: string;
}

export function structuredModifierSelection(
  command: CustomerCommand,
): StructuredModifierSelection | undefined {
  if (command?.kind !== 'modifier_selection') return undefined;
  return {
    itemCode: command.itemCode,
    groupId: command.groupId,
    modifierId: command.modifierId,
  };
}

export function verifiedModifierSelectionToolCall(
  state: AgentGraphState,
  selection: StructuredModifierSelection,
): { call: ToolCallRequest; acknowledgement: string; } | undefined {
  const cartItem = state.cart?.items.find((item) => item.itemCode === selection.itemCode);
  const tree = state.menuModifierOptions;
  if (!cartItem || !tree || tree.itemCode !== selection.itemCode) return undefined;
  const group = tree.modifierGroups.find((candidate) => candidate.groupId === selection.groupId);
  const option = group?.options.find((candidate) => candidate.modifierId === selection.modifierId);
  if (!group || !option) return undefined;

  const selectedModifier = {
    groupId: group.groupId,
    groupName: group.name,
    modifierId: option.modifierId,
    modifierName: option.name,
    quantity: typeof option.quantity === 'number' && option.quantity > 0 ? option.quantity : 1,
    priceDeltaVnd: option.priceDeltaVnd,
  };
  const selectionByGroup = new Map<string, typeof selectedModifier>();
  for (const modifier of cartItem.modifiers ?? []) {
    const verifiedGroup = tree.modifierGroups.find((candidate) => candidate.groupId === modifier.groupId);
    const verifiedOption = verifiedGroup?.options.find((candidate) =>
      candidate.modifierId === modifier.modifierId && candidate.priceDeltaVnd === modifier.priceDeltaVnd,
    );
    if (verifiedGroup && verifiedOption) selectionByGroup.set(modifier.groupId, modifier);
  }
  selectionByGroup.set(selectedModifier.groupId, selectedModifier);
  const modifiers = tree.modifierGroups.flatMap((candidate) => {
    const modifier = selectionByGroup.get(candidate.groupId);
    return modifier ? [modifier] : [];
  });

  return {
    call: {
      toolName: 'updateCart',
      arguments: {
        itemCode: cartItem.itemCode,
        quantity: cartItem.quantity,
        modifiers: modifiers.map((modifier) => ({
          groupId: modifier.groupId,
          modifierId: modifier.modifierId,
          quantity: modifier.quantity,
        })),
      },
    },
    acknowledgement: `Đã đổi ${group.name} sang ${option.name}.`,
  };
}

export function commandBatchUpdateToToolCalls(
  command: CustomerCommand,
): ToolCallRequest[] | undefined {
  if (command?.kind !== 'cart_batch_update') return undefined;
  return command.items.map((item) => ({
    toolName: 'updateCart',
    arguments: { itemCode: item.itemCode, quantity: item.quantity },
  }));
}

export function verifiedMenuBatchAcknowledgement(
  cart: Cart | undefined,
  selections: Array<{ itemCode: string; quantity: number; }>,
): string | undefined {
  if (!cart || selections.length === 0) return undefined;
  const cartItems = new Map(cart.items.map((item) => [item.itemCode, item]));
  const selectionLabels = selections.map((selection) => {
    const item = cartItems.get(selection.itemCode);
    return item ? `${selection.quantity} × ${item.name}` : undefined;
  });
  if (selectionLabels.some((label) => !label)) return undefined;
  return `Đã cập nhật giỏ với ${selectionLabels.join(', ')}.`;
}


export function normalizedIntentText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase();
}
