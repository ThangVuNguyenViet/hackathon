import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
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
  store: ConversationStore;
  dashboard: DashboardEventBus;
  externalMessageId?: string | null;
  metadata?: ConversationTurnMetadata | null;
  /**
   * Server-issued scenario/probe correlation. Public request metadata must
   * never populate this capability.
   */
  traceContext?: AgentTraceContext;
  /** Maintained provider adapter used by the single production agent loop. */
  agentModel?: BaseChatModel;
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
  /**
   * Internal override for deterministic deadline tests. Production defaults
   * to the canonical ten-second turn ceiling; the latency gate separately
   * requires the production p95 to remain below eight seconds.
   */
  turnDeadlineMs?: number;
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
  | 'commerceApprovalReceipts'
  | 'menuItemDetail'
  | 'menuModifierOptions'
  | 'customerContext'
  | 'pendingSavedAddressRef'
  | 'paymentAttempt'
  | 'selectedPaymentMethod'
  | 'paymentMethodEvidence'
  | 'invoiceRequest'
  | 'handoff'
  | 'toolTrace'
>;
