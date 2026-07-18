import { Annotation, type BaseCheckpointSaver, type LangGraphRunnableConfig } from '@langchain/langgraph';
import '@langchain/langgraph/zod';
import { z } from 'zod';
import type {
  ExternalClients,
  IrreversibleConfirmationAuthority,
  IrreversibleConfirmationBinding,
} from '../clients/interfaces.js';
export type { IrreversibleConfirmationBinding } from '../clients/interfaces.js';
import type { CustomerSafeProgressFamily } from '../customerRuns/progressProjection.js';
import type {
  Channel,
  ConversationTurn,
  ConversationTurnMetadata,
  CustomerAccessContext,
} from '../domain/types.js';
import type { WorkflowRoute } from '../domain/workflow.js';
import type { KfcGenUiAttachment } from '../genui/kfcGenUi.js';
import type { ResponseComposer } from '../llm/responseComposer.js';
import type { SmallTalkRouter, SmallTalkRouterOutput } from '../llm/smallTalkRouter.js';
import type { ToolPlanner, ToolPlannerOutput } from '../llm/toolPlanner.js';
import type { WorkflowRouter } from '../llm/workflowRouter.js';
import type { MonitorSessionIntelligenceJudge } from '../monitor/sessionIntelligence.js';
import type {
  FulfillmentPlanningContext,
  MenuPlanningContext,
  ToolCallRequest,
  ToolTraceEntry,
} from '../ordering/types.js';
import type { AgentTraceSpan, AgentTracer } from '../observability/agentTracing.js';
import type { ConversationStore } from '../persistence/memoryStore.js';
import type { ChannelPresentationPlan } from '../presentation/channelPresentation.js';
import type { ResponseProfile } from '../presentation/responseProfile.js';
import type { DashboardEventBus } from '../dashboard/eventBus.js';
import type { ContextPolicyDirective } from './contextPolicy.js';
import type { AgentGraphState } from './state.js';
import type { CustomerCommand } from '../domain/customerCommand.js';

export type ReplyIntent =
  | 'ask_fulfillment_method'
  | 'ask_clarification'
  | 'order_created'
  | 'human_review_required'
  | 'payment_retry'
  | 'general_reply';

export interface AgentTurnInput {
  sessionId: string;
  customerId: string;
  channel: Channel;
  responseProfile?: ResponseProfile;
  text: string;
  accessContext?: CustomerAccessContext;
  clients: ExternalClients;
  store: ConversationStore;
  dashboard: DashboardEventBus;
  externalMessageId?: string | null;
  metadata?: ConversationTurnMetadata | null;
  responseComposer?: ResponseComposer;
  toolPlanner?: ToolPlanner;
  smallTalkRouter?: SmallTalkRouter;
  workflowRouter?: WorkflowRouter;
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
  checkpointer?: BaseCheckpointSaver;
  /** Trusted server-side authority for confirmation bindings. Never populate from request JSON. */
  confirmationAuthority?: IrreversibleConfirmationAuthority;
  confirmationResume?: IrreversibleConfirmationResume;
  /** Internal server-generated identity used to derive the checkpoint namespace. */
  confirmationRequestId?: string;
  /** Internal override for deterministic deadline tests. Production defaults to eight seconds. */
  turnDeadlineMs?: number;
}

export interface IrreversibleConfirmationResume {
  requestId: string;
  approved: boolean;
}

export interface AgentTurnOutput {
  state: AgentGraphState;
  responseText: string;
  presentation: ChannelPresentationPlan;
  replyIntent: ReplyIntent;
  genUi?: KfcGenUiAttachment;
  assistantTurnId?: string;
  suppressed?: boolean;
  status?: 'completed' | 'paused';
  pause?: {
    capability: 'confirm_order';
    requestId: string;
    binding: IrreversibleConfirmationBinding;
  };
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

export type AgentTurnGraphRoute = 'social_response' | 'structured_action' | 'plan_tools' | 'suppressed';
export type AgentJourneyMode = 'fresh_shopping' | 'active_checkout' | 'post_order_support' | 'social';
export type PlanningProfile = 'active_checkout' | 'catalog_ordering' | 'full';
export type PlannerResponseClaim = NonNullable<ToolPlannerOutput['responseClaims']>[number];

export interface TurnResponseSpec {
  fallbackText: string;
  replyIntent: ReplyIntent;
  currentTurnToolTrace: ToolTraceEntry[];
  contextPolicy?: ContextPolicyDirective;
  suppressGenUi?: boolean;
}

export interface NaturalLanguagePlan {
  activeContextPolicy: ContextPolicyDirective;
  fulfillmentLocationContext?: FulfillmentPlanningContext;
  menuCatalogContext?: MenuPlanningContext;
  planningProfile: PlanningProfile;
  multiStepEnabled: boolean;
  toolCalls: ToolCallRequest[];
  catalogSuggestion?: ToolPlannerOutput['catalogSuggestion'];
  catalogSelections?: ToolPlannerOutput['catalogSelections'];
  savedAddressDecision?: ToolPlannerOutput['savedAddressDecision'];
  responseClaims: PlannerResponseClaim[];
  plannerFallbackText?: string;
  plannerRequestedClarification: boolean;
  recoveryMode?: 'verified_menu_catalog' | 'deterministic';
}

export interface StructuredActionPlan {
  command: CustomerCommand;
}

export type VerifiedStateSnapshot = Pick<
  AgentGraphState,
  | 'cart'
  | 'address'
  | 'addressDraft'
  | 'orderPreview'
  | 'order'
  | 'pendingReorder'
  | 'comboConversionProposal'
  | 'pendingCatalogSuggestion'
  | 'cancellationStatusChecked'
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

export interface LoadedAgentTurnContext {
  input: AgentTurnInput;
  turnTrace: AgentTraceSpan;
  activeContextPolicy: ContextPolicyDirective;
  priorVerifiedState: Partial<VerifiedStateSnapshot>;
  state: AgentGraphState;
  customerTurnCount: number;
  recentTurns: ConversationTurn[];
  routing: SmallTalkRouterOutput | undefined;
  workflowRoute: WorkflowRoute | undefined;
}

export const AgentTurnGraphStateSchema = Annotation.Root({
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
  latestUserMessage: Annotation<AgentGraphState['latestUserMessage'] | undefined>(),
  intent: Annotation<AgentGraphState['intent'] | undefined>(),
  cart: Annotation<AgentGraphState['cart']>(),
  address: Annotation<AgentGraphState['address']>(),
  addressDraft: Annotation<AgentGraphState['addressDraft']>(),
  orderPreview: Annotation<AgentGraphState['orderPreview']>(),
  order: Annotation<AgentGraphState['order']>(),
  pendingReorder: Annotation<AgentGraphState['pendingReorder']>(),
  comboConversionProposal: Annotation<AgentGraphState['comboConversionProposal']>(),
  pendingCatalogSuggestion: Annotation<AgentGraphState['pendingCatalogSuggestion']>(),
  cancellationStatusChecked: Annotation<AgentGraphState['cancellationStatusChecked']>(),
  userConfirmedOrder: Annotation<AgentGraphState['userConfirmedOrder'] | undefined>(),
  escalationReasons: Annotation<AgentGraphState['escalationReasons'] | undefined>(),
  retrievedEvidence: Annotation<AgentGraphState['retrievedEvidence'] | undefined>(),
  entities: Annotation<AgentGraphState['entities']>(),
  selectedModifiers: Annotation<AgentGraphState['selectedModifiers']>(),
  fulfillment: Annotation<AgentGraphState['fulfillment']>(),
  promotionContext: Annotation<AgentGraphState['promotionContext']>(),
  contentEvidence: Annotation<AgentGraphState['contentEvidence']>(),
  menuSearchResults: Annotation<AgentGraphState['menuSearchResults']>(),
  plannerMenuSearchResults: Annotation<AgentGraphState['plannerMenuSearchResults']>(),
  plannerMenuCatalogContext: Annotation<AgentGraphState['plannerMenuCatalogContext']>(),
  menuItemDetail: Annotation<AgentGraphState['menuItemDetail']>(),
  menuModifierOptions: Annotation<AgentGraphState['menuModifierOptions']>(),
  promotionOffers: Annotation<AgentGraphState['promotionOffers']>(),
  customerContext: Annotation<AgentGraphState['customerContext']>(),
  paymentAttempt: Annotation<AgentGraphState['paymentAttempt']>(),
  selectedPaymentMethod: Annotation<AgentGraphState['selectedPaymentMethod']>(),
  paymentMethodEvidence: Annotation<AgentGraphState['paymentMethodEvidence']>(),
  invoiceRequest: Annotation<AgentGraphState['invoiceRequest']>(),
  handoff: Annotation<AgentGraphState['handoff']>(),
  toolTrace: Annotation<AgentGraphState['toolTrace']>(),
  customerTurnCount: Annotation<number | undefined>(),
  recentTurns: Annotation<ConversationTurn[] | undefined>(),
  routing: Annotation<SmallTalkRouterOutput | undefined>(),
  workflowRoute: Annotation<WorkflowRoute | undefined>(),
  naturalLanguagePlan: Annotation<NaturalLanguagePlan | undefined>(),
  structuredActionPlan: Annotation<StructuredActionPlan | undefined>(),
  pendingIrreversibleBinding: Annotation<IrreversibleConfirmationBinding | undefined>(),
  confirmationApproved: Annotation<boolean | undefined>(),
  responseSpec: Annotation<TurnResponseSpec | undefined>(),
  output: Annotation<AgentTurnOutput | undefined>(),
});

export type AgentTurnGraphState = typeof AgentTurnGraphStateSchema.State;

export interface AgentTurnGraphRuntime {
  input: AgentTurnInput;
  turnTrace: AgentTraceSpan;
}

export type AgentTurnGraphRuntimeResolver = (
  state: AgentTurnGraphState,
  config: LangGraphRunnableConfig,
) => Promise<AgentTurnGraphRuntime> | AgentTurnGraphRuntime;
