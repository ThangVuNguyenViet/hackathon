import type {
  AgentMode,
  ConversationProfile,
  DashboardEvent,
  ConversationTurn,
  MonitorSessionIntelligence,
} from "../domain/types.js";
import {
  parseMonitorSessionIntelligencePayload,
  preserveMonitorContext,
} from "../monitor/sessionIntelligence.js";
import type {
  AgentRun,
  AgentRunTurn,
  PendingCustomerTurn,
  SessionAgentState,
} from "../domain/types.js";
import type {
  AgentRunPatch,
  AppendConversationTurnInput,
  ConversationStore,
  CreateAgentRunInput,
  HistorySearchResult,
  IrreversibleOperationInput,
  IrreversibleOperationCompletion,
  IrreversibleOperationReservation,
  ImportedConversationTurn,
  ImportedConversationTurnResult,
  PendingCustomerTurnInput,
  ReserveWebhookDeliveryInput,
  ReserveWebhookDeliveryResult,
  SessionControl,
  SessionResetHook,
  SessionAgentStateInput,
  StoredEvent,
  UpsertPendingCustomerTurnResult,
  WebhookDelivery,
  WebhookDeliveryChannel,
  AppendCustomerRunEventInput,
  CustomerRunPatch,
} from "./memoryStore.js";
import { confirmationPauseFromEvent, type ConfirmationPauseRecord } from "./memoryStore.js";
import {
  CustomerRunIdempotencyConflictError,
  CustomerRunSequenceConflictError,
  customerRunEventSchema,
  type CustomerRun,
  type CustomerRunEvent,
} from "../customerRuns/contracts.js";

export interface D1Result<T = Record<string, unknown>> {
  results?: T[];
  success: boolean;
  meta: Record<string, unknown>;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  run(): Promise<D1Result>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatement;
  batch?(statements: D1PreparedStatement[]): Promise<D1Result[]>;
}

export interface ConversationTurnRow {
  id: string;
  session_id: string;
  channel: ConversationTurn["channel"];
  role: ConversationTurn["role"];
  text: string;
  external_message_id: string | null;
  external_user_id: string | null;
  delivery_status: ConversationTurn["deliveryStatus"];
  metadata: string | null;
  created_at: string;
}

export interface ConversationProfileRow {
  channel: ConversationProfile["channel"];
  external_user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  profile_source: ConversationProfile["profileSource"];
  profile_updated_at: string;
}

export interface StoredEventRow {
  id: string;
  session_id: string;
  source_type: string;
  payload: string;
  created_at: string;
}

export interface IrreversibleOperationRow {
  request_id: string;
  session_id: string;
  operation: string;
  binding_fingerprint: string;
  result_json: string | null;
  status: 'attempting' | 'unknown' | 'completed';
  attempt_count: number;
  lease_expires_at: string | null;
  lease_token: string;
  last_error: string | null;
}

export interface DashboardEventRow {
  id: string;
  session_id: string;
  type: DashboardEvent["type"];
  payload: string;
  created_at: string;
}

export interface DashboardSessionSummary {
  sessionId: string;
  latestEventType: DashboardEvent["type"];
  updatedAt: string;
  sessionIntelligence: MonitorSessionIntelligence | null;
}

export interface WebhookDeliveryRow {
  channel: WebhookDeliveryChannel;
  external_event_id: string;
  external_thread_id: string;
  external_user_id: string;
  session_id: string;
  status: WebhookDelivery["status"];
  payload: string;
  received_at: string;
  processed_at: string | null;
  failed_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface SessionControlRow {
  session_id: string;
  agent_mode: AgentMode;
  assigned_agent_id: string | null;
  updated_at: string;
}

export interface PendingCustomerTurnRow {
  turn_id: string;
  session_id: string;
  channel: PendingCustomerTurn["channel"];
  external_message_id: string;
  external_user_id: string;
  text: string;
  steer_mode: PendingCustomerTurn["steerMode"];
  status: PendingCustomerTurn["status"];
  claimed_run_id: string | null;
  received_at: string;
  updated_at: string;
}

export interface AgentRunRow {
  id: string;
  session_id: string;
  generation: number;
  channel: AgentRun["channel"];
  external_user_id: string;
  status: AgentRun["status"];
  coalesced_input_text: string;
  superseded_by_run_id: string | null;
  irreversible_side_effect_at: string | null;
  irreversible_tool_name: string | null;
  assistant_turn_id: string | null;
  delivery_status: AgentRun["deliveryStatus"];
  delivery_external_message_id: string | null;
  error_code: string | null;
  error_message: string | null;
  scheduled_at: string;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
}

export interface AgentRunTurnRow {
  run_id: string;
  turn_id: string;
  sequence: number;
}

export interface SessionAgentStateRow {
  session_id: string;
  current_run_id: string | null;
  generation: number;
  debounce_deadline_at: string | null;
  updated_at: string;
}

export interface CustomerRunRow {
  id: string;
  schema_version: 1;
  session_id: string;
  customer_id: string;
  client_message_id: string;
  request_fingerprint: string;
  generation: number;
  status: CustomerRun["status"];
  phase: CustomerRun["phase"];
  next_event_sequence: number;
  client_schema_version: number;
  accepted_at: string;
  started_at: string | null;
  terminal_at: string | null;
  updated_at: string;
}

export interface CustomerRunEventRow {
  event_id: string;
  run_id: string;
  sequence: number;
  schema_version: 1;
  type: CustomerRunEvent["type"];
  occurred_at: string;
  payload: string;
}

export interface D1TableInfoRow {
  name: string;
}

export const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS conversation_turns (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    channel TEXT NOT NULL,
    role TEXT NOT NULL,
    text TEXT NOT NULL,
    external_message_id TEXT,
    external_user_id TEXT,
    delivery_status TEXT NOT NULL,
    metadata TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS conversation_turns_session_external_message_idx
    ON conversation_turns (session_id, external_message_id)
    WHERE external_message_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS conversation_turns_session_created_idx
    ON conversation_turns (session_id, created_at DESC, id DESC)`,
  `CREATE TABLE IF NOT EXISTS conversation_events (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    source_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS dashboard_events (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS dashboard_events_created_idx
    ON dashboard_events (created_at DESC, id DESC)`,
  `CREATE INDEX IF NOT EXISTS dashboard_events_session_created_idx
    ON dashboard_events (session_id, created_at DESC, id DESC)`,
  `CREATE TABLE IF NOT EXISTS webhook_deliveries (
    channel TEXT NOT NULL,
    external_event_id TEXT NOT NULL,
    external_thread_id TEXT NOT NULL,
    external_user_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    status TEXT NOT NULL,
    payload TEXT NOT NULL,
    received_at TEXT NOT NULL,
    processed_at TEXT,
    failed_at TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (channel, external_event_id)
  )`,
  `CREATE TABLE IF NOT EXISTS conversation_profiles (
    channel TEXT NOT NULL,
    external_user_id TEXT NOT NULL,
    display_name TEXT,
    avatar_url TEXT,
    profile_source TEXT NOT NULL,
    profile_updated_at TEXT NOT NULL,
    PRIMARY KEY (channel, external_user_id)
  )`,
  `CREATE INDEX IF NOT EXISTS conversation_profiles_profile_updated_idx
    ON conversation_profiles (profile_updated_at DESC)`,
  `CREATE TABLE IF NOT EXISTS session_controls (
    session_id TEXT PRIMARY KEY,
    agent_mode TEXT NOT NULL,
    assigned_agent_id TEXT,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS pending_customer_turns (
    turn_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    channel TEXT NOT NULL,
    external_message_id TEXT NOT NULL,
    external_user_id TEXT NOT NULL,
    text TEXT NOT NULL,
    steer_mode TEXT NOT NULL,
    status TEXT NOT NULL,
    claimed_run_id TEXT,
    received_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS pending_customer_turns_session_external_message_idx
    ON pending_customer_turns (session_id, external_message_id)`,
  `CREATE TABLE IF NOT EXISTS agent_runs (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    generation INTEGER NOT NULL,
    channel TEXT NOT NULL,
    external_user_id TEXT NOT NULL,
    status TEXT NOT NULL,
    coalesced_input_text TEXT NOT NULL,
    superseded_by_run_id TEXT,
    irreversible_side_effect_at TEXT,
    irreversible_tool_name TEXT,
    assistant_turn_id TEXT,
    delivery_status TEXT NOT NULL,
    delivery_external_message_id TEXT,
    error_code TEXT,
    error_message TEXT,
    scheduled_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS agent_runs_session_generation_idx
    ON agent_runs (session_id, generation, id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS agent_runs_session_generation_claim_idx
    ON agent_runs (session_id, generation)`,
  `CREATE TABLE IF NOT EXISTS agent_run_turns (
    run_id TEXT NOT NULL,
    turn_id TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    PRIMARY KEY (run_id, turn_id)
  )`,
  `CREATE TABLE IF NOT EXISTS session_agent_state (
    session_id TEXT PRIMARY KEY,
    current_run_id TEXT,
    generation INTEGER NOT NULL,
    debounce_deadline_at TEXT,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS session_agent_state_due_idx
    ON session_agent_state (debounce_deadline_at, session_id)
    WHERE current_run_id IS NULL AND debounce_deadline_at IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS customer_runs (
    id TEXT PRIMARY KEY,
    schema_version INTEGER NOT NULL,
    session_id TEXT NOT NULL,
    customer_id TEXT NOT NULL,
    client_message_id TEXT NOT NULL,
    request_fingerprint TEXT NOT NULL,
    generation INTEGER NOT NULL,
    status TEXT NOT NULL,
    phase TEXT,
    next_event_sequence INTEGER NOT NULL,
    client_schema_version INTEGER NOT NULL,
    accepted_at TEXT NOT NULL,
    started_at TEXT,
    terminal_at TEXT,
    updated_at TEXT NOT NULL,
    UNIQUE (session_id, client_message_id)
  )`,
  `CREATE INDEX IF NOT EXISTS customer_runs_session_generation_idx
    ON customer_runs (session_id, generation, id)`,
  `CREATE TABLE IF NOT EXISTS customer_run_events (
    event_id TEXT NOT NULL UNIQUE,
    run_id TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    schema_version INTEGER NOT NULL,
    type TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    payload TEXT NOT NULL,
    PRIMARY KEY (run_id, sequence)
  )`,
  `CREATE INDEX IF NOT EXISTS customer_run_events_replay_idx
    ON customer_run_events (run_id, sequence)`,
  `CREATE TABLE IF NOT EXISTS langgraph_checkpoints (
    thread_id TEXT NOT NULL,
    checkpoint_ns TEXT NOT NULL DEFAULT '',
    checkpoint_id TEXT NOT NULL,
    parent_checkpoint_id TEXT,
    checkpoint_type TEXT NOT NULL,
    checkpoint_blob BLOB NOT NULL,
    metadata_type TEXT NOT NULL,
    metadata_blob BLOB NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
  )`,
  `CREATE INDEX IF NOT EXISTS langgraph_checkpoints_latest_idx
    ON langgraph_checkpoints (thread_id, checkpoint_ns, checkpoint_id DESC)`,
  `CREATE TABLE IF NOT EXISTS langgraph_checkpoint_writes (
    thread_id TEXT NOT NULL,
    checkpoint_ns TEXT NOT NULL DEFAULT '',
    checkpoint_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    write_index INTEGER NOT NULL,
    channel TEXT NOT NULL,
    value_type TEXT NOT NULL,
    value_blob BLOB NOT NULL,
    PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, write_index)
  )`,
  `CREATE INDEX IF NOT EXISTS langgraph_checkpoint_writes_checkpoint_idx
    ON langgraph_checkpoint_writes (thread_id, checkpoint_ns, checkpoint_id)`,
  `CREATE TABLE IF NOT EXISTS irreversible_operations (
    request_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    binding_fingerprint TEXT NOT NULL,
    result_json TEXT,
    status TEXT NOT NULL,
    attempt_count INTEGER NOT NULL,
    lease_expires_at TEXT,
    lease_token TEXT NOT NULL,
    last_error TEXT,
    created_at TEXT NOT NULL,
    completed_at TEXT
  )`,
];


export function parsePayload(value: string): Record<string, unknown> {
  return JSON.parse(value) as Record<string, unknown>;
}

export function turnFromRow(row: ConversationTurnRow): ConversationTurn {
  return {
    id: row.id,
    sessionId: row.session_id,
    channel: row.channel,
    role: row.role,
    text: row.text,
    externalMessageId: row.external_message_id,
    externalUserId: row.external_user_id,
    deliveryStatus: row.delivery_status,
    metadata: parseNullablePayload(row.metadata),
    createdAt: row.created_at,
  };
}

export function parseNullablePayload(
  value: string | null | undefined,
): Record<string, unknown> | null {
  if (!value) return null;
  return JSON.parse(value) as Record<string, unknown>;
}

export function profileFromRow(row: ConversationProfileRow): ConversationProfile {
  return {
    channel: row.channel,
    externalUserId: row.external_user_id,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    profileSource: row.profile_source,
    profileUpdatedAt: row.profile_updated_at,
  };
}

export function storedEventFromRow(row: StoredEventRow): StoredEvent {
  return {
    id: row.id,
    sessionId: row.session_id,
    sourceType: row.source_type,
    payload: parsePayload(row.payload),
    createdAt: row.created_at,
  };
}

export function dashboardEventFromRow(row: DashboardEventRow): DashboardEvent {
  return {
    id: row.id,
    sessionId: row.session_id,
    type: row.type,
    payload: parsePayload(row.payload),
    createdAt: row.created_at,
  };
}

export function webhookDeliveryFromRow(row: WebhookDeliveryRow): WebhookDelivery {
  return {
    channel: row.channel,
    externalEventId: row.external_event_id,
    externalThreadId: row.external_thread_id,
    externalUserId: row.external_user_id,
    sessionId: row.session_id,
    status: row.status,
    payload: parsePayload(row.payload),
    receivedAt: row.received_at,
    processedAt: row.processed_at,
    failedAt: row.failed_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function sessionControlFromRow(row: SessionControlRow): SessionControl {
  return {
    sessionId: row.session_id,
    agentMode: row.agent_mode,
    assignedAgentId: row.assigned_agent_id,
    updatedAt: row.updated_at,
  };
}

export function customerRunFromRow(row: CustomerRunRow): CustomerRun {
  return {
    id: row.id,
    schemaVersion: Number(row.schema_version) as 1,
    sessionId: row.session_id,
    customerId: row.customer_id,
    clientMessageId: row.client_message_id,
    requestFingerprint: row.request_fingerprint,
    generation: Number(row.generation),
    status: row.status,
    phase: row.phase,
    nextEventSequence: Number(row.next_event_sequence),
    clientSchemaVersion: Number(row.client_schema_version),
    acceptedAt: row.accepted_at,
    startedAt: row.started_at,
    terminalAt: row.terminal_at,
    updatedAt: row.updated_at,
  };
}

export function customerRunEventFromRow(row: CustomerRunEventRow): CustomerRunEvent {
  return customerRunEventSchema.parse({
    schemaVersion: Number(row.schema_version),
    eventId: row.event_id,
    runId: row.run_id,
    sequence: Number(row.sequence),
    type: row.type,
    occurredAt: row.occurred_at,
    payload: parsePayload(row.payload),
  });
}

export function defaultSessionControl(sessionId: string): SessionControl {
  return {
    sessionId,
    agentMode: "ai_active",
    assignedAgentId: null,
    updatedAt: new Date().toISOString(),
  };
}

export function pendingCustomerTurnFromRow(
  row: PendingCustomerTurnRow,
): PendingCustomerTurn {
  return {
    turnId: row.turn_id,
    sessionId: row.session_id,
    channel: row.channel,
    externalMessageId: row.external_message_id,
    externalUserId: row.external_user_id,
    text: row.text,
    steerMode: row.steer_mode,
    status: row.status,
    claimedRunId: row.claimed_run_id,
    receivedAt: row.received_at,
    updatedAt: row.updated_at,
  };
}

export function agentRunFromRow(row: AgentRunRow): AgentRun {
  return {
    id: row.id,
    sessionId: row.session_id,
    generation: Number(row.generation),
    channel: row.channel,
    externalUserId: row.external_user_id,
    status: row.status,
    coalescedInputText: row.coalesced_input_text,
    supersededByRunId: row.superseded_by_run_id,
    irreversibleSideEffectAt: row.irreversible_side_effect_at,
    irreversibleToolName: row.irreversible_tool_name,
    assistantTurnId: row.assistant_turn_id,
    deliveryStatus: row.delivery_status,
    deliveryExternalMessageId: row.delivery_external_message_id,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    scheduledAt: row.scheduled_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    updatedAt: row.updated_at,
  };
}

export function agentRunTurnFromRow(row: AgentRunTurnRow): AgentRunTurn {
  return {
    runId: row.run_id,
    turnId: row.turn_id,
    sequence: Number(row.sequence),
  };
}

export function sessionAgentStateFromRow(
  row: SessionAgentStateRow,
): SessionAgentState {
  return {
    sessionId: row.session_id,
    currentRunId: row.current_run_id,
    generation: Number(row.generation),
    debounceDeadlineAt: row.debounce_deadline_at,
    updatedAt: row.updated_at,
  };
}

export function defaultSessionAgentState(sessionId: string): SessionAgentState {
  return {
    sessionId,
    currentRunId: null,
    generation: 0,
    debounceDeadlineAt: null,
    updatedAt: new Date().toISOString(),
  };
}
