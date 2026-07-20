import type { BaseCheckpointSaver } from '@langchain/langgraph';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type {
  ExternalCallContext,
  ExternalClients,
  IrreversibleConfirmationAuthority,
  IrreversibleConfirmationBinding,
} from '../clients/interfaces.js';
export type { IrreversibleConfirmationBinding } from '../clients/interfaces.js';
import type { CustomerSafeProgressFamily } from '../customerRuns/progressProjection.js';
import type { TrustedCustomerActionEnvelope } from '../domain/customerCommand.js';
import type {
  Channel,
  ConversationTurnMetadata,
  CustomerAccessContext,
} from '../domain/types.js';
import type { KfcGenUiAttachment } from '../genui/kfcGenUi.js';
import type {
  CommerceApprovalReceipt,
  ToolCallRequest,
  ToolName,
  VerifiedGuestApprovalResumeAuthority,
} from '../ordering/types.js';
import type {
  CommerceApprovalExecutionFence,
} from '../ordering/approvalExecutionFence.js';
import type { AgentTracer } from '../observability/agentTracing.js';
import type { ConversationStore } from '../persistence/memoryStore.js';
import type { RunCommitFence } from '../persistence/contracts.js';
import type { ChannelPresentationPlan } from '../presentation/channelPresentation.js';
import type { ResponseProfile } from '../presentation/responseProfile.js';
import type { DashboardEventBus } from '../dashboard/eventBus.js';
import type { AgentGraphState } from './state.js';
import type {
  GuestCheckoutAuthority,
} from '../security/guestCheckoutAuthority.js';
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
  /**
   * Opaque server-owned identity for one LangGraph checkpoint run. It is
   * deliberately distinct from provider/external message correlation.
   */
  checkpointRunId?: string;
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
  /** Legacy graph-only continuation. The maintained agent runtime rejects it. */
  approved: boolean;
  /**
   * Exact server-owned action loaded from the durable confirmation pause.
   * This transient value rehydrates untracked graph state and must never come
   * from public request JSON or a LangGraph checkpoint.
   */
  action?: ToolCallRequest;
  /**
   * Exact server-owned checkpoint captured with the durable confirmation
   * pause. The maintained runner rejects resume attempts without this tuple;
   * it must never rediscover a resume target by listing the latest checkpoint.
   */
  checkpoint?: {
    threadId: string;
    namespace: string;
    checkpointId: string;
  };
  /** Signed server receipt for the exact current commerce approval binding. */
  commerceReceipt?: CommerceApprovalReceipt;
  /** Durable operation lease already claimed by the resume coordinator. */
  executionFence?: CommerceApprovalExecutionFence;
  /**
   * Opaque projection returned only after the public guest capability matched
   * the exact persisted pause. It is transient and never checkpointed.
   */
  verifiedGuestAuthority?: VerifiedGuestApprovalResumeAuthority;
  /** Server-only receipt verification secret; never serialize or checkpoint. */
  signingSecret?: string | Uint8Array;
  /** One shared deadline/signal created by the durable resume coordinator. */
  externalCallContext?: ExternalCallContext;
  /** Coordinator-owned abort control for the shared resume signal. */
  abortExternalCalls?: (reason: unknown) => void;
  /**
   * Temporary #49/#51 integration receipt. The maintained runtime accepts it
   * only from trusted server input; the public route fails closed until #51
   * supplies the authenticated principal and final receipt contract.
   */
  receipt?: AgentApprovalReceipt;
}

export interface AgentApprovalBinding {
  requestId: string;
  sessionId: string;
  customerId: string;
  channel: Channel;
  capability: ToolName;
  actionDigest: string;
  verifiedStateRevision: string;
  providerBinding: IrreversibleConfirmationBinding;
  providerRevision: string;
  expiresAt: string;
}

export interface AgentApprovalReceipt extends AgentApprovalBinding {
  principalId: string;
  decision: 'approve' | 'reject';
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
    capability: 'confirm_order' | ToolName;
    requestId: string;
    binding?: IrreversibleConfirmationBinding;
    action?: ToolCallRequest;
    approvalBinding?: AgentApprovalBinding;
  };
}

export type VerifiedStateSnapshot = Pick<
  AgentGraphState,
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
