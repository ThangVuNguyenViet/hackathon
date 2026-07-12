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
  ImportedConversationTurn,
  ImportedConversationTurnResult,
  PendingCustomerTurnInput,
  ReserveWebhookDeliveryInput,
  ReserveWebhookDeliveryResult,
  SessionControl,
  SessionAgentStateInput,
  StoredEvent,
  UpsertPendingCustomerTurnResult,
  WebhookDelivery,
  WebhookDeliveryChannel,
  AppendCustomerRunEventInput,
  StreamingAssignmentRecord,
} from "./memoryStore.js";
import {
  CustomerRunIdempotencyConflictError,
  CustomerRunSequenceConflictError,
  customerRunEventSchema,
  type CustomerRun,
  type CustomerRunEvent,
} from "../customerRuns/contracts.js";

interface D1Result<T = Record<string, unknown>> {
  results?: T[] | undefined;
  success: boolean;
  meta: Record<string, unknown>;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  run(): Promise<D1Result>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatement;
  batch?(statements: D1PreparedStatement[]): Promise<D1Result[]>;
}

interface ConversationTurnRow {
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

interface ConversationProfileRow {
  channel: ConversationProfile["channel"];
  external_user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  profile_source: ConversationProfile["profileSource"];
  profile_updated_at: string;
}

interface StoredEventRow {
  id: string;
  session_id: string;
  source_type: string;
  payload: string;
  created_at: string;
}

interface DashboardEventRow {
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

interface WebhookDeliveryRow {
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

interface SessionControlRow {
  session_id: string;
  agent_mode: AgentMode;
  assigned_agent_id: string | null;
  updated_at: string;
}

interface PendingCustomerTurnRow {
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

interface AgentRunRow {
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

interface AgentRunTurnRow {
  run_id: string;
  turn_id: string;
  sequence: number;
}

interface SessionAgentStateRow {
  session_id: string;
  current_run_id: string | null;
  generation: number;
  debounce_deadline_at: string | null;
  updated_at: string;
}

interface StreamingAssignmentRow {
  session_id: string;
  client_message_id: string;
  request_fingerprint: string;
  path: StreamingAssignmentRecord["path"];
  reason: StreamingAssignmentRecord["reason"];
  policy_revision: string;
  schema_version: number | null;
  provisional_genui_enabled: number;
  run_id: string | null;
  assigned_at: string;
}

interface CustomerRunRow {
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
  rollout_policy_revision: string;
  client_app_version: string;
  client_schema_version: number;
  provisional_genui_enabled: number;
  accepted_at: string;
  started_at: string | null;
  terminal_at: string | null;
  updated_at: string;
}

interface CustomerRunEventRow {
  event_id: string;
  run_id: string;
  sequence: number;
  schema_version: 1;
  type: CustomerRunEvent["type"];
  occurred_at: string;
  payload: string;
}

interface D1TableInfoRow {
  name: string;
}

const schemaStatements = [
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
  `CREATE TABLE IF NOT EXISTS customer_streaming_assignments (
    session_id TEXT NOT NULL,
    client_message_id TEXT NOT NULL,
    request_fingerprint TEXT NOT NULL,
    path TEXT NOT NULL,
    reason TEXT NOT NULL,
    policy_revision TEXT NOT NULL,
    schema_version INTEGER,
    provisional_genui_enabled INTEGER NOT NULL,
    run_id TEXT,
    assigned_at TEXT NOT NULL,
    PRIMARY KEY (session_id, client_message_id)
  )`,
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
    rollout_policy_revision TEXT NOT NULL,
    client_app_version TEXT NOT NULL,
    client_schema_version INTEGER NOT NULL,
    provisional_genui_enabled INTEGER NOT NULL,
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
];

export class D1Store implements ConversationStore {
  constructor(private readonly db: D1DatabaseLike) {}

  async initialize(): Promise<void> {
    if (this.db.batch) {
      await this.db.batch(
        schemaStatements.map((statement) => this.db.prepare(statement)),
      );
    } else {
      for (const statement of schemaStatements) {
        await this.db.prepare(statement).run();
      }
    }
    await this.ensureConversationTurnMetadataColumn();
    await this.ensureConversationProfilesTable();
    await this.ensureSessionControlsTable();
  }

  async saveStreamingAssignment(
    input: StreamingAssignmentRecord,
  ): Promise<StreamingAssignmentRecord> {
    const existing = await this.findStreamingAssignment(
      input.sessionId,
      input.clientMessageId,
    );
    if (existing) {
      if (existing.requestFingerprint !== input.requestFingerprint) {
        throw new CustomerRunIdempotencyConflictError(
          input.sessionId,
          input.clientMessageId,
        );
      }
      return existing;
    }
    await this.db
      .prepare(
        `INSERT OR IGNORE INTO customer_streaming_assignments (
          session_id, client_message_id, request_fingerprint, path, reason,
          policy_revision, schema_version, provisional_genui_enabled, run_id, assigned_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.sessionId,
        input.clientMessageId,
        input.requestFingerprint,
        input.path,
        input.reason,
        input.policyRevision,
        input.schemaVersion,
        input.provisionalGenUiEnabled ? 1 : 0,
        input.runId,
        input.assignedAt,
      )
      .run();
    const stored = await this.findStreamingAssignment(
      input.sessionId,
      input.clientMessageId,
    );
    if (!stored) throw new Error("Streaming assignment was not persisted");
    if (stored.requestFingerprint !== input.requestFingerprint) {
      throw new CustomerRunIdempotencyConflictError(
        input.sessionId,
        input.clientMessageId,
      );
    }
    return stored;
  }

  async findStreamingAssignment(
    sessionId: string,
    clientMessageId: string,
  ): Promise<StreamingAssignmentRecord | undefined> {
    const row = await this.db
      .prepare(
        `SELECT * FROM customer_streaming_assignments
         WHERE session_id = ? AND client_message_id = ? LIMIT 1`,
      )
      .bind(sessionId, clientMessageId)
      .first<StreamingAssignmentRow>();
    return row ? streamingAssignmentFromRow(row) : undefined;
  }

  async createCustomerRun(input: CustomerRun): Promise<CustomerRun> {
    const existing = await this.findCustomerRunByRequest(
      input.sessionId,
      input.clientMessageId,
    );
    if (existing) {
      if (existing.requestFingerprint !== input.requestFingerprint) {
        throw new CustomerRunIdempotencyConflictError(
          input.sessionId,
          input.clientMessageId,
        );
      }
      return existing;
    }
    await this.db
      .prepare(
        `INSERT OR IGNORE INTO customer_runs (
          id, schema_version, session_id, customer_id, client_message_id,
          request_fingerprint, generation, status, phase, next_event_sequence,
          rollout_policy_revision, client_app_version, client_schema_version,
          provisional_genui_enabled, accepted_at, started_at, terminal_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.id,
        input.schemaVersion,
        input.sessionId,
        input.customerId,
        input.clientMessageId,
        input.requestFingerprint,
        input.generation,
        input.status,
        input.phase,
        input.nextEventSequence,
        input.rolloutPolicyRevision,
        input.clientAppVersion,
        input.clientSchemaVersion,
        input.provisionalGenUiEnabled ? 1 : 0,
        input.acceptedAt,
        input.startedAt,
        input.terminalAt,
        input.updatedAt,
      )
      .run();
    const stored = await this.findCustomerRunByRequest(
      input.sessionId,
      input.clientMessageId,
    );
    if (!stored) throw new Error("Customer run was not persisted");
    if (stored.requestFingerprint !== input.requestFingerprint) {
      throw new CustomerRunIdempotencyConflictError(
        input.sessionId,
        input.clientMessageId,
      );
    }
    return stored;
  }

  async getCustomerRun(runId: string): Promise<CustomerRun | undefined> {
    const row = await this.db
      .prepare(`SELECT * FROM customer_runs WHERE id = ? LIMIT 1`)
      .bind(runId)
      .first<CustomerRunRow>();
    return row ? customerRunFromRow(row) : undefined;
  }

  async findCustomerRunByRequest(
    sessionId: string,
    clientMessageId: string,
  ): Promise<CustomerRun | undefined> {
    const row = await this.db
      .prepare(
        `SELECT * FROM customer_runs
         WHERE session_id = ? AND client_message_id = ? LIMIT 1`,
      )
      .bind(sessionId, clientMessageId)
      .first<CustomerRunRow>();
    return row ? customerRunFromRow(row) : undefined;
  }

  async appendCustomerRunEvent(
    input: AppendCustomerRunEventInput,
  ): Promise<CustomerRunEvent> {
    const run = await this.getCustomerRun(input.runId);
    if (!run) throw new Error(`Customer run not found: ${input.runId}`);
    if (run.nextEventSequence !== input.expectedSequence) {
      throw new CustomerRunSequenceConflictError(
        input.runId,
        input.expectedSequence,
        run.nextEventSequence,
      );
    }
    if (!this.db.batch) {
      throw new Error("Atomic D1 batch support is required for customer run events");
    }
    const { expectedSequence, ...eventInput } = input;
    const event = customerRunEventSchema.parse({
      ...eventInput,
      sequence: expectedSequence,
    });
    const results = await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO customer_run_events (
            event_id, run_id, sequence, schema_version, type, occurred_at, payload
          )
          SELECT ?, ?, ?, ?, ?, ?, ? FROM customer_runs
          WHERE id = ? AND next_event_sequence = ?`,
        )
        .bind(
          event.eventId,
          event.runId,
          event.sequence,
          event.schemaVersion,
          event.type,
          event.occurredAt,
          JSON.stringify(event.payload),
          event.runId,
          event.sequence,
        ),
      this.db
        .prepare(
          `UPDATE customer_runs
           SET next_event_sequence = ?, updated_at = ?
           WHERE id = ? AND next_event_sequence = ?`,
        )
        .bind(event.sequence + 1, event.occurredAt, event.runId, event.sequence),
    ]);
    if (Number(results[0]?.meta["changes"] ?? 0) !== 1) {
      const actual = (await this.getCustomerRun(event.runId))?.nextEventSequence ?? 0;
      throw new CustomerRunSequenceConflictError(
        event.runId,
        event.sequence,
        actual,
      );
    }
    return event;
  }

  async listCustomerRunEvents(
    runId: string,
    afterSequence = 0,
  ): Promise<CustomerRunEvent[]> {
    const rows = await this.db
      .prepare(
        `SELECT * FROM customer_run_events
         WHERE run_id = ? AND sequence > ? ORDER BY sequence ASC`,
      )
      .bind(runId, afterSequence)
      .all<CustomerRunEventRow>();
    return (rows.results ?? []).map(customerRunEventFromRow);
  }

  async upsertProfile(
    input: ConversationProfile,
  ): Promise<ConversationProfile> {
    await this.db
      .prepare(
        `INSERT INTO conversation_profiles (
          channel, external_user_id, display_name, avatar_url, profile_source, profile_updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(channel, external_user_id) DO UPDATE SET
          display_name = excluded.display_name,
          avatar_url = excluded.avatar_url,
          profile_source = excluded.profile_source,
          profile_updated_at = excluded.profile_updated_at`,
      )
      .bind(
        input.channel,
        input.externalUserId,
        input.displayName,
        input.avatarUrl,
        input.profileSource,
        input.profileUpdatedAt,
      )
      .run();
    return input;
  }

  async getProfile(
    channel: ConversationProfile["channel"],
    externalUserId: string,
  ): Promise<ConversationProfile | undefined> {
    const row = await this.db
      .prepare(
        `SELECT * FROM conversation_profiles WHERE channel = ? AND external_user_id = ? LIMIT 1`,
      )
      .bind(channel, externalUserId)
      .first<ConversationProfileRow>();
    return row ? profileFromRow(row) : undefined;
  }

  async listProfiles(limit = 200): Promise<ConversationProfile[]> {
    const rows = await this.db
      .prepare(
        `SELECT * FROM conversation_profiles ORDER BY profile_updated_at DESC LIMIT ?`,
      )
      .bind(limit)
      .all<ConversationProfileRow>();
    return (rows.results ?? []).map(profileFromRow);
  }

  async appendTurn(
    input: AppendConversationTurnInput,
  ): Promise<ConversationTurn> {
    const existing =
      input.externalMessageId === null
        ? undefined
        : await this.findTurnByExternalMessage(
            input.sessionId,
            input.externalMessageId,
          );
    if (existing) return existing;

    const turn: ConversationTurn = {
      ...input,
      metadata: input.metadata ?? null,
      id: `turn_${crypto.randomUUID()}`,
      createdAt: input.createdAt ?? new Date().toISOString(),
    };
    await this.db
      .prepare(
        `INSERT INTO conversation_turns (
          id, session_id, channel, role, text, external_message_id, external_user_id, delivery_status, metadata, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        turn.id,
        turn.sessionId,
        turn.channel,
        turn.role,
        turn.text,
        turn.externalMessageId,
        turn.externalUserId,
        turn.deliveryStatus,
        JSON.stringify(turn.metadata),
        turn.createdAt,
      )
      .run();
    await this.appendEvent(input.sessionId, `conversation_turn:${input.role}`, {
      text: input.text,
      channel: input.channel,
      deliveryStatus: input.deliveryStatus,
      externalMessageId: input.externalMessageId,
      externalUserId: input.externalUserId,
      metadata: input.metadata,
    });
    return turn;
  }

  async upsertImportedTurn(
    input: ImportedConversationTurn,
  ): Promise<ImportedConversationTurnResult> {
    const existing =
      input.externalMessageId === null
        ? undefined
        : await this.findTurnByExternalMessage(
            input.sessionId,
            input.externalMessageId,
          );
    if (existing) {
      await this.db
        .prepare(
          `UPDATE conversation_turns
           SET channel = ?, role = ?, text = ?, external_user_id = ?, delivery_status = ?, metadata = ?, created_at = ?
           WHERE id = ?`,
        )
        .bind(
          input.channel,
          input.role,
          input.text,
          input.externalUserId,
          input.deliveryStatus,
          JSON.stringify(input.metadata ?? null),
          input.createdAt,
          existing.id,
        )
        .run();
      return {
        turn: {
          ...existing,
          channel: input.channel,
          role: input.role,
          text: input.text,
          externalUserId: input.externalUserId,
          deliveryStatus: input.deliveryStatus,
          metadata: input.metadata ?? null,
          createdAt: input.createdAt,
        },
        inserted: false,
      };
    }

    const turn: ConversationTurn = {
      ...input,
      metadata: input.metadata ?? null,
      id: input.id ?? `turn_${crypto.randomUUID()}`,
    };
    await this.db
      .prepare(
        `INSERT INTO conversation_turns (
          id, session_id, channel, role, text, external_message_id, external_user_id, delivery_status, metadata, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        turn.id,
        turn.sessionId,
        turn.channel,
        turn.role,
        turn.text,
        turn.externalMessageId,
        turn.externalUserId,
        turn.deliveryStatus,
        JSON.stringify(turn.metadata),
        turn.createdAt,
      )
      .run();
    await this.appendEvent(input.sessionId, `conversation_turn:${input.role}`, {
      text: input.text,
      channel: input.channel,
      deliveryStatus: input.deliveryStatus,
      externalMessageId: input.externalMessageId,
      externalUserId: input.externalUserId,
      metadata: input.metadata,
    });
    return { turn, inserted: true };
  }

  async findTurnByExternalMessage(
    sessionId: string,
    externalMessageId: string,
  ): Promise<ConversationTurn | undefined> {
    const row = await this.db
      .prepare(
        `SELECT * FROM conversation_turns
         WHERE session_id = ? AND external_message_id = ?
         ORDER BY created_at ASC, id ASC
         LIMIT 1`,
      )
      .bind(sessionId, externalMessageId)
      .first<ConversationTurnRow>();
    return row ? turnFromRow(row) : undefined;
  }

  async reserveWebhookDelivery(
    input: ReserveWebhookDeliveryInput,
  ): Promise<ReserveWebhookDeliveryResult> {
    const existing = await this.getWebhookDelivery(
      input.channel,
      input.externalEventId,
    );
    if (existing) return { delivery: existing, reserved: false };

    const now = new Date().toISOString();
    await this.db
      .prepare(
        `INSERT INTO webhook_deliveries (
          channel, external_event_id, external_thread_id, external_user_id, session_id, status, payload,
          received_at, processed_at, failed_at, last_error, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'received', ?, ?, NULL, NULL, NULL, ?, ?)`,
      )
      .bind(
        input.channel,
        input.externalEventId,
        input.externalThreadId,
        input.externalUserId,
        input.sessionId,
        JSON.stringify(input.payload),
        input.receivedAt,
        now,
        now,
      )
      .run();
    const delivery = await this.getWebhookDelivery(
      input.channel,
      input.externalEventId,
    );
    if (!delivery)
      throw new Error(
        `Failed to reserve webhook delivery: ${input.channel}:${input.externalEventId}`,
      );
    return { delivery, reserved: true };
  }

  async markWebhookDeliveryProcessed(
    channel: WebhookDeliveryChannel,
    externalEventId: string,
  ): Promise<WebhookDelivery> {
    return this.updateWebhookDelivery(
      channel,
      externalEventId,
      "processed",
      null,
    );
  }

  async markWebhookDeliveryFailed(
    channel: WebhookDeliveryChannel,
    externalEventId: string,
    lastError: string,
  ): Promise<WebhookDelivery> {
    return this.updateWebhookDelivery(
      channel,
      externalEventId,
      "failed",
      lastError,
    );
  }

  async getWebhookDelivery(
    channel: WebhookDeliveryChannel,
    externalEventId: string,
  ): Promise<WebhookDelivery | undefined> {
    const row = await this.db
      .prepare(
        `SELECT * FROM webhook_deliveries WHERE channel = ? AND external_event_id = ? LIMIT 1`,
      )
      .bind(channel, externalEventId)
      .first<WebhookDeliveryRow>();
    return row ? webhookDeliveryFromRow(row) : undefined;
  }

  async listStaleWebhookDeliveries(
    channel: WebhookDeliveryChannel,
    receivedBefore: string,
    limit: number,
  ): Promise<WebhookDelivery[]> {
    const rows = await this.db
      .prepare(
        `SELECT * FROM webhook_deliveries
         WHERE channel = ? AND status = 'received' AND received_at < ?
         ORDER BY received_at ASC, external_event_id ASC
         LIMIT ?`,
      )
      .bind(channel, receivedBefore, Math.max(0, limit))
      .all<WebhookDeliveryRow>();
    return (rows.results ?? []).map(webhookDeliveryFromRow);
  }

  async updateTurnDeliveryStatus(
    turnId: string,
    deliveryStatus: ConversationTurn["deliveryStatus"],
    externalMessageId: string | null,
  ): Promise<ConversationTurn> {
    await this.db
      .prepare(
        `UPDATE conversation_turns SET delivery_status = ?, external_message_id = ? WHERE id = ?`,
      )
      .bind(deliveryStatus, externalMessageId, turnId)
      .run();
    const rows = await this.db
      .prepare(`SELECT * FROM conversation_turns WHERE id = ? LIMIT 1`)
      .bind(turnId)
      .all<ConversationTurnRow>();
    const row = rows.results?.[0];
    if (!row) throw new Error(`Conversation turn not found: ${turnId}`);
    return turnFromRow(row);
  }

  async getSessionControl(sessionId: string): Promise<SessionControl> {
    const row = await this.db
      .prepare(`SELECT * FROM session_controls WHERE session_id = ? LIMIT 1`)
      .bind(sessionId)
      .first<SessionControlRow>();
    return row ? sessionControlFromRow(row) : defaultSessionControl(sessionId);
  }

  async listSessionControls(
    sessionIds: string[],
  ): Promise<Map<string, SessionControl>> {
    if (sessionIds.length === 0) return new Map();
    const placeholders = sessionIds.map(() => "?").join(", ");
    const rows = await this.db
      .prepare(
        `SELECT session_id, agent_mode, assigned_agent_id, updated_at
         FROM session_controls
         WHERE session_id IN (${placeholders})`,
      )
      .bind(...sessionIds)
      .all<SessionControlRow>();
    return new Map(
      (rows.results ?? []).map((row) => [
        row.session_id,
        sessionControlFromRow(row),
      ]),
    );
  }

  async setSessionControl(
    sessionId: string,
    patch: { agentMode: AgentMode; assignedAgentId?: string | null | undefined },
  ): Promise<SessionControl> {
    const current = await this.getSessionControl(sessionId);
    const updated: SessionControl = {
      sessionId,
      agentMode: patch.agentMode,
      assignedAgentId:
        patch.assignedAgentId === undefined
          ? current.assignedAgentId
          : patch.assignedAgentId,
      updatedAt: new Date().toISOString(),
    };
    await this.db
      .prepare(
        `INSERT INTO session_controls (session_id, agent_mode, assigned_agent_id, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET
           agent_mode = excluded.agent_mode,
           assigned_agent_id = excluded.assigned_agent_id,
           updated_at = excluded.updated_at`,
      )
      .bind(
        updated.sessionId,
        updated.agentMode,
        updated.assignedAgentId,
        updated.updatedAt,
      )
      .run();
    return updated;
  }

  async resetSession(sessionId: string): Promise<SessionControl> {
    const statements = [
      this.db
        .prepare(`DELETE FROM conversation_turns WHERE session_id = ?`)
        .bind(sessionId),
      this.db
        .prepare(`DELETE FROM conversation_events WHERE session_id = ?`)
        .bind(sessionId),
      this.db
        .prepare(`DELETE FROM dashboard_events WHERE session_id = ?`)
        .bind(sessionId),
      this.db
        .prepare(`DELETE FROM session_controls WHERE session_id = ?`)
        .bind(sessionId),
    ];
    if (this.db.batch) {
      await this.db.batch(statements);
    } else {
      for (const statement of statements) await statement.run();
    }
    return this.setSessionControl(sessionId, {
      agentMode: "ai_active",
      assignedAgentId: null,
    });
  }

  async upsertPendingCustomerTurn(
    input: PendingCustomerTurnInput,
  ): Promise<UpsertPendingCustomerTurnResult> {
    const existing = await this.db
      .prepare(
        `SELECT * FROM pending_customer_turns
         WHERE session_id = ? AND external_message_id = ?
         LIMIT 1`,
      )
      .bind(input.sessionId, input.externalMessageId)
      .first<PendingCustomerTurnRow>();
    if (existing)
      return { turn: pendingCustomerTurnFromRow(existing), inserted: false };

    const now = input.updatedAt ?? new Date().toISOString();
    await this.db
      .prepare(
        `INSERT INTO pending_customer_turns (
          turn_id, session_id, channel, external_message_id, external_user_id, text, steer_mode,
          status, claimed_run_id, received_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.turnId,
        input.sessionId,
        input.channel,
        input.externalMessageId,
        input.externalUserId,
        input.text,
        input.steerMode,
        input.status,
        input.claimedRunId,
        input.receivedAt,
        now,
      )
      .run();
    const turn = await this.db
      .prepare(`SELECT * FROM pending_customer_turns WHERE turn_id = ? LIMIT 1`)
      .bind(input.turnId)
      .first<PendingCustomerTurnRow>();
    if (!turn)
      throw new Error(
        `Pending customer turn not found after insert: ${input.turnId}`,
      );
    return { turn: pendingCustomerTurnFromRow(turn), inserted: true };
  }

  async listPendingCustomerTurns(
    sessionId: string,
  ): Promise<PendingCustomerTurn[]> {
    const rows = await this.db
      .prepare(
        `SELECT * FROM pending_customer_turns WHERE session_id = ? ORDER BY received_at ASC, turn_id ASC`,
      )
      .bind(sessionId)
      .all<PendingCustomerTurnRow>();
    return (rows.results ?? []).map(pendingCustomerTurnFromRow);
  }

  async markPendingCustomerTurnClaimed(
    turnId: string,
    runId: string,
  ): Promise<PendingCustomerTurn> {
    const now = new Date().toISOString();
    await this.db
      .prepare(
        `UPDATE pending_customer_turns
         SET status = 'claimed', claimed_run_id = ?, updated_at = ?
         WHERE turn_id = ?`,
      )
      .bind(runId, now, turnId)
      .run();
    const row = await this.db
      .prepare(`SELECT * FROM pending_customer_turns WHERE turn_id = ? LIMIT 1`)
      .bind(turnId)
      .first<PendingCustomerTurnRow>();
    if (!row) throw new Error(`Pending customer turn not found: ${turnId}`);
    return pendingCustomerTurnFromRow(row);
  }

  async createAgentRun(input: CreateAgentRunInput): Promise<AgentRun> {
    const run: AgentRun = {
      ...input,
      supersededByRunId: input.supersededByRunId ?? null,
      irreversibleSideEffectAt: input.irreversibleSideEffectAt ?? null,
      irreversibleToolName: input.irreversibleToolName ?? null,
      assistantTurnId: input.assistantTurnId ?? null,
      deliveryExternalMessageId: input.deliveryExternalMessageId ?? null,
      errorCode: input.errorCode ?? null,
      errorMessage: input.errorMessage ?? null,
      startedAt: input.startedAt ?? null,
      completedAt: input.completedAt ?? null,
      updatedAt: input.updatedAt ?? new Date().toISOString(),
    };
    await this.db
      .prepare(
        `INSERT INTO agent_runs (
          id, session_id, generation, channel, external_user_id, status, coalesced_input_text,
          superseded_by_run_id, irreversible_side_effect_at, irreversible_tool_name, assistant_turn_id,
          delivery_status, delivery_external_message_id, error_code, error_message,
          scheduled_at, started_at, completed_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        run.id,
        run.sessionId,
        run.generation,
        run.channel,
        run.externalUserId,
        run.status,
        run.coalescedInputText,
        run.supersededByRunId,
        run.irreversibleSideEffectAt,
        run.irreversibleToolName,
        run.assistantTurnId,
        run.deliveryStatus,
        run.deliveryExternalMessageId,
        run.errorCode,
        run.errorMessage,
        run.scheduledAt,
        run.startedAt,
        run.completedAt,
        run.updatedAt,
      )
      .run();
    return run;
  }

  async updateAgentRun(runId: string, patch: AgentRunPatch): Promise<AgentRun> {
    const existing = await this.getAgentRun(runId);
    if (!existing) throw new Error(`Agent run not found: ${runId}`);
    const updated: AgentRun = {
      ...existing,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    await this.db
      .prepare(
        `UPDATE agent_runs
         SET status = ?,
             superseded_by_run_id = ?,
             irreversible_side_effect_at = ?,
             irreversible_tool_name = ?,
             assistant_turn_id = ?,
             delivery_status = ?,
             delivery_external_message_id = ?,
             error_code = ?,
             error_message = ?,
             started_at = ?,
             completed_at = ?,
             updated_at = ?
         WHERE id = ?`,
      )
      .bind(
        updated.status,
        updated.supersededByRunId,
        updated.irreversibleSideEffectAt,
        updated.irreversibleToolName,
        updated.assistantTurnId,
        updated.deliveryStatus,
        updated.deliveryExternalMessageId,
        updated.errorCode,
        updated.errorMessage,
        updated.startedAt,
        updated.completedAt,
        updated.updatedAt,
        runId,
      )
      .run();
    return updated;
  }

  async getAgentRun(runId: string): Promise<AgentRun | undefined> {
    const row = await this.db
      .prepare(`SELECT * FROM agent_runs WHERE id = ? LIMIT 1`)
      .bind(runId)
      .first<AgentRunRow>();
    return row ? agentRunFromRow(row) : undefined;
  }

  async listAgentRuns(sessionId: string): Promise<AgentRun[]> {
    const rows = await this.db
      .prepare(
        `SELECT * FROM agent_runs WHERE session_id = ? ORDER BY generation ASC, id ASC`,
      )
      .bind(sessionId)
      .all<AgentRunRow>();
    return (rows.results ?? []).map(agentRunFromRow);
  }

  async linkAgentRunTurn(input: AgentRunTurn): Promise<AgentRunTurn> {
    await this.db
      .prepare(
        `INSERT OR IGNORE INTO agent_run_turns (run_id, turn_id, sequence) VALUES (?, ?, ?)`,
      )
      .bind(input.runId, input.turnId, input.sequence)
      .run();
    return input;
  }

  async listAgentRunTurns(runId: string): Promise<AgentRunTurn[]> {
    const rows = await this.db
      .prepare(
        `SELECT * FROM agent_run_turns WHERE run_id = ? ORDER BY sequence ASC, turn_id ASC`,
      )
      .bind(runId)
      .all<AgentRunTurnRow>();
    return (rows.results ?? []).map(agentRunTurnFromRow);
  }

  async getSessionAgentState(sessionId: string): Promise<SessionAgentState> {
    const row = await this.db
      .prepare(`SELECT * FROM session_agent_state WHERE session_id = ? LIMIT 1`)
      .bind(sessionId)
      .first<SessionAgentStateRow>();
    return row
      ? sessionAgentStateFromRow(row)
      : defaultSessionAgentState(sessionId);
  }

  async setSessionAgentState(
    input: SessionAgentStateInput,
  ): Promise<SessionAgentState> {
    const state: SessionAgentState = {
      ...input,
      updatedAt: input.updatedAt ?? new Date().toISOString(),
    };
    await this.db
      .prepare(
        `INSERT INTO session_agent_state (session_id, current_run_id, generation, debounce_deadline_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET
           current_run_id = excluded.current_run_id,
           generation = excluded.generation,
           debounce_deadline_at = excluded.debounce_deadline_at,
           updated_at = excluded.updated_at`,
      )
      .bind(
        state.sessionId,
        state.currentRunId,
        state.generation,
        state.debounceDeadlineAt,
        state.updatedAt,
      )
      .run();
    return state;
  }

  async listDueSessionAgentStates(
    now: string,
    limit: number,
  ): Promise<SessionAgentState[]> {
    const rows = await this.db
      .prepare(
        `SELECT *
         FROM session_agent_state
         WHERE current_run_id IS NULL
           AND debounce_deadline_at IS NOT NULL
           AND debounce_deadline_at <= ?
         ORDER BY debounce_deadline_at ASC, session_id ASC
         LIMIT ?`,
      )
      .bind(now, limit)
      .all<SessionAgentStateRow>();
    return (rows.results ?? []).map(sessionAgentStateFromRow);
  }

  async listTurns(sessionId: string): Promise<ConversationTurn[]> {
    const rows = await this.db
      .prepare(
        `SELECT * FROM conversation_turns WHERE session_id = ? ORDER BY created_at ASC, id ASC`,
      )
      .bind(sessionId)
      .all<ConversationTurnRow>();
    return (rows.results ?? []).map(turnFromRow);
  }

  async listRecentTurns(
    sessionId: string,
    limit: number,
  ): Promise<ConversationTurn[]> {
    const rows = await this.db
      .prepare(
        `SELECT * FROM conversation_turns WHERE session_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
      )
      .bind(sessionId, limit)
      .all<ConversationTurnRow>();
    return (rows.results ?? []).map(turnFromRow).reverse();
  }

  async appendEvent(
    sessionId: string,
    sourceType: string,
    payload: Record<string, unknown>,
  ): Promise<StoredEvent> {
    const event: StoredEvent = {
      id: `event_${crypto.randomUUID()}`,
      sessionId,
      sourceType,
      payload,
      createdAt: new Date().toISOString(),
    };
    await this.db
      .prepare(
        `INSERT INTO conversation_events (id, session_id, source_type, payload, created_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(
        event.id,
        event.sessionId,
        event.sourceType,
        JSON.stringify(event.payload),
        event.createdAt,
      )
      .run();
    return event;
  }

  async listEvents(sessionId: string): Promise<StoredEvent[]> {
    const rows = await this.db
      .prepare(
        `SELECT * FROM conversation_events WHERE session_id = ? ORDER BY created_at ASC, id ASC`,
      )
      .bind(sessionId)
      .all<StoredEventRow>();
    return (rows.results ?? []).map(storedEventFromRow);
  }

  async searchHistory(
    sessionId: string,
    query: string,
  ): Promise<HistorySearchResult[]> {
    const sessionEvents = await this.listEvents(sessionId);
    const lower = query.toLowerCase();
    return sessionEvents
      .filter((event) => typeof event.payload["text"] === "string")
      .map((event) => {
        const text = String(event.payload["text"]).toLowerCase();
        const directHit = text.includes(lower);
        return { ...event, confidence: directHit ? 0.7 : 0 };
      })
      .filter((event) => event.confidence > 0)
      .sort((a, b) => b.confidence - a.confidence);
  }

  async appendDashboardEvent(event: DashboardEvent): Promise<void> {
    await this.db
      .prepare(
        `INSERT OR IGNORE INTO dashboard_events (id, session_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(
        event.id,
        event.sessionId,
        event.type,
        JSON.stringify(event.payload),
        event.createdAt,
      )
      .run();
  }

  async listDashboardEvents(
    sessionId?: string,
    limit = 200,
  ): Promise<DashboardEvent[]> {
    if (sessionId) {
      const rows = await this.db
        .prepare(
          `SELECT * FROM dashboard_events WHERE session_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
        )
        .bind(sessionId, limit)
        .all<DashboardEventRow>();
      return (rows.results ?? []).map(dashboardEventFromRow).reverse();
    }
    const rows = await this.db
      .prepare(`SELECT * FROM dashboard_events ORDER BY created_at ASC, id ASC`)
      .all<DashboardEventRow>();
    return (rows.results ?? []).map(dashboardEventFromRow);
  }

  async listDashboardSessionSummaries(
    limit = 50,
    eventScanLimit = 500,
  ): Promise<DashboardSessionSummary[]> {
    const rows = await this.db
      .prepare(
        `SELECT id, session_id, type, payload, created_at
         FROM dashboard_events
         ORDER BY created_at DESC, id DESC
         LIMIT ?`,
      )
      .bind(eventScanLimit)
      .all<DashboardEventRow>();
    const summaries = new Map<string, DashboardSessionSummary>();
    for (const event of rows.results ?? []) {
      const existing = summaries.get(event.session_id);
      if (event.type === "session_intelligence_updated") {
        const sessionIntelligence = parseMonitorSessionIntelligencePayload(
          JSON.parse(event.payload) as Record<string, unknown>,
        );
        summaries.set(event.session_id, {
          sessionId: event.session_id,
          latestEventType: existing?.latestEventType ?? event.type,
          updatedAt: existing?.updatedAt ?? event.created_at,
          sessionIntelligence:
            existing?.sessionIntelligence && sessionIntelligence
              ? preserveMonitorContext(
                  existing.sessionIntelligence,
                  sessionIntelligence,
                )
              : existing?.sessionIntelligence ?? sessionIntelligence ?? null,
        });
      } else if (!existing) {
        summaries.set(event.session_id, {
          sessionId: event.session_id,
          latestEventType: event.type,
          updatedAt: event.created_at,
          sessionIntelligence: null,
        });
      } else if (existing.latestEventType === "session_intelligence_updated") {
        summaries.set(event.session_id, {
          ...existing,
          latestEventType: event.type,
        });
      }
      if (summaries.size >= limit) break;
    }
    return [...summaries.values()];
  }

  private async updateWebhookDelivery(
    channel: WebhookDeliveryChannel,
    externalEventId: string,
    status: WebhookDelivery["status"],
    lastError: string | null,
  ): Promise<WebhookDelivery> {
    const now = new Date().toISOString();
    await this.db
      .prepare(
        `UPDATE webhook_deliveries
         SET status = ?,
             processed_at = CASE WHEN ? = 'processed' THEN ? ELSE processed_at END,
             failed_at = CASE WHEN ? = 'failed' THEN ? ELSE failed_at END,
             last_error = ?,
             updated_at = ?
         WHERE channel = ? AND external_event_id = ?`,
      )
      .bind(
        status,
        status,
        now,
        status,
        now,
        lastError,
        now,
        channel,
        externalEventId,
      )
      .run();
    const delivery = await this.getWebhookDelivery(channel, externalEventId);
    if (!delivery)
      throw new Error(
        `Webhook delivery not found: ${channel}:${externalEventId}`,
      );
    return delivery;
  }

  private async ensureConversationTurnMetadataColumn(): Promise<void> {
    const columns = await this.db
      .prepare(`PRAGMA table_info(conversation_turns)`)
      .all<D1TableInfoRow>();
    if ((columns.results ?? []).some((column) => column.name === "metadata"))
      return;
    await this.db
      .prepare(`ALTER TABLE conversation_turns ADD COLUMN metadata TEXT`)
      .run();
  }

  private async ensureConversationProfilesTable(): Promise<void> {
    const table = await this.db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`,
      )
      .bind("conversation_profiles")
      .first<D1TableInfoRow>();
    if (table) return;
    await this.db
      .prepare(
        `CREATE TABLE IF NOT EXISTS conversation_profiles (
          channel TEXT NOT NULL,
          external_user_id TEXT NOT NULL,
          display_name TEXT,
          avatar_url TEXT,
          profile_source TEXT NOT NULL,
          profile_updated_at TEXT NOT NULL,
          PRIMARY KEY (channel, external_user_id)
        )`,
      )
      .run();
  }

  private async ensureSessionControlsTable(): Promise<void> {
    await this.db
      .prepare(
        `CREATE TABLE IF NOT EXISTS session_controls (
          session_id TEXT PRIMARY KEY,
          agent_mode TEXT NOT NULL,
          assigned_agent_id TEXT,
          updated_at TEXT NOT NULL
        )`,
      )
      .run();
  }
}

function parsePayload(value: string): Record<string, unknown> {
  return JSON.parse(value) as Record<string, unknown>;
}

function turnFromRow(row: ConversationTurnRow): ConversationTurn {
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

function parseNullablePayload(
  value: string | null | undefined,
): Record<string, unknown> | null {
  if (!value) return null;
  return JSON.parse(value) as Record<string, unknown>;
}

function profileFromRow(row: ConversationProfileRow): ConversationProfile {
  return {
    channel: row.channel,
    externalUserId: row.external_user_id,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    profileSource: row.profile_source,
    profileUpdatedAt: row.profile_updated_at,
  };
}

function storedEventFromRow(row: StoredEventRow): StoredEvent {
  return {
    id: row.id,
    sessionId: row.session_id,
    sourceType: row.source_type,
    payload: parsePayload(row.payload),
    createdAt: row.created_at,
  };
}

function dashboardEventFromRow(row: DashboardEventRow): DashboardEvent {
  return {
    id: row.id,
    sessionId: row.session_id,
    type: row.type,
    payload: parsePayload(row.payload),
    createdAt: row.created_at,
  };
}

function webhookDeliveryFromRow(row: WebhookDeliveryRow): WebhookDelivery {
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

function sessionControlFromRow(row: SessionControlRow): SessionControl {
  return {
    sessionId: row.session_id,
    agentMode: row.agent_mode,
    assignedAgentId: row.assigned_agent_id,
    updatedAt: row.updated_at,
  };
}

function streamingAssignmentFromRow(
  row: StreamingAssignmentRow,
): StreamingAssignmentRecord {
  return {
    sessionId: row.session_id,
    clientMessageId: row.client_message_id,
    requestFingerprint: row.request_fingerprint,
    path: row.path,
    reason: row.reason,
    policyRevision: row.policy_revision,
    schemaVersion: row.schema_version === null ? null : Number(row.schema_version),
    provisionalGenUiEnabled: Boolean(row.provisional_genui_enabled),
    runId: row.run_id,
    assignedAt: row.assigned_at,
  };
}

function customerRunFromRow(row: CustomerRunRow): CustomerRun {
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
    rolloutPolicyRevision: row.rollout_policy_revision,
    clientAppVersion: row.client_app_version,
    clientSchemaVersion: Number(row.client_schema_version),
    provisionalGenUiEnabled: Boolean(row.provisional_genui_enabled),
    acceptedAt: row.accepted_at,
    startedAt: row.started_at,
    terminalAt: row.terminal_at,
    updatedAt: row.updated_at,
  };
}

function customerRunEventFromRow(row: CustomerRunEventRow): CustomerRunEvent {
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

function defaultSessionControl(sessionId: string): SessionControl {
  return {
    sessionId,
    agentMode: "ai_active",
    assignedAgentId: null,
    updatedAt: new Date().toISOString(),
  };
}

function pendingCustomerTurnFromRow(
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

function agentRunFromRow(row: AgentRunRow): AgentRun {
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

function agentRunTurnFromRow(row: AgentRunTurnRow): AgentRunTurn {
  return {
    runId: row.run_id,
    turnId: row.turn_id,
    sequence: Number(row.sequence),
  };
}

function sessionAgentStateFromRow(
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

function defaultSessionAgentState(sessionId: string): SessionAgentState {
  return {
    sessionId,
    currentRunId: null,
    generation: 0,
    debounceDeadlineAt: null,
    updatedAt: new Date().toISOString(),
  };
}
