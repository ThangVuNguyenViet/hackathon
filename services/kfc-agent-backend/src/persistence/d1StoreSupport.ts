import type {
  AgentMode,
  ConversationProfile,
  DashboardEvent,
  ConversationTurn,
  MonitorSessionIntelligence,
} from '../domain/types.js';
import {
  parseMonitorSessionIntelligencePayload,
  preserveMonitorContext,
} from '../monitor/sessionIntelligence.js';
import type {
  AgentRun,
  AgentRunTurn,
  PendingCustomerTurn,
  SessionAgentState,
  SessionAgentModelBinding,
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
  CatalogPinProjection,
  SandboxProofSession,
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
import type { CatalogObservation } from '../catalog/catalogObservation.js';

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
  ordinal: number;
  session_id: string;
  channel: ConversationTurn['channel'];
  role: ConversationTurn['role'];
  text: string;
  external_message_id: string | null;
  external_user_id: string | null;
  delivery_status: ConversationTurn['deliveryStatus'];
  metadata: string | null;
  created_at: string;
}

export interface ConversationSummaryRow {
  session_id: string;
  schema_version: number;
  text: string;
  through_ordinal: number;
  revision: number;
  updated_at: string;
}

export interface PackStateRow {
  envelope_json: string;
}

export interface CatalogPinRow {
  session_id: string;
  observation_json: string;
  updated_at: string;
}

export interface SandboxProofSessionRow {
  session_id: string;
  customer_id: string;
  authenticated: number;
  expires_at: string;
  order_id: string | null;
  provider_profile_json: string | null;
  created_at: string;
}

export interface ConversationProfileRow {
  channel: ConversationProfile['channel'];
  external_user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  profile_source: ConversationProfile['profileSource'];
  profile_updated_at: string;
}

export interface IrreversibleOperationRow {
  request_id: string;
  session_id: string;
  operation: string;
  binding_fingerprint: string;
  session_authority_generation: number;
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
  type: DashboardEvent['type'];
  payload: string;
  created_at: string;
}

export interface DashboardSessionSummary {
  sessionId: string;
  latestEventType: DashboardEvent['type'];
  updatedAt: string;
  sessionIntelligence: MonitorSessionIntelligence | null;
}

export interface WebhookDeliveryRow {
  channel: WebhookDeliveryChannel;
  external_event_id: string;
  external_thread_id: string;
  external_user_id: string;
  session_id: string;
  status: WebhookDelivery['status'];
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
  session_authority_generation: number;
  updated_at: string;
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
  received_at: string;
  updated_at: string;
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
  execution_lease_expires_at: string | null;
  coalesced_input_text: string;
  superseded_by_run_id: string | null;
  irreversible_side_effect_at: string | null;
  irreversible_tool_name: string | null;
  assistant_turn_id: string | null;
  delivery_status: AgentRun['deliveryStatus'];
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
  agent_model_binding_json: string | null;
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
  session_authority_generation: number;
  status: CustomerRun['status'];
  phase: CustomerRun['phase'];
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
  type: CustomerRunEvent['type'];
  occurred_at: string;
  payload: string;
}

export interface RecommendationReservationRow {
  session_id: string;
  idempotency_key: string;
  request_id: string;
  request_fingerprint: string;
  status: 'pending' | 'completed';
  owner_token: string;
  response_json: string | null;
  technical_json: string | null;
  recommendation_id: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface RecommendationDecisionRow {
  recommendation_id: string;
  request_id: string;
  order_flow_id: string;
  session_id: string;
  placement: string;
  response_json: string;
  technical_json: string;
  action_digest: string;
  request_fingerprint: string;
  state_revision_before: number;
  state_revision_after: number;
  recorded_at: string;
}

export interface RecommendationEventRow {
  event_id: string;
  event_fingerprint: string;
  schema_version: string;
  event_type: string;
  recommendation_id: string | null;
  request_id: string;
  order_flow_id: string;
  session_id: string;
  placement: string;
  occurred_at: string;
  recorded_at: string;
  actor: string;
  action_id: string | null;
  cart_revision: string | null;
  version_bindings_json: string;
  payload_json: string;
}

export interface RecommendationDemoCustomerHistoryRow {
  customer_ref: string;
  fixture_label: string;
  linked: number;
  completed_orders_json: string;
  favorites_json: string;
  updated_at: string;
}

export interface D1TableInfoRow {
  name: string;
}

export const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS conversation_turns (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    ordinal INTEGER NOT NULL,
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
  `CREATE UNIQUE INDEX IF NOT EXISTS conversation_turns_session_ordinal_idx
    ON conversation_turns (session_id, ordinal)`,
  `CREATE TABLE IF NOT EXISTS conversation_summaries (
    session_id TEXT PRIMARY KEY,
    schema_version INTEGER NOT NULL CHECK (schema_version = 1),
    text TEXT NOT NULL,
    through_ordinal INTEGER NOT NULL CHECK (through_ordinal > 0),
    revision INTEGER NOT NULL CHECK (revision > 0),
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS pack_state_projections (
    session_id TEXT NOT NULL,
    pack_id TEXT NOT NULL,
    pack_version TEXT NOT NULL,
    envelope_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (session_id, pack_id, pack_version)
  )`,
  `CREATE TABLE IF NOT EXISTS catalog_pin_projections (
    session_id TEXT PRIMARY KEY,
    observation_json TEXT NOT NULL CHECK (json_valid(observation_json)),
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sandbox_proof_sessions (
    session_id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    authenticated INTEGER NOT NULL CHECK (authenticated IN (0, 1)),
    expires_at TEXT NOT NULL,
    order_id TEXT,
    provider_profile_json TEXT CHECK (
      provider_profile_json IS NULL OR json_valid(provider_profile_json)
    ),
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
  `CREATE TABLE IF NOT EXISTS non_agent_text_deliveries (
    schema_version TEXT NOT NULL,
    request_key TEXT PRIMARY KEY,
    session_binding_digest TEXT NOT NULL,
    reserved_session_authority_generation INTEGER NOT NULL,
    channel TEXT NOT NULL,
    assistant_turn_id TEXT NOT NULL,
    agent_binding_digest TEXT NOT NULL,
    recipient_binding_digest TEXT NOT NULL,
    presentation_binding_digest TEXT NOT NULL,
    delivery_binding_digest TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN (
      'pending', 'sending', 'confirmed_sent', 'confirmed_not_sent',
      'outcome_unknown'
    )),
    delivery_attempt INTEGER NOT NULL CHECK (delivery_attempt BETWEEN 0 AND 3),
    delivery_attempt_token TEXT,
    sending_lease_expires_at TEXT,
    provider_message_id TEXT,
    outcome_code TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (
      (status = 'pending' AND delivery_attempt = 0
        AND delivery_attempt_token IS NULL
        AND sending_lease_expires_at IS NULL
        AND provider_message_id IS NULL AND outcome_code IS NULL)
      OR (status = 'sending' AND delivery_attempt BETWEEN 1 AND 3
        AND delivery_attempt_token IS NOT NULL
        AND sending_lease_expires_at IS NOT NULL
        AND provider_message_id IS NULL AND outcome_code IS NULL)
      OR (status = 'confirmed_sent' AND delivery_attempt BETWEEN 1 AND 3
        AND delivery_attempt_token IS NOT NULL
        AND sending_lease_expires_at IS NULL
        AND (channel = 'kfc' OR provider_message_id IS NOT NULL)
        AND outcome_code IS NULL)
      OR (status IN ('confirmed_not_sent', 'outcome_unknown')
        AND delivery_attempt BETWEEN 1 AND 3
        AND delivery_attempt_token IS NOT NULL
        AND sending_lease_expires_at IS NULL
        AND provider_message_id IS NULL AND outcome_code IS NOT NULL)
      OR (status = 'confirmed_not_sent' AND delivery_attempt = 0
        AND delivery_attempt_token IS NULL
        AND sending_lease_expires_at IS NULL
        AND provider_message_id IS NULL
        AND outcome_code = 'non_agent_delivery_abandoned_by_reset')
    )
  )`,
  `CREATE INDEX IF NOT EXISTS non_agent_text_deliveries_session_idx
    ON non_agent_text_deliveries (session_binding_digest, created_at)`,
  `CREATE INDEX IF NOT EXISTS non_agent_text_deliveries_recovery_idx
    ON non_agent_text_deliveries (status, sending_lease_expires_at)`,
  `CREATE TABLE IF NOT EXISTS non_agent_text_delivery_attempts (
    request_key TEXT NOT NULL,
    delivery_attempt INTEGER NOT NULL CHECK (delivery_attempt BETWEEN 1 AND 3),
    delivery_attempt_token TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (request_key, delivery_attempt),
    FOREIGN KEY (request_key) REFERENCES non_agent_text_deliveries(request_key)
      ON DELETE CASCADE
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
    session_authority_generation INTEGER NOT NULL DEFAULT 0,
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
    session_authority_generation INTEGER NOT NULL DEFAULT 0,
    channel TEXT NOT NULL,
    external_user_id TEXT NOT NULL,
    status TEXT NOT NULL,
    execution_attempt INTEGER NOT NULL DEFAULT 0 CHECK (execution_attempt >= 0),
    execution_lease_token TEXT,
    execution_lease_expires_at TEXT,
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
    updated_at TEXT NOT NULL,
    CHECK (
      (execution_lease_token IS NULL AND execution_lease_expires_at IS NULL)
      OR
      (execution_lease_token IS NOT NULL AND execution_lease_expires_at IS NOT NULL)
    )
  )`,
  `CREATE INDEX IF NOT EXISTS agent_runs_session_generation_idx
    ON agent_runs (session_id, generation, id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS agent_runs_session_generation_claim_idx
    ON agent_runs (session_id, generation)`,
  `CREATE INDEX IF NOT EXISTS agent_runs_execution_lease_recovery_idx
    ON agent_runs (status, execution_lease_expires_at)`,
  `CREATE TABLE IF NOT EXISTS agent_run_text_deliveries (
    schema_version TEXT NOT NULL
      CHECK (schema_version = 'kfc-agent-run-text-delivery-v1'),
    run_id TEXT PRIMARY KEY REFERENCES agent_runs(id) ON DELETE CASCADE
      CHECK (length(run_id) BETWEEN 1 AND 512 AND run_id = trim(run_id)),
    run_execution_attempt INTEGER NOT NULL
      CHECK (run_execution_attempt BETWEEN 1 AND 3),
    run_execution_origin_attempt INTEGER NOT NULL CHECK (
      run_execution_origin_attempt BETWEEN 1 AND 3
      AND run_execution_origin_attempt <= run_execution_attempt
    ),
    run_execution_lease_token TEXT NOT NULL
      CHECK (length(run_execution_lease_token) BETWEEN 1 AND 512
        AND run_execution_lease_token = trim(run_execution_lease_token)),
    run_execution_lease_token_digest TEXT NOT NULL
      CHECK (length(run_execution_lease_token_digest) = 64
        AND run_execution_lease_token_digest NOT GLOB '*[^0-9a-f]*'),
    prior_run_execution_lease_token_digests TEXT NOT NULL DEFAULT '[]'
      CHECK (json_valid(prior_run_execution_lease_token_digests)
        AND json_type(prior_run_execution_lease_token_digests) = 'array'
        AND json_array_length(
          prior_run_execution_lease_token_digests
        ) = run_execution_attempt - run_execution_origin_attempt),
    channel TEXT NOT NULL CHECK (channel IN ('messenger', 'zalo')),
    assistant_turn_id TEXT NOT NULL UNIQUE REFERENCES conversation_turns(id)
      CHECK (length(assistant_turn_id) BETWEEN 1 AND 512
        AND assistant_turn_id = trim(assistant_turn_id)),
    recipient_binding_digest TEXT NOT NULL
      CHECK (length(recipient_binding_digest) = 64
        AND recipient_binding_digest NOT GLOB '*[^0-9a-f]*'),
    presentation_binding_digest TEXT NOT NULL
      CHECK (length(presentation_binding_digest) = 64
        AND presentation_binding_digest NOT GLOB '*[^0-9a-f]*'),
    delivery_binding_digest TEXT NOT NULL
      CHECK (length(delivery_binding_digest) = 64
        AND delivery_binding_digest NOT GLOB '*[^0-9a-f]*'),
    status TEXT NOT NULL CHECK (status IN (
      'pending', 'sending', 'confirmed_not_sent',
      'confirmed_sent', 'delivery_outcome_unknown'
    )),
    delivery_attempt INTEGER NOT NULL CHECK (delivery_attempt BETWEEN 0 AND 3),
    last_delivery_run_execution_attempt INTEGER CHECK (
      last_delivery_run_execution_attempt IS NULL
      OR last_delivery_run_execution_attempt BETWEEN 1 AND 3
    ),
    delivery_attempt_token TEXT,
    provider_message_id TEXT,
    outcome_code TEXT,
    created_at TEXT NOT NULL CHECK (
      strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS NOT NULL
      AND
      strftime('%Y-%m-%dT%H:%M:%fZ', created_at) = created_at
    ),
    updated_at TEXT NOT NULL CHECK (
      strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) IS NOT NULL
      AND
      strftime('%Y-%m-%dT%H:%M:%fZ', updated_at) = updated_at
      AND updated_at >= created_at
    ),
    CHECK (
      (status = 'pending' AND delivery_attempt = 0
        AND delivery_attempt_token IS NULL
        AND last_delivery_run_execution_attempt IS NULL
        AND provider_message_id IS NULL AND outcome_code IS NULL)
      OR (status = 'sending' AND delivery_attempt BETWEEN 1 AND 3
        AND delivery_attempt_token IS NOT NULL
        AND last_delivery_run_execution_attempt IS NOT NULL
        AND last_delivery_run_execution_attempt = run_execution_attempt
        AND provider_message_id IS NULL AND outcome_code IS NULL)
      OR (status = 'confirmed_not_sent' AND delivery_attempt BETWEEN 1 AND 3
        AND delivery_attempt_token IS NOT NULL
        AND last_delivery_run_execution_attempt IS NOT NULL
        AND run_execution_attempt BETWEEN
          last_delivery_run_execution_attempt
          AND last_delivery_run_execution_attempt + 1
        AND provider_message_id IS NULL AND outcome_code IS NOT NULL)
      OR (status = 'confirmed_sent' AND delivery_attempt BETWEEN 1 AND 3
        AND delivery_attempt_token IS NOT NULL
        AND last_delivery_run_execution_attempt IS NOT NULL
        AND last_delivery_run_execution_attempt = run_execution_attempt
        AND provider_message_id IS NOT NULL AND outcome_code IS NULL)
      OR (status = 'delivery_outcome_unknown'
        AND delivery_attempt BETWEEN 1 AND 3
        AND delivery_attempt_token IS NOT NULL
        AND last_delivery_run_execution_attempt IS NOT NULL
        AND last_delivery_run_execution_attempt = run_execution_attempt
        AND provider_message_id IS NULL AND outcome_code IS NOT NULL)
    ),
    CHECK (delivery_attempt_token IS NULL OR
      (length(delivery_attempt_token) BETWEEN 1 AND 512
        AND delivery_attempt_token = trim(delivery_attempt_token))),
    CHECK (provider_message_id IS NULL OR
      (length(provider_message_id) BETWEEN 1 AND 512
        AND provider_message_id = trim(provider_message_id))),
    CHECK (outcome_code IS NULL OR
      (length(outcome_code) BETWEEN 1 AND 256
        AND outcome_code = trim(outcome_code)))
  )`,
  `CREATE INDEX IF NOT EXISTS agent_run_text_deliveries_recovery_idx
    ON agent_run_text_deliveries (status, updated_at)`,
  `CREATE TABLE IF NOT EXISTS agent_run_text_delivery_attempts (
    run_id TEXT NOT NULL
      REFERENCES agent_run_text_deliveries(run_id) ON DELETE CASCADE,
    delivery_attempt INTEGER NOT NULL CHECK (delivery_attempt BETWEEN 1 AND 3),
    delivery_attempt_token TEXT NOT NULL
      CHECK (length(delivery_attempt_token) BETWEEN 1 AND 512
        AND delivery_attempt_token = trim(delivery_attempt_token)),
    created_at TEXT NOT NULL CHECK (
      strftime('%Y-%m-%dT%H:%M:%fZ', created_at) IS NOT NULL
      AND
      strftime('%Y-%m-%dT%H:%M:%fZ', created_at) = created_at
    ),
    PRIMARY KEY (run_id, delivery_attempt),
    UNIQUE (delivery_attempt_token)
  )`,
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
    agent_model_binding_json TEXT,
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
    session_authority_generation INTEGER NOT NULL DEFAULT 0,
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
  `CREATE TABLE IF NOT EXISTS session_generations (
    session_id TEXT PRIMARY KEY,
    generation INTEGER NOT NULL CHECK (generation >= 0)
  )`,
  `CREATE TABLE IF NOT EXISTS irreversible_operations (
    request_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    binding_fingerprint TEXT NOT NULL,
    session_authority_generation INTEGER NOT NULL DEFAULT 0,
    result_json TEXT,
    status TEXT NOT NULL,
    attempt_count INTEGER NOT NULL,
    lease_expires_at TEXT,
    lease_token TEXT NOT NULL,
    last_error TEXT,
    created_at TEXT NOT NULL,
    completed_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS recommendation_request_reservations (
    session_id TEXT NOT NULL CHECK (length(session_id) > 0),
    idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) > 0),
    request_id TEXT NOT NULL CHECK (length(request_id) > 0),
    request_fingerprint TEXT NOT NULL CHECK (
      length(request_fingerprint) = 64
      AND request_fingerprint NOT GLOB '*[^a-f0-9]*'
    ),
    status TEXT NOT NULL CHECK (status IN ('pending', 'completed')),
    owner_token TEXT NOT NULL CHECK (length(owner_token) > 0),
    response_json TEXT CHECK (
      response_json IS NULL OR json_valid(response_json)
    ),
    technical_json TEXT CHECK (
      technical_json IS NULL OR json_valid(technical_json)
    ),
    recommendation_id TEXT,
    created_at TEXT NOT NULL CHECK (length(created_at) > 0),
    completed_at TEXT,
    PRIMARY KEY (session_id, idempotency_key),
    UNIQUE (request_id),
    CHECK (
      (
        status = 'pending'
        AND response_json IS NULL
        AND technical_json IS NULL
        AND recommendation_id IS NULL
        AND completed_at IS NULL
      )
      OR
      (
        status = 'completed'
        AND response_json IS NOT NULL
        AND technical_json IS NOT NULL
        AND recommendation_id IS NOT NULL
        AND completed_at IS NOT NULL
      )
    )
  )`,
  `CREATE TABLE IF NOT EXISTS recommendation_decisions (
    recommendation_id TEXT PRIMARY KEY CHECK (length(recommendation_id) > 0),
    request_id TEXT NOT NULL UNIQUE CHECK (length(request_id) > 0),
    order_flow_id TEXT NOT NULL CHECK (length(order_flow_id) > 0),
    session_id TEXT NOT NULL CHECK (length(session_id) > 0),
    placement TEXT NOT NULL CHECK (
      placement IN (
        'local_favorite',
        'for_you',
        'modifier_upsell',
        'smart_cross_sell'
      )
    ),
    response_json TEXT NOT NULL CHECK (json_valid(response_json)),
    technical_json TEXT NOT NULL CHECK (json_valid(technical_json)),
    action_digest TEXT NOT NULL CHECK (
      length(action_digest) = 64
      AND action_digest NOT GLOB '*[^a-f0-9]*'
    ),
    request_fingerprint TEXT NOT NULL CHECK (
      length(request_fingerprint) = 64
      AND request_fingerprint NOT GLOB '*[^a-f0-9]*'
    ),
    state_revision_before INTEGER NOT NULL CHECK (state_revision_before >= 0),
    state_revision_after INTEGER NOT NULL CHECK (
      state_revision_after > state_revision_before
    ),
    recorded_at TEXT NOT NULL CHECK (length(recorded_at) > 0)
  )`,
  `CREATE INDEX IF NOT EXISTS recommendation_decisions_order_flow_recorded_idx
    ON recommendation_decisions (
      order_flow_id, recorded_at, recommendation_id
    )`,
  `CREATE TABLE IF NOT EXISTS recommendation_events (
    event_id TEXT PRIMARY KEY CHECK (length(event_id) > 0),
    event_fingerprint TEXT NOT NULL CHECK (
      length(event_fingerprint) = 64
      AND event_fingerprint NOT GLOB '*[^a-f0-9]*'
    ),
    schema_version TEXT NOT NULL CHECK (
      schema_version = 'kfc-recommendation-event-v1'
    ),
    event_type TEXT NOT NULL CHECK (
      event_type IN (
        'decision_requested',
        'decision_completed',
        'candidate_eligibility_summary',
        'impression_rendered',
        'selected',
        'explicitly_dismissed',
        'ignored',
        'superseded',
        'cart_mutation_succeeded',
        'cart_mutation_failed',
        'checkout_completed',
        'order_abandoned',
        'order_cancelled'
      )
    ),
    recommendation_id TEXT,
    request_id TEXT NOT NULL CHECK (length(request_id) > 0),
    order_flow_id TEXT NOT NULL CHECK (length(order_flow_id) > 0),
    session_id TEXT NOT NULL CHECK (length(session_id) > 0),
    placement TEXT NOT NULL CHECK (
      placement IN (
        'local_favorite',
        'for_you',
        'modifier_upsell',
        'smart_cross_sell'
      )
    ),
    occurred_at TEXT NOT NULL CHECK (length(occurred_at) > 0),
    recorded_at TEXT NOT NULL CHECK (length(recorded_at) > 0),
    actor TEXT NOT NULL CHECK (
      actor IN ('customer', 'agent', 'system', 'client')
    ),
    action_id TEXT,
    cart_revision TEXT,
    version_bindings_json TEXT NOT NULL CHECK (
      json_valid(version_bindings_json)
    ),
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json))
  )`,
  `CREATE INDEX IF NOT EXISTS recommendation_events_order_flow_occurred_idx
    ON recommendation_events (order_flow_id, occurred_at, event_id)`,
  `CREATE INDEX IF NOT EXISTS recommendation_events_recommendation_occurred_idx
    ON recommendation_events (recommendation_id, occurred_at, event_id)`,
  `CREATE INDEX IF NOT EXISTS recommendation_events_session_occurred_idx
    ON recommendation_events (session_id, occurred_at, event_id)`,
  `CREATE TABLE IF NOT EXISTS recommendation_demo_customer_history (
    customer_ref TEXT PRIMARY KEY,
    fixture_label TEXT NOT NULL,
    linked INTEGER NOT NULL CHECK (linked IN (0, 1)),
    completed_orders_json TEXT NOT NULL CHECK (
      json_valid(completed_orders_json)
    ),
    favorites_json TEXT NOT NULL CHECK (json_valid(favorites_json)),
    updated_at TEXT NOT NULL
  )`,
  `INSERT OR IGNORE INTO recommendation_demo_customer_history (
    customer_ref,
    fixture_label,
    linked,
    completed_orders_json,
    favorites_json,
    updated_at
  ) VALUES
    (
      'demo-returning-linked',
      'Mock/synthetic POC returning customer',
      1,
      '[{"orderId":"synthetic-poc-order-001","completedAt":"2026-07-20T09:00:00Z","lines":[{"sellableItemId":"20751","categoryId":"20000","quantity":1}]}]',
      '["20751"]',
      '2026-07-27T00:00:00Z'
    ),
    (
      'demo-linked-zero-history',
      'Mock/synthetic POC linked customer with zero history',
      1,
      '[]',
      '[]',
      '2026-07-27T00:00:00Z'
    ),
    (
      'demo-anonymous-unlinked',
      'Mock/synthetic POC anonymous unlinked journey',
      0,
      '[]',
      '[]',
      '2026-07-27T00:00:00Z'
    )`,
];

export function parsePayload(value: string): Record<string, unknown> {
  return JSON.parse(value) as Record<string, unknown>;
}

export function turnFromRow(row: ConversationTurnRow): ConversationTurn {
  return {
    id: row.id,
    ordinal: Number(row.ordinal),
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

export function profileFromRow(
  row: ConversationProfileRow,
): ConversationProfile {
  return {
    channel: row.channel,
    externalUserId: row.external_user_id,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    profileSource: row.profile_source,
    profileUpdatedAt: row.profile_updated_at,
  };
}

export function catalogPinFromRow(row: CatalogPinRow): CatalogPinProjection {
  return {
    sessionId: row.session_id,
    observation: JSON.parse(row.observation_json) as CatalogObservation,
    updatedAt: row.updated_at,
  };
}

export function sandboxProofSessionFromRow(
  row: SandboxProofSessionRow,
): SandboxProofSession {
  return {
    sessionId: row.session_id,
    customerId: row.customer_id,
    authenticated: row.authenticated === 1,
    expiresAt: row.expires_at,
    orderId: row.order_id,
    providerProfile: row.provider_profile_json
      ? (JSON.parse(row.provider_profile_json) as Record<string, unknown>)
      : null,
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

export function webhookDeliveryFromRow(
  row: WebhookDeliveryRow,
): WebhookDelivery {
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
    sessionAuthorityGeneration: Number(row.session_authority_generation),
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
    sessionAuthorityGeneration: Number(row.session_authority_generation),
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

export function customerRunEventFromRow(
  row: CustomerRunEventRow,
): CustomerRunEvent {
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
    agentMode: 'ai_active',
    assignedAgentId: null,
    sessionAuthorityGeneration: 0,
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
    sessionAuthorityGeneration: Number(row.session_authority_generation),
    channel: row.channel,
    externalUserId: row.external_user_id,
    status: row.status,
    executionAttempt: Number(row.execution_attempt),
    executionLeaseToken: row.execution_lease_token,
    executionLeaseExpiresAt: row.execution_lease_expires_at,
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
    agentModelBinding: sessionAgentModelBindingFromJson(
      row.agent_model_binding_json,
    ),
    updatedAt: row.updated_at,
  };
}

export function defaultSessionAgentState(sessionId: string): SessionAgentState {
  return {
    sessionId,
    currentRunId: null,
    generation: 0,
    debounceDeadlineAt: null,
    agentModelBinding: null,
    updatedAt: new Date().toISOString(),
  };
}

export function sessionAgentModelBindingJson(
  binding: SessionAgentModelBinding,
): string {
  return JSON.stringify({
    candidateId: binding.candidateId,
    provider: binding.provider,
    model: binding.model,
    profile: binding.profile,
    transport: binding.transport,
  });
}

function sessionAgentModelBindingFromJson(
  value: string | null,
): SessionAgentModelBinding | null {
  if (value === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('session_agent_model_binding_invalid');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('session_agent_model_binding_invalid');
  }
  const record = parsed as Record<string, unknown>;
  const keys = ['candidateId', 'provider', 'model', 'profile', 'transport'];
  if (
    keys.some(
      (key) =>
        typeof record[key] !== 'string' ||
        (record[key] as string).trim().length === 0,
    )
  ) {
    throw new Error('session_agent_model_binding_invalid');
  }
  return {
    candidateId: record.candidateId as string,
    provider: record.provider as string,
    model: record.model as string,
    profile: record.profile as string,
    transport: record.transport as string,
  };
}
