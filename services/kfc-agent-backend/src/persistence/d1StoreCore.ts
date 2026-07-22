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
  CustomerRunIdempotencyConflictError,
  CustomerRunSequenceConflictError,
  customerRunEventSchema,
  type CustomerRun,
  type CustomerRunEvent,
} from '../customerRuns/contracts.js';
import {
  D1Result,
  D1PreparedStatement,
  D1DatabaseLike,
  ConversationTurnRow,
  ConversationProfileRow,
  StoredEventRow,
  IrreversibleOperationRow,
  DashboardEventRow,
  DashboardSessionSummary,
  WebhookDeliveryRow,
  SessionControlRow,
  PendingCustomerTurnRow,
  AgentRunRow,
  AgentRunTurnRow,
  SessionAgentStateRow,
  CustomerRunRow,
  CustomerRunEventRow,
  D1TableInfoRow,
  schemaStatements,
  parsePayload,
  turnFromRow,
  parseNullablePayload,
  profileFromRow,
  storedEventFromRow,
  dashboardEventFromRow,
  webhookDeliveryFromRow,
  sessionControlFromRow,
  customerRunFromRow,
  customerRunEventFromRow,
  defaultSessionControl,
  pendingCustomerTurnFromRow,
  agentRunFromRow,
  agentRunTurnFromRow,
  sessionAgentStateFromRow,
  defaultSessionAgentState,
} from './d1StoreSupport.js';
import { isD1RunCommitFenceCurrent } from './d1StoreRunCommit.js';
import { d1ActiveSessionAuthoritySource } from './d1StoreSessionAuthority.js';
import { appendD1CustomerRunEventsIfRunCurrent } from './d1StoreCustomerRunEventCommit.js';
import { commitD1PausedCustomerRunIntake } from './d1StorePausedCustomerRunIntake.js';

export abstract class D1StoreCore {
  constructor(
    protected readonly db: D1DatabaseLike,
    protected readonly sessionResetHook?: SessionResetHook,
  ) {}

  async isRunCommitFenceCurrent(
    input: IsRunCommitFenceCurrentInput,
  ): Promise<boolean> {
    return isD1RunCommitFenceCurrent({ db: this.db, guard: input });
  }

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

  async reserveIrreversibleOperation(
    input: IrreversibleOperationInput,
  ): Promise<IrreversibleOperationReservation> {
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + 30_000).toISOString();
    const leaseToken = crypto.randomUUID();
    const inserted = await this.db
      .prepare(
        `INSERT OR IGNORE INTO irreversible_operations (
      request_id, session_id, operation, binding_fingerprint,
      session_authority_generation, result_json, status, attempt_count,
      lease_expires_at, lease_token, last_error, created_at, completed_at
    )
    SELECT ?, ?, ?, ?, authority.session_authority_generation,
           NULL, 'attempting', 1, ?, ?, NULL, ?, NULL
    FROM (${d1ActiveSessionAuthoritySource}) AS authority`,
      )
      .bind(
        input.requestId,
        input.sessionId,
        input.operation,
        input.bindingFingerprint,
        leaseExpiresAt,
        leaseToken,
        now.toISOString(),
        input.sessionId,
      )
      .run();
    const current = await this.irreversibleOperationRow(input);
    if (!current) throw new Error('session_ai_authority_unavailable');
    if (!(await this.isIrreversibleOperationAuthorityCurrent(input, current))) {
      throw new Error('session_ai_authority_unavailable');
    }
    if (current.result_json)
      return {
        status: 'completed',
        result: JSON.parse(current.result_json) as Record<string, unknown>,
      };
    if (Number(inserted.meta.changes ?? 0) > 0)
      return {
        status: 'reserved',
        attempt: 1,
        leaseToken,
        reconciliation: false,
        sessionAuthorityGeneration: current.session_authority_generation,
      };
    if (
      current.status === 'unknown' ||
      (current.lease_expires_at !== null &&
        current.lease_expires_at <= now.toISOString())
    ) {
      const nextAttempt = current.attempt_count + 1;
      const nextLeaseToken = crypto.randomUUID();
      const claimed = await this.db
        .prepare(
          `UPDATE irreversible_operations
        SET status = 'attempting', attempt_count = attempt_count + 1,
            lease_expires_at = ?, lease_token = ?, last_error = NULL
        WHERE request_id = ? AND session_id = ? AND operation = ? AND binding_fingerprint = ?
          AND status != 'completed' AND (status = 'unknown' OR lease_expires_at <= ?)
          AND EXISTS (
            SELECT 1
            FROM (${d1ActiveSessionAuthoritySource}) AS authority
            WHERE authority.session_authority_generation =
              irreversible_operations.session_authority_generation
          )`,
        )
        .bind(
          leaseExpiresAt,
          nextLeaseToken,
          input.requestId,
          input.sessionId,
          input.operation,
          input.bindingFingerprint,
          now.toISOString(),
          input.sessionId,
        )
        .run();
      if (Number(claimed.meta.changes ?? 0) > 0) {
        return {
          status: 'reserved',
          attempt: nextAttempt,
          leaseToken: nextLeaseToken,
          reconciliation: true,
          sessionAuthorityGeneration: current.session_authority_generation,
        };
      }
    }
    return current.status === 'unknown'
      ? { status: 'unknown', lastError: current.last_error }
      : { status: 'pending' };
  }

  async getIrreversibleOperation(
    input: IrreversibleOperationInput,
  ): Promise<IrreversibleOperationReservation | undefined> {
    const current = await this.irreversibleOperationRow(input);
    if (!current) return undefined;
    if (!(await this.isIrreversibleOperationAuthorityCurrent(input, current))) {
      return undefined;
    }
    return current.result_json
      ? {
          status: 'completed',
          result: JSON.parse(current.result_json) as Record<string, unknown>,
        }
      : current.status === 'unknown'
        ? { status: 'unknown', lastError: current.last_error }
        : { status: 'pending' };
  }

  async markIrreversibleOperationOutcomeUnknownIfExpired(
    input: MarkIrreversibleOperationOutcomeUnknownIfExpiredInput,
  ): Promise<MarkIrreversibleOperationOutcomeUnknownIfExpiredResult> {
    const changed = await this.db
      .prepare(
        `UPDATE irreversible_operations
       SET status = 'unknown',
           lease_expires_at = NULL,
           last_error = ?
       WHERE request_id = ?
         AND session_id = ?
         AND operation = ?
         AND binding_fingerprint = ?
         AND status = 'attempting'
         AND unixepoch('now') >= unixepoch(lease_expires_at)
         AND EXISTS (
           SELECT 1
           FROM (${d1ActiveSessionAuthoritySource}) AS authority
           WHERE authority.session_authority_generation =
             irreversible_operations.session_authority_generation
         )`,
      )
      .bind(
        input.reason,
        input.requestId,
        input.sessionId,
        input.operation,
        input.bindingFingerprint,
        input.sessionId,
      )
      .run();
    const current = await this.irreversibleOperationRow(input);
    if (
      !current ||
      !(await this.isIrreversibleOperationAuthorityCurrent(input, current))
    ) {
      return { status: 'pending' };
    }
    if (current.status === 'completed' && current.result_json) {
      return {
        status: 'completed',
        result: JSON.parse(current.result_json) as Record<string, unknown>,
      };
    }
    if (current.status === 'unknown') {
      return {
        status: 'unknown',
        lastError: current.last_error,
        transitioned: Number(changed.meta.changes ?? 0) === 1,
      };
    }
    return { status: 'pending' };
  }

  async completeIrreversibleOperation(
    input: IrreversibleOperationInput,
    owner: IrreversibleOperationOwner,
    result: Record<string, unknown>,
  ): Promise<IrreversibleOperationCompletion> {
    await this.db
      .prepare(
        `UPDATE irreversible_operations
      SET result_json = COALESCE(result_json, ?), status = 'completed',
          lease_expires_at = NULL, last_error = NULL, completed_at = COALESCE(completed_at, ?)
      WHERE request_id = ? AND session_id = ? AND operation = ? AND binding_fingerprint = ?
        AND status = 'attempting'
        AND attempt_count = ?
        AND lease_token = ?
        AND session_authority_generation = ?
        AND unixepoch('now') < unixepoch(lease_expires_at)
        AND EXISTS (
          SELECT 1
          FROM (${d1ActiveSessionAuthoritySource}) AS authority
          WHERE authority.session_authority_generation =
            irreversible_operations.session_authority_generation
        )`,
      )
      .bind(
        JSON.stringify(result),
        new Date().toISOString(),
        input.requestId,
        input.sessionId,
        input.operation,
        input.bindingFingerprint,
        owner.attempt,
        owner.leaseToken,
        owner.sessionAuthorityGeneration,
        input.sessionId,
      )
      .run();
    const current = await this.irreversibleOperationRow(input);
    if (!current) {
      throw new Error(
        `Irreversible operation reservation not found: ${input.requestId}`,
      );
    }
    const currentAuthority = await this.isIrreversibleOperationAuthorityCurrent(
      input,
      current,
    );
    return currentAuthority &&
      current.session_authority_generation ===
        owner.sessionAuthorityGeneration &&
      current.status === 'completed' &&
      current.result_json
      ? {
          status: 'completed',
          result: JSON.parse(current.result_json) as Record<string, unknown>,
        }
      : { status: 'lost' };
  }

  async failIrreversibleOperation(
    input: IrreversibleOperationInput,
    owner: IrreversibleOperationOwner,
    error: string,
  ): Promise<void> {
    await this.db
      .prepare(
        `UPDATE irreversible_operations
      SET status = 'unknown', lease_expires_at = NULL, last_error = ?
      WHERE request_id = ? AND session_id = ? AND operation = ? AND binding_fingerprint = ?
        AND status = 'attempting'
        AND attempt_count = ?
        AND lease_token = ?
        AND session_authority_generation = ?
        AND unixepoch('now') < unixepoch(lease_expires_at)
        AND EXISTS (
          SELECT 1
          FROM (${d1ActiveSessionAuthoritySource}) AS authority
          WHERE authority.session_authority_generation =
            irreversible_operations.session_authority_generation
        )`,
      )
      .bind(
        error,
        input.requestId,
        input.sessionId,
        input.operation,
        input.bindingFingerprint,
        owner.attempt,
        owner.leaseToken,
        owner.sessionAuthorityGeneration,
        input.sessionId,
      )
      .run();
    if (!(await this.irreversibleOperationRow(input))) {
      throw new Error(
        `Irreversible operation reservation not found: ${input.requestId}`,
      );
    }
  }

  private async irreversibleOperationRow(
    input: IrreversibleOperationInput,
  ): Promise<IrreversibleOperationRow | null> {
    const row = await this.db
      .prepare(
        `SELECT request_id, session_id, operation, binding_fingerprint, result_json,
              session_authority_generation, status, attempt_count,
              lease_expires_at, lease_token, last_error
       FROM irreversible_operations WHERE request_id = ?`,
      )
      .bind(input.requestId)
      .first<IrreversibleOperationRow>();
    if (!row) return null;
    if (
      row.session_id !== input.sessionId ||
      row.operation !== input.operation ||
      row.binding_fingerprint !== input.bindingFingerprint
    ) {
      throw new Error(
        `Irreversible operation binding conflict: ${input.requestId}`,
      );
    }
    return row;
  }

  private async isIrreversibleOperationAuthorityCurrent(
    input: IrreversibleOperationInput,
    row: IrreversibleOperationRow,
  ): Promise<boolean> {
    const current = await this.db
      .prepare(
        `SELECT 1 AS current
       FROM (${d1ActiveSessionAuthoritySource}) AS authority
       WHERE authority.session_authority_generation = ?`,
      )
      .bind(input.sessionId, row.session_authority_generation)
      .first<{ current: number }>();
    return current?.current === 1;
  }

  async createCustomerRun(input: CreateCustomerRunInput): Promise<CustomerRun> {
    const insert = this.db
      .prepare(
        `INSERT OR IGNORE INTO customer_runs (
          id, schema_version, session_id, customer_id, client_message_id,
          request_fingerprint, generation, session_authority_generation,
          status, phase, next_event_sequence,
          client_schema_version, accepted_at, started_at, terminal_at, updated_at
        )
        SELECT ?, ?, ?, ?, ?, ?, ?,
               authority.session_authority_generation,
               ?, ?, ?, ?, ?, ?, ?, ?
        FROM (${d1ActiveSessionAuthoritySource}) AS authority`,
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
        input.clientSchemaVersion,
        input.acceptedAt,
        input.startedAt,
        input.terminalAt,
        input.updatedAt,
        input.sessionId,
      );
    const select = this.db
      .prepare(
        `SELECT * FROM customer_runs
         WHERE session_id = ? AND client_message_id = ? LIMIT 1`,
      )
      .bind(input.sessionId, input.clientMessageId);
    const stored = this.db.batch
      ? await (async () => {
          const row = (await this.db.batch!([insert, select]))[1]
            ?.results?.[0] as unknown as CustomerRunRow | undefined;
          return row ? customerRunFromRow(row) : undefined;
        })()
      : await (async () => {
          await insert.run();
          const row = await select.first<CustomerRunRow>();
          return row ? customerRunFromRow(row) : undefined;
        })();
    if (!stored) throw new Error('Customer run was not persisted');
    if (stored.requestFingerprint !== input.requestFingerprint) {
      throw new CustomerRunIdempotencyConflictError(
        input.sessionId,
        input.clientMessageId,
      );
    }
    return stored;
  }

  async createCustomerRunWithEvent(
    input: CreateCustomerRunInput,
    eventInput: AppendCustomerRunEventInput,
  ): Promise<{
    run: CustomerRun;
    event?: CustomerRunEvent;
    created: boolean;
  }> {
    if (!this.db.batch) {
      const run = await this.createCustomerRun(input);
      if (run.id !== input.id) return { run, created: false };
      const event = await this.appendCustomerRunEvent(eventInput);
      return { run: { ...run, nextEventSequence: 2 }, event, created: true };
    }
    const { expectedSequence, ...eventFields } = eventInput;
    const event = customerRunEventSchema.parse({
      ...eventFields,
      sequence: expectedSequence,
    });
    const insertRun = this.db
      .prepare(
        `INSERT OR IGNORE INTO customer_runs (
          id, schema_version, session_id, customer_id, client_message_id,
          request_fingerprint, generation, session_authority_generation,
          status, phase, next_event_sequence,
          client_schema_version, accepted_at, started_at, terminal_at, updated_at
        )
        SELECT ?, ?, ?, ?, ?, ?, ?,
               authority.session_authority_generation,
               ?, ?, ?, ?, ?, ?, ?, ?
        FROM (${d1ActiveSessionAuthoritySource}) AS authority`,
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
        input.clientSchemaVersion,
        input.acceptedAt,
        input.startedAt,
        input.terminalAt,
        input.updatedAt,
        input.sessionId,
      );
    const selectRun = this.db
      .prepare(
        `SELECT * FROM customer_runs
         WHERE session_id = ? AND client_message_id = ? LIMIT 1`,
      )
      .bind(input.sessionId, input.clientMessageId);
    const insertEvent = this.db
      .prepare(
        `INSERT OR IGNORE INTO customer_run_events (
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
      );
    const advanceRun = this.db
      .prepare(
        `UPDATE customer_runs
         SET next_event_sequence = ?, updated_at = ?
         WHERE id = ? AND next_event_sequence = ?`,
      )
      .bind(event.sequence + 1, event.occurredAt, event.runId, event.sequence);
    const results = await this.db.batch([
      insertRun,
      selectRun,
      insertEvent,
      advanceRun,
    ]);
    const row = results[1]?.results?.[0] as unknown as
      CustomerRunRow | undefined;
    if (!row) throw new Error('Customer run was not persisted');
    const stored = customerRunFromRow(row);
    if (stored.requestFingerprint !== input.requestFingerprint) {
      throw new CustomerRunIdempotencyConflictError(
        input.sessionId,
        input.clientMessageId,
      );
    }
    const created = Number(results[0]?.meta.changes ?? 0) === 1;
    if (!created) return { run: stored, created: false };
    if (
      Number(results[2]?.meta.changes ?? 0) !== 1 ||
      Number(results[3]?.meta.changes ?? 0) !== 1
    ) {
      throw new CustomerRunSequenceConflictError(
        input.id,
        event.sequence,
        stored.nextEventSequence,
      );
    }
    return {
      run: {
        ...stored,
        nextEventSequence: event.sequence + 1,
        updatedAt: event.occurredAt,
      },
      event,
      created: true,
    };
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

  async updateCustomerRun(
    runId: string,
    patch: CustomerRunPatch,
  ): Promise<CustomerRun> {
    const assignments: string[] = [];
    const values: unknown[] = [];
    const add = (column: string, value: unknown) => {
      if (value === undefined) return;
      assignments.push(`${column} = ?`);
      values.push(value);
    };
    add('status', patch.status);
    add('phase', patch.phase);
    add('started_at', patch.startedAt);
    add('terminal_at', patch.terminalAt);
    add('updated_at', patch.updatedAt ?? new Date().toISOString());
    const update = this.db
      .prepare(
        `UPDATE customer_runs SET ${assignments.join(', ')} WHERE id = ?`,
      )
      .bind(...values, runId);
    const select = this.db
      .prepare(`SELECT * FROM customer_runs WHERE id = ? LIMIT 1`)
      .bind(runId);
    if (this.db.batch) {
      const results = await this.db.batch([update, select]);
      if (Number(results[0]?.meta.changes ?? 0) !== 1) {
        throw new Error(`Customer run not found: ${runId}`);
      }
      const row = results[1]?.results?.[0] as unknown as
        CustomerRunRow | undefined;
      if (!row) throw new Error(`Customer run not found: ${runId}`);
      return customerRunFromRow(row);
    }
    const result = await update.run();
    if (Number(result.meta.changes ?? 0) !== 1) {
      throw new Error(`Customer run not found: ${runId}`);
    }
    const row = await select.first<CustomerRunRow>();
    if (!row) throw new Error(`Customer run not found: ${runId}`);
    return customerRunFromRow(row);
  }

  async appendCustomerRunEvent(
    input: AppendCustomerRunEventInput,
  ): Promise<CustomerRunEvent> {
    if (!this.db.batch) {
      throw new Error(
        'Atomic D1 batch support is required for customer run events',
      );
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
        .bind(
          event.sequence + 1,
          event.occurredAt,
          event.runId,
          event.sequence,
        ),
    ]);
    if (Number(results[0]?.meta.changes ?? 0) !== 1) {
      const actual =
        (await this.getCustomerRun(event.runId))?.nextEventSequence ?? 0;
      throw new CustomerRunSequenceConflictError(
        event.runId,
        event.sequence,
        actual,
      );
    }
    return event;
  }

  async appendCustomerRunEvents(
    inputs: AppendCustomerRunEventInput[],
  ): Promise<CustomerRunEvent[]> {
    if (inputs.length === 0) return [];
    if (!this.db.batch) {
      throw new Error(
        'Atomic D1 batch support is required for customer run events',
      );
    }
    const events = inputs.map(({ expectedSequence, ...eventInput }) =>
      customerRunEventSchema.parse({
        ...eventInput,
        sequence: expectedSequence,
      }),
    );
    const statements = events.flatMap((event) => [
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
        .bind(
          event.sequence + 1,
          event.occurredAt,
          event.runId,
          event.sequence,
        ),
    ]);
    const results = await this.db.batch(statements);
    const failedIndex = events.findIndex(
      (_, index) => Number(results[index * 2]?.meta.changes ?? 0) !== 1,
    );
    if (failedIndex >= 0) {
      const failed = events[failedIndex]!;
      const actual =
        (await this.getCustomerRun(failed.runId))?.nextEventSequence ?? 0;
      throw new CustomerRunSequenceConflictError(
        failed.runId,
        failed.sequence,
        actual,
      );
    }
    return events;
  }

  async appendCustomerRunEventsIfRunCurrent(
    input: AppendCustomerRunEventsIfRunCurrentInput,
  ): Promise<AppendCustomerRunEventsIfRunCurrentResult> {
    return appendD1CustomerRunEventsIfRunCurrent({
      db: this.db,
      operation: input,
    });
  }

  async commitPausedCustomerRunIntake(
    input: CommitPausedCustomerRunIntakeInput,
  ): Promise<CommitPausedCustomerRunIntakeResult> {
    return commitD1PausedCustomerRunIntake({
      db: this.db,
      operation: input,
    });
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

  private async ensureConversationTurnMetadataColumn(): Promise<void> {
    const columns = await this.db
      .prepare(`PRAGMA table_info(conversation_turns)`)
      .all<D1TableInfoRow>();
    if ((columns.results ?? []).some((column) => column.name === 'metadata'))
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
      .bind('conversation_profiles')
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
          session_authority_generation INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL
        )`,
      )
      .run();
  }
}
