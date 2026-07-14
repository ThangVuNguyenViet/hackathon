import type { Address, Cart, Channel, ConversationTurn, Intent, MenuItem, Order } from '../domain/types.js';
import type { GeneratedMenuModifier, GeneratedPaymentMethod, GeneratedPromotionVoucherOffer } from '../fixtures/schema.js';
import type {
  AgentEntities,
  ContentEvidence,
  CustomerContext,
  FulfillmentState,
  HandoffState,
  InvoiceRequest,
  PaymentAttempt,
  PaymentLinkMethod,
  PromotionContext,
  MenuPlanningContext,
  SelectedModifier,
  ToolTraceEntry,
} from '../ordering/types.js';

export interface RetrievedEvidence {
  eventId: string;
  timestamp: string;
  sourceType: string;
  confidence: number;
  payload: Record<string, unknown>;
}

export interface AgentGraphState {
  sessionId: string;
  customerId: string;
  channel: Channel;
  latestUserMessage: string;
  recentTurns?: ConversationTurn[];
  intent: Intent;
  cart?: Cart;
  address?: Address;
  /** Customer-provided partial fields plus canonical location fields verified by the fulfillment API. */
  addressDraft?: Partial<Address>;
  orderPreview?: Order;
  order?: Order;
  /** Verified previous-order cart awaiting explicit reorder confirmation. */
  pendingReorder?: {
    orderId: string;
    cart: Cart;
  };
  /** Verified provider-derived cart replacement proposal awaiting explicit customer acceptance. */
  comboConversionProposal?: NonNullable<AgentEntities['comboConversionProposal']>;
  /** Verified customer-evidence item that the assistant presented and is awaiting explicit acceptance. */
  pendingCatalogSuggestion?: {
    itemCode: string;
    name: string;
    source: 'favorite' | 'recent_order';
  };
  userConfirmedOrder: boolean;
  escalationReasons: string[];
  retrievedEvidence: RetrievedEvidence[];
  entities?: AgentEntities;
  selectedModifiers?: Record<string, SelectedModifier[]>;
  fulfillment?: FulfillmentState;
  promotionContext?: PromotionContext;
  contentEvidence?: ContentEvidence[];
  menuSearchResults?: MenuItem[];
  /** Turn-local bounded menu evidence used only as model context. Never persisted. */
  plannerMenuSearchResults?: MenuItem[];
  /** Turn-local fixture API evidence. Safety gates and the cart API both verify it; never persisted. */
  plannerMenuCatalogContext?: MenuPlanningContext;
  menuItemDetail?: MenuItem;
  menuModifierOptions?: GeneratedMenuModifier;
  promotionOffers?: GeneratedPromotionVoucherOffer[];
  customerContext?: CustomerContext;
  paymentAttempt?: PaymentAttempt;
  selectedPaymentMethod?: PaymentLinkMethod;
  paymentMethodEvidence?: GeneratedPaymentMethod[];
  invoiceRequest?: InvoiceRequest;
  handoff?: HandoffState;
  toolTrace?: ToolTraceEntry[];
}
