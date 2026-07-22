import type { KfcGenUiAttachment } from '../genui/kfcGenUi.js';
import type { CustomerCommand } from './customerCommand.js';
import type { OrderStatusDeliveryEstimate } from './orderStatusEvidence.js';

export type Channel =
  'messenger' | 'zalo' | 'kfc' | 'messenger_mock' | 'zalo_mock';

export type CustomerAccessScope =
  | 'customer:read'
  | 'membership:read'
  | 'membership:write'
  | 'order:read'
  | 'order:write'
  | 'payment:read'
  | 'payment:write'
  | 'handoff:write';

export type AuthenticationEvidence =
  | { state: 'none' | 'unknown' }
  | {
      state: 'verified';
      method: string;
      issuer: string;
      audience: string;
      authenticatedAt: string;
      expiresAt: string;
      evidenceRef: string;
    };

/** Trusted runtime authority. Request payloads and model output must never populate this. */
export interface CustomerAccessContext {
  tenantScope: string;
  customerSurface: 'kfc-app-chat' | 'messenger' | 'zalo';
  sessionRef: string;
  surfaceSubjectRef: string | 'not-applicable' | 'unknown';
  kfcSubjectRef: string | 'none' | 'unknown';
  authenticationState: 'unauthenticated' | 'authenticated' | 'unknown';
  membershipState: 'member' | 'non-member' | 'unknown';
  channelAccountLinkState: 'linked' | 'unlinked' | 'not-applicable' | 'unknown';
  subjectBindingState: 'verified' | 'unverified' | 'unknown';
  authenticationEvidence: AuthenticationEvidence;
  authorizedScopes: CustomerAccessScope[];
}

export interface MenuItem {
  code: string;
  itemId?: string;
  productCode?: string;
  category: string;
  categoryId: string;
  name: string;
  description: string;
  priceVnd: number;
  originalPriceVnd: number | null;
  imageUrl: string;
  available: boolean;
  isCustomize?: boolean;
  isQuickCombo?: boolean;
  hasModifiers?: boolean;
  modifierGroups?: MenuModifierGroup[];
}

export interface MenuModifierOption {
  modifierId: string;
  name: string;
  priceDeltaVnd: number;
  default: boolean;
  quantity: number | null;
  modifierGroups: MenuModifierGroup[];
}

export interface MenuModifierGroup {
  groupId: string;
  name: string;
  min: number | null;
  max: number | null;
  depth: number;
  options: MenuModifierOption[];
}

export interface CartItem {
  itemCode: string;
  name: string;
  quantity: number;
  unitPriceVnd: number;
  modifiers?: CartItemModifier[];
  imageUrl?: string;
  category?: string;
}

export interface CartItemModifier {
  groupId: string;
  groupName: string;
  modifierId: string;
  modifierName: string;
  quantity: number;
  priceDeltaVnd: number;
}

export interface Cart {
  id: string;
  items: CartItem[];
  subtotalVnd: number;
  discountVnd: number;
  deliveryFeeVnd: number;
  totalVnd: number;
  voucherCode: string | null;
}

export interface Address {
  label: string;
  line1: string;
  district: string;
  city: string;
}

/**
 * Customer-supplied delivery detail before the fulfillment provider resolves
 * it to a normalized Address. Administrative fields remain nullable because a
 * customer may supply them across separate conversation turns. Only the
 * provider is allowed to complete those fields.
 */
export interface FulfillmentAddressInput {
  label: string | null;
  line1: string;
  district: string | null;
  city: string | null;
}

export type OrderStatus =
  | 'previewed'
  | 'created'
  | 'preparing'
  | 'delivering'
  | 'completed'
  | 'cancelled';
export type PaymentStatus = 'not_started' | 'pending' | 'paid' | 'failed';

export interface CommerceProviderProvenanceEntry {
  implementation: string;
  source: string;
}

export type CommerceProviderProvenance = Record<
  string,
  CommerceProviderProvenanceEntry
>;

export interface Order {
  id: string;
  cart: Cart;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  assignedStoreId: string;
  createdAt: string;
  /** Current provider-observed delivery window from an order-status read. */
  deliveryEstimate?: OrderStatusDeliveryEstimate;
  posTicketId?: string;
  posStatus?: 'accepted' | 'preparing' | 'ready' | 'cancelled' | 'rejected';
  commerceOrderId?: string;
  omsOrderId?: string;
  commerceOutcome?: string;
  commerceCustomerStatus?: string;
  commerceEnvironment?: 'sandbox' | 'production';
  commerceProviderProvenance?: CommerceProviderProvenance;
}

export type ConversationAttachmentType =
  'image' | 'file' | 'link' | 'sticker' | 'audio' | 'location' | 'unknown';

export interface ConversationAttachment {
  type: ConversationAttachmentType;
  url?: string;
  title?: string;
  mimeType?: string;
  sizeBytes?: number;
  latitude?: number;
  longitude?: number;
  raw?: Record<string, unknown>;
}

export interface ConversationTurnMetadata {
  platformEventName?: string;
  attachments?: ConversationAttachment[];
  rawEvent?: Record<string, unknown>;
  genUi?: KfcGenUiAttachment;
  /** Legacy untrusted audit metadata. It is never structured-action authority. */
  customerCommand?: CustomerCommand;
  authorType?: 'ai_agent' | 'human_agent';
  agentId?: string;
  responseProfile?: 'genui' | 'social';
  release?: {
    gitSha: string;
    deploymentId: string;
    builtAt: string;
    dirty: boolean;
  };
}

export interface ConversationProfile {
  channel: Extract<Channel, 'messenger' | 'zalo'>;
  externalUserId: string;
  displayName: string | null;
  avatarUrl: string | null;
  profileSource:
    | 'messenger_webhook'
    | 'messenger_profile_api'
    | 'zalo_webhook'
    | 'zalo_profile_api'
    | 'manual';
  profileUpdatedAt: string;
}

export interface ConversationTurn {
  id: string;
  sessionId: string;
  channel: Channel;
  role: 'user' | 'assistant' | 'tool' | 'system';
  text: string;
  externalMessageId: string | null;
  externalUserId: string | null;
  deliveryStatus:
    | 'received'
    | 'pending'
    | 'sent'
    | 'failed'
    | 'outcome_unknown'
    | 'not_applicable';
  metadata: ConversationTurnMetadata | null;
  createdAt: string;
}

export type PendingCustomerTurnSteerMode = 'steering' | 'record_only';
export type PendingCustomerTurnStatus =
  'pending' | 'claimed' | 'superseded' | 'ignored';

export interface PendingCustomerTurn {
  turnId: string;
  sessionId: string;
  channel: Extract<Channel, 'messenger' | 'zalo'>;
  externalMessageId: string;
  externalUserId: string;
  text: string;
  steerMode: PendingCustomerTurnSteerMode;
  status: PendingCustomerTurnStatus;
  claimedRunId: string | null;
  receivedAt: string;
  updatedAt: string;
}

export type AgentRunStatus =
  | 'scheduled'
  | 'running'
  | 'completed'
  | 'superseded'
  | 'failed'
  | 'reconciliation_required';
export type AgentRunDeliveryStatus =
  | 'pending'
  | 'sent'
  | 'failed'
  | 'suppressed'
  | 'outcome_unknown'
  | 'not_applicable';
export type ToolSideEffectClass = 'read' | 'reversible' | 'irreversible';

export interface AgentRun {
  id: string;
  sessionId: string;
  generation: number;
  sessionAuthorityGeneration: number;
  channel: Extract<Channel, 'messenger' | 'zalo'>;
  externalUserId: string;
  status: AgentRunStatus;
  /** Monotonic execution ownership epoch. Zero means never claimed. */
  executionAttempt: number;
  /** Opaque, server-issued bearer token for the current execution attempt. */
  executionLeaseToken: string | null;
  /** Canonical UTC expiry for the current execution attempt. */
  executionLeaseExpiresAt: string | null;
  coalescedInputText: string;
  supersededByRunId: string | null;
  irreversibleSideEffectAt: string | null;
  irreversibleToolName: string | null;
  assistantTurnId: string | null;
  deliveryStatus: AgentRunDeliveryStatus;
  deliveryExternalMessageId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  scheduledAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
}

export interface AgentRunTurn {
  runId: string;
  turnId: string;
  sequence: number;
}

export interface SessionAgentState {
  sessionId: string;
  currentRunId: string | null;
  generation: number;
  debounceDeadlineAt: string | null;
  updatedAt: string;
}

export interface ToolResult<T> {
  ok: boolean;
  value?: T;
  errorCode?: string;
  message: string;
  provenance?: Array<{
    fixtureMode:
      | 'public_crawl_seed'
      | 'authenticated_chrome_seed'
      | 'mock_external_state'
      | 'test_only'
      | 'demo_mock_seed'
      | 'provider_runtime';
    sourceFile: string;
    sourceUrl?: string;
    sourceApi?: string;
  }>;
}

export interface DashboardEvent {
  id: string;
  sessionId: string;
  type:
    | 'session_updated'
    | 'conversation_turn_created'
    | 'customer_message_received'
    | 'assistant_reply_skipped'
    | 'assistant_reply_sent'
    | 'agent_run_pending'
    | 'agent_run_scheduled'
    | 'agent_run_started'
    | 'agent_run_superseded'
    | 'agent_run_delivery_suppressed'
    | 'agent_run_delivered'
    | 'cart_changed'
    | 'voucher_applied'
    | 'voucher_rejected'
    | 'payment_link_created'
    | 'payment_failed'
    | 'payment_paid'
    | 'order_previewed'
    | 'order_created'
    | 'handoff_required'
    | 'session_intelligence_updated'
    | 'session_resolved';
  payload: Record<string, unknown>;
  createdAt: string;
}

export type MonitorOrderStage =
  | 'collecting_info'
  | 'cart_ready'
  | 'fulfillment_pending'
  | 'payment_issue'
  | 'confirmed';

export type MonitorRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export type MonitorSessionIntelligenceSource =
  'ai_monitor_judge' | 'runtime_rule_fallback';

export type MonitorIntelligenceReason =
  | 'awaiting_customer_info'
  | 'cart_verified'
  | 'missing_address'
  | 'missing_fulfillment'
  | 'order_previewed'
  | 'order_created'
  | 'payment_link_pending'
  | 'payment_failed'
  | 'payment_paid'
  | 'handoff_required'
  | 'human_joined'
  | 'ai_resumed'
  | 'failed_delivery'
  | 'tool_execution_failed'
  | 'safety_gate_blocked';

export interface MonitorSessionIntelligence {
  schemaVersion: 1;
  orderStage: MonitorOrderStage;
  aiAutomationConfidencePercent: number;
  riskLevel: MonitorRiskLevel;
  priorityRank: number;
  contextSummary: string;
  evaluatedCustomerTurnCount: number;
  reasons: MonitorIntelligenceReason[];
  evidence: {
    dashboardEventTypes: DashboardEvent['type'][];
    toolNames: string[];
    escalationReasons: string[];
    safetyGateReasons: string[];
  };
  source: MonitorSessionIntelligenceSource;
  model?: string;
  promptVersion?: string;
  fallbackReason?: string;
  updatedAt: string;
  commerce?: {
    commerceOrderId?: string;
    omsOrderId?: string;
    posTicketId?: string;
    outcome?: string;
    customerStatus?: string;
    environment: 'sandbox' | 'production';
    providerProvenance: CommerceProviderProvenance;
  };
}

export type SessionUpdateType =
  | 'store_assigned'
  | 'delivery_quote'
  | 'invoice_requested'
  | 'tool_called'
  | 'fulfillment_quoted'
  | 'promotion_answered'
  | 'content_evidence_found'
  | 'handoff_resolved'
  | 'human_joined'
  | 'human_message_sent'
  | 'ai_resumed';

export type AgentMode = 'ai_active' | 'human_paused' | 'resolved';
