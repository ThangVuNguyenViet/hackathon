import type {
  D1DatabaseLike,
  D1PreparedStatement,
  D1Result,
} from '../../src/persistence/d1StoreSupport.js';
import type { CustomerRunStatus } from '../../src/customerRuns/contracts.js';
import type { AgentMode } from '../../src/domain/types.js';

type Row = Record<string, unknown>;
type RecordedQuery = { sql: string; values: unknown[] };
type FakeCustomerRun = {
  id: string;
  sessionId: string;
  sessionAuthorityGeneration: number;
  status: CustomerRunStatus;
};
type FakeSessionControl = {
  sessionId: string;
  agentMode: AgentMode;
  assignedAgentId: string | null;
  sessionAuthorityGeneration: number;
  updatedAt: string;
};

const storageColumns = [
  'schema_version',
  'ref_id',
  'kind',
  'session_id',
  'session_generation',
  'customer_id',
  'channel',
  'authenticated_subject',
  'authentication_evidence_ref',
  'verified_revision',
  'lifecycle',
  'payload_json',
  'created_at',
  'expires_at',
  'claimed_use_id',
  'claimed_at',
] as const;

export interface VerifiedRefFake {
  readonly rows: Map<string, Row>;
  readonly generations: Map<string, number>;
  readonly sessionControls: Map<string, FakeSessionControl>;
  readonly customerRuns: Map<string, FakeCustomerRun>;
  beforeVerifiedRefInsert?: () => void | Promise<void>;
  setCustomerRun(
    runId: string,
    sessionId: string,
    status: CustomerRunStatus,
  ): void;
}

export class FakeVerifiedRefD1
  implements D1DatabaseLike, VerifiedRefFake
{
  readonly rows = new Map<string, Row>();
  readonly generations = new Map<string, number>();
  readonly sessionControls = new Map<string, FakeSessionControl>();
  readonly customerRuns = new Map<string, FakeCustomerRun>();
  readonly queries: RecordedQuery[] = [];
  beforeVerifiedRefInsert?: () => void | Promise<void>;

  setCustomerRun(
    runId: string,
    sessionId: string,
    status: CustomerRunStatus,
  ): void {
    this.customerRuns.set(runId, {
      id: runId,
      sessionId,
      sessionAuthorityGeneration:
        effectiveSessionAuthorityGeneration(this.sessionControls, sessionId),
      status,
    });
  }

  prepare(query: string): D1PreparedStatement {
    return new FakeVerifiedRefD1Statement(this, query);
  }

  async batch(statements: D1PreparedStatement[]): Promise<D1Result[]> {
    const results: D1Result[] = [];
    for (const statement of statements) {
      results.push(await statement.run());
    }
    return results;
  }
}

class FakeVerifiedRefD1Statement implements D1PreparedStatement {
  private values: unknown[] = [];

  constructor(
    private readonly db: FakeVerifiedRefD1,
    private readonly query: string,
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    this.values = values;
    return this;
  }

  async run(): Promise<D1Result> {
    const sql = normalizeSql(this.query);
    if (
      sql.startsWith(
        'INSERT OR IGNORE INTO confirmation_pause_sessions',
      )
    ) {
      const sessionId = String(this.values[0]);
      const existed = this.db.generations.has(sessionId);
      if (!existed) this.db.generations.set(sessionId, 0);
      return ok(existed ? 0 : 1);
    }
    if (sql.startsWith('INSERT OR IGNORE INTO verified_refs')) {
      const hook = this.db.beforeVerifiedRefInsert;
      this.db.beforeVerifiedRefInsert = undefined;
      await hook?.();
      const sessionId = String(this.values[16]);
      const expectedGeneration = Number(this.values[17]);
      const refId = String(this.values[1]);
      if (
        this.db.generations.get(sessionId) !== expectedGeneration ||
        this.db.rows.has(refId)
      ) {
        return ok(0);
      }
      this.db.rows.set(refId, rowFromStorageValues(this.values));
      return ok(1);
    }
    if (sql.startsWith('UPDATE confirmation_pause_sessions')) {
      const sessionId = String(this.values[0]);
      const expectedGeneration = Number(this.values[1]);
      if (this.db.generations.get(sessionId) !== expectedGeneration) {
        return ok(0);
      }
      this.db.generations.set(sessionId, expectedGeneration + 1);
      return ok(1);
    }
    if (sql.startsWith('INSERT INTO session_controls')) {
      const sessionId = String(this.values[0]);
      const nextPauseGeneration = Number(this.values[4]);
      if (
        this.db.generations.get(sessionId) !== nextPauseGeneration ||
        this.values[6] !== this.values[4]
      ) {
        return ok(0);
      }
      const currentGeneration = effectiveSessionAuthorityGeneration(
        this.db.sessionControls,
        sessionId,
      );
      this.db.sessionControls.set(sessionId, {
        sessionId,
        agentMode: 'ai_active',
        assignedAgentId: null,
        sessionAuthorityGeneration: currentGeneration + 1,
        updatedAt: String(this.values[2]),
      });
      return ok(1);
    }
    if (sql.startsWith('DELETE FROM verified_refs')) {
      const sessionId = String(this.values[0]);
      const nextGeneration = Number(this.values[2]);
      if (this.db.generations.get(sessionId) !== nextGeneration) {
        return ok(0);
      }
      let changes = 0;
      for (const [refId, row] of this.db.rows) {
        if (row.session_id === sessionId) {
          this.db.rows.delete(refId);
          changes += 1;
        }
      }
      return ok(changes);
    }
    if (
      sql.startsWith('DELETE FROM') ||
      sql.startsWith('CREATE TABLE') ||
      sql.startsWith('CREATE INDEX')
    ) {
      return ok(0);
    }
    throw new Error(`Unsupported VerifiedRef D1 run SQL: ${sql}`);
  }

  async first<T = Row>(): Promise<T | null> {
    const sql = normalizeSql(this.query);
    this.db.queries.push({ sql, values: structuredClone(this.values) });
    if (
      sql.startsWith(
        'INSERT INTO confirmation_pause_sessions',
      )
    ) {
      const sessionId = String(this.values[0]);
      const generation = this.db.generations.get(sessionId) ?? 0;
      this.db.generations.set(sessionId, generation);
      return { generation } as T;
    }
    if (
      sql.startsWith(
        'SELECT generation FROM confirmation_pause_sessions',
      )
    ) {
      const generation = this.db.generations.get(String(this.values[0]));
      return generation === undefined ? null : ({ generation } as T);
    }
    if (sql.startsWith('SELECT * FROM session_controls')) {
      const control = this.db.sessionControls.get(String(this.values[0]));
      return control ? sessionControlRow(control) as T : null;
    }
    if (sql.startsWith('UPDATE verified_refs')) {
      const row = this.db.rows.get(String(this.values[2]));
      if (
        !row ||
        !claimMatches(row, this.values, this.db.generations) ||
        !d1RunFenceMatches(sql, this.values, 13, this.db)
      ) {
        return null;
      }
      row.claimed_use_id = this.values[0];
      row.claimed_at = this.values[1];
      return structuredClone(row) as T;
    }
    if (sql.startsWith('SELECT') && sql.includes('FROM verified_refs')) {
      const row = this.db.rows.get(String(this.values[0]));
      return row &&
        lookupMatches(row, this.values, this.db.generations) &&
        d1RunFenceMatches(sql, this.values, 11, this.db)
        ? structuredClone(row) as T
        : null;
    }
    throw new Error(`Unsupported VerifiedRef D1 first SQL: ${sql}`);
  }

  async all<T = Row>(): Promise<D1Result<T>> {
    const row = await this.first<T>();
    return {
      success: true,
      meta: {},
      results: row ? [row] : [],
    };
  }
}

export class FakeVerifiedRefPostgres implements VerifiedRefFake {
  readonly rows = new Map<string, Row>();
  readonly generations = new Map<string, number>();
  readonly sessionControls = new Map<string, FakeSessionControl>();
  readonly customerRuns = new Map<string, FakeCustomerRun>();
  readonly lockEvents: string[] = [];
  readonly transactionEvents: string[] = [];
  readonly queries: RecordedQuery[] = [];
  beforeVerifiedRefInsert?: () => void | Promise<void>;
  afterVerifiedRefShareLock?: () => void | Promise<void>;
  private readonly sharedIssueLocks = new Map<string, number>();
  private readonly sharedIssueLockWaiters =
    new Map<string, Array<() => void>>();

  setCustomerRun(
    runId: string,
    sessionId: string,
    status: CustomerRunStatus,
  ): void {
    this.customerRuns.set(runId, {
      id: runId,
      sessionId,
      sessionAuthorityGeneration:
        effectiveSessionAuthorityGeneration(this.sessionControls, sessionId),
      status,
    });
  }

  async connect() {
    return {
      query: this.query.bind(this),
      release() {
        return undefined;
      },
    };
  }

  async query(
    rawSql: string,
    values: unknown[] = [],
  ): Promise<{ rows: Row[]; rowCount: number }> {
    const sql = normalizeSql(rawSql);
    this.queries.push({ sql, values: structuredClone(values) });
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
      this.transactionEvents.push(sql);
      return result();
    }
    if (
      sql === 'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))'
    ) {
      return result([{ pg_advisory_xact_lock: null }]);
    }
    if (sql.startsWith('SELECT * FROM session_controls')) {
      const control = this.sessionControls.get(String(values[0]));
      return control ? result([sessionControlRow(control)]) : result();
    }
    if (sql.startsWith('SELECT id FROM customer_runs')) {
      const run = this.customerRuns.get(String(values[0]));
      const expectedAuthorityGeneration = Number(values[2]);
      const notAfter = values[3];
      const authCurrent =
        notAfter === null ||
        (
          Number.isFinite(Date.parse(String(notAfter))) &&
          Date.now() < Date.parse(String(notAfter))
        );
      return (
        run &&
        run.sessionId === values[1] &&
        run.sessionAuthorityGeneration === expectedAuthorityGeneration &&
        (run.status === 'accepted' || run.status === 'running') &&
        authCurrent
      )
        ? result([{ id: run.id }])
        : result();
    }
    if (sql.startsWith('INSERT INTO confirmation_pause_sessions')) {
      const sessionId = String(values[0]);
      if (!this.generations.has(sessionId)) {
        this.generations.set(sessionId, 0);
      }
      return result();
    }
    if (
      sql.startsWith(
        'SELECT generation FROM confirmation_pause_sessions',
      )
    ) {
      const sessionId = String(values[0]);
      if (sql.includes('FOR UPDATE')) {
        await this.waitForSharedIssueLocks(sessionId);
        this.lockEvents.push('reset_exclusive_lock');
      }
      const generation = this.generations.get(sessionId);
      return generation === undefined
        ? result()
        : result([{ generation }]);
    }
    if (
      sql.startsWith(
        'SELECT ( EXISTS ( SELECT 1 FROM irreversible_operations',
      )
    ) {
      return result([{ unresolved: false }]);
    }
    if (sql.startsWith('UPDATE confirmation_pause_sessions')) {
      const sessionId = String(values[0]);
      await this.waitForSharedIssueLocks(sessionId);
      this.generations.set(
        sessionId,
        (this.generations.get(sessionId) ?? 0) + 1,
      );
      this.lockEvents.push('reset_generation_advanced');
      return result();
    }
    if (sql.startsWith('INSERT INTO session_controls')) {
      const sessionId = String(values[0]);
      const control: FakeSessionControl = {
        sessionId,
        agentMode: 'ai_active',
        assignedAgentId: null,
        sessionAuthorityGeneration: Number(values[1]),
        updatedAt: String(values[2]),
      };
      this.sessionControls.set(sessionId, control);
      return result([sessionControlRow(control)]);
    }
    if (sql.startsWith('INSERT INTO verified_refs')) {
      const hook = this.beforeVerifiedRefInsert;
      this.beforeVerifiedRefInsert = undefined;
      await hook?.();
      const sessionId = String(values[16]);
      const expectedGeneration = Number(values[17]);
      const refId = String(values[1]);
      if (!sql.includes('FOR SHARE')) {
        throw new Error('verified_ref_issue_share_lock_missing');
      }
      this.acquireSharedIssueLock(sessionId);
      try {
        const afterLock = this.afterVerifiedRefShareLock;
        this.afterVerifiedRefShareLock = undefined;
        await afterLock?.();
        if (
          this.generations.get(sessionId) !== expectedGeneration ||
          this.rows.has(refId)
        ) {
          return result();
        }
        const row = rowFromStorageValues(values);
        row.payload_json = JSON.parse(String(row.payload_json)) as unknown;
        this.rows.set(refId, row);
        this.lockEvents.push('issue_insert_visible');
        return result([structuredClone(row)]);
      } finally {
        this.releaseSharedIssueLock(sessionId);
      }
    }
    if (sql.startsWith('UPDATE verified_refs')) {
      const row = this.rows.get(String(values[2]));
      if (!row || !claimMatches(row, values, this.generations)) {
        return result();
      }
      row.claimed_use_id = values[0];
      row.claimed_at = values[1];
      return result([structuredClone(row)]);
    }
    if (sql.startsWith('SELECT') && sql.includes('FROM verified_refs')) {
      const row = this.rows.get(String(values[0]));
      const d1ShapedValues = [
        ...values.slice(0, 9),
        values[8],
        values[9],
      ];
      return row && lookupMatches(row, d1ShapedValues, this.generations)
        ? result([structuredClone(row)])
        : result();
    }
    if (sql.startsWith('WITH session_customer_runs AS')) {
      const sessionId = String(values[0]);
      for (const [refId, row] of this.rows) {
        if (row.session_id === sessionId) this.rows.delete(refId);
      }
      this.lockEvents.push('reset_refs_deleted');
      return result();
    }
    if (
      sql.startsWith('CREATE TABLE') ||
      sql.startsWith('CREATE INDEX')
    ) {
      return result();
    }
    throw new Error(`Unsupported VerifiedRef Postgres SQL: ${sql}`);
  }

  private acquireSharedIssueLock(sessionId: string): void {
    this.sharedIssueLocks.set(
      sessionId,
      (this.sharedIssueLocks.get(sessionId) ?? 0) + 1,
    );
    this.lockEvents.push('issue_share_lock');
  }

  private releaseSharedIssueLock(sessionId: string): void {
    const remaining = (this.sharedIssueLocks.get(sessionId) ?? 1) - 1;
    if (remaining > 0) {
      this.sharedIssueLocks.set(sessionId, remaining);
      return;
    }
    this.sharedIssueLocks.delete(sessionId);
    this.lockEvents.push('issue_share_unlock');
    const waiters = this.sharedIssueLockWaiters.get(sessionId) ?? [];
    this.sharedIssueLockWaiters.delete(sessionId);
    for (const resolve of waiters) resolve();
  }

  private async waitForSharedIssueLocks(sessionId: string): Promise<void> {
    if (!this.sharedIssueLocks.has(sessionId)) return;
    await new Promise<void>((resolve) => {
      const waiters = this.sharedIssueLockWaiters.get(sessionId) ?? [];
      waiters.push(resolve);
      this.sharedIssueLockWaiters.set(sessionId, waiters);
    });
  }
}

function rowFromStorageValues(values: unknown[]): Row {
  return Object.fromEntries(
    storageColumns.map((column, index) => [column, values[index]]),
  );
}

function lookupMatches(
  row: Row,
  values: unknown[],
  generations: Map<string, number>,
): boolean {
  const lifecycle = values[10];
  return (
    row.ref_id === values[0] &&
    row.kind === values[1] &&
    row.session_id === values[2] &&
    row.customer_id === values[3] &&
    row.channel === values[4] &&
    row.authenticated_subject === values[5] &&
    row.authentication_evidence_ref === values[6] &&
    row.verified_revision === values[7] &&
    String(row.created_at) <= String(values[8]) &&
    String(row.expires_at) > String(values[8]) &&
    (lifecycle === undefined || row.lifecycle === lifecycle) &&
    generations.get(String(row.session_id)) === row.session_generation
  );
}

function claimMatches(
  row: Row,
  values: unknown[],
  generations: Map<string, number>,
): boolean {
  return (
    row.ref_id === values[2] &&
    row.kind === values[3] &&
    row.session_id === values[4] &&
    row.customer_id === values[5] &&
    row.channel === values[6] &&
    row.authenticated_subject === values[7] &&
    row.authentication_evidence_ref === values[8] &&
    row.verified_revision === values[9] &&
    row.lifecycle === 'one_shot' &&
    row.claimed_use_id === null &&
    row.claimed_at === null &&
    String(row.created_at) <= String(values[10]) &&
    String(row.expires_at) > String(values[10]) &&
    generations.get(String(row.session_id)) === row.session_generation
  );
}

function d1RunFenceMatches(
  sql: string,
  values: unknown[],
  coreBindingCount: number,
  db: FakeVerifiedRefD1,
): boolean {
  if (!sql.includes("unixepoch('now') < unixepoch(?)")) return true;
  const notAfter = values[coreBindingCount];
  if (
    notAfter !== null &&
    (
      !Number.isFinite(Date.parse(String(notAfter))) ||
      Date.now() >= Date.parse(String(notAfter))
    )
  ) {
    return false;
  }
  const ownerOffset = coreBindingCount + 2;
  if (sql.includes('FROM customer_runs AS run')) {
    const [
      runId,
      sessionId,
      expectedRunAuthorityGeneration,
      authoritySessionId,
      expectedAuthorityGeneration,
      absentAuthorityGeneration,
      absentAuthoritySessionId,
    ] = values.slice(ownerOffset, ownerOffset + 7);
    const run = db.customerRuns.get(String(runId));
    return Boolean(
      run &&
      run.sessionId === sessionId &&
      run.sessionAuthorityGeneration === expectedRunAuthorityGeneration &&
      (run.status === 'accepted' || run.status === 'running') &&
      authoritySessionId === sessionId &&
      absentAuthoritySessionId === sessionId &&
      expectedAuthorityGeneration === expectedRunAuthorityGeneration &&
      absentAuthorityGeneration === expectedRunAuthorityGeneration &&
      effectiveSessionAuthorityMatches(
        db.sessionControls,
        String(sessionId),
        Number(expectedAuthorityGeneration),
      ),
    );
  }
  return false;
}

function effectiveSessionAuthorityGeneration(
  controls: Map<string, FakeSessionControl>,
  sessionId: string,
): number {
  return controls.get(sessionId)?.sessionAuthorityGeneration ?? 0;
}

function effectiveSessionAuthorityMatches(
  controls: Map<string, FakeSessionControl>,
  sessionId: string,
  expectedGeneration: number,
): boolean {
  const control = controls.get(sessionId);
  return control
    ? (
        control.agentMode === 'ai_active' &&
        control.sessionAuthorityGeneration === expectedGeneration
      )
    : expectedGeneration === 0;
}

function sessionControlRow(control: FakeSessionControl): Row {
  return {
    session_id: control.sessionId,
    agent_mode: control.agentMode,
    assigned_agent_id: control.assignedAgentId,
    session_authority_generation: control.sessionAuthorityGeneration,
    updated_at: control.updatedAt,
  };
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/gu, ' ').trim();
}

function ok(changes = 0): D1Result {
  return {
    success: true,
    meta: { changes },
  };
}

function result(rows: Row[] = []): { rows: Row[]; rowCount: number } {
  return { rows, rowCount: rows.length };
}
