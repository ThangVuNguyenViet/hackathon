import type {
  Address,
  Cart,
  Channel,
  ConversationTurn,
  MenuItem,
  Order,
} from '../domain/types.js';
import type { SelectedPaymentMethodAuthority } from '../domain/opaqueProviderId.js';
import type { DeliveryAddressUpdate } from '../domain/customerCommand.js';
import type { VerifiedRef } from '../domain/verifiedRef.js';
import type {
  GeneratedMenuModifier,
  GeneratedPaymentMethod,
  GeneratedPromotionVoucherOffer,
} from '../fixtures/schema.js';
import type {
  ContentEvidence,
  CustomerContext,
  FulfillmentState,
  HandoffState,
  InvoiceRequest,
  PaymentAttempt,
  PromotionContext,
  SelectedModifier,
  CollectionToolName,
  ToolTraceEntry,
  VerifiedCollectionSnapshot,
  VerifiedCollectionStore,
} from '../ordering/types.js';
import type { ExactCartAvailabilityObservationV2 } from '../ordering/exactCartAvailabilityAuthority.js';
import type { RecommendationState } from '../recommendations/domain/contracts.js';
import type { ProductOrderFlowBinding } from '../recommendations/application/product-order-flow.js';

export interface RetrievedEvidence {
  eventId: string;
  timestamp: string;
  sourceType: string;
  confidence: number;
  payload: Record<string, unknown>;
}

export interface TrustedPresentationDirective {
  preferredSurface?: 'cart' | 'fulfillment';
  fulfillmentAccepted?: boolean;
}

export interface AgentState {
  sessionId: string;
  customerId: string;
  channel: Channel;
  latestUserMessage: string;
  recentTurns?: ConversationTurn[];
  cart?: Cart;
  address?: Address;
  /** Customer-provided partial fields plus canonical location fields verified by the fulfillment API. */
  addressDraft?: Partial<Address>;
  /** Turn-local structured address entered through the GenUI form. */
  deliveryAddressDraft?: DeliveryAddressUpdate;
  orderPreview?: Order;
  order?: Order;
  /** Durable proof that submitted-order status was checked for a cancellation request. */
  cancellationStatusChecked?: boolean;
  escalationReasons: string[];
  retrievedEvidence: RetrievedEvidence[];
  /** Turn-local UI navigation issued by a verified structured customer action. */
  trustedPresentation?: TrustedPresentationDirective;
  selectedModifiers?: Record<string, SelectedModifier[]>;
  fulfillment?: FulfillmentState;
  /** Exact cart/store/disposition inventory observation for protected checkout. */
  exactCartAvailabilityObservation?: ExactCartAvailabilityObservationV2;
  promotionContext?: PromotionContext;
  contentEvidence?: ContentEvidence[];
  menuSearchResults?: MenuItem[];
  /** Complete, scope-keyed provider snapshots. A new result replaces only its exact key. */
  verifiedCollections?: VerifiedCollectionStore;
  /** Current authoritative result key per collection tool. Historical scopes are never mutation authority. */
  activeCollectionKeys?: Partial<Record<CollectionToolName, string>>;
  /** Current menu result selected by the agent tool call; presentation must not truncate it. */
  activeMenuCollection?: VerifiedCollectionSnapshot<MenuItem>;
  menuItemDetail?: MenuItem;
  menuModifierOptions?: GeneratedMenuModifier;
  promotionOffers?: GeneratedPromotionVoucherOffer[];
  customerContext?: CustomerContext;
  /**
   * Opaque one-shot candidate selected from an authenticated saved-address
   * read. The raw address remains only in the server verified-ref store.
   */
  pendingSavedAddressRef?: VerifiedRef;
  paymentAttempt?: PaymentAttempt;
  /** Exact method and collection/provider revision selected by the customer. */
  selectedPaymentMethod?: SelectedPaymentMethodAuthority;
  paymentMethodEvidence?: GeneratedPaymentMethod[];
  invoiceRequest?: InvoiceRequest;
  handoff?: HandoffState;
  /** Pack-owned durable progression for recommendation decisions. */
  recommendationState?: RecommendationState;
  /** Server-owned durable identity for one product ordering journey. */
  productOrderFlow?: ProductOrderFlowBinding;
  toolTrace?: ToolTraceEntry[];
}
