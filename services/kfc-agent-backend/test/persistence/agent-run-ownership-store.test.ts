import { describe, expect, it } from 'vitest';
import {
  D1Store,
  type D1DatabaseLike,
} from '../../src/persistence/d1Store.js';
import { PostgresStore } from '../../src/persistence/postgresStore.js';
import type {
  AgentRunRow,
  D1PreparedStatement,
  D1Result,
  SessionAgentStateRow,
} from '../../src/persistence/d1StoreSupport.js';

const sessionId = 'messenger:ownership-cas';
const runId = 'run-ownership-cas';
const deadline = '2026-07-20T00:00:01.000Z';
const updatedAt = '2026-07-20T00:00:02.000Z';
const executionLeaseToken = '00000000-0000-4000-8000-000000000001';
const executionLeaseExpiresAt = '2026-07-20T00:01:02.000Z';

describe('AgentRun ownership persistence', () => {
  it('advances D1 generation and captures the invalidated owner in one batch', async () => {
    const db = new OwnershipD1Database();
    const store = new D1Store(db);

    const result = await store.advanceSessionAgentGeneration({
      sessionId,
      debounceDeadlineAt: deadline,
      updatedAt,
    });

    expect(result).toMatchObject({
      invalidatedRunId: 'run-old-owner',
      state: {
        sessionId,
        currentRunId: null,
        generation: 8,
        debounceDeadlineAt: deadline,
      },
    });
    expect(db.batches).toHaveLength(1);
    expect(db.batches[0]!.map((statement) => statement.query)).toEqual([
      expect.stringMatching(/INSERT OR IGNORE INTO session_agent_state/u),
      expect.stringMatching(/SELECT current_run_id[\s\S]+WHERE session_id = \?/u),
      expect.stringMatching(
        /UPDATE session_agent_state[\s\S]+generation = generation \+ 1[\s\S]+RETURNING \*/u,
      ),
    ]);
    expectD1BindingsMatch(db.batches[0]!);
  });

  it('uses exact D1 state and run predicates for ownership and execution CAS', async () => {
    const db = new OwnershipD1Database();
    const store = new D1Store(db);

    await expect(store.claimSessionAgentRunOwnership({
      sessionId,
      runId,
      expectedGeneration: 7,
      expectedCurrentRunId: null,
      expectedDebounceDeadlineAt: deadline,
      updatedAt,
    })).resolves.toMatchObject({ status: 'claimed' });
    await expect(store.claimAgentRunExecution({
      runId,
      sessionId,
      generation: 7,
      sessionAuthorityGeneration: 0,
      claimedAt: updatedAt,
      executionLeaseToken,
      executionLeaseExpiresAt,
    })).resolves.toMatchObject({ status: 'claimed' });

    expect(db.firsts[0]!.query).toMatch(
      /generation = \?[\s\S]+current_run_id IS \?[\s\S]+debounce_deadline_at = \?[\s\S]+status = 'scheduled'[\s\S]+session_authority_generation/u,
    );
    const executionClaim = db.firsts.find(({ query }) =>
      /UPDATE agent_runs[\s\S]+execution_attempt = execution_attempt \+ 1/u
        .test(query),
    );
    expect(executionClaim?.query).toMatch(
      /execution_attempt = execution_attempt \+ 1[\s\S]+execution_attempt < \?[\s\S]+irreversible_side_effect_at IS NULL[\s\S]+status = 'scheduled'[\s\S]+status = 'running'[\s\S]+session_agent_state[\s\S]+current_run_id = \?[\s\S]+generation = \?/u,
    );
    expectD1BindingsMatch(db.firsts);
  });

  it('includes expired running leases in D1 recovery candidates', async () => {
    const db = new OwnershipD1Database();
    const store = new D1Store(db);
    await store.listDueSessionAgentStates(updatedAt, 20);
    expect(db.alls).toHaveLength(1);
    expect(db.alls[0]!.query).toMatch(/current_run_id IS NULL[\s\S]+OR EXISTS[\s\S]+run\.status = 'running'[\s\S]+execution_lease_expires_at <= \?/u);
    expect(db.alls[0]!.bindings).toEqual([updatedAt, updatedAt, 20]);
  });

  it('locks and advances PostgreSQL generation in one transaction', async () => {
    const db = new OwnershipPostgresDatabase();
    const store = new PostgresStore(db as never);

    const result = await store.advanceSessionAgentGeneration({
      sessionId,
      debounceDeadlineAt: deadline,
      updatedAt,
    });

    expect(result.invalidatedRunId).toBe('run-old-owner');
    const queries = db.queries.map(({ query }) => compact(query));
    expect(queries).toHaveLength(5);
    expect(queries[0]).toBe('BEGIN');
    expect(queries[1]).toMatch(/INSERT INTO session_agent_state/u);
    expect(queries[2]).toMatch(
      /SELECT \* FROM session_agent_state .* FOR UPDATE/u,
    );
    expect(queries[3]).toMatch(
      /UPDATE session_agent_state[\s\S]+generation = generation \+ 1[\s\S]+AND generation = \$4[\s\S]+RETURNING \*/u,
    );
    expect(queries[4]).toBe('COMMIT');
    expect(db.released).toBe(true);
  });

  it('rolls back a failed PostgreSQL generation advance', async () => {
    const db = new OwnershipPostgresDatabase();
    db.failGenerationUpdate = true;
    const store = new PostgresStore(db as never);

    await expect(store.advanceSessionAgentGeneration({
      sessionId,
      debounceDeadlineAt: null,
      updatedAt,
    })).rejects.toThrow('injected_generation_update_failure');

    expect(db.queries.map(({ query }) => compact(query))).toContain('ROLLBACK');
    expect(db.released).toBe(true);
  });

  it('uses exact PostgreSQL state and run predicates for both claims', async () => {
    const db = new OwnershipPostgresDatabase();
    const store = new PostgresStore(db as never);

    await expect(store.claimSessionAgentRunOwnership({
      sessionId,
      runId,
      expectedGeneration: 7,
      expectedCurrentRunId: null,
      expectedDebounceDeadlineAt: deadline,
      updatedAt,
    })).resolves.toMatchObject({ status: 'claimed' });
    await expect(store.claimAgentRunExecution({
      runId,
      sessionId,
      generation: 7,
      sessionAuthorityGeneration: 0,
      claimedAt: updatedAt,
      executionLeaseToken,
      executionLeaseExpiresAt,
    })).resolves.toMatchObject({ status: 'claimed' });

    const ownershipQuery = db.queries.find(({ query }) =>
      /UPDATE session_agent_state AS state/u.test(query),
    )?.query;
    const executionQuery = db.queries.find(({ query }) =>
      /UPDATE agent_runs AS run/u.test(query),
    )?.query;
    expect(ownershipQuery).toMatch(
      /state\.generation = \$4[\s\S]+state\.current_run_id IS NOT DISTINCT FROM \$5::text[\s\S]+state\.debounce_deadline_at = \$6[\s\S]+run\.status = 'scheduled'/u,
    );
    expect(ownershipQuery).toContain(
      'run.session_authority_generation = $7',
    );
    expect(executionQuery).toMatch(
      /run\.execution_attempt < \$8[\s\S]+run\.irreversible_side_effect_at IS NULL[\s\S]+run\.status = 'scheduled'[\s\S]+run\.status = 'running'[\s\S]+session_agent_state AS state[\s\S]+state\.current_run_id = \$1[\s\S]+state\.generation = \$3/u,
    );
    expect(executionQuery).toContain(
      'run.session_authority_generation = $5',
    );
    expect(
      db.queries.filter(({ query }) =>
        /pg_advisory_xact_lock/u.test(query)),
    ).toHaveLength(2);
    expect(
      db.queries.filter(({ query }) =>
        /FROM session_controls[\s\S]+FOR UPDATE/u.test(query)),
    ).toHaveLength(2);
  });

  it('includes expired running leases in PostgreSQL recovery candidates', async () => {
    const db = new OwnershipPostgresDatabase();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- lightweight PostgreSQL test double
    const store = new PostgresStore(db as never);
    await store.listDueSessionAgentStates(updatedAt, 20);
    const query = db.queries.at(-1)!;
    expect(query.query).toMatch(/current_run_id IS NULL[\s\S]+OR EXISTS[\s\S]+run\.status = 'running'[\s\S]+execution_lease_expires_at <= \$1/u);
    expect(query.bindings).toEqual([updatedAt, 20]);
  });
});

class OwnershipD1Statement implements D1PreparedStatement {
  bindings: unknown[] = [];

  constructor(
    readonly owner: OwnershipD1Database,
    readonly query: string,
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    this.bindings = values;
    return this;
  }

  async run(): Promise<D1Result> {
    return { success: true, meta: {}, results: [] };
  }

  async first<Row>(): Promise<Row | null> {
    this.owner.firsts.push(this);
    if (/UPDATE session_agent_state/u.test(this.query)) {
      return claimedStateRow() as Row;
    }
    if (/UPDATE agent_runs/u.test(this.query)) {
      return runningAgentRunRow() as Row;
    }
    if (/SELECT \* FROM session_agent_state/u.test(this.query)) {
      return claimedStateRow() as Row;
    }
    if (/SELECT \* FROM agent_runs/u.test(this.query)) {
      return scheduledAgentRunRow() as Row;
    }
    return null;
  }

  async all<Row>(): Promise<D1Result<Row>> {
    this.owner.alls.push(this);
    return { success: true, meta: {}, results: [] };
  }
}

class OwnershipD1Database implements D1DatabaseLike {
  readonly batches: OwnershipD1Statement[][] = [];
  readonly firsts: OwnershipD1Statement[] = [];
  readonly alls: OwnershipD1Statement[] = [];

  prepare(query: string): OwnershipD1Statement {
    return new OwnershipD1Statement(this, query);
  }

  async batch(
    statements: D1PreparedStatement[],
  ): Promise<D1Result[]> {
    const captured = statements as OwnershipD1Statement[];
    this.batches.push(captured);
    return [
      { success: true, meta: {}, results: [] },
      {
        success: true,
        meta: {},
        results: [{ current_run_id: 'run-old-owner' }],
      },
      {
        success: true,
        meta: {},
        results: [{ ...advancedStateRow() }],
      },
    ];
  }
}

class OwnershipPostgresDatabase {
  readonly queries: Array<{ query: string; bindings: unknown[] }> = [];
  released = false;
  failGenerationUpdate = false;

  async connect() {
    return this;
  }

  async query(query: string, bindings: unknown[] = []) {
    this.queries.push({ query, bindings });
    if (
      this.failGenerationUpdate &&
      /generation = generation \+ 1/u.test(query)
    ) {
      throw new Error('injected_generation_update_failure');
    }
    if (/FROM session_controls[\s\S]+FOR UPDATE/u.test(query)) {
      return result([]);
    }
    if (
      /SELECT \*[\s\S]+FROM session_agent_state[\s\S]+FOR UPDATE/u
        .test(query)
    ) {
      return result([previousStateRow()]);
    }
    if (/generation = generation \+ 1/u.test(query)) {
      return result([advancedStateRow()]);
    }
    if (/UPDATE session_agent_state AS state/u.test(query)) {
      return result([claimedStateRow()]);
    }
    if (/UPDATE agent_runs AS run/u.test(query)) {
      return result([runningAgentRunRow()]);
    }
    if (/SELECT \* FROM session_agent_state/u.test(query)) {
      return result([claimedStateRow()]);
    }
    if (/SELECT \* FROM agent_runs/u.test(query)) {
      return result([scheduledAgentRunRow()]);
    }
    return result([]);
  }

  release(): void {
    this.released = true;
  }
}

function previousStateRow(): SessionAgentStateRow {
  return {
    session_id: sessionId,
    current_run_id: 'run-old-owner',
    generation: 7,
    debounce_deadline_at: deadline,
    updated_at: updatedAt,
  };
}

function advancedStateRow(): SessionAgentStateRow {
  return {
    session_id: sessionId,
    current_run_id: null,
    generation: 8,
    debounce_deadline_at: deadline,
    updated_at: updatedAt,
  };
}

function claimedStateRow(): SessionAgentStateRow {
  return {
    session_id: sessionId,
    current_run_id: runId,
    generation: 7,
    debounce_deadline_at: null,
    updated_at: updatedAt,
  };
}

function scheduledAgentRunRow(): AgentRunRow {
  return {
    id: runId,
    session_id: sessionId,
    generation: 7,
    session_authority_generation: 0,
    channel: 'messenger',
    external_user_id: 'customer-ownership-cas',
    status: 'scheduled',
    execution_attempt: 0,
    execution_lease_token: null,
    execution_lease_expires_at: null,
    coalesced_input_text: 'One combo',
    superseded_by_run_id: null,
    irreversible_side_effect_at: null,
    irreversible_tool_name: null,
    assistant_turn_id: null,
    delivery_status: 'pending',
    delivery_external_message_id: null,
    error_code: null,
    error_message: null,
    scheduled_at: updatedAt,
    started_at: null,
    completed_at: null,
    updated_at: updatedAt,
  };
}

function runningAgentRunRow(): AgentRunRow {
  return {
    ...scheduledAgentRunRow(),
    status: 'running',
    execution_attempt: 1,
    execution_lease_token:
      executionLeaseToken,
    execution_lease_expires_at: '2026-07-20T00:01:02.000Z',
    started_at: updatedAt,
  };
}

function result<Row>(rows: Row[]) {
  return { rows, rowCount: rows.length };
}

function compact(query: string): string {
  return query.replace(/\s+/gu, ' ').trim();
}

function expectD1BindingsMatch(
  statements: readonly OwnershipD1Statement[],
): void {
  for (const statement of statements) {
    expect(statement.bindings).toHaveLength(
      statement.query.match(/\?/gu)?.length ?? 0,
    );
  }
}
