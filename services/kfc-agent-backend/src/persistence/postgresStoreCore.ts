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
  CreateCustomerRunInput,
  HistorySearchResult,
  IrreversibleOperationInput,
  IrreversibleOperationCompletion,
  IrreversibleOperationOwner,
  IrreversibleOperationReservation,
  MarkIrreversibleOperationOutcomeUnknownIfExpiredInput,
  MarkIrreversibleOperationOutcomeUnknownIfExpiredResult,
  CommitPausedCustomerRunIntakeInput,
  CommitPausedCustomerRunIntakeResult,
  IsRunCommitFenceCurrentInput,
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
  AppendCustomerRunEventsIfRunCurrentInput,
  AppendCustomerRunEventsIfRunCurrentResult,
  CustomerRunPatch,
} from './memoryStore.js';
import {
  CustomerRunSequenceConflictError,
  customerRunEventSchema,
  type CustomerRun,
  type CustomerRunEvent,
} from '../customerRuns/contracts.js';
import {
  createPostgresCustomerRun,
} from './postgresStoreCustomerRunCreation.js';
import {
  appendPostgresCustomerRunEventsIfRunCurrent,
} from './postgresStoreCustomerRunEventCommit.js';
import {
  commitPostgresPausedCustomerRunIntake,
} from './postgresStorePausedCustomerRunIntake.js';
import { PostgresCheckpointSaver } from './postgresCheckpointSaver.js';
import {
  initializePostgresNonAgentTextDeliverySchema,
} from './postgresStoreNonAgentTextDelivery.js';
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
import {
  completePostgresIrreversibleOperation,
  failPostgresIrreversibleOperation,
  getPostgresIrreversibleOperation,
  markPostgresIrreversibleOperationOutcomeUnknownIfExpired,
  reservePostgresIrreversibleOperation,
} from './postgresStoreIrreversibleOperations.js';
import { resetPostgresSession } from './postgresStoreSessionReset.js';
import { isPostgresRunCommitFenceCurrent } from './postgresStoreRunCommit.js';

export abstract class PostgresStoreCore {
  constructor(
    protected readonly db: Queryable,
    protected readonly sessionResetHook?: SessionResetHook,
  ) {}

  async isRunCommitFenceCurrent(
    input: IsRunCommitFenceCurrentInput,
  ): Promise<boolean> {
    return isPostgresRunCommitFenceCurrent({ db: this.db, guard: input });
  }

  async resetSession(sessionId: string): Promise<SessionControl> {
    return resetPostgresSession({
      db: this.db,
      sessionId,
      sessionResetHook: this.sessionResetHook,
    });
  }

  async initialize(): Promise<void> {
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS confirmation_pause_sessions (
        session_id text PRIMARY KEY,
        generation integer NOT NULL CHECK (generation >= 0)
      )
    `);
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS confirmation_pauses (
        schema_version text NOT NULL,
        request_id text PRIMARY KEY,
        checkpoint_thread_id text NOT NULL,
        checkpoint_namespace text NOT NULL,
        checkpoint_id text NOT NULL,
        session_id text NOT NULL,
        session_generation integer NOT NULL CHECK (session_generation >= 0),
        pause_identity_digest text NOT NULL,
        customer_id text NOT NULL,
        channel text NOT NULL,
        action_json jsonb NOT NULL,
        action_digest text NOT NULL,
        approval_binding_json jsonb NOT NULL,
        approval_binding_digest text NOT NULL,
        principal_json jsonb NOT NULL,
        authenticated_subject text NOT NULL,
        authentication_evidence_ref text NOT NULL,
        created_at timestamptz NOT NULL,
        expires_at timestamptz NOT NULL,
        status text NOT NULL CHECK (status IN ('pending', 'rejected', 'expired')),
        rejection_receipt_id text,
        rejection_receipt_json jsonb,
        rejected_at timestamptz,
        completion_status text NOT NULL CHECK (completion_status IN ('pending', 'completed', 'failed')),
        result_json jsonb,
        completion_error text,
        completed_at timestamptz
      )
    `);
    await this.db.query(`
      CREATE INDEX IF NOT EXISTS confirmation_pauses_session_idx
      ON confirmation_pauses (session_id, created_at)
    `);
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS irreversible_operations (
        request_id text PRIMARY KEY,
        session_id text NOT NULL,
        operation text NOT NULL,
        binding_fingerprint text NOT NULL,
        session_authority_generation integer NOT NULL DEFAULT 0,
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
        session_authority_generation integer NOT NULL DEFAULT 0,
        updated_at timestamptz NOT NULL
      )
    `);
    await initializePostgresNonAgentTextDeliverySchema(this.db);
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
        session_authority_generation integer NOT NULL DEFAULT 0,
        channel text NOT NULL,
        external_user_id text NOT NULL,
        status text NOT NULL,
        execution_attempt integer NOT NULL DEFAULT 0,
        execution_lease_token text,
        execution_lease_expires_at timestamptz,
        CONSTRAINT agent_runs_execution_attempt_nonnegative
          CHECK (execution_attempt >= 0),
        CONSTRAINT agent_runs_execution_lease_pair CHECK (
          (execution_lease_token IS NULL AND execution_lease_expires_at IS NULL)
          OR
          (execution_lease_token IS NOT NULL AND execution_lease_expires_at IS NOT NULL)
        ),
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
      ALTER TABLE agent_runs
      ADD COLUMN IF NOT EXISTS execution_attempt integer NOT NULL DEFAULT 0
    `);
    await this.db.query(`
      ALTER TABLE agent_runs
      ADD COLUMN IF NOT EXISTS execution_lease_token text
    `);
    await this.db.query(`
      ALTER TABLE agent_runs
      ADD COLUMN IF NOT EXISTS execution_lease_expires_at timestamptz
    `);
    await this.db.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'agent_runs_execution_attempt_nonnegative'
            AND conrelid = 'agent_runs'::regclass
        ) THEN
          ALTER TABLE agent_runs
          ADD CONSTRAINT agent_runs_execution_attempt_nonnegative
          CHECK (execution_attempt >= 0);
        END IF;
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'agent_runs_execution_lease_pair'
            AND conrelid = 'agent_runs'::regclass
        ) THEN
          ALTER TABLE agent_runs
          ADD CONSTRAINT agent_runs_execution_lease_pair
          CHECK (
            (
              execution_lease_token IS NULL
              AND execution_lease_expires_at IS NULL
            )
            OR
            (
              execution_lease_token IS NOT NULL
              AND execution_lease_expires_at IS NOT NULL
            )
          );
        END IF;
      END
      $$;
    `);
    await this.db.query(`
      CREATE INDEX IF NOT EXISTS agent_runs_session_generation_idx
      ON agent_runs (session_id, generation, id)
    `);
    await this.db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS agent_runs_session_generation_claim_idx
      ON agent_runs (session_id, generation)
    `);
    await this.db.query(`
      CREATE INDEX IF NOT EXISTS agent_runs_execution_lease_recovery_idx
      ON agent_runs (status, execution_lease_expires_at)
    `);
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS agent_run_text_deliveries (
        schema_version text NOT NULL CHECK (
          schema_version = 'kfc-agent-run-text-delivery-v1'
        ),
        run_id text PRIMARY KEY REFERENCES agent_runs(id) ON DELETE CASCADE
          CHECK (
            length(run_id) BETWEEN 1 AND 512
            AND run_id = btrim(run_id)
          ),
        run_execution_attempt integer NOT NULL CHECK (
          run_execution_attempt BETWEEN 1 AND 3
        ),
        run_execution_origin_attempt integer NOT NULL CHECK (
          run_execution_origin_attempt BETWEEN 1 AND 3
          AND run_execution_origin_attempt <=
            run_execution_attempt
        ),
        run_execution_lease_token text NOT NULL CHECK (
          length(run_execution_lease_token) BETWEEN 1 AND 512
          AND run_execution_lease_token =
            btrim(run_execution_lease_token)
        ),
        run_execution_lease_token_digest text NOT NULL CHECK (
          run_execution_lease_token_digest ~ '^[a-f0-9]{64}$'
        ),
        prior_run_execution_lease_token_digests jsonb NOT NULL
          DEFAULT '[]'::jsonb CHECK (
            jsonb_typeof(prior_run_execution_lease_token_digests) =
              'array'
            AND jsonb_array_length(
              prior_run_execution_lease_token_digests
            ) = run_execution_attempt -
              run_execution_origin_attempt
          ),
        channel text NOT NULL CHECK (
          channel IN ('messenger', 'zalo')
        ),
        assistant_turn_id text NOT NULL UNIQUE
          REFERENCES conversation_turns(id)
          CHECK (
            length(assistant_turn_id) BETWEEN 1 AND 512
            AND assistant_turn_id = btrim(assistant_turn_id)
          ),
        recipient_binding_digest text NOT NULL CHECK (
          recipient_binding_digest ~ '^[a-f0-9]{64}$'
        ),
        presentation_binding_digest text NOT NULL CHECK (
          presentation_binding_digest ~ '^[a-f0-9]{64}$'
        ),
        delivery_binding_digest text NOT NULL CHECK (
          delivery_binding_digest ~ '^[a-f0-9]{64}$'
        ),
        status text NOT NULL CHECK (
          status IN (
            'pending',
            'sending',
            'confirmed_not_sent',
            'confirmed_sent',
            'delivery_outcome_unknown'
          )
        ),
        delivery_attempt integer NOT NULL CHECK (
          delivery_attempt BETWEEN 0 AND 3
        ),
        last_delivery_run_execution_attempt integer CHECK (
          last_delivery_run_execution_attempt IS NULL
          OR last_delivery_run_execution_attempt BETWEEN 1 AND 3
        ),
        delivery_attempt_token text CHECK (
          delivery_attempt_token IS NULL
          OR (
            length(delivery_attempt_token) BETWEEN 1 AND 512
            AND delivery_attempt_token =
              btrim(delivery_attempt_token)
          )
        ),
        provider_message_id text CHECK (
          provider_message_id IS NULL
          OR (
            length(provider_message_id) BETWEEN 1 AND 512
            AND provider_message_id = btrim(provider_message_id)
          )
        ),
        outcome_code text CHECK (
          outcome_code IS NULL
          OR (
            length(outcome_code) BETWEEN 1 AND 256
            AND outcome_code = btrim(outcome_code)
          )
        ),
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL CHECK (
          updated_at >= created_at
        ),
        CHECK (
          (
            status = 'pending'
            AND delivery_attempt = 0
            AND delivery_attempt_token IS NULL
            AND last_delivery_run_execution_attempt IS NULL
            AND provider_message_id IS NULL
            AND outcome_code IS NULL
          )
          OR (
            status = 'sending'
            AND delivery_attempt BETWEEN 1 AND 3
            AND delivery_attempt_token IS NOT NULL
            AND last_delivery_run_execution_attempt IS NOT NULL
            AND last_delivery_run_execution_attempt =
              run_execution_attempt
            AND provider_message_id IS NULL
            AND outcome_code IS NULL
          )
          OR (
            status = 'confirmed_not_sent'
            AND delivery_attempt BETWEEN 1 AND 3
            AND delivery_attempt_token IS NOT NULL
            AND last_delivery_run_execution_attempt IS NOT NULL
            AND run_execution_attempt BETWEEN
              last_delivery_run_execution_attempt
              AND last_delivery_run_execution_attempt + 1
            AND provider_message_id IS NULL
            AND outcome_code IS NOT NULL
          )
          OR (
            status = 'confirmed_sent'
            AND delivery_attempt BETWEEN 1 AND 3
            AND delivery_attempt_token IS NOT NULL
            AND last_delivery_run_execution_attempt IS NOT NULL
            AND last_delivery_run_execution_attempt =
              run_execution_attempt
            AND provider_message_id IS NOT NULL
            AND outcome_code IS NULL
          )
          OR (
            status = 'delivery_outcome_unknown'
            AND delivery_attempt BETWEEN 1 AND 3
            AND delivery_attempt_token IS NOT NULL
            AND last_delivery_run_execution_attempt IS NOT NULL
            AND last_delivery_run_execution_attempt =
              run_execution_attempt
            AND provider_message_id IS NULL
            AND outcome_code IS NOT NULL
          )
        )
      )
    `);
    await this.db.query(`
      CREATE INDEX IF NOT EXISTS agent_run_text_deliveries_recovery_idx
      ON agent_run_text_deliveries (status, updated_at)
    `);
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS agent_run_text_delivery_attempts (
        run_id text NOT NULL REFERENCES agent_run_text_deliveries(run_id)
          ON DELETE CASCADE,
        delivery_attempt integer NOT NULL CHECK (
          delivery_attempt BETWEEN 1 AND 3
        ),
        delivery_attempt_token text NOT NULL CHECK (
          length(delivery_attempt_token) BETWEEN 1 AND 512
          AND delivery_attempt_token = btrim(delivery_attempt_token)
        ),
        created_at timestamptz NOT NULL,
        PRIMARY KEY (run_id, delivery_attempt),
        UNIQUE (delivery_attempt_token)
      )
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
        session_authority_generation integer NOT NULL DEFAULT 0,
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
    for (const table of [
      'session_controls',
      'customer_runs',
      'agent_runs',
      'irreversible_operations',
    ]) {
      await this.db.query(`
        ALTER TABLE ${table}
        ADD COLUMN IF NOT EXISTS session_authority_generation
          integer NOT NULL DEFAULT 0
      `);
    }
  }

  async reserveIrreversibleOperation(input: IrreversibleOperationInput): Promise<IrreversibleOperationReservation> {
    return reservePostgresIrreversibleOperation({
      db: this.db,
      operation: input,
    });
  }

  async getIrreversibleOperation(input: IrreversibleOperationInput): Promise<IrreversibleOperationReservation | undefined> {
    return getPostgresIrreversibleOperation({
      db: this.db,
      operation: input,
    });
  }

  async markIrreversibleOperationOutcomeUnknownIfExpired(
    input: MarkIrreversibleOperationOutcomeUnknownIfExpiredInput,
  ): Promise<MarkIrreversibleOperationOutcomeUnknownIfExpiredResult> {
    return markPostgresIrreversibleOperationOutcomeUnknownIfExpired({
      db: this.db,
      operation: input,
    });
  }

  async completeIrreversibleOperation(
    input: IrreversibleOperationInput,
    owner: IrreversibleOperationOwner,
    result: Record<string, unknown>,
  ): Promise<IrreversibleOperationCompletion> {
    return completePostgresIrreversibleOperation({
      db: this.db,
      operation: input,
      owner,
      result,
    });
  }

  async failIrreversibleOperation(
    input: IrreversibleOperationInput,
    owner: IrreversibleOperationOwner,
    error: string,
  ): Promise<void> {
    return failPostgresIrreversibleOperation({
      db: this.db,
      operation: input,
      owner,
      error,
    });
  }

  async createCustomerRun(
    input: CreateCustomerRunInput,
  ): Promise<CustomerRun> {
    return createPostgresCustomerRun({
      db: this.db,
      operation: input,
    });
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
    const eventColumnTypes = [
      'text',
      'text',
      'integer',
      'integer',
      'text',
      'timestamptz',
      'jsonb',
    ] as const;
    const rows = events.map((event) => {
      const rowValues = [
        event.eventId,
        event.runId,
        event.sequence,
        event.schemaVersion,
        event.type,
        event.occurredAt,
        event.payload,
      ];
      const placeholders = rowValues.map((value, index) => {
        values.push(value);
        return `$${values.length}::${eventColumnTypes[index]}`;
      });
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

  async appendCustomerRunEventsIfRunCurrent(
    input: AppendCustomerRunEventsIfRunCurrentInput,
  ): Promise<AppendCustomerRunEventsIfRunCurrentResult> {
    return appendPostgresCustomerRunEventsIfRunCurrent({
      db: this.db,
      operation: input,
    });
  }

  async commitPausedCustomerRunIntake(
    input: CommitPausedCustomerRunIntakeInput,
  ): Promise<CommitPausedCustomerRunIntakeResult> {
    return commitPostgresPausedCustomerRunIntake({
      db: this.db,
      operation: input,
    });
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
