import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type {
  AgentModelIdentity,
  ConfiguredAgentModelBinding,
} from '../config/agentModelProfile.js';
import type { ExternalClients } from '../clients/interfaces.js';
import type { CustomerSafeProgressFamily } from '../customerRuns/progressProjection.js';
import type { TrustedCustomerActionEnvelope } from '../domain/customerCommand.js';
import type {
  Channel,
  ConversationTurnMetadata,
  CustomerAccessContext,
} from '../domain/types.js';
import type { KfcGenUiAttachment } from '../genui/kfcGenUi.js';
import type { ToolName } from '../ordering/types.js';
import type { AgentTracer } from '../observability/agentTracing.js';
import type { ConversationStore } from '../persistence/memoryStore.js';
import type { RunCommitFence } from '../persistence/contracts.js';
import type { ChannelPresentationPlan } from '../presentation/channelPresentation.js';
import type { ResponseProfile } from '../presentation/responseProfile.js';
import type { DashboardEventBus } from '../dashboard/eventBus.js';
import type { AgentState } from './agentState.js';
import type { GuestCheckoutAuthority } from '../security/guestCheckoutAuthority.js';
import type { AgentTraceContext } from './agentTraceContext.js';
import type {
  AsyncTokenCounter,
  SummarizeConversationExchanges,
} from '../session/conversationContext.js';
import type { LocalToolEvidenceEvent } from './localToolEvidence.js';
import type { RecommendationApplicationService } from '../recommendations/application/service-types.js';

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
  /**
   * Server-issued current-session checkout authority. This is deliberately
   * separate from KFC account access and must never be populated from request
   * JSON, model output, SSE identifiers, or an unsigned channel event.
   */
  guestCheckoutAuthority?: GuestCheckoutAuthority;
  clients: ExternalClients;
  /** Server-owned recommendation authority. Request JSON and model output cannot populate it. */
  recommendations?: RecommendationApplicationService;
  store: ConversationStore;
  dashboard: DashboardEventBus;
  externalMessageId?: string | null;
  metadata?: ConversationTurnMetadata | null;
  /**
   * Server-issued scenario/probe correlation. Public request metadata must
   * never populate this capability.
   */
  traceContext?: AgentTraceContext;
  /**
   * Pack-internal normalized adapter. A loose caller-supplied value is not
   * execution authority and must match `agentModelBinding`.
   */
  agentModel?: BaseChatModel;
  /**
   * Pack-internal normalized identity. A loose caller-supplied value is not
   * execution authority and must match `agentModelBinding`.
   */
  agentModelIdentity?: AgentModelIdentity;
  /**
   * Unforgeable server-created pairing of the validated identity and adapter.
   * Executable pack turns reject its absence before durable transcript work.
   */
  agentModelBinding?: ConfiguredAgentModelBinding;
  /** Provider-neutral, explicit conversation-window policy. */
  conversationContext?: {
    tokenBudget: number;
    countTokens?: AsyncTokenCounter;
    summarize?: SummarizeConversationExchanges;
  };
  /**
   * Server-constructed structured-action authority. This must never be
   * populated from request JSON, persisted turn metadata, or model output.
   */
  trustedCustomerAction?: TrustedCustomerActionEnvelope;
  runGuard?: {
    isCurrent(): Promise<boolean>;
    /**
     * Durable owner token used only by store-level conditional commits.
     * A current-run check is not a substitute for this atomic fence.
     */
    commitFence?: RunCommitFence;
    recordIrreversibleBoundary?(toolName: ToolName): Promise<void>;
  };
  observeRun?: (
    observation:
      | { kind: 'planning' }
      | {
          kind: 'tool';
          protected: boolean;
          irreversible: boolean;
          progressFamily?: CustomerSafeProgressFamily;
        }
      | { kind: 'verified_state' }
      | { kind: 'response_composition' },
  ) => Promise<void>;
  tracer?: AgentTracer;
  /** Schedules best-effort trace delivery outside the product response path. */
  deferTrace?: (task: () => Promise<void>) => void;
  /**
   * Local qualification-only evidence sink. It is deliberately absent from
   * durable state and remote tracing; callers must redact evidence at rest.
   */
  recordLocalToolEvidence?: (
    event: LocalToolEvidenceEvent,
  ) => Promise<void> | void;
}

export interface AgentTurnOutput {
  state: AgentState;
  responseText: string;
  presentation: ChannelPresentationPlan;
  replyIntent: ReplyIntent;
  genUi?: KfcGenUiAttachment;
  assistantTurnId?: string;
  suppressed?: boolean;
  status?: 'completed';
}

export type VerifiedStateSnapshot = Pick<
  AgentState,
  | 'cart'
  | 'address'
  | 'addressDraft'
  | 'orderPreview'
  | 'order'
  | 'cancellationStatusChecked'
  | 'selectedModifiers'
  | 'fulfillment'
  | 'exactCartAvailabilityObservation'
  | 'promotionContext'
  | 'promotionOffers'
  | 'contentEvidence'
  | 'menuSearchResults'
  | 'verifiedCollections'
  | 'activeCollectionKeys'
  | 'activeMenuCollection'
  | 'menuItemDetail'
  | 'menuModifierOptions'
  | 'customerContext'
  | 'pendingSavedAddressRef'
  | 'paymentAttempt'
  | 'selectedPaymentMethod'
  | 'paymentMethodEvidence'
  | 'invoiceRequest'
  | 'handoff'
  | 'recommendationState'
  | 'toolTrace'
>;
