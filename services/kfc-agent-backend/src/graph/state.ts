import type { Address, Cart, Channel, ConversationTurn, Intent, MenuItem, Order } from '../domain/types.js';
import type { GeneratedMenuModifier, GeneratedPaymentMethod } from '../fixtures/schema.js';
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
  recentTurns?: ConversationTurn[] | undefined;
  intent: Intent;
  cart?: Cart | undefined;
  address?: Address | undefined;
  orderPreview?: Order | undefined;
  order?: Order | undefined;
  userConfirmedOrder: boolean;
  escalationReasons: string[];
  retrievedEvidence: RetrievedEvidence[];
  entities?: AgentEntities | undefined;
  selectedModifiers?: Record<string, SelectedModifier[]> | undefined;
  fulfillment?: FulfillmentState | undefined;
  promotionContext?: PromotionContext | undefined;
  contentEvidence?: ContentEvidence[] | undefined;
  menuSearchResults?: MenuItem[] | undefined;
  menuModifierOptions?: GeneratedMenuModifier | undefined;
  customerContext?: CustomerContext | undefined;
  paymentAttempt?: PaymentAttempt | undefined;
  paymentMethodEvidence?: GeneratedPaymentMethod[] | undefined;
  invoiceRequest?: InvoiceRequest | undefined;
  handoff?: HandoffState | undefined;
  toolTrace?: ToolTraceEntry[] | undefined;
}
