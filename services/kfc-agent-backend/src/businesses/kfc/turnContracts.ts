import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type {
  ExternalCallContext,
  ExternalClients,
} from '../../clients/interfaces.js';
import type { CustomerSafeProgressFamily } from '../../customerRuns/progressProjection.js';
import type { DashboardEventBus } from '../../dashboard/eventBus.js';
import type { TrustedCustomerActionEnvelope } from '../../domain/customerCommand.js';
import type {
  Channel,
  ConversationTurnMetadata,
  CustomerAccessContext,
} from '../../domain/types.js';
import type { KfcGenUiAttachment } from '../../genui/kfcGenUi.js';
import type { AgentGraphState } from '../../graph/state.js';
import type { AgentTraceContext } from '../../graph/agentTraceContext.js';
import type { CommerceApprovalExecutionFence } from '../../ordering/approvalExecutionFence.js';
import type {
  CommerceApprovalReceipt,
  ToolCallRequest,
  ToolName,
  VerifiedGuestApprovalResumeAuthority,
} from '../../ordering/types.js';
import type { AgentTracer } from '../../observability/agentTracing.js';
import type {
  ConversationStore,
  RunCommitFence,
} from '../../persistence/contracts.js';
import type { ChannelPresentationPlan } from '../../presentation/channelPresentation.js';
import type { ResponseProfile } from '../../presentation/responseProfile.js';
import type { GuestCheckoutAuthority } from '../../security/guestCheckoutAuthority.js';
import type { TinyFishClient } from '../../web/tinyFishClient.js';

export type ReplyIntent =
  | 'ask_fulfillment_method'
  | 'ask_clarification'
  | 'order_created'
  | 'human_review_required'
  | 'payment_retry'
  | 'general_reply';

export interface IrreversibleConfirmationResume {
  requestId: string;
  approved: boolean;
  action?: ToolCallRequest;
  commerceReceipt?: CommerceApprovalReceipt;
  executionFence?: CommerceApprovalExecutionFence;
  verifiedGuestAuthority?: VerifiedGuestApprovalResumeAuthority;
  signingSecret?: string | Uint8Array;
  externalCallContext?: ExternalCallContext;
  abortExternalCalls?: (reason: unknown) => void;
}

/** KFC application authority; it deliberately contains no framework session or checkpoint state. */
export interface AgentTurnInput {
  sessionId: string;
  customerId: string;
  channel: Channel;
  responseProfile?: ResponseProfile;
  text: string;
  accessContext?: CustomerAccessContext;
  guestCheckoutAuthority?: GuestCheckoutAuthority;
  clients: ExternalClients;
  store: ConversationStore;
  dashboard: DashboardEventBus;
  externalMessageId?: string | null;
  metadata?: ConversationTurnMetadata | null;
  traceContext?: AgentTraceContext;
  agentModel?: BaseChatModel;
  webEvidenceClient?: TinyFishClient;
  webEvidenceNow?: () => number;
  trustedCustomerAction?: TrustedCustomerActionEnvelope;
  runGuard?: {
    isCurrent(): Promise<boolean>;
    commitFence?: RunCommitFence;
    recordIrreversibleBoundary?(
      toolName: ToolCallRequest['toolName'],
    ): Promise<void>;
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
  confirmationResume?: IrreversibleConfirmationResume;
  confirmationRequestId?: string;
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
  status?: 'completed' | 'paused';
  pause?: {
    capability: 'confirm_order' | ToolName;
    requestId: string;
    action?: ToolCallRequest;
  };
}

export type VerifiedStateSnapshot = Pick<
  AgentGraphState,
  | 'cart'
  | 'address'
  | 'addressDraft'
  | 'deliveryAddressDraft'
  | 'deliveryAddressStatus'
  | 'deliveryAddressMissingFields'
  | 'deliveryAdministrativeOptions'
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
