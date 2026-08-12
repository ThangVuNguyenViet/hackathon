import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import type {
  AgentMode,
  AgentRun,
  AgentRunTurn,
  ConversationProfile,
  DashboardEvent,
  ConversationTurn,
  PendingCustomerTurn,
  SessionAgentState,
} from '../domain/types.js';
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
} from './memoryStore.js';
import {
  CustomerRunIdempotencyConflictError,
  CustomerRunSequenceConflictError,
  customerRunEventSchema,
  type CustomerRun,
  type CustomerRunEvent,
} from '../customerRuns/contracts.js';

export type Queryable = Pool | PoolClient;

export interface ConversationTurnRow {
  id: string;
  session_id: string;
  channel: ConversationTurn['channel'];
  role: ConversationTurn['role'];
  text: string;
  external_message_id: string | null;
  external_user_id: string | null;
  delivery_status: ConversationTurn['deliveryStatus'];
  metadata: Record<string, unknown> | null;
  created_at: Date | string;
}

export interface ConversationProfileRow {
  channel: ConversationProfile['channel'];
  external_user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  profile_source: ConversationProfile['profileSource'];
  profile_updated_at: Date | string;
}

export interface StoredEventRow {
  id: string;
  session_id: string;
  source_type: string;
  payload: Record<string, unknown>;
  created_at: Date | string;
}

export interface DashboardEventRow {
  id: string;
  session_id: string;
  type: DashboardEvent['type'];
  payload: Record<string, unknown>;
  created_at: Date | string;
}

export interface WebhookDeliveryRow {
  channel: WebhookDeliveryChannel;
  external_event_id: string;
  external_thread_id: string;
  external_user_id: string;
  session_id: string;
  status: WebhookDelivery['status'];
  payload: Record<string, unknown>;
  received_at: Date | string;
  processed_at: Date | string | null;
  failed_at: Date | string | null;
  last_error: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface SessionControlRow {
  session_id: string;
  agent_mode: AgentMode;
  assigned_agent_id: string | null;
  session_authority_generation: number;
  updated_at: Date | string;
}

export interface PendingCustomerTurnRow {
  turn_id: string;
  session_id: string;
  channel: PendingCustomerTurn['channel'];
  external_message_id: string;
  external_user_id: string;
  text: string;
  steer_mode: PendingCustomerTurn['steerMode'];
  status: PendingCustomerTurn['status'];
  claimed_run_id: string | null;
  received_at: Date | string;
  updated_at: Date | string;
}

export interface AgentRunRow {
  id: string;
  session_id: string;
  generation: number;
  session_authority_generation: number;
  channel: AgentRun['channel'];
  external_user_id: string;
  status: AgentRun['status'];
  execution_attempt: number;
  execution_lease_token: string | null;
  execution_lease_expires_at: Date | string | null;
  coalesced_input_text: string;
  superseded_by_run_id: string | null;
  irreversible_side_effect_at: Date | string | null;
  irreversible_tool_name: string | null;
  assistant_turn_id: string | null;
  delivery_status: AgentRun['deliveryStatus'];
  delivery_external_message_id: string | null;
  error_code: string | null;
  error_message: string | null;
  scheduled_at: Date | string;
  started_at: Date | string | null;
  completed_at: Date | string | null;
  updated_at: Date | string;
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
  debounce_deadline_at: Date | string | null;
  updated_at: Date | string;
}

export interface CustomerRunRow {
  id: string;
  schema_version: 1;
  session_id: string;
  customer_id: string;
  client_message_id: string;
  request_fingerprint: string;
  generation: number;
  session_authority_generation: number;
  status: CustomerRun['status'];
  phase: CustomerRun['phase'];
  next_event_sequence: number;
  client_schema_version: number;
  accepted_at: Date | string;
  started_at: Date | string | null;
  terminal_at: Date | string | null;
  updated_at: Date | string;
}

export interface CustomerRunEventRow {
  event_id: string;
  run_id: string;
  sequence: number;
  schema_version: 1;
  type: CustomerRunEvent['type'];
  occurred_at: Date | string;
  payload: Record<string, unknown>;
}

export interface IrreversibleOperationRow {
  request_id: string;
  session_id: string;
  operation: string;
  binding_fingerprint: string;
  session_authority_generation: number;
  result_json: Record<string, unknown> | null;
  status: 'attempting' | 'unknown' | 'completed';
  attempt_count: number;
  lease_expires_at: Date | string | null;
  lease_token: string;
  last_error: string | null;
}

export function normalizeDate(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
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
    metadata: row.metadata as ConversationTurn['metadata'],
    createdAt: normalizeDate(row.created_at),
  };
}

export function profileFromRow(row: ConversationProfileRow): ConversationProfile {
  return {
    channel: row.channel,
    externalUserId: row.external_user_id,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    profileSource: row.profile_source,
    profileUpdatedAt: normalizeDate(row.profile_updated_at),
  };
}

export function storedEventFromRow(row: StoredEventRow): StoredEvent {
  return {
    id: row.id,
    sessionId: row.session_id,
    sourceType: row.source_type,
    payload: row.payload,
    createdAt: normalizeDate(row.created_at),
  };
}

export function dashboardEventFromRow(row: DashboardEventRow): DashboardEvent {
  return {
    id: row.id,
    sessionId: row.session_id,
    type: row.type,
    payload: row.payload,
    createdAt: normalizeDate(row.created_at),
  };
}

export function nullableDate(value: Date | string | null): string | null {
  return value === null ? null : normalizeDate(value);
}

export function webhookDeliveryFromRow(row: WebhookDeliveryRow): WebhookDelivery {
  return {
    channel: row.channel,
    externalEventId: row.external_event_id,
    externalThreadId: row.external_thread_id,
    externalUserId: row.external_user_id,
    sessionId: row.session_id,
    status: row.status,
    payload: row.payload,
    receivedAt: normalizeDate(row.received_at),
    processedAt: nullableDate(row.processed_at),
    failedAt: nullableDate(row.failed_at),
    lastError: row.last_error,
    createdAt: normalizeDate(row.created_at),
    updatedAt: normalizeDate(row.updated_at),
  };
}

export function sessionControlFromRow(row: SessionControlRow): SessionControl {
  return {
    sessionId: row.session_id,
    agentMode: row.agent_mode,
    assignedAgentId: row.assigned_agent_id,
    sessionAuthorityGeneration: Number(row.session_authority_generation),
    updatedAt: normalizeDate(row.updated_at),
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
    sessionAuthorityGeneration: Number(row.session_authority_generation),
    status: row.status,
    phase: row.phase,
    nextEventSequence: Number(row.next_event_sequence),
    clientSchemaVersion: Number(row.client_schema_version),
    acceptedAt: normalizeDate(row.accepted_at),
    startedAt: nullableDate(row.started_at),
    terminalAt: nullableDate(row.terminal_at),
    updatedAt: normalizeDate(row.updated_at),
  };
}

export function customerRunEventFromRow(row: CustomerRunEventRow): CustomerRunEvent {
  return customerRunEventSchema.parse({
    schemaVersion: Number(row.schema_version),
    eventId: row.event_id,
    runId: row.run_id,
    sequence: Number(row.sequence),
    type: row.type,
    occurredAt: normalizeDate(row.occurred_at),
    payload: row.payload,
  });
}

export function defaultSessionControl(sessionId: string): SessionControl {
  return {
    sessionId,
    agentMode: 'ai_active',
    assignedAgentId: null,
    sessionAuthorityGeneration: 0,
    updatedAt: new Date().toISOString(),
  };
}

export function pendingCustomerTurnFromRow(row: PendingCustomerTurnRow): PendingCustomerTurn {
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
    receivedAt: normalizeDate(row.received_at),
    updatedAt: normalizeDate(row.updated_at),
  };
}

export function agentRunFromRow(row: AgentRunRow): AgentRun {
  return {
    id: row.id,
    sessionId: row.session_id,
    generation: Number(row.generation),
    sessionAuthorityGeneration: Number(row.session_authority_generation),
    channel: row.channel,
    externalUserId: row.external_user_id,
    status: row.status,
    executionAttempt: Number(row.execution_attempt),
    executionLeaseToken: row.execution_lease_token,
    executionLeaseExpiresAt: nullableDate(row.execution_lease_expires_at),
    coalescedInputText: row.coalesced_input_text,
    supersededByRunId: row.superseded_by_run_id,
    irreversibleSideEffectAt: nullableDate(row.irreversible_side_effect_at),
    irreversibleToolName: row.irreversible_tool_name,
    assistantTurnId: row.assistant_turn_id,
    deliveryStatus: row.delivery_status,
    deliveryExternalMessageId: row.delivery_external_message_id,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    scheduledAt: normalizeDate(row.scheduled_at),
    startedAt: nullableDate(row.started_at),
    completedAt: nullableDate(row.completed_at),
    updatedAt: normalizeDate(row.updated_at),
  };
}

export function agentRunTurnFromRow(row: AgentRunTurnRow): AgentRunTurn {
  return {
    runId: row.run_id,
    turnId: row.turn_id,
    sequence: Number(row.sequence),
  };
}

export function sessionAgentStateFromRow(row: SessionAgentStateRow): SessionAgentState {
  return {
    sessionId: row.session_id,
    currentRunId: row.current_run_id,
    generation: Number(row.generation),
    debounceDeadlineAt: nullableDate(row.debounce_deadline_at),
    updatedAt: normalizeDate(row.updated_at),
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
