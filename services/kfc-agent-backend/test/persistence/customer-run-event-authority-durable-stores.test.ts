import { describe, expect, it } from 'vitest';
import {
  customerRunEventSchema,
  type CustomerRun,
} from '../../src/customerRuns/contracts.js';
import type {
  AppendCustomerRunEventInput,
  AppendCustomerRunEventsIfRunCurrentInput,
  ConversationStore,
  CreateCustomerRunInput,
} from '../../src/persistence/contracts.js';
import { D1Store } from '../../src/persistence/d1Store.js';
import { PostgresStore } from '../../src/persistence/postgresStore.js';
import type {
  CustomerRunEventRow,
  CustomerRunRow,
  SessionControlRow,
} from '../../src/persistence/postgresStoreSupport.js';
import { FakeD1Database } from '../support/fakeD1Database.js';

const sessionId = 'kfc:durable-event-fence-customer';
const runId = 'durable-event-fence-run';

type EventFenceStore = Pick<
  ConversationStore,
  | 'appendCustomerRunEventsIfRunCurrent'
  | 'getCustomerRun'
  | 'listCustomerRunEvents'
  | 'transitionSessionAuthority'
>;

interface BackendHarness {
  store: EventFenceStore;
  run: CustomerRun;
  injectSecondEventFailure(): void;
  expectAtomicCommit(): void;
  expectAtomicRollback(): void;
}

interface BackendDefinition {
  name: string;
  createHarness(): Promise<BackendHarness>;
}

function customerRun(): CreateCustomerRunInput {
  return {
    id: runId,
    schemaVersion: 1,
    sessionId,
    customerId: 'durable-event-fence-customer',
    clientMessageId: 'durable-event-fence-message',
    requestFingerprint: 'durable-event-fence-fingerprint',
    generation: 1,
    status: 'running',
    phase: 'planning',
    nextEventSequence: 1,
    clientSchemaVersion: 1,
    acceptedAt: '2026-07-20T00:00:00.000Z',
    startedAt: '2026-07-20T00:00:00.000Z',
    terminalAt: null,
    updatedAt: '2026-07-20T00:00:00.000Z',
  };
}

function eventBatch(
  expectedSequence: number,
): AppendCustomerRunEventInput[] {
  return [
    {
      schemaVersion: 1,
      eventId: `durable-event-${expectedSequence}`,
      runId,
      expectedSequence,
      type: 'progress_updated',
      occurredAt: '2026-07-20T00:00:01.000Z',
      payload: { progress: 'first' },
    },
    {
      schemaVersion: 1,
      eventId: `durable-event-${expectedSequence + 1}`,
      runId,
      expectedSequence: expectedSequence + 1,
      type: 'phase_changed',
      occurredAt: '2026-07-20T00:00:02.000Z',
      payload: { phase: 'read_only_tool' },
    },
  ];
}

function eventOperation(
  run: CustomerRun,
  expectedSequence = run.nextEventSequence,
): AppendCustomerRunEventsIfRunCurrentInput {
  return {
    sessionId,
    fence: {
      kind: 'customer_run',
      runId,
      sessionAuthorityGeneration: run.sessionAuthorityGeneration,
    },
    events: eventBatch(expectedSequence),
  };
}

async function createD1Harness(): Promise<BackendHarness> {
  const db = new FakeD1Database();
  const store = new D1Store(db);
  await store.initialize();
  const run = await store.createCustomerRun(customerRun());
  db.resetCallCounts();

  return {
    store,
    run,
    injectSecondEventFailure() {
      db.resetCallCounts();
      const recordCall = db.recordCall.bind(db);
      db.recordCall = (kind) => {
        recordCall(kind);
        if (kind === 'run' && db.calls.run === 2) {
          throw new Error('injected customer-run event failure');
        }
      };
    },
    expectAtomicCommit() {
      expect(db.calls).toMatchObject({
        batch: 1,
        run: 3,
        first: 0,
        all: 0,
      });
    },
    expectAtomicRollback() {
      expect(db.calls).toMatchObject({
        batch: 1,
        run: 2,
        first: 0,
        all: 0,
      });
    },
  };
}

interface PostgresState {
  control: SessionControlRow | undefined;
  run: CustomerRunRow;
  events: CustomerRunEventRow[];
}

interface QueryCall {
  sql: string;
  bindings: unknown[];
}

interface QueryResult {
  rowCount: number;
  rows: unknown[];
}

class TransactionalPostgresDatabase {
  readonly client = new TransactionalPostgresClient(this);
  readonly calls: QueryCall[] = [];
  private state: PostgresState;
  private snapshot: PostgresState | undefined;
  private eventInsertAttempts = 0;
  private failEventInsertAt: number | undefined;

  constructor(run: CustomerRunRow) {
    this.state = {
      control: undefined,
      run: structuredClone(run),
      events: [],
    };
  }

  async connect(): Promise<TransactionalPostgresClient> {
    return this.client;
  }

  async query(
    sql: string,
    bindings: unknown[] = [],
  ): Promise<QueryResult> {
    return this.execute(sql, bindings);
  }

  clearCalls(): void {
    this.calls.splice(0);
  }

  injectSecondEventFailure(): void {
    this.eventInsertAttempts = 0;
    this.failEventInsertAt = 2;
    this.clearCalls();
  }

  sqlCalls(): string[] {
    return this.calls.map((call) => call.sql);
  }

  async execute(
    sql: string,
    bindings: unknown[] = [],
  ): Promise<QueryResult> {
    const normalized = normalizeSql(sql);
    this.calls.push({
      sql: normalized,
      bindings: structuredClone(bindings),
    });

    if (normalized === 'BEGIN') {
      if (this.snapshot) {
        throw new Error('nested test transaction');
      }
      this.snapshot = structuredClone(this.state);
      return emptyResult();
    }
    if (normalized === 'COMMIT') {
      this.snapshot = undefined;
      return emptyResult();
    }
    if (normalized === 'ROLLBACK') {
      if (this.snapshot) {
        this.state = this.snapshot;
        this.snapshot = undefined;
      }
      return emptyResult();
    }
    if (normalized.includes('pg_advisory_xact_lock')) {
      return { rowCount: 1, rows: [{ pg_advisory_xact_lock: null }] };
    }
    if (
      normalized.startsWith('SELECT * FROM session_controls') &&
      normalized.includes('FOR UPDATE')
    ) {
      const control = this.state.control;
      return control !== undefined &&
        control.session_id === bindings[0]
        ? rowResult(control)
        : emptyResult();
    }
    if (
      normalized.startsWith('INSERT INTO session_controls') &&
      normalized.includes('RETURNING *')
    ) {
      const agentMode = bindings[1];
      const assignedAgentId = bindings[2];
      if (agentMode !== 'ai_active' && agentMode !== 'human_paused') {
        throw new Error('invalid test agent mode');
      }
      if (
        assignedAgentId !== null &&
        typeof assignedAgentId !== 'string'
      ) {
        throw new Error('invalid test assigned agent');
      }
      const control: SessionControlRow = {
        session_id: stringBinding(bindings, 0),
        agent_mode: agentMode,
        assigned_agent_id: assignedAgentId,
        session_authority_generation: numberBinding(bindings, 3),
        updated_at: stringBinding(bindings, 4),
      };
      this.state.control = control;
      return rowResult(control);
    }
    if (
      normalized.startsWith('SELECT id FROM customer_runs') &&
      normalized.includes('FOR UPDATE')
    ) {
      const run = this.state.run;
      const current =
        run.id === bindings[0] &&
        run.session_id === bindings[1] &&
        run.session_authority_generation === bindings[2] &&
        (run.status === 'accepted' || run.status === 'running');
      return current ? rowResult({ id: run.id }) : emptyResult();
    }
    if (
      normalized.startsWith('SELECT next_event_sequence') &&
      normalized.includes('FROM customer_runs')
    ) {
      return this.state.run.id === bindings[0]
        ? rowResult({
            next_event_sequence: this.state.run.next_event_sequence,
          })
        : emptyResult();
    }
    if (normalized.startsWith('INSERT INTO customer_run_events')) {
      this.eventInsertAttempts += 1;
      if (this.eventInsertAttempts === this.failEventInsertAt) {
        throw new Error('injected customer-run event failure');
      }
      const parsed = customerRunEventSchema.parse({
        eventId: bindings[0],
        runId: bindings[1],
        sequence: bindings[2],
        schemaVersion: bindings[3],
        type: bindings[4],
        occurredAt: bindings[5],
        payload: bindings[6],
      });
      this.state.events.push({
        event_id: parsed.eventId,
        run_id: parsed.runId,
        sequence: parsed.sequence,
        schema_version: parsed.schemaVersion,
        type: parsed.type,
        occurred_at: parsed.occurredAt,
        payload: parsed.payload,
      });
      return { rowCount: 1, rows: [] };
    }
    if (
      normalized.startsWith('UPDATE customer_runs') &&
      normalized.includes(
        'SET next_event_sequence = next_event_sequence + $2',
      )
    ) {
      const run = this.state.run;
      if (
        run.id !== bindings[0] ||
        run.next_event_sequence !== bindings[3]
      ) {
        return emptyResult();
      }
      run.next_event_sequence += numberBinding(bindings, 1);
      run.updated_at = stringBinding(bindings, 2);
      return { rowCount: 1, rows: [] };
    }
    if (
      normalized.startsWith('SELECT * FROM customer_runs') &&
      normalized.includes('WHERE id = $1')
    ) {
      return this.state.run.id === bindings[0]
        ? rowResult(this.state.run)
        : emptyResult();
    }
    if (
      normalized.startsWith('SELECT * FROM customer_run_events') &&
      normalized.includes('ORDER BY sequence ASC')
    ) {
      const afterSequence = numberBinding(bindings, 1);
      const rows = this.state.events
        .filter(
          (event) =>
            event.run_id === bindings[0] &&
            event.sequence > afterSequence,
        )
        .sort((left, right) => left.sequence - right.sequence);
      return { rowCount: rows.length, rows: structuredClone(rows) };
    }
    throw new Error(`Unhandled PostgreSQL test query: ${normalized}`);
  }
}

class TransactionalPostgresClient {
  constructor(
    private readonly database: TransactionalPostgresDatabase,
  ) {}

  async query(
    sql: string,
    bindings: unknown[] = [],
  ): Promise<QueryResult> {
    return this.database.execute(sql, bindings);
  }

  release(): void {}
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/gu, ' ').trim();
}

function rowResult(row: object): QueryResult {
  return { rowCount: 1, rows: [structuredClone(row)] };
}

function emptyResult(): QueryResult {
  return { rowCount: 0, rows: [] };
}

function stringBinding(bindings: unknown[], index: number): string {
  const value = bindings[index];
  if (typeof value !== 'string') {
    throw new Error(`Expected string binding at ${index}`);
  }
  return value;
}

function numberBinding(bindings: unknown[], index: number): number {
  const value = bindings[index];
  if (typeof value !== 'number') {
    throw new Error(`Expected number binding at ${index}`);
  }
  return value;
}

function postgresCustomerRunRow(): CustomerRunRow {
  const run = customerRun();
  return {
    id: run.id,
    schema_version: run.schemaVersion,
    session_id: run.sessionId,
    customer_id: run.customerId,
    client_message_id: run.clientMessageId,
    request_fingerprint: run.requestFingerprint,
    generation: run.generation,
    session_authority_generation: 0,
    status: run.status,
    phase: run.phase,
    next_event_sequence: run.nextEventSequence,
    client_schema_version: run.clientSchemaVersion,
    accepted_at: run.acceptedAt,
    started_at: run.startedAt,
    terminal_at: run.terminalAt,
    updated_at: run.updatedAt,
  };
}

async function createPostgresHarness(): Promise<BackendHarness> {
  const db = new TransactionalPostgresDatabase(
    postgresCustomerRunRow(),
  );
  // @ts-expect-error This focused fake implements only this contract's SQL.
  const store = new PostgresStore(db);
  const run = {
    ...customerRun(),
    sessionAuthorityGeneration: 0,
  };

  return {
    store,
    run,
    injectSecondEventFailure() {
      db.injectSecondEventFailure();
    },
    expectAtomicCommit() {
      expect(db.sqlCalls()).toEqual([
        'BEGIN',
        expect.stringMatching(/^SELECT pg_advisory_xact_lock/u),
        expect.stringMatching(/^SELECT \* FROM session_controls/u),
        expect.stringMatching(/^SELECT id FROM customer_runs/u),
        expect.stringMatching(/^SELECT next_event_sequence/u),
        expect.stringMatching(/^INSERT INTO customer_run_events/u),
        expect.stringMatching(/^INSERT INTO customer_run_events/u),
        expect.stringMatching(/^UPDATE customer_runs/u),
        'COMMIT',
      ]);
    },
    expectAtomicRollback() {
      const calls = db.sqlCalls();
      expect(calls.at(-1)).toBe('ROLLBACK');
      expect(calls).not.toContain('COMMIT');
    },
  };
}

const backends: BackendDefinition[] = [
  {
    name: 'D1Store',
    createHarness: createD1Harness,
  },
  {
    name: 'PostgresStore',
    createHarness: createPostgresHarness,
  },
];

describe.each(backends)(
  '$name customer-run event authority fence',
  ({ createHarness }) => {
    it('commits the exact ordered batch and advances sequence once', async () => {
      const harness = await createHarness();

      const result =
        await harness.store.appendCustomerRunEventsIfRunCurrent(
          eventOperation(harness.run),
        );

      expect(result).toMatchObject({
        status: 'committed',
        events: [
          {
            eventId: 'durable-event-1',
            sequence: 1,
            payload: { progress: 'first' },
          },
          {
            eventId: 'durable-event-2',
            sequence: 2,
            payload: { phase: 'read_only_tool' },
          },
        ],
      });
      harness.expectAtomicCommit();
      await expect(
        harness.store.listCustomerRunEvents(runId),
      ).resolves.toEqual(
        result.status === 'committed' ? result.events : [],
      );
      await expect(harness.store.getCustomerRun(runId)).resolves.toMatchObject({
        nextEventSequence: 3,
        updatedAt: '2026-07-20T00:00:02.000Z',
      });
    });

    it('keeps the old generation stale through pause and resume', async () => {
      const harness = await createHarness();
      const operation = eventOperation(harness.run);

      const paused = await harness.store.transitionSessionAuthority({
        sessionId,
        expectedGeneration: harness.run.sessionAuthorityGeneration,
        agentMode: 'human_paused',
        assignedAgentId: 'support-agent-1',
        updatedAt: '2026-07-20T00:00:03.000Z',
      });
      expect(paused).toMatchObject({
        status: 'transitioned',
        control: {
          agentMode: 'human_paused',
          sessionAuthorityGeneration: 1,
        },
      });
      await expect(
        harness.store.appendCustomerRunEventsIfRunCurrent(operation),
      ).resolves.toEqual({ status: 'stale' });

      const resumed = await harness.store.transitionSessionAuthority({
        sessionId,
        expectedGeneration: paused.control.sessionAuthorityGeneration,
        agentMode: 'ai_active',
        assignedAgentId: null,
        updatedAt: '2026-07-20T00:00:04.000Z',
      });
      expect(resumed).toMatchObject({
        status: 'transitioned',
        control: {
          agentMode: 'ai_active',
          sessionAuthorityGeneration: 2,
        },
      });
      await expect(
        harness.store.appendCustomerRunEventsIfRunCurrent(operation),
      ).resolves.toEqual({ status: 'stale' });
      await expect(
        harness.store.listCustomerRunEvents(runId),
      ).resolves.toEqual([]);
      await expect(harness.store.getCustomerRun(runId)).resolves.toMatchObject({
        nextEventSequence: 1,
      });
    });

    it('keeps all writes out when the first sequence is stale', async () => {
      const harness = await createHarness();

      await expect(
        harness.store.appendCustomerRunEventsIfRunCurrent(
          eventOperation(
            harness.run,
            harness.run.nextEventSequence + 1,
          ),
        ),
      ).resolves.toEqual({ status: 'stale' });

      await expect(
        harness.store.listCustomerRunEvents(runId),
      ).resolves.toEqual([]);
      await expect(harness.store.getCustomerRun(runId)).resolves.toMatchObject({
        nextEventSequence: 1,
      });
    });

    it('rolls back every event and the sequence advance on an event failure', async () => {
      const harness = await createHarness();
      harness.injectSecondEventFailure();

      await expect(
        harness.store.appendCustomerRunEventsIfRunCurrent(
          eventOperation(harness.run),
        ),
      ).rejects.toThrow('injected customer-run event failure');

      harness.expectAtomicRollback();
      await expect(
        harness.store.listCustomerRunEvents(runId),
      ).resolves.toEqual([]);
      await expect(harness.store.getCustomerRun(runId)).resolves.toMatchObject({
        nextEventSequence: 1,
        updatedAt: '2026-07-20T00:00:00.000Z',
      });
    });
  },
);
