import { describe, expect, it } from 'vitest';
import {
  D1Store,
  type D1DatabaseLike,
} from '../../src/persistence/d1Store.js';
import { PostgresStore } from '../../src/persistence/postgresStore.js';
import type {
  ConversationStore,
} from '../../src/persistence/contracts.js';
import type {
  AgentRunRow,
  D1PreparedStatement,
  D1Result,
  SessionAgentStateRow,
} from '../../src/persistence/d1StoreSupport.js';

const sessionId = 'messenger:durable-execution-lease';
const runId = 'run-durable-execution-lease';
const claimedAt = '2026-07-20T00:00:02.000Z';
const requestedLeaseToken = '00000000-0000-4000-8000-000000000002';
const requestedLeaseExpiry = '2026-07-20T00:01:02.000Z';
const previousLeaseToken = '00000000-0000-4000-8000-000000000001';

type Backend = 'd1' | 'postgres';
type Scenario =
  | 'active'
  | 'expired_reclaim'
  | 'irreversible_boundary'
  | 'attempts_exhausted'
  | 'conditional_commit'
  | 'conditional_stale';

describe.each<Backend>(['d1', 'postgres'])(
  '%s AgentRun execution lease',
  (backend) => {
    it('blocks a second owner while the first lease is active', async () => {
      const harness = durableHarness(backend, 'active');

      await expect(
        harness.store.claimAgentRunExecution(executionClaim()),
      ).resolves.toMatchObject({
        status: 'stale',
        reason: 'lease_active',
        run: {
          status: 'running',
          executionAttempt: 1,
          executionLeaseToken: previousLeaseToken,
        },
      });
    });

    it('reclaims an expired pre-boundary lease with a monotonic attempt', async () => {
      const harness = durableHarness(backend, 'expired_reclaim');

      await expect(
        harness.store.claimAgentRunExecution(executionClaim()),
      ).resolves.toMatchObject({
        status: 'claimed',
        run: {
          status: 'running',
          executionAttempt: 2,
          executionLeaseToken: requestedLeaseToken,
          executionLeaseExpiresAt: requestedLeaseExpiry,
          startedAt: claimedAt,
        },
      });
      expect(harness.executionClaimQuery()).toMatch(
        backend === 'd1'
          ? /execution_attempt = execution_attempt \+ 1[\s\S]+execution_attempt < \?[\s\S]+irreversible_side_effect_at IS NULL[\s\S]+execution_lease_expires_at IS NOT NULL[\s\S]+julianday\(execution_lease_expires_at\) <= julianday\('now'\)/u
          : /execution_attempt = execution_attempt \+ 1[\s\S]+execution_attempt < \$8[\s\S]+irreversible_side_effect_at IS NULL[\s\S]+execution_lease_expires_at IS NOT NULL[\s\S]+execution_lease_expires_at <= clock_timestamp\(\)/u,
      );
    });

    it('quarantines an expired post-irreversible lease', async () => {
      const harness = durableHarness(backend, 'irreversible_boundary');

      await expect(
        harness.store.claimAgentRunExecution(executionClaim()),
      ).resolves.toMatchObject({
        status: 'reconciliation_required',
        reason: 'irreversible_outcome_unknown',
        run: {
          status: 'reconciliation_required',
          deliveryStatus: 'not_applicable',
          errorCode: 'agent_run_outcome_unknown',
          irreversibleToolName: 'placeOrder',
        },
      });
      expect(harness.reconciliationQuery()).toMatch(
        /status = 'reconciliation_required'[\s\S]+irreversible_side_effect_at IS NOT NULL[\s\S]+execution_attempt/u,
      );
    });

    it('quarantines an expired lease after exactly three attempts', async () => {
      const harness = durableHarness(backend, 'attempts_exhausted');

      await expect(
        harness.store.claimAgentRunExecution(executionClaim()),
      ).resolves.toMatchObject({
        status: 'reconciliation_required',
        reason: 'attempts_exhausted',
        run: {
          status: 'reconciliation_required',
          executionAttempt: 3,
          deliveryStatus: 'not_applicable',
          errorCode: 'agent_run_execution_attempts_exhausted',
        },
      });
      expect(harness.reconciliationQuery()).toMatch(
        backend === 'd1'
          ? /execution_attempt >= \?[\s\S]+current_run_id = \?[\s\S]+generation = \?/u
          : /execution_attempt >= \$6[\s\S]+current_run_id = \$1[\s\S]+generation = \$3/u,
      );
    });

    it('commits a mutation only through the exact active lease fence', async () => {
      const harness = durableHarness(backend, 'conditional_commit');

      await expect(
        harness.store.updateAgentRunIfExecutionCurrent({
          sessionId,
          fence: {
            kind: 'agent_run',
            runId,
            generation: 7,
            sessionAuthorityGeneration: 0,
            executionAttempt: 1,
            executionLeaseToken: previousLeaseToken,
          },
          patch: {
            irreversibleSideEffectAt: claimedAt,
            irreversibleToolName: 'placeOrder',
          },
        }),
      ).resolves.toMatchObject({
        status: 'committed',
        run: {
          executionAttempt: 1,
          executionLeaseToken: previousLeaseToken,
          irreversibleToolName: 'placeOrder',
        },
      });
      expect(harness.conditionalUpdateQuery()).toMatch(
        backend === 'd1'
          ? /status = 'running'[\s\S]+execution_attempt = \?[\s\S]+execution_lease_token = \?[\s\S]+julianday\('now'\) < julianday\(execution_lease_expires_at\)[\s\S]+current_run_id = \?[\s\S]+generation = \?/u
          : /status = 'running'[\s\S]+execution_attempt = \$\d+[\s\S]+execution_lease_token = \$\d+[\s\S]+clock_timestamp\(\) < run\.execution_lease_expires_at[\s\S]+current_run_id = \$\d+[\s\S]+generation = \$\d+/u,
      );
    });

    it('rejects a mutation from a stale lease owner', async () => {
      const harness = durableHarness(backend, 'conditional_stale');

      await expect(
        harness.store.updateAgentRunIfExecutionCurrent({
          sessionId,
          fence: {
            kind: 'agent_run',
            runId,
            generation: 7,
            sessionAuthorityGeneration: 0,
            executionAttempt: 1,
            executionLeaseToken: previousLeaseToken,
          },
          patch: { status: 'completed' },
        }),
      ).resolves.toMatchObject({
        status: 'stale',
        run: {
          status: 'running',
          executionAttempt: 2,
          executionLeaseToken: requestedLeaseToken,
        },
      });
    });
  },
);

interface DurableHarness {
  store: ConversationStore;
  queries: string[];
  executionClaimQuery(): string;
  reconciliationQuery(): string;
  conditionalUpdateQuery(): string;
}

function durableHarness(
  backend: Backend,
  scenario: Scenario,
): DurableHarness {
  const database = backend === 'd1'
    ? new LeaseD1Database(scenario)
    : new LeasePostgresDatabase(scenario);
  const store = backend === 'd1'
    ? new D1Store(database as LeaseD1Database)
    : new PostgresStore(database as never);
  const queries = database.queries;
  return {
    store,
    queries,
    executionClaimQuery: () =>
      requiredQuery(
        queries,
        /UPDATE agent_runs(?: AS run)?[\s\S]+SET status = 'running'/u,
      ),
    reconciliationQuery: () =>
      requiredQuery(
        queries,
        /UPDATE agent_runs(?: AS run)?[\s\S]+SET status = 'reconciliation_required'/u,
      ),
    conditionalUpdateQuery: () =>
      requiredQuery(
        queries,
        /UPDATE agent_runs(?: AS run)?[\s\S]+SET (?!status = 'running'|status = 'reconciliation_required')/u,
      ),
  };
}

function executionClaim() {
  return {
    runId,
    sessionId,
    generation: 7,
    sessionAuthorityGeneration: 0,
    claimedAt,
    executionLeaseToken: requestedLeaseToken,
    executionLeaseExpiresAt: requestedLeaseExpiry,
  };
}

class LeaseD1Statement implements D1PreparedStatement {
  bindings: unknown[] = [];

  constructor(
    readonly owner: LeaseD1Database,
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
    this.owner.queries.push(this.query);
    return this.owner.first(this.query) as Row | null;
  }

  async all<Row>(): Promise<D1Result<Row>> {
    return { success: true, meta: {}, results: [] };
  }
}

class LeaseD1Database implements D1DatabaseLike {
  readonly queries: string[] = [];

  constructor(readonly scenario: Scenario) {}

  prepare(query: string): LeaseD1Statement {
    return new LeaseD1Statement(this, query);
  }

  first(query: string): AgentRunRow | SessionAgentStateRow | null {
    if (isExecutionClaimQuery(query)) {
      return this.scenario === 'expired_reclaim'
        ? reclaimedRunRow()
        : null;
    }
    if (isReconciliationQuery(query)) {
      if (this.scenario === 'irreversible_boundary') {
        return reconciledRunRow('irreversible_outcome_unknown');
      }
      if (this.scenario === 'attempts_exhausted') {
        return reconciledRunRow('attempts_exhausted');
      }
      return null;
    }
    if (isConditionalUpdateQuery(query)) {
      return this.scenario === 'conditional_commit'
        ? boundaryRunRow()
        : null;
    }
    if (/SELECT \* FROM agent_runs/u.test(query)) {
      return existingRunRow(this.scenario);
    }
    if (/SELECT \* FROM session_agent_state/u.test(query)) {
      return currentStateRow();
    }
    return null;
  }
}

class LeasePostgresDatabase {
  readonly queries: string[] = [];

  constructor(readonly scenario: Scenario) {}

  async connect() {
    return this;
  }

  async query(query: string) {
    this.queries.push(query);
    if (/FROM session_controls[\s\S]+FOR UPDATE/u.test(query)) {
      return result([]);
    }
    if (isExecutionClaimQuery(query)) {
      return result(
        this.scenario === 'expired_reclaim' ? [reclaimedRunRow()] : [],
      );
    }
    if (isReconciliationQuery(query)) {
      if (this.scenario === 'irreversible_boundary') {
        return result([
          reconciledRunRow('irreversible_outcome_unknown'),
        ]);
      }
      if (this.scenario === 'attempts_exhausted') {
        return result([reconciledRunRow('attempts_exhausted')]);
      }
      return result([]);
    }
    if (isConditionalUpdateQuery(query)) {
      return result(
        this.scenario === 'conditional_commit'
          ? [boundaryRunRow()]
          : [],
      );
    }
    if (/SELECT \* FROM agent_runs/u.test(query)) {
      return result([existingRunRow(this.scenario)]);
    }
    return result([]);
  }

  release(): void {}
}

function isExecutionClaimQuery(query: string): boolean {
  return /UPDATE agent_runs(?: AS run)?[\s\S]+SET status = 'running'/u
    .test(query);
}

function isReconciliationQuery(query: string): boolean {
  return /UPDATE agent_runs(?: AS run)?[\s\S]+SET status = 'reconciliation_required'/u
    .test(query);
}

function isConditionalUpdateQuery(query: string): boolean {
  return /UPDATE agent_runs(?: AS run)?/u.test(query) &&
    !isExecutionClaimQuery(query) &&
    !isReconciliationQuery(query);
}

function existingRunRow(scenario: Scenario): AgentRunRow {
  if (scenario === 'active') {
    return runningRunRow({
      execution_lease_expires_at: '2099-01-01T00:00:00.000Z',
    });
  }
  if (scenario === 'conditional_stale') {
    return runningRunRow({
      execution_attempt: 2,
      execution_lease_token: requestedLeaseToken,
      execution_lease_expires_at: '2099-01-01T00:00:00.000Z',
    });
  }
  return scheduledRunRow();
}

function scheduledRunRow(): AgentRunRow {
  return {
    id: runId,
    session_id: sessionId,
    generation: 7,
    session_authority_generation: 0,
    channel: 'messenger',
    external_user_id: 'customer-durable-execution-lease',
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
    scheduled_at: claimedAt,
    started_at: null,
    completed_at: null,
    updated_at: claimedAt,
  };
}

function runningRunRow(
  overrides: Partial<AgentRunRow> = {},
): AgentRunRow {
  return {
    ...scheduledRunRow(),
    status: 'running',
    execution_attempt: 1,
    execution_lease_token: previousLeaseToken,
    execution_lease_expires_at: requestedLeaseExpiry,
    started_at: claimedAt,
    ...overrides,
  };
}

function reclaimedRunRow(): AgentRunRow {
  return runningRunRow({
    execution_attempt: 2,
    execution_lease_token: requestedLeaseToken,
    execution_lease_expires_at: requestedLeaseExpiry,
  });
}

function boundaryRunRow(): AgentRunRow {
  return runningRunRow({
    irreversible_side_effect_at: claimedAt,
    irreversible_tool_name: 'placeOrder',
  });
}

function reconciledRunRow(
  reason: 'irreversible_outcome_unknown' | 'attempts_exhausted',
): AgentRunRow {
  const irreversible = reason === 'irreversible_outcome_unknown';
  return runningRunRow({
    status: 'reconciliation_required',
    execution_attempt: irreversible ? 1 : 3,
    irreversible_side_effect_at: irreversible ? claimedAt : null,
    irreversible_tool_name: irreversible ? 'placeOrder' : null,
    delivery_status: 'not_applicable',
    error_code: irreversible
      ? 'agent_run_outcome_unknown'
      : 'agent_run_execution_attempts_exhausted',
    error_message: irreversible
      ? 'Irreversible provider outcome requires reconciliation'
      : 'Agent run execution attempts exhausted',
    completed_at: claimedAt,
  });
}

function currentStateRow(): SessionAgentStateRow {
  return {
    session_id: sessionId,
    current_run_id: runId,
    generation: 7,
    debounce_deadline_at: null,
    updated_at: claimedAt,
  };
}

function result<Row>(rows: Row[]) {
  return { rows, rowCount: rows.length };
}

function requiredQuery(queries: string[], pattern: RegExp): string {
  const query = queries.find((candidate) => pattern.test(candidate));
  if (!query) throw new Error(`Expected query matching ${pattern}`);
  return query;
}
