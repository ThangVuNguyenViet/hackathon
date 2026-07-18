import { countCustomerTurns } from '../monitor/sessionIntelligence.js';
import { isSocialWorkflowRoute } from '../domain/workflow.js';
import {
  type AgentTraceSpan
} from '../observability/agentTracing.js';
import { responseProfileForChannel } from '../presentation/responseProfile.js';
import { buildBoundedRecentTurns } from '../session/sessionContext.js';
import {
  type AgentTurnInput,
  type LoadedAgentTurnContext
} from './agentTurnState.js';
import {
  contextPolicyFromMetadata,
  mergeContextPolicies
} from './contextPolicy.js';
import type { AgentGraphState } from './state.js';
import {
  emitDashboardEvent,
  routeSmallTalk,
  routeWorkflow,
  traceSessionReference,
  traceStateSummary
} from './turnSupport.js';
import {
  hydrateRecentOrderContext,
  loadPriorVerifiedState
} from './verifiedState.js';
export async function loadAgentTurnContext(
  input: AgentTurnInput,
  turnTrace: AgentTraceSpan,
): Promise<LoadedAgentTurnContext> {
  const hasStructuredCommand = Boolean(input.metadata?.customerCommand);
  const legacyRoutingPromise = input.workflowRouter || hasStructuredCommand
    ? undefined
    : routeSmallTalk(input, turnTrace);
  const responseProfile = input.responseProfile ?? responseProfileForChannel(input.channel);
  const existingTurnsForProfile = await input.store.listTurns(input.sessionId);
  const conflictingTurn = existingTurnsForProfile.find(
    (turn) => (turn.metadata?.responseProfile ?? responseProfileForChannel(turn.channel)) !== responseProfile,
  );
  if (conflictingTurn) {
    throw new Error(
      `session_response_profile_mismatch:${input.sessionId}:${conflictingTurn.metadata?.responseProfile ?? responseProfileForChannel(conflictingTurn.channel)}:${responseProfile}`,
    );
  }
  const contextSpan = await turnTrace.startSpan({
    name: 'context_load',
    runType: 'chain',
    inputs: { sessionRef: traceSessionReference(input.sessionId) },
  });
  let activeContextPolicy = contextPolicyFromMetadata(input.metadata);
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
  if (priorVerifiedState.handoff) {
    activeContextPolicy = mergeContextPolicies(activeContextPolicy, {
      handoff: 'active',
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
    pendingCatalogSuggestion: priorVerifiedState.pendingCatalogSuggestion,
    cancellationStatusChecked: priorVerifiedState.cancellationStatusChecked,
    userConfirmedOrder: false,
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
  const workflowRoute = hasStructuredCommand
    ? undefined
    : await routeWorkflow(input, state, recentTurns, turnTrace);
  const routing = hasStructuredCommand
    ? { decision: 'continue_to_planner' as const }
    : workflowRoute
      ? isSocialWorkflowRoute(workflowRoute)
        ? { decision: 'handle_social' as const, responseText: '' }
        : { decision: 'continue_to_planner' as const }
      : await legacyRoutingPromise;

  return {
    input,
    turnTrace,
    activeContextPolicy,
    priorVerifiedState,
    state,
    customerTurnCount,
    recentTurns,
    routing,
    workflowRoute,
  };
}
