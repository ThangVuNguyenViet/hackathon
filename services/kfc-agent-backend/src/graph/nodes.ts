import {
  END,
  START,
  StateGraph,
  interrupt,
  type BaseCheckpointSaver,
} from '@langchain/langgraph';
import type { CustomerCommand } from '../domain/customerCommand.js';
import type { ConversationTurnMetadata, DashboardEvent } from '../domain/types.js';
import { countCustomerTurns } from '../monitor/sessionIntelligence.js';
import type { AgentTraceSpan } from '../observability/agentTracing.js';
import { applySafetyGates } from '../ordering/safetyGates.js';
import type { ToolTraceEntry } from '../ordering/types.js';
import type { ConversationStore } from '../persistence/memoryStore.js';
import { textOnlyPresentation } from '../presentation/channelPresentation.js';
import {
  AgentTurnGraphInputSchema,
  AgentTurnGraphOutputSchema,
  AgentTurnGraphStateSchema,
  type AgentJourneyMode,
  type AgentTurnGraphRoute,
  type AgentTurnGraphRuntimeResolver,
  type AgentTurnGraphState,
  type AgentTurnInput,
  type AgentTurnOutput,
  type IrreversibleConfirmationBinding,
  type IrreversibleConfirmationResume,
  type LoadedAgentTurnContext,
  type NaturalLanguagePlan,
  type ReplyIntent,
  type StructuredActionPlan,
  type TurnResponseSpec,
  type VerifiedStateSnapshot,
} from './agentTurnState.js';
import type { ContextPolicyDirective } from './contextPolicy.js';
import type { AgentGraphState } from './state.js';

export const graphNodeNames = [
  'load_context',
  'classify_turn',
  'route_turn',
  'social_response',
  'structured_action',
  'plan_tools',
  'manage_journey',
  'prepare_confirmation',
  'confirmation_gate',
  'execute_tools',
  'enforce_invariants',
  'compose_response',
  'persist_turn',
  'monitor',
] as const;

export type AgentTurnNodeOperations = {
  loadContext(input: AgentTurnInput, turnTrace: AgentTraceSpan): Promise<LoadedAgentTurnContext>;
  isRunStillCurrent(input: AgentTurnInput): Promise<boolean>;
  customerCommand(metadata: ConversationTurnMetadata | null | undefined): CustomerCommand | undefined;
  planNaturalLanguageTurn(context: LoadedAgentTurnContext): Promise<NaturalLanguagePlan>;
  applyPlannerSavedAddressDecision(state: AgentGraphState): void;
  hasPlannerBooleanEntity(state: AgentGraphState, key: string): boolean;
  beginFreshShoppingJourney(state: AgentGraphState): void;
  confirmationBinding(
    input: AgentTurnInput,
    state: Pick<AgentGraphState, 'cart' | 'fulfillment' | 'paymentAttempt' | 'selectedPaymentMethod'>,
  ): Promise<IrreversibleConfirmationBinding>;
  loadPriorVerifiedState(store: ConversationStore, sessionId: string): Promise<Partial<VerifiedStateSnapshot>>;
  stateRevision(value: unknown): Promise<string>;
  structuredCommerceResponseSpec(input: {
    currentTurnToolTrace: ToolTraceEntry[];
    replyIntent?: ReplyIntent;
  }): TurnResponseSpec;
  handleStructuredFulfillmentAction(
    context: LoadedAgentTurnContext,
    plan: StructuredActionPlan,
  ): Promise<TurnResponseSpec | undefined>;
  handleStructuredOrderOrPaymentAction(
    context: LoadedAgentTurnContext,
    plan: StructuredActionPlan,
    binding?: IrreversibleConfirmationBinding,
  ): Promise<TurnResponseSpec | undefined>;
  handleStructuredCartAction(
    context: LoadedAgentTurnContext,
    plan: StructuredActionPlan,
  ): Promise<TurnResponseSpec | undefined>;
  executeNaturalLanguagePlan(
    context: LoadedAgentTurnContext,
    plan: NaturalLanguagePlan,
  ): Promise<TurnResponseSpec>;
  clearRecoverableFulfillmentArgumentFailure(state: AgentGraphState, entries: ToolTraceEntry[]): void;
  tracePolicyDecision(
    turnTrace: AgentTraceSpan | undefined,
    input: {
      proposedToolNames: string[];
      allowedToolNames: string[];
      blockedReasons: string[];
      confirmationRequired?: boolean;
    },
  ): Promise<void>;
  pushEscalationReasons(state: AgentGraphState, reasons: string[]): void;
  composeAssistantResponse(input: {
    turnInput: AgentTurnInput;
    state: AgentGraphState;
    fallbackText: string;
    replyIntent: ReplyIntent;
    currentTurnToolTrace: ToolTraceEntry[];
    contextPolicy?: ContextPolicyDirective;
    turnTrace?: AgentTraceSpan;
    suppressGenUi?: boolean;
  }): Promise<AgentTurnOutput>;
  emitDerivedEvents(input: AgentTurnInput, state: AgentGraphState, turnToolTrace: ToolTraceEntry[]): void;
  persistVerifiedStateSnapshot(store: ConversationStore, state: AgentGraphState): Promise<void>;
  emitDashboardEvent(input: AgentTurnInput, type: DashboardEvent['type'], payload: Record<string, unknown>): void;
  traceStateSummary(state: AgentGraphState): Record<string, unknown>;
  emitSessionIntelligence(input: AgentTurnInput, state: AgentGraphState, customerTurnCount: number): Promise<void>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function agentStateFromGraph(state: AgentTurnGraphState): AgentGraphState | undefined {
  if (
    state.latestUserMessage === undefined ||
    state.intent === undefined ||
    state.userConfirmedOrder === undefined ||
    state.escalationReasons === undefined ||
    state.retrievedEvidence === undefined
  ) return undefined;
  return {
    sessionId: state.sessionId,
    customerId: state.customerId,
    channel: state.channel,
    latestUserMessage: state.latestUserMessage,
    recentTurns: state.recentTurns,
    intent: state.intent,
    cart: state.cart,
    address: state.address,
    addressDraft: state.addressDraft,
    orderPreview: state.orderPreview,
    order: state.order,
    pendingReorder: state.pendingReorder,
    comboConversionProposal: state.comboConversionProposal,
    pendingCatalogSuggestion: state.pendingCatalogSuggestion,
    cancellationStatusChecked: state.cancellationStatusChecked,
    userConfirmedOrder: state.userConfirmedOrder,
    escalationReasons: state.escalationReasons,
    retrievedEvidence: state.retrievedEvidence,
    entities: state.entities,
    selectedModifiers: state.selectedModifiers,
    fulfillment: state.fulfillment,
    promotionContext: state.promotionContext,
    contentEvidence: state.contentEvidence,
    menuSearchResults: state.menuSearchResults,
    plannerMenuSearchResults: state.plannerMenuSearchResults,
    plannerMenuCatalogContext: state.plannerMenuCatalogContext,
    menuItemDetail: state.menuItemDetail,
    menuModifierOptions: state.menuModifierOptions,
    promotionOffers: state.promotionOffers,
    customerContext: state.customerContext,
    paymentAttempt: state.paymentAttempt,
    selectedPaymentMethod: state.selectedPaymentMethod,
    paymentMethodEvidence: state.paymentMethodEvidence,
    invoiceRequest: state.invoiceRequest,
    handoff: state.handoff,
    toolTrace: state.toolTrace,
  };
}

function graphChannelsFromAgentState(state: AgentGraphState): Partial<AgentTurnGraphState> {
  return {
    latestUserMessage: state.latestUserMessage,
    recentTurns: state.recentTurns,
    intent: state.intent,
    cart: state.cart,
    address: state.address,
    addressDraft: state.addressDraft,
    orderPreview: state.orderPreview,
    order: state.order,
    pendingReorder: state.pendingReorder,
    comboConversionProposal: state.comboConversionProposal,
    pendingCatalogSuggestion: state.pendingCatalogSuggestion,
    cancellationStatusChecked: state.cancellationStatusChecked,
    userConfirmedOrder: state.userConfirmedOrder,
    escalationReasons: state.escalationReasons,
    retrievedEvidence: state.retrievedEvidence,
    entities: state.entities,
    selectedModifiers: state.selectedModifiers,
    fulfillment: state.fulfillment,
    promotionContext: state.promotionContext,
    contentEvidence: state.contentEvidence,
    menuSearchResults: state.menuSearchResults,
    plannerMenuSearchResults: state.plannerMenuSearchResults,
    plannerMenuCatalogContext: state.plannerMenuCatalogContext,
    menuItemDetail: state.menuItemDetail,
    menuModifierOptions: state.menuModifierOptions,
    promotionOffers: state.promotionOffers,
    customerContext: state.customerContext,
    paymentAttempt: state.paymentAttempt,
    selectedPaymentMethod: state.selectedPaymentMethod,
    paymentMethodEvidence: state.paymentMethodEvidence,
    invoiceRequest: state.invoiceRequest,
    handoff: state.handoff,
    toolTrace: state.toolTrace,
  };
}

function requireLoadedAgentTurnContext(
  state: AgentTurnGraphState,
  input: AgentTurnInput,
  turnTrace: AgentTraceSpan,
): LoadedAgentTurnContext {
  const agentState = agentStateFromGraph(state);
  if (
    !state.activeContextPolicy ||
    !state.priorVerifiedState ||
    !agentState ||
    state.customerTurnCount === undefined ||
    !state.recentTurns
  ) {
    throw new Error('Agent turn graph reached an execution node before context was loaded');
  }
  return {
    input,
    turnTrace,
    activeContextPolicy: state.activeContextPolicy,
    priorVerifiedState: state.priorVerifiedState,
    state: agentState,
    customerTurnCount: state.customerTurnCount,
    recentTurns: state.recentTurns,
    routing: state.routing,
    workflowRoute: state.workflowRoute,
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

export function compileAgentTurnStateGraph(
  resolveRuntime: AgentTurnGraphRuntimeResolver,
  checkpointer: BaseCheckpointSaver,
  operations: AgentTurnNodeOperations,
) {
  const context = async (state: AgentTurnGraphState, config: Parameters<AgentTurnGraphRuntimeResolver>[1]) => {
    const runtime = await resolveRuntime(state, config);
    return { runtime, loaded: requireLoadedAgentTurnContext(state, runtime.input, runtime.turnTrace) };
  };

  const loadContextNode: typeof AgentTurnGraphStateSchema.Node = async (state, config) => {
    const runtime = await resolveRuntime(state, config);
    const loaded = await operations.loadContext(runtime.input, runtime.turnTrace);
    return {
      activeContextPolicy: loaded.activeContextPolicy,
      priorVerifiedState: loaded.priorVerifiedState,
      ...graphChannelsFromAgentState(loaded.state),
      customerTurnCount: loaded.customerTurnCount,
      recentTurns: loaded.recentTurns,
      routing: loaded.routing,
      workflowRoute: loaded.workflowRoute,
      phase: 'context_loaded',
    };
  };

  const classifyTurnNode: typeof AgentTurnGraphStateSchema.Node = async (state, config) => {
    const { loaded } = await context(state, config);
    const journeyMode: AgentJourneyMode = loaded.routing?.decision === 'handle_social'
      ? 'social'
      : loaded.workflowRoute?.primaryWorkflows.includes('post_order_support') || loaded.state.order
        ? 'post_order_support'
        : loaded.workflowRoute?.primaryWorkflows.includes('checkout_payment') ||
            loaded.workflowRoute?.primaryWorkflows.includes('fulfillment') ||
            loaded.state.cart ||
            loaded.state.address ||
            loaded.state.fulfillment ||
            loaded.state.orderPreview
          ? 'active_checkout'
          : 'fresh_shopping';
    return {
      journeyMode,
      activeContextPolicy: loaded.activeContextPolicy,
      phase: 'turn_classified',
    };
  };

  const routeTurnNode: typeof AgentTurnGraphStateSchema.Node = async (state, config) => {
    const { loaded } = await context(state, config);
    if (!(await operations.isRunStillCurrent(loaded.input))) {
      return { route: 'suppressed', output: suppressedAgentTurnOutput(loaded.state) };
    }
    return {
      route: operations.customerCommand(loaded.input.metadata)
        ? 'structured_action'
        : loaded.routing?.decision === 'handle_social'
          ? 'social_response'
          : 'plan_tools',
      phase: 'turn_routed',
    };
  };

  const socialResponseNode: typeof AgentTurnGraphStateSchema.Node = async (state, config) => {
    const { loaded } = await context(state, config);
    loaded.state.entities = { smallTalk: true, suppressGenUi: true };
    return {
      ...graphChannelsFromAgentState(loaded.state),
      responseSpec: {
        replyIntent: 'general_reply',
        fallbackText: loaded.routing?.decision === 'handle_social'
          ? loaded.routing.responseText
          : '',
        currentTurnToolTrace: [],
        suppressGenUi: true,
      },
      phase: 'social_response_prepared',
    };
  };

  const structuredActionNode: typeof AgentTurnGraphStateSchema.Node = async (state, config) => {
    const { loaded } = await context(state, config);
    const command = operations.customerCommand(loaded.input.metadata);
    if (!command) throw new Error('Structured action route is missing a verified customer command');
    return { structuredActionPlan: { command }, phase: 'structured_action_prepared' };
  };

  const planToolsNode: typeof AgentTurnGraphStateSchema.Node = async (state, config) => {
    const { loaded } = await context(state, config);
    const naturalLanguagePlan = await operations.planNaturalLanguageTurn(loaded);
    return {
      ...graphChannelsFromAgentState(loaded.state),
      naturalLanguagePlan,
      phase: 'tools_planned',
    };
  };

  const manageJourneyNode: typeof AgentTurnGraphStateSchema.Node = async (state, config) => {
    const { loaded } = await context(state, config);
    const plan = state.naturalLanguagePlan;
    if (state.route === 'plan_tools' && plan) {
      loaded.state.entities = {
        ...(isRecord(loaded.state.entities) ? loaded.state.entities : {}),
        ...(plan.catalogSuggestion ? { catalogSuggestion: plan.catalogSuggestion } : {}),
        ...(plan.savedAddressDecision ? { savedAddressDecision: plan.savedAddressDecision } : {}),
      };
      operations.applyPlannerSavedAddressDecision(loaded.state);
    }
    if (state.route === 'plan_tools' && operations.hasPlannerBooleanEntity(loaded.state, 'freshShoppingJourney')) {
      operations.beginFreshShoppingJourney(loaded.state);
      return {
        ...graphChannelsFromAgentState(loaded.state),
        journeyMode: 'fresh_shopping',
        activeContextPolicy: plan?.activeContextPolicy,
        phase: 'fresh_shopping_journey_started',
      };
    }
    return { ...graphChannelsFromAgentState(loaded.state), phase: 'journey_preserved' };
  };

  const prepareConfirmationNode: typeof AgentTurnGraphStateSchema.Node = async (state, config) => {
    if (state.route !== 'structured_action' || state.structuredActionPlan?.command.kind !== 'confirm_order') {
      return { confirmationApproved: true, phase: 'confirmation_not_required' };
    }
    const { loaded } = await context(state, config);
    return {
      pendingIrreversibleBinding: await operations.confirmationBinding(loaded.input, loaded.state),
      confirmationApproved: undefined,
      phase: 'confirmation_prepared',
    };
  };

  const confirmationGateNode: typeof AgentTurnGraphStateSchema.Node = async (state, config) => {
    const binding = state.pendingIrreversibleBinding;
    if (!binding) return { confirmationApproved: true, phase: 'confirmation_not_required' };
    const { loaded } = await context(state, config);
    const resumed = interrupt<{
      binding: IrreversibleConfirmationBinding;
      state: AgentGraphState;
    }, IrreversibleConfirmationResume>({ binding, state: loaded.state });
    if (!isRecord(resumed) || resumed.requestId !== binding.requestId || typeof resumed.approved !== 'boolean') {
      throw new Error('Invalid confirmation resume payload');
    }
    if (!resumed.approved) {
      return {
        confirmationApproved: false,
        responseSpec: operations.structuredCommerceResponseSpec({
          currentTurnToolTrace: [],
          replyIntent: 'general_reply',
        }),
        phase: 'confirmation_rejected',
      };
    }

    const latest = await operations.loadPriorVerifiedState(loaded.input.store, loaded.input.sessionId);
    const currentRevisions = {
      cartRevision: await operations.stateRevision(latest.cart),
      fulfillmentRevision: await operations.stateRevision(latest.fulfillment),
      paymentRevision: await operations.stateRevision({
        paymentAttempt: latest.paymentAttempt,
        selectedPaymentMethod: latest.selectedPaymentMethod,
      }),
    };
    const authority = loaded.input.confirmationAuthority ?? loaded.input.clients.confirmationAuthority;
    const stateIsCurrent = currentRevisions.cartRevision === binding.cartRevision &&
      currentRevisions.fulfillmentRevision === binding.fulfillmentRevision &&
      currentRevisions.paymentRevision === binding.paymentRevision;
    const authorityIsCurrent = authority?.environment === binding.environment &&
      authority.scenarioId === binding.scenarioId &&
      authority.catalogObservationId === binding.catalogObservationId &&
      authority.catalogObservationHash === binding.catalogObservationHash &&
      authority.providerRevision === binding.providerRevision;
    let provider: { ok: boolean; reason?: string; } | undefined;
    if (authorityIsCurrent) {
      try {
        provider = await authority.revalidate(binding);
      } catch (error) {
        provider = {
          ok: false,
          reason: `Commerce binding revalidation failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }
    if (!stateIsCurrent || !provider?.ok) {
      return {
        confirmationApproved: false,
        responseSpec: operations.structuredCommerceResponseSpec({
          currentTurnToolTrace: [],
          replyIntent: 'ask_clarification',
        }),
        phase: 'confirmation_stale',
      };
    }
    return { confirmationApproved: true, phase: 'confirmation_approved' };
  };

  const executeToolsNode: typeof AgentTurnGraphStateSchema.Node = async (state, config) => {
    if (state.route === 'structured_action') {
      const { loaded } = await context(state, config);
      if (!state.structuredActionPlan) throw new Error('Structured action execution is missing its typed plan');
      const responseSpec =
        await operations.handleStructuredFulfillmentAction(loaded, state.structuredActionPlan) ??
        await operations.handleStructuredOrderOrPaymentAction(
          loaded,
          state.structuredActionPlan,
          state.pendingIrreversibleBinding,
        ) ??
        await operations.handleStructuredCartAction(loaded, state.structuredActionPlan);
      if (!responseSpec) throw new Error('Structured action route did not resolve a supported customer command');
      return { ...graphChannelsFromAgentState(loaded.state), responseSpec, phase: 'tools_executed' };
    }
    if (state.route === 'plan_tools') {
      const { loaded } = await context(state, config);
      if (!state.naturalLanguagePlan) throw new Error('Tool execution phase is missing a natural-language plan');
      const responseSpec = await operations.executeNaturalLanguagePlan(loaded, state.naturalLanguagePlan);
      return { ...graphChannelsFromAgentState(loaded.state), responseSpec, phase: 'tools_executed' };
    }
    if (!state.responseSpec) throw new Error('Tool execution phase is missing a response specification');
    return { phase: 'tools_skipped' };
  };

  const enforceInvariantsNode: typeof AgentTurnGraphStateSchema.Node = async (state, config) => {
    const agentState = agentStateFromGraph(state);
    if (!state.responseSpec || !agentState) throw new Error('Invariant phase is missing executed turn state');
    if (agentState.orderPreview && !agentState.address) {
      throw new Error('Order preview invariant violated: confirmed address is missing');
    }
    const runtime = await resolveRuntime(state, config);
    operations.clearRecoverableFulfillmentArgumentFailure(agentState, state.responseSpec.currentTurnToolTrace);
    const responseClaims = state.naturalLanguagePlan?.responseClaims ?? [];
    const gating = applySafetyGates(
      { ...agentState, toolTrace: state.responseSpec.currentTurnToolTrace },
      [],
      { responseClaims },
    );
    if (responseClaims.length > 0 || gating.blockedReasons.length > 0) {
      await operations.tracePolicyDecision(runtime.turnTrace, {
        proposedToolNames: [],
        allowedToolNames: [],
        blockedReasons: gating.blockedReasons,
      });
    }
    operations.pushEscalationReasons(agentState, gating.blockedReasons);
    const requiresEscalationResponse = agentState.escalationReasons.includes('abnormal_large_order');
    return {
      ...graphChannelsFromAgentState(agentState),
      responseSpec: gating.blockedReasons.length > 0 || requiresEscalationResponse
        ? {
          ...state.responseSpec,
          replyIntent: 'ask_clarification',
          fallbackText: state.responseSpec.fallbackText,
        }
        : state.responseSpec,
      phase: 'invariants_enforced',
    };
  };

  const composeResponseNode: typeof AgentTurnGraphStateSchema.Node = async (state, config) => {
    const agentState = agentStateFromGraph(state);
    if (!state.responseSpec || !agentState) throw new Error('Response phase is missing a response specification');
    const runtime = await resolveRuntime(state, config);
    if (!(await operations.isRunStillCurrent(runtime.input))) {
      return { output: suppressedAgentTurnOutput(agentState), phase: 'response_suppressed' };
    }
    const output = await operations.composeAssistantResponse({
      turnInput: runtime.input,
      state: agentState,
      replyIntent: state.responseSpec.replyIntent,
      fallbackText: state.responseSpec.fallbackText,
      currentTurnToolTrace: state.responseSpec.currentTurnToolTrace,
      contextPolicy: state.responseSpec.contextPolicy,
      turnTrace: runtime.turnTrace,
      suppressGenUi: state.responseSpec.suppressGenUi,
    });
    return { output, phase: 'response_composed' };
  };

  const persistTurnNode: typeof AgentTurnGraphStateSchema.Node = async (state, config) => {
    if (!state.output) throw new Error('Persistence phase is missing an agent output');
    if (state.output.suppressed) return { phase: 'turn_persisted' };
    const runtime = await resolveRuntime(state, config);
    const currentTurnToolTrace = state.responseSpec?.currentTurnToolTrace ?? [];
    operations.emitDerivedEvents(runtime.input, state.output.state, currentTurnToolTrace);
    await operations.persistVerifiedStateSnapshot(runtime.input.store, state.output.state);
    const assistantMetadata = {
      ...(runtime.input.metadata?.release ? { release: runtime.input.metadata.release } : {}),
      ...(runtime.input.responseProfile ? { responseProfile: runtime.input.responseProfile } : {}),
      ...(state.output.presentation.profile === 'genui' && state.output.genUi
        ? { genUi: state.output.genUi }
        : {}),
    };
    const turn = await runtime.input.store.appendTurn({
      sessionId: runtime.input.sessionId,
      channel: runtime.input.channel,
      role: 'assistant',
      text: state.output.responseText,
      externalMessageId: null,
      externalUserId: runtime.input.customerId,
      deliveryStatus: 'pending',
      metadata: Object.keys(assistantMetadata).length > 0 ? assistantMetadata : null,
    });
    operations.emitDashboardEvent(runtime.input, 'conversation_turn_created', {
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
        inputs: { customerTurnCount, state: operations.traceStateSummary(state.output.state) },
        metadata: { component: 'resolveMonitorSessionIntelligence' },
        tags: ['agent-session-intelligence'],
      });
      await operations.emitSessionIntelligence(runtime.input, state.output.state, customerTurnCount);
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
    .addNode('prepare_confirmation', prepareConfirmationNode)
    .addNode('confirmation_gate', confirmationGateNode)
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
    .addEdge('manage_journey', 'prepare_confirmation')
    .addEdge('prepare_confirmation', 'confirmation_gate')
    .addConditionalEdges(
      'confirmation_gate',
      (state) => state.confirmationApproved === false ? 'rejected' : 'approved',
      { rejected: 'enforce_invariants', approved: 'execute_tools' },
    )
    .addEdge('execute_tools', 'enforce_invariants')
    .addEdge('enforce_invariants', 'compose_response')
    .addEdge('compose_response', 'persist_turn')
    .addEdge('persist_turn', 'monitor')
    .addEdge('monitor', END)
    .compile({ checkpointer });
}
