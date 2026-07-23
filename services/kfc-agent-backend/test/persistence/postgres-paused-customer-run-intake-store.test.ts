import { describe, expect, it } from 'vitest';
import {
  CustomerRunIdempotencyConflictError,
} from '../../src/customerRuns/contracts.js';
import { Pool } from 'pg';
import type {
  CommitPausedCustomerRunIntakeInput,
} from '../../src/persistence/contracts.js';
import { PostgresStore } from '../../src/persistence/postgresStore.js';
import type {
  ConversationTurnRow,
  CustomerRunEventRow,
  CustomerRunRow,
  SessionControlRow,
} from '../../src/persistence/postgresStoreSupport.js';

const sessionId = 'kfc:postgres-paused-customer';
const customerId = 'postgres-paused-customer';
const clientMessageId = 'postgres-paused-message-1';
const pausedAt = '2026-07-20T09:00:00.000Z';

function pausedIntake(
  overrides: {
    runId?: string;
    requestFingerprint?: string;
    expectedSessionAuthorityGeneration?: number;
  } = {},
): CommitPausedCustomerRunIntakeInput {
  const runId = overrides.runId ?? 'postgres-paused-run-1';
  return {
    expectedSessionAuthorityGeneration:
      overrides.expectedSessionAuthorityGeneration ?? 3,
    run: {
      id: runId,
      schemaVersion: 1,
      sessionId,
      customerId,
      clientMessageId,
      requestFingerprint:
        overrides.requestFingerprint ?? 'sha256:postgres-paused-message-1',
      generation: 4,
      status: 'superseded',
      phase: 'finalizing',
      nextEventSequence: 1,
      clientSchemaVersion: 1,
      acceptedAt: pausedAt,
      startedAt: null,
      terminalAt: pausedAt,
      updatedAt: pausedAt,
    },
    userTurn: {
      sessionId,
      channel: 'kfc',
      role: 'user',
      text: 'Cho mình xem toàn bộ thực đơn',
      externalMessageId: clientMessageId,
      externalUserId: customerId,
      deliveryStatus: 'received',
      metadata: {
        rawEvent: {
          source: 'kfc_customer_run',
          intake: 'human_paused',
        },
      },
      createdAt: pausedAt,
    },
    events: [{
      schemaVersion: 1,
      eventId: `${runId}-superseded`,
      runId,
      expectedSequence: 1,
      type: 'run_superseded',
      occurredAt: pausedAt,
      payload: {
        status: 'superseded',
        suppressed: true,
        agentMode: 'human_paused',
      },
    }],
  };
}

function pausedControl(
  generation = 3,
  agentMode: SessionControlRow['agent_mode'] = 'human_paused',
): SessionControlRow {
  return {
    session_id: sessionId,
    agent_mode: agentMode,
    assigned_agent_id:
      agentMode === 'human_paused' ? 'human-agent-postgres' : null,
    session_authority_generation: generation,
    updated_at: pausedAt,
  };
}

function durableTurnRow(
  input: CommitPausedCustomerRunIntakeInput,
  overrides: Partial<ConversationTurnRow> = {},
): ConversationTurnRow {
  return {
    id: 'durable-user-turn',
    session_id: input.userTurn.sessionId,
    channel: input.userTurn.channel,
    role: input.userTurn.role,
    text: input.userTurn.text,
    external_message_id: input.userTurn.externalMessageId,
    external_user_id: input.userTurn.externalUserId,
    delivery_status: input.userTurn.deliveryStatus,
    metadata:
      input.userTurn.metadata === undefined ||
      input.userTurn.metadata === null
      ? null
      : Object.fromEntries(
          Object.entries(input.userTurn.metadata),
        ),
    created_at: input.userTurn.createdAt ?? pausedAt,
    ...overrides,
  };
}

interface DurableSnapshot {
  controls: Map<string, SessionControlRow>;
  turns: Map<string, ConversationTurnRow>;
  runs: Map<string, CustomerRunRow>;
  events: Map<string, CustomerRunEventRow[]>;
}

function cloneRows<Row>(
  rows: Map<string, Row>,
): Map<string, Row> {
  return new Map(
    [...rows].map(([key, row]) => [key, structuredClone(row)]),
  );
}

function cloneEvents(
  events: Map<string, CustomerRunEventRow[]>,
): Map<string, CustomerRunEventRow[]> {
  return new Map(
    [...events].map(([key, rows]) => [key, structuredClone(rows)]),
  );
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new Error(`fake_postgres_expected_string:${label}`);
  }
  return value;
}

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== 'number') {
    throw new Error(`fake_postgres_expected_number:${label}`);
  }
  return value;
}

function requireNullableString(
  value: unknown,
  label: string,
): string | null {
  if (value === null) return null;
  return requireString(value, label);
}

function requireRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`fake_postgres_expected_record:${label}`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

function requireLiteral<
  const Values extends readonly [string, ...string[]],
>(
  value: unknown,
  label: string,
  values: Values,
): Values[number] {
  const candidate = requireString(value, label);
  if (!values.includes(candidate)) {
    throw new Error(`fake_postgres_expected_literal:${label}`);
  }
  return candidate as Values[number];
}

function requireSchemaVersion(value: unknown): 1 {
  if (value !== 1) {
    throw new Error('fake_postgres_expected_schema_version');
  }
  return 1;
}

function turnKey(
  session: string,
  externalMessageId: string | null,
): string {
  return `${session}\u0000${externalMessageId ?? ''}`;
}

class TransactionalPausedIntakePostgres {
  readonly controls = new Map<string, SessionControlRow>();
  readonly turns = new Map<string, ConversationTurnRow>();
  readonly runs = new Map<string, CustomerRunRow>();
  readonly events = new Map<string, CustomerRunEventRow[]>();
  readonly transactionEvents: string[] = [];
  readonly queries: string[] = [];
  failEventInsert = false;
  releaseCount = 0;
  private transactionSnapshot: DurableSnapshot | undefined;

  async connect() {
    return {
      query: this.query.bind(this),
      release: () => {
        this.releaseCount += 1;
      },
    };
  }

  seedControl(control: SessionControlRow): void {
    this.controls.set(control.session_id, structuredClone(control));
  }

  seedTurn(turn: ConversationTurnRow): void {
    this.turns.set(
      turnKey(turn.session_id, turn.external_message_id),
      structuredClone(turn),
    );
  }

  durableCounts(): {
    turns: number;
    runs: number;
    events: number;
  } {
    return {
      turns: this.turns.size,
      runs: this.runs.size,
      events: [...this.events.values()]
        .reduce((total, rows) => total + rows.length, 0),
    };
  }

  async query(
    sql: string,
    values: unknown[] = [],
  ): Promise<{ rows: object[]; rowCount: number }> {
    const normalized = sql.replace(/\s+/gu, ' ').trim();
    this.queries.push(normalized);

    if (normalized === 'BEGIN') {
      if (this.transactionSnapshot) {
        throw new Error('fake_postgres_nested_transaction');
      }
      this.transactionSnapshot = {
        controls: cloneRows(this.controls),
        turns: cloneRows(this.turns),
        runs: cloneRows(this.runs),
        events: cloneEvents(this.events),
      };
      this.transactionEvents.push('BEGIN');
      return { rows: [], rowCount: 0 };
    }
    if (normalized === 'COMMIT') {
      if (!this.transactionSnapshot) {
        throw new Error('fake_postgres_commit_without_transaction');
      }
      this.transactionSnapshot = undefined;
      this.transactionEvents.push('COMMIT');
      return { rows: [], rowCount: 0 };
    }
    if (normalized === 'ROLLBACK') {
      const snapshot = this.transactionSnapshot;
      if (!snapshot) {
        throw new Error('fake_postgres_rollback_without_transaction');
      }
      this.restoreSnapshot(snapshot);
      this.transactionSnapshot = undefined;
      this.transactionEvents.push('ROLLBACK');
      return { rows: [], rowCount: 0 };
    }
    if (
      normalized ===
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))'
    ) {
      this.assertTransaction();
      return { rows: [{}], rowCount: 1 };
    }
    if (
      normalized.startsWith('SELECT * FROM customer_runs') &&
      normalized.includes('client_message_id = $2') &&
      normalized.endsWith('FOR UPDATE')
    ) {
      this.assertTransaction();
      const requestedSession = requireString(values[0], 'run.session_id');
      const requestedMessage = requireString(
        values[1],
        'run.client_message_id',
      );
      const row = [...this.runs.values()].find(
        (candidate) =>
          candidate.session_id === requestedSession &&
          candidate.client_message_id === requestedMessage,
      );
      return row
        ? { rows: [structuredClone(row)], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    if (
      normalized.startsWith('SELECT * FROM session_controls') &&
      normalized.endsWith('FOR UPDATE')
    ) {
      this.assertTransaction();
      const row = this.controls.get(
        requireString(values[0], 'control.session_id'),
      );
      return row
        ? { rows: [structuredClone(row)], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    if (
      normalized.startsWith('SELECT * FROM conversation_turns') &&
      normalized.endsWith('FOR UPDATE')
    ) {
      this.assertTransaction();
      const key = turnKey(
        requireString(values[0], 'turn.session_id'),
        requireString(values[1], 'turn.external_message_id'),
      );
      const row = this.turns.get(key);
      return row
        ? { rows: [structuredClone(row)], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    if (normalized.startsWith('INSERT INTO conversation_turns')) {
      this.assertTransaction();
      const row = this.conversationTurnRow(values);
      const key = turnKey(row.session_id, row.external_message_id);
      if (this.turns.has(key)) {
        throw new Error('fake_postgres_duplicate_conversation_turn');
      }
      this.turns.set(key, structuredClone(row));
      return { rows: [structuredClone(row)], rowCount: 1 };
    }
    if (normalized.startsWith('INSERT INTO customer_runs')) {
      this.assertTransaction();
      const row = this.customerRunRow(values);
      if (
        this.runs.has(row.id) ||
        [...this.runs.values()].some(
          (candidate) =>
            candidate.session_id === row.session_id &&
            candidate.client_message_id === row.client_message_id,
        )
      ) {
        throw new Error('fake_postgres_duplicate_customer_run');
      }
      this.runs.set(row.id, structuredClone(row));
      return { rows: [structuredClone(row)], rowCount: 1 };
    }
    if (normalized.startsWith('INSERT INTO customer_run_events')) {
      this.assertTransaction();
      if (this.failEventInsert) {
        throw new Error('injected customer run event insert failure');
      }
      const row = this.customerRunEventRow(values);
      const existing = this.events.get(row.run_id) ?? [];
      if (
        existing.some(
          (candidate) =>
            candidate.event_id === row.event_id ||
            candidate.sequence === row.sequence,
        )
      ) {
        throw new Error('fake_postgres_duplicate_customer_run_event');
      }
      this.events.set(row.run_id, [
        ...existing,
        structuredClone(row),
      ]);
      return { rows: [structuredClone(row)], rowCount: 1 };
    }
    if (
      normalized.startsWith('SELECT * FROM conversation_turns') &&
      normalized.endsWith('LIMIT 1')
    ) {
      this.assertTransaction();
      const key = turnKey(
        requireString(values[0], 'replay_turn.session_id'),
        requireString(values[1], 'replay_turn.external_message_id'),
      );
      const row = this.turns.get(key);
      return row
        ? { rows: [structuredClone(row)], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    if (
      normalized.startsWith('SELECT * FROM customer_run_events') &&
      normalized.endsWith('ORDER BY sequence ASC')
    ) {
      this.assertTransaction();
      const rows = this.events.get(
        requireString(values[0], 'events.run_id'),
      ) ?? [];
      return {
        rows: structuredClone(rows)
          .sort((left, right) => left.sequence - right.sequence),
        rowCount: rows.length,
      };
    }
    throw new Error(`unexpected_postgres_query:${normalized}`);
  }

  private assertTransaction(): void {
    if (!this.transactionSnapshot) {
      throw new Error('fake_postgres_query_outside_transaction');
    }
  }

  private restoreSnapshot(snapshot: DurableSnapshot): void {
    this.restoreMap(this.controls, snapshot.controls);
    this.restoreMap(this.turns, snapshot.turns);
    this.restoreMap(this.runs, snapshot.runs);
    this.restoreMap(this.events, snapshot.events);
  }

  private restoreMap<Key, Value>(
    target: Map<Key, Value>,
    source: Map<Key, Value>,
  ): void {
    target.clear();
    for (const [key, value] of source) {
      target.set(key, structuredClone(value));
    }
  }

  private conversationTurnRow(
    values: unknown[],
  ): ConversationTurnRow {
    return {
      id: requireString(values[0], 'turn.id'),
      session_id: requireString(values[1], 'turn.session_id'),
      channel: requireLiteral(
        values[2],
        'turn.channel',
        ['messenger', 'zalo', 'kfc', 'messenger_mock', 'zalo_mock'],
      ),
      role: requireLiteral(
        values[3],
        'turn.role',
        ['user', 'assistant', 'tool'],
      ),
      text: requireString(values[4], 'turn.text'),
      external_message_id: requireNullableString(
        values[5],
        'turn.external_message_id',
      ),
      external_user_id: requireNullableString(
        values[6],
        'turn.external_user_id',
      ),
      delivery_status: requireLiteral(
        values[7],
        'turn.delivery_status',
        ['received', 'pending', 'sent', 'failed', 'not_applicable'],
      ),
      metadata: values[8] === null
        ? null
        : requireRecord(values[8], 'turn.metadata'),
      created_at: requireString(values[9], 'turn.created_at'),
    };
  }

  private customerRunRow(values: unknown[]): CustomerRunRow {
    return {
      id: requireString(values[0], 'run.id'),
      schema_version: requireSchemaVersion(values[1]),
      session_id: requireString(values[2], 'run.session_id'),
      customer_id: requireString(values[3], 'run.customer_id'),
      client_message_id: requireString(
        values[4],
        'run.client_message_id',
      ),
      request_fingerprint: requireString(
        values[5],
        'run.request_fingerprint',
      ),
      generation: requireNumber(values[6], 'run.generation'),
      session_authority_generation: requireNumber(
        values[7],
        'run.session_authority_generation',
      ),
      status: requireLiteral(
        values[8],
        'run.status',
        [
          'accepted',
          'running',
          'cancelling',
          'completed',
          'failed',
          'cancelled',
          'superseded',
        ],
      ),
      phase: values[9] === null
        ? null
        : requireLiteral(
            values[9],
            'run.phase',
            [
              'queued',
              'planning',
              'read_only_tool',
              'state_change_tool',
              'irreversible_tool',
              'reconciling',
              'response_composition',
              'text_delivery',
              'finalizing',
            ],
          ),
      next_event_sequence: requireNumber(
        values[10],
        'run.next_event_sequence',
      ),
      client_schema_version: requireNumber(
        values[11],
        'run.client_schema_version',
      ),
      accepted_at: requireString(values[12], 'run.accepted_at'),
      started_at: requireNullableString(values[13], 'run.started_at'),
      terminal_at: requireNullableString(values[14], 'run.terminal_at'),
      updated_at: requireString(values[15], 'run.updated_at'),
    };
  }

  private customerRunEventRow(
    values: unknown[],
  ): CustomerRunEventRow {
    return {
      event_id: requireString(values[0], 'event.event_id'),
      run_id: requireString(values[1], 'event.run_id'),
      sequence: requireNumber(values[2], 'event.sequence'),
      schema_version: requireSchemaVersion(values[3]),
      type: requireLiteral(
        values[4],
        'event.type',
        [
          'run_accepted',
          'run_started',
          'phase_changed',
          'progress_updated',
          'text_started',
          'text_delta',
          'text_checkpoint',
          'text_completed',
          'text_incomplete',
          'genui_revision',
          'genui_cleared',
          'genui_snapshot',
          'cancellation_requested',
          'run_completed',
          'run_failed',
          'run_cancelled',
          'run_superseded',
        ],
      ),
      occurred_at: requireString(values[5], 'event.occurred_at'),
      payload: requireRecord(values[6], 'event.payload'),
    };
  }
}

function createStore(
  database: TransactionalPausedIntakePostgres,
): PostgresStore {
  const pool = new Pool();
  Object.defineProperty(pool, 'connect', {
    configurable: true,
    value: database.connect.bind(database),
  });
  return new PostgresStore(pool);
}

describe('PostgresStore commitPausedCustomerRunIntake parity', () => {
  it('commits the exact paused generation, terminal run, turn, and event atomically', async () => {
    const database = new TransactionalPausedIntakePostgres();
    database.seedControl(pausedControl());
    const store = createStore(database);
    const input = pausedIntake();

    const result = await store.commitPausedCustomerRunIntake(input);

    expect(result).toEqual({
      status: 'committed',
      run: {
        ...input.run,
        sessionAuthorityGeneration: 3,
        nextEventSequence: 2,
      },
      turn: {
        ...input.userTurn,
        id: expect.any(String),
      },
      events: [{
        schemaVersion: 1,
        eventId: 'postgres-paused-run-1-superseded',
        runId: 'postgres-paused-run-1',
        sequence: 1,
        type: 'run_superseded',
        occurredAt: pausedAt,
        payload: {
          status: 'superseded',
          suppressed: true,
          agentMode: 'human_paused',
        },
      }],
    });
    expect(database.durableCounts()).toEqual({
      turns: 1,
      runs: 1,
      events: 1,
    });
    expect(database.transactionEvents).toEqual(['BEGIN', 'COMMIT']);
    expect(database.releaseCount).toBe(1);
  });

  it('replays the same request fingerprint without duplicating durable artifacts', async () => {
    const database = new TransactionalPausedIntakePostgres();
    database.seedControl(pausedControl());
    const store = createStore(database);
    const input = pausedIntake();
    const committed = await store.commitPausedCustomerRunIntake(input);

    const replayed = await store.commitPausedCustomerRunIntake({
      ...input,
      run: {
        ...input.run,
        id: 'ignored-replay-run',
      },
      events: [{
        ...input.events[0]!,
        eventId: 'ignored-replay-event',
        runId: 'ignored-replay-run',
      }],
    });

    expect(committed.status).toBe('committed');
    expect(replayed.status).toBe('replayed');
    if (committed.status === 'stale' || replayed.status === 'stale') {
      throw new Error('postgres paused intake unexpectedly became stale');
    }
    expect(replayed.run).toEqual(committed.run);
    expect(replayed.turn).toEqual(committed.turn);
    expect(replayed.events).toEqual(committed.events);
    expect(database.durableCounts()).toEqual({
      turns: 1,
      runs: 1,
      events: 1,
    });
    expect(database.runs.has('ignored-replay-run')).toBe(false);
    expect(database.transactionEvents).toEqual([
      'BEGIN',
      'COMMIT',
      'BEGIN',
      'COMMIT',
    ]);
  });

  it.each([
    [
      'non-terminal run state',
      (database: TransactionalPausedIntakePostgres) => {
        const run = database.runs.get('postgres-paused-run-1');
        if (!run) throw new Error('test paused run missing');
        run.status = 'completed';
      },
    ],
    [
      'non-canonical superseded event',
      (database: TransactionalPausedIntakePostgres) => {
        const event = database.events
          .get('postgres-paused-run-1')?.[0];
        if (!event) throw new Error('test paused event missing');
        event.payload = {
          status: 'superseded',
          suppressed: false,
          agentMode: 'human_paused',
        };
      },
    ],
  ] satisfies Array<[
    string,
    (database: TransactionalPausedIntakePostgres) => void,
  ]>)(
    'fails closed instead of replaying a %s',
    async (_corruption, corrupt) => {
      const database = new TransactionalPausedIntakePostgres();
      database.seedControl(pausedControl());
      const store = createStore(database);
      const input = pausedIntake();
      await store.commitPausedCustomerRunIntake(input);
      corrupt(database);
      const before = database.durableCounts();

      await expect(
        store.commitPausedCustomerRunIntake(input),
      ).rejects.toThrow(
        'paused_customer_run_intake_replay_invalid',
      );

      expect(database.durableCounts()).toEqual(before);
      expect(database.transactionEvents.at(-1)).toBe('ROLLBACK');
    },
  );

  it('rolls back a reused request identity with a conflicting fingerprint', async () => {
    const database = new TransactionalPausedIntakePostgres();
    database.seedControl(pausedControl());
    const store = createStore(database);
    const input = pausedIntake();
    await store.commitPausedCustomerRunIntake(input);
    const before = database.durableCounts();

    await expect(
      store.commitPausedCustomerRunIntake(pausedIntake({
        runId: 'conflicting-postgres-run',
        requestFingerprint: 'sha256:different-postgres-message',
      })),
    ).rejects.toBeInstanceOf(CustomerRunIdempotencyConflictError);

    expect(database.durableCounts()).toEqual(before);
    expect(database.runs.has('conflicting-postgres-run')).toBe(false);
    expect(database.transactionEvents.at(-1)).toBe('ROLLBACK');
  });

  it.each([
    ['text', { text: 'Nội dung đã lưu khác' }],
    ['channel', { channel: 'messenger' as const }],
    ['role', { role: 'assistant' as const }],
    ['externalUserId', { external_user_id: 'different-customer' }],
    ['delivery', { delivery_status: 'sent' as const }],
    ['metadata', { metadata: { rawEvent: { source: 'different' } } }],
  ] satisfies Array<[
    string,
    Partial<ConversationTurnRow>,
  ]>)(
    'rolls back when an existing external-message turn has conflicting %s',
    async (_field, conflict) => {
      const database = new TransactionalPausedIntakePostgres();
      database.seedControl(pausedControl());
      const store = createStore(database);
      const input = pausedIntake();
      database.seedTurn(durableTurnRow(input, conflict));

      await expect(
        store.commitPausedCustomerRunIntake(input),
      ).rejects.toThrow('paused_customer_run_intake_turn_conflict');

      expect(database.durableCounts()).toEqual({
        turns: 1,
        runs: 0,
        events: 0,
      });
      expect(database.transactionEvents).toEqual(['BEGIN', 'ROLLBACK']);
      expect(database.releaseCount).toBe(1);
    },
  );

  it('reuses an exact durable turn whose metadata keys have a different order', async () => {
    const database = new TransactionalPausedIntakePostgres();
    database.seedControl(pausedControl());
    const store = createStore(database);
    const input = pausedIntake();
    database.seedTurn(durableTurnRow(input, {
      metadata: {
        rawEvent: {
          intake: 'human_paused',
          source: 'kfc_customer_run',
        },
      },
    }));

    await expect(
      store.commitPausedCustomerRunIntake(input),
    ).resolves.toMatchObject({ status: 'committed' });
    expect(database.durableCounts()).toEqual({
      turns: 1,
      runs: 1,
      events: 1,
    });
  });

  it.each([
    [
      'run that already started',
      (input: CommitPausedCustomerRunIntakeInput) => ({
        ...input,
        run: {
          ...input.run,
          startedAt: input.run.acceptedAt,
        },
      }),
    ],
    [
      'run with prior event history',
      (input: CommitPausedCustomerRunIntakeInput) => ({
        ...input,
        run: {
          ...input.run,
          nextEventSequence: 2,
        },
        events: [{
          ...input.events[0]!,
          expectedSequence: 2,
        }],
      }),
    ],
  ] satisfies Array<[
    string,
    (
      input: CommitPausedCustomerRunIntakeInput,
    ) => CommitPausedCustomerRunIntakeInput,
  ]>)(
    'rejects a %s before opening a transaction or persisting artifacts',
    async (_description, makeInvalid) => {
      const database = new TransactionalPausedIntakePostgres();
      database.seedControl(pausedControl());
      const store = createStore(database);
      const input = pausedIntake();

      await expect(
        store.commitPausedCustomerRunIntake(makeInvalid(input)),
      ).rejects.toThrow('paused_customer_run_intake_invalid');

      expect(database.durableCounts()).toEqual({
        turns: 0,
        runs: 0,
        events: 0,
      });
      expect(database.queries).toEqual([]);
      expect(database.transactionEvents).toEqual([]);
      expect(database.releaseCount).toBe(0);
    },
  );

  it.each([
    ['AI authority is active', pausedControl(3, 'ai_active'), 3],
    ['the paused generation is stale', pausedControl(4), 3],
  ] satisfies Array<[string, SessionControlRow, number]>)(
    'returns stale without mutation when %s',
    async (_reason, control, expectedGeneration) => {
      const database = new TransactionalPausedIntakePostgres();
      database.seedControl(control);
      const store = createStore(database);

      await expect(
        store.commitPausedCustomerRunIntake(pausedIntake({
          expectedSessionAuthorityGeneration: expectedGeneration,
        })),
      ).resolves.toEqual({ status: 'stale' });

      expect(database.durableCounts()).toEqual({
        turns: 0,
        runs: 0,
        events: 0,
      });
      expect(database.transactionEvents).toEqual(['BEGIN', 'COMMIT']);
      expect(database.queries).not.toContain(
        expect.stringContaining('INSERT INTO conversation_turns'),
      );
    },
  );

  it('rolls back the turn and run when the event insert fails', async () => {
    const database = new TransactionalPausedIntakePostgres();
    database.seedControl(pausedControl());
    database.failEventInsert = true;
    const store = createStore(database);

    await expect(
      store.commitPausedCustomerRunIntake(pausedIntake()),
    ).rejects.toThrow('injected customer run event insert failure');

    expect(database.durableCounts()).toEqual({
      turns: 0,
      runs: 0,
      events: 0,
    });
    expect(database.queries).toEqual(
      expect.arrayContaining([
        expect.stringContaining('INSERT INTO conversation_turns'),
        expect.stringContaining('INSERT INTO customer_runs'),
        expect.stringContaining('INSERT INTO customer_run_events'),
        'ROLLBACK',
      ]),
    );
    expect(database.transactionEvents).toEqual(['BEGIN', 'ROLLBACK']);
    expect(database.releaseCount).toBe(1);
  });
});
