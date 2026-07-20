import {
  DatabaseSync,
  type SQLInputValue,
  type StatementSync,
} from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import {
  D1Store,
  type D1DatabaseLike,
} from '../../src/persistence/d1Store.js';
import type {
  D1PreparedStatement,
  D1Result,
} from '../../src/persistence/d1StoreSupport.js';

const openDatabases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of openDatabases.splice(0)) database.close();
});

describe('D1 AgentRun text-delivery persistence', () => {
  it('atomically creates, begins, and confirms a sent delivery after lease expiry', async () => {
    const harness = await createHarness('sent');
    const created = await createDelivery(harness);
    expect(created.status).toBe('created');

    const begun = await harness.store.beginAgentRunTextDeliveryAttempt({
      execution: harness.execution,
      nextDeliveryAttempt: 1,
      deliveryAttemptToken: 'delivery-attempt-token-sent-000001',
      updatedAt: harness.at(1),
    });
    expect(begun.status).toBe('dispatch_authorized');
    expect(() =>
      harness.database.execute(
        `UPDATE agent_run_text_delivery_attempts
         SET created_at = 'not-a-canonical-instant'
         WHERE run_id = ?`,
        [harness.runId],
      ),
    ).toThrow();
    harness.database.execute(
      `UPDATE agent_runs SET execution_lease_expires_at = ? WHERE id = ?`,
      [harness.at(-1), harness.runId],
    );

    const completed =
      await harness.store.completeAgentRunTextDeliveryAttempt({
        execution: harness.execution,
        deliveryAttempt: 1,
        deliveryAttemptToken: 'delivery-attempt-token-sent-000001',
        outcome: {
          status: 'confirmed_sent',
          messageId: 'provider-message-sent-1',
        },
        updatedAt: harness.at(2),
      });

    expect(completed).toMatchObject({
      status: 'transitioned',
      record: {
        status: 'confirmed_sent',
        providerMessageId: 'provider-message-sent-1',
      },
    });
    await expect(harness.store.getAgentRun(harness.runId)).resolves
      .toMatchObject({
        status: 'completed',
        deliveryStatus: 'sent',
        deliveryExternalMessageId: 'provider-message-sent-1',
      });
    expect(harness.database.batchCalls).toBeGreaterThanOrEqual(2);
  });

  it('atomically reconciles an unknown delivery and replays it without redispatch', async () => {
    const harness = await createHarness('unknown');
    await createDelivery(harness);
    await beginDelivery(harness, 'delivery-attempt-token-unknown-001');

    const reconciled =
      await harness.store.reconcileAgentRunTextDelivery({
        execution: harness.execution,
        outcomeCode: 'provider_connection_interrupted',
        updatedAt: harness.at(2),
      });
    const replay = await harness.store.reconcileAgentRunTextDelivery({
      execution: harness.execution,
      outcomeCode: 'different_replay_code',
      updatedAt: harness.at(3),
    });

    expect(reconciled).toMatchObject({
      status: 'reconciled',
      record: {
        status: 'delivery_outcome_unknown',
        outcomeCode: 'provider_connection_interrupted',
      },
    });
    expect(replay).toMatchObject({
      status: 'replay',
      record: { outcomeCode: 'provider_connection_interrupted' },
    });
    await expect(harness.store.getAgentRun(harness.runId)).resolves
      .toMatchObject({
        status: 'reconciliation_required',
        deliveryStatus: 'outcome_unknown',
      });
  });

  it('reconciles expired sending before claim and blocks every later reclaim', async () => {
    const harness = await createHarness('expired');
    await createDelivery(harness);
    await beginDelivery(harness, 'delivery-attempt-token-expired-001');
    harness.database.execute(
      `UPDATE agent_runs SET execution_lease_expires_at = ? WHERE id = ?`,
      [harness.at(-1), harness.runId],
    );

    const claim = await harness.store.claimAgentRunExecution({
      runId: harness.runId,
      sessionId: harness.sessionId,
      generation: 1,
      sessionAuthorityGeneration: 0,
      claimedAt: harness.at(0),
      executionLeaseToken: 'replacement-execution-token-00000002',
      executionLeaseExpiresAt: harness.at(62),
    });
    const replayedClaim = await harness.store.claimAgentRunExecution({
      runId: harness.runId,
      sessionId: harness.sessionId,
      generation: 1,
      sessionAuthorityGeneration: 0,
      claimedAt: harness.at(3),
      executionLeaseToken: 'replacement-execution-token-00000003',
      executionLeaseExpiresAt: harness.at(63),
    });

    expect(claim).toMatchObject({
      status: 'reconciliation_required',
      reason: 'delivery_outcome_unknown',
    });
    expect(replayedClaim).toMatchObject({
      status: 'stale',
      reason: 'delivery_outcome_unknown',
    });
    await expect(
      harness.store.getAgentRunTextDelivery(harness.runId),
    ).resolves.toMatchObject({
      status: 'delivery_outcome_unknown',
      outcomeCode: 'agent_run_execution_lease_expired',
      updatedAt: harness.at(1),
    });
  });

  it('rebinds only the exact next run execution and rejects global token reuse', async () => {
    const harness = await createHarness('retry');
    await createDelivery(harness);
    const firstToken = 'delivery-attempt-token-retry-000001';
    await beginDelivery(harness, firstToken);
    await harness.store.completeAgentRunTextDeliveryAttempt({
      execution: harness.execution,
      deliveryAttempt: 1,
      deliveryAttemptToken: firstToken,
      outcome: {
        status: 'confirmed_not_sent',
        errorCode: 'provider_rejected_before_dispatch',
        message: 'Provider confirmed no message was sent',
      },
      updatedAt: harness.at(2),
    });
    await expect(
      harness.store.beginAgentRunTextDeliveryAttempt({
        execution: harness.execution,
        nextDeliveryAttempt: 2,
        deliveryAttemptToken: 'same-execution-retry-token-000001',
        updatedAt: harness.at(3),
      }),
    ).resolves.toEqual({
      status: 'dispatch_blocked',
      reason: 'execution_rebind_required',
    });
    harness.database.execute(
      `UPDATE agent_runs SET execution_lease_expires_at = ? WHERE id = ?`,
      [harness.at(-1), harness.runId],
    );
    const secondExecution = {
      ...harness.execution,
      executionAttempt: 2,
      executionLeaseToken: 'run-execution-token-retry-00000002',
    };
    const claimed = await harness.store.claimAgentRunExecution({
      runId: harness.runId,
      sessionId: harness.sessionId,
      generation: 1,
      sessionAuthorityGeneration: 0,
      claimedAt: harness.at(3),
      executionLeaseToken: secondExecution.executionLeaseToken,
      executionLeaseExpiresAt: harness.at(63),
    });
    expect(claimed.status).toBe('claimed');

    const rebound = await harness.store.createAgentRunTextDelivery({
      execution: secondExecution,
      channel: 'messenger',
      assistantTurnId: harness.assistantTurnId,
      recipientId: 'private-recipient',
      presentationText: 'Verified presentation',
      createdAt: harness.at(4),
    });
    expect(rebound).toMatchObject({
      status: 'rebound',
      record: {
        runExecutionAttempt: 2,
        runExecutionOriginAttempt: 1,
        priorRunExecutionLeaseTokenDigests: [
          expect.stringMatching(/^[0-9a-f]{64}$/u),
        ],
      },
    });

    await expect(
      harness.store.beginAgentRunTextDeliveryAttempt({
        execution: secondExecution,
        nextDeliveryAttempt: 2,
        deliveryAttemptToken: firstToken,
        updatedAt: harness.at(5),
      }),
    ).resolves.toEqual({
      status: 'dispatch_blocked',
      reason: 'delivery_attempt_token_reused',
    });

    const otherHarness = await createHarness('global-token', harness);
    await createDelivery(otherHarness);
    await expect(
      otherHarness.store.beginAgentRunTextDeliveryAttempt({
        execution: otherHarness.execution,
        nextDeliveryAttempt: 1,
        deliveryAttemptToken: firstToken,
        updatedAt: otherHarness.at(1),
      }),
    ).resolves.toEqual({
      status: 'dispatch_blocked',
      reason: 'delivery_attempt_token_reused',
    });
  });

  it('requires another execution after a pre-dispatch rebind fails without sending', async () => {
    const harness = await createHarness('pending-rebind-retry');
    await createDelivery(harness);
    harness.database.execute(
      `UPDATE agent_runs SET execution_lease_expires_at = ? WHERE id = ?`,
      [harness.at(-1), harness.runId],
    );
    const secondExecution = {
      ...harness.execution,
      executionAttempt: 2,
      executionLeaseToken:
        'run-execution-token-pending-rebind-00000002',
    };
    const claim = await harness.store.claimAgentRunExecution({
      runId: harness.runId,
      sessionId: harness.sessionId,
      generation: 1,
      sessionAuthorityGeneration: 0,
      claimedAt: harness.at(1),
      executionLeaseToken: secondExecution.executionLeaseToken,
      executionLeaseExpiresAt: harness.at(61),
    });
    expect(claim.status).toBe('claimed');

    const rebound = await harness.store.createAgentRunTextDelivery({
      execution: secondExecution,
      channel: 'messenger',
      assistantTurnId: harness.assistantTurnId,
      recipientId: 'private-recipient',
      presentationText: 'Verified presentation',
      createdAt: harness.at(2),
    });
    expect(rebound).toMatchObject({
      status: 'rebound',
      record: {
        runExecutionAttempt: 2,
        lastDeliveryRunExecutionAttempt: null,
      },
    });

    const firstToken =
      'delivery-attempt-token-pending-rebind-000001';
    await expect(
      harness.store.beginAgentRunTextDeliveryAttempt({
        execution: secondExecution,
        nextDeliveryAttempt: 1,
        deliveryAttemptToken: firstToken,
        updatedAt: harness.at(3),
      }),
    ).resolves.toMatchObject({
      status: 'dispatch_authorized',
      record: { lastDeliveryRunExecutionAttempt: 2 },
    });
    await expect(
      harness.store.completeAgentRunTextDeliveryAttempt({
        execution: secondExecution,
        deliveryAttempt: 1,
        deliveryAttemptToken: firstToken,
        outcome: {
          status: 'confirmed_not_sent',
          errorCode: 'provider_rejected_before_dispatch',
          message: 'Provider confirmed no message was sent',
        },
        updatedAt: harness.at(4),
      }),
    ).resolves.toMatchObject({
      status: 'transitioned',
      record: {
        status: 'confirmed_not_sent',
        lastDeliveryRunExecutionAttempt: 2,
      },
    });

    await expect(
      harness.store.beginAgentRunTextDeliveryAttempt({
        execution: secondExecution,
        nextDeliveryAttempt: 2,
        deliveryAttemptToken:
          'delivery-attempt-token-pending-rebind-000002',
        updatedAt: harness.at(5),
      }),
    ).resolves.toEqual({
      status: 'dispatch_blocked',
      reason: 'execution_rebind_required',
    });
  });

  it('rejects creation when the AgentRun channel differs from the assistant turn', async () => {
    const harness = await createHarness('cross-channel');
    harness.database.execute(
      `UPDATE agent_runs SET channel = 'zalo' WHERE id = ?`,
      [harness.runId],
    );

    await expect(createDelivery(harness)).resolves.toEqual({
      status: 'stale',
    });
    await expect(
      harness.store.getAgentRunTextDelivery(harness.runId),
    ).resolves.toBeUndefined();
  });

  it('rejects missing or different AgentRun assistant-turn authority', async () => {
    const missingHarness = await createHarness('missing-assistant');
    missingHarness.database.execute(
      `UPDATE agent_runs SET assistant_turn_id = NULL WHERE id = ?`,
      [missingHarness.runId],
    );
    await expect(createDelivery(missingHarness)).resolves.toEqual({
      status: 'stale',
    });

    const differentHarness = await createHarness('different-assistant');
    const otherTurnId = 'd1-other-assistant-turn';
    differentHarness.database.execute(
      `INSERT INTO conversation_turns (
         id, session_id, channel, role, text, external_message_id,
         external_user_id, delivery_status, metadata, created_at
       ) VALUES (?, ?, 'messenger', 'assistant', 'Other presentation',
         NULL, NULL, 'pending', NULL, ?)`,
      [
        otherTurnId,
        differentHarness.sessionId,
        differentHarness.at(0),
      ],
    );
    differentHarness.database.execute(
      `UPDATE agent_runs SET assistant_turn_id = ? WHERE id = ?`,
      [otherTurnId, differentHarness.runId],
    );
    await expect(createDelivery(differentHarness)).resolves.toEqual({
      status: 'stale',
    });
  });

  it('rejects every dispatched or terminal row without its dispatch execution', async () => {
    const harness = await createHarness('missing-dispatch-execution');
    await createDelivery(harness);
    const invalidRows = [
      {
        status: 'sending',
        providerMessageId: null,
        outcomeCode: null,
      },
      {
        status: 'confirmed_sent',
        providerMessageId: 'provider-message-invalid',
        outcomeCode: null,
      },
      {
        status: 'confirmed_not_sent',
        providerMessageId: null,
        outcomeCode: 'provider_rejected_before_dispatch',
      },
      {
        status: 'delivery_outcome_unknown',
        providerMessageId: null,
        outcomeCode: 'provider_connection_interrupted',
      },
    ] as const;

    for (const row of invalidRows) {
      expect(() =>
        harness.database.execute(
          `UPDATE agent_run_text_deliveries
           SET status = ?,
               delivery_attempt = 1,
               last_delivery_run_execution_attempt = NULL,
               delivery_attempt_token = ?,
               provider_message_id = ?,
               outcome_code = ?
           WHERE run_id = ?`,
          [
            row.status,
            `invalid-null-dispatch-${row.status}`,
            row.providerMessageId,
            row.outcomeCode,
            harness.runId,
          ],
        ),
      ).toThrow();
    }
  });

  it('preserves an active lease across a same-second sub-second boundary', async () => {
    const harness = await createHarness('subsecond-lease');
    const now = await earlySecondInstant();
    const expiry = new Date(
      Math.floor(now / 1_000) * 1_000 + 900,
    ).toISOString();
    harness.database.execute(
      `UPDATE agent_runs SET execution_lease_expires_at = ? WHERE id = ?`,
      [expiry, harness.runId],
    );

    const claim = await harness.store.claimAgentRunExecution({
      runId: harness.runId,
      sessionId: harness.sessionId,
      generation: 1,
      sessionAuthorityGeneration: 0,
      claimedAt: new Date(now).toISOString(),
      executionLeaseToken: 'subsecond-replacement-execution-token-02',
      executionLeaseExpiresAt: new Date(now + 60_000).toISOString(),
    });

    expect(claim).toMatchObject({
      status: 'stale',
      reason: 'lease_active',
      run: { executionAttempt: 1 },
    });
  });

  it('cascades session reset through delivery head and attempt history only for that session', async () => {
    const harness = await createHarness('reset-owned');
    await createDelivery(harness);
    await beginDelivery(harness, 'delivery-attempt-token-reset-owned');
    const retained = await createHarness('reset-retained', harness);
    await createDelivery(retained);
    await beginDelivery(retained, 'delivery-attempt-token-reset-retained');

    await harness.store.resetSession(harness.sessionId);

    await expect(
      harness.store.getAgentRunTextDelivery(harness.runId),
    ).resolves.toBeUndefined();
    expect(harness.database.count(
      `SELECT COUNT(*) AS count
       FROM agent_run_text_delivery_attempts
       WHERE run_id = ?`,
      [harness.runId],
    )).toBe(0);
    await expect(
      retained.store.getAgentRunTextDelivery(retained.runId),
    ).resolves.toMatchObject({ status: 'sending' });
    expect(harness.database.count(
      `SELECT COUNT(*) AS count
       FROM agent_run_text_delivery_attempts
       WHERE run_id = ?`,
      [retained.runId],
    )).toBe(1);
  });

  it('supersedes stale retryable work but never suppresses an in-flight delivery', async () => {
    const protectedHarness = await createHarness('supersede-protected');
    await createDelivery(protectedHarness);
    await beginDelivery(
      protectedHarness,
      'delivery-attempt-token-supersede-01',
    );
    protectedHarness.database.execute(
      `UPDATE session_agent_state
       SET current_run_id = NULL, generation = 2
       WHERE session_id = ?`,
      [protectedHarness.sessionId],
    );
    await expect(
      protectedHarness.store
        .supersedeAgentRunExecutionIfNoLongerCurrent({
          sessionId: protectedHarness.sessionId,
          fence: runFence(protectedHarness),
          errorMessage: 'Run lost current ownership',
          completedAt: protectedHarness.at(2),
        }),
    ).resolves.toMatchObject({
      status: 'reconciliation_required',
      reason: 'delivery_outcome_unknown',
    });

    const retryableHarness = await createHarness('supersede-pending');
    await createDelivery(retryableHarness);
    retryableHarness.database.execute(
      `UPDATE session_agent_state
       SET current_run_id = NULL, generation = 2
       WHERE session_id = ?`,
      [retryableHarness.sessionId],
    );
    await expect(
      retryableHarness.store
        .supersedeAgentRunExecutionIfNoLongerCurrent({
          sessionId: retryableHarness.sessionId,
          fence: runFence(retryableHarness),
          errorMessage: 'Run lost current ownership',
          completedAt: retryableHarness.at(2),
        }),
    ).resolves.toMatchObject({
      status: 'superseded',
      run: {
        status: 'superseded',
        deliveryStatus: 'suppressed',
      },
    });
  });
});

interface Harness {
  store: D1Store;
  database: SqliteD1Database;
  runId: string;
  sessionId: string;
  assistantTurnId: string;
  execution: {
    runId: string;
    executionAttempt: number;
    executionLeaseToken: string;
  };
  at(offsetSeconds: number): string;
}

async function createHarness(
  suffix: string,
  shared?: Pick<Harness, 'database' | 'store'>,
): Promise<Harness> {
  const database = shared?.database ?? new SqliteD1Database();
  const store = shared?.store ?? new D1Store(database);
  if (!shared) {
    openDatabases.push(database.raw);
    await store.initialize();
  }
  const base = Date.now();
  const at = (offsetSeconds: number) =>
    new Date(base + offsetSeconds * 1_000).toISOString();
  const runId = `d1-delivery-run-${suffix}`;
  const sessionId = `d1-delivery-session-${suffix}`;
  const assistantTurnId = `d1-assistant-turn-${suffix}`;
  const executionLeaseToken = `run-execution-token-${suffix}-00000001`;
  database.execute(
    `INSERT INTO conversation_turns (
       id, session_id, channel, role, text, external_message_id,
       external_user_id, delivery_status, metadata, created_at
     ) VALUES (?, ?, 'messenger', 'assistant', 'Verified presentation',
       NULL, NULL, 'pending', NULL, ?)`,
    [assistantTurnId, sessionId, at(0)],
  );
  database.execute(
    `INSERT INTO agent_runs (
       id, session_id, generation, session_authority_generation,
       channel, external_user_id, status, execution_attempt,
       execution_lease_token, execution_lease_expires_at,
       coalesced_input_text, superseded_by_run_id,
       irreversible_side_effect_at, irreversible_tool_name,
       assistant_turn_id, delivery_status, delivery_external_message_id,
       error_code, error_message, scheduled_at, started_at,
       completed_at, updated_at
     ) VALUES (?, ?, 1, 0, 'messenger', 'private-recipient', 'running',
       1, ?, ?, 'customer input', NULL, NULL, NULL, ?, 'pending',
       NULL, NULL, NULL, ?, ?, NULL, ?)`,
    [
      runId,
      sessionId,
      executionLeaseToken,
      at(60),
      assistantTurnId,
      at(0),
      at(0),
      at(0),
    ],
  );
  database.execute(
    `INSERT INTO session_agent_state (
       session_id, current_run_id, generation, debounce_deadline_at, updated_at
     ) VALUES (?, ?, 1, NULL, ?)`,
    [sessionId, runId, at(0)],
  );
  return {
    store,
    database,
    runId,
    sessionId,
    assistantTurnId,
    execution: { runId, executionAttempt: 1, executionLeaseToken },
    at,
  };
}

function createDelivery(harness: Harness) {
  return harness.store.createAgentRunTextDelivery({
    execution: harness.execution,
    channel: 'messenger',
    assistantTurnId: harness.assistantTurnId,
    recipientId: 'private-recipient',
    presentationText: 'Verified presentation',
    createdAt: harness.at(0),
  });
}

function beginDelivery(harness: Harness, deliveryAttemptToken: string) {
  return harness.store.beginAgentRunTextDeliveryAttempt({
    execution: harness.execution,
    nextDeliveryAttempt: 1,
    deliveryAttemptToken,
    updatedAt: harness.at(1),
  });
}

function runFence(harness: Harness) {
  return {
    kind: 'agent_run' as const,
    runId: harness.runId,
    generation: 1,
    sessionAuthorityGeneration: 0,
    executionAttempt: 1,
    executionLeaseToken: harness.execution.executionLeaseToken,
  };
}

async function earlySecondInstant(): Promise<number> {
  const deadline = Date.now() + 1_500;
  while (Date.now() < deadline) {
    const now = Date.now();
    if (now % 1_000 <= 100) return now;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('d1_subsecond_boundary_window_unavailable');
}

class SqliteD1Database implements D1DatabaseLike {
  readonly raw = new DatabaseSync(':memory:');
  batchCalls = 0;

  constructor() {
    this.raw.exec('PRAGMA foreign_keys = ON');
  }

  prepare(query: string): D1PreparedStatement {
    return new SqliteD1Statement(this.raw, query);
  }

  async batch(statements: D1PreparedStatement[]): Promise<D1Result[]> {
    this.batchCalls += 1;
    this.raw.exec('BEGIN IMMEDIATE');
    try {
      const results: D1Result[] = [];
      for (const statement of statements) {
        results.push(await statement.run());
      }
      this.raw.exec('COMMIT');
      return results;
    } catch (error) {
      this.raw.exec('ROLLBACK');
      throw error;
    }
  }

  execute(query: string, values: readonly unknown[]): void {
    this.raw.prepare(query).run(...sqliteInputValues(values));
  }

  count(query: string, values: readonly unknown[]): number {
    const row = this.raw.prepare(query).get(
      ...sqliteInputValues(values),
    ) as { count: number | bigint };
    return Number(row.count);
  }
}

class SqliteD1Statement implements D1PreparedStatement {
  private values: unknown[] = [];

  constructor(
    private readonly database: DatabaseSync,
    private readonly query: string,
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    this.values = values;
    return this;
  }

  async run(): Promise<D1Result> {
    const statement = this.statement();
    const values = sqliteInputValues(this.values);
    if (statement.columns().length > 0) {
      const results = statement.all(...values) as Array<
        Record<string, unknown>
      >;
      return {
        success: true,
        results,
        meta: { changes: results.length },
      };
    }
    const result = statement.run(...values);
    return {
      success: true,
      meta: { changes: Number(result.changes) },
    };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (
      this.statement().get(...sqliteInputValues(this.values)) as
        | T
        | undefined
    ) ?? null;
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return {
      success: true,
      results: this.statement().all(
        ...sqliteInputValues(this.values),
      ) as T[],
      meta: {},
    };
  }

  private statement(): StatementSync {
    return this.database.prepare(this.query);
  }
}

function sqliteInputValues(values: readonly unknown[]): SQLInputValue[] {
  return values.map((value) => {
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'bigint'
    ) {
      return value;
    }
    throw new Error('d1_test_sql_input_value_invalid');
  });
}
