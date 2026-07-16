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
import { confirmationPauseFromEvent, type ConfirmationPauseRecord } from './memoryStore.js';
import {
  CustomerRunIdempotencyConflictError,
  CustomerRunSequenceConflictError,
  customerRunEventSchema,
  type CustomerRun,
  type CustomerRunEvent,
} from '../customerRuns/contracts.js';
import { PostgresCheckpointSaver } from './postgresCheckpointSaver.js';
import {
  Queryable,
  ConversationTurnRow,
  ConversationProfileRow,
  StoredEventRow,
  DashboardEventRow,
  WebhookDeliveryRow,
  SessionControlRow,
  PendingCustomerTurnRow,
  AgentRunRow,
  AgentRunTurnRow,
  SessionAgentStateRow,
  CustomerRunRow,
  CustomerRunEventRow,
  IrreversibleOperationRow,
  normalizeDate,
  turnFromRow,
  profileFromRow,
  storedEventFromRow,
  dashboardEventFromRow,
  nullableDate,
  webhookDeliveryFromRow,
  sessionControlFromRow,
  customerRunFromRow,
  customerRunEventFromRow,
  defaultSessionControl,
  pendingCustomerTurnFromRow,
  agentRunFromRow,
  agentRunTurnFromRow,
  sessionAgentStateFromRow,
  defaultSessionAgentState
} from './postgresStoreSupport.js';

export abstract class PostgresStoreCore {
  constructor(
    protected readonly db: Queryable,
    protected readonly sessionResetHook?: SessionResetHook,
  ) {}

  async resetSession(sessionId: string): Promise<SessionControl> {
    await this.db.query(
      `WITH session_customer_runs AS (
         SELECT id FROM customer_runs WHERE session_id = $1
       ), session_agent_runs AS (
         SELECT id FROM agent_runs WHERE session_id = $1
       ), deleted_customer_events AS (
         DELETE FROM customer_run_events WHERE run_id IN (SELECT id FROM session_customer_runs)
       ), deleted_agent_links AS (
         DELETE FROM agent_run_turns WHERE run_id IN (SELECT id FROM session_agent_runs)
       ), deleted_customer_runs AS (
         DELETE FROM customer_runs WHERE session_id = $1
       ), deleted_pending_turns AS (
         DELETE FROM pending_customer_turns WHERE session_id = $1
       ), deleted_agent_runs AS (
         DELETE FROM agent_runs WHERE session_id = $1
       ), deleted_agent_state AS (
         DELETE FROM session_agent_state WHERE session_id = $1
       ), deleted_deliveries AS (
         DELETE FROM webhook_deliveries WHERE session_id = $1
       ), deleted_turns AS (
         DELETE FROM conversation_turns WHERE session_id = $1
       ), deleted_events AS (
         DELETE FROM conversation_events WHERE session_id = $1
       ), deleted_irreversible_operations AS (
         DELETE FROM irreversible_operations WHERE session_id = $1
       ), deleted_dashboard_events AS (
         DELETE FROM dashboard_events WHERE session_id = $1
       )
       DELETE FROM session_controls WHERE session_id = $1`,
      [sessionId],
    );
    await this.sessionResetHook?.(sessionId);
    return defaultSessionControl(sessionId);
  }

  async initialize(): Promise<void> {
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS irreversible_operations (
        request_id text PRIMARY KEY,
        session_id text NOT NULL,
        operation text NOT NULL,
        binding_fingerprint text NOT NULL,
        result_json jsonb,
        status text NOT NULL,
        attempt_count integer NOT NULL,
        lease_expires_at timestamptz,
        lease_token text NOT NULL,
        last_error text,
        created_at timestamptz NOT NULL,
        completed_at timestamptz
      )
    `);
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
        client_schema_version integer NOT NULL,
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

  async reserveIrreversibleOperation(input: IrreversibleOperationInput): Promise<IrreversibleOperationReservation> {
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + 30_000);
    const leaseToken = randomUUID();
    const inserted = await this.db.query<IrreversibleOperationRow>(
      `INSERT INTO irreversible_operations (
         request_id, session_id, operation, binding_fingerprint, result_json,
         status, attempt_count, lease_expires_at, lease_token, last_error, created_at, completed_at
       ) VALUES ($1, $2, $3, $4, NULL, 'attempting', 1, $5, $6, NULL, $7, NULL)
       ON CONFLICT (request_id) DO NOTHING RETURNING *`,
      [input.requestId, input.sessionId, input.operation, input.bindingFingerprint, leaseExpiresAt, leaseToken, now],
    );
    if (inserted.rows[0]) {
      return { status: 'reserved', attempt: 1, leaseToken, reconciliation: false };
    }
    let current = await this.irreversibleOperationRow(input);
    if (!current) throw new Error(`Irreversible operation reservation missing: ${input.requestId}`);
    if (current.status === 'completed' && current.result_json) {
      return { status: 'completed', result: current.result_json };
    }
    if (current.status === 'unknown' || (current.lease_expires_at && new Date(current.lease_expires_at) <= now)) {
      const nextLeaseToken = randomUUID();
      const claimed = await this.db.query<IrreversibleOperationRow>(
        `UPDATE irreversible_operations
         SET status = 'attempting', attempt_count = attempt_count + 1,
             lease_expires_at = $1, lease_token = $2, last_error = NULL
         WHERE request_id = $3 AND session_id = $4 AND operation = $5 AND binding_fingerprint = $6
           AND status != 'completed' AND (status = 'unknown' OR lease_expires_at <= $7)
         RETURNING *`,
        [leaseExpiresAt, nextLeaseToken, input.requestId, input.sessionId, input.operation, input.bindingFingerprint, now],
      );
      if (claimed.rows[0]) {
        return {
          status: 'reserved',
          attempt: claimed.rows[0].attempt_count,
          leaseToken: nextLeaseToken,
          reconciliation: true,
        };
      }
      current = await this.irreversibleOperationRow(input) ?? current;
    }
    return current.status === 'unknown'
      ? { status: 'unknown', lastError: current.last_error }
      : { status: 'pending' };
  }

  async getIrreversibleOperation(input: IrreversibleOperationInput): Promise<IrreversibleOperationReservation | undefined> {
    const current = await this.irreversibleOperationRow(input);
    if (!current) return undefined;
    if (current.status === 'completed' && current.result_json) {
      return { status: 'completed', result: current.result_json };
    }
    return current.status === 'unknown'
      ? { status: 'unknown', lastError: current.last_error }
      : { status: 'pending' };
  }

  async completeIrreversibleOperation(
    input: IrreversibleOperationInput,
    owner: { attempt: number; leaseToken: string },
    result: Record<string, unknown>,
  ): Promise<IrreversibleOperationCompletion> {
    await this.db.query(
      `UPDATE irreversible_operations
       SET result_json = $1, status = 'completed', lease_expires_at = NULL,
           last_error = NULL, completed_at = NOW()
       WHERE request_id = $2 AND session_id = $3 AND operation = $4 AND binding_fingerprint = $5
         AND status = 'attempting' AND attempt_count = $6 AND lease_token = $7`,
      [result, input.requestId, input.sessionId, input.operation, input.bindingFingerprint, owner.attempt, owner.leaseToken],
    );
    const current = await this.irreversibleOperationRow(input);
    if (!current) throw new Error(`Irreversible operation reservation not found: ${input.requestId}`);
    return current.status === 'completed' && current.result_json
      ? { status: 'completed', result: current.result_json }
      : { status: 'lost' };
  }

  async failIrreversibleOperation(
    input: IrreversibleOperationInput,
    owner: { attempt: number; leaseToken: string },
    error: string,
  ): Promise<void> {
    await this.db.query(
      `UPDATE irreversible_operations
       SET status = 'unknown', lease_expires_at = NULL, last_error = $1
       WHERE request_id = $2 AND session_id = $3 AND operation = $4 AND binding_fingerprint = $5
         AND status = 'attempting' AND attempt_count = $6 AND lease_token = $7`,
      [error, input.requestId, input.sessionId, input.operation, input.bindingFingerprint, owner.attempt, owner.leaseToken],
    );
  }

  private async irreversibleOperationRow(input: IrreversibleOperationInput): Promise<IrreversibleOperationRow | undefined> {
    const result = await this.db.query<IrreversibleOperationRow>(
      'SELECT * FROM irreversible_operations WHERE request_id = $1',
      [input.requestId],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    if (
      row.session_id !== input.sessionId ||
      row.operation !== input.operation ||
      row.binding_fingerprint !== input.bindingFingerprint
    ) throw new Error(`Irreversible operation binding conflict: ${input.requestId}`);
    return row;
  }

  async createCustomerRun(input: CustomerRun): Promise<CustomerRun> {
    const result = await this.db.query<CustomerRunRow>(
      `
        WITH inserted AS (
          INSERT INTO customer_runs (
            id, schema_version, session_id, customer_id, client_message_id,
            request_fingerprint, generation, status, phase, next_event_sequence,
            client_schema_version, accepted_at, started_at, terminal_at, updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9,
            $10, $11, $12, $13, $14, $15
          )
          ON CONFLICT (session_id, client_message_id) DO NOTHING
          RETURNING *
        )
        SELECT * FROM inserted
        UNION ALL
        SELECT * FROM customer_runs
        WHERE session_id = $3 AND client_message_id = $5
        LIMIT 1
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
        input.clientSchemaVersion,
        input.acceptedAt,
        input.startedAt,
        input.terminalAt,
        input.updatedAt,
      ],
    );
    const stored = result.rows[0]
      ? customerRunFromRow(result.rows[0])
      : undefined;
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

  async updateCustomerRun(runId: string, patch: CustomerRunPatch): Promise<CustomerRun> {
    const assignments: string[] = [];
    const values: unknown[] = [runId];
    const add = (column: string, value: unknown) => {
      if (value === undefined) return;
      values.push(value);
      assignments.push(`${column} = $${values.length}`);
    };
    add('status', patch.status);
    add('phase', patch.phase);
    add('started_at', patch.startedAt);
    add('terminal_at', patch.terminalAt);
    add('updated_at', patch.updatedAt ?? new Date().toISOString());
    const result = await this.db.query<CustomerRunRow>(
      `UPDATE customer_runs SET ${assignments.join(', ')}
       WHERE id = $1 RETURNING *`,
      values,
    );
    if (!result.rows[0]) throw new Error(`Customer run not found: ${runId}`);
    return customerRunFromRow(result.rows[0]);
  }

  async appendCustomerRunEvents(
    inputs: AppendCustomerRunEventInput[],
  ): Promise<CustomerRunEvent[]> {
    if (inputs.length === 0) return [];
    const first = inputs[0]!;
    const events = inputs.map(({ expectedSequence, ...eventInput }) =>
      customerRunEventSchema.parse({
        ...eventInput,
        sequence: expectedSequence,
      }),
    );
    const values: unknown[] = [
      first.runId,
      first.expectedSequence,
      events.length,
      events.at(-1)!.occurredAt,
    ];
    const rows = events.map((event) => {
      const placeholders = Array.from({ length: 7 }, () => {
        values.push(undefined);
        return `$${values.length}`;
      });
      values.splice(
        values.length - 7,
        7,
        event.eventId,
        event.runId,
        event.sequence,
        event.schemaVersion,
        event.type,
        event.occurredAt,
        event.payload,
      );
      return `(${placeholders.join(', ')})`;
    });
    const result = await this.db.query<CustomerRunEventRow>(
      `
        WITH advanced AS (
          UPDATE customer_runs
          SET next_event_sequence = next_event_sequence + $3,
              updated_at = $4
          WHERE id = $1 AND next_event_sequence = $2
          RETURNING id
        ), event_values (
          event_id, run_id, sequence, schema_version, type, occurred_at, payload
        ) AS (VALUES ${rows.join(', ')})
        INSERT INTO customer_run_events (
          event_id, run_id, sequence, schema_version, type, occurred_at, payload
        )
        SELECT event_values.* FROM event_values, advanced
        ORDER BY event_values.sequence
        RETURNING *
      `,
      values,
    );
    if (result.rows.length === events.length) {
      return result.rows
        .map(customerRunEventFromRow)
        .sort((left, right) => left.sequence - right.sequence);
    }
    const run = await this.getCustomerRun(first.runId);
    if (!run) throw new Error(`Customer run not found: ${first.runId}`);
    throw new CustomerRunSequenceConflictError(
      first.runId,
      first.expectedSequence,
      run.nextEventSequence,
    );
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

}
