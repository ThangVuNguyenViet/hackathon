import type { KfcGenUiAttachment } from "../genui/kfcGenUi.js";

export type Channel =
  "messenger" | "zalo" | "kfc" | "messenger_mock" | "zalo_mock";

export type Intent =
  | "ordering"
  | "cart_edit"
  | "voucher"
  | "payment"
  | "order_status"
  | "complaint"
  | "feedback"
  | "handoff"
  | "safety"
  | "unclear";

export interface MenuItem {
  code: string;
  category: string;
  name: string;
  description: string;
  priceVnd: number;
  originalPriceVnd: number | null;
  imageUrl: string;
  available: boolean;
}

export interface CartItem {
  itemCode: string;
  name: string;
  quantity: number;
  unitPriceVnd: number;
  imageUrl?: string;
  category?: string;
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

export type OrderStatus =
  | "previewed"
  | "created"
  | "preparing"
  | "delivering"
  | "completed"
  | "cancelled";
export type PaymentStatus = "not_started" | "pending" | "paid" | "failed";

export interface Order {
  id: string;
  cart: Cart;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  assignedStoreId: string;
  createdAt: string;
  posTicketId?: string;
  posStatus?: "accepted" | "preparing" | "ready" | "cancelled" | "rejected";
  commerceOrderId?: string;
  omsOrderId?: string;
  commerceOutcome?: string;
  commerceCustomerStatus?: string;
  commerceSimulated?: boolean;
}

export type ConversationAttachmentType =
  "image" | "file" | "link" | "sticker" | "audio" | "location" | "unknown";

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
  authorType?: "ai_agent" | "human_agent";
  agentId?: string;
}

export interface ConversationProfile {
  channel: Extract<Channel, "messenger" | "zalo">;
  externalUserId: string;
  displayName: string | null;
  avatarUrl: string | null;
  profileSource:
    | "messenger_webhook"
    | "messenger_profile_api"
    | "zalo_webhook"
    | "zalo_profile_api"
    | "manual";
  profileUpdatedAt: string;
}

export interface ConversationTurn {
  id: string;
  sessionId: string;
  channel: Channel;
  role: "user" | "assistant" | "tool" | "system";
  text: string;
  externalMessageId: string | null;
  externalUserId: string | null;
  deliveryStatus: "received" | "pending" | "sent" | "failed" | "not_applicable";
  metadata: ConversationTurnMetadata | null;
  createdAt: string;
}

export type PendingCustomerTurnSteerMode = "steering" | "record_only";
export type PendingCustomerTurnStatus =
  "pending" | "claimed" | "superseded" | "ignored";

export interface PendingCustomerTurn {
  turnId: string;
  sessionId: string;
  channel: Extract<Channel, "messenger" | "zalo">;
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
  "scheduled" | "running" | "completed" | "superseded" | "failed";
export type AgentRunDeliveryStatus =
  "pending" | "sent" | "failed" | "suppressed" | "not_applicable";
export type ToolSideEffectClass = "read" | "reversible" | "irreversible";

export interface AgentRun {
  id: string;
  sessionId: string;
  generation: number;
  channel: Extract<Channel, "messenger" | "zalo">;
  externalUserId: string;
  status: AgentRunStatus;
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
}

export interface DashboardEvent {
  id: string;
  sessionId: string;
  type:
    | "session_updated"
    | "conversation_turn_created"
    | "customer_message_received"
    | "assistant_reply_skipped"
    | "assistant_reply_sent"
    | "agent_run_pending"
    | "agent_run_scheduled"
    | "agent_run_started"
    | "agent_run_superseded"
    | "agent_run_delivery_suppressed"
    | "agent_run_delivered"
    | "cart_changed"
    | "voucher_applied"
    | "voucher_rejected"
    | "payment_link_created"
    | "payment_failed"
    | "payment_paid"
    | "order_previewed"
    | "order_created"
    | "handoff_required"
    | "session_intelligence_updated"
    | "session_resolved";
  payload: Record<string, unknown>;
  createdAt: string;
}

export type MonitorOrderStage =
  | "collecting_info"
  | "cart_ready"
  | "fulfillment_pending"
  | "payment_issue"
  | "confirmed";

export type MonitorRiskLevel = "low" | "medium" | "high" | "critical";

export type MonitorSessionIntelligenceSource =
  "ai_monitor_judge" | "runtime_rule_fallback";

export type MonitorIntelligenceReason =
  | "awaiting_customer_info"
  | "cart_verified"
  | "missing_address"
  | "missing_fulfillment"
  | "order_previewed"
  | "order_created"
  | "payment_link_pending"
  | "payment_failed"
  | "payment_paid"
  | "handoff_required"
  | "human_joined"
  | "ai_resumed"
  | "failed_delivery"
  | "tool_execution_failed"
  | "safety_gate_blocked";

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
    dashboardEventTypes: DashboardEvent["type"][];
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
    simulated: boolean;
  };
}

export type SessionUpdateType =
  | "store_assigned"
  | "delivery_quote"
  | "invoice_requested"
  | "tool_called"
  | "fulfillment_quoted"
  | "promotion_answered"
  | "content_evidence_found"
  | "human_joined"
  | "human_message_sent"
  | "ai_resumed";

export type AgentMode = "ai_active" | "human_paused" | "resolved";
