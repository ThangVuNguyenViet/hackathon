import type { ExternalClients } from '../clients/interfaces.js';
import {
  Annotation,
  END,
  START,
  StateGraph,
  type LangGraphRunnableConfig,
} from '@langchain/langgraph';
import '@langchain/langgraph/zod';
import { z } from 'zod';
import type { DashboardEventBus } from '../dashboard/eventBus.js';
import type { Address, Cart, DashboardEvent, Channel, ConversationTurn, ConversationTurnMetadata, MenuItem, SessionUpdateType } from '../domain/types.js';
import type { CustomerCommand } from '../domain/customerCommand.js';
import { selectKfcGenUiAttachment } from '../genui/kfcGenUiSelector.js';
import type { KfcGenUiAttachment } from '../genui/kfcGenUi.js';
import {
  validateGenUiCompanionResponse,
  validateStandaloneSocialResponse,
  type ResponseComposer,
} from '../llm/responseComposer.js';
import type { SmallTalkRouter, SmallTalkRouterOutput } from '../llm/smallTalkRouter.js';
import type { CommercePlannerState, ToolPlanner, ToolPlannerOutput } from '../llm/toolPlanner.js';
import { countCustomerTurns, resolveMonitorSessionIntelligence, type MonitorSessionIntelligenceJudge } from '../monitor/sessionIntelligence.js';
import { executeToolCall } from '../ordering/toolExecutor.js';
import { parseToolArguments, toolNames } from '../ordering/toolCatalog.js';
import { getToolBoundary } from '../ordering/toolBoundaries.js';
import { applySafetyGates } from '../ordering/safetyGates.js';
import type { FulfillmentPlanningContext, MenuComposition, MenuPlanningContext, PaymentLinkMethod, PromotionValidationResult, ToolCallRequest, ToolCallResult, ToolName, ToolTraceEntry } from '../ordering/types.js';
import {
  createNoopAgentTracer,
  createSafeAgentTracer,
  type AgentTraceSpan,
  type AgentTracer,
} from '../observability/agentTracing.js';
import type { ConversationStore } from '../persistence/memoryStore.js';
import {
  assertPresentationMatchesChannel,
  buildChannelPresentation,
  buildSocialPresentation,
  buildStandaloneSocialFallback,
  textOnlyPresentation,
  type ChannelPresentationPlan,
} from '../presentation/channelPresentation.js';
import { responseProfileForChannel } from '../presentation/responseProfile.js';
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
import {
  projectToolProgressFamily,
  type CustomerSafeProgressFamily,
} from '../customerRuns/progressProjection.js';

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
  smallTalkRouter?: SmallTalkRouter;
  runGuard?: {
    isCurrent(): Promise<boolean>;
    recordIrreversibleBoundary?(toolName: ToolCallRequest['toolName']): Promise<void>;
  };
  observeRun?: (observation:
    | { kind: 'planning' }
    | {
        kind: 'tool';
        protected: boolean;
        irreversible: boolean;
        progressFamily?: CustomerSafeProgressFamily;
      }
    | { kind: 'verified_state' }
    | { kind: 'response_composition' }
  ) => Promise<void>;
  monitorJudge?: MonitorSessionIntelligenceJudge;
  tracer?: AgentTracer;
  /** Internal override for deterministic deadline tests. Production defaults to eight seconds. */
  turnDeadlineMs?: number;
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

export const AgentTurnGraphInputSchema = z.object({
  sessionId: z.string(),
  customerId: z.string(),
  channel: z.enum(['messenger', 'zalo', 'kfc', 'messenger_mock', 'zalo_mock']),
  text: z.string(),
  externalMessageId: z.string().nullable().optional(),
  metadata: z.custom<ConversationTurnMetadata | null>().optional(),
});

export const AgentTurnGraphOutputSchema = z.object({
  output: z.custom<AgentTurnOutput>(),
});

type AgentTurnGraphRoute = 'social_response' | 'structured_action' | 'plan_tools' | 'suppressed';
type AgentJourneyMode = 'fresh_shopping' | 'active_checkout' | 'post_order_support' | 'social';
type PlanningProfile = 'active_checkout' | 'catalog_ordering' | 'full';
type PlannerResponseClaim = NonNullable<ToolPlannerOutput['responseClaims']>[number];

interface TurnResponseSpec {
  fallbackText: string;
  replyIntent: ReplyIntent;
  currentTurnToolTrace: ToolTraceEntry[];
  contextPolicy?: ContextPolicyDirective;
  preferFallbackText?: boolean;
  suppressGenUi?: boolean;
}

interface NaturalLanguagePlan {
  activeContextPolicy: ContextPolicyDirective;
  fulfillmentLocationContext?: FulfillmentPlanningContext;
  menuCatalogContext?: MenuPlanningContext;
  planningProfile: PlanningProfile;
  multiStepEnabled: boolean;
  toolCalls: ToolCallRequest[];
  responseClaims: PlannerResponseClaim[];
  plannerFallbackText?: string;
  plannerRequestedClarification: boolean;
  confirmsFulfillmentByText: boolean;
  confirmsOrderByText: boolean;
  recoveryMode?:
    | 'verified_order_confirmation'
    | 'verified_fulfillment_confirmation'
    | 'verified_exact_quantity_cart'
    | 'verified_menu_catalog'
    | 'deterministic';
}

interface LoadedAgentTurnContext {
  input: AgentTurnInput;
  turnTrace: AgentTraceSpan;
  activeContextPolicy: ContextPolicyDirective;
  priorVerifiedState: Partial<VerifiedStateSnapshot>;
  state: AgentGraphState;
  customerTurnCount: number;
  recentTurns: ConversationTurn[];
  routing: SmallTalkRouterOutput | undefined;
}

const AgentTurnGraphStateSchema = Annotation.Root({
  sessionId: Annotation<string>(),
  customerId: Annotation<string>(),
  channel: Annotation<Channel>(),
  text: Annotation<string>(),
  externalMessageId: Annotation<string | null | undefined>(),
  metadata: Annotation<ConversationTurnMetadata | null | undefined>(),
  route: Annotation<AgentTurnGraphRoute | undefined>(),
  journeyMode: Annotation<AgentJourneyMode | undefined>(),
  phase: Annotation<string | undefined>(),
  activeContextPolicy: Annotation<ContextPolicyDirective | undefined>(),
  priorVerifiedState: Annotation<Partial<VerifiedStateSnapshot> | undefined>(),
  agentState: Annotation<AgentGraphState | undefined>(),
  customerTurnCount: Annotation<number | undefined>(),
  recentTurns: Annotation<ConversationTurn[] | undefined>(),
  routing: Annotation<SmallTalkRouterOutput | undefined>(),
  naturalLanguagePlan: Annotation<NaturalLanguagePlan | undefined>(),
  responseSpec: Annotation<TurnResponseSpec | undefined>(),
  output: Annotation<AgentTurnOutput | undefined>(),
});

type AgentTurnGraphState = typeof AgentTurnGraphStateSchema.State;

export interface AgentTurnGraphRuntime {
  input: AgentTurnInput;
  turnTrace: AgentTraceSpan;
}

export type AgentTurnGraphRuntimeResolver = (
  state: AgentTurnGraphState,
  config: LangGraphRunnableConfig,
) => Promise<AgentTurnGraphRuntime> | AgentTurnGraphRuntime;

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
  const normalizedDistrict = normalizedIntentText(district);
  const normalizedCity = normalizedIntentText(city);
  if (/^\d/.test(normalizedDistrict) || /\b(?:phi ship|phi giao hang|bao nhieu)\b|[?!]/.test(normalizedCity)) {
    return undefined;
  }

  const line1 = lineParts
    .join(', ')
    .replace(/^\s*(?:giao|ship)\s+(?:tới|toi|đến|den|về|ve)\s+/iu, '')
    .replace(/^\s*(?:địa chỉ|dia chi)\s*(?:là|la|:)?\s*/iu, '')
    .trim();
  if (!line1) return undefined;

  return {
    label: line1.split(',')[0]?.trim() || line1,
    line1,
    district,
    city,
  };
}

function partialAddressText(state: AgentGraphState): string | undefined {
  const value = isRecord(state.entities) ? state.entities.addressText : undefined;
  if (typeof value !== 'string' || value.trim().length === 0) return undefined;
  return addressFromText(value) ? undefined : value.trim();
}

function completeInvoiceRequestFromText(text: string):
  | { companyName: string; taxCode: string; email: string }
  | undefined {
  const email = text.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0];
  const taxCode = text.match(/\b\d{10,14}\b/)?.[0];
  const companyName = text.split(',')[0]?.trim();
  if (!email || !taxCode || !companyName || /@|\d{10,14}/.test(companyName)) return undefined;
  return { companyName, taxCode, email };
}

function hasIncompleteAddressDraft(state: AgentGraphState): boolean {
  const draft = state.addressDraft;
  if (!draft) return false;
  return !draft.line1 || !draft.district || !draft.city;
}

function normalizedAddressEvidence(value: string): string {
  return normalizedIntentText(value).replace(/[^a-z0-9]+/g, ' ').trim();
}

function plannerAddressDraft(state: AgentGraphState): Partial<Address> | undefined {
  const rawDraft = isRecord(state.entities) && isRecord(state.entities.addressDraft)
    ? state.entities.addressDraft
    : undefined;
  if (!rawDraft) return undefined;

  const latestMessage = normalizedAddressEvidence(state.latestUserMessage);
  const draft: Partial<Address> = {};
  for (const field of ['label', 'line1', 'district', 'city'] as const) {
    const value = rawDraft[field];
    if (typeof value !== 'string') continue;
    const normalizedValue = normalizedAddressEvidence(value);
    if (!normalizedValue || !latestMessage.includes(normalizedValue)) continue;
    draft[field] = value.trim();
  }
  return Object.keys(draft).length > 0 ? draft : undefined;
}

function mergeVerifiedAddressDraft(
  state: AgentGraphState,
  fulfillmentLocationContext: FulfillmentPlanningContext | undefined,
): void {
  const suppliedDraft = plannerAddressDraft(state);
  const location = fulfillmentLocationContext?.candidates.length === 1
    ? fulfillmentLocationContext.candidates[0]
    : undefined;
  if (!suppliedDraft && !location) return;

  // A model-authored incomplete draft is not enough to replace a fulfillment
  // address that was already verified and quoted. Require current-turn
  // location evidence or an actual address-change signal. This keeps unrelated
  // checkout details (for example invoice text) from being promoted to line1.
  if (
    suppliedDraft &&
    state.address &&
    state.fulfillment &&
    !location &&
    !isAddressChangeRequest(state.latestUserMessage) &&
    !partialAddressText(state)
  ) {
    return;
  }

  const currentTurnAddressFields: Partial<Address> = {
    ...(suppliedDraft ?? {}),
    ...(location ? { district: location.district, city: location.city } : {}),
  };
  const startsDifferentConfirmedAddress = Boolean(
    state.address &&
    (['line1', 'district', 'city'] as const).some((field) => {
      const currentValue = state.address?.[field];
      const suppliedValue = currentTurnAddressFields[field];
      return Boolean(
        currentValue &&
        suppliedValue &&
        normalizedAddressEvidence(currentValue) !== normalizedAddressEvidence(suppliedValue),
      );
    }),
  );

  if (suppliedDraft && !state.order) {
    state.address = undefined;
    state.fulfillment = undefined;
    state.orderPreview = undefined;
  }

  state.addressDraft = {
    ...(startsDifferentConfirmedAddress ? {} : (state.addressDraft ?? {})),
    ...currentTurnAddressFields,
  };
}

function shouldUseKnownAddressForFulfillment(state: AgentGraphState): boolean {
  return Boolean(
    state.cart &&
    state.cart.items.length > 0 &&
    state.address &&
    (
      hasPlannerBooleanEntity(state, 'useSavedAddress') ||
      hasPlannerBooleanEntity(state, 'fulfillmentAccepted')
    ),
  );
}

function plannerSavedAddressDecision(state: AgentGraphState):
  | { addressIndex: number; decision: 'suggest' | 'accept' }
  | undefined {
  const value = isRecord(state.entities) ? state.entities.savedAddressDecision : undefined;
  if (!isRecord(value)) return undefined;
  if (!Number.isInteger(value.addressIndex) || typeof value.addressIndex !== 'number' || value.addressIndex < 0) return undefined;
  if (value.decision !== 'suggest' && value.decision !== 'accept') return undefined;
  return { addressIndex: value.addressIndex, decision: value.decision };
}

function addressesHaveSameLocation(left: Address, right: Address): boolean {
  return (['line1', 'district', 'city'] as const).every(
    (field) => normalizedAddressEvidence(left[field]) === normalizedAddressEvidence(right[field]),
  );
}

function presentedSavedAddressIndex(
  recentTurns: ConversationTurn[],
  savedAddresses: Address[],
): number | undefined {
  const presentedAddress = [...recentTurns]
    .reverse()
    .filter((turn) => turn.role === 'assistant')
    .map((turn) => turn.metadata?.genUi)
    .find((genUi) =>
      genUi?.widgetKind === 'addressFulfillmentCheck' || genUi?.widgetKind === 'orderReviewConfirm',
    )?.data.address;
  if (!isRecord(presentedAddress)) return undefined;
  if (
    typeof presentedAddress.line1 !== 'string' ||
    typeof presentedAddress.district !== 'string' ||
    typeof presentedAddress.city !== 'string'
  ) {
    return undefined;
  }
  const candidate: Address = {
    label: typeof presentedAddress.label === 'string' ? presentedAddress.label : presentedAddress.line1,
    line1: presentedAddress.line1,
    district: presentedAddress.district,
    city: presentedAddress.city,
  };
  const index = savedAddresses.findIndex((address) => addressesHaveSameLocation(address, candidate));
  return index >= 0 ? index : undefined;
}

function applyPlannerSavedAddressDecision(state: AgentGraphState): void {
  const decision = plannerSavedAddressDecision(state);
  if (!decision) return;
  const candidate = state.customerContext?.savedAddresses[decision.addressIndex];
  if (!candidate) {
    state.entities = {
      ...(isRecord(state.entities) ? state.entities : {}),
      useSavedAddress: false,
      fulfillmentAccepted: false,
      asksClarification: true,
    };
    return;
  }

  state.addressDraft = undefined;
  if (decision.decision === 'suggest') {
    state.address = undefined;
    state.fulfillment = undefined;
    state.orderPreview = undefined;
    return;
  }
  if (!state.address || !addressesHaveSameLocation(state.address, candidate)) {
    state.fulfillment = undefined;
    state.orderPreview = undefined;
  }
  state.address = candidate;
}

function selectedSavedAddressCandidate(state: AgentGraphState): Address | undefined {
  const decision = plannerSavedAddressDecision(state);
  if (decision) return state.customerContext?.savedAddresses[decision.addressIndex];
  const savedAddresses = state.customerContext?.savedAddresses ?? [];
  return savedAddresses.length === 1 ? savedAddresses[0] : undefined;
}

function cartItemCodes(state: AgentGraphState): string[] {
  return [...new Set(state.cart?.items.map((item) => item.itemCode) ?? [])];
}

const verifiedStateSnapshotSourceType = 'graph:verified_state';

type VerifiedStateSnapshot = Pick<
  AgentGraphState,
  | 'cart'
  | 'address'
  | 'addressDraft'
  | 'orderPreview'
  | 'order'
  | 'pendingReorder'
  | 'comboConversionProposal'
  | 'fulfillment'
  | 'promotionContext'
  | 'contentEvidence'
  | 'menuSearchResults'
  | 'menuModifierOptions'
  | 'customerContext'
  | 'paymentAttempt'
  | 'selectedPaymentMethod'
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

async function routeSmallTalk(
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

function hasPlannerBooleanEntity(state: AgentGraphState, key: string): boolean {
  return isRecord(state.entities) && state.entities[key] === true;
}

function commercePlannerState(state: AgentGraphState): CommercePlannerState {
  const { channel: _channel, recentTurns: _recentTurns, ...commerceState } = state;
  return commerceState;
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

function paymentLinkMethodFromFixtureId(methodId: string): PaymentLinkMethod | undefined {
  if (methodId === 'cash_on_delivery') return 'cod';
  if (methodId === 'visa_master_card') return 'card';
  if (methodId === 'zalopay_wallet') return 'zalopay';
  if (methodId === 'momo_wallet') return 'momo';
  return undefined;
}

function paymentEvidenceDirectlyMatchesQuery(
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

function findPaymentEvidenceForLinkMethod(
  evidence: AgentGraphState['paymentMethodEvidence'],
  method: PaymentLinkMethod,
): NonNullable<AgentGraphState['paymentMethodEvidence']>[number] | undefined {
  return evidence?.find((entry) => entry.methodId === paymentMethodFixtureId(method));
}

function customerCommand(
  metadata: ConversationTurnMetadata | null | undefined,
): CustomerCommand | undefined {
  return metadata?.customerCommand;
}

function isCustomerCommand(
  metadata: ConversationTurnMetadata | null | undefined,
  kind: CustomerCommand['kind'],
): boolean {
  return customerCommand(metadata)?.kind === kind;
}

function paymentMethodFromCustomerCommand(
  metadata: ConversationTurnMetadata | null | undefined,
): PaymentLinkMethod | undefined {
  const command = customerCommand(metadata);
  if (command?.kind !== 'select_payment_method') return undefined;
  const methodId = command.methodId;
  if (methodId === 'momo_wallet') return 'momo';
  if (methodId === 'zalopay_wallet') return 'zalopay';
  if (methodId === 'visa_master_card') return 'card';
  if (methodId === 'cash_on_delivery') return 'cod';
  return undefined;
}

function commandCartUpdateToToolCall(metadata: ConversationTurnMetadata | null | undefined): ToolCallRequest | undefined {
  const command = customerCommand(metadata);
  if (command?.kind !== 'cart_update') return undefined;
  return {
    toolName: 'updateCart',
    arguments: {
      itemCode: command.itemCode,
      quantity: command.quantity,
    },
  };
}

interface StructuredModifierSelection {
  itemCode: string;
  groupId: string;
  modifierId: string;
}

function structuredModifierSelection(
  metadata: ConversationTurnMetadata | null | undefined,
): StructuredModifierSelection | undefined {
  const command = customerCommand(metadata);
  if (command?.kind !== 'modifier_selection') return undefined;
  return {
    itemCode: command.itemCode,
    groupId: command.groupId,
    modifierId: command.modifierId,
  };
}

function verifiedModifierSelectionToolCall(
  state: AgentGraphState,
  selection: StructuredModifierSelection,
): { call: ToolCallRequest; acknowledgement: string } | undefined {
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

function commandBatchUpdateToToolCalls(
  metadata: ConversationTurnMetadata | null | undefined,
): ToolCallRequest[] | undefined {
  const command = customerCommand(metadata);
  if (command?.kind !== 'cart_batch_update') return undefined;
  return command.items.map((item) => ({
    toolName: 'updateCart',
    arguments: { itemCode: item.itemCode, quantity: item.quantity },
  }));
}

function verifiedMenuBatchAcknowledgement(
  cart: Cart | undefined,
  selections: Array<{ itemCode: string; quantity: number }>,
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

function normalizeNewItemCartUpdates(
  state: AgentGraphState,
  calls: ToolCallRequest[],
): ToolCallRequest[] {
  const existingItemCodes = new Set(state.cart?.items.map((item) => item.itemCode) ?? []);
  const mergedIndexes = new Map<string, number>();
  const normalized: ToolCallRequest[] = [];

  for (const call of calls) {
    const argumentKeys = Object.keys(call.arguments);
    const itemCode = call.arguments.itemCode;
    const quantity = call.arguments.quantity;
    const isDirectValidShape =
      call.toolName === 'updateCart' &&
      argumentKeys.every((key) => ['itemCode', 'quantity', 'modifiers'].includes(key)) &&
      typeof itemCode === 'string' &&
      itemCode.length > 0 &&
      typeof quantity === 'number' &&
      Number.isInteger(quantity) &&
      quantity > 0 &&
      !existingItemCodes.has(itemCode);

    if (!isDirectValidShape) {
      normalized.push(call);
      continue;
    }

    const modifierKey = JSON.stringify(canonicalJsonValue(call.arguments.modifiers ?? []));
    const mergeKey = `${itemCode}:${modifierKey}`;
    const existingIndex = mergedIndexes.get(mergeKey);
    if (existingIndex === undefined) {
      mergedIndexes.set(mergeKey, normalized.length);
      normalized.push(call);
      continue;
    }

    const existingCall = normalized[existingIndex]!;
    normalized[existingIndex] = {
      ...existingCall,
      arguments: {
        ...existingCall.arguments,
        quantity: (existingCall.arguments.quantity as number) + quantity,
      },
    };
  }

  return normalized;
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
  state.selectedPaymentMethod = undefined;
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
  if (needsCustomer && (customerContext?.favorites.length ?? 0) === 0) {
    const favoriteItems = await input.clients.customer.getFavoriteItems(input.customerId);
    if (favoriteItems.ok && favoriteItems.value) {
      customerContext = {
        savedAddresses: customerContext?.savedAddresses ?? [],
        recentOrders: customerContext?.recentOrders ?? [],
        favorites: favoriteItems.value,
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
    addressDraft: state.addressDraft,
    orderPreview: state.orderPreview,
    order: state.order,
    pendingReorder: state.pendingReorder,
    comboConversionProposal: state.comboConversionProposal,
    fulfillment: state.fulfillment,
    promotionContext: state.promotionContext,
    contentEvidence: state.contentEvidence,
    menuSearchResults: state.menuSearchResults,
    menuModifierOptions: state.menuModifierOptions,
    customerContext: state.customerContext,
    paymentAttempt: state.paymentAttempt,
    selectedPaymentMethod: state.selectedPaymentMethod,
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
    case 'checkStoreAvailability':
      if (isRecord(result.value)) {
        const unavailableItemCodes = Object.entries(result.value)
          .filter(([, available]) => available === false)
          .map(([itemCode]) => itemCode);
        const activeCartItemCodes = new Set(state.cart?.items.map((item) => item.itemCode) ?? []);
        const unavailableCartItemCodes = unavailableItemCodes.filter((itemCode) => activeCartItemCodes.has(itemCode));
        if (unavailableCartItemCodes.length > 0) {
          state.fulfillment = undefined;
          state.orderPreview = undefined;
          state.userConfirmedOrder = false;
          repriceCartWithDeliveryFee(state, 0);
          state.entities = {
            ...(isRecord(state.entities) ? state.entities : {}),
            asksClarification: true,
            fulfillmentRisk: 'item_unavailable_before_confirmation',
            unavailableItemCodes: unavailableCartItemCodes,
          };
          pushEscalationReasons(state, ['item_unavailable_before_confirmation']);
        }
      }
      return;
    case 'quoteFulfillment':
      if (isRecord(result.value)) {
        state.fulfillment = result.value as unknown as AgentGraphState['fulfillment'];
        if (isRecord(args.address)) {
          state.address = args.address as unknown as AgentGraphState['address'];
          state.addressDraft = undefined;
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
        state.promotionOffers = result.value as AgentGraphState['promotionOffers'];
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
        const nextResults = result.value as NonNullable<AgentGraphState['menuSearchResults']>;
        const isSpecificLookup = typeof args.query === 'string' && args.query.trim().length > 0;
        if (!isSpecificLookup) {
          state.menuSearchResults = nextResults;
          state.plannerMenuSearchResults = nextResults.slice(0, 24);
          return;
        }
        const mergeUnique = (items: NonNullable<AgentGraphState['menuSearchResults']>, limit?: number) => {
          const seenCodes = new Set<string>();
          const unique = items.filter((item) => {
            if (seenCodes.has(item.code)) return false;
            seenCodes.add(item.code);
            return true;
          });
          return limit === undefined ? unique : unique.slice(0, limit);
        };
        state.menuSearchResults = mergeUnique([
          ...nextResults,
          ...(state.menuSearchResults ?? []),
        ]);
        state.plannerMenuSearchResults = mergeUnique([
          ...nextResults.slice(0, 4),
          ...(state.plannerMenuSearchResults ?? state.menuSearchResults.slice(0, 4)),
        ], 24);
      }
      return;
    case 'getItemDetails':
      if (isRecord(result.value)) {
        state.menuItemDetail = result.value as unknown as AgentGraphState['menuItemDetail'];
      }
      return;
    case 'getModifierOptions':
      if (isRecord(result.value)) {
        state.menuModifierOptions = result.value as AgentGraphState['menuModifierOptions'];
      }
      return;
    case 'explainPromotion':
      if (isRecord(result.value) && typeof result.value.offerId === 'string') {
        state.promotionOffers = [result.value as unknown as NonNullable<AgentGraphState['promotionOffers']>[number]];
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
        const requestedMethod = plannerPaymentMethod(state);
        if (requestedMethod) {
          state.selectedPaymentMethod =
            findPaymentEvidenceForLinkMethod(state.paymentMethodEvidence, requestedMethod)?.supported === true
              ? requestedMethod
              : undefined;
        } else if (typeof args.query === 'string' && args.query.trim().length > 0) {
          const directMatches = state.paymentMethodEvidence?.filter((evidence) =>
            paymentEvidenceDirectlyMatchesQuery(evidence, args.query as string),
          ) ?? [];
          state.selectedPaymentMethod = directMatches.length === 1 && directMatches[0]?.supported === true
            ? paymentLinkMethodFromFixtureId(directMatches[0].methodId)
            : undefined;
        }
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
  if (!(await isRunStillCurrent(input.turnInput))) {
    throw new Error('customer_run_cancelled');
  }
  const irreversible = input.call.toolName === 'placeOrder';
  const protectedPhase = irreversible || new Set<ToolName>([
    'updateCart', 'acquireVoucher', 'redeemReward', 'collectInvoice',
    'createPaymentLink', 'handoff',
  ]).has(input.call.toolName);
  const validatedArguments = parseToolArguments(
    input.call.toolName,
    input.call.arguments,
  );
  if (validatedArguments.success) {
    await input.turnInput.observeRun?.({
      kind: 'tool',
      protected: protectedPhase,
      irreversible,
      progressFamily: projectToolProgressFamily({
        toolName: input.call.toolName,
        arguments: validatedArguments.data as Record<string, unknown>,
      }),
    });
  }
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
    if (!(await isRunStillCurrent(input.turnInput))) {
      throw new Error('customer_run_cancelled');
    }
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
  if (input.result.ok) await input.turnInput.observeRun?.({ kind: 'verified_state' });
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

async function recoverVerifiedMenuResultsFromPlanningContext(input: {
  turnInput: AgentTurnInput;
  turnTrace?: AgentTraceSpan;
  state: AgentGraphState;
  currentTurnToolTrace: ToolTraceEntry[];
}): Promise<MenuItem[]> {
  const planningContext = input.state.plannerMenuCatalogContext;
  if (!planningContext || input.state.cart || input.state.order) return [];
  const query = normalizedAddressEvidence(planningContext.query);
  const queryTokens = new Set(query.match(/[a-z0-9]+/g) ?? []);
  const hasDirectCatalogAnchor = planningContext.candidates.some((candidate) => {
    const normalizedName = normalizedAddressEvidence(candidate.name);
    const leadingNameToken = normalizedName.match(/[a-z0-9]+/)?.[0];
    return (
      (normalizedName.length > 0 && query.includes(normalizedName)) ||
      (leadingNameToken !== undefined && queryTokens.has(leadingNameToken))
    );
  });
  if (!hasDirectCatalogAnchor) return [];

  const candidates = planningContext.candidates.filter(
    (candidate) => candidate.available && candidate.verifiedForMutation,
  );
  const recovered: MenuItem[] = [];
  const seenCodes = new Set<string>();

  for (const candidate of candidates) {
    if (seenCodes.has(candidate.code)) continue;
    seenCodes.add(candidate.code);
    try {
      const result = await executeAndApplyTracedToolCall({
        ...input,
        call: {
          toolName: 'getItemDetails',
          arguments: { code: candidate.code },
        },
      });
      if (result.ok && isRecord(result.value)) {
        recovered.push(result.value as unknown as MenuItem);
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'customer_run_cancelled') throw error;
      await input.turnInput.store.appendEvent(
        input.turnInput.sessionId,
        'agent:recovery_catalog_candidate_failed',
        {
          itemCode: candidate.code,
          message: error instanceof Error ? error.message : 'Unknown catalog recovery failure',
        },
      );
    }
  }

  if (recovered.length > 0) {
    input.state.menuSearchResults = recovered;
    input.state.plannerMenuSearchResults = recovered.slice(0, 24);
    input.state.menuItemDetail = undefined;
  }
  return recovered;
}

function requestedExactQuantityPlans(
  context: MenuPlanningContext | undefined,
): NonNullable<MenuPlanningContext['exactQuantityPlans']> {
  if (context?.requestedQuantityPlans?.length) return context.requestedQuantityPlans;
  if (!context?.exactQuantityPlans?.length) return [];
  const queryTokens = normalizedIntentText(context.query).match(/[a-z0-9]+/g) ?? [];
  const numericPositions = queryTokens.flatMap((token, index) => /^\d+$/.test(token)
    ? [{ targetQuantity: Number(token), index }]
    : []);
  const componentAliases = new Map<keyof MenuComposition, Set<string>>();
  for (const candidate of context.candidates) {
    for (const component of ['friedChickenPieces', 'standardPepsi'] as const) {
      if (!candidate.unitComposition?.[component]) continue;
      const alias = (normalizedIntentText(candidate.name).match(/[a-z]+/g) ?? []).join(' ');
      if (alias.length < 4) continue;
      const aliases = componentAliases.get(component) ?? new Set<string>();
      aliases.add(alias);
      componentAliases.set(component, aliases);
    }
  }

  const selected = numericPositions.flatMap(({ targetQuantity, index }, positionIndex) => {
    const nextIndex = numericPositions[positionIndex + 1]?.index ?? queryTokens.length;
    const segment = queryTokens.slice(index + 1, nextIndex).join(' ');
    const matchingComponents = [...componentAliases.entries()]
      .filter(([, aliases]) => [...aliases].some((alias) => segment.includes(alias)))
      .map(([component]) => component);
    if (matchingComponents.length !== 1) return [];
    const plan = context.exactQuantityPlans?.find(
      (candidate) => candidate.targetQuantity === targetQuantity && candidate.component === matchingComponents[0],
    );
    return plan ? [plan] : [];
  });
  const uniqueKeys = new Set<string>();
  return selected.filter((plan) => {
    const key = `${plan.component}:${plan.targetQuantity}`;
    if (uniqueKeys.has(key)) return false;
    uniqueKeys.add(key);
    return true;
  });
}

async function recoverExactQuantityCartFromPlanningContext(input: {
  turnInput: AgentTurnInput;
  turnTrace?: AgentTraceSpan;
  state: AgentGraphState;
  currentTurnToolTrace: ToolTraceEntry[];
}): Promise<boolean> {
  const plans = requestedExactQuantityPlans(input.state.plannerMenuCatalogContext);
  if (plans.length === 0) return false;
  const quantities = new Map<string, number>();
  for (const selection of plans.flatMap((plan) => plan.selections)) {
    quantities.set(selection.itemCode, (quantities.get(selection.itemCode) ?? 0) + selection.quantity);
  }
  const changes = [...quantities].map(([itemCode, quantity]) => ({ itemCode, quantity }));
  const call: ToolCallRequest = { toolName: 'updateCart', arguments: { changes } };
  const gating = applySafetyGates(input.state, [call], { requireVerifiedItemCodes: true });
  pushEscalationReasons(input.state, gating.blockedReasons);
  if (gating.allowedCalls.length === 0 || !(await ensureCartForTool(input.turnInput, input.state, call))) return false;
  const result = await executeAndApplyTracedToolCall({ ...input, call });
  if (!result.ok) return false;
  input.state.intent = 'cart_edit';
  input.state.entities = { preferCartSurface: true };
  return true;
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
  if (input.state.escalationReasons.includes('item_unavailable_before_confirmation')) return;

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

async function revalidateCurrentCartAvailability(input: {
  turnInput: AgentTurnInput;
  state: AgentGraphState;
  currentTurnToolTrace: ToolTraceEntry[];
}): Promise<void> {
  const fulfillment = input.state.fulfillment;
  const itemCodes = cartItemCodes(input.state);
  if (!fulfillment || itemCodes.length === 0) return;
  if (input.currentTurnToolTrace.some((entry) => entry.toolName === 'checkStoreAvailability' && entry.ok)) return;

  await executeAndApplyTracedToolCall({
    ...input,
    call: {
      toolName: 'checkStoreAvailability',
      arguments: {
        storeId: fulfillment.storeId,
        itemCodes,
        disposition: fulfillment.disposition,
      },
    },
  });
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
  if (contextPolicyRequiresConfirmation(input.contextPolicy, 'recentOrder')) return;
  if (!contextPolicyIsActive(input.contextPolicy, 'recentOrder')) return;
  if (!hasPlannerBooleanEntity(input.state, 'reorderConfirmed')) return;
  if (hasSuccessfulToolResult(input.currentTurnToolTrace, ['updateCart'])) return;

  const recentOrderCart = input.state.pendingReorder?.cart ?? input.state.customerContext?.recentOrders[0]?.cart;
  if (!recentOrderCart || recentOrderCart.items.length === 0) return;
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
  input.state.cart = undefined;

  for (const item of recentOrderCart.items) {
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
    input.state.pendingReorder = undefined;
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

function isIngredientSafetyQuestion(text: string): boolean {
  const normalized = normalizedIntentText(text);
  return /\b(?:khong co|di ung|thanh phan|an kieng)\b/.test(normalized);
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

function isCartAdditionRequest(text: string): boolean {
  const normalized = normalizedIntentText(text);
  return /\b(?:cho minh|toi muon|muon them|them|lay)\b/.test(normalized);
}

function isPaymentMethodAvailabilityRequest(text: string): boolean {
  const normalized = normalizedIntentText(text);
  return /\bthanh toan\b/.test(normalized) && /\b(?:duoc khong|co duoc|ho tro|chap nhan)\b/.test(normalized);
}

function isPaymentFailureRequest(text: string): boolean {
  const normalized = normalizedIntentText(text);
  return /\bthanh toan\b/.test(normalized) && /\b(?:loi|that bai|khong duoc)\b/.test(normalized);
}

function isPaymentCompletionClaim(text: string): boolean {
  const normalized = normalizedIntentText(text);
  return (
    /\b(?:thanh toan|tra tien)\b/.test(normalized) &&
    /\b(?:roi|xong|done|paid|completed)\b/.test(normalized)
  );
}

function isHandoffExplanationRequest(text: string): boolean {
  const normalized = normalizedIntentText(text);
  return /\b(?:sao|tai sao)\b/.test(normalized) && /\b(?:nhan vien|chuyen nguoi)\b/.test(normalized);
}

function isCheckoutSupplementRequest(text: string): boolean {
  const normalized = normalizedIntentText(text);
  return /\b(?:voucher|ma kfc|ap dung|hoa don|bam chuong|goi minh)\b/.test(normalized);
}

function beginFreshShoppingJourney(state: AgentGraphState): void {
  state.cart = undefined;
  state.address = undefined;
  state.addressDraft = undefined;
  state.orderPreview = undefined;
  state.order = undefined;
  state.pendingReorder = undefined;
  state.comboConversionProposal = undefined;
  state.fulfillment = undefined;
  state.promotionContext = undefined;
  state.paymentAttempt = undefined;
  state.selectedPaymentMethod = undefined;
  state.paymentMethodEvidence = undefined;
  state.invoiceRequest = undefined;
  state.handoff = undefined;
  state.menuSearchResults = undefined;
  state.plannerMenuSearchResults = undefined;
  state.menuItemDetail = undefined;
  state.menuModifierOptions = undefined;
  state.toolTrace = [];
  state.userConfirmedOrder = false;
  state.entities = {
    ...(isRecord(state.entities) ? state.entities : {}),
    freshShoppingJourney: true,
    orderConfirmed: false,
  };
}

function isDifferentRecipientReorder(text: string): boolean {
  const normalized = normalizedIntentText(text);
  return /\bdat lai\b/.test(normalized) && /\b(?:dong nghiep|ban be|nguoi khac)\b/.test(normalized);
}

function isPreviousOrderReorderRequest(text: string): boolean {
  const normalized = normalizedIntentText(text);
  return /\bdat lai\b/.test(normalized) && /\b(?:don|lan truoc|mon cu)\b/.test(normalized);
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

function isAffirmativeResponse(text: string): boolean {
  return /^(?:dung roi|dong y|ok|oke)\b/.test(normalizedIntentText(text));
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
  const modifiesOrder = Boolean(input.state.order) && isPostOrderModificationRequest(input.state.latestUserMessage);
  if (!tracksOrder && !cancelsOrder && !reportsPaymentFailure && !modifiesOrder) return;

  const hydrated = await hydrateRecentOrderContext(
    input.turnInput,
    buildVerifiedStateSnapshot(input.state),
    { order: 'active', payment: 'active' },
  );
  Object.assign(input.state, hydrated);

  if (
    input.state.order?.id &&
    (cancelsOrder || modifiesOrder) &&
    !hasSuccessfulToolResult(input.currentTurnToolTrace, ['getOrderStatus'])
  ) {
    await executeAndApplyTracedToolCall({
      ...input,
      call: { toolName: 'getOrderStatus', arguments: { orderId: input.state.order.id } },
    });
  }

  if (!cancelsOrder || input.state.handoff) return;

  const call: ToolCallRequest = {
    toolName: 'handoff',
    arguments: { reasons: ['order_cancellation_requested'] },
  };
  await executeAndApplyTracedToolCall({ ...input, call });
}

async function refreshEquivalentComboProposal(input: {
  turnInput: AgentTurnInput;
  state: AgentGraphState;
  currentTurnToolTrace: ToolTraceEntry[];
}): Promise<void> {
  if (!input.state.cart || !input.turnInput.clients.recommendation.recommendEquivalentCombo) return;
  if (!hasSuccessfulToolResult(input.currentTurnToolTrace, ['updateCart'])) return;

  const result = await input.turnInput.clients.recommendation.recommendEquivalentCombo(input.state.cart);
  const entities = isRecord(input.state.entities) ? { ...input.state.entities } : {};
  if (!result.ok || !result.value) {
    delete entities.comboConversionProposal;
    input.state.comboConversionProposal = undefined;
    input.state.entities = entities;
    return;
  }

  const itemResult = await input.turnInput.clients.menu.getItemDetails(result.value.comboItemCode);
  if (!itemResult.ok || !itemResult.value) {
    delete entities.comboConversionProposal;
    input.state.comboConversionProposal = undefined;
    input.state.entities = entities;
    return;
  }

  const proposal = {
    itemCode: result.value.comboItemCode,
    name: itemResult.value.name,
    quantity: result.value.comboQuantity,
    sourceItemCodes: input.state.cart.items.map((item) => item.itemCode),
    sourceTotalVnd: result.value.sourceTotalVnd,
    comboTotalVnd: result.value.comboTotalVnd,
    savingsVnd: result.value.savingsVnd,
  };
  input.state.comboConversionProposal = proposal;
  entities.comboConversionProposal = proposal;
  input.state.entities = entities;
  await input.turnInput.store.appendEvent(input.turnInput.sessionId, 'commerce:combo_conversion_proposed', {
    proposal,
  });
  await executeAndApplyTracedToolCall({
    turnInput: input.turnInput,
    state: input.state,
    currentTurnToolTrace: input.currentTurnToolTrace,
    call: { toolName: 'getModifierOptions', arguments: { code: result.value.comboItemCode } },
  });
}

async function ensureIngredientSafetyEvidence(input: {
  turnInput: AgentTurnInput;
  state: AgentGraphState;
  currentTurnToolTrace: ToolTraceEntry[];
}): Promise<void> {
  if (!isIngredientSafetyQuestion(input.state.latestUserMessage)) return;
  if (hasSuccessfulToolResult(input.currentTurnToolTrace, ['searchContentPolicy', 'answerAllergenQuestion'])) return;
  await executeAndApplyTracedToolCall({
    ...input,
    call: {
      toolName: 'answerAllergenQuestion',
      arguments: { query: input.state.latestUserMessage },
    },
  });
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
  if (
    currentItem &&
    hasPlannerBooleanEntity(state, 'cartMutationRequested') &&
    normalizedIntentText(state.latestUserMessage).includes(normalizedIntentText(currentItem.name))
  ) {
    return false;
  }
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
  hasVerifiedCatalogSelections: boolean;
  contextInventory: ReturnType<typeof buildToolPlannerContextInventory>;
}): boolean {
  const catalogSelectionCallsAreSafeWithoutHiddenCheckoutState =
    input.hasVerifiedCatalogSelections &&
    input.toolCalls.every((call) => [
      'updateCart',
      'previewCart',
      'getMembershipProfile',
      'listMembershipRewards',
      'listMembershipWallet',
      'getMembershipPointHistory',
    ].includes(call.toolName));
  if (catalogSelectionCallsAreSafeWithoutHiddenCheckoutState) return false;
  const activatesCart = contextPolicyBecameActive(input.before, input.after, 'cart');
  const activatesRecentOrder = contextPolicyBecameActive(input.before, input.after, 'recentOrder');
  const activatesOrder = contextPolicyBecameActive(input.before, input.after, 'order');
  const activatesPayment = contextPolicyBecameActive(input.before, input.after, 'payment');
  const activatesFulfillment = contextPolicyBecameActive(input.before, input.after, 'fulfillment');
  const activatesCustomer = contextPolicyBecameActive(input.before, input.after, 'customer');
  const activatesMenu = contextPolicyBecameActive(input.before, input.after, 'menuSearchResults');
  return (
    (activatesCart && input.contextInventory.cart.available) ||
    (activatesRecentOrder && input.contextInventory.customer.recentOrderCount > 0) ||
    (activatesOrder && input.contextInventory.order.available) ||
    (activatesPayment && input.contextInventory.payment.available) ||
    (activatesFulfillment && (input.contextInventory.address.available || input.contextInventory.fulfillment.available)) ||
    (activatesCustomer && input.contextInventory.customer.available) ||
    (activatesMenu && input.contextInventory.menuSearchResults.available)
  );
}

function buildToolPlannerContextInventory(state: AgentGraphState) {
  const savedAddressCount = state.customerContext?.savedAddresses.length ?? 0;
  const recentOrderCount = state.customerContext?.recentOrders.length ?? 0;
  const favoriteCount = state.customerContext?.favorites.length ?? 0;
  const hasUsefulCustomerContext = Boolean(
    savedAddressCount > 0 ||
    recentOrderCount > 0 ||
    favoriteCount > 0 ||
    typeof state.customerContext?.loyaltyPoints === 'number',
  );
  return {
    cart: { available: Boolean(state.cart), itemCount: state.cart?.items.length ?? 0 },
    address: { available: Boolean(state.address) },
    fulfillment: { available: Boolean(state.fulfillment) },
    order: { available: Boolean(state.order) },
    payment: { available: Boolean(state.paymentAttempt || state.paymentMethodEvidence?.length) },
    menuSearchResults: {
      available: Boolean(state.menuSearchResults?.length),
      itemCount: state.menuSearchResults?.length ?? 0,
    },
    customer: {
      available: hasUsefulCustomerContext,
      savedAddressCount,
      recentOrderCount,
      favoriteCount,
    },
  };
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
  turnTrace?: AgentTraceSpan;
  state: AgentGraphState;
  currentTurnToolTrace: ToolTraceEntry[];
  plan?: NaturalLanguagePlan;
}): Promise<void> {
  const requestedQuantities = [
    ...requestedExactQuantityPlans(
      input.plan?.menuCatalogContext ?? input.state.plannerMenuCatalogContext,
    ).map((plan) => plan.targetQuantity),
    ...(input.plan?.toolCalls.flatMap((call) => {
      if (call.toolName !== 'updateCart') return [];
      const directQuantity = call.arguments.quantity;
      const batchQuantities = Array.isArray(call.arguments.changes)
        ? call.arguments.changes.flatMap((change) =>
            isRecord(change) && typeof change.quantity === 'number' ? [change.quantity] : [],
          )
        : [];
      return [
        ...(typeof directQuantity === 'number' ? [directQuantity] : []),
        ...batchQuantities,
      ];
    }) ?? []),
  ];
  if (!requestedQuantities.some((quantity) => Number.isInteger(quantity) && quantity >= 100)) return;
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
  state.selectedPaymentMethod = method;
}

async function createPaymentLinkAfterOrderFromRememberedMethod(input: {
  turnInput: AgentTurnInput;
  state: AgentGraphState;
  currentTurnToolTrace: ToolTraceEntry[];
}): Promise<void> {
  if (!input.state.order || input.state.order.status !== 'created') return;
  const method = input.state.selectedPaymentMethod;
  if (!method || input.state.paymentAttempt?.paymentUrl) return;

  const call: ToolCallRequest = {
    toolName: 'createPaymentLink',
    arguments: { method },
  };
  await executeAndApplyTracedToolCall({ ...input, call });
}

async function ensurePaymentStatusForCompletionClaim(input: {
  turnInput: AgentTurnInput;
  state: AgentGraphState;
  currentTurnToolTrace: ToolTraceEntry[];
}): Promise<void> {
  if (!isPaymentCompletionClaim(input.state.latestUserMessage)) return;
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
  'confirmed_address_required',
  'valid_fulfillment_required',
  'item_unavailable_before_confirmation',
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

function hasTrustedFixtureEvidence(state: AgentGraphState): boolean {
  const trustedFixtureModes = new Set(['public_crawl_seed', 'mock_external_state', 'test_only']);
  if (state.menuModifierOptions && trustedFixtureModes.has(state.menuModifierOptions.provenance.fixtureMode)) return true;
  return (state.toolTrace ?? []).some((entry) =>
    entry.provenance.some((source) => trustedFixtureModes.has(source.fixtureMode)),
  );
}

function toolExecutionFailureText(state: AgentGraphState): string {
  const failed = [...(state.toolTrace ?? [])].reverse().find((entry) => !entry.ok);
  switch (failed?.resultSummary) {
    case 'invalid_tool_arguments':
      return 'Dữ liệu món đã sẵn sàng, nhưng yêu cầu cập nhật giỏ không hợp lệ. Bạn thử lại thao tác giúp mình nhé.';
    case 'invalid_modifier':
      return 'Dữ liệu món đã sẵn sàng, nhưng tùy chọn này không áp dụng được cho món trong giỏ. Bạn chọn lại tùy chọn giúp mình nhé.';
    case 'cart_required':
    case 'cart_initialization_failed':
      return 'Dữ liệu món đã sẵn sàng, nhưng giỏ hàng chưa được khởi tạo. Bạn thử thêm món vào giỏ trước nhé.';
    default:
      return 'Dữ liệu món đã sẵn sàng, nhưng thao tác cập nhật chưa hoàn tất. Bạn thử lại giúp mình nhé.';
  }
}

function selectSafeFallbackText(state: AgentGraphState, plannerFallbackText?: string): string {
  const incompleteAddress = partialAddressText(state);
  if (incompleteAddress) {
    return `Mình đã nhận địa chỉ ${incompleteAddress}, nhưng còn thiếu quận/huyện và tỉnh/thành phố. Bạn bổ sung giúp mình để kiểm tra giao hàng nhé.`;
  }
  const comboProposal = state.comboConversionProposal ?? (
    isRecord(state.entities) && isRecord(state.entities.comboConversionProposal)
      ? state.entities.comboConversionProposal
      : undefined
  );
  if (
    comboProposal &&
    typeof comboProposal.name === 'string' &&
    typeof comboProposal.quantity === 'number' &&
    typeof comboProposal.sourceTotalVnd === 'number' &&
    typeof comboProposal.comboTotalVnd === 'number' &&
    typeof comboProposal.savingsVnd === 'number'
  ) {
    return `Giỏ gọi lẻ tạm tính ${comboProposal.sourceTotalVnd.toLocaleString('vi-VN')}đ. ` +
      `Mình thấy ${comboProposal.quantity} ${comboProposal.name} có thành phần tương đương, tổng ` +
      `${comboProposal.comboTotalVnd.toLocaleString('vi-VN')}đ, tiết kiệm ` +
      `${comboProposal.savingsVnd.toLocaleString('vi-VN')}đ. Mình chưa đổi giỏ; bạn có muốn đổi sang combo này không?`;
  }
  const savedAddressDecision = plannerSavedAddressDecision(state);
  if (savedAddressDecision?.decision === 'suggest') {
    const candidate = state.customerContext?.savedAddresses[savedAddressDecision.addressIndex];
    if (candidate) {
      return `Mình tìm thấy địa chỉ đã lưu ${candidate.line1}, ${candidate.district}, ${candidate.city}. Bạn xác nhận giao tới địa chỉ này nhé.`;
    }
  }
  const catalogSuggestion = isRecord(state.entities) && isRecord(state.entities.catalogSuggestion)
    ? state.entities.catalogSuggestion
    : undefined;
  if (
    catalogSuggestion &&
    typeof catalogSuggestion.name === 'string' &&
    !state.escalationReasons.includes('previous_order_confirmation_required')
  ) {
    return `Món phù hợp từ lịch sử của bạn là ${catalogSuggestion.name}. Mình chưa thêm vào giỏ; bạn xác nhận món này nhé.`;
  }

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
    case 'confirmed_address_required':
      return 'Mình cần địa chỉ giao hàng đầy đủ hoặc xác nhận rõ địa chỉ đã lưu trước khi kiểm tra phí và thời gian giao.';
    case 'valid_fulfillment_required':
      return 'Mình cần xác minh cửa hàng và hình thức nhận hoặc giao trước khi tiếp tục đặt đơn.';
    case 'item_unavailable_before_confirmation': {
      const unavailableItemCodes = isRecord(state.entities) && Array.isArray(state.entities.unavailableItemCodes)
        ? state.entities.unavailableItemCodes.filter((itemCode): itemCode is string => typeof itemCode === 'string')
        : [];
      const unavailableNames = state.cart?.items
        .filter((item) => unavailableItemCodes.includes(item.itemCode))
        .map((item) => item.name)
        .join(', ');
      return unavailableNames
        ? `${unavailableNames} vừa được báo hết tại cửa hàng giao hiện tại. Mình chưa đặt đơn; bạn muốn chọn món thay thế hay kiểm tra cửa hàng khác?`
        : 'Một món trong giỏ vừa được báo hết tại cửa hàng giao hiện tại. Mình chưa đặt đơn; bạn muốn chọn món thay thế hay kiểm tra cửa hàng khác?';
    }
    case 'payment_tool_success_required':
      return 'Mình chưa xác minh được trạng thái thanh toán thành công. Bạn gửi mã đơn để mình kiểm tra lại nhé.';
    case 'promotion_evidence_required':
      return 'Mình chưa có thông tin khuyến mãi đã được xác minh cho yêu cầu này. Bạn gửi thêm mã hoặc để mình kiểm tra ưu đãi công khai nhé.';
    case 'allergen_certainty_not_allowed':
      return 'Mình không thể khẳng định tuyệt đối về dị ứng từ dữ liệu hiện có. Mình có thể chia sẻ thông tin thành phần đã xác minh nếu bạn cần.';
    case 'tool_execution_failed':
      return toolExecutionFailureText(state);
    case 'cart_initialization_failed':
      return 'Mình chưa khởi tạo được giỏ hàng từ dữ liệu hiện có. Bạn thử lại món cần đặt giúp mình nhé.';
    case 'menu_item_verification_required':
      if (hasTrustedFixtureEvidence(state)) {
        return 'Dữ liệu món đã sẵn sàng, nhưng lựa chọn này không khớp với món trong giỏ. Bạn chọn lại tùy chọn giúp mình nhé.';
      }
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

async function composeAssistantResponse(input: {
  turnInput: AgentTurnInput;
  state: AgentGraphState;
  fallbackText: string;
  replyIntent: ReplyIntent;
  currentTurnToolTrace: ToolTraceEntry[];
  contextPolicy?: ContextPolicyDirective;
  turnTrace?: AgentTraceSpan;
  preferFallbackText?: boolean;
  suppressGenUi?: boolean;
}): Promise<AgentTurnOutput> {
  const responseProfile = responseProfileForChannel(input.turnInput.channel);
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
  const preserveCurrentMenuResults =
    shouldPreserveCurrentMenuSearchResults(input.currentTurnToolTrace) ||
    hasPlannerBooleanEntity(input.state, 'keepMenuSurface');

  const genUi = input.suppressGenUi || responseProfile !== 'genui'
    ? undefined
    : selectKfcGenUiAttachment({
        state: buildContextPolicyState(input.state, {
          metadata: input.turnInput.metadata,
          policy: contextPolicy,
          preserveCartOrderPaymentContext: shouldPreserveCurrentCartOrderPaymentContext(input.currentTurnToolTrace),
          preserveMenuSearchResults: preserveCurrentMenuResults,
          preservePaymentContext: shouldPreserveCurrentPaymentContext(input.currentTurnToolTrace),
          preserveHandoff: shouldPreserveCurrentHandoff(input.currentTurnToolTrace),
        }),
        turnToolNames: input.currentTurnToolTrace.filter((entry) => entry.ok).map((entry) => entry.toolName),
        reuseVerifiedMenuResults: contextPolicyIsActive(contextPolicy, 'menuSearchResults'),
      });

  const composerInput = {
    channel: input.turnInput.channel,
    presentationMode: responseProfile === 'genui' ? 'structured_companion' as const : 'standalone_text' as const,
    state: buildContextPolicyState(
      {
        ...input.state,
        toolTrace: input.currentTurnToolTrace,
      },
      {
        metadata: input.turnInput.metadata,
        policy: contextPolicy,
        preserveCartOrderPaymentContext: shouldPreserveCurrentCartOrderPaymentContext(input.currentTurnToolTrace),
        preserveMenuSearchResults: preserveCurrentMenuResults,
        preservePaymentContext: shouldPreserveCurrentPaymentContext(input.currentTurnToolTrace),
        preserveHandoff: shouldPreserveCurrentHandoff(input.currentTurnToolTrace),
        preserveRecentTurns: true,
        preserveToolTrace: true,
        compactMenuSearchResults: true,
      },
    ),
    replyIntent: input.replyIntent,
    fallbackText: input.fallbackText,
  };
  const shouldCompose =
    Boolean(input.turnInput.responseComposer) &&
    !input.preferFallbackText;
  if (!(await isRunStillCurrent(input.turnInput))) {
    throw new Error('customer_run_cancelled');
  }
  await input.turnInput.observeRun?.({ kind: 'response_composition' });
  const responseSpan = input.turnTrace && shouldCompose
    ? await input.turnTrace.startSpan({
        name: 'response_compose',
        runType: 'llm',
        inputs: { composerInput },
        metadata: {
          component: responseProfile === 'genui' ? 'GenUiCompanionComposer' : 'StandaloneSocialComposer',
          responseProfile,
        },
        tags: ['agent-response', `profile:${responseProfile}`],
      })
    : undefined;

  if (input.turnInput.responseComposer && shouldCompose) {
    try {
      const specializedInput = {
        state: composerInput.state,
        replyIntent: composerInput.replyIntent,
        fallbackText: composerInput.fallbackText,
      };
      responseText = responseProfile === 'genui'
        ? input.turnInput.responseComposer.composeGenUiCompanion
          ? await input.turnInput.responseComposer.composeGenUiCompanion(specializedInput)
          : await input.turnInput.responseComposer.composeResponse(composerInput)
        : input.turnInput.responseComposer.composeStandaloneSocial
          ? await input.turnInput.responseComposer.composeStandaloneSocial(specializedInput)
          : await input.turnInput.responseComposer.composeResponse(composerInput);
      const valid = responseProfile === 'genui'
        ? validateGenUiCompanionResponse(responseText, composerInput.state)
        : validateStandaloneSocialResponse(responseText, composerInput.state);
      if (!valid) throw new Error(`invalid_${responseProfile}_response`);
    } catch (error) {
      await input.turnInput.store.appendEvent(input.turnInput.sessionId, 'llm:response_composer_failed', {
        message: error instanceof Error ? error.message : 'Unknown response composer failure',
        replyIntent: input.replyIntent,
      });
      responseText = input.fallbackText;
    }
  }

  if (responseProfile === 'social' && (!shouldCompose || !validateStandaloneSocialResponse(responseText, composerInput.state))) {
    responseText = buildStandaloneSocialFallback(composerInput.state, input.fallbackText);
  }

  if (
    input.state.cart &&
    !input.state.fulfillment &&
    !input.state.order &&
    isExplicitCartContinuationRequest(input.state.latestUserMessage) &&
    !/\bdia chi\b/.test(normalizedIntentText(responseText))
  ) {
    const addressPrompt = /\bdia chi\b/.test(normalizedIntentText(input.fallbackText))
      ? input.fallbackText
      : 'Bạn gửi giúp mình địa chỉ giao hàng đầy đủ để mình kiểm tra phí ship và thời gian giao nhé.';
    responseText = responseProfile === 'social'
      ? `${responseText}\n${addressPrompt}`
      : addressPrompt;
  }

  let presentation = responseProfile === 'genui'
    ? buildChannelPresentation({
        channel: input.turnInput.channel,
        graphResponseText: responseText,
        genUi,
      })
    : buildSocialPresentation({
        channel: input.turnInput.channel as Exclude<Channel, 'kfc'>,
        standaloneText: responseText,
        state: composerInput.state,
      });
  assertPresentationMatchesChannel(input.turnInput.channel, presentation);
  responseText = presentation.text;
  if (!responseText.trim()) {
    responseText = input.fallbackText.trim() || 'Mình cần bạn gửi lại yêu cầu để tiếp tục hỗ trợ.';
    presentation = {
      ...presentation,
      text: responseText,
    };
    await input.turnInput.store.appendEvent(input.turnInput.sessionId, 'agent:recovery_response', {
      reason: 'empty_channel_presentation',
      responseMode: 'deterministic',
    });
  }

  const output: AgentTurnOutput = {
    state: input.state,
    responseText,
    presentation,
    replyIntent: input.replyIntent,
    genUi: presentation.profile === 'genui' ? genUi : undefined,
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
const multiStepPlannerIterations = 2;
const defaultAgentTurnDeadlineMs = 8_000;
const maxMenuPlanningCandidates = 6;
const maxFulfillmentPlanningCandidates = 4;
const catalogOrderingPlanningToolNames = [
  'searchMenu',
  'getItemDetails',
  'getModifierOptions',
  'updateCart',
  'previewCart',
  'recommendAddOns',
  'findStores',
  'checkStoreAvailability',
  'quoteFulfillment',
  'searchPromotions',
  'explainPromotion',
  'validateVoucher',
  'getMembershipProfile',
  'listMembershipRewards',
  'listMembershipWallet',
  'getMembershipPointHistory',
  'listPaymentMethods',
  'searchContentPolicy',
  'answerAllergenQuestion',
  'handoff',
] satisfies ToolName[];
const activeCheckoutPlanningToolNames = [
  'searchMenu',
  'getItemDetails',
  'getModifierOptions',
  'updateCart',
  'previewCart',
  'recommendAddOns',
  'findStores',
  'checkStoreAvailability',
  'quoteFulfillment',
  'searchPromotions',
  'explainPromotion',
  'validateVoucher',
  'listPaymentMethods',
  'searchContentPolicy',
  'answerAllergenQuestion',
  'previewOrder',
  'placeOrder',
  'createPaymentLink',
  'collectInvoice',
  'handoff',
] satisfies ToolName[];

function planBeforeDeadline(
  planner: ToolPlanner,
  plannerInput: Parameters<ToolPlanner['plan']>[0],
  remainingMs: number,
): Promise<ToolPlannerOutput> {
  if (remainingMs <= 0) {
    return Promise.reject(new Error('Agent turn planning deadline exceeded'));
  }
  return new Promise<ToolPlannerOutput>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Agent turn planning deadline exceeded after ${remainingMs}ms`)),
      remainingMs,
    );
    void planner.plan(plannerInput).then(
      (result) => {
        clearTimeout(timeout);
        resolve(result);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}
const readOnlyDiscoveryTools = new Set<ToolName>([
  'searchMenu',
  'searchPromotions',
  'getItemDetails',
  'getModifierOptions',
  'listPaymentMethods',
]);
const catalogResolutionTools = new Set<ToolName>([
  'searchMenu',
  'getItemDetails',
  'getModifierOptions',
]);

function shouldStopAfterVerifiedDiscovery(input: {
  state: AgentGraphState;
  iterationEntries: ToolTraceEntry[];
}): boolean {
  if (input.iterationEntries.length === 0) return false;
  if (!input.iterationEntries.every((entry) => entry.ok && readOnlyDiscoveryTools.has(entry.toolName))) return false;
  const discoveredMenuForOrdering =
    input.iterationEntries.some((entry) =>
      entry.toolName === 'searchMenu' &&
      typeof entry.arguments.query === 'string' &&
      entry.arguments.query.trim().length > 0,
    ) &&
    (input.state.menuSearchResults?.length ?? 0) > 0 &&
    (input.state.intent === 'ordering' || input.state.intent === 'cart_edit') &&
    !hasPlannerBooleanEntity(input.state, 'asksClarification');
  if (discoveredMenuForOrdering) return false;
  if (hasPlannerBooleanEntity(input.state, 'cartMutationRequested')) return false;
  if (hasPlannerBooleanEntity(input.state, 'orderConfirmed')) return false;
  if (hasPlannerBooleanEntity(input.state, 'reorderConfirmed')) return false;
  if (hasPlannerBooleanEntity(input.state, 'fulfillmentAccepted')) return false;
  return true;
}

async function planNaturalLanguageTurn(
  context: LoadedAgentTurnContext,
): Promise<NaturalLanguagePlan> {
  const { input, state, recentTurns, turnTrace } = context;
  let activeContextPolicy = context.activeContextPolicy;
  const emptyPlan = (recoveryMode: NonNullable<NaturalLanguagePlan['recoveryMode']>): NaturalLanguagePlan => ({
    activeContextPolicy,
    planningProfile: state.cart && !state.order ? 'active_checkout' : 'full',
    multiStepEnabled: input.toolPlanner?.supportsMultiStep === true,
    toolCalls: [],
    responseClaims: [],
    plannerRequestedClarification: true,
    confirmsFulfillmentByText: isAffirmativeFulfillmentFollowup(input.text, recentTurns),
    confirmsOrderByText: isExplicitOrderConfirmationRequest(input.text),
    recoveryMode,
  });

  if (!input.toolPlanner) return emptyPlan('deterministic');
  await input.observeRun?.({ kind: 'planning' });
  const plannerDeadlineAt = Date.now() + (input.turnDeadlineMs ?? defaultAgentTurnDeadlineMs);
  const activeItemCodes = state.order ? [] : state.cart?.items.map((item) => item.itemCode) ?? [];
  const customerEvidenceItems = state.order
    ? []
    : [
        ...(state.customerContext?.favorites.map((item) => ({ itemCode: item.code, source: 'favorite' as const })) ?? []),
        ...(contextPolicyIsActive(activeContextPolicy, 'recentOrder') && !state.cart
          ? state.customerContext?.recentOrders.flatMap((order) => order.cart.items.map((item) => ({
              itemCode: item.itemCode,
              source: 'recent_order' as const,
            }))) ?? []
          : []),
      ];
  const fulfillmentPlanningResult = await input.clients.fulfillment.getPlanningContext({
    query: state.latestUserMessage,
    knownDistrict: state.addressDraft?.district,
    knownCity: state.addressDraft?.city,
    method: 'delivery',
    maxCandidates: maxFulfillmentPlanningCandidates,
  });
  const fulfillmentLocationContext = fulfillmentPlanningResult.ok
    ? fulfillmentPlanningResult.value
    : undefined;
  const uniqueLocation = fulfillmentLocationContext?.candidates.length === 1
    ? fulfillmentLocationContext.candidates[0]
    : undefined;
  const menuPlanningResult = await input.clients.menu.getPlanningContext({
    query: state.latestUserMessage,
    activeItemCodes,
    activeItemQuantities: Object.fromEntries((state.cart?.items ?? []).map((item) => [item.itemCode, item.quantity])),
    customerEvidenceItems,
    maxCandidates: maxMenuPlanningCandidates,
    ...(uniqueLocation
      ? { fulfillment: { storeId: uniqueLocation.storeId, disposition: uniqueLocation.method } }
      : {}),
  });
  const menuCatalogContext = menuPlanningResult.ok ? menuPlanningResult.value : undefined;
  const planningProfile: PlanningProfile = state.cart && !state.order
    ? 'active_checkout'
    : !state.cart && !state.order && (menuCatalogContext?.candidates.length ?? 0) > 0
      ? 'catalog_ordering'
      : 'full';
  const availableTools = planningProfile === 'active_checkout'
    ? activeCheckoutPlanningToolNames
    : planningProfile === 'catalog_ordering'
      ? catalogOrderingPlanningToolNames
      : toolNames;
  state.plannerMenuCatalogContext = menuCatalogContext;

  if (menuCatalogContext?.candidates.length) {
    await input.store.appendEvent(input.sessionId, 'menu:planning_context_loaded', {
      query: menuCatalogContext.query,
      candidateCodes: menuCatalogContext.candidates.map((candidate) => candidate.code),
    });
  } else if (!menuPlanningResult.ok) {
    await input.store.appendEvent(input.sessionId, 'menu:planning_context_failed', {
      errorCode: menuPlanningResult.errorCode ?? 'menu_planning_context_unavailable',
      message: menuPlanningResult.message,
    });
  }
  if (fulfillmentLocationContext?.candidates.length) {
    await input.store.appendEvent(input.sessionId, 'fulfillment:planning_context_loaded', {
      serviceAreaIds: fulfillmentLocationContext.candidates.map((candidate) => candidate.serviceAreaId),
      candidateCount: fulfillmentLocationContext.candidates.length,
    });
  } else if (!fulfillmentPlanningResult.ok) {
    await input.store.appendEvent(input.sessionId, 'fulfillment:planning_context_failed', {
      errorCode: fulfillmentPlanningResult.errorCode ?? 'fulfillment_planning_context_unavailable',
      message: fulfillmentPlanningResult.message,
    });
  }
  if (state.cart && !state.order && fulfillmentLocationContext?.candidates.length === 1) {
    activeContextPolicy = mergeContextPolicies(activeContextPolicy, { cart: 'active', fulfillment: 'active' });
  }

  const multiStepEnabled = input.toolPlanner.supportsMultiStep === true;
  const maxIterations = multiStepEnabled ? multiStepPlannerIterations : singleStepPlannerIterations;
  const responseClaims = new Set<PlannerResponseClaim>();
  const confirmsFulfillmentByText = isAffirmativeFulfillmentFollowup(input.text, recentTurns);
  const confirmsOrderByText = isExplicitOrderConfirmationRequest(input.text);
  let priorPlanForReview: ToolPlannerOutput | undefined;
  const plannedDiscoveryCalls: ToolCallRequest[] = [];
  let plannerFallbackText: string | undefined;
  let plannerRequestedClarification = false;

  if (confirmsOrderByText) {
    state.entities = { ...state.entities, orderConfirmed: true };
    state.userConfirmedOrder = true;
    activeContextPolicy = mergeContextPolicies(activeContextPolicy, {
      cart: 'active', fulfillment: 'active', payment: 'active', invoice: 'active',
    });
  }

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const contextPolicyBeforePlan = activeContextPolicy;
    const policyState = buildContextPolicyState({ ...state, toolTrace: [] }, {
      metadata: input.metadata,
      policy: activeContextPolicy,
      preserveCartOrderPaymentContext: false,
      preserveMenuSearchResults: priorPlanForReview !== undefined,
      preservePaymentContext: false,
      preserveHandoff: false,
      preserveToolTrace: false,
      compactMenuSearchResults: true,
    });
    const plannerInput = {
      state: commercePlannerState(policyState),
      availableTools,
      recentTurns: recentTurns.filter((turn) => turn.role === 'user'),
      consentTurns: recentTurns,
      contextInventory: buildToolPlannerContextInventory(state),
      menuCatalogContext,
      fulfillmentLocationContext,
      planningProfile,
      priorPlanForReview,
    };
    const plannerSpan = await turnTrace.startSpan({
      name: 'planner_iteration',
      runType: 'llm',
      inputs: { iteration: iteration + 1, plannerInput },
      metadata: { component: 'ToolPlanner' },
      tags: ['agent-planner'],
    });
    let rawPlan: ToolPlannerOutput | undefined;
    try {
      rawPlan = await planBeforeDeadline(input.toolPlanner, plannerInput, plannerDeadlineAt - Date.now());
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
      const presentedAddressIndex = confirmsFulfillmentByText
        ? presentedSavedAddressIndex(recentTurns, state.customerContext?.savedAddresses ?? [])
        : undefined;
      const recoveryMode: NonNullable<NaturalLanguagePlan['recoveryMode']> =
        confirmsOrderByText && Boolean(state.cart?.items.length && state.fulfillment?.availability.ok && state.address)
          ? 'verified_order_confirmation'
          : confirmsFulfillmentByText && Boolean(state.cart?.items.length && (state.address || presentedAddressIndex !== undefined))
            ? 'verified_fulfillment_confirmation'
            : requestedExactQuantityPlans(menuCatalogContext).length > 0
              ? 'verified_exact_quantity_cart'
              : (menuCatalogContext?.candidates.length ?? 0) > 0
                ? 'verified_menu_catalog'
                : 'deterministic';
      return {
        activeContextPolicy,
        fulfillmentLocationContext,
        menuCatalogContext,
        planningProfile,
        multiStepEnabled,
        toolCalls: [],
        responseClaims: [],
        plannerRequestedClarification: true,
        confirmsFulfillmentByText,
        confirmsOrderByText,
        recoveryMode,
      };
    }

    const asksBeforeCatalogMutation = Boolean(
      rawPlan.catalogSelections?.length &&
      rawPlan.toolCalls.some((call) => call.toolName === 'updateCart') &&
      rawPlan.entities.cartMutationRequested !== true &&
      rawPlan.directResponse?.trim().endsWith('?'),
    );
    if (asksBeforeCatalogMutation) {
      rawPlan = {
        ...rawPlan,
        contextPolicy: {
          ...rawPlan.contextPolicy,
          menuSearchResults: 'active',
          order: 'irrelevant',
          payment: 'irrelevant',
        },
        entities: { ...rawPlan.entities, asksClarification: true },
        toolCalls: rawPlan.toolCalls.filter((call) => call.toolName !== 'updateCart'),
      };
    }

    state.intent = rawPlan.intent;
    state.entities = rawPlan.entities;
    if (
      hasPlannerBooleanEntity(state, 'smallTalk') &&
      rawPlan.directResponse &&
      rawPlan.toolCalls.every((call) => readOnlyDiscoveryTools.has(call.toolName))
    ) {
      rawPlan = {
        ...rawPlan,
        contextPolicy: { ...rawPlan.contextPolicy, menuSearchResults: 'irrelevant' },
        entities: { ...rawPlan.entities, suppressGenUi: true },
        toolCalls: [],
      };
      state.entities = rawPlan.entities;
    }
    applyPlannerSavedAddressDecision(state);
    mergeVerifiedAddressDraft(state, fulfillmentLocationContext);
    const requestedPaymentMethod = plannerPaymentMethod(state);
    if (requestedPaymentMethod && state.paymentAttempt?.method && state.paymentAttempt.method !== requestedPaymentMethod) {
      state.paymentAttempt = undefined;
    }
    if (partialAddressText(state) || (hasIncompleteAddressDraft(state) && !plannerSavedAddressDecision(state))) {
      state.entities = {
        ...state.entities,
        asksClarification: true,
        preferFulfillmentSurface: true,
        suppressSavedAddressCandidate: true,
        useSavedAddress: false,
      };
      state.address = undefined;
      state.fulfillment = undefined;
    }
    if (confirmsOrderByText) {
      state.entities = { ...state.entities, orderConfirmed: true };
      state.userConfirmedOrder = true;
    }
    if (confirmsFulfillmentByText) {
      const savedAddressIndex = presentedSavedAddressIndex(recentTurns, state.customerContext?.savedAddresses ?? []);
      state.entities = {
        ...state.entities,
        fulfillmentAccepted: Boolean(state.address || savedAddressIndex !== undefined),
        useSavedAddress: savedAddressIndex !== undefined,
        ...(savedAddressIndex !== undefined
          ? { savedAddressDecision: { addressIndex: savedAddressIndex, decision: 'accept' as const } }
          : {}),
        orderConfirmed: false,
      };
      applyPlannerSavedAddressDecision(state);
      state.userConfirmedOrder = false;
    }
    if (isDifferentRecipientReorder(state.latestUserMessage)) {
      const reorderSource = state.customerContext?.recentOrders[0] ?? state.order;
      if (reorderSource) {
        state.pendingReorder = { orderId: reorderSource.id, cart: reorderSource.cart };
      }
      state.entities = {
        ...state.entities,
        reorderConfirmed: false,
        asksClarification: true,
        suppressGenUi: true,
      };
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
    if (isLowSignalMessage(state.latestUserMessage) && !isPostOrderTrackingRequest(state.latestUserMessage) && !confirmsFulfillmentByText) {
      state.entities = { ...state.entities, suppressGenUi: true };
    }
    activeContextPolicy = mergeContextPolicies(activeContextPolicy, rawPlan.contextPolicy);
    if (hasPlannerBooleanEntity(state, 'freshShoppingJourney')) {
      activeContextPolicy = {
        cart: 'active',
        menuSearchResults: 'active',
        order: 'irrelevant',
        payment: 'irrelevant',
        fulfillment: 'irrelevant',
        handoff: 'irrelevant',
        recentOrder: 'irrelevant',
      };
    }
    if (isCheckoutSupplementRequest(state.latestUserMessage)) {
      activeContextPolicy = mergeContextPolicies(activeContextPolicy, { cart: 'active', fulfillment: 'active' });
    }
    const preservesCartForCheckoutClarification = Boolean(
      planningProfile === 'active_checkout' &&
      state.cart &&
      rawPlan.intent === 'unclear' &&
      rawPlan.toolCalls.length === 0 &&
      rawPlan.directResponse &&
      !hasPlannerBooleanEntity(state, 'smallTalk') &&
      !isLowSignalMessage(state.latestUserMessage),
    );
    if (preservesCartForCheckoutClarification) {
      state.entities = { ...state.entities, asksClarification: true };
      activeContextPolicy = mergeContextPolicies(activeContextPolicy, { cart: 'active' });
    }
    if (isDeliveryFulfillmentRequest(state.latestUserMessage) || confirmsFulfillmentByText) {
      state.entities = { ...state.entities, fulfillmentMethod: 'delivery', preferFulfillmentSurface: true };
      activeContextPolicy = mergeContextPolicies(activeContextPolicy, {
        cart: 'active', fulfillment: 'active', customer: 'active',
      });
    }
    if (isAddressChangeRequest(state.latestUserMessage)) {
      state.address = undefined;
      state.fulfillment = undefined;
      activeContextPolicy = mergeContextPolicies(activeContextPolicy, { cart: 'active', fulfillment: 'active' });
    }
    if (rawPlan.intent === 'payment' || rawPlan.intent === 'order_status') {
      activeContextPolicy = mergeContextPolicies(activeContextPolicy, { order: 'active', payment: 'active' });
    }
    if (isPostOrderTrackingRequest(state.latestUserMessage) || isOrderCancellationRequest(state.latestUserMessage) || isPaymentFailureRequest(state.latestUserMessage)) {
      activeContextPolicy = mergeContextPolicies(activeContextPolicy, {
        order: 'active',
        payment: 'active',
        ...(isOrderCancellationRequest(state.latestUserMessage) ? { handoff: 'active' as const } : {}),
      });
    }
    if (isHandoffExplanationRequest(state.latestUserMessage)) {
      activeContextPolicy = mergeContextPolicies(activeContextPolicy, { handoff: 'active' });
    }
    if (isDifferentRecipientReorderConfirmation(state.latestUserMessage, recentTurns)) {
      state.entities = { ...state.entities, reorderConfirmed: true, asksClarification: false };
      activeContextPolicy = mergeContextPolicies(activeContextPolicy, { recentOrder: 'active', cart: 'active' });
    }
    if (rawPlan.toolCalls.length === 0 && rawPlan.contextPolicy?.menuSearchResults !== 'irrelevant' && (state.menuSearchResults?.length ?? 0) > 0 && !state.cart && !state.order && !state.handoff) {
      activeContextPolicy = mergeContextPolicies(activeContextPolicy, { menuSearchResults: 'active' });
      state.entities = { ...state.entities, keepMenuSurface: true };
    }
    const hydratedState = await hydrateRecentOrderContext(input, buildVerifiedStateSnapshot(state), activeContextPolicy);
    Object.assign(state, hydratedState);
    applyPlannerSavedAddressDecision(state);
    if (
      (contextPolicyIsActive(activeContextPolicy, 'recentOrder') ||
        contextPolicyRequiresConfirmation(activeContextPolicy, 'recentOrder')) &&
      !hasPlannerBooleanEntity(state, 'reorderConfirmed') &&
      isPreviousOrderReorderRequest(state.latestUserMessage)
    ) {
      state.entities = { ...state.entities, asksClarification: true };
      plannerRequestedClarification = true;
      pushEscalationReasons(state, ['previous_order_confirmation_required']);
    }
    if (hasPlannerBooleanEntity(state, 'asksClarification')) plannerRequestedClarification = true;
    if (hasPlannerBooleanEntity(state, 'orderConfirmed')) state.userConfirmedOrder = true;
    rememberPlannerPaymentMethod(state, rawPlan.toolCalls.some((call) => call.toolName === 'listPaymentMethods'));
    for (const claim of rawPlan.responseClaims) responseClaims.add(claim);
    plannerFallbackText = rawPlan.directResponse ?? plannerFallbackText;

    const needsAddressSourceReview = Boolean(
      multiStepEnabled &&
      iteration + 1 < maxIterations &&
      !state.address &&
      hasIncompleteAddressDraft(state) &&
      !plannerAddressDraft(state) &&
      !plannerSavedAddressDecision(state) &&
      (state.customerContext?.savedAddresses.length ?? 0) > 0 &&
      rawPlan.toolCalls.some((call) => call.toolName === 'updateCart'),
    );
    const needsCatalogClarificationReview = Boolean(
      rawPlan.toolCalls.length === 0 &&
      rawPlan.entities.asksClarification === true &&
      planningProfile === 'catalog_ordering' &&
      (menuCatalogContext?.candidates.length ?? 0) > 0 &&
      iteration + 1 < maxIterations,
    );
    const needsSensitiveContextReview = Boolean(
      multiStepEnabled &&
      iteration + 1 < maxIterations &&
      rawPlan.toolCalls.length > 0 &&
      shouldReplanAfterSensitiveContextActivation({
        before: contextPolicyBeforePlan,
        after: activeContextPolicy,
        toolCalls: rawPlan.toolCalls,
        hasVerifiedCatalogSelections: (rawPlan.catalogSelections?.length ?? 0) > 0,
        contextInventory: plannerInput.contextInventory,
      }),
    );
    const needsVerifiedDiscoveryReview = Boolean(
      multiStepEnabled &&
      iteration + 1 < maxIterations &&
      rawPlan.toolCalls.some((call) => catalogResolutionTools.has(call.toolName)) &&
      (hasPlannerBooleanEntity(state, 'cartMutationRequested') ||
        rawPlan.toolCalls.some((call) => call.toolName === 'updateCart') ||
        isCartAdditionRequest(state.latestUserMessage)),
    );
    if (needsVerifiedDiscoveryReview) {
      const focusedCandidates: MenuPlanningContext['candidates'] = [];
      for (const call of rawPlan.toolCalls) {
        if (call.toolName !== 'searchMenu' || typeof call.arguments.query !== 'string') continue;
        const result = await input.clients.menu.getPlanningContext({
          query: call.arguments.query,
          activeItemCodes,
          activeItemQuantities: Object.fromEntries((state.cart?.items ?? []).map((item) => [item.itemCode, item.quantity])),
          customerEvidenceItems,
          maxCandidates: 4,
          ...(uniqueLocation
            ? { fulfillment: { storeId: uniqueLocation.storeId, disposition: uniqueLocation.method } }
            : {}),
        });
        if (result.ok && result.value) focusedCandidates.push(...result.value.candidates);
      }
      const seenCandidateCodes = new Set<string>();
      const allCandidates = [...focusedCandidates, ...(menuCatalogContext?.candidates ?? [])]
        .filter((candidate) => {
          if (seenCandidateCodes.has(candidate.code)) return false;
          seenCandidateCodes.add(candidate.code);
          return true;
        });
      const verifiedCandidates = allCandidates.flatMap((candidate) =>
        typeof candidate.imageUrl === 'string' && candidate.originalPriceVnd !== undefined
          ? [{
              code: candidate.code,
              itemId: candidate.itemId,
              productCode: candidate.productCode,
              category: candidate.category,
              name: candidate.name,
              description: candidate.description,
              priceVnd: candidate.priceVnd,
              originalPriceVnd: candidate.originalPriceVnd,
              imageUrl: candidate.imageUrl,
              available: candidate.available,
              isCustomize: candidate.isCustomize,
              isQuickCombo: candidate.isQuickCombo,
              hasModifiers: candidate.hasModifiers,
            } satisfies MenuItem]
          : [],
      );
      state.menuSearchResults = verifiedCandidates;
      const focusedCodes = new Set(focusedCandidates.map((candidate) => candidate.code));
      state.plannerMenuSearchResults = [
        ...verifiedCandidates.filter((candidate) => focusedCodes.has(candidate.code)),
        ...verifiedCandidates.filter((candidate) => !focusedCodes.has(candidate.code)),
      ].slice(0, 12);
      plannedDiscoveryCalls.push(...rawPlan.toolCalls.filter((call) => catalogResolutionTools.has(call.toolName)));
    }
    if (needsAddressSourceReview || needsCatalogClarificationReview || needsSensitiveContextReview || needsVerifiedDiscoveryReview) {
      priorPlanForReview = rawPlan;
      plannerRequestedClarification = false;
      plannerFallbackText = undefined;
      continue;
    }

    return {
      activeContextPolicy,
      fulfillmentLocationContext,
      menuCatalogContext,
      planningProfile,
      multiStepEnabled,
      toolCalls: normalizeNewItemCartUpdates(state, [...plannedDiscoveryCalls, ...rawPlan.toolCalls]),
      responseClaims: [...responseClaims],
      plannerFallbackText,
      plannerRequestedClarification,
      confirmsFulfillmentByText,
      confirmsOrderByText,
    };
  }

  return emptyPlan('deterministic');
}

function requireLoadedAgentTurnContext(
  state: AgentTurnGraphState,
  runtime: AgentTurnGraphRuntime,
): LoadedAgentTurnContext {
  if (
    !state.activeContextPolicy ||
    !state.priorVerifiedState ||
    !state.agentState ||
    state.customerTurnCount === undefined ||
    !state.recentTurns
  ) {
    throw new Error('Agent turn graph reached an execution node before context was loaded');
  }
  return {
    input: runtime.input,
    turnTrace: runtime.turnTrace,
    activeContextPolicy: state.activeContextPolicy,
    priorVerifiedState: state.priorVerifiedState,
    state: state.agentState,
    customerTurnCount: state.customerTurnCount,
    recentTurns: state.recentTurns,
    routing: state.routing,
  };
}

function suppressedAgentTurnOutput(state: AgentGraphState): AgentTurnOutput {
  return {
    state,
    responseText: '',
    presentation: textOnlyPresentation('', state.channel),
    replyIntent: 'general_reply',
    suppressed: true,
  };
}

const resolveConfiguredAgentTurnRuntime: AgentTurnGraphRuntimeResolver = (state, config) => {
  const input = config.configurable?.agentTurnInput;
  const turnTrace = config.configurable?.agentTurnTrace;
  if (!input || !turnTrace) {
    throw new Error(
      'Agent turn runtime dependencies are missing. Invoke runAgentTurn or provide a Studio runtime resolver.',
    );
  }
  const typedInput = input as AgentTurnInput;
  if (
    typedInput.sessionId !== state.sessionId ||
    typedInput.customerId !== state.customerId ||
    typedInput.channel !== state.channel ||
    typedInput.text !== state.text
  ) {
    throw new Error('Agent turn graph input does not match the configured runtime input');
  }
  return {
    input: typedInput,
    turnTrace: turnTrace as AgentTraceSpan,
  };
};

export function createAgentTurnStateGraph(
  resolveRuntime: AgentTurnGraphRuntimeResolver = resolveConfiguredAgentTurnRuntime,
) {
  const loadContextNode: typeof AgentTurnGraphStateSchema.Node = async (state, config) => {
    const runtime = await resolveRuntime(state, config);
    const context = await loadAgentTurnContext(runtime.input, runtime.turnTrace);
    return {
      activeContextPolicy: context.activeContextPolicy,
      priorVerifiedState: context.priorVerifiedState,
      agentState: context.state,
      customerTurnCount: context.customerTurnCount,
      recentTurns: context.recentTurns,
      routing: context.routing,
      phase: 'context_loaded',
    };
  };

  const classifyTurnNode: typeof AgentTurnGraphStateSchema.Node = async (state, config) => {
    const runtime = await resolveRuntime(state, config);
    const context = requireLoadedAgentTurnContext(state, runtime);
    const journeyMode: AgentJourneyMode = context.routing?.decision === 'handle_social'
      ? 'social'
      : context.state.order
        ? 'post_order_support'
        : context.state.cart || context.state.address || context.state.fulfillment || context.state.orderPreview
          ? 'active_checkout'
          : 'fresh_shopping';
    return {
      journeyMode,
      // Journey mode is routing evidence, not permission to expose all persisted
      // commerce state. The planner must opt into the slices needed by this turn.
      activeContextPolicy: context.activeContextPolicy,
      phase: 'turn_classified',
    };
  };

  const routeTurnNode: typeof AgentTurnGraphStateSchema.Node = async (state, config) => {
    const runtime = await resolveRuntime(state, config);
    const context = requireLoadedAgentTurnContext(state, runtime);
    if (!(await isRunStillCurrent(context.input))) {
      return {
        route: 'suppressed',
        output: suppressedAgentTurnOutput(context.state),
      };
    }
    return {
      route: context.routing?.decision === 'handle_social'
        ? 'social_response'
        : Boolean(customerCommand(context.input.metadata))
          ? 'structured_action'
          : 'plan_tools',
      phase: 'turn_routed',
    };
  };

  const socialResponseNode: typeof AgentTurnGraphStateSchema.Node = async (state, config) => {
    const runtime = await resolveRuntime(state, config);
    const context = requireLoadedAgentTurnContext(state, runtime);
    context.state.entities = { smallTalk: true, suppressGenUi: true };
    return {
      responseSpec: {
        replyIntent: 'general_reply',
        fallbackText: context.routing?.decision === 'handle_social'
          ? context.routing.responseText
          : 'Mình đang lắng nghe bạn.',
        currentTurnToolTrace: [],
        preferFallbackText: true,
        suppressGenUi: true,
      },
      phase: 'social_response_prepared',
    };
  };

  const structuredActionNode: typeof AgentTurnGraphStateSchema.Node = async (state, config) => {
    const runtime = await resolveRuntime(state, config);
    requireLoadedAgentTurnContext(state, runtime);
    return { phase: 'structured_action_prepared' };
  };

  const planToolsNode: typeof AgentTurnGraphStateSchema.Node = async (state, config) => {
    const runtime = await resolveRuntime(state, config);
    const context = requireLoadedAgentTurnContext(state, runtime);
    return {
      naturalLanguagePlan: await planNaturalLanguageTurn(context),
      phase: 'tools_planned',
    };
  };

  const manageJourneyNode: typeof AgentTurnGraphStateSchema.Node = async (state, config) => {
    const runtime = await resolveRuntime(state, config);
    const context = requireLoadedAgentTurnContext(state, runtime);
    if (state.route === 'plan_tools' && hasPlannerBooleanEntity(context.state, 'freshShoppingJourney')) {
      beginFreshShoppingJourney(context.state);
      return {
        journeyMode: 'fresh_shopping',
        activeContextPolicy: state.naturalLanguagePlan?.activeContextPolicy,
        phase: 'fresh_shopping_journey_started',
      };
    }
    return { phase: 'journey_preserved' };
  };

  const executeToolsNode: typeof AgentTurnGraphStateSchema.Node = async (state, config) => {
    if (state.route === 'structured_action') {
      const runtime = await resolveRuntime(state, config);
      const context = requireLoadedAgentTurnContext(state, runtime);
      const responseSpec =
        await handleStructuredFulfillmentAction(context) ??
        await handleStructuredOrderOrPaymentAction(context) ??
        await handleStructuredCartAction(context);
      if (!responseSpec) throw new Error('Structured action route did not resolve a supported customer command');
      return { responseSpec, phase: 'tools_executed' };
    }
    if (state.route === 'plan_tools') {
      const runtime = await resolveRuntime(state, config);
      const context = requireLoadedAgentTurnContext(state, runtime);
      if (!state.naturalLanguagePlan) throw new Error('Tool execution phase is missing a natural-language plan');
      return {
        responseSpec: await executeNaturalLanguagePlan(context, state.naturalLanguagePlan),
        phase: 'tools_executed',
      };
    }
    if (!state.responseSpec) throw new Error('Tool execution phase is missing a response specification');
    return { phase: 'tools_skipped' };
  };

  const enforceInvariantsNode: typeof AgentTurnGraphStateSchema.Node = async (state, config) => {
    if (!state.responseSpec || !state.agentState) throw new Error('Invariant phase is missing executed turn state');
    if (state.agentState.orderPreview && !state.agentState.address) {
      throw new Error('Order preview invariant violated: confirmed address is missing');
    }
    const runtime = await resolveRuntime(state, config);
    await ensureAbnormalLargeOrderHandoff({
      turnInput: runtime.input,
      turnTrace: runtime.turnTrace,
      state: state.agentState,
      currentTurnToolTrace: state.responseSpec.currentTurnToolTrace,
      plan: state.naturalLanguagePlan,
    });
    clearRecoverableFulfillmentArgumentFailure(state.agentState, state.responseSpec.currentTurnToolTrace);
    const responseClaims = state.naturalLanguagePlan?.responseClaims ?? [];
    const gating = applySafetyGates(
      { ...state.agentState, toolTrace: state.responseSpec.currentTurnToolTrace },
      [],
      { responseClaims },
    );
    if (responseClaims.length > 0 || gating.blockedReasons.length > 0) {
      await tracePolicyDecision(runtime.turnTrace, {
        proposedToolNames: [],
        allowedToolNames: [],
        blockedReasons: gating.blockedReasons,
      });
    }
    pushEscalationReasons(state.agentState, gating.blockedReasons);
    const requiresEscalationResponse = state.agentState.escalationReasons.includes('abnormal_large_order');
    return {
      responseSpec: gating.blockedReasons.length > 0 || requiresEscalationResponse
        ? {
            ...state.responseSpec,
            replyIntent: 'ask_clarification',
            fallbackText: selectSafeFallbackText(state.agentState, state.responseSpec.fallbackText),
            preferFallbackText: true,
          }
        : state.responseSpec,
      phase: 'invariants_enforced',
    };
  };

  const composeResponseNode: typeof AgentTurnGraphStateSchema.Node = async (state, config) => {
    if (!state.responseSpec || !state.agentState) throw new Error('Response phase is missing a response specification');
    const runtime = await resolveRuntime(state, config);
    if (!(await isRunStillCurrent(runtime.input))) {
      return { output: suppressedAgentTurnOutput(state.agentState), phase: 'response_suppressed' };
    }
    let output = await composeAssistantResponse({
      turnInput: runtime.input,
      state: state.agentState,
      replyIntent: state.responseSpec.replyIntent,
      fallbackText: state.responseSpec.fallbackText,
      currentTurnToolTrace: state.responseSpec.currentTurnToolTrace,
      contextPolicy: state.responseSpec.contextPolicy,
      turnTrace: runtime.turnTrace,
      preferFallbackText: state.responseSpec.preferFallbackText,
      suppressGenUi: state.responseSpec.suppressGenUi,
    });
    if (!output.responseText.trim()) {
      const recoveryText = 'Mình chưa xử lý trọn vẹn yêu cầu này. Bạn gửi lại giúp mình nhé.';
      await runtime.input.store.appendEvent(runtime.input.sessionId, 'agent:recovery_response', {
        reason: 'empty_composed_response',
        responseMode: 'deterministic',
      });
      output = {
        ...output,
        responseText: recoveryText,
        presentation: textOnlyPresentation(recoveryText, state.channel),
      };
    }
    return {
      output,
      phase: 'response_composed',
    };
  };

  const persistTurnNode: typeof AgentTurnGraphStateSchema.Node = async (state, config) => {
    if (!state.output) throw new Error('Persistence phase is missing an agent output');
    if (state.output.suppressed) return { phase: 'turn_persisted' };
    const runtime = await resolveRuntime(state, config);
    const currentTurnToolTrace = state.responseSpec?.currentTurnToolTrace ?? [];
    emitDerivedEvents(runtime.input, state.output.state, currentTurnToolTrace);
    await persistVerifiedStateSnapshot(runtime.input.store, state.output.state);
    const turn = await runtime.input.store.appendTurn({
      sessionId: runtime.input.sessionId,
      channel: runtime.input.channel,
      role: 'assistant',
      text: state.output.responseText,
      externalMessageId: null,
      externalUserId: runtime.input.customerId,
      deliveryStatus: 'pending',
      metadata: state.output.presentation.profile === 'genui' && state.output.genUi
        ? { genUi: state.output.genUi }
        : null,
    });
    emitDashboardEvent(runtime.input, 'conversation_turn_created', {
      turnId: turn.id,
      role: turn.role,
      channel: turn.channel,
      deliveryStatus: turn.deliveryStatus,
      externalMessageId: turn.externalMessageId,
      externalUserId: turn.externalUserId,
      text: turn.text,
      metadata: turn.metadata,
    });
    return {
      output: { ...state.output, assistantTurnId: turn.id },
      phase: 'turn_persisted',
    };
  };

  const monitorNode: typeof AgentTurnGraphStateSchema.Node = async (state, config) => {
    if (!state.output) throw new Error('Monitor phase is missing an agent output');
    const runtime = await resolveRuntime(state, config);
    if (!state.output.suppressed) {
      const customerTurnCount = state.customerTurnCount ?? countCustomerTurns(state.recentTurns);
      const intelligenceSpan = await runtime.turnTrace.startSpan({
        name: 'session_intelligence',
        runType: 'chain',
        inputs: { customerTurnCount, state: traceStateSummary(state.output.state) },
        metadata: { component: 'resolveMonitorSessionIntelligence' },
        tags: ['agent-session-intelligence'],
      });
      await emitSessionIntelligence(runtime.input, state.output.state, customerTurnCount);
      await intelligenceSpan.end({
        customerTurnCount,
        escalationReasons: [...state.output.state.escalationReasons],
      });
    }
    return { phase: 'monitor_updated' };
  };

  return new StateGraph({
    state: AgentTurnGraphStateSchema,
    input: AgentTurnGraphInputSchema,
    output: AgentTurnGraphOutputSchema,
  })
    .addNode('load_context', loadContextNode)
    .addNode('classify_turn', classifyTurnNode)
    .addNode('route_turn', routeTurnNode)
    .addNode('social_response', socialResponseNode)
    .addNode('structured_action', structuredActionNode)
    .addNode('plan_tools', planToolsNode)
    .addNode('manage_journey', manageJourneyNode)
    .addNode('execute_tools', executeToolsNode)
    .addNode('enforce_invariants', enforceInvariantsNode)
    .addNode('compose_response', composeResponseNode)
    .addNode('persist_turn', persistTurnNode)
    .addNode('monitor', monitorNode)
    .addEdge(START, 'load_context')
    .addEdge('load_context', 'classify_turn')
    .addEdge('classify_turn', 'route_turn')
    .addConditionalEdges(
      'route_turn',
      (state): AgentTurnGraphRoute => state.route ?? 'plan_tools',
      {
        social_response: 'social_response',
        structured_action: 'structured_action',
        plan_tools: 'plan_tools',
        suppressed: END,
      },
    )
    .addEdge('social_response', 'manage_journey')
    .addEdge('structured_action', 'manage_journey')
    .addEdge('plan_tools', 'manage_journey')
    .addEdge('manage_journey', 'execute_tools')
    .addEdge('execute_tools', 'enforce_invariants')
    .addEdge('enforce_invariants', 'compose_response')
    .addEdge('compose_response', 'persist_turn')
    .addEdge('persist_turn', 'monitor')
    .addEdge('monitor', END)
    .compile();
}

export const agentTurnGraph = createAgentTurnStateGraph();

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
    const graphResult = await agentTurnGraph.invoke(
      {
        sessionId: input.sessionId,
        customerId: input.customerId,
        channel: input.channel,
        text: input.text,
        externalMessageId: input.externalMessageId ?? null,
        metadata: input.metadata ?? null,
      },
      {
        configurable: {
          agentTurnInput: input,
          agentTurnTrace: turnTrace,
        },
      },
    );
    const output = graphResult.output;
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

async function loadAgentTurnContext(
  input: AgentTurnInput,
  turnTrace: AgentTraceSpan,
): Promise<LoadedAgentTurnContext> {
  const routingPromise = routeSmallTalk(input, turnTrace);
  const responseProfile = responseProfileForChannel(input.channel);
  const existingTurnsForProfile = await input.store.listTurns(input.sessionId);
  const conflictingTurn = existingTurnsForProfile.find(
    (turn) => responseProfileForChannel(turn.channel) !== responseProfile,
  );
  if (conflictingTurn) {
    throw new Error(
      `session_response_profile_mismatch:${input.sessionId}:${responseProfileForChannel(conflictingTurn.channel)}:${responseProfile}`,
    );
  }
  const contextSpan = await turnTrace.startSpan({
    name: 'context_load',
    runType: 'chain',
    inputs: { sessionRef: traceSessionReference(input.sessionId) },
  });
  let activeContextPolicy = contextPolicyFromMetadata(input.metadata);
  if (
    isPostOrderTrackingRequest(input.text) ||
    isOrderCancellationRequest(input.text) ||
    isPaymentFailureRequest(input.text)
  ) {
    activeContextPolicy = mergeContextPolicies(activeContextPolicy, {
      order: 'active',
      payment: 'active',
      ...(isOrderCancellationRequest(input.text) ? { handoff: 'active' as const } : {}),
    });
  }
  let priorVerifiedState = await loadPriorVerifiedState(input.store, input.sessionId);
  priorVerifiedState = await hydrateRecentOrderContext(input, priorVerifiedState, activeContextPolicy);
  const hasActiveCheckoutEvidence = Boolean(
    priorVerifiedState.address ||
    priorVerifiedState.addressDraft ||
    priorVerifiedState.fulfillment ||
    priorVerifiedState.orderPreview ||
    priorVerifiedState.paymentMethodEvidence ||
    priorVerifiedState.selectedPaymentMethod ||
    priorVerifiedState.invoiceRequest,
  );
  if (!priorVerifiedState.order && priorVerifiedState.cart && hasActiveCheckoutEvidence) {
    activeContextPolicy = mergeContextPolicies(activeContextPolicy, {
      cart: 'active',
      ...(priorVerifiedState.address || priorVerifiedState.addressDraft || priorVerifiedState.fulfillment
        ? { fulfillment: 'active' as const }
        : {}),
      ...(priorVerifiedState.paymentMethodEvidence || priorVerifiedState.selectedPaymentMethod
        ? { payment: 'active' as const }
        : {}),
      ...(priorVerifiedState.invoiceRequest ? { invoice: 'active' as const } : {}),
    });
  }
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
    addressDraft: priorVerifiedState.addressDraft,
    orderPreview: priorVerifiedState.orderPreview,
    order: priorVerifiedState.order,
    pendingReorder: priorVerifiedState.pendingReorder,
    comboConversionProposal: priorVerifiedState.comboConversionProposal,
    userConfirmedOrder: isCustomerCommand(input.metadata, 'confirm_order'),
    escalationReasons: [],
    retrievedEvidence,
    fulfillment: priorVerifiedState.fulfillment,
    promotionContext: priorVerifiedState.promotionContext,
    contentEvidence: priorVerifiedState.contentEvidence,
    menuSearchResults: priorVerifiedState.menuSearchResults,
    menuModifierOptions: priorVerifiedState.menuModifierOptions,
    customerContext: priorVerifiedState.customerContext,
    paymentAttempt: priorVerifiedState.paymentAttempt,
    selectedPaymentMethod: priorVerifiedState.selectedPaymentMethod,
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
  const routing = await routingPromise;

  return {
    input,
    turnTrace,
    activeContextPolicy,
    priorVerifiedState,
    state,
    customerTurnCount,
    recentTurns,
    routing,
  };
}

function structuredCommerceResponseSpec(input: {
  currentTurnToolTrace: ToolTraceEntry[];
  fallbackText: string;
  replyIntent?: ReplyIntent;
}): TurnResponseSpec {
  return {
    replyIntent: input.replyIntent ?? 'ask_fulfillment_method',
    fallbackText: input.fallbackText,
    currentTurnToolTrace: input.currentTurnToolTrace,
    contextPolicy: {
      cart: 'active',
      fulfillment: 'active',
      customer: 'active',
    },
    preferFallbackText: true,
  };
}

async function handleStructuredOrderOrPaymentAction(
  context: LoadedAgentTurnContext,
): Promise<TurnResponseSpec | undefined> {
  const confirmsOrder = isCustomerCommand(context.input.metadata, 'confirm_order');
  const selectsPayment = isCustomerCommand(context.input.metadata, 'select_payment_method');
  if (!confirmsOrder && !selectsPayment) return undefined;

  const currentTurnToolTrace: ToolTraceEntry[] = [];
  if (confirmsOrder) {
    context.state.userConfirmedOrder = true;
    context.state.entities = {
      ...(isRecord(context.state.entities) ? context.state.entities : {}),
      orderConfirmed: true,
    };
    for (const call of [
      { toolName: 'previewOrder', arguments: {} },
      { toolName: 'placeOrder', arguments: {} },
    ] satisfies ToolCallRequest[]) {
      const gating = applySafetyGates(context.state, [call]);
      pushEscalationReasons(context.state, gating.blockedReasons);
      if (gating.allowedCalls.length === 0) break;
      await executeAndApplyTracedToolCall({
        turnInput: context.input,
        turnTrace: context.turnTrace,
        state: context.state,
        call,
        currentTurnToolTrace,
      });
    }
    return structuredCommerceResponseSpec({
      currentTurnToolTrace,
      fallbackText: context.state.order
        ? `Đã tạo đơn ${context.state.order.id}. Bạn chọn phương thức thanh toán để tiếp tục nhé.`
        : selectSafeFallbackText(context.state, 'Mình chưa thể tạo đơn; bạn kiểm tra lại địa chỉ giao hàng nhé.'),
      replyIntent: context.state.order ? 'order_created' : 'ask_clarification',
    });
  }

  const requestedMethod = paymentMethodFromCustomerCommand(context.input.metadata);
  await executeAndApplyTracedToolCall({
    turnInput: context.input,
    turnTrace: context.turnTrace,
    state: context.state,
    call: {
      toolName: 'listPaymentMethods',
      arguments: requestedMethod ? { query: requestedMethod } : {},
    },
    currentTurnToolTrace,
  });
  const supported = requestedMethod
    ? findPaymentEvidenceForLinkMethod(context.state.paymentMethodEvidence, requestedMethod)?.supported === true
    : false;
  if (requestedMethod) {
    context.state.selectedPaymentMethod = supported ? requestedMethod : undefined;
  }
  if (requestedMethod && supported && context.state.order) {
    context.state.paymentAttempt = undefined;
    await executeAndApplyTracedToolCall({
      turnInput: context.input,
      turnTrace: context.turnTrace,
      state: context.state,
      call: { toolName: 'createPaymentLink', arguments: { method: requestedMethod } },
      currentTurnToolTrace,
    });
  }
  return structuredCommerceResponseSpec({
    currentTurnToolTrace,
    fallbackText: context.state.paymentAttempt?.paymentUrl
      ? `Mình đã tạo liên kết thanh toán ${requestedMethod}: ${context.state.paymentAttempt.paymentUrl}`
      : paymentMethodFallbackText(context.state),
    replyIntent: context.state.paymentAttempt?.status === 'failed' ? 'payment_retry' : 'general_reply',
  });
}

async function handleStructuredFulfillmentAction(
  context: LoadedAgentTurnContext,
): Promise<TurnResponseSpec | undefined> {
  const startsFulfillment = isCustomerCommand(
    context.input.metadata,
    'start_fulfillment',
  );
  const acceptsFulfillment = isCustomerCommand(
    context.input.metadata,
    'accept_fulfillment',
  );
  if (!startsFulfillment && !acceptsFulfillment) return undefined;

  const hydrated = await hydrateRecentOrderContext(
    context.input,
    buildVerifiedStateSnapshot(context.state),
    { customer: 'active', fulfillment: 'active' },
  );
  Object.assign(context.state, hydrated);
  const presentedAddressIndex = acceptsFulfillment
    ? presentedSavedAddressIndex(
        context.recentTurns,
        context.state.customerContext?.savedAddresses ?? [],
      )
    : undefined;
  context.state.entities = {
    ...(isRecord(context.state.entities) ? context.state.entities : {}),
    preferFulfillmentSurface: true,
    fulfillmentAccepted: acceptsFulfillment && Boolean(context.state.address || presentedAddressIndex !== undefined),
    useSavedAddress: acceptsFulfillment && presentedAddressIndex !== undefined,
    ...(presentedAddressIndex !== undefined
      ? { savedAddressDecision: { addressIndex: presentedAddressIndex, decision: 'accept' as const } }
      : {}),
    orderConfirmed: false,
  };
  applyPlannerSavedAddressDecision(context.state);
  context.state.userConfirmedOrder = false;

  const currentTurnToolTrace: ToolTraceEntry[] = [];
  if (acceptsFulfillment) {
    await quoteFulfillmentFromVerifiedAddress({
      turnInput: context.input,
      state: context.state,
      currentTurnToolTrace,
    });
  }

  const candidate = selectedSavedAddressCandidate(context.state);
  const fallbackText = context.state.fulfillment
    ? 'Mình đã xác nhận địa chỉ và kiểm tra giao hàng cho giỏ hiện tại.'
    : candidate
      ? 'Bạn xác nhận dùng địa chỉ đã lưu này hoặc nhập địa chỉ giao hàng khác nhé.'
      : 'Bạn gửi giúp mình địa chỉ giao hàng đầy đủ, gồm quận/huyện và tỉnh/thành phố nhé.';
  return structuredCommerceResponseSpec({
    currentTurnToolTrace,
    fallbackText,
  });
}

async function handleStructuredCartAction(
  context: LoadedAgentTurnContext,
): Promise<TurnResponseSpec | undefined> {
  const { input, state, turnTrace } = context;
  const directCartCall = commandCartUpdateToToolCall(input.metadata);
  const directModifierSelection = structuredModifierSelection(input.metadata);
  const hasDirectModifierSelection = isCustomerCommand(input.metadata, 'modifier_selection');
  const directBatchCalls = commandBatchUpdateToToolCalls(input.metadata);
  const hasDirectBatch = isCustomerCommand(input.metadata, 'cart_batch_update');
  if (!directCartCall && !hasDirectModifierSelection && !hasDirectBatch) return undefined;

  const currentTurnToolTrace: ToolTraceEntry[] = [];
  state.intent = 'cart_edit';
  let acknowledgement: string | undefined;

  if (hasDirectModifierSelection) {
    let verifiedSelection = directModifierSelection
      ? verifiedModifierSelectionToolCall(state, directModifierSelection)
      : undefined;
    if (
      directModifierSelection &&
      (!state.menuModifierOptions || state.menuModifierOptions.itemCode !== directModifierSelection.itemCode)
    ) {
      await executeAndApplyTracedToolCall({
        turnInput: input,
        turnTrace,
        state,
        call: { toolName: 'getModifierOptions', arguments: { code: directModifierSelection.itemCode } },
        currentTurnToolTrace,
      });
      verifiedSelection = verifiedModifierSelectionToolCall(state, directModifierSelection);
    }
    if (!verifiedSelection) {
      pushEscalationReasons(state, ['menu_item_verification_required']);
    } else {
      const gating = applySafetyGates(state, [verifiedSelection.call], { requireVerifiedItemCodes: true });
      await tracePolicyDecision(turnTrace, {
        proposedToolNames: [verifiedSelection.call.toolName],
        allowedToolNames: gating.allowedCalls.map((call) => call.toolName),
        blockedReasons: gating.blockedReasons,
      });
      pushEscalationReasons(state, gating.blockedReasons);
      if (gating.allowedCalls.length > 0) {
        await executeAndApplyTracedToolCall({
          turnInput: input,
          turnTrace,
          state,
          call: verifiedSelection.call,
          currentTurnToolTrace,
        });
      }
      if (hasSuccessfulToolResult(currentTurnToolTrace, ['updateCart'])) {
        acknowledgement = verifiedSelection.acknowledgement;
      }
    }
  } else if (hasDirectBatch) {
    if (!directBatchCalls) {
      pushEscalationReasons(state, ['menu_item_verification_required']);
    } else {
      const gating = applySafetyGates(state, directBatchCalls, { requireVerifiedItemCodes: true });
      pushEscalationReasons(state, gating.blockedReasons);
      if (gating.blockedReasons.length === 0 && gating.allowedCalls.length === directBatchCalls.length) {
        const firstCall = directBatchCalls[0]!;
        if (await ensureCartForTool(input, state, firstCall)) {
          const selections = directBatchCalls.map((call) => ({
            itemCode: call.arguments.itemCode as string,
            quantity: call.arguments.quantity as number,
          }));
          const response = await input.clients.cart.applyChanges(state.cart!, selections);
          applyToolResultToState(input, state, {
            toolName: 'updateCart',
            ok: response.ok,
            value: response.value,
            message: response.message,
            errorCode: response.errorCode,
            provenance: [],
          }, { items: selections }, currentTurnToolTrace);
          if (response.ok) acknowledgement = verifiedMenuBatchAcknowledgement(state.cart, selections);
        }
      }
    }
  } else if (directCartCall) {
    const gating = applySafetyGates(state, [directCartCall], { requireVerifiedItemCodes: true });
    await tracePolicyDecision(turnTrace, {
      proposedToolNames: [directCartCall.toolName],
      allowedToolNames: gating.allowedCalls.map((call) => call.toolName),
      blockedReasons: gating.blockedReasons,
    });
    pushEscalationReasons(state, gating.blockedReasons);
    if (gating.allowedCalls.length > 0 && await ensureCartForTool(input, state, directCartCall)) {
      await executeAndApplyTracedToolCall({
        turnInput: input,
        turnTrace,
        state,
        call: directCartCall,
        currentTurnToolTrace,
      });
    }
  }

  return {
    replyIntent: state.escalationReasons.length > 0 ? 'ask_clarification' : 'general_reply',
    fallbackText: acknowledgement ?? selectSafeFallbackText(state, 'Mình đã cập nhật giỏ hàng.'),
    currentTurnToolTrace,
    preferFallbackText: Boolean(acknowledgement),
  };
}

function projectVerifiedCatalogSuggestion(state: AgentGraphState): void {
  const entities = isRecord(state.entities) ? state.entities : {};
  const suggestion = isRecord(entities.catalogSuggestion) ? entities.catalogSuggestion : undefined;
  const itemCode = typeof suggestion?.itemCode === 'string' ? suggestion.itemCode : undefined;
  const item = itemCode
    ? state.plannerMenuCatalogContext?.candidates.find((candidate) => candidate.code === itemCode)
    : undefined;
  if (!item || item.originalPriceVnd === undefined || typeof item.imageUrl !== 'string') return;
  const verifiedMenuItem: MenuItem = {
    code: item.code,
    itemId: item.itemId,
    productCode: item.productCode,
    category: item.category,
    name: item.name,
    description: item.description,
    priceVnd: item.priceVnd,
    originalPriceVnd: item.originalPriceVnd,
    imageUrl: item.imageUrl,
    available: item.available,
    isCustomize: item.isCustomize,
    isQuickCombo: item.isQuickCombo,
    hasModifiers: item.hasModifiers,
  };
  state.menuSearchResults = [
    verifiedMenuItem,
    ...(state.menuSearchResults ?? []).filter((candidate) => candidate.code !== verifiedMenuItem.code),
  ];
  state.entities = { ...entities, keepMenuSurface: true };
}

function verifiedMenuItemsFromPlanningCandidates(
  candidates: MenuPlanningContext['candidates'],
): MenuItem[] {
  return candidates.flatMap((item) =>
    typeof item.imageUrl === 'string' && item.originalPriceVnd !== undefined
      ? [{
          code: item.code,
          itemId: item.itemId,
          productCode: item.productCode,
          category: item.category,
          name: item.name,
          description: item.description,
          priceVnd: item.priceVnd,
          originalPriceVnd: item.originalPriceVnd,
          imageUrl: item.imageUrl,
          available: item.available,
          isCustomize: item.isCustomize,
          isQuickCombo: item.isQuickCombo,
          hasModifiers: item.hasModifiers,
        } satisfies MenuItem]
      : [],
  );
}

async function recoverNaturalLanguagePlan(
  context: LoadedAgentTurnContext,
  plan: NaturalLanguagePlan,
  currentTurnToolTrace: ToolTraceEntry[],
): Promise<TurnResponseSpec> {
  const { input, state, recentTurns, turnTrace } = context;
  const responseMode = plan.recoveryMode ?? 'deterministic';
  if (responseMode === 'verified_order_confirmation') {
    const invoiceRequest = completeInvoiceRequestFromText(state.latestUserMessage);
    if (invoiceRequest) {
      await executeAndApplyTracedToolCall({
        turnInput: input,
        turnTrace,
        state,
        call: { toolName: 'collectInvoice', arguments: invoiceRequest },
        currentTurnToolTrace,
      });
    }
    await placeConfirmedOrderFromVerifiedState({ turnInput: input, state, currentTurnToolTrace });
    await createPaymentLinkAfterOrderFromRememberedMethod({
      turnInput: input,
      state,
      currentTurnToolTrace,
    });
  } else if (responseMode === 'verified_fulfillment_confirmation') {
    const savedAddressIndex = presentedSavedAddressIndex(
      recentTurns,
      state.customerContext?.savedAddresses ?? [],
    );
    state.intent = 'ordering';
    state.entities = {
      ...(isRecord(state.entities) ? state.entities : {}),
      preferFulfillmentSurface: true,
      fulfillmentAccepted: true,
      useSavedAddress: savedAddressIndex !== undefined,
      ...(savedAddressIndex !== undefined
        ? { savedAddressDecision: { addressIndex: savedAddressIndex, decision: 'accept' as const } }
        : {}),
      orderConfirmed: false,
    };
    applyPlannerSavedAddressDecision(state);
    state.userConfirmedOrder = false;
    if (state.fulfillment) {
      await revalidateCurrentCartAvailability({ turnInput: input, state, currentTurnToolTrace });
    } else {
      await quoteFulfillmentFromVerifiedAddress({ turnInput: input, state, currentTurnToolTrace });
    }
  } else if (responseMode === 'verified_exact_quantity_cart') {
    await recoverExactQuantityCartFromPlanningContext({
      turnInput: input,
      turnTrace,
      state,
      currentTurnToolTrace,
    });
    await refreshEquivalentComboProposal({ turnInput: input, state, currentTurnToolTrace });
  } else if (responseMode === 'verified_menu_catalog') {
    const recovered = await recoverVerifiedMenuResultsFromPlanningContext({
      turnInput: input,
      turnTrace,
      state,
      currentTurnToolTrace,
    });
    if (recovered.length > 0) {
      state.intent = 'ordering';
      state.entities = { keepMenuSurface: true, asksClarification: true };
    }
  }
  await input.store.appendEvent(input.sessionId, 'agent:recovery_response', {
    reason: 'tool_planner_failed_or_timed_out',
    responseMode,
  });
  return {
    replyIntent: responseMode === 'verified_fulfillment_confirmation' ? 'general_reply' : 'ask_clarification',
    fallbackText: selectSafeFallbackText(state),
    currentTurnToolTrace,
    contextPolicy: plan.activeContextPolicy,
    preferFallbackText: responseMode === 'verified_exact_quantity_cart',
  };
}

async function executeNaturalLanguagePlan(
  context: LoadedAgentTurnContext,
  plan: NaturalLanguagePlan,
): Promise<TurnResponseSpec> {
  const { input, state, priorVerifiedState, recentTurns, turnTrace } = context;
  const activeContextPolicy = plan.activeContextPolicy;
  const currentTurnToolTrace: ToolTraceEntry[] = [];
  if (plan.recoveryMode) {
    return recoverNaturalLanguagePlan(context, plan, currentTurnToolTrace);
  }

  if (
    plan.toolCalls.length === 0 &&
    contextPolicyIsActive(activeContextPolicy, 'menuSearchResults') &&
    plan.menuCatalogContext
  ) {
    const currentMenuResults = verifiedMenuItemsFromPlanningCandidates(plan.menuCatalogContext.candidates);
    if (currentMenuResults.length > 0) {
      state.menuSearchResults = currentMenuResults;
      state.plannerMenuSearchResults = currentMenuResults.slice(0, 12);
      state.entities = { ...(isRecord(state.entities) ? state.entities : {}), keepMenuSurface: true };
    }
  }
  projectVerifiedCatalogSuggestion(state);
  const advancesFulfillmentOnly = plan.confirmsFulfillmentByText;
  if (
    state.fulfillment &&
    (hasPlannerBooleanEntity(state, 'fulfillmentAccepted') ||
      hasPlannerBooleanEntity(state, 'orderConfirmed') ||
      plan.toolCalls.some((call) => ['previewOrder', 'placeOrder'].includes(call.toolName)))
  ) {
    await revalidateCurrentCartAvailability({ turnInput: input, state, currentTurnToolTrace });
  }

  await ensureMembershipProfileForActivePolicy({
    turnInput: input,
    state,
    currentTurnToolTrace,
    contextPolicy: activeContextPolicy,
    force: hasMembershipProfileDependentTool(plan.toolCalls),
  });

  const recentOrderItemCodes = new Set(
    state.customerContext?.recentOrders.flatMap((order) => order.cart.items.map((item) => item.itemCode)) ?? [],
  );
  const favoriteItemCodes = new Set(state.customerContext?.favorites.map((item) => item.code) ?? []);
  const activeCartItemCodes = new Set(state.cart?.items.map((item) => item.itemCode) ?? []);
  const atomicUpdateCalls = plan.toolCalls.filter((call) => call.toolName === 'updateCart');
  let atomicUpdatesHandled = false;
  for (const call of plan.toolCalls) {
    if (call.toolName === 'updateCart' && atomicUpdateCalls.length > 1) {
      if (atomicUpdatesHandled) continue;
      atomicUpdatesHandled = true;
      const gatedUpdates = atomicUpdateCalls.map((candidate) => ({
        candidate,
        gating: applySafetyGates(state, [candidate], {
          requireVerifiedItemCodes: plan.multiStepEnabled,
          requireCartMutationConfirmation: contextPolicyRequiresConfirmation(activeContextPolicy, 'cart'),
        }),
      }));
      const blockedReasons = [...new Set(gatedUpdates.flatMap(({ gating }) => gating.blockedReasons))];
      await tracePolicyDecision(turnTrace, {
        proposedToolNames: atomicUpdateCalls.map(() => 'updateCart'),
        allowedToolNames: gatedUpdates.flatMap(({ gating }) => gating.allowedCalls.map(() => 'updateCart')),
        blockedReasons,
        confirmationRequired: contextPolicyRequiresConfirmation(activeContextPolicy, 'cart'),
      });
      pushEscalationReasons(state, blockedReasons);
      if (gatedUpdates.some(({ gating }) => gating.allowedCalls.length === 0)) continue;
      const atomicCall: ToolCallRequest = {
        toolName: 'updateCart',
        arguments: { changes: atomicUpdateCalls.map((candidate) => candidate.arguments) },
      };
      if (await ensureCartForTool(input, state, atomicCall)) {
        await executeAndApplyTracedToolCall({
          turnInput: input,
          turnTrace,
          state,
          call: atomicCall,
          currentTurnToolTrace,
        });
      }
      continue;
    }
    if (
      advancesFulfillmentOnly &&
      ['previewOrder', 'placeOrder', 'createPaymentLink', 'checkPaymentStatus', 'getOrderStatus'].includes(call.toolName)
    ) continue;
    if (call.toolName === 'createPaymentLink') {
      const requestedMethod = plannerPaymentMethod(state);
      const evidence = requestedMethod
        ? findPaymentEvidenceForLinkMethod(state.paymentMethodEvidence, requestedMethod)
        : undefined;
      if (!requestedMethod || call.arguments.method !== requestedMethod || evidence?.supported === false) continue;
    }
    if (call.toolName === 'searchMenu' && isLowSignalMessage(state.latestUserMessage)) continue;
    if (!isStructurallySupportedHandoff(state, call)) continue;
    if ((call.toolName === 'recommendAddOns' || call.toolName === 'previewCart') && !state.cart) continue;
    if (call.toolName === 'updateCart' && state.order && isPostOrderModificationRequest(state.latestUserMessage)) {
      plan.plannerRequestedClarification = true;
      continue;
    }
    if (
      state.escalationReasons.includes('item_unavailable_before_confirmation') &&
      ['quoteFulfillment', 'previewOrder', 'placeOrder'].includes(call.toolName)
    ) continue;
    const targetsProtectedRecentOrderItem =
      call.toolName === 'updateCart' &&
      typeof call.arguments.itemCode === 'string' &&
      recentOrderItemCodes.has(call.arguments.itemCode) &&
      !favoriteItemCodes.has(call.arguments.itemCode) &&
      !activeCartItemCodes.has(call.arguments.itemCode);
    if (
      targetsProtectedRecentOrderItem &&
      !hasPlannerBooleanEntity(state, 'reorderConfirmed') &&
      (contextPolicyIsActive(activeContextPolicy, 'recentOrder') ||
        contextPolicyRequiresConfirmation(activeContextPolicy, 'recentOrder'))
    ) {
      state.entities = { ...(isRecord(state.entities) ? state.entities : {}), asksClarification: true };
      plan.plannerRequestedClarification = true;
      pushEscalationReasons(state, ['previous_order_confirmation_required']);
      continue;
    }
    if (requiresExplicitDestructiveCartConfirmation(state, call)) {
      state.entities = { ...(isRecord(state.entities) ? state.entities : {}), asksClarification: true };
      plan.plannerRequestedClarification = true;
      pushEscalationReasons(state, ['cart_mutation_confirmation_required']);
      await tracePolicyDecision(turnTrace, {
        proposedToolNames: [call.toolName],
        allowedToolNames: [],
        blockedReasons: ['cart_mutation_confirmation_required'],
        confirmationRequired: true,
      });
      continue;
    }
    if (hasSuccessfulCurrentTurnToolCall(currentTurnToolTrace, call)) continue;
    const gating = applySafetyGates(state, [call], {
      requireVerifiedItemCodes: plan.multiStepEnabled,
      requireCartMutationConfirmation: contextPolicyRequiresConfirmation(activeContextPolicy, 'cart'),
    });
    await tracePolicyDecision(turnTrace, {
      proposedToolNames: [call.toolName],
      allowedToolNames: gating.allowedCalls.map((allowedCall) => allowedCall.toolName),
      blockedReasons: gating.blockedReasons,
      confirmationRequired: contextPolicyRequiresConfirmation(activeContextPolicy, 'cart'),
    });
    pushEscalationReasons(state, gating.blockedReasons);
    if (gating.allowedCalls.length === 0 || !(await ensureCartForTool(input, state, call))) continue;
    if (call.toolName === 'placeOrder' && !state.orderPreview) {
      const previewCall: ToolCallRequest = { toolName: 'previewOrder', arguments: {} };
      const previewGating = applySafetyGates(state, [previewCall]);
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
    await executeAndApplyTracedToolCall({
      turnInput: input,
      turnTrace,
      state,
      call,
      currentTurnToolTrace,
    });
  }

  const pureMenuDiscovery =
    currentTurnToolTrace.length === 1 &&
    currentTurnToolTrace.every((entry) => ['searchMenu', 'recommendAddOns'].includes(entry.toolName));
  const verifiedPlanningMenuDiscovery = Boolean(
    (currentTurnToolTrace.length === 0 || pureMenuDiscovery) &&
    hasPlannerBooleanEntity(state, 'asksClarification') &&
    !hasPlannerBooleanEntity(state, 'cartMutationRequested') &&
    plan.menuCatalogContext
  );
  if (pureMenuDiscovery && verifiedPlanningMenuDiscovery && plan.menuCatalogContext) {
    const currentMenuResults = verifiedMenuItemsFromPlanningCandidates(plan.menuCatalogContext.candidates);
    if (currentMenuResults.length > 0) {
      state.menuSearchResults = currentMenuResults;
      state.entities = { ...(isRecord(state.entities) ? state.entities : {}), keepMenuSurface: true };
    }
  }

  state.plannerMenuSearchResults = undefined;
  if (advancesFulfillmentOnly) {
    state.order = undefined;
    state.orderPreview = undefined;
    state.paymentAttempt = undefined;
    state.userConfirmedOrder = false;
    state.entities = { ...(isRecord(state.entities) ? state.entities : {}), orderConfirmed: false };
  }
  if (isCheckoutSupplementRequest(state.latestUserMessage)) {
    state.address ??= priorVerifiedState.address;
    state.fulfillment ??= priorVerifiedState.fulfillment;
  }
  if (!state.fulfillment && shouldUseKnownAddressForFulfillment(state)) {
    await quoteFulfillmentFromVerifiedAddress({ turnInput: input, state, currentTurnToolTrace });
  }
  if (
    isAffirmativeResponse(state.latestUserMessage) &&
    (state.pendingReorder || isDifferentRecipientReorderConfirmation(state.latestUserMessage, recentTurns))
  ) {
    state.entities = {
      ...(isRecord(state.entities) ? state.entities : {}),
      reorderConfirmed: true,
      asksClarification: false,
    };
  }
  await addConfirmedPreviousOrderToCart({
    turnInput: input,
    state,
    currentTurnToolTrace,
    contextPolicy: activeContextPolicy,
  });
  await ensurePostOrderConversationJob({ turnInput: input, state, currentTurnToolTrace });
  await ensurePaymentStatusForCompletionClaim({ turnInput: input, state, currentTurnToolTrace });
  await ensureIngredientSafetyEvidence({ turnInput: input, state, currentTurnToolTrace });
  await ensureMembershipProfileForActivePolicy({
    turnInput: input,
    state,
    currentTurnToolTrace,
    contextPolicy: activeContextPolicy,
  });
  await refreshEquivalentComboProposal({ turnInput: input, state, currentTurnToolTrace });
  if (!hasSuccessfulToolResult(currentTurnToolTrace, ['placeOrder'])) {
    await placeConfirmedOrderFromVerifiedState({ turnInput: input, state, currentTurnToolTrace });
  }
  await createPaymentLinkAfterOrderFromRememberedMethod({ turnInput: input, state, currentTurnToolTrace });
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

  const preferPlannerResponse = Boolean(plan.plannerFallbackText) &&
    state.escalationReasons.length === 0 &&
    !plan.plannerRequestedClarification &&
    currentTurnToolTrace.every((entry) => entry.ok && readOnlyDiscoveryTools.has(entry.toolName));
  const hasComboConversionProposal = Boolean(state.comboConversionProposal) ||
    (isRecord(state.entities) && isRecord(state.entities.comboConversionProposal));
  return {
    contextPolicy: activeContextPolicy,
    replyIntent: state.escalationReasons.length > 0 || plan.plannerRequestedClarification
      ? 'ask_clarification'
      : 'general_reply',
    fallbackText: preferPlannerResponse
      ? plan.plannerFallbackText!
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
          plan.plannerFallbackText,
        ),
    currentTurnToolTrace,
    preferFallbackText: preferPlannerResponse || hasComboConversionProposal || verifiedPlanningMenuDiscovery,
  };
}
