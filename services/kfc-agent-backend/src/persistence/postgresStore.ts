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
} from './memoryStore.js';
import {
  CustomerRunIdempotencyConflictError,
  CustomerRunSequenceConflictError,
  customerRunEventSchema,
  type CustomerRun,
  type CustomerRunEvent,
} from '../customerRuns/contracts.js';

type Queryable = Pool | PoolClient;

interface ConversationTurnRow {
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

interface ConversationProfileRow {
  channel: ConversationProfile['channel'];
  external_user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  profile_source: ConversationProfile['profileSource'];
  profile_updated_at: Date | string;
}

interface StoredEventRow {
  id: string;
  session_id: string;
  source_type: string;
  payload: Record<string, unknown>;
  created_at: Date | string;
}

interface DashboardEventRow {
  id: string;
  session_id: string;
  type: DashboardEvent['type'];
  payload: Record<string, unknown>;
  created_at: Date | string;
}

interface WebhookDeliveryRow {
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

interface SessionControlRow {
  session_id: string;
  agent_mode: AgentMode;
  assigned_agent_id: string | null;
  updated_at: Date | string;
}

interface PendingCustomerTurnRow {
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

interface AgentRunRow {
  id: string;
  session_id: string;
  generation: number;
  channel: AgentRun['channel'];
  external_user_id: string;
  status: AgentRun['status'];
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

interface AgentRunTurnRow {
  run_id: string;
  turn_id: string;
  sequence: number;
}

interface SessionAgentStateRow {
  session_id: string;
  current_run_id: string | null;
  generation: number;
  debounce_deadline_at: Date | string | null;
  updated_at: Date | string;
}

interface StreamingAssignmentRow {
  session_id: string;
  client_message_id: string;
  request_fingerprint: string;
  path: StreamingAssignmentRecord['path'];
  reason: StreamingAssignmentRecord['reason'];
  policy_revision: string;
  schema_version: number | null;
  provisional_genui_enabled: boolean;
  run_id: string | null;
  assigned_at: Date | string;
}

interface CustomerRunRow {
  id: string;
  schema_version: 1;
  session_id: string;
  customer_id: string;
  client_message_id: string;
  request_fingerprint: string;
  generation: number;
  status: CustomerRun['status'];
  phase: CustomerRun['phase'];
  next_event_sequence: number;
  rollout_policy_revision: string;
  client_app_version: string;
  client_schema_version: number;
  provisional_genui_enabled: boolean;
  accepted_at: Date | string;
  started_at: Date | string | null;
  terminal_at: Date | string | null;
  updated_at: Date | string;
}

interface CustomerRunEventRow {
  event_id: string;
  run_id: string;
  sequence: number;
  schema_version: 1;
  type: CustomerRunEvent['type'];
  occurred_at: Date | string;
  payload: Record<string, unknown>;
}

export class PostgresStore implements ConversationStore {
  constructor(private readonly db: Queryable) {}

  async initialize(): Promise<void> {
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS conversation_turns (
        id text PRIMARY KEY,
        session_id text NOT NULL,
        channel text NOT NULL,
        role text NOT NULL,
        text text NOT NULL,
        external_message_id text,
        external_user_id text,
        delivery_status text NOT NULL,
        created_at timestamptz NOT NULL
      )
    `);
    await this.db.query(`
      ALTER TABLE conversation_turns
      ADD COLUMN IF NOT EXISTS metadata jsonb
    `);
    await this.db.query(`
      CREATE INDEX IF NOT EXISTS conversation_turns_session_created_idx
      ON conversation_turns (session_id, created_at, id)
    `);
    await this.db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS conversation_turns_session_external_message_idx
      ON conversation_turns (session_id, external_message_id)
      WHERE external_message_id IS NOT NULL
    `);
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS conversation_events (
        id text PRIMARY KEY,
        session_id text NOT NULL,
        source_type text NOT NULL,
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL
      )
    `);
    await this.db.query(`
      CREATE INDEX IF NOT EXISTS conversation_events_session_created_idx
      ON conversation_events (session_id, created_at, id)
    `);
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS dashboard_events (
        event_sequence bigserial,
        id text PRIMARY KEY,
        session_id text NOT NULL,
        type text NOT NULL,
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL
      )
    `);
    await this.db.query(`
      ALTER TABLE dashboard_events
      ADD COLUMN IF NOT EXISTS event_sequence bigserial
    `);
    await this.db.query(`
      CREATE INDEX IF NOT EXISTS dashboard_events_session_created_idx
      ON dashboard_events (session_id, event_sequence, created_at, id)
    `);
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS webhook_deliveries (
        channel text NOT NULL,
        external_event_id text NOT NULL,
        external_thread_id text NOT NULL,
        external_user_id text NOT NULL,
        session_id text NOT NULL,
        status text NOT NULL,
        payload jsonb NOT NULL,
        received_at timestamptz NOT NULL,
        processed_at timestamptz,
        failed_at timestamptz,
        last_error text,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        PRIMARY KEY (channel, external_event_id)
      )
    `);
    await this.db.query(`
      CREATE INDEX IF NOT EXISTS webhook_deliveries_session_received_idx
      ON webhook_deliveries (session_id, received_at, channel, external_event_id)
    `);
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS conversation_profiles (
        channel text NOT NULL,
        external_user_id text NOT NULL,
        display_name text,
        avatar_url text,
        profile_source text NOT NULL,
        profile_updated_at timestamptz NOT NULL,
        PRIMARY KEY (channel, external_user_id)
      )
    `);
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS session_controls (
        session_id text PRIMARY KEY,
        agent_mode text NOT NULL,
        assigned_agent_id text,
        updated_at timestamptz NOT NULL
      )
    `);
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS pending_customer_turns (
        turn_id text PRIMARY KEY,
        session_id text NOT NULL,
        channel text NOT NULL,
        external_message_id text NOT NULL,
        external_user_id text NOT NULL,
        text text NOT NULL,
        steer_mode text NOT NULL,
        status text NOT NULL,
        claimed_run_id text,
        received_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL
      )
    `);
    await this.db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS pending_customer_turns_session_external_message_idx
      ON pending_customer_turns (session_id, external_message_id)
    `);
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS agent_runs (
        id text PRIMARY KEY,
        session_id text NOT NULL,
        generation integer NOT NULL,
        channel text NOT NULL,
        external_user_id text NOT NULL,
        status text NOT NULL,
        coalesced_input_text text NOT NULL,
        superseded_by_run_id text,
        irreversible_side_effect_at timestamptz,
        irreversible_tool_name text,
        assistant_turn_id text,
        delivery_status text NOT NULL,
        delivery_external_message_id text,
        error_code text,
        error_message text,
        scheduled_at timestamptz NOT NULL,
        started_at timestamptz,
        completed_at timestamptz,
        updated_at timestamptz NOT NULL
      )
    `);
    await this.db.query(`
      CREATE INDEX IF NOT EXISTS agent_runs_session_generation_idx
      ON agent_runs (session_id, generation, id)
    `);
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS agent_run_turns (
        run_id text NOT NULL,
        turn_id text NOT NULL,
        sequence integer NOT NULL,
        PRIMARY KEY (run_id, turn_id)
      )
    `);
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS session_agent_state (
        session_id text PRIMARY KEY,
        current_run_id text,
        generation integer NOT NULL,
        debounce_deadline_at timestamptz,
        updated_at timestamptz NOT NULL
      )
    `);
    await this.db.query(`
      CREATE INDEX IF NOT EXISTS session_agent_state_due_idx
      ON session_agent_state (debounce_deadline_at, session_id)
      WHERE current_run_id IS NULL AND debounce_deadline_at IS NOT NULL
    `);
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS customer_streaming_assignments (
        session_id text NOT NULL,
        client_message_id text NOT NULL,
        request_fingerprint text NOT NULL,
        path text NOT NULL,
        reason text NOT NULL,
        policy_revision text NOT NULL,
        schema_version integer,
        provisional_genui_enabled boolean NOT NULL,
        run_id text,
        assigned_at timestamptz NOT NULL,
        PRIMARY KEY (session_id, client_message_id)
      )
    `);
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS customer_runs (
        id text PRIMARY KEY,
        schema_version integer NOT NULL,
        session_id text NOT NULL,
        customer_id text NOT NULL,
        client_message_id text NOT NULL,
        request_fingerprint text NOT NULL,
        generation integer NOT NULL,
        status text NOT NULL,
        phase text,
        next_event_sequence integer NOT NULL,
        rollout_policy_revision text NOT NULL,
        client_app_version text NOT NULL,
        client_schema_version integer NOT NULL,
        provisional_genui_enabled boolean NOT NULL,
        accepted_at timestamptz NOT NULL,
        started_at timestamptz,
        terminal_at timestamptz,
        updated_at timestamptz NOT NULL,
        UNIQUE (session_id, client_message_id)
      )
    `);
    await this.db.query(`
      CREATE INDEX IF NOT EXISTS customer_runs_session_generation_idx
      ON customer_runs (session_id, generation, id)
    `);
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS customer_run_events (
        event_id text NOT NULL UNIQUE,
        run_id text NOT NULL,
        sequence integer NOT NULL,
        schema_version integer NOT NULL,
        type text NOT NULL,
        occurred_at timestamptz NOT NULL,
        payload jsonb NOT NULL,
        PRIMARY KEY (run_id, sequence)
      )
    `);
    await this.db.query(`
      CREATE INDEX IF NOT EXISTS customer_run_events_replay_idx
      ON customer_run_events (run_id, sequence)
    `);
  }

  async saveStreamingAssignment(
    input: StreamingAssignmentRecord,
  ): Promise<StreamingAssignmentRecord> {
    const existing = await this.findStreamingAssignment(input.sessionId, input.clientMessageId);
    if (existing) {
      if (existing.requestFingerprint !== input.requestFingerprint) {
        throw new CustomerRunIdempotencyConflictError(input.sessionId, input.clientMessageId);
      }
      return existing;
    }
    await this.db.query(
      `
        INSERT INTO customer_streaming_assignments (
          session_id, client_message_id, request_fingerprint, path, reason,
          policy_revision, schema_version, provisional_genui_enabled, run_id, assigned_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (session_id, client_message_id) DO NOTHING
      `,
      [
        input.sessionId,
        input.clientMessageId,
        input.requestFingerprint,
        input.path,
        input.reason,
        input.policyRevision,
        input.schemaVersion,
        input.provisionalGenUiEnabled,
        input.runId,
        input.assignedAt,
      ],
    );
    const stored = await this.findStreamingAssignment(input.sessionId, input.clientMessageId);
    if (!stored) throw new Error('Streaming assignment was not persisted');
    if (stored.requestFingerprint !== input.requestFingerprint) {
      throw new CustomerRunIdempotencyConflictError(input.sessionId, input.clientMessageId);
    }
    return stored;
  }

  async findStreamingAssignment(
    sessionId: string,
    clientMessageId: string,
  ): Promise<StreamingAssignmentRecord | undefined> {
    const result = await this.db.query<StreamingAssignmentRow>(
      `SELECT * FROM customer_streaming_assignments
       WHERE session_id = $1 AND client_message_id = $2 LIMIT 1`,
      [sessionId, clientMessageId],
    );
    return result.rows[0] ? streamingAssignmentFromRow(result.rows[0]) : undefined;
  }

  async createCustomerRun(input: CustomerRun): Promise<CustomerRun> {
    const existing = await this.findCustomerRunByRequest(input.sessionId, input.clientMessageId);
    if (existing) {
      if (existing.requestFingerprint !== input.requestFingerprint) {
        throw new CustomerRunIdempotencyConflictError(input.sessionId, input.clientMessageId);
      }
      return existing;
    }
    await this.db.query(
      `
        INSERT INTO customer_runs (
          id, schema_version, session_id, customer_id, client_message_id,
          request_fingerprint, generation, status, phase, next_event_sequence,
          rollout_policy_revision, client_app_version, client_schema_version,
          provisional_genui_enabled, accepted_at, started_at, terminal_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9,
          $10, $11, $12, $13, $14, $15, $16, $17, $18
        )
        ON CONFLICT (session_id, client_message_id) DO NOTHING
      `,
      [
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
        input.provisionalGenUiEnabled,
        input.acceptedAt,
        input.startedAt,
        input.terminalAt,
        input.updatedAt,
      ],
    );
    const stored = await this.findCustomerRunByRequest(input.sessionId, input.clientMessageId);
    if (!stored) throw new Error('Customer run was not persisted');
    if (stored.requestFingerprint !== input.requestFingerprint) {
      throw new CustomerRunIdempotencyConflictError(input.sessionId, input.clientMessageId);
    }
    return stored;
  }

  async getCustomerRun(runId: string): Promise<CustomerRun | undefined> {
    const result = await this.db.query<CustomerRunRow>(
      `SELECT * FROM customer_runs WHERE id = $1 LIMIT 1`,
      [runId],
    );
    return result.rows[0] ? customerRunFromRow(result.rows[0]) : undefined;
  }

  async findCustomerRunByRequest(
    sessionId: string,
    clientMessageId: string,
  ): Promise<CustomerRun | undefined> {
    const result = await this.db.query<CustomerRunRow>(
      `SELECT * FROM customer_runs
       WHERE session_id = $1 AND client_message_id = $2 LIMIT 1`,
      [sessionId, clientMessageId],
    );
    return result.rows[0] ? customerRunFromRow(result.rows[0]) : undefined;
  }

  async appendCustomerRunEvent(
    input: AppendCustomerRunEventInput,
  ): Promise<CustomerRunEvent> {
    const { expectedSequence, ...eventInput } = input;
    const event = customerRunEventSchema.parse({
      ...eventInput,
      sequence: expectedSequence,
    });
    const result = await this.db.query<CustomerRunEventRow>(
      `
        WITH advanced AS (
          UPDATE customer_runs
          SET next_event_sequence = next_event_sequence + 1,
              updated_at = $6
          WHERE id = $2 AND next_event_sequence = $3
          RETURNING id
        )
        INSERT INTO customer_run_events (
          event_id, run_id, sequence, schema_version, type, occurred_at, payload
        )
        SELECT $1, $2, $3, $4, $5, $6, $7 FROM advanced
        RETURNING *
      `,
      [
        event.eventId,
        event.runId,
        event.sequence,
        event.schemaVersion,
        event.type,
        event.occurredAt,
        event.payload,
      ],
    );
    if (result.rows[0]) return customerRunEventFromRow(result.rows[0]);
    const run = await this.getCustomerRun(event.runId);
    if (!run) throw new Error(`Customer run not found: ${event.runId}`);
    throw new CustomerRunSequenceConflictError(
      event.runId,
      event.sequence,
      run.nextEventSequence,
    );
  }

  async listCustomerRunEvents(
    runId: string,
    afterSequence = 0,
  ): Promise<CustomerRunEvent[]> {
    const result = await this.db.query<CustomerRunEventRow>(
      `SELECT * FROM customer_run_events
       WHERE run_id = $1 AND sequence > $2 ORDER BY sequence ASC`,
      [runId, afterSequence],
    );
    return result.rows.map(customerRunEventFromRow);
  }

  async appendTurn(input: AppendConversationTurnInput): Promise<ConversationTurn> {
    const turn: ConversationTurn = {
      ...input,
      id: `turn_${randomUUID()}`,
      createdAt: input.createdAt ?? new Date().toISOString(),
    };
    await this.db.query(
      `
        INSERT INTO conversation_turns (
          id, session_id, channel, role, text, external_message_id, external_user_id, delivery_status, metadata, created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `,
      [
        turn.id,
        turn.sessionId,
        turn.channel,
        turn.role,
        turn.text,
        turn.externalMessageId,
        turn.externalUserId,
        turn.deliveryStatus,
        input.metadata,
        turn.createdAt,
      ],
    );
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

  async upsertImportedTurn(input: ImportedConversationTurn): Promise<ImportedConversationTurnResult> {
    const turn: ConversationTurn = {
      ...input,
      id: input.id ?? `turn_${randomUUID()}`,
    };
    const result = await this.db.query<ConversationTurnRow & { inserted: boolean }>(
      `
        INSERT INTO conversation_turns (
          id, session_id, channel, role, text, external_message_id, external_user_id, delivery_status, metadata, created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (session_id, external_message_id) WHERE external_message_id IS NOT NULL
        DO UPDATE SET
          channel = EXCLUDED.channel,
          role = EXCLUDED.role,
          text = EXCLUDED.text,
          external_user_id = EXCLUDED.external_user_id,
          delivery_status = EXCLUDED.delivery_status,
          metadata = EXCLUDED.metadata,
          created_at = EXCLUDED.created_at
        RETURNING *, (xmax = 0) AS inserted
      `,
      [
        turn.id,
        turn.sessionId,
        turn.channel,
        turn.role,
        turn.text,
        turn.externalMessageId,
        turn.externalUserId,
        turn.deliveryStatus,
        turn.metadata,
        turn.createdAt,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`Failed to upsert imported conversation turn: ${turn.externalMessageId ?? turn.id}`);
    if (row.inserted) {
      await this.appendEvent(input.sessionId, `conversation_turn:${input.role}`, {
        text: input.text,
        channel: input.channel,
        deliveryStatus: input.deliveryStatus,
        externalMessageId: input.externalMessageId,
        externalUserId: input.externalUserId,
        metadata: input.metadata,
      });
    }
    return { turn: turnFromRow(row), inserted: row.inserted };
  }

  async upsertProfile(input: ConversationProfile): Promise<ConversationProfile> {
    await this.db.query(
      `
        INSERT INTO conversation_profiles (
          channel, external_user_id, display_name, avatar_url, profile_source, profile_updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (channel, external_user_id) DO UPDATE SET
          display_name = EXCLUDED.display_name,
          avatar_url = EXCLUDED.avatar_url,
          profile_source = EXCLUDED.profile_source,
          profile_updated_at = EXCLUDED.profile_updated_at
      `,
      [
        input.channel,
        input.externalUserId,
        input.displayName,
        input.avatarUrl,
        input.profileSource,
        input.profileUpdatedAt,
      ],
    );
    return input;
  }

  async getProfile(
    channel: ConversationProfile['channel'],
    externalUserId: string,
  ): Promise<ConversationProfile | undefined> {
    const result = await this.db.query<ConversationProfileRow>(
      `
        SELECT *
        FROM conversation_profiles
        WHERE channel = $1 AND external_user_id = $2
        LIMIT 1
      `,
      [channel, externalUserId],
    );
    return result.rows[0] ? profileFromRow(result.rows[0]) : undefined;
  }

  async findTurnByExternalMessage(sessionId: string, externalMessageId: string): Promise<ConversationTurn | undefined> {
    const result = await this.db.query<ConversationTurnRow>(
      `
        SELECT *
        FROM conversation_turns
        WHERE session_id = $1 AND external_message_id = $2
        ORDER BY created_at ASC, id ASC
        LIMIT 1
      `,
      [sessionId, externalMessageId],
    );
    return result.rows[0] ? turnFromRow(result.rows[0]) : undefined;
  }

  async reserveWebhookDelivery(input: ReserveWebhookDeliveryInput): Promise<ReserveWebhookDeliveryResult> {
    const now = new Date().toISOString();
    const inserted = await this.db.query<WebhookDeliveryRow>(
      `
        INSERT INTO webhook_deliveries (
          channel, external_event_id, external_thread_id, external_user_id, session_id, status, payload,
          received_at, processed_at, failed_at, last_error, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, 'received', $6, $7, NULL, NULL, NULL, $8, $8)
        ON CONFLICT (channel, external_event_id) DO NOTHING
        RETURNING *
      `,
      [
        input.channel,
        input.externalEventId,
        input.externalThreadId,
        input.externalUserId,
        input.sessionId,
        JSON.stringify(input.payload),
        input.receivedAt,
        now,
      ],
    );
    if (inserted.rows[0]) return { delivery: webhookDeliveryFromRow(inserted.rows[0]), reserved: true };

    const existing = await this.getWebhookDelivery(input.channel, input.externalEventId);
    if (!existing) throw new Error(`Webhook delivery reservation missing after conflict: ${input.channel}:${input.externalEventId}`);
    return { delivery: existing, reserved: false };
  }

  async markWebhookDeliveryProcessed(channel: WebhookDeliveryChannel, externalEventId: string): Promise<WebhookDelivery> {
    return this.updateWebhookDelivery(channel, externalEventId, 'processed', null);
  }

  async markWebhookDeliveryFailed(
    channel: WebhookDeliveryChannel,
    externalEventId: string,
    lastError: string,
  ): Promise<WebhookDelivery> {
    return this.updateWebhookDelivery(channel, externalEventId, 'failed', lastError);
  }

  async getWebhookDelivery(channel: WebhookDeliveryChannel, externalEventId: string): Promise<WebhookDelivery | undefined> {
    const result = await this.db.query<WebhookDeliveryRow>(
      `
        SELECT *
        FROM webhook_deliveries
        WHERE channel = $1 AND external_event_id = $2
        LIMIT 1
      `,
      [channel, externalEventId],
    );
    return result.rows[0] ? webhookDeliveryFromRow(result.rows[0]) : undefined;
  }

  async listStaleWebhookDeliveries(
    channel: WebhookDeliveryChannel,
    receivedBefore: string,
    limit: number,
  ): Promise<WebhookDelivery[]> {
    const result = await this.db.query<WebhookDeliveryRow>(
      `
        SELECT *
        FROM webhook_deliveries
        WHERE channel = $1
          AND status = 'received'
          AND received_at < $2
        ORDER BY received_at ASC, external_event_id ASC
        LIMIT $3
      `,
      [channel, receivedBefore, Math.max(0, limit)],
    );
    return result.rows.map(webhookDeliveryFromRow);
  }

  private async updateWebhookDelivery(
    channel: WebhookDeliveryChannel,
    externalEventId: string,
    status: WebhookDelivery['status'],
    lastError: string | null,
  ): Promise<WebhookDelivery> {
    const result = await this.db.query<WebhookDeliveryRow>(
      `
        UPDATE webhook_deliveries
        SET status = $3,
            processed_at = CASE WHEN $3 = 'processed' THEN NOW() ELSE processed_at END,
            failed_at = CASE WHEN $3 = 'failed' THEN NOW() ELSE failed_at END,
            last_error = $4,
            updated_at = NOW()
        WHERE channel = $1 AND external_event_id = $2
        RETURNING *
      `,
      [channel, externalEventId, status, lastError],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`Webhook delivery not found: ${channel}:${externalEventId}`);
    return webhookDeliveryFromRow(row);
  }

  async updateTurnDeliveryStatus(
    turnId: string,
    deliveryStatus: ConversationTurn['deliveryStatus'],
    externalMessageId: string | null,
  ): Promise<ConversationTurn> {
    const result = await this.db.query<ConversationTurnRow>(
      `
        UPDATE conversation_turns
        SET delivery_status = $2, external_message_id = $3
        WHERE id = $1
        RETURNING *
      `,
      [turnId, deliveryStatus, externalMessageId],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`Conversation turn not found: ${turnId}`);
    return turnFromRow(row);
  }

  async getSessionControl(sessionId: string): Promise<SessionControl> {
    const result = await this.db.query<SessionControlRow>(
      `
        SELECT *
        FROM session_controls
        WHERE session_id = $1
        LIMIT 1
      `,
      [sessionId],
    );
    return result.rows[0] ? sessionControlFromRow(result.rows[0]) : defaultSessionControl(sessionId);
  }

  async setSessionControl(
    sessionId: string,
    patch: { agentMode: AgentMode; assignedAgentId?: string | null | undefined },
  ): Promise<SessionControl> {
    const current = await this.getSessionControl(sessionId);
    const assignedAgentId = patch.assignedAgentId === undefined ? current.assignedAgentId : patch.assignedAgentId;
    const result = await this.db.query<SessionControlRow>(
      `
        INSERT INTO session_controls (session_id, agent_mode, assigned_agent_id, updated_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (session_id) DO UPDATE SET
          agent_mode = EXCLUDED.agent_mode,
          assigned_agent_id = EXCLUDED.assigned_agent_id,
          updated_at = EXCLUDED.updated_at
        RETURNING *
      `,
      [sessionId, patch.agentMode, assignedAgentId],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`Failed to update session control: ${sessionId}`);
    return sessionControlFromRow(row);
  }

  async upsertPendingCustomerTurn(input: PendingCustomerTurnInput): Promise<UpsertPendingCustomerTurnResult> {
    const now = input.updatedAt ?? new Date().toISOString();
    const result = await this.db.query<PendingCustomerTurnRow & { inserted: boolean }>(
      `
        INSERT INTO pending_customer_turns (
          turn_id, session_id, channel, external_message_id, external_user_id, text, steer_mode,
          status, claimed_run_id, received_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (session_id, external_message_id) DO UPDATE SET
          updated_at = pending_customer_turns.updated_at
        RETURNING *, (xmax = 0) AS inserted
      `,
      [
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
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`Failed to upsert pending customer turn: ${input.externalMessageId}`);
    return { turn: pendingCustomerTurnFromRow(row), inserted: row.inserted };
  }

  async listPendingCustomerTurns(sessionId: string): Promise<PendingCustomerTurn[]> {
    const result = await this.db.query<PendingCustomerTurnRow>(
      `
        SELECT *
        FROM pending_customer_turns
        WHERE session_id = $1
        ORDER BY received_at ASC, turn_id ASC
      `,
      [sessionId],
    );
    return result.rows.map(pendingCustomerTurnFromRow);
  }

  async markPendingCustomerTurnClaimed(turnId: string, runId: string): Promise<PendingCustomerTurn> {
    const result = await this.db.query<PendingCustomerTurnRow>(
      `
        UPDATE pending_customer_turns
        SET status = 'claimed', claimed_run_id = $2, updated_at = NOW()
        WHERE turn_id = $1
        RETURNING *
      `,
      [turnId, runId],
    );
    const row = result.rows[0];
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
    await this.db.query(
      `
        INSERT INTO agent_runs (
          id, session_id, generation, channel, external_user_id, status, coalesced_input_text,
          superseded_by_run_id, irreversible_side_effect_at, irreversible_tool_name, assistant_turn_id,
          delivery_status, delivery_external_message_id, error_code, error_message,
          scheduled_at, started_at, completed_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
      `,
      [
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
      ],
    );
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
    const result = await this.db.query<AgentRunRow>(
      `
        UPDATE agent_runs
        SET status = $2,
            superseded_by_run_id = $3,
            irreversible_side_effect_at = $4,
            irreversible_tool_name = $5,
            assistant_turn_id = $6,
            delivery_status = $7,
            delivery_external_message_id = $8,
            error_code = $9,
            error_message = $10,
            started_at = $11,
            completed_at = $12,
            updated_at = $13
        WHERE id = $1
        RETURNING *
      `,
      [
        runId,
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
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`Agent run not found: ${runId}`);
    return agentRunFromRow(row);
  }

  async getAgentRun(runId: string): Promise<AgentRun | undefined> {
    const result = await this.db.query<AgentRunRow>(
      `
        SELECT *
        FROM agent_runs
        WHERE id = $1
        LIMIT 1
      `,
      [runId],
    );
    return result.rows[0] ? agentRunFromRow(result.rows[0]) : undefined;
  }

  async listAgentRuns(sessionId: string): Promise<AgentRun[]> {
    const result = await this.db.query<AgentRunRow>(
      `
        SELECT *
        FROM agent_runs
        WHERE session_id = $1
        ORDER BY generation ASC, id ASC
      `,
      [sessionId],
    );
    return result.rows.map(agentRunFromRow);
  }

  async linkAgentRunTurn(input: AgentRunTurn): Promise<AgentRunTurn> {
    await this.db.query(
      `
        INSERT INTO agent_run_turns (run_id, turn_id, sequence)
        VALUES ($1, $2, $3)
        ON CONFLICT (run_id, turn_id) DO NOTHING
      `,
      [input.runId, input.turnId, input.sequence],
    );
    return input;
  }

  async listAgentRunTurns(runId: string): Promise<AgentRunTurn[]> {
    const result = await this.db.query<AgentRunTurnRow>(
      `
        SELECT *
        FROM agent_run_turns
        WHERE run_id = $1
        ORDER BY sequence ASC, turn_id ASC
      `,
      [runId],
    );
    return result.rows.map(agentRunTurnFromRow);
  }

  async getSessionAgentState(sessionId: string): Promise<SessionAgentState> {
    const result = await this.db.query<SessionAgentStateRow>(
      `
        SELECT *
        FROM session_agent_state
        WHERE session_id = $1
        LIMIT 1
      `,
      [sessionId],
    );
    return result.rows[0] ? sessionAgentStateFromRow(result.rows[0]) : defaultSessionAgentState(sessionId);
  }

  async setSessionAgentState(input: SessionAgentStateInput): Promise<SessionAgentState> {
    const state: SessionAgentState = {
      ...input,
      updatedAt: input.updatedAt ?? new Date().toISOString(),
    };
    const result = await this.db.query<SessionAgentStateRow>(
      `
        INSERT INTO session_agent_state (session_id, current_run_id, generation, debounce_deadline_at, updated_at)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (session_id) DO UPDATE SET
          current_run_id = EXCLUDED.current_run_id,
          generation = EXCLUDED.generation,
          debounce_deadline_at = EXCLUDED.debounce_deadline_at,
          updated_at = EXCLUDED.updated_at
        RETURNING *
      `,
      [state.sessionId, state.currentRunId, state.generation, state.debounceDeadlineAt, state.updatedAt],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`Failed to set session agent state: ${state.sessionId}`);
    return sessionAgentStateFromRow(row);
  }

  async listDueSessionAgentStates(now: string, limit: number): Promise<SessionAgentState[]> {
    const result = await this.db.query<SessionAgentStateRow>(
      `
        SELECT *
        FROM session_agent_state
        WHERE current_run_id IS NULL
          AND debounce_deadline_at IS NOT NULL
          AND debounce_deadline_at <= $1
        ORDER BY debounce_deadline_at ASC, session_id ASC
        LIMIT $2
      `,
      [now, limit],
    );
    return result.rows.map(sessionAgentStateFromRow);
  }

  async listTurns(sessionId: string): Promise<ConversationTurn[]> {
    const result = await this.db.query<ConversationTurnRow>(
      `
        SELECT *
        FROM conversation_turns
        WHERE session_id = $1
        ORDER BY created_at ASC, id ASC
      `,
      [sessionId],
    );
    return result.rows.map(turnFromRow);
  }

  async appendEvent(sessionId: string, sourceType: string, payload: Record<string, unknown>): Promise<StoredEvent> {
    const event: StoredEvent = {
      id: `event_${randomUUID()}`,
      sessionId,
      sourceType,
      payload,
      createdAt: new Date().toISOString(),
    };
    await this.db.query(
      `
        INSERT INTO conversation_events (id, session_id, source_type, payload, created_at)
        VALUES ($1, $2, $3, $4, $5)
      `,
      [event.id, event.sessionId, event.sourceType, JSON.stringify(event.payload), event.createdAt],
    );
    return event;
  }

  async listEvents(sessionId: string): Promise<StoredEvent[]> {
    const result = await this.db.query<StoredEventRow>(
      `
        SELECT *
        FROM conversation_events
        WHERE session_id = $1
        ORDER BY created_at ASC, id ASC
      `,
      [sessionId],
    );
    return result.rows.map(storedEventFromRow);
  }

  async searchHistory(sessionId: string, query: string): Promise<HistorySearchResult[]> {
    const sessionEvents = await this.listEvents(sessionId);
    const lower = query.toLowerCase();
    return sessionEvents
      .filter((event) => typeof event.payload["text"] === 'string')
      .map((event) => {
        const text = String(event.payload["text"]).toLowerCase();
        const directHit = text.includes(lower);
        return { ...event, confidence: directHit ? 0.7 : 0 };
      })
      .filter((event) => event.confidence > 0)
      .sort((a, b) => b.confidence - a.confidence);
  }

  async appendDashboardEvent(event: DashboardEvent): Promise<void> {
    await this.db.query(
      `
        INSERT INTO dashboard_events (id, session_id, type, payload, created_at)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (id) DO NOTHING
      `,
      [event.id, event.sessionId, event.type, JSON.stringify(event.payload), event.createdAt],
    );
  }

  async listDashboardEvents(): Promise<DashboardEvent[]> {
    const result = await this.db.query<DashboardEventRow>(`
      SELECT *
      FROM dashboard_events
      ORDER BY event_sequence ASC, created_at ASC, id ASC
    `);
    return result.rows.map(dashboardEventFromRow);
  }
}

export async function createPostgresPersistence(input: { databaseUrl: string }): Promise<{
  pool: Pool;
  store: PostgresStore;
  dashboardEvents: DashboardEvent[];
}> {
  const pool = new Pool({ connectionString: input.databaseUrl });
  const store = new PostgresStore(pool);
  await store.initialize();
  return {
    pool,
    store,
    dashboardEvents: await store.listDashboardEvents(),
  };
}

function normalizeDate(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
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
    metadata: row.metadata,
    createdAt: normalizeDate(row.created_at),
  };
}

function profileFromRow(row: ConversationProfileRow): ConversationProfile {
  return {
    channel: row.channel,
    externalUserId: row.external_user_id,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    profileSource: row.profile_source,
    profileUpdatedAt: normalizeDate(row.profile_updated_at),
  };
}

function storedEventFromRow(row: StoredEventRow): StoredEvent {
  return {
    id: row.id,
    sessionId: row.session_id,
    sourceType: row.source_type,
    payload: row.payload,
    createdAt: normalizeDate(row.created_at),
  };
}

function dashboardEventFromRow(row: DashboardEventRow): DashboardEvent {
  return {
    id: row.id,
    sessionId: row.session_id,
    type: row.type,
    payload: row.payload,
    createdAt: normalizeDate(row.created_at),
  };
}

function nullableDate(value: Date | string | null): string | null {
  return value === null ? null : normalizeDate(value);
}

function webhookDeliveryFromRow(row: WebhookDeliveryRow): WebhookDelivery {
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

function sessionControlFromRow(row: SessionControlRow): SessionControl {
  return {
    sessionId: row.session_id,
    agentMode: row.agent_mode,
    assignedAgentId: row.assigned_agent_id,
    updatedAt: normalizeDate(row.updated_at),
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
    provisionalGenUiEnabled: row.provisional_genui_enabled,
    runId: row.run_id,
    assignedAt: normalizeDate(row.assigned_at),
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
    provisionalGenUiEnabled: row.provisional_genui_enabled,
    acceptedAt: normalizeDate(row.accepted_at),
    startedAt: nullableDate(row.started_at),
    terminalAt: nullableDate(row.terminal_at),
    updatedAt: normalizeDate(row.updated_at),
  };
}

function customerRunEventFromRow(row: CustomerRunEventRow): CustomerRunEvent {
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

function defaultSessionControl(sessionId: string): SessionControl {
  return {
    sessionId,
    agentMode: 'ai_active',
    assignedAgentId: null,
    updatedAt: new Date().toISOString(),
  };
}

function pendingCustomerTurnFromRow(row: PendingCustomerTurnRow): PendingCustomerTurn {
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

function agentRunTurnFromRow(row: AgentRunTurnRow): AgentRunTurn {
  return {
    runId: row.run_id,
    turnId: row.turn_id,
    sequence: Number(row.sequence),
  };
}

function sessionAgentStateFromRow(row: SessionAgentStateRow): SessionAgentState {
  return {
    sessionId: row.session_id,
    currentRunId: row.current_run_id,
    generation: Number(row.generation),
    debounceDeadlineAt: nullableDate(row.debounce_deadline_at),
    updatedAt: normalizeDate(row.updated_at),
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
