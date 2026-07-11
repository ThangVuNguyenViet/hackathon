import type { ExternalClients } from '../clients/interfaces.js';
import type { DashboardEventBus } from '../dashboard/eventBus.js';
import type { Address, Cart, DashboardEvent, Channel, ConversationTurn, ConversationTurnMetadata, SessionUpdateType } from '../domain/types.js';
import { selectKfcGenUiAttachment } from '../genui/kfcGenUiSelector.js';
import type { KfcGenUiAttachment } from '../genui/kfcGenUi.js';
import type { ResponseComposer } from '../llm/responseComposer.js';
import type { ToolPlanner, ToolPlannerOutput } from '../llm/toolPlanner.js';
import { countCustomerTurns, resolveMonitorSessionIntelligence, type MonitorSessionIntelligenceJudge } from '../monitor/sessionIntelligence.js';
import { executeToolCall } from '../ordering/toolExecutor.js';
import { toolNames } from '../ordering/toolCatalog.js';
import { getToolBoundary } from '../ordering/toolBoundaries.js';
import { applySafetyGates } from '../ordering/safetyGates.js';
import type { PaymentLinkMethod, PromotionValidationResult, ToolCallRequest, ToolCallResult, ToolName, ToolTraceEntry } from '../ordering/types.js';
import {
  createNoopAgentTracer,
  createSafeAgentTracer,
  type AgentTraceSpan,
  type AgentTracer,
} from '../observability/agentTracing.js';
import type { ConversationStore } from '../persistence/memoryStore.js';
import {
  buildChannelPresentation,
  getChannelCapabilities,
  textOnlyPresentation,
  type ChannelPresentationPlan,
} from '../presentation/channelPresentation.js';
import { buildBoundedRecentTurns } from '../session/sessionContext.js';
import {
  buildContextPolicyState,
  contextPolicyFromMetadata,
  contextPolicyIsActive,
  contextPolicyRequiresConfirmation,
  mergeContextPolicies,
  type ContextPolicyDirective,
} from './contextPolicy.js';
import type { AgentGraphState } from './state.js';

export type ReplyIntent =
  'ask_fulfillment_method' | 'ask_clarification' | 'order_created' | 'human_review_required' | 'payment_retry' | 'general_reply';

export interface AgentTurnInput {
  sessionId: string;
  customerId: string;
  channel: Channel;
  text: string;
  clients: ExternalClients;
  store: ConversationStore;
  dashboard: DashboardEventBus;
  externalMessageId?: string | null;
  metadata?: ConversationTurnMetadata | null;
  responseComposer?: ResponseComposer;
  toolPlanner?: ToolPlanner;
  runGuard?: {
    isCurrent(): Promise<boolean>;
    recordIrreversibleBoundary?(toolName: ToolCallRequest['toolName']): Promise<void>;
  };
  monitorJudge?: MonitorSessionIntelligenceJudge;
  tracer?: AgentTracer;
}

export interface AgentTurnOutput {
  state: AgentGraphState;
  responseText: string;
  presentation: ChannelPresentationPlan;
  replyIntent: ReplyIntent;
  genUi?: KfcGenUiAttachment;
  assistantTurnId?: string;
  suppressed?: boolean;
}

function addressFromText(text: string): Address | undefined {
  const parts = text
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 3) return undefined;

  const city = parts.at(-1);
  const district = parts.at(-2);
  const lineParts = parts.slice(0, -2);
  if (!city || !district || lineParts.length === 0) return undefined;

  return {
    label: lineParts[0],
    line1: lineParts.join(', '),
    district,
    city,
  };
}

function shouldUseKnownAddressForFulfillment(state: AgentGraphState): boolean {
  return Boolean(state.cart && state.cart.items.length > 0 && state.address && hasPlannerBooleanEntity(state, 'useSavedAddress'));
}

function cartItemCodes(state: AgentGraphState): string[] {
  return [...new Set(state.cart?.items.map((item) => item.itemCode) ?? [])];
}

const verifiedStateSnapshotSourceType = 'graph:verified_state';

type VerifiedStateSnapshot = Pick<
  AgentGraphState,
  | 'cart'
  | 'address'
  | 'orderPreview'
  | 'order'
  | 'fulfillment'
  | 'promotionContext'
  | 'contentEvidence'
  | 'menuSearchResults'
  | 'menuModifierOptions'
  | 'customerContext'
  | 'paymentAttempt'
  | 'paymentMethodEvidence'
  | 'invoiceRequest'
  | 'handoff'
  | 'toolTrace'
>;

function emitDashboardEvent(input: AgentTurnInput, type: DashboardEvent['type'], payload: Record<string, unknown>): void {
  input.dashboard.emitEvent({
    id: `dash_${input.sessionId}_${type}_${Date.now()}_${crypto.randomUUID()}`,
    sessionId: input.sessionId,
    type,
    payload,
    createdAt: new Date().toISOString(),
  });
}

function toolExecutionContext(input: AgentTurnInput) {
  const scenarioId =
    typeof input.metadata?.rawEvent?.scenarioId === 'string'
      ? input.metadata.rawEvent.scenarioId
      : 'live-agent';
  return {
    runGuard: input.runGuard,
    sessionId: input.sessionId,
    clientMessageId: input.externalMessageId ?? `turn-${crypto.randomUUID()}`,
    commerceTraceId: crypto.randomUUID(),
    commerceScenarioId: scenarioId,
  };
}

async function isRunStillCurrent(input: AgentTurnInput): Promise<boolean> {
  return input.runGuard ? input.runGuard.isCurrent() : true;
}

function emitSessionUpdate(input: AgentTurnInput, payload: Record<string, unknown> & { updateType: SessionUpdateType }): void {
  emitDashboardEvent(input, 'session_updated', payload);
}

function pushEscalationReasons(state: AgentGraphState, reasons: string[]): void {
  const seen = new Set(state.escalationReasons);
  for (const reason of reasons) {
    if (seen.has(reason)) continue;
    seen.add(reason);
    state.escalationReasons.push(reason);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function traceScenarioId(input: AgentTurnInput): string | undefined {
  const scenarioId = input.metadata?.rawEvent?.scenarioId;
  return typeof scenarioId === 'string' ? scenarioId : undefined;
}

function traceProbeRunId(input: AgentTurnInput): string | undefined {
  const probeRunId = input.metadata?.rawEvent?.probeRunId;
  return typeof probeRunId === 'string' ? probeRunId : undefined;
}

function traceSessionReference(sessionId: string): string {
  let hash = 2166136261;
  for (const character of sessionId) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `session_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function traceStateSummary(state: AgentGraphState): Record<string, unknown> {
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

async function tracePolicyDecision(
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

function hasPlannerBooleanEntity(state: AgentGraphState, key: string): boolean {
  return isRecord(state.entities) && state.entities[key] === true;
}

function plannerPaymentMethod(state: AgentGraphState): PaymentLinkMethod | undefined {
  const method = isRecord(state.entities) ? state.entities.paymentMethod : undefined;
  return method === 'momo' || method === 'zalopay' || method === 'card' || method === 'cod' ? method : undefined;
}

function paymentMethodFixtureId(method: PaymentLinkMethod): string {
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

function linkMethodFromPaymentEvidence(evidence: AgentGraphState['paymentMethodEvidence']): PaymentLinkMethod | undefined {
  if (!evidence) return undefined;
  const supportedMethodIds = new Set(evidence.filter((entry) => entry.supported).map((entry) => entry.methodId));
  if (supportedMethodIds.has('zalopay_wallet')) return 'zalopay';
  if (supportedMethodIds.has('visa_master_card')) return 'card';
  if (supportedMethodIds.has('cash_on_delivery')) return 'cod';
  return evidence.length > 0 ? 'zalopay' : undefined;
}

function findPaymentEvidenceForLinkMethod(
  evidence: AgentGraphState['paymentMethodEvidence'],
  method: PaymentLinkMethod,
): NonNullable<AgentGraphState['paymentMethodEvidence']>[number] | undefined {
  return evidence?.find((entry) => entry.methodId === paymentMethodFixtureId(method));
}

function isGenUiAction(metadata: ConversationTurnMetadata | null | undefined, actionId: string): boolean {
  const rawEvent = metadata?.rawEvent;
  if (!isRecord(rawEvent)) return false;
  const action = rawEvent.genUiAction;
  return isRecord(action) && action.actionId === actionId;
}

function genUiCartActionToToolCall(metadata: ConversationTurnMetadata | null | undefined): ToolCallRequest | undefined {
  const rawEvent = metadata?.rawEvent;
  if (!isRecord(rawEvent)) return undefined;
  const action = rawEvent.genUiAction;
  if (!isRecord(action) || !['add_item', 'update_item_quantity', 'remove_item'].includes(String(action.actionId))) return undefined;
  const payload = action.payload;
  if (!isRecord(payload) || typeof payload.itemCode !== 'string') return undefined;
  const quantity = action.actionId === 'remove_item'
    ? 0
    : typeof payload.quantity === 'number' && Number.isInteger(payload.quantity)
      ? payload.quantity
      : 1;
  if (quantity < 0 || (action.actionId !== 'remove_item' && quantity < 1)) return undefined;
  return {
    toolName: 'updateCart',
    arguments: {
      itemCode: payload.itemCode,
      quantity,
    },
  };
}

function repriceCartWithDeliveryFee(state: AgentGraphState, deliveryFeeVnd: number): void {
  if (!state.cart) return;
  state.cart = {
    ...state.cart,
    deliveryFeeVnd,
    totalVnd: Math.max(0, state.cart.subtotalVnd - state.cart.discountVnd + deliveryFeeVnd),
  };
}

function applyVoucherToCart(state: AgentGraphState, validation: PromotionValidationResult): void {
  if (!state.cart || !validation.ok) return;
  state.cart = {
    ...state.cart,
    voucherCode: validation.publicCode,
    discountVnd: validation.discountVnd,
    totalVnd: Math.max(0, state.cart.subtotalVnd - validation.discountVnd + state.cart.deliveryFeeVnd),
  };
}

function traceFromResult(result: ToolCallResult, args: Record<string, unknown>): ToolTraceEntry {
  return {
    toolName: result.toolName,
    arguments: args,
    ok: result.ok,
    resultSummary: result.ok ? result.message : (result.errorCode ?? result.message),
    provenance: result.provenance,
  };
}

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (!isRecord(value) || value instanceof Date) return value;

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalJsonValue(entry)]),
  );
}

function stableToolCallKey(call: Pick<ToolTraceEntry, 'toolName' | 'arguments'>): string {
  return `${call.toolName}:${JSON.stringify(canonicalJsonValue(call.arguments))}`;
}

function hasSuccessfulCurrentTurnToolCall(trace: ToolTraceEntry[], call: ToolCallRequest): boolean {
  const plannedKey = stableToolCallKey(call);
  return trace.some((entry) => entry.ok && stableToolCallKey(entry) === plannedKey);
}

function shouldEmitToolCalledEvent(result: ToolCallResult): boolean {
  if (!result.ok) return false;
  return true;
}

function hasCartChanged(previousCart: AgentGraphState['cart'], nextCart: AgentGraphState['cart']): boolean {
  if (!previousCart || !nextCart) return previousCart !== nextCart;

  const previousItems = previousCart.items.map((item) => `${item.itemCode}:${item.quantity}:${item.unitPriceVnd}`);
  const nextItems = nextCart.items.map((item) => `${item.itemCode}:${item.quantity}:${item.unitPriceVnd}`);

  return (
    previousCart.subtotalVnd !== nextCart.subtotalVnd ||
    previousCart.discountVnd !== nextCart.discountVnd ||
    previousCart.deliveryFeeVnd !== nextCart.deliveryFeeVnd ||
    previousCart.totalVnd !== nextCart.totalVnd ||
    previousCart.voucherCode !== nextCart.voucherCode ||
    previousItems.length !== nextItems.length ||
    previousItems.some((item, index) => item !== nextItems[index])
  );
}

function invalidateDependentStateAfterCartMutation(state: AgentGraphState): void {
  state.fulfillment = undefined;
  state.orderPreview = undefined;
  state.order = undefined;
  state.paymentAttempt = undefined;
  state.promotionContext = undefined;
  state.invoiceRequest = undefined;
}

function extractVerifiedStateSnapshot(payload: Record<string, unknown>): Partial<VerifiedStateSnapshot> | undefined {
  if (!isRecord(payload.verifiedState)) return undefined;
  return payload.verifiedState as Partial<VerifiedStateSnapshot>;
}

async function loadPriorVerifiedState(store: ConversationStore, sessionId: string): Promise<Partial<VerifiedStateSnapshot>> {
  const events = await store.listEvents(sessionId);
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.sourceType !== verifiedStateSnapshotSourceType) continue;
    return extractVerifiedStateSnapshot(event.payload) ?? {};
  }
  return {};
}

async function hydrateRecentOrderContext(
  input: AgentTurnInput,
  priorVerifiedState: Partial<VerifiedStateSnapshot>,
  policy: ContextPolicyDirective,
): Promise<Partial<VerifiedStateSnapshot>> {
  let customerContext = priorVerifiedState.customerContext;
  const needsCustomer =
    contextPolicyIsActive(policy, 'customer') ||
    contextPolicyIsActive(policy, 'fulfillment') ||
    contextPolicyIsActive(policy, 'membership') ||
    contextPolicyIsActive(policy, 'recentOrder');
  if (needsCustomer && (customerContext?.savedAddresses.length ?? 0) === 0) {
    const savedAddresses = await input.clients.customer.getSavedAddresses(input.customerId);
    if (savedAddresses.ok && savedAddresses.value) {
      customerContext = {
        savedAddresses: savedAddresses.value,
        recentOrders: customerContext?.recentOrders ?? [],
        favorites: customerContext?.favorites ?? [],
        loyaltyPoints: customerContext?.loyaltyPoints,
      };
    }
  }

  const needsRecentOrder =
    contextPolicyIsActive(policy, 'recentOrder') ||
    contextPolicyRequiresConfirmation(policy, 'recentOrder') ||
    contextPolicyIsActive(policy, 'order') ||
    contextPolicyIsActive(policy, 'payment');
  if (!needsRecentOrder || priorVerifiedState.order) {
    return { ...priorVerifiedState, customerContext };
  }

  const result = await input.clients.customer.getRecentOrder(input.customerId);
  if (!result.ok || !result.value) return { ...priorVerifiedState, customerContext };

  const recentOrder = result.value;
  const paymentStatus = recentOrder.paymentStatus === 'not_started' ? 'pending' : recentOrder.paymentStatus;
  customerContext = {
    savedAddresses: customerContext?.savedAddresses ?? [],
    recentOrders: [recentOrder, ...(customerContext?.recentOrders ?? [])],
    favorites: customerContext?.favorites ?? [],
    loyaltyPoints: customerContext?.loyaltyPoints,
  };
  const shouldHydrateActiveOrder =
    contextPolicyIsActive(policy, 'order') ||
    contextPolicyIsActive(policy, 'payment');
  if (!shouldHydrateActiveOrder) {
    return {
      ...priorVerifiedState,
      customerContext,
    };
  }

  return {
    ...priorVerifiedState,
    order: recentOrder,
    cart: priorVerifiedState.cart ?? recentOrder.cart,
    paymentAttempt: priorVerifiedState.paymentAttempt ?? {
      status: paymentStatus,
    },
    customerContext,
  };
}

function buildVerifiedStateSnapshot(state: AgentGraphState): VerifiedStateSnapshot {
  return {
    cart: state.cart,
    address: state.address,
    orderPreview: state.orderPreview,
    order: state.order,
    fulfillment: state.fulfillment,
    promotionContext: state.promotionContext,
    contentEvidence: state.contentEvidence,
    menuSearchResults: state.menuSearchResults,
    menuModifierOptions: state.menuModifierOptions,
    customerContext: state.customerContext,
    paymentAttempt: state.paymentAttempt,
    paymentMethodEvidence: state.paymentMethodEvidence,
    invoiceRequest: state.invoiceRequest,
    handoff: state.handoff,
    toolTrace: state.toolTrace ?? [],
  };
}

async function persistVerifiedStateSnapshot(store: ConversationStore, state: AgentGraphState): Promise<void> {
  await store.appendEvent(state.sessionId, verifiedStateSnapshotSourceType, {
    verifiedState: buildVerifiedStateSnapshot(state),
  });
}

function applyToolResultToState(
  input: AgentTurnInput,
  state: AgentGraphState,
  result: ToolCallResult,
  args: Record<string, unknown>,
  currentTurnToolTrace: ToolTraceEntry[],
): void {
  const traceEntry = traceFromResult(result, args);
  state.toolTrace = [...(state.toolTrace ?? []), traceEntry];
  currentTurnToolTrace.push(traceEntry);

  if (shouldEmitToolCalledEvent(result)) {
    emitSessionUpdate(input, {
      updateType: 'tool_called',
      toolName: result.toolName,
      boundary: getToolBoundary(result.toolName),
      ok: result.ok,
      resultSummary: result.message,
      provenance: result.provenance,
    });
  }

  if (!result.ok) {
    pushEscalationReasons(state, ['tool_execution_failed']);
    return;
  }

  switch (result.toolName) {
    case 'updateCart':
    case 'previewCart':
      if (isRecord(result.value)) {
        const nextCart = result.value as unknown as AgentGraphState['cart'];
        if (result.toolName === 'updateCart' && hasCartChanged(state.cart, nextCart)) {
          invalidateDependentStateAfterCartMutation(state);
        }
        state.cart = nextCart;
      }
      return;
    case 'quoteFulfillment':
      if (isRecord(result.value)) {
        state.fulfillment = result.value as unknown as AgentGraphState['fulfillment'];
        if (isRecord(args.address)) {
          state.address = args.address as unknown as AgentGraphState['address'];
        }
        if (state.fulfillment) {
          repriceCartWithDeliveryFee(state, state.fulfillment.feeVnd);
          emitSessionUpdate(input, {
            updateType: 'store_assigned',
            storeId: state.fulfillment.storeId,
            storeName: state.fulfillment.storeName,
          });
          emitSessionUpdate(input, {
            updateType: 'delivery_quote',
            feeVnd: state.fulfillment.feeVnd,
            etaMinutes: state.fulfillment.etaMinutes,
            method: state.fulfillment.method,
          });
          emitSessionUpdate(input, {
            updateType: 'fulfillment_quoted',
            storeId: state.fulfillment.storeId,
            storeName: state.fulfillment.storeName,
            feeVnd: state.fulfillment.feeVnd,
            etaMinutes: state.fulfillment.etaMinutes,
          });
        }
      }
      return;
    case 'searchPromotions':
      if (Array.isArray(result.value)) {
        state.promotionContext = {
          matchedOfferIds: result.value.flatMap((entry) => (isRecord(entry) && typeof entry.offerId === 'string' ? [entry.offerId] : [])),
          validation: state.promotionContext?.validation,
          caveats: state.promotionContext?.caveats ?? [],
        };
      }
      emitSessionUpdate(input, { updateType: 'promotion_answered' });
      return;
    case 'searchMenu':
      if (Array.isArray(result.value)) {
        state.menuSearchResults = result.value as AgentGraphState['menuSearchResults'];
      }
      return;
    case 'getModifierOptions':
      if (isRecord(result.value)) {
        state.menuModifierOptions = result.value as AgentGraphState['menuModifierOptions'];
      }
      return;
    case 'explainPromotion':
      if (isRecord(result.value) && typeof result.value.offerId === 'string') {
        state.promotionContext = {
          matchedOfferIds: [...new Set([...(state.promotionContext?.matchedOfferIds ?? []), result.value.offerId])],
          validation: state.promotionContext?.validation,
          caveats: state.promotionContext?.caveats ?? [],
        };
      }
      return;
    case 'validateVoucher':
      if (isRecord(result.value)) {
        const validation = result.value as unknown as PromotionValidationResult;
        state.promotionContext = {
          matchedOfferIds: state.promotionContext?.matchedOfferIds ?? [],
          validation,
          caveats: validation.ok ? [] : ['Public crawl did not expose a reusable public promo code.'],
        };
        applyVoucherToCart(state, validation);
      }
      return;
    case 'searchContentPolicy':
    case 'answerAllergenQuestion':
      const evidence =
        Array.isArray(result.value) && result.value.length > 0 ? (result.value as AgentGraphState['contentEvidence']) : undefined;
      if (evidence) {
        state.contentEvidence = result.value as AgentGraphState['contentEvidence'];
      }
      if (result.toolName === 'answerAllergenQuestion' && evidence) {
        emitSessionUpdate(input, {
          updateType: 'content_evidence_found',
          kind: 'allergen',
        });
      }
      return;
    case 'listPaymentMethods':
      if (Array.isArray(result.value)) {
        state.paymentMethodEvidence = result.value as AgentGraphState['paymentMethodEvidence'];
      }
      return;
    case 'previewOrder':
      if (isRecord(result.value)) {
        state.orderPreview = result.value as unknown as AgentGraphState['orderPreview'];
      }
      return;
    case 'placeOrder':
      if (isRecord(result.value)) {
        state.order = result.value as unknown as AgentGraphState['order'];
      }
      return;
    case 'getOrderStatus':
      if (isRecord(result.value)) {
        state.order = result.value as unknown as AgentGraphState['order'];
      }
      return;
    case 'createPaymentLink':
      if (isRecord(result.value) && typeof args.method === 'string') {
        state.paymentAttempt = {
          method: args.method as PaymentLinkMethod,
          status: typeof result.value.status === 'string' ? (result.value.status as 'pending' | 'paid' | 'failed') : 'pending',
          paymentUrl: typeof result.value.url === 'string' ? result.value.url : undefined,
        };
      }
      return;
    case 'checkPaymentStatus':
      if (isRecord(result.value) && typeof result.value.status === 'string') {
        state.paymentAttempt = {
          method: state.paymentAttempt?.method,
          status: result.value.status as 'pending' | 'paid' | 'failed',
          paymentUrl: state.paymentAttempt?.paymentUrl,
        };
      }
      return;
    case 'getMembershipProfile':
      if (isRecord(result.value) && typeof result.value.points === 'number') {
        state.customerContext = {
          savedAddresses: state.customerContext?.savedAddresses ?? [],
          recentOrders: state.customerContext?.recentOrders ?? [],
          favorites: state.customerContext?.favorites ?? [],
          loyaltyPoints: result.value.points,
        };
      }
      return;
    case 'listMembershipRewards':
    case 'listMembershipWallet':
    case 'getMembershipPointHistory':
    case 'listMembershipTools':
    case 'acquireVoucher':
    case 'redeemReward':
      return;
    case 'collectInvoice':
      if (isRecord(result.value)) {
        state.invoiceRequest = result.value as unknown as AgentGraphState['invoiceRequest'];
        emitSessionUpdate(input, {
          updateType: 'invoice_requested',
          ...result.value,
        });
      }
      return;
    case 'handoff':
      if (isRecord(result.value) && typeof result.value.escalationId === 'string') {
        state.handoff = {
          escalationId: result.value.escalationId,
          reasons: Array.isArray(args.reasons) ? args.reasons.filter((reason): reason is string => typeof reason === 'string') : [],
        };
      }
      return;
  }
}

const activeTurnTraces = new WeakMap<AgentTurnInput, AgentTraceSpan>();

async function executeTracedToolCall(input: {
  turnInput: AgentTurnInput;
  turnTrace?: AgentTraceSpan;
  state: AgentGraphState;
  call: ToolCallRequest;
}): Promise<ToolCallResult> {
  const turnTrace = input.turnTrace ?? activeTurnTraces.get(input.turnInput);
  const toolSpan = turnTrace ? await turnTrace.startSpan({
    name: `tool_call:${input.call.toolName}`,
    runType: 'tool',
    inputs: {
      toolName: input.call.toolName,
      arguments: input.call.arguments,
      boundary: getToolBoundary(input.call.toolName),
    },
    metadata: { component: 'executeToolCall' },
    tags: ['agent-tool', `tool:${input.call.toolName}`],
  }) : undefined;

  let result: ToolCallResult;
  try {
    result = await executeToolCall(
      input.turnInput.clients,
      input.state,
      input.call,
      toolExecutionContext(input.turnInput),
    );
    await toolSpan?.end({
      ok: result.ok,
      resultSummary: result.ok ? result.message : (result.errorCode ?? result.message),
      provenance: result.provenance ?? null,
    });
  } catch (error) {
    await toolSpan?.fail(error);
    throw error;
  }

  return result;
}

async function applyTracedToolResult(input: {
  turnInput: AgentTurnInput;
  turnTrace?: AgentTraceSpan;
  state: AgentGraphState;
  call: ToolCallRequest;
  result: ToolCallResult;
  currentTurnToolTrace: ToolTraceEntry[];
}): Promise<void> {
  const turnTrace = input.turnTrace ?? activeTurnTraces.get(input.turnInput);
  const before = traceStateSummary(input.state);
  const stateSpan = turnTrace ? await turnTrace.startSpan({
    name: 'state_update',
    runType: 'chain',
    inputs: { toolName: input.call.toolName, before },
  }) : undefined;

  applyToolResultToState(
    input.turnInput,
    input.state,
    input.result,
    input.call.arguments,
    input.currentTurnToolTrace,
  );
  await stateSpan?.end({
    toolName: input.call.toolName,
    before,
    after: traceStateSummary(input.state),
  });
}

async function executeAndApplyTracedToolCall(input: {
  turnInput: AgentTurnInput;
  turnTrace?: AgentTraceSpan;
  state: AgentGraphState;
  call: ToolCallRequest;
  currentTurnToolTrace: ToolTraceEntry[];
}): Promise<ToolCallResult> {
  const result = await executeTracedToolCall(input);
  await applyTracedToolResult({ ...input, result });
  return result;
}

async function ensureCartForTool(input: AgentTurnInput, state: AgentGraphState, call: ToolCallRequest): Promise<boolean> {
  if (call.toolName !== 'updateCart' || state.cart) return true;

  const cartResult = await input.clients.cart.createCart(input.sessionId);
  if (!cartResult.ok || !cartResult.value) {
    pushEscalationReasons(state, ['cart_initialization_failed']);
    return false;
  }

  state.cart = cartResult.value;
  return true;
}

async function quoteFulfillmentFromVerifiedAddress(input: {
  turnInput: AgentTurnInput;
  state: AgentGraphState;
  currentTurnToolTrace: ToolTraceEntry[];
}): Promise<void> {
  if (!input.state.cart || input.state.cart.items.length === 0 || input.state.fulfillment) return;
  if (input.state.escalationReasons.includes('menu_item_verification_required')) return;

  const addressText =
    isRecord(input.state.entities) && typeof input.state.entities.addressText === 'string' ? input.state.entities.addressText : undefined;
  const address =
    (addressText ? addressFromText(addressText) : undefined) ??
    (shouldUseKnownAddressForFulfillment(input.state) ? input.state.address : undefined);
  const itemCodes = cartItemCodes(input.state);
  if (!address || itemCodes.length === 0) return;

  const call: ToolCallRequest = {
    toolName: 'quoteFulfillment',
    arguments: {
      address,
      method: 'delivery',
      itemCodes,
    },
  };
  const gating = applySafetyGates(input.state, [call]);
  await tracePolicyDecision(activeTurnTraces.get(input.turnInput), {
    proposedToolNames: [call.toolName],
    allowedToolNames: gating.allowedCalls.map((allowedCall) => allowedCall.toolName),
    blockedReasons: gating.blockedReasons,
  });
  pushEscalationReasons(input.state, gating.blockedReasons);
  if (gating.allowedCalls.length === 0) return;

  await executeAndApplyTracedToolCall({ ...input, call });
}

async function discoverStoresForActiveFulfillment(input: {
  turnInput: AgentTurnInput;
  state: AgentGraphState;
  currentTurnToolTrace: ToolTraceEntry[];
}): Promise<void> {
  if (input.state.fulfillment || input.state.address) return;
  if (
    input.currentTurnToolTrace.some((entry) =>
      ['findStores', 'checkStoreAvailability', 'quoteFulfillment'].includes(entry.toolName),
    )
  ) {
    return;
  }

  const call: ToolCallRequest = {
    toolName: 'findStores',
    arguments: { query: input.state.latestUserMessage },
  };
  await executeAndApplyTracedToolCall({ ...input, call });
}

async function placeConfirmedOrderFromVerifiedState(input: {
  turnInput: AgentTurnInput;
  state: AgentGraphState;
  currentTurnToolTrace: ToolTraceEntry[];
}): Promise<void> {
  if (!input.state.userConfirmedOrder || input.state.order) return;
  if (input.state.escalationReasons.includes('menu_item_verification_required')) return;

  const placeCall: ToolCallRequest = { toolName: 'placeOrder', arguments: {} };
  const gating = applySafetyGates(input.state, [placeCall]);
  await tracePolicyDecision(activeTurnTraces.get(input.turnInput), {
    proposedToolNames: [placeCall.toolName],
    allowedToolNames: gating.allowedCalls.map((allowedCall) => allowedCall.toolName),
    blockedReasons: gating.blockedReasons,
  });
  pushEscalationReasons(input.state, gating.blockedReasons);
  if (gating.allowedCalls.length === 0) return;

  if (!input.state.orderPreview) {
    const previewCall: ToolCallRequest = {
      toolName: 'previewOrder',
      arguments: {},
    };
    const previewResult = await executeAndApplyTracedToolCall({ ...input, call: previewCall });
    if (!previewResult.ok) return;
  }

  await executeAndApplyTracedToolCall({ ...input, call: placeCall });
}

async function addConfirmedPreviousOrderToCart(input: {
  turnInput: AgentTurnInput;
  state: AgentGraphState;
  currentTurnToolTrace: ToolTraceEntry[];
  contextPolicy: ContextPolicyDirective;
}): Promise<void> {
  if (isFavoriteItemRequest(input.state.latestUserMessage)) return;
  if (contextPolicyRequiresConfirmation(input.contextPolicy, 'recentOrder')) return;
  if (!contextPolicyIsActive(input.contextPolicy, 'recentOrder')) return;
  if (hasSuccessfulToolResult(input.currentTurnToolTrace, ['updateCart'])) return;
  if (input.state.cart && input.state.cart.items.length > 0 && !input.state.order) return;

  const recentOrder = input.state.customerContext?.recentOrders[0];
  if (!recentOrder || recentOrder.cart.items.length === 0) return;
  if (!hasPlannerBooleanEntity(input.state, 'reorderConfirmed')) {
    input.state.entities = {
      ...(isRecord(input.state.entities) ? input.state.entities : {}),
      asksClarification: true,
    };
    pushEscalationReasons(input.state, ['previous_order_confirmation_required']);
    return;
  }

  input.state.order = undefined;
  input.state.orderPreview = undefined;
  input.state.paymentAttempt = undefined;
  input.state.fulfillment = undefined;

  for (const item of recentOrder.cart.items) {
    const call: ToolCallRequest = {
      toolName: 'updateCart',
      arguments: { itemCode: item.itemCode, quantity: item.quantity },
    };
    if (hasSuccessfulCurrentTurnToolCall(input.currentTurnToolTrace, call)) continue;

    const gating = applySafetyGates(input.state, [call]);
    await tracePolicyDecision(activeTurnTraces.get(input.turnInput), {
      proposedToolNames: [call.toolName],
      allowedToolNames: gating.allowedCalls.map((allowedCall) => allowedCall.toolName),
      blockedReasons: gating.blockedReasons,
    });
    pushEscalationReasons(input.state, gating.blockedReasons);
    if (gating.allowedCalls.length === 0) continue;

    const ready = await ensureCartForTool(input.turnInput, input.state, call);
    if (!ready) continue;

    await executeAndApplyTracedToolCall({ ...input, call });
  }
  if (input.state.cart) {
    input.state.entities = {
      ...(isRecord(input.state.entities) ? input.state.entities : {}),
      keepMenuSurface: false,
    };
  }
}

async function ensureMembershipProfileForActivePolicy(input: {
  turnInput: AgentTurnInput;
  state: AgentGraphState;
  currentTurnToolTrace: ToolTraceEntry[];
  contextPolicy: ContextPolicyDirective;
  force?: boolean;
}): Promise<void> {
  if (!input.force && !contextPolicyIsActive(input.contextPolicy, 'membership')) return;
  if (typeof input.state.customerContext?.loyaltyPoints === 'number') return;
  if (hasSuccessfulToolResult(input.currentTurnToolTrace, ['getMembershipProfile'])) return;

  const call: ToolCallRequest = { toolName: 'getMembershipProfile', arguments: {} };
  await executeAndApplyTracedToolCall({ ...input, call });
}

function shouldRepairTextOnlyMenuRecommendation(
  state: AgentGraphState,
  entries: ToolTraceEntry[],
  contextPolicy: ContextPolicyDirective,
): boolean {
  if (state.cart || (state.menuSearchResults?.length ?? 0) > 0) return false;
  if (isLowSignalMessage(state.latestUserMessage)) return false;
  const hasStructuredItem = isRecord(state.entities) && typeof state.entities.itemText === 'string';
  const hasStructuredGroupRequest =
    /\d/.test(state.latestUserMessage) &&
    /\b(?:nguoi|combo|mon|an|phan)\b/.test(normalizedIntentText(state.latestUserMessage));
  if (!hasStructuredItem && !hasStructuredGroupRequest && !isMenuDiscoveryRequest(state.latestUserMessage)) return false;

  return (
    (state.intent === 'ordering' || contextPolicyIsActive(contextPolicy, 'menuSearchResults')) &&
    !state.menuSearchResults?.length &&
    !hasSuccessfulToolResult(state.toolTrace ?? [], ['searchMenu'])
  );
}

function isFavoriteItemRequest(text: string): boolean {
  const normalized = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase();

  return /\b(?:mon|minh)\s+(?:hay an|yeu thich|thuong dat)\b/.test(normalized);
}

function normalizedIntentText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase();
}

function isPostOrderTrackingRequest(text: string): boolean {
  const normalized = normalizedIntentText(text);
  return /(?:don.*(?:toi dau|giao toi|giao den)|bao lau.*giao|khoang bao lau.*toi|eta)/.test(normalized);
}

function isOrderCancellationRequest(text: string): boolean {
  const normalized = normalizedIntentText(text);
  if (/\b(?:chua\s+huy|khong\s+muon\s+huy)\b/.test(normalized)) return false;
  return /\b(?:huy\s+don|muon\s+huy|van\b.*\bhuy)\b/.test(normalized);
}

function isPostOrderModificationRequest(text: string): boolean {
  const normalized = normalizedIntentText(text);
  return /(?:them|bot|bo|doi).*(?:mon|khoai|pepsi|combo|ga|burger)/.test(normalized);
}

function isAddressChangeRequest(text: string): boolean {
  return /\bdoi\s+dia\s+chi\b/.test(normalizedIntentText(text));
}

function isDeliveryFulfillmentRequest(text: string): boolean {
  const normalized = normalizedIntentText(text);
  if (!/\bgiao\s+(?:ve|toi|qua|den)\b/.test(normalized)) return false;
  return !isMultiItemOrderRequest(text);
}

function isMultiItemOrderRequest(text: string): boolean {
  const normalized = normalizedIntentText(text);
  const itemSignals = ['combo', 'burger', 'pepsi'].filter((signal) =>
    new RegExp(`\\b${signal}\\b`).test(normalized),
  );
  return itemSignals.length > 1;
}

function isPaymentMethodAvailabilityRequest(text: string): boolean {
  const normalized = normalizedIntentText(text);
  return /\bthanh toan\b/.test(normalized) && /\b(?:duoc khong|co duoc|ho tro|chap nhan)\b/.test(normalized);
}

function isPaymentFailureRequest(text: string): boolean {
  const normalized = normalizedIntentText(text);
  return /\bthanh toan\b/.test(normalized) && /\b(?:loi|that bai|khong duoc)\b/.test(normalized);
}

function isHandoffExplanationRequest(text: string): boolean {
  const normalized = normalizedIntentText(text);
  return /\b(?:sao|tai sao)\b/.test(normalized) && /\b(?:nhan vien|chuyen nguoi)\b/.test(normalized);
}

function isCheckoutSupplementRequest(text: string): boolean {
  const normalized = normalizedIntentText(text);
  return /\b(?:voucher|ma kfc|ap dung|hoa don|bam chuong|goi minh)\b/.test(normalized);
}

function isMenuDiscoveryRequest(text: string): boolean {
  const normalized = normalizedIntentText(text);
  return (
    /(?:mon nao.*ban chay|combo nhom|goi y.*mon|khong biet an gi)/.test(normalized) ||
    (/\d/.test(normalized) && /\bnguoi\b/.test(normalized) && /\b(?:an|combo|mon)\b/.test(normalized))
  );
}

function isExplicitMenuUpgrade(text: string): boolean {
  const normalized = normalizedIntentText(text);
  return /^(?:ok|oke|dong y)\b/.test(normalized) && /\b(?:nang|them)\b.*\bburger\b/.test(normalized);
}

function isRejectedMenuUpsell(text: string): boolean {
  const normalized = normalizedIntentText(text);
  return /^(?:khong|thoi)\b/.test(normalized) && /\b(?:dung them|khong them|giu vay)\b/.test(normalized);
}

function isAmbiguousMenuAddRequest(text: string): boolean {
  const normalized = normalizedIntentText(text);
  return /\bcho (?:minh|toi|tui) (?:cai|mon) do\b/.test(normalized);
}

function isExplicitCartAddRequest(text: string): boolean {
  const normalized = normalizedIntentText(text);
  return (
    /\bcho (?:minh|toi|tui)\s+(?:\d+|mot|hai|ba)\b/.test(normalized) ||
    /\b(?:them|dat|lay)\s+(?:\d+|mot|hai|ba)\b/.test(normalized)
  );
}

function isAmbiguousCartFollowup(text: string): boolean {
  return /\b(?:giong hom bua|phan do|cai do|mon do)\b/.test(normalizedIntentText(text));
}

function isExplicitNamedCartRemoval(text: string, cart: Cart | undefined): boolean {
  if (!cart?.items.length) return false;
  const normalized = normalizedIntentText(text);
  if (!/\b(?:bo|xoa|remove)\b/.test(normalized)) return false;
  if (/\b(?:dung|khong)\s+(?:bo|xoa|remove)\b/.test(normalized)) return false;
  return cart.items.some((item) => normalized.includes(normalizedIntentText(item.name)));
}

function isDifferentRecipientReorder(text: string): boolean {
  const normalized = normalizedIntentText(text);
  return /\bdat lai\b/.test(normalized) && /\b(?:dong nghiep|ban be|nguoi khac)\b/.test(normalized);
}

function isDifferentRecipientReorderConfirmation(
  text: string,
  recentTurns: ConversationTurn[],
): boolean {
  const normalized = normalizedIntentText(text);
  if (!/^(?:dung roi|dong y|ok|oke)\b/.test(normalized)) return false;
  return recentTurns.some(
    (turn) => turn.role === 'user' && isDifferentRecipientReorder(turn.text),
  );
}

function isAffirmativeFulfillmentFollowup(
  text: string,
  recentTurns: ConversationTurn[],
): boolean {
  const normalized = normalizedIntentText(text).trim();
  if (!/^(?:dung roi|tiep tuc dat|tiep tuc giao)\b/.test(normalized)) return false;
  return recentTurns.some(
    (turn) =>
      turn.role === 'assistant' &&
      (turn.metadata?.genUi?.widgetKind === 'addressFulfillmentCheck' ||
        turn.metadata?.genUi?.widgetKind === 'orderReviewConfirm'),
  );
}

function isExplicitCartContinuationRequest(text: string): boolean {
  const normalized = normalizedIntentText(text);
  return /\btiep tuc\b/.test(normalized) && /\b(?:don|gio|dat)\b/.test(normalized);
}

function isExplicitOrderConfirmationRequest(text: string): boolean {
  const normalized = normalizedIntentText(text);
  if (/\b(?:chua|khong|dung)\s+xac nhan don\b/.test(normalized)) return false;
  return /\b(?:xac nhan don|chot don)\b/.test(normalized);
}

async function ensurePostOrderConversationJob(input: {
  turnInput: AgentTurnInput;
  state: AgentGraphState;
  currentTurnToolTrace: ToolTraceEntry[];
}): Promise<void> {
  const tracksOrder = isPostOrderTrackingRequest(input.state.latestUserMessage);
  const cancelsOrder = isOrderCancellationRequest(input.state.latestUserMessage);
  const reportsPaymentFailure = isPaymentFailureRequest(input.state.latestUserMessage);
  if (!tracksOrder && !cancelsOrder && !reportsPaymentFailure) return;

  const hydrated = await hydrateRecentOrderContext(
    input.turnInput,
    buildVerifiedStateSnapshot(input.state),
    { order: 'active', payment: 'active' },
  );
  Object.assign(input.state, hydrated);
  if (!cancelsOrder || input.state.handoff) return;

  const call: ToolCallRequest = {
    toolName: 'handoff',
    arguments: { reasons: ['order_cancellation_requested'] },
  };
  await executeAndApplyTracedToolCall({ ...input, call });
}

async function ensureAffirmedMenuSelection(input: {
  turnInput: AgentTurnInput;
  state: AgentGraphState;
  recentTurns: ConversationTurn[];
  currentTurnToolTrace: ToolTraceEntry[];
}): Promise<void> {
  if (input.state.cart || !isAffirmativeFulfillmentFollowup(input.state.latestUserMessage, input.recentTurns)) return;
  const selectionTurn = [...input.recentTurns]
    .reverse()
    .find((turn) => turn.role === 'user' && /\blay\b/.test(normalizedIntentText(turn.text)));
  if (!selectionTurn) return;

  const requestedWords = new Set(
    normalizedIntentText(selectionTurn.text)
      .split(/\s+/)
      .filter((word) => word.length >= 4),
  );
  const selectedItem = [...(input.state.menuSearchResults ?? [])]
    .map((item) => ({
      item,
      score: normalizedIntentText(item.name)
        .split(/\s+/)
        .filter((word) => requestedWords.has(word)).length,
    }))
    .sort((left, right) => right.score - left.score)[0];
  if (!selectedItem || selectedItem.score === 0) return;

  const call: ToolCallRequest = {
    toolName: 'updateCart',
    arguments: { itemCode: selectedItem.item.code, quantity: 1 },
  };
  if (!(await ensureCartForTool(input.turnInput, input.state, call))) return;
  await executeAndApplyTracedToolCall({ ...input, call });
}

async function ensureExplicitMenuUpgrade(input: {
  turnInput: AgentTurnInput;
  state: AgentGraphState;
  currentTurnToolTrace: ToolTraceEntry[];
}): Promise<void> {
  if (!isExplicitMenuUpgrade(input.state.latestUserMessage)) return;
  if (hasSuccessfulToolResult(input.currentTurnToolTrace, ['updateCart'])) return;
  let selectedItem = (input.state.menuSearchResults ?? []).find((item) =>
    item && /\bburger\b/.test(normalizedIntentText(`${item.name} ${item.description}`)),
  );
  if (!selectedItem) {
    const searchCall: ToolCallRequest = {
      toolName: 'searchMenu',
      arguments: { query: 'burger' },
    };
    await executeAndApplyTracedToolCall({ ...input, call: searchCall });
    selectedItem = (input.state.menuSearchResults ?? []).find((item) =>
      item && /\bburger\b/.test(normalizedIntentText(`${item.name} ${item.description}`)),
    );
  }
  if (!selectedItem) return;

  const call: ToolCallRequest = {
    toolName: 'updateCart',
    arguments: { itemCode: selectedItem.code, quantity: 1 },
  };
  if (!(await ensureCartForTool(input.turnInput, input.state, call))) return;
  await executeAndApplyTracedToolCall({ ...input, call });
  input.state.entities = {
    ...(isRecord(input.state.entities) ? input.state.entities : {}),
    keepMenuSurface: false,
  };
}

async function ensureExplicitNamedMenuSelection(input: {
  turnInput: AgentTurnInput;
  state: AgentGraphState;
  currentTurnToolTrace: ToolTraceEntry[];
}): Promise<void> {
  if (!/\b(?:lay|them|chon)\b/.test(normalizedIntentText(input.state.latestUserMessage))) return;
  if (hasSuccessfulToolResult(input.currentTurnToolTrace, ['updateCart'])) return;
  const genericMenuWords = new Set(['burger', 'combo', 'mon', 'phan', 'size']);
  const requestedWords = new Set(
    normalizedIntentText(input.state.latestUserMessage)
      .split(/\s+/)
      .filter((word) => word.length >= 3 && !genericMenuWords.has(word)),
  );
  const selected = [...(input.state.menuSearchResults ?? [])]
    .map((item) => ({ item, score: normalizedIntentText(item.name).split(/\s+/).filter((word) => requestedWords.has(word)).length }))
    .sort((left, right) => right.score - left.score)[0];
  if (!selected || selected.score === 0) return;
  const call: ToolCallRequest = { toolName: 'updateCart', arguments: { itemCode: selected.item.code, quantity: 1 } };
  if (!(await ensureCartForTool(input.turnInput, input.state, call))) return;
  await executeAndApplyTracedToolCall({ ...input, call });
}

async function ensureExplicitCartReplacement(input: {
  turnInput: AgentTurnInput;
  state: AgentGraphState;
  currentTurnToolTrace: ToolTraceEntry[];
}): Promise<void> {
  const normalized = normalizedIntentText(input.state.latestUserMessage);
  if (!input.state.cart || !/\bbo\b.+\b(?:doi thanh|thay bang)\b/.test(normalized)) return;
  const removed = input.state.cart.items.find((item) => normalized.includes(normalizedIntentText(item.name).split(/\s+/)[0]!));
  const replacementText = normalized.split(/\b(?:doi thanh|thay bang)\b/)[1]?.trim();
  const replacement = [...(input.state.menuSearchResults ?? [])]
    .map((item) => ({ item, score: normalizedIntentText(item.name).split(/\s+/).filter((word) => replacementText?.includes(word)).length }))
    .sort((a, b) => b.score - a.score)[0];
  if (!removed || !replacement || replacement.score === 0) return;
  for (const call of [
    { toolName: 'updateCart', arguments: { itemCode: removed.itemCode, quantity: 0 } },
    { toolName: 'updateCart', arguments: { itemCode: replacement.item.code, quantity: 1 } },
  ] satisfies ToolCallRequest[]) {
    await executeAndApplyTracedToolCall({ ...input, call });
  }
}

async function ensureExplicitNamedCartRemoval(input: {
  turnInput: AgentTurnInput;
  turnTrace: AgentTraceSpan;
  state: AgentGraphState;
  currentTurnToolTrace: ToolTraceEntry[];
}): Promise<void> {
  if (!input.state.cart || !isExplicitNamedCartRemoval(input.state.latestUserMessage, input.state.cart)) return;
  if (hasSuccessfulToolResult(input.currentTurnToolTrace, ['updateCart'])) return;

  const normalized = normalizedIntentText(input.state.latestUserMessage);
  const item = input.state.cart.items.find((entry) => normalized.includes(normalizedIntentText(entry.name)));
  if (!item) return;

  const call: ToolCallRequest = {
    toolName: 'updateCart',
    arguments: { itemCode: item.itemCode, quantity: 0 },
  };
  const gating = applySafetyGates(input.state, [call], { requireCartMutationConfirmation: true });
  await tracePolicyDecision(input.turnTrace, {
    proposedToolNames: [call.toolName],
    allowedToolNames: gating.allowedCalls.map((allowedCall) => allowedCall.toolName),
    blockedReasons: gating.blockedReasons,
    confirmationRequired: true,
  });
  pushEscalationReasons(input.state, gating.blockedReasons);
  if (gating.allowedCalls.length === 0) return;
  await executeAndApplyTracedToolCall({ ...input, call });
}

async function ensureAmbiguousReferencedMenuAdd(input: {
  turnInput: AgentTurnInput;
  state: AgentGraphState;
  currentTurnToolTrace: ToolTraceEntry[];
}): Promise<void> {
  if (!isAmbiguousMenuAddRequest(input.state.latestUserMessage)) return;
  if (hasSuccessfulToolResult(input.currentTurnToolTrace, ['updateCart'])) return;
  const selectedItem = input.state.menuSearchResults?.[0];
  if (!selectedItem) return;
  const call: ToolCallRequest = {
    toolName: 'updateCart',
    arguments: { itemCode: selectedItem.code, quantity: 1 },
  };
  if (!(await ensureCartForTool(input.turnInput, input.state, call))) return;
  await executeAndApplyTracedToolCall({ ...input, call });
  input.state.entities = {
    ...(isRecord(input.state.entities) ? input.state.entities : {}),
    keepMenuSurface: false,
  };
}

async function ensureMenuDiscoverySurface(input: {
  turnInput: AgentTurnInput;
  state: AgentGraphState;
  currentTurnToolTrace: ToolTraceEntry[];
}): Promise<void> {
  if (!isMenuDiscoveryRequest(input.state.latestUserMessage) || input.state.cart) return;
  if ((input.state.menuSearchResults?.length ?? 0) === 0) {
    const call: ToolCallRequest = {
      toolName: 'searchMenu',
      arguments: { query: input.state.latestUserMessage },
    };
    let result = await executeTracedToolCall({ ...input, call });
    if (result.ok && Array.isArray(result.value) && result.value.length === 0) {
      call.arguments = { query: '' };
      result = await executeTracedToolCall({ ...input, call });
    }
    await applyTracedToolResult({ ...input, call, result });
  }
  if ((input.state.menuSearchResults?.length ?? 0) > 0) {
    input.state.entities = {
      ...(isRecord(input.state.entities) ? input.state.entities : {}),
      keepMenuSurface: true,
    };
  }
}

async function ensureFavoriteItemMenuSurface(input: {
  turnInput: AgentTurnInput;
  state: AgentGraphState;
  currentTurnToolTrace: ToolTraceEntry[];
}): Promise<void> {
  if (!isFavoriteItemRequest(input.state.latestUserMessage)) return;
  const verifiedOrderItem = input.state.order?.cart.items[0];
  if (input.state.order && input.state.cart?.id === input.state.order.cart.id) {
    input.state.cart = undefined;
  }
  input.state.order = undefined;
  input.state.orderPreview = undefined;
  input.state.paymentAttempt = undefined;
  input.state.fulfillment = undefined;
  if ((input.state.menuSearchResults?.length ?? 0) > 0) {
    input.state.entities = {
      ...(isRecord(input.state.entities) ? input.state.entities : {}),
      keepMenuSurface: true,
    };
    return;
  }
  let verifiedItem =
    input.state.customerContext?.favorites[0] ??
    input.state.customerContext?.recentOrders
      .flatMap((order) => order.cart.items)
      .find((item) => item.quantity > 0) ??
    verifiedOrderItem;
  if (!verifiedItem) {
    const recentOrderResult = await input.turnInput.clients.customer.getRecentOrder(
      input.turnInput.customerId,
    );
    if (recentOrderResult.ok && recentOrderResult.value) {
      const recentOrder = recentOrderResult.value;
      input.state.customerContext = {
        savedAddresses: input.state.customerContext?.savedAddresses ?? [],
        recentOrders: [recentOrder, ...(input.state.customerContext?.recentOrders ?? [])],
        favorites: input.state.customerContext?.favorites ?? [],
        loyaltyPoints: input.state.customerContext?.loyaltyPoints,
      };
      verifiedItem = recentOrder.cart.items[0];
    }
  }
  if (!verifiedItem) return;

  const call: ToolCallRequest = {
    toolName: 'searchMenu',
    arguments: { query: verifiedItem.name },
  };
  await executeAndApplyTracedToolCall({ ...input, call });
  if ((input.state.menuSearchResults?.length ?? 0) > 0) {
    input.state.entities = {
      ...(isRecord(input.state.entities) ? input.state.entities : {}),
      keepMenuSurface: true,
    };
  }
}

function hasSuccessfulToolResult(entries: ToolTraceEntry[], toolNames: ToolTraceEntry['toolName'][]): boolean {
  return entries.some((entry) => entry.ok && toolNames.includes(entry.toolName));
}

const membershipProfileDependentTools: ToolTraceEntry['toolName'][] = [
  'listMembershipRewards',
  'listMembershipWallet',
  'getMembershipPointHistory',
  'acquireVoucher',
  'redeemReward',
];

function hasMembershipProfileDependentTool(calls: ToolCallRequest[]): boolean {
  return calls.some((call) => membershipProfileDependentTools.includes(call.toolName));
}

function requiresExplicitDestructiveCartConfirmation(state: AgentGraphState, call: ToolCallRequest): boolean {
  if (call.toolName !== 'updateCart') return false;
  if (!state.cart || state.cart.items.length === 0) return false;
  if (hasPlannerBooleanEntity(state, 'cartMutationConfirmed')) return false;
  const itemCode = typeof call.arguments.itemCode === 'string' ? call.arguments.itemCode : undefined;
  const nextQuantity = typeof call.arguments.quantity === 'number' ? call.arguments.quantity : undefined;
  if (!itemCode || nextQuantity === undefined) return false;
  const currentItem = state.cart.items.find((item) => item.itemCode === itemCode);
  return Boolean(currentItem && nextQuantity < currentItem.quantity);
}

function contextPolicyBecameActive(
  before: ContextPolicyDirective,
  after: ContextPolicyDirective,
  key: keyof ContextPolicyDirective,
): boolean {
  return !contextPolicyIsActive(before, key) && contextPolicyIsActive(after, key);
}

function shouldReplanAfterSensitiveContextActivation(input: {
  before: ContextPolicyDirective;
  after: ContextPolicyDirective;
  toolCalls: ToolCallRequest[];
}): boolean {
  if (input.toolCalls.length === 0) return false;
  const activatesCart = contextPolicyBecameActive(input.before, input.after, 'cart');
  const activatesRecentOrder = contextPolicyBecameActive(input.before, input.after, 'recentOrder');
  const activatesOrder = contextPolicyBecameActive(input.before, input.after, 'order');
  const activatesPayment = contextPolicyBecameActive(input.before, input.after, 'payment');
  return input.toolCalls.some((call) => {
    if (activatesCart && ['updateCart', 'previewCart', 'previewOrder', 'placeOrder'].includes(call.toolName)) return true;
    if (activatesRecentOrder && ['updateCart', 'previewCart', 'previewOrder', 'placeOrder'].includes(call.toolName)) return true;
    if (activatesOrder && ['previewOrder', 'placeOrder', 'getOrderStatus', 'createPaymentLink', 'checkPaymentStatus'].includes(call.toolName)) {
      return true;
    }
    if (activatesPayment && ['createPaymentLink', 'checkPaymentStatus'].includes(call.toolName)) return true;
    return false;
  });
}

function shouldPreserveCurrentMenuSearchResults(entries: ToolTraceEntry[]): boolean {
  return hasSuccessfulToolResult(entries, ['searchMenu']);
}

function shouldPreserveCurrentCartOrderPaymentContext(entries: ToolTraceEntry[]): boolean {
  return hasSuccessfulToolResult(entries, [
    'updateCart',
    'previewCart',
    'quoteFulfillment',
    'validateVoucher',
    'recommendAddOns',
    'getModifierOptions',
    'previewOrder',
    'placeOrder',
    'createPaymentLink',
    'getOrderStatus',
  ]);
}

function shouldPreserveCurrentPaymentContext(entries: ToolTraceEntry[]): boolean {
  return hasSuccessfulToolResult(entries, ['listPaymentMethods', 'createPaymentLink', 'checkPaymentStatus']);
}

function shouldPreserveCurrentHandoff(entries: ToolTraceEntry[]): boolean {
  return hasSuccessfulToolResult(entries, ['handoff']);
}

function isStructurallySupportedHandoff(state: AgentGraphState, call: ToolCallRequest): boolean {
  if (call.toolName !== 'handoff') return true;

  const reasons = Array.isArray(call.arguments.reasons)
    ? call.arguments.reasons.filter((reason): reason is string => typeof reason === 'string')
    : [];
  if (state.intent === 'handoff') return true;
  if (state.intent === 'complaint' || state.intent === 'safety') return true;
  if (state.paymentAttempt?.status === 'failed' && reasons.includes('payment_failed')) return true;
  return reasons.some((reason) => reason === 'abnormal_large_order');
}

function hasExplicitAbnormalItemQuantity(text: string): boolean {
  const normalized = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .toLowerCase();
  const quantityPattern = /(?:^|\s)(\d{2,4})\s*(?:combo|phan|suat|mieng|burger|ga)\b/g;

  return [...normalized.matchAll(quantityPattern)].some((match) => Number(match[1]) >= 100);
}

function isLowSignalMessage(text: string): boolean {
  const normalized = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized || /\d/.test(normalized)) return false;
  if (normalized.split(' ').length > 4) return false;

  return !/(?:^|\s)(?:menu|combo|ga|burger|pepsi|mon|dat|them|bo|doi|gio|don|giao|voucher|ma|thanh|toan|cai|phan|cay|pho|mai)(?:\s|$)/.test(
    normalized,
  );
}

async function ensureAbnormalLargeOrderHandoff(input: {
  turnInput: AgentTurnInput;
  state: AgentGraphState;
  currentTurnToolTrace: ToolTraceEntry[];
}): Promise<void> {
  if (!hasExplicitAbnormalItemQuantity(input.state.latestUserMessage)) return;
  if (hasSuccessfulToolResult(input.currentTurnToolTrace, ['handoff'])) return;

  const reasons = ['abnormal_large_order', 'human_review_required'];
  input.state.intent = 'handoff';
  input.state.entities = {
    ...(isRecord(input.state.entities) ? input.state.entities : {}),
    abnormalLargeOrder: true,
  };
  pushEscalationReasons(input.state, reasons);

  const call: ToolCallRequest = {
    toolName: 'handoff',
    arguments: { reasons },
  };
  await executeAndApplyTracedToolCall({ ...input, call });
}

function clearRecoverableFulfillmentArgumentFailure(state: AgentGraphState, entries: ToolTraceEntry[]): void {
  if (!state.cart || state.fulfillment) return;
  if (!hasSuccessfulToolResult(entries, ['updateCart'])) return;
  const failedEntries = entries.filter((entry) => !entry.ok);
  const onlyIncompleteFulfillmentQuoteFailed = failedEntries.every(
    (entry) => entry.toolName === 'quoteFulfillment' && entry.resultSummary === 'invalid_tool_arguments',
  );
  if (!onlyIncompleteFulfillmentQuoteFailed) return;
  state.escalationReasons = state.escalationReasons.filter((reason) => reason !== 'tool_execution_failed');
}

function rememberPlannerPaymentMethod(state: AgentGraphState, checksPaymentMethodSupport = false): void {
  if (checksPaymentMethodSupport) return;
  const method = plannerPaymentMethod(state);
  if (!method || state.paymentAttempt?.paymentUrl) return;
  state.paymentAttempt = { method, status: 'pending' };
}

async function createPaymentLinkAfterOrderFromRememberedMethod(input: {
  turnInput: AgentTurnInput;
  state: AgentGraphState;
  currentTurnToolTrace: ToolTraceEntry[];
}): Promise<void> {
  if (!input.state.order || input.state.order.status !== 'created') return;
  const method = input.state.paymentAttempt?.method ?? linkMethodFromPaymentEvidence(input.state.paymentMethodEvidence);
  if (!method || input.state.paymentAttempt?.paymentUrl) return;

  const call: ToolCallRequest = {
    toolName: 'createPaymentLink',
    arguments: { method },
  };
  await executeAndApplyTracedToolCall({ ...input, call });
}

function emitDerivedEvents(input: AgentTurnInput, state: AgentGraphState, turnToolTrace: ToolTraceEntry[]): void {
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

async function emitSessionIntelligence(
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

const safeFallbackPriority = [
  'order_confirmation_required',
  'valid_fulfillment_required',
  'payment_tool_success_required',
  'promotion_evidence_required',
  'allergen_certainty_not_allowed',
  'tool_execution_failed',
  'cart_initialization_failed',
  'menu_item_verification_required',
  'cart_mutation_confirmation_required',
  'previous_order_confirmation_required',
] as const;

function paymentMethodFallbackText(state: AgentGraphState): string {
  const methods = state.paymentMethodEvidence ?? [];
  const supported = methods.filter((method) => method.supported);
  const requestedMethod = plannerPaymentMethod(state);
  const requestedEvidence = requestedMethod ? findPaymentEvidenceForLinkMethod(methods, requestedMethod) : undefined;
  const supportedNames = supported.map((method) => method.displayName).join(', ');

  if (requestedEvidence && !requestedEvidence.supported) {
    const suffix = supportedNames ? ` Các phương thức đang được liệt kê gồm: ${supportedNames}.` : '';
    return `Theo chính sách thanh toán công khai của KFC, ${requestedEvidence.displayName} không được liệt kê cho checkout website/app.${suffix}`;
  }

  if (requestedEvidence?.supported) {
    return `Theo chính sách thanh toán công khai của KFC, ${requestedEvidence.displayName} được liệt kê cho checkout website/app. Mình sẽ tạo thanh toán sau khi bạn xác nhận đơn.`;
  }

  return supportedNames
    ? `Theo chính sách thanh toán công khai của KFC, các phương thức đang được liệt kê gồm: ${supportedNames}.`
    : 'Mình chưa tìm thấy phương thức thanh toán đã được liệt kê trong dữ liệu KFC.';
}

function orderStatusFallbackText(state: AgentGraphState): string | undefined {
  if (!state.order) return undefined;
  const status = switchOrderStatusLabel(state.order.status);
  return `Đơn ${state.order.id} hiện ${status}. Bạn có thể xem trạng thái mới nhất trong thẻ theo dõi bên dưới.`;
}

function switchOrderStatusLabel(status: string): string {
  switch (status) {
    case 'created':
      return 'đã được tiếp nhận';
    case 'preparing':
      return 'đang được chuẩn bị';
    case 'delivering':
      return 'đang được giao';
    case 'delivered':
      return 'đã giao thành công';
    case 'cancelled':
      return 'đã bị hủy';
    default:
      return 'đang được xử lý';
  }
}

function selectSafeFallbackText(state: AgentGraphState, plannerFallbackText?: string): string {
  if (
    hasPlannerBooleanEntity(state, 'reorderConfirmed') &&
    state.cart &&
    !state.fulfillment &&
    hasSuccessfulToolResult(state.toolTrace ?? [], ['updateCart'])
  ) {
    const itemList = state.cart.items.map((item) => `${item.quantity} ${item.name}`).join(', ');
    return `Mình đã đặt lại ${itemList} vào giỏ hàng. Bạn gửi giúp mình địa chỉ giao hàng đầy đủ để mình kiểm tra phí ship và thời gian giao nhé.`;
  }

  if (state.handoff) {
    if (state.handoff.reasons.includes('order_cancellation_requested')) {
      return 'Mình đã ghi nhận yêu cầu hủy đơn. Nhân viên KFC sẽ kiểm tra trạng thái đơn trước khi xác nhận có thể hủy.';
    }
    if (state.handoff.reasons.includes('payment_failed')) {
      return 'Mình đã ghi nhận lỗi thanh toán và sẽ chuyển nhân viên KFC kiểm tra giao dịch cùng trạng thái đơn.';
    }
    return 'Mình đã ghi nhận yêu cầu và sẽ chuyển nhân viên KFC hỗ trợ.';
  }

  if (state.order && isPostOrderModificationRequest(state.latestUserMessage)) {
    return `Đơn ${state.order.id} đã được gửi đi nên không thể sửa trực tiếp. Bạn có thể gặp nhân viên KFC để kiểm tra khả năng hỗ trợ.`;
  }

  if (state.order && isPaymentFailureRequest(state.latestUserMessage)) {
    return `Mình đã kiểm tra đơn ${state.order.id}; hệ thống chưa ghi nhận thanh toán thành công. Bạn có thể thử thanh toán lại hoặc đổi phương thức trong thẻ bên dưới.`;
  }

  if (hasSuccessfulToolResult(state.toolTrace ?? [], ['getMembershipProfile']) && typeof state.customerContext?.loyaltyPoints === 'number') {
    const cartApplicability = state.cart
      ? ' Mình có thể kiểm tra ưu đãi áp dụng cho giỏ hiện tại, nhưng cần bạn chọn hoặc xác nhận phần thưởng trước khi đổi điểm.'
      : ' Nếu bạn muốn dùng điểm, mình có thể kiểm tra ưu đãi thành viên phù hợp.';
    return `Bạn hiện có ${state.customerContext.loyaltyPoints} điểm thành viên.${cartApplicability}`;
  }

  if (state.escalationReasons.length === 0) {
    if (isPostOrderTrackingRequest(state.latestUserMessage)) {
      const statusText = orderStatusFallbackText(state);
      if (statusText) return statusText;
    }

    if (!state.invoiceRequest && hasPlannerBooleanEntity(state, 'invoiceRequested')) {
      return 'Mình đã lưu ghi chú giao hàng và nhu cầu xuất hóa đơn công ty. Bạn vui lòng gửi tên công ty, mã số thuế và email nhận hóa đơn để mình hoàn tất đơn nhé.';
    }

    if (state.order?.status === 'created' && state.paymentAttempt?.paymentUrl) {
      return `Đơn ${state.order.id} đã được tạo. Mình đã tạo link thanh toán ${state.paymentAttempt.paymentUrl}; KFC sẽ xử lý đơn theo thông tin giao hàng và hóa đơn đã ghi nhận.`;
    }

    if (state.paymentMethodEvidence && state.paymentMethodEvidence.length > 0) {
      return paymentMethodFallbackText(state);
    }

    if (hasPlannerBooleanEntity(state, 'asksClarification') && state.customerContext?.recentOrders[0] && !state.cart) {
      const itemList = state.customerContext.recentOrders[0].cart.items.map((item) => `${item.quantity} ${item.name}`).join(', ');
      return `Đơn hàng trước của bạn là ${itemList}. Bạn có muốn đặt lại đơn này không?`;
    }

    if (state.paymentAttempt?.method && !state.paymentAttempt.paymentUrl && !state.order) {
      return `Phương thức thanh toán này dùng được cho đơn này. Mình sẽ tạo link thanh toán sau khi bạn xác nhận đơn.`;
    }

    if (state.handoff && !plannerFallbackText) {
      return 'Mình sẽ chuyển nhân viên hỗ trợ ngay.';
    }

    if (hasPlannerBooleanEntity(state, 'invoiceRequested') && !state.invoiceRequest) {
      return 'Mình có thể ghi nhận yêu cầu xuất hóa đơn. Bạn gửi giúp mình tên công ty, mã số thuế và email nhận hóa đơn nhé.';
    }

    if (hasPlannerBooleanEntity(state, 'asksClarification') && plannerFallbackText) {
      return plannerFallbackText;
    }

    if (
      state.cart &&
      !state.fulfillment &&
      !state.order &&
      !hasSuccessfulToolResult(state.toolTrace ?? [], [
        'searchMenu',
        'updateCart',
        'getMembershipProfile',
        'listMembershipRewards',
        'listMembershipWallet',
      ])
    ) {
      return 'Mình tiếp tục hỗ trợ giỏ hiện tại. Bạn gửi giúp mình địa chỉ giao hàng đầy đủ để mình kiểm tra phí ship và thời gian giao nhé.';
    }

    if (state.cart && !state.fulfillment && hasSuccessfulToolResult(state.toolTrace ?? [], ['updateCart'])) {
      const itemList = state.cart.items.map((item) => `${item.quantity} ${item.name}`).join(', ');
      return `Mình đã thêm ${itemList} vào giỏ hàng. Bạn gửi giúp mình địa chỉ giao hàng đầy đủ để mình kiểm tra phí ship và thời gian giao nhé.`;
    }

    if (
      state.cart &&
      !state.fulfillment &&
      !state.order &&
      hasSuccessfulToolResult(state.toolTrace ?? [], ['previewCart', 'recommendAddOns'])
    ) {
      return 'Mình tiếp tục hỗ trợ giỏ hiện tại. Bạn gửi giúp mình địa chỉ giao hàng đầy đủ để mình kiểm tra phí ship và thời gian giao nhé.';
    }

    if (state.cart?.voucherCode && state.promotionContext?.validation?.ok) {
      return `Mình đã áp dụng mã ${state.cart.voucherCode}, giảm ${state.cart.discountVnd.toLocaleString('vi-VN')}đ. Tổng tạm tính hiện là ${state.cart.totalVnd.toLocaleString('vi-VN')}đ.`;
    }

    if (state.cart && state.fulfillment && !state.orderPreview && !state.order) {
      const storeName = state.fulfillment.storeName.replace(/^KFC\s+/i, '');
      return `KFC ${storeName} có thể giao đơn này. Phí ship ${state.fulfillment.feeVnd.toLocaleString('vi-VN')}đ, dự kiến ${state.fulfillment.etaMinutes} phút; tạm tính ${state.cart.totalVnd.toLocaleString('vi-VN')}đ.`;
    }

    if (!state.cart && state.menuSearchResults && state.menuSearchResults.length > 0) {
      const visibleItems = state.menuSearchResults.slice(0, 5);
      const itemList = visibleItems.map((item) => `${item.name} (${item.priceVnd.toLocaleString('vi-VN')}đ)`).join(', ');
      const remaining = state.menuSearchResults.length - visibleItems.length;
      const suffix = remaining > 0 ? ` Còn ${remaining} món khác; bạn có thể thêm tiêu chí để lọc nhanh hơn.` : '';
      return `Mình tìm thấy ${itemList}.${suffix} Bạn muốn chọn món nào?`;
    }

    return plannerFallbackText ?? 'Mình đã kiểm tra thông tin từ dữ liệu KFC. Bạn muốn mình tiếp tục thế nào?';
  }

  const reasons = new Set(state.escalationReasons);
  const highestPriorityReason =
    safeFallbackPriority.find((reason) => reasons.has(reason)) ?? state.escalationReasons[0] ?? 'needs_verified_info';

  switch (highestPriorityReason) {
    case 'order_confirmation_required':
      return 'Mình chưa thể đặt đơn khi chưa có xác nhận rõ ràng. Nếu bạn muốn chốt đơn, hãy nhắn "xác nhận đơn".';
    case 'valid_fulfillment_required':
      return 'Mình cần xác minh cửa hàng và hình thức nhận hoặc giao trước khi tiếp tục đặt đơn.';
    case 'payment_tool_success_required':
      return 'Mình chưa xác minh được trạng thái thanh toán thành công. Bạn gửi mã đơn để mình kiểm tra lại nhé.';
    case 'promotion_evidence_required':
      return 'Mình chưa có thông tin khuyến mãi đã được xác minh cho yêu cầu này. Bạn gửi thêm mã hoặc để mình kiểm tra ưu đãi công khai nhé.';
    case 'allergen_certainty_not_allowed':
      return 'Mình không thể khẳng định tuyệt đối về dị ứng từ dữ liệu hiện có. Mình có thể chia sẻ thông tin thành phần đã xác minh nếu bạn cần.';
    case 'tool_execution_failed':
      return 'Mình chưa thực hiện được thao tác này từ dữ liệu backend đã xác minh. Bạn kiểm tra lại món hoặc yêu cầu cần làm giúp mình nhé.';
    case 'cart_initialization_failed':
      return 'Mình chưa khởi tạo được giỏ hàng từ dữ liệu hiện có. Bạn thử lại món cần đặt giúp mình nhé.';
    case 'menu_item_verification_required':
      return 'Mình chưa xác minh được đầy đủ món bạn muốn đặt từ menu KFC. Bạn gửi lại tên món hoặc combo cụ thể hơn giúp mình nhé.';
    case 'cart_mutation_confirmation_required':
      return 'Mình cần bạn xác nhận rõ món trong giỏ hiện tại cần thay đổi trước khi mình cập nhật giỏ.';
    case 'previous_order_confirmation_required':
      if (state.customerContext?.recentOrders[0]) {
        const itemList = state.customerContext.recentOrders[0].cart.items.map((item) => `${item.quantity} ${item.name}`).join(', ');
        return `Đơn hàng trước của bạn là ${itemList}. Bạn có muốn đặt lại đơn này không?`;
      }
      return 'Mình tìm thấy món trong đơn trước, nhưng cần bạn xác nhận rõ đơn trước muốn đặt lại trước khi mình thêm vào giỏ.';
    default:
      return 'Mình cần thêm thông tin đã được xác minh để hỗ trợ đúng. Bạn cho mình biết chi tiết cần kiểm tra tiếp nhé.';
  }
}

async function composeAndAppendAssistantTurn(input: {
  turnInput: AgentTurnInput;
  state: AgentGraphState;
  fallbackText: string;
  replyIntent: ReplyIntent;
  currentTurnToolTrace: ToolTraceEntry[];
  contextPolicy?: ContextPolicyDirective;
  turnTrace?: AgentTraceSpan;
  preferFallbackText?: boolean;
}): Promise<AgentTurnOutput> {
  const createdPaymentThisTurn = hasSuccessfulToolResult(input.currentTurnToolTrace, ['createPaymentLink']);
  const placedOrderThisTurn = hasSuccessfulToolResult(input.currentTurnToolTrace, ['placeOrder']);
  let responseText = createdPaymentThisTurn
    ? `Đơn ${input.state.order?.id ?? 'hàng'} đã được tạo. Bạn có thể tiếp tục thanh toán${
        input.state.paymentAttempt?.paymentUrl ? ` tại ${input.state.paymentAttempt.paymentUrl}` : ' bằng phương thức đã chọn'
      }.`
    : placedOrderThisTurn
      ? 'Đơn hàng đã được tạo thành công.'
      : input.fallbackText;
  const contextPolicy = input.contextPolicy ?? contextPolicyFromMetadata(input.turnInput.metadata);

  const genUi = selectKfcGenUiAttachment({
    state: buildContextPolicyState(input.state, {
      metadata: input.turnInput.metadata,
      policy: contextPolicy,
      preserveCartOrderPaymentContext: shouldPreserveCurrentCartOrderPaymentContext(input.currentTurnToolTrace),
      preserveMenuSearchResults: shouldPreserveCurrentMenuSearchResults(input.currentTurnToolTrace),
      preservePaymentContext: shouldPreserveCurrentPaymentContext(input.currentTurnToolTrace),
      preserveHandoff: shouldPreserveCurrentHandoff(input.currentTurnToolTrace),
    }),
    turnToolNames: input.currentTurnToolTrace.filter((entry) => entry.ok).map((entry) => entry.toolName),
    reuseVerifiedMenuResults: contextPolicyIsActive(contextPolicy, 'menuSearchResults'),
  });

  const composerInput = {
    channel: input.turnInput.channel,
    presentationMode: getChannelCapabilities(input.turnInput.channel).presentationMode,
    state: buildContextPolicyState(
      {
        ...input.state,
        toolTrace: input.currentTurnToolTrace,
      },
      {
        metadata: input.turnInput.metadata,
        policy: contextPolicy,
        preserveCartOrderPaymentContext: shouldPreserveCurrentCartOrderPaymentContext(input.currentTurnToolTrace),
        preserveMenuSearchResults: shouldPreserveCurrentMenuSearchResults(input.currentTurnToolTrace),
        preservePaymentContext: shouldPreserveCurrentPaymentContext(input.currentTurnToolTrace),
        preserveHandoff: shouldPreserveCurrentHandoff(input.currentTurnToolTrace),
        preserveRecentTurns: true,
        preserveToolTrace: true,
      },
    ),
    replyIntent: input.replyIntent,
    fallbackText: input.fallbackText,
  };
  const shouldCompose = Boolean(input.turnInput.responseComposer) && !input.preferFallbackText;
  const responseSpan = input.turnTrace && shouldCompose
    ? await input.turnTrace.startSpan({
        name: 'response_compose',
        runType: 'llm',
        inputs: { composerInput },
        metadata: { component: 'ResponseComposer' },
        tags: ['agent-response'],
      })
    : undefined;

  if (input.turnInput.responseComposer && shouldCompose) {
    try {
      responseText = await input.turnInput.responseComposer.composeResponse(composerInput);
    } catch (error) {
      await input.turnInput.store.appendEvent(input.turnInput.sessionId, 'llm:response_composer_failed', {
        message: error instanceof Error ? error.message : 'Unknown response composer failure',
        replyIntent: input.replyIntent,
      });
    }
  }

  if (
    input.state.cart &&
    !input.state.fulfillment &&
    !input.state.order &&
    isExplicitCartContinuationRequest(input.state.latestUserMessage) &&
    !/\bdia chi\b/.test(normalizedIntentText(responseText))
  ) {
    responseText = /\bdia chi\b/.test(normalizedIntentText(input.fallbackText))
      ? input.fallbackText
      : 'Mình tiếp tục hỗ trợ giỏ hiện tại. Bạn gửi giúp mình địa chỉ giao hàng đầy đủ để mình kiểm tra phí ship và thời gian giao nhé.';
  }

  const presentation = buildChannelPresentation({
    channel: input.turnInput.channel,
    graphResponseText: responseText,
    genUi,
  });
  responseText = presentation.text;

  const turn = await input.turnInput.store.appendTurn({
    sessionId: input.turnInput.sessionId,
    channel: input.turnInput.channel,
    role: 'assistant',
    text: responseText,
    externalMessageId: null,
    externalUserId: input.turnInput.customerId,
    deliveryStatus: 'pending',
    metadata: genUi ? { genUi } : null,
  });
  emitDashboardEvent(input.turnInput, 'conversation_turn_created', {
    turnId: turn.id,
    role: turn.role,
    channel: turn.channel,
    deliveryStatus: turn.deliveryStatus,
    externalMessageId: turn.externalMessageId,
    externalUserId: turn.externalUserId,
    text: turn.text,
    metadata: turn.metadata,
  });

  const output: AgentTurnOutput = {
    state: input.state,
    responseText,
    presentation,
    replyIntent: input.replyIntent,
    genUi,
    assistantTurnId: turn.id,
  };
  await responseSpan?.end({
    replyIntent: input.replyIntent,
    genUiKind: genUi?.widgetKind ?? null,
    state: traceStateSummary(input.state),
    responseText,
  });
  return output;
}

const singleStepPlannerIterations = 1;
const multiStepPlannerIterations = 4;
const readOnlyDiscoveryTools = new Set<ToolName>([
  'searchMenu',
  'searchPromotions',
  'getItemDetails',
  'listPaymentMethods',
]);

function shouldStopAfterVerifiedDiscovery(input: {
  state: AgentGraphState;
  iterationEntries: ToolTraceEntry[];
}): boolean {
  if (input.iterationEntries.length === 0) return false;
  if (!input.iterationEntries.every((entry) => entry.ok && readOnlyDiscoveryTools.has(entry.toolName))) return false;
  if (hasPlannerBooleanEntity(input.state, 'cartMutationRequested')) return false;
  if (hasPlannerBooleanEntity(input.state, 'orderConfirmed')) return false;
  if (hasPlannerBooleanEntity(input.state, 'reorderConfirmed')) return false;
  if (hasPlannerBooleanEntity(input.state, 'fulfillmentAccepted')) return false;
  return true;
}

export async function runAgentTurn(input: AgentTurnInput): Promise<AgentTurnOutput> {
  const scenarioId = traceScenarioId(input);
  const probeRunId = traceProbeRunId(input);
  const tracer = createSafeAgentTracer(input.tracer ?? createNoopAgentTracer(), (code, error) => {
    void input.store.appendEvent(input.sessionId, code, {
      message: error instanceof Error ? error.message : String(error),
    }).catch(() => undefined);
  });
  const turnTrace = await tracer.startTurn({
    name: 'agent_turn',
    inputs: {
      sessionId: input.sessionId,
      customerId: input.customerId,
      channel: input.channel,
      latestUserMessage: input.text,
      metadata: input.metadata ?? null,
    },
    metadata: {
      scenarioId: scenarioId ?? 'live-agent',
      probeRunId: probeRunId ?? null,
      clientMessageId: input.externalMessageId ?? null,
    },
    tags: ['kfc-agent-turn', ...(scenarioId ? [`scenario:${scenarioId}`] : [])],
  });
  activeTurnTraces.set(input, turnTrace);

  try {
    const output = await runAgentTurnCore(input, turnTrace);
    await turnTrace.end({
      replyIntent: output.replyIntent,
      suppressed: output.suppressed ?? false,
      genUiKind: output.genUi?.widgetKind ?? null,
      state: traceStateSummary(output.state),
      responseText: output.responseText,
    });
    return output;
  } catch (error) {
    await turnTrace.fail(error);
    throw error;
  } finally {
    activeTurnTraces.delete(input);
  }
}

async function runAgentTurnCore(input: AgentTurnInput, turnTrace: AgentTraceSpan): Promise<AgentTurnOutput> {
  const contextSpan = await turnTrace.startSpan({
    name: 'context_load',
    runType: 'chain',
    inputs: { sessionRef: traceSessionReference(input.sessionId) },
  });
  let activeContextPolicy = contextPolicyFromMetadata(input.metadata);
  let priorVerifiedState = await loadPriorVerifiedState(input.store, input.sessionId);
  priorVerifiedState = await hydrateRecentOrderContext(input, priorVerifiedState, activeContextPolicy);
  const retrievedEvidence: AgentGraphState['retrievedEvidence'] = [];

  const existingUserTurn = input.externalMessageId
    ? await input.store.findTurnByExternalMessage(input.sessionId, input.externalMessageId)
    : undefined;
  const userTurn =
    existingUserTurn ??
    (await input.store.appendTurn({
      sessionId: input.sessionId,
      channel: input.channel,
      role: 'user',
      text: input.text,
      externalMessageId: input.externalMessageId ?? null,
      externalUserId: input.customerId,
      deliveryStatus: 'received',
      metadata: input.metadata ?? null,
    }));
  if (!existingUserTurn) {
    emitDashboardEvent(input, 'customer_message_received', {
      turnId: userTurn.id,
      channel: userTurn.channel,
      externalMessageId: userTurn.externalMessageId,
      externalUserId: userTurn.externalUserId,
      text: userTurn.text,
      metadata: userTurn.metadata,
    });
    emitDashboardEvent(input, 'conversation_turn_created', {
      turnId: userTurn.id,
      role: userTurn.role,
      channel: userTurn.channel,
      deliveryStatus: userTurn.deliveryStatus,
      externalMessageId: userTurn.externalMessageId,
      externalUserId: userTurn.externalUserId,
      text: userTurn.text,
      metadata: userTurn.metadata,
    });
  }
  const allTurns = await input.store.listTurns(input.sessionId);
  const customerTurnCount = countCustomerTurns(allTurns);
  const recentTurns = buildBoundedRecentTurns(allTurns);

  const state: AgentGraphState = {
    sessionId: input.sessionId,
    customerId: input.customerId,
    channel: input.channel,
    latestUserMessage: input.text,
    recentTurns,
    intent: 'unclear',
    cart: priorVerifiedState.cart,
    address: priorVerifiedState.address,
    orderPreview: priorVerifiedState.orderPreview,
    order: priorVerifiedState.order,
    userConfirmedOrder: isGenUiAction(input.metadata, 'confirm_order'),
    escalationReasons: [],
    retrievedEvidence,
    fulfillment: priorVerifiedState.fulfillment,
    promotionContext: priorVerifiedState.promotionContext,
    contentEvidence: priorVerifiedState.contentEvidence,
    menuSearchResults: priorVerifiedState.menuSearchResults,
    menuModifierOptions: priorVerifiedState.menuModifierOptions,
    customerContext: priorVerifiedState.customerContext,
    paymentAttempt: priorVerifiedState.paymentAttempt,
    paymentMethodEvidence: priorVerifiedState.paymentMethodEvidence,
    invoiceRequest: priorVerifiedState.invoiceRequest,
    handoff: priorVerifiedState.handoff,
    toolTrace: priorVerifiedState.toolTrace ?? [],
  };
  await contextSpan.end({
    recentTurnCount: recentTurns.length,
    customerTurnCount,
    state: traceStateSummary(state),
  });

  if (!(await isRunStillCurrent(input))) {
    return {
      state,
      responseText: '',
      presentation: textOnlyPresentation(''),
      replyIntent: 'general_reply',
      suppressed: true,
    };
  }

  if (input.toolPlanner) {
    const currentTurnToolTrace: ToolTraceEntry[] = [];
    const multiStepEnabled = input.toolPlanner.supportsMultiStep === true;
    const maxPlannerIterations = multiStepEnabled ? multiStepPlannerIterations : singleStepPlannerIterations;
    const responseClaims = new Set<NonNullable<ToolPlannerOutput['responseClaims']>[number]>();
    let plannerFallbackText: string | undefined;
    let plannedAtLeastOnce = false;
    let plannerRequestedClarification = false;

    const directGenUiCartCall = genUiCartActionToToolCall(input.metadata);
    const acceptsFulfillmentAction = isGenUiAction(input.metadata, 'accept_fulfillment');
    const confirmsFulfillmentByText = isAffirmativeFulfillmentFollowup(input.text, recentTurns);
    const confirmsOrderByText = isExplicitOrderConfirmationRequest(input.text);
    const advancesFulfillmentOnly = acceptsFulfillmentAction || confirmsFulfillmentByText;
    if (directGenUiCartCall) {
      state.intent = 'cart_edit';
      const gatingForCall = applySafetyGates(state, [directGenUiCartCall], {
        requireVerifiedItemCodes: true,
      });
      await tracePolicyDecision(turnTrace, {
        proposedToolNames: [directGenUiCartCall.toolName],
        allowedToolNames: gatingForCall.allowedCalls.map((call) => call.toolName),
        blockedReasons: gatingForCall.blockedReasons,
      });
      pushEscalationReasons(state, gatingForCall.blockedReasons);
      if (gatingForCall.allowedCalls.length > 0 && (await ensureCartForTool(input, state, directGenUiCartCall))) {
        await executeAndApplyTracedToolCall({
          turnInput: input,
          turnTrace,
          state,
          call: directGenUiCartCall,
          currentTurnToolTrace,
        });
      }
      emitDerivedEvents(input, state, currentTurnToolTrace);
      await persistVerifiedStateSnapshot(input.store, state);
      await emitSessionIntelligence(input, state, customerTurnCount);

      return composeAndAppendAssistantTurn({
        turnInput: input,
        state,
        replyIntent: state.escalationReasons.length > 0 ? 'ask_clarification' : 'general_reply',
        fallbackText: selectSafeFallbackText(state, 'Mình đã cập nhật giỏ hàng.'),
        currentTurnToolTrace,
        turnTrace,
      });
    }

    for (let iteration = 0; iteration < maxPlannerIterations; iteration += 1) {
      const toolTraceLengthBeforePlan = currentTurnToolTrace.length;
      const contextPolicyBeforePlan = activeContextPolicy;
      const plannerInput = {
        state: buildContextPolicyState(
          { ...state, toolTrace: currentTurnToolTrace },
          {
            metadata: input.metadata,
            policy: activeContextPolicy,
            preserveCartOrderPaymentContext: shouldPreserveCurrentCartOrderPaymentContext(currentTurnToolTrace),
            preserveMenuSearchResults: shouldPreserveCurrentMenuSearchResults(currentTurnToolTrace),
            preservePaymentContext: shouldPreserveCurrentPaymentContext(currentTurnToolTrace),
            preserveHandoff: shouldPreserveCurrentHandoff(currentTurnToolTrace),
            preserveToolTrace: true,
          },
        ),
        availableTools: toolNames,
        recentTurns,
      };
      const plannerSpan = await turnTrace.startSpan({
        name: 'planner_iteration',
        runType: 'llm',
        inputs: {
          iteration: iteration + 1,
          plannerInput,
        },
        metadata: { component: 'ToolPlanner' },
        tags: ['agent-planner'],
      });
      let rawPlan: ToolPlannerOutput | undefined;
      try {
        rawPlan = await input.toolPlanner.plan(plannerInput);
        await plannerSpan.end({
          plannerOutput: rawPlan,
          intent: rawPlan.intent,
          contextPolicy: rawPlan.contextPolicy ?? {},
          entities: rawPlan.entities,
          proposedToolNames: rawPlan.toolCalls.map((call) => call.toolName),
          responseClaims: rawPlan.responseClaims,
          asksClarification: rawPlan.entities.asksClarification === true,
        });
      } catch (error) {
        await plannerSpan.fail(error);
        await input.store.appendEvent(input.sessionId, 'llm:tool_planner_failed', {
          message: error instanceof Error ? error.message : 'Unknown tool planner failure',
        });
      }

      if (!rawPlan) {
        if (!plannedAtLeastOnce && currentTurnToolTrace.length === 0) {
          return composeAndAppendAssistantTurn({
            turnInput: input,
            state,
            replyIntent: 'ask_clarification',
            fallbackText: 'Mình cần thêm thông tin để hỗ trợ đúng.',
            currentTurnToolTrace: [],
            turnTrace,
          });
        }
        break;
      }

      plannedAtLeastOnce = true;
      state.intent = rawPlan.intent;
      state.entities = rawPlan.entities;
      if (
        hasPlannerBooleanEntity(state, 'smallTalk') &&
        rawPlan.directResponse &&
        rawPlan.toolCalls.every((call) => readOnlyDiscoveryTools.has(call.toolName))
      ) {
        rawPlan = {
          ...rawPlan,
          contextPolicy: {
            ...rawPlan.contextPolicy,
            menuSearchResults: 'irrelevant',
          },
          entities: {
            ...rawPlan.entities,
            suppressGenUi: true,
          },
          toolCalls: [],
        };
        state.entities = rawPlan.entities;
      }
      if (isExplicitCartAddRequest(state.latestUserMessage)) {
        state.entities = {
          ...state.entities,
          cartMutationRequested: true,
        };
      }
      if (confirmsOrderByText) {
        state.entities = {
          ...state.entities,
          orderConfirmed: true,
        };
        state.userConfirmedOrder = true;
      }
      const confirmsFulfillment = confirmsFulfillmentByText;
      if (confirmsFulfillment) {
        state.entities = {
          ...state.entities,
          fulfillmentAccepted: true,
          useSavedAddress: true,
          orderConfirmed: false,
        };
        state.userConfirmedOrder = false;
      }
      if (isDifferentRecipientReorder(state.latestUserMessage)) {
        state.entities = {
          ...state.entities,
          reorderConfirmed: false,
          asksClarification: true,
          suppressGenUi: true,
        };
      }
      if (isMultiItemOrderRequest(state.latestUserMessage)) {
        state.entities = { ...state.entities, preferCartSurface: true };
      }
      if (isMenuDiscoveryRequest(state.latestUserMessage)) {
        state.entities = { ...state.entities, keepMenuSurface: true };
      }
      if (isRejectedMenuUpsell(state.latestUserMessage)) {
        state.entities = { ...state.entities, keepMenuSurface: false };
      }
      if (isAmbiguousMenuAddRequest(state.latestUserMessage)) {
        state.entities = { ...state.entities, keepMenuSurface: false };
      }
      if (isAmbiguousCartFollowup(state.latestUserMessage)) {
        state.entities = {
          ...state.entities,
          asksClarification: true,
          cartMutationConfirmed: false,
          keepMenuSurface: false,
        };
        plannerRequestedClarification = true;
      }
      if (isExplicitNamedCartRemoval(state.latestUserMessage, state.cart)) {
        state.entities = {
          ...state.entities,
          asksClarification: false,
          cartMutationConfirmed: true,
        };
      }
      if (
        isLowSignalMessage(state.latestUserMessage) &&
        !isPostOrderTrackingRequest(state.latestUserMessage) &&
        !confirmsFulfillment
      ) {
        state.entities = { ...state.entities, suppressGenUi: true };
      }
      activeContextPolicy = mergeContextPolicies(activeContextPolicy, rawPlan.contextPolicy);
      if (isCheckoutSupplementRequest(state.latestUserMessage)) {
        activeContextPolicy = mergeContextPolicies(activeContextPolicy, {
          cart: 'active',
          fulfillment: 'active',
        });
      }
      if (isDeliveryFulfillmentRequest(state.latestUserMessage)) {
        state.entities = {
          ...state.entities,
          fulfillmentMethod: 'delivery',
          preferFulfillmentSurface: true,
        };
        activeContextPolicy = mergeContextPolicies(activeContextPolicy, {
          cart: 'active',
          fulfillment: 'active',
          customer: 'active',
        });
      }
      if (isMenuDiscoveryRequest(state.latestUserMessage)) {
        activeContextPolicy = mergeContextPolicies(activeContextPolicy, {
          menuSearchResults: 'active',
        });
      }
      if (isExplicitMenuUpgrade(state.latestUserMessage) || isRejectedMenuUpsell(state.latestUserMessage)) {
        activeContextPolicy = mergeContextPolicies(activeContextPolicy, {
          cart: 'active',
          menuSearchResults: 'active',
        });
      }
      if (isAmbiguousMenuAddRequest(state.latestUserMessage)) {
        activeContextPolicy = mergeContextPolicies(activeContextPolicy, {
          cart: 'active',
          menuSearchResults: 'active',
        });
      }
      if (isAmbiguousCartFollowup(state.latestUserMessage)) {
        activeContextPolicy = mergeContextPolicies(activeContextPolicy, {
          cart: 'confirm_before_use',
          recentTurns: 'active',
        });
      }
      if (isAddressChangeRequest(state.latestUserMessage)) {
        state.address = undefined;
        state.fulfillment = undefined;
        activeContextPolicy = mergeContextPolicies(activeContextPolicy, {
          cart: 'active',
          fulfillment: 'active',
        });
      }
      if (confirmsFulfillment) {
        activeContextPolicy = mergeContextPolicies(activeContextPolicy, {
          cart: 'active',
          fulfillment: 'active',
          customer: 'active',
        });
      }
      if (isDifferentRecipientReorderConfirmation(state.latestUserMessage, recentTurns)) {
        state.entities = {
          ...state.entities,
          reorderConfirmed: true,
          asksClarification: false,
        };
        activeContextPolicy = mergeContextPolicies(activeContextPolicy, {
          recentOrder: 'active',
          cart: 'active',
        });
      }
      if (isDifferentRecipientReorder(state.latestUserMessage)) {
        activeContextPolicy = {
          ...activeContextPolicy,
          recentOrder: 'confirm_before_use',
          cart: 'confirm_before_use',
          order: 'irrelevant',
          payment: 'irrelevant',
          handoff: 'irrelevant',
        };
        state.cart = undefined;
        state.order = undefined;
        state.orderPreview = undefined;
        state.paymentAttempt = undefined;
        state.handoff = undefined;
      }
      if (isFavoriteItemRequest(state.latestUserMessage)) {
        activeContextPolicy = mergeContextPolicies(activeContextPolicy, {
          recentOrder: 'active',
          menuSearchResults: 'active',
        });
      }
      if (rawPlan.intent === 'payment' || rawPlan.intent === 'order_status') {
        activeContextPolicy = mergeContextPolicies(activeContextPolicy, {
          order: 'active',
          payment: 'active',
        });
      }
      if (
        isPostOrderTrackingRequest(state.latestUserMessage) ||
        isOrderCancellationRequest(state.latestUserMessage) ||
        isPaymentFailureRequest(state.latestUserMessage)
      ) {
        activeContextPolicy = mergeContextPolicies(activeContextPolicy, {
          order: 'active',
          payment: 'active',
          ...(isOrderCancellationRequest(state.latestUserMessage) ? { handoff: 'active' as const } : {}),
        });
      }
      if (isHandoffExplanationRequest(state.latestUserMessage)) {
        activeContextPolicy = mergeContextPolicies(activeContextPolicy, {
          handoff: 'active',
        });
      }
      if (isGenUiAction(input.metadata, 'accept_fulfillment')) {
        state.entities = {
          ...state.entities,
          fulfillmentAccepted: true,
          useSavedAddress: true,
          orderConfirmed: false,
        };
        state.userConfirmedOrder = false;
        activeContextPolicy = mergeContextPolicies(activeContextPolicy, {
          cart: 'active',
          fulfillment: 'active',
        });
      }
      if (isGenUiAction(input.metadata, 'continue_to_fulfillment')) {
        state.entities = {
          ...state.entities,
          fulfillmentAccepted: true,
          useSavedAddress: true,
        };
        activeContextPolicy = mergeContextPolicies(activeContextPolicy, {
          cart: 'active',
          fulfillment: 'active',
        });
      }
      if (
        rawPlan.toolCalls.length === 0 &&
        rawPlan.contextPolicy?.menuSearchResults !== 'irrelevant' &&
        (state.menuSearchResults?.length ?? 0) > 0 &&
        !state.cart &&
        !state.order &&
        !state.handoff
      ) {
        activeContextPolicy = mergeContextPolicies(activeContextPolicy, { menuSearchResults: 'active' });
        state.entities = { ...state.entities, keepMenuSurface: true };
      }
      const hydratedState = await hydrateRecentOrderContext(input, buildVerifiedStateSnapshot(state), activeContextPolicy);
      Object.assign(state, hydratedState);
      if (
        !state.address &&
        hasPlannerBooleanEntity(state, 'useSavedAddress') &&
        contextPolicyIsActive(activeContextPolicy, 'fulfillment')
      ) {
        state.address = state.customerContext?.savedAddresses[0];
      }
      if (hasPlannerBooleanEntity(state, 'asksClarification')) {
        plannerRequestedClarification = true;
      }
      if (hasPlannerBooleanEntity(state, 'orderConfirmed')) {
        state.userConfirmedOrder = true;
      }
      const checksPaymentMethodSupport = rawPlan.toolCalls.some((call) => call.toolName === 'listPaymentMethods');
      rememberPlannerPaymentMethod(state, checksPaymentMethodSupport);
      for (const claim of rawPlan.responseClaims) responseClaims.add(claim);
      plannerFallbackText = rawPlan.directResponse ?? plannerFallbackText;

      if (
        multiStepEnabled &&
        shouldReplanAfterSensitiveContextActivation({
          before: contextPolicyBeforePlan,
          after: activeContextPolicy,
          toolCalls: rawPlan.toolCalls,
        })
      ) {
        continue;
      }

      if (
        rawPlan.toolCalls.length === 0 &&
        shouldRepairTextOnlyMenuRecommendation(state, currentTurnToolTrace, activeContextPolicy)
      ) {
        const searchCall: ToolCallRequest = {
          toolName: 'searchMenu',
          arguments: { query: input.text },
        };
        let result = await executeTracedToolCall({ turnInput: input, turnTrace, state, call: searchCall });
        if (result.ok && Array.isArray(result.value) && result.value.length === 0) {
          searchCall.arguments = { query: '' };
          result = await executeTracedToolCall({ turnInput: input, turnTrace, state, call: searchCall });
        }
        await applyTracedToolResult({
          turnInput: input,
          turnTrace,
          state,
          call: searchCall,
          result,
          currentTurnToolTrace,
        });
      }

      if (rawPlan.toolCalls.length === 0) break;

      await ensureMembershipProfileForActivePolicy({
        turnInput: input,
        state,
        currentTurnToolTrace,
        contextPolicy: activeContextPolicy,
        force: hasMembershipProfileDependentTool(rawPlan.toolCalls),
      });

      for (const call of rawPlan.toolCalls) {
        if (
          advancesFulfillmentOnly &&
          ['previewOrder', 'placeOrder', 'createPaymentLink', 'checkPaymentStatus', 'getOrderStatus'].includes(call.toolName)
        ) {
          continue;
        }
        if (call.toolName === 'searchMenu' && isLowSignalMessage(state.latestUserMessage)) {
          continue;
        }
        if (!isStructurallySupportedHandoff(state, call)) {
          continue;
        }
        if (call.toolName === 'recommendAddOns' && !state.cart) {
          continue;
        }
        if (
          contextPolicyRequiresConfirmation(activeContextPolicy, 'recentOrder') &&
          ['updateCart', 'previewCart', 'previewOrder', 'placeOrder'].includes(call.toolName)
        ) {
          state.entities = {
            ...(isRecord(state.entities) ? state.entities : {}),
            asksClarification: true,
          };
          plannerRequestedClarification = true;
          pushEscalationReasons(state, ['previous_order_confirmation_required']);
          continue;
        }
        if (
          contextPolicyIsActive(activeContextPolicy, 'recentOrder') &&
          ['previewCart', 'previewOrder', 'placeOrder'].includes(call.toolName)
        ) {
          continue;
        }
        if (contextPolicyIsActive(activeContextPolicy, 'recentOrder') && call.toolName === 'updateCart') {
          if (!hasPlannerBooleanEntity(state, 'reorderConfirmed')) {
            state.entities = {
              ...(isRecord(state.entities) ? state.entities : {}),
              asksClarification: true,
            };
            plannerRequestedClarification = true;
            pushEscalationReasons(state, ['previous_order_confirmation_required']);
            continue;
          }
          state.entities = {
            ...(isRecord(state.entities) ? state.entities : {}),
            reorderConfirmed: true,
          };
        }
        if (requiresExplicitDestructiveCartConfirmation(state, call)) {
          state.entities = {
            ...(isRecord(state.entities) ? state.entities : {}),
            asksClarification: true,
          };
          plannerRequestedClarification = true;
          pushEscalationReasons(state, ['cart_mutation_confirmation_required']);
          await tracePolicyDecision(turnTrace, {
            proposedToolNames: [call.toolName],
            allowedToolNames: [],
            blockedReasons: ['cart_mutation_confirmation_required'],
            confirmationRequired: true,
          });
          continue;
        }
        if (hasSuccessfulCurrentTurnToolCall(currentTurnToolTrace, call)) {
          continue;
        }
        const gatingForCall = applySafetyGates(state, [call], {
          requireVerifiedItemCodes: multiStepEnabled,
          requireCartMutationConfirmation: contextPolicyRequiresConfirmation(activeContextPolicy, 'cart'),
        });
        await tracePolicyDecision(turnTrace, {
          proposedToolNames: [call.toolName],
          allowedToolNames: gatingForCall.allowedCalls.map((allowedCall) => allowedCall.toolName),
          blockedReasons: gatingForCall.blockedReasons,
          confirmationRequired: contextPolicyRequiresConfirmation(activeContextPolicy, 'cart'),
        });
        pushEscalationReasons(state, gatingForCall.blockedReasons);
        if (gatingForCall.allowedCalls.length === 0) {
          continue;
        }

        const ready = await ensureCartForTool(input, state, call);
        if (!ready) continue;

        if (call.toolName === 'placeOrder' && !state.orderPreview) {
          const previewCall: ToolCallRequest = {
            toolName: 'previewOrder',
            arguments: {},
          };
          const previewGating = applySafetyGates(state, [previewCall]);
          await tracePolicyDecision(turnTrace, {
            proposedToolNames: [previewCall.toolName],
            allowedToolNames: previewGating.allowedCalls.map((allowedCall) => allowedCall.toolName),
            blockedReasons: previewGating.blockedReasons,
          });
          pushEscalationReasons(state, previewGating.blockedReasons);
          if (previewGating.allowedCalls.length === 0) continue;

          const previewResult = await executeAndApplyTracedToolCall({
            turnInput: input,
            turnTrace,
            state,
            call: previewCall,
            currentTurnToolTrace,
          });
          if (!previewResult.ok) continue;
        }

        const result = await executeAndApplyTracedToolCall({
          turnInput: input,
          turnTrace,
          state,
          call,
          currentTurnToolTrace,
        });
      }

      const iterationEntries = currentTurnToolTrace.slice(toolTraceLengthBeforePlan);
      if (iterationEntries.length === 0) break;
      if (shouldStopAfterVerifiedDiscovery({ state, iterationEntries })) break;
      if (!multiStepEnabled) break;
    }

    await ensureExplicitNamedCartRemoval({
      turnInput: input,
      turnTrace,
      state,
      currentTurnToolTrace,
    });

    if (advancesFulfillmentOnly) {
      state.order = undefined;
      state.orderPreview = undefined;
      state.paymentAttempt = undefined;
      state.userConfirmedOrder = false;
      state.entities = {
        ...(isRecord(state.entities) ? state.entities : {}),
        orderConfirmed: false,
      };
    }

    await ensureMenuDiscoverySurface({
      turnInput: input,
      state,
      currentTurnToolTrace,
    });

    await ensureAmbiguousReferencedMenuAdd({
      turnInput: input,
      state,
      currentTurnToolTrace,
    });

    await ensureExplicitMenuUpgrade({
      turnInput: input,
      state,
      currentTurnToolTrace,
    });

    await ensureExplicitNamedMenuSelection({
      turnInput: input,
      state,
      currentTurnToolTrace,
    });

    await ensureExplicitCartReplacement({ turnInput: input, state, currentTurnToolTrace });

    await ensureAffirmedMenuSelection({
      turnInput: input,
      state,
      recentTurns,
      currentTurnToolTrace,
    });

    if (isCheckoutSupplementRequest(state.latestUserMessage)) {
      state.address ??= priorVerifiedState.address;
      state.fulfillment ??= priorVerifiedState.fulfillment;
    }

    if (contextPolicyIsActive(activeContextPolicy, 'fulfillment')) {
      await discoverStoresForActiveFulfillment({
        turnInput: input,
        state,
        currentTurnToolTrace,
      });
      await quoteFulfillmentFromVerifiedAddress({
        turnInput: input,
        state,
        currentTurnToolTrace,
      });
    }

    await addConfirmedPreviousOrderToCart({
      turnInput: input,
      state,
      currentTurnToolTrace,
      contextPolicy: activeContextPolicy,
    });

    await ensurePostOrderConversationJob({
      turnInput: input,
      state,
      currentTurnToolTrace,
    });

    await ensureAbnormalLargeOrderHandoff({
      turnInput: input,
      state,
      currentTurnToolTrace,
    });

    await ensureMembershipProfileForActivePolicy({
      turnInput: input,
      state,
      currentTurnToolTrace,
      contextPolicy: activeContextPolicy,
    });

    await ensureFavoriteItemMenuSurface({
      turnInput: input,
      state,
      currentTurnToolTrace,
    });

    if (
      contextPolicyIsActive(activeContextPolicy, 'membership') &&
      contextPolicyIsActive(activeContextPolicy, 'cart') &&
      hasSuccessfulToolResult(currentTurnToolTrace, [
        'getMembershipProfile',
        'listMembershipRewards',
        'listMembershipWallet',
        'getMembershipPointHistory',
      ]) &&
      !hasSuccessfulToolResult(currentTurnToolTrace, ['acquireVoucher', 'redeemReward'])
    ) {
      plannerRequestedClarification = true;
    }

    if (!hasSuccessfulToolResult(currentTurnToolTrace, ['placeOrder'])) {
      await placeConfirmedOrderFromVerifiedState({
        turnInput: input,
        state,
        currentTurnToolTrace,
      });
    }

    await createPaymentLinkAfterOrderFromRememberedMethod({
      turnInput: input,
      state,
      currentTurnToolTrace,
    });

    clearRecoverableFulfillmentArgumentFailure(state, currentTurnToolTrace);
    if (
      state.intent === 'ordering' &&
      isRecord(state.entities) &&
      typeof state.entities.itemText === 'string' &&
      currentTurnToolTrace.some((entry) => entry.toolName === 'searchMenu') &&
      !hasSuccessfulToolResult(currentTurnToolTrace, ['updateCart']) &&
      (hasPlannerBooleanEntity(state, 'cartMutationRequested') || (state.menuSearchResults?.length ?? 0) === 0) &&
      !state.cart
    ) {
      pushEscalationReasons(state, ['menu_item_verification_required']);
    }
    const gatingAfterExecution = applySafetyGates({ ...state, toolTrace: currentTurnToolTrace }, [], {
      responseClaims: [...responseClaims],
    });
    if (responseClaims.size > 0 || gatingAfterExecution.blockedReasons.length > 0) {
      await tracePolicyDecision(turnTrace, {
        proposedToolNames: [],
        allowedToolNames: [],
        blockedReasons: gatingAfterExecution.blockedReasons,
      });
    }
    pushEscalationReasons(state, gatingAfterExecution.blockedReasons);
    emitDerivedEvents(input, state, currentTurnToolTrace);
    await persistVerifiedStateSnapshot(input.store, state);
    const intelligenceSpan = await turnTrace.startSpan({
      name: 'session_intelligence',
      runType: 'chain',
      inputs: {
        customerTurnCount,
        state: traceStateSummary(state),
      },
      metadata: { component: 'resolveMonitorSessionIntelligence' },
      tags: ['agent-session-intelligence'],
    });
    await emitSessionIntelligence(input, state, customerTurnCount);
    await intelligenceSpan.end({
      customerTurnCount,
      escalationReasons: [...state.escalationReasons],
    });

    if (!(await isRunStillCurrent(input))) {
      return {
        state,
        responseText: '',
        presentation: textOnlyPresentation(''),
        replyIntent: 'general_reply',
        suppressed: true,
      };
    }

    const preferPlannerResponse =
      Boolean(plannerFallbackText) &&
      state.escalationReasons.length === 0 &&
      !plannerRequestedClarification &&
      currentTurnToolTrace.every(
        (entry) => entry.ok && readOnlyDiscoveryTools.has(entry.toolName),
      );
    return composeAndAppendAssistantTurn({
      turnInput: input,
      state,
      replyIntent: state.escalationReasons.length > 0 || plannerRequestedClarification ? 'ask_clarification' : 'general_reply',
      fallbackText: preferPlannerResponse
        ? plannerFallbackText!
        : selectSafeFallbackText(
            buildContextPolicyState(
              { ...state, toolTrace: currentTurnToolTrace },
              {
                metadata: input.metadata,
                policy: activeContextPolicy,
                preserveCartOrderPaymentContext: shouldPreserveCurrentCartOrderPaymentContext(currentTurnToolTrace),
                preserveMenuSearchResults: shouldPreserveCurrentMenuSearchResults(currentTurnToolTrace),
                preservePaymentContext: shouldPreserveCurrentPaymentContext(currentTurnToolTrace),
                preserveHandoff: shouldPreserveCurrentHandoff(currentTurnToolTrace),
                preserveToolTrace: true,
              },
            ),
            plannerFallbackText,
          ),
      currentTurnToolTrace,
      contextPolicy: activeContextPolicy,
      turnTrace,
      preferFallbackText: preferPlannerResponse,
    });
  }

  if (!(await isRunStillCurrent(input))) {
    return {
      state,
      responseText: '',
      presentation: textOnlyPresentation(''),
      replyIntent: 'general_reply',
      suppressed: true,
    };
  }

  await emitSessionIntelligence(input, state, customerTurnCount);

  return composeAndAppendAssistantTurn({
    turnInput: input,
    state,
    replyIntent: 'ask_clarification',
    fallbackText: 'Mình cần thêm thông tin để hỗ trợ đúng.',
    currentTurnToolTrace: [],
    turnTrace,
  });
}
