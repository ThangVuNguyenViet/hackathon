import type { Address, Cart, Channel, ConversationTurn, Intent, MenuItem, Order } from '../domain/types.js';
import type { GeneratedPaymentMethod } from '../fixtures/schema.js';
import type {
  AgentEntities,
  ContentEvidence,
  CustomerContext,
  FulfillmentState,
  HandoffState,
  InvoiceRequest,
  PaymentAttempt,
  PromotionContext,
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
  orderPreview?: Order;
  order?: Order;
  userConfirmedOrder: boolean;
  escalationReasons: string[];
  retrievedEvidence: RetrievedEvidence[];
  entities?: AgentEntities;
  selectedModifiers?: Record<string, SelectedModifier[]>;
  fulfillment?: FulfillmentState;
  promotionContext?: PromotionContext;
  contentEvidence?: ContentEvidence[];
  menuSearchResults?: MenuItem[];
  customerContext?: CustomerContext;
  paymentAttempt?: PaymentAttempt;
  paymentMethodEvidence?: GeneratedPaymentMethod[];
  invoiceRequest?: InvoiceRequest;
  handoff?: HandoffState;
  toolTrace?: ToolTraceEntry[];
}
