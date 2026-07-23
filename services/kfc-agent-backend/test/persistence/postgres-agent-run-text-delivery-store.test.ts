import { describe, expect, it, vi } from 'vitest';
import {
  reconcileExpiredPostgresAgentRunTextDelivery,
} from '../../src/persistence/postgresStoreAgentRunTextDeliveryRecovery.js';
import { PostgresStore } from '../../src/persistence/postgresStore.js';
import {
  beginAgentRunTextDeliveryAttempt,
  completeAgentRunTextDeliveryAttempt,
  createPendingAgentRunTextDelivery,
  rebindRetryableAgentRunTextDelivery,
  type AgentRunTextDeliveryRecord,
} from '../../src/persistence/agentRunTextDelivery.js';
import type {
  AgentRunTextDeliveryStorageRow,
} from '../../src/persistence/agentRunTextDeliveryStorage.js';
import type {
  AgentRunRow,
} from '../../src/persistence/postgresStoreSupport.js';

const instant = '2026-07-20T06:00:00.000Z';
const later = '2026-07-20T06:00:02.000Z';

describe('PostgresStore durable AgentRun text delivery', () => {
  it('creates only under the current assistant-turn owner and persists digests only', async () => {
    const queries: string[] = [];
    let insertBindings: readonly unknown[] = [];
    const client = scriptedClient(async (sql, bindings = []) => {
      queries.push(sql);
      if (sql === 'BEGIN' || sql === 'COMMIT') return emptyResult();
      if (sql.includes('SELECT session_id FROM agent_runs')) {
        return result({ session_id: 'messenger:session' });
      }
      if (sql.includes('pg_advisory_xact_lock')) return emptyResult();
      if (sql.includes('FROM session_controls')) return emptyResult();
      if (
        sql.includes('JOIN session_agent_state AS state') &&
        sql.includes('JOIN conversation_turns AS turn')
      ) {
        return result({ id: 'run-1' });
      }
      if (
        sql.includes('FROM agent_run_text_deliveries') &&
        sql.includes('WHERE run_id')
      ) {
        return emptyResult();
      }
      if (sql.includes('INSERT INTO agent_run_text_deliveries')) {
        insertBindings = bindings;
        return result(deliveryRowFromBindings(bindings));
      }
      throw new Error(`unexpected_query:${sql}`);
    });
    const store = new PostgresStore(poolFor(client) as never);

    await expect(store.createAgentRunTextDelivery({
      execution: execution(1, 'execution-token-1'),
      channel: 'messenger',
      assistantTurnId: 'assistant-turn-1',
      recipientId: 'private-recipient',
      presentationText: 'Private presentation',
      createdAt: instant,
    })).resolves.toMatchObject({
      status: 'created',
      record: {
        status: 'pending',
        runExecutionOriginAttempt: 1,
      },
    });
    expect(insertBindings).not.toContain('private-recipient');
    expect(insertBindings).not.toContain('Private presentation');
    const ownerQuery = queries.find(
      (sql) => sql.includes('JOIN conversation_turns AS turn'),
    );
    expect(ownerQuery).toContain("turn.role = 'assistant'");
    expect(ownerQuery).toContain('turn.session_id = run.session_id');
    expect(ownerQuery).toContain('turn.channel = $5');
    expect(ownerQuery).toContain('run.channel = $5');
    expect(ownerQuery).toContain('run.assistant_turn_id = $4');
    expect(ownerQuery).toContain(
      'clock_timestamp() < run.execution_lease_expires_at',
    );
  });

  it.each([
    ['same-session wrong assistant turn', 'messenger', 'assistant-turn-2'],
    ['cross-channel assistant turn', 'zalo', 'assistant-turn-1'],
  ] as const)(
    'rejects %s before delivery persistence',
    async (_caseName, channel, assistantTurnId) => {
      const queries: string[] = [];
      const client = scriptedClient(async (sql) => {
        queries.push(sql);
        if (sql === 'BEGIN' || sql === 'COMMIT') return emptyResult();
        if (sql.includes('SELECT session_id FROM agent_runs')) {
          return result({ session_id: 'messenger:session' });
        }
        if (sql.includes('pg_advisory_xact_lock')) return emptyResult();
        if (sql.includes('FROM session_controls')) return emptyResult();
        if (sql.includes('JOIN conversation_turns AS turn')) {
          return emptyResult();
        }
        throw new Error(`unexpected_query:${sql}`);
      });
      const store = new PostgresStore(poolFor(client) as never);

      await expect(store.createAgentRunTextDelivery({
        execution: execution(1, 'execution-token-1'),
        channel,
        assistantTurnId,
        recipientId: 'private-recipient',
        presentationText: 'Private presentation',
        createdAt: instant,
      })).resolves.toEqual({ status: 'stale' });
      expect(
        queries.some((sql) =>
          sql.includes('INSERT INTO agent_run_text_deliveries')),
      ).toBe(false);
    },
  );

  it('reconstructs complete opaque attempt history in order', async () => {
    const row = deliveryRow({
      status: 'confirmed_not_sent',
      delivery_attempt: 3,
      delivery_attempt_token: 'delivery-token-3',
      outcome_code: 'provider_rejected',
    });
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM agent_run_text_deliveries')) {
        return { rows: [row], rowCount: 1 };
      }
      if (sql.includes('FROM agent_run_text_delivery_attempts')) {
        return {
          rows: [
            { delivery_attempt_token: 'delivery-token-1' },
            { delivery_attempt_token: 'delivery-token-2' },
          ],
          rowCount: 2,
        };
      }
      throw new Error(`unexpected_query:${sql}`);
    });
    const store = new PostgresStore({ query } as never);

    await expect(store.getAgentRunTextDelivery(row.run_id)).resolves
      .toMatchObject({
        status: 'confirmed_not_sent',
        priorDeliveryAttemptTokens: [
          'delivery-token-1',
          'delivery-token-2',
        ],
      });
  });

  it('accepts exact provider completion after lease expiry and atomically completes the run', async () => {
    const row = deliveryRow();
    const completedRun = agentRunRow({
      status: 'completed',
      delivery_status: 'sent',
      delivery_external_message_id: 'provider-message-1',
      completed_at: later,
      updated_at: later,
    });
    const queries: string[] = [];
    const client = scriptedClient(async (sql) => {
      queries.push(sql);
      if (sql === 'BEGIN' || sql === 'COMMIT') return emptyResult();
      if (sql.includes('FROM agent_run_text_deliveries')) {
        return result(row);
      }
      if (sql.includes('FROM agent_run_text_delivery_attempts')) {
        return emptyResult();
      }
      if (sql.includes('SELECT id') && sql.includes('FROM agent_runs')) {
        return result({ id: row.run_id });
      }
      if (sql.includes('UPDATE agent_run_text_deliveries')) {
        return affected();
      }
      if (sql.includes('UPDATE agent_runs')) return result(completedRun);
      throw new Error(`unexpected_query:${sql}`);
    });
    const store = new PostgresStore(poolFor(client) as never);

    await expect(store.completeAgentRunTextDeliveryAttempt({
      execution: {
        runId: row.run_id,
        executionAttempt: 1,
        executionLeaseToken: 'execution-token-1',
      },
      deliveryAttempt: 1,
      deliveryAttemptToken: 'delivery-token-1',
      outcome: {
        status: 'confirmed_sent',
        messageId: 'provider-message-1',
      },
      updatedAt: later,
    })).resolves.toMatchObject({
      status: 'transitioned',
      record: {
        status: 'confirmed_sent',
        providerMessageId: 'provider-message-1',
      },
    });
    const runCompletion = queries.find(
      (sql) => sql.includes('UPDATE agent_runs'),
    );
    expect(runCompletion).not.toContain('execution_lease_expires_at');
    const runLockIndex = queries.findIndex(
      (sql) =>
        sql.includes('SELECT id') &&
        sql.includes('FROM agent_runs') &&
        sql.includes('FOR UPDATE'),
    );
    const deliveryLockIndex = queries.findIndex(
      (sql) =>
        sql.includes('FROM agent_run_text_deliveries') &&
        sql.includes('FOR UPDATE'),
    );
    expect(runLockIndex).toBeGreaterThanOrEqual(0);
    expect(deliveryLockIndex).toBeGreaterThan(runLockIndex);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('requires an exact-next execution rebind before retrying confirmed-not-sent', async () => {
    const row = storageRow(await rejectedDelivery());
    const queries: string[] = [];
    const client = scriptedClient(async (sql) => {
      queries.push(sql);
      if (sql === 'BEGIN' || sql === 'COMMIT') return emptyResult();
      if (sql.includes('SELECT session_id FROM agent_runs')) {
        return result({ session_id: 'messenger:session' });
      }
      if (sql.includes('pg_advisory_xact_lock')) return emptyResult();
      if (sql.includes('FROM session_controls')) return emptyResult();
      if (sql.includes('JOIN session_agent_state AS state')) {
        return result({ id: row.run_id });
      }
      if (sql.includes('FROM agent_run_text_deliveries')) {
        return result(row);
      }
      if (sql.includes('FROM agent_run_text_delivery_attempts')) {
        return emptyResult();
      }
      throw new Error(`unexpected_query:${sql}`);
    });
    const store = new PostgresStore(poolFor(client) as never);

    await expect(store.beginAgentRunTextDeliveryAttempt({
      execution: execution(1, 'execution-token-1'),
      nextDeliveryAttempt: 2,
      deliveryAttemptToken: 'delivery-token-2',
      updatedAt: later,
    })).resolves.toEqual({
      status: 'dispatch_blocked',
      reason: 'execution_rebind_required',
    });
    expect(
      queries.some((sql) => sql.includes(
        'INSERT INTO agent_run_text_delivery_attempts',
      )),
    ).toBe(false);
    expect(
      queries.some((sql) => sql.includes(
        'UPDATE agent_run_text_deliveries',
      )),
    ).toBe(false);
  });

  it('preserves null dispatch lineage across a pending rebind, then blocks confirmed-not-sent retry on that same execution', async () => {
    const pending = await createPendingAgentRunTextDelivery({
      execution: execution(1, 'execution-token-1'),
      channel: 'messenger',
      assistantTurnId: 'assistant-turn-1',
      recipientId: 'private-recipient',
      presentationText: 'Private presentation',
      createdAt: instant,
    });
    let stored = storageRow(pending);
    const deliveryUpdates: Array<{
      sql: string;
      bindings: readonly unknown[];
    }> = [];
    const attemptTokens = new Set<string>();
    const client = scriptedClient(async (sql, bindings = []) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return emptyResult();
      if (sql.includes('SELECT session_id FROM agent_runs')) {
        return result({ session_id: 'messenger:session' });
      }
      if (sql.includes('pg_advisory_xact_lock')) return emptyResult();
      if (sql.includes('FROM session_controls')) return emptyResult();
      if (sql.includes('JOIN session_agent_state AS state')) {
        return result({ id: stored.run_id });
      }
      if (sql.includes('SELECT id') && sql.includes('FROM agent_runs')) {
        return result({ id: stored.run_id });
      }
      if (sql.includes('FROM agent_run_text_deliveries')) {
        return result(stored);
      }
      if (sql.includes('FROM agent_run_text_delivery_attempts')) {
        return emptyResult();
      }
      if (sql.includes('INSERT INTO agent_run_text_delivery_attempts')) {
        const token = String(bindings[2]);
        if (attemptTokens.has(token)) return emptyResult();
        attemptTokens.add(token);
        return result({ run_id: stored.run_id });
      }
      if (sql.includes('UPDATE agent_run_text_deliveries')) {
        deliveryUpdates.push({ sql, bindings });
        stored = deliveryRowAfterWrite(stored, bindings);
        return affected();
      }
      throw new Error(`unexpected_query:${sql}`);
    });
    const store = new PostgresStore(poolFor(client) as never);

    await expect(store.createAgentRunTextDelivery({
      execution: execution(2, 'execution-token-2'),
      channel: 'messenger',
      assistantTurnId: 'assistant-turn-1',
      recipientId: 'private-recipient',
      presentationText: 'Private presentation',
      createdAt: later,
    })).resolves.toMatchObject({
      status: 'rebound',
      record: {
        runExecutionAttempt: 2,
        lastDeliveryRunExecutionAttempt: null,
        status: 'pending',
      },
    });
    await expect(store.beginAgentRunTextDeliveryAttempt({
      execution: execution(2, 'execution-token-2'),
      nextDeliveryAttempt: 1,
      deliveryAttemptToken: 'delivery-token-1',
      updatedAt: '2026-07-20T06:00:03.000Z',
    })).resolves.toMatchObject({
      status: 'dispatch_authorized',
      record: {
        runExecutionAttempt: 2,
        lastDeliveryRunExecutionAttempt: 2,
        status: 'sending',
      },
    });
    await expect(store.completeAgentRunTextDeliveryAttempt({
      execution: execution(2, 'execution-token-2'),
      deliveryAttempt: 1,
      deliveryAttemptToken: 'delivery-token-1',
      outcome: {
        status: 'confirmed_not_sent',
        errorCode: 'provider_rejected',
        message: 'Provider rejected before sending',
      },
      updatedAt: '2026-07-20T06:00:04.000Z',
    })).resolves.toMatchObject({
      status: 'transitioned',
      record: {
        runExecutionAttempt: 2,
        lastDeliveryRunExecutionAttempt: 2,
        status: 'confirmed_not_sent',
      },
    });
    await expect(store.beginAgentRunTextDeliveryAttempt({
      execution: execution(2, 'execution-token-2'),
      nextDeliveryAttempt: 2,
      deliveryAttemptToken: 'delivery-token-2',
      updatedAt: '2026-07-20T06:00:05.000Z',
    })).resolves.toEqual({
      status: 'dispatch_blocked',
      reason: 'execution_rebind_required',
    });

    expect(deliveryUpdates).toHaveLength(3);
    expect(deliveryUpdates.map(({ bindings }) => bindings[8]))
      .toEqual([null, 2, 2]);
    for (const { sql } of deliveryUpdates) {
      expect(sql).toContain(
        'last_delivery_run_execution_attempt = $9',
      );
      expect(sql).toContain(
        'last_delivery_run_execution_attempt\n' +
        '             IS NOT DISTINCT FROM $22',
      );
    }
    expect(attemptTokens).toEqual(new Set(['delivery-token-1']));
  });

  it('keeps the rebound head unchanged when another run already used the opaque token', async () => {
    const rebound = await reboundRejectedDelivery();
    const row = storageRow(rebound);
    const queries: string[] = [];
    const client = scriptedClient(async (sql) => {
      queries.push(sql);
      if (sql === 'BEGIN' || sql === 'COMMIT') return emptyResult();
      if (sql.includes('SELECT session_id FROM agent_runs')) {
        return result({ session_id: 'messenger:session' });
      }
      if (sql.includes('pg_advisory_xact_lock')) return emptyResult();
      if (sql.includes('FROM session_controls')) return emptyResult();
      if (sql.includes('JOIN session_agent_state AS state')) {
        return result({ id: row.run_id });
      }
      if (sql.includes('FROM agent_run_text_deliveries')) {
        return result(row);
      }
      if (sql.includes('FROM agent_run_text_delivery_attempts')) {
        return emptyResult();
      }
      if (sql.includes('INSERT INTO agent_run_text_delivery_attempts')) {
        return emptyResult();
      }
      throw new Error(`unexpected_query:${sql}`);
    });
    const store = new PostgresStore(poolFor(client) as never);

    await expect(store.beginAgentRunTextDeliveryAttempt({
      execution: execution(2, 'execution-token-2'),
      nextDeliveryAttempt: 2,
      deliveryAttemptToken: 'token-owned-by-another-run',
      updatedAt: '2026-07-20T06:00:03.000Z',
    })).resolves.toEqual({
      status: 'dispatch_blocked',
      reason: 'delivery_attempt_token_reused',
    });
    expect(
      queries.find((sql) =>
        sql.includes('INSERT INTO agent_run_text_delivery_attempts')),
    ).toContain('ON CONFLICT DO NOTHING');
    expect(
      queries.some((sql) =>
        sql.includes('UPDATE agent_run_text_deliveries')),
    ).toBe(false);
  });

  it('persists execution lineage on rebind and blocks A-B-A token reuse', async () => {
    const rejected = await rejectedDelivery();
    let stored = storageRow(rejected);
    const updates: Array<readonly unknown[]> = [];
    const currentExecution = {
      attempt: 2,
      token: 'execution-token-2',
    };
    const client = scriptedClient(async (sql, bindings = []) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return emptyResult();
      if (sql.includes('SELECT session_id FROM agent_runs')) {
        return result({ session_id: 'messenger:session' });
      }
      if (sql.includes('pg_advisory_xact_lock')) return emptyResult();
      if (sql.includes('FROM session_controls')) return emptyResult();
      if (sql.includes('JOIN session_agent_state AS state')) {
        return result({ id: stored.run_id });
      }
      if (sql.includes('FROM agent_run_text_deliveries')) {
        return result(stored);
      }
      if (sql.includes('FROM agent_run_text_delivery_attempts')) {
        return emptyResult();
      }
      if (sql.includes('UPDATE agent_run_text_deliveries')) {
        updates.push(bindings);
        stored = {
          ...stored,
          run_execution_attempt: Number(bindings[1]),
          run_execution_lease_token: String(bindings[2]),
          run_execution_lease_token_digest: String(bindings[3]),
          prior_run_execution_lease_token_digests:
            String(bindings[4]),
          delivery_binding_digest: String(bindings[5]),
          updated_at: String(bindings[12]),
        };
        return affected();
      }
      throw new Error(`unexpected_query:${sql}`);
    });
    const store = new PostgresStore(poolFor(client) as never);

    await expect(store.createAgentRunTextDelivery({
      execution: execution(
        currentExecution.attempt,
        currentExecution.token,
      ),
      channel: 'messenger',
      assistantTurnId: 'assistant-turn-1',
      recipientId: 'private-recipient',
      presentationText: 'Private presentation',
      createdAt: later,
    })).resolves.toMatchObject({
      status: 'rebound',
      record: {
        runExecutionOriginAttempt: 1,
        runExecutionAttempt: 2,
        priorRunExecutionLeaseTokenDigests: [
          rejected.runExecutionLeaseTokenDigest,
        ],
      },
    });
    expect(updates).toHaveLength(1);
    expect(JSON.parse(String(updates[0]?.[4]))).toEqual([
      rejected.runExecutionLeaseTokenDigest,
    ]);

    currentExecution.attempt = 3;
    currentExecution.token = 'execution-token-1';
    await expect(store.createAgentRunTextDelivery({
      execution: execution(
        currentExecution.attempt,
        currentExecution.token,
      ),
      channel: 'messenger',
      assistantTurnId: 'assistant-turn-1',
      recipientId: 'private-recipient',
      presentationText: 'Private presentation',
      createdAt: '2026-07-20T06:00:03.000Z',
    })).resolves.toMatchObject({
      status: 'conflict',
      record: { runExecutionAttempt: 2 },
    });
    expect(updates).toHaveLength(1);
  });

  it('suppresses only a stale pre-dispatch execution under the exact fence', async () => {
    const pending = await createPendingAgentRunTextDelivery({
      execution: execution(1, 'execution-token-1'),
      channel: 'messenger',
      assistantTurnId: 'assistant-turn-1',
      recipientId: 'private-recipient',
      presentationText: 'Private presentation',
      createdAt: instant,
    });
    const row = storageRow(pending);
    const staleRun = agentRunRow();
    const supersededRun = agentRunRow({
      status: 'superseded',
      delivery_status: 'suppressed',
      error_code: 'stale_agent_run',
      completed_at: later,
      updated_at: later,
    });
    const queries: string[] = [];
    const client = scriptedClient(async (sql) => {
      queries.push(sql);
      if (sql === 'BEGIN' || sql === 'COMMIT') return emptyResult();
      if (sql.includes('SELECT session_id FROM agent_runs')) {
        return result({ session_id: staleRun.session_id });
      }
      if (sql.includes('pg_advisory_xact_lock')) return emptyResult();
      if (sql.includes('FROM session_controls')) return emptyResult();
      if (
        sql.includes('FROM agent_runs') &&
        sql.includes('execution_attempt = $5')
      ) {
        return result(staleRun);
      }
      if (sql.includes('FROM agent_run_text_deliveries')) {
        return result(row);
      }
      if (sql.includes('FROM agent_run_text_delivery_attempts')) {
        return emptyResult();
      }
      if (sql.includes('FROM session_agent_state')) {
        return emptyResult();
      }
      if (sql.includes('UPDATE agent_runs')) {
        return result(supersededRun);
      }
      throw new Error(`unexpected_query:${sql}`);
    });
    const store = new PostgresStore(poolFor(client) as never);

    await expect(
      store.supersedeAgentRunExecutionIfNoLongerCurrent({
        sessionId: staleRun.session_id,
        fence: {
          kind: 'agent_run',
          runId: staleRun.id,
          generation: staleRun.generation,
          sessionAuthorityGeneration:
            staleRun.session_authority_generation,
          executionAttempt: staleRun.execution_attempt,
          executionLeaseToken: staleRun.execution_lease_token!,
        },
        errorMessage: 'owner changed',
        completedAt: later,
      }),
    ).resolves.toMatchObject({
      status: 'superseded',
      run: {
        status: 'superseded',
        deliveryStatus: 'suppressed',
      },
    });
    expect(
      queries.find((sql) => sql.includes('UPDATE agent_runs')),
    ).toContain("status = 'superseded'");
  });

  it('resets under the session fence before AgentRun delivery cascades', async () => {
    const queries: string[] = [];
    const client = scriptedClient(async (sql) => {
      queries.push(sql);
      if (sql === 'BEGIN' || sql === 'COMMIT') return emptyResult();
      if (sql.includes('pg_advisory_xact_lock')) return emptyResult();
      if (
        sql.includes('FROM session_controls') &&
        sql.includes('FOR UPDATE')
      ) {
        return result({
          session_id: 'messenger:session',
          agent_mode: 'ai_active',
          assigned_agent_id: null,
          session_authority_generation: 0,
          updated_at: instant,
        });
      }
      if (sql.includes('INSERT INTO confirmation_pause_sessions')) {
        return affected();
      }
      if (
        sql.includes('FROM confirmation_pause_sessions') &&
        sql.includes('FOR UPDATE')
      ) {
        return result({ generation: 0 });
      }
      if (
        sql.includes('UPDATE non_agent_text_deliveries') &&
        (
          sql.includes("SET status = 'outcome_unknown'") ||
          sql.includes("SET status = 'confirmed_not_sent'")
        )
      ) {
        return affected();
      }
      if (
        sql.includes('SELECT (') &&
        sql.includes('FROM irreversible_operations') &&
        sql.includes('FROM non_agent_text_deliveries') &&
        sql.includes('AS unresolved')
      ) {
        return result({ unresolved: false });
      }
      if (sql.includes('UPDATE confirmation_pause_sessions')) {
        return affected();
      }
      if (
        sql.includes('WITH session_customer_runs AS') &&
        sql.includes('DELETE FROM agent_runs WHERE session_id = $1')
      ) {
        return affected();
      }
      if (
        sql.includes('INSERT INTO session_controls') &&
        sql.includes('RETURNING *')
      ) {
        return result({
          session_id: 'messenger:session',
          agent_mode: 'ai_active',
          assigned_agent_id: null,
          session_authority_generation: 1,
          updated_at: later,
        });
      }
      throw new Error(`unexpected_query:${sql}`);
    });
    const store = new PostgresStore(poolFor(client) as never);

    await expect(store.resetSession('messenger:session')).resolves
      .toMatchObject({ sessionAuthorityGeneration: 1 });
    const authorityLockIndex = queries.findIndex((sql) =>
      sql.includes('pg_advisory_xact_lock'));
    const runDeleteIndex = queries.findIndex((sql) =>
      sql.includes('DELETE FROM agent_runs WHERE session_id = $1'));
    const expiredSendingReconciliationIndex = queries.findIndex(
      (sql) =>
        sql.includes('UPDATE non_agent_text_deliveries') &&
        sql.includes("SET status = 'outcome_unknown'"),
    );
    const pendingAbandonmentIndex = queries.findIndex(
      (sql) =>
        sql.includes('UPDATE non_agent_text_deliveries') &&
        sql.includes("SET status = 'confirmed_not_sent'"),
    );
    const commitIndex = queries.indexOf('COMMIT');
    expect(authorityLockIndex).toBeGreaterThan(queries.indexOf('BEGIN'));
    expect(expiredSendingReconciliationIndex).toBeGreaterThan(
      authorityLockIndex,
    );
    expect(pendingAbandonmentIndex).toBeGreaterThan(
      expiredSendingReconciliationIndex,
    );
    expect(runDeleteIndex).toBeGreaterThan(authorityLockIndex);
    expect(runDeleteIndex).toBeGreaterThan(pendingAbandonmentIndex);
    expect(commitIndex).toBeGreaterThan(runDeleteIndex);
  });

  it('quarantines expired sending before execution reclaim', async () => {
    const row = deliveryRow();
    const reconciledRun = agentRunRow({
      status: 'reconciliation_required',
      delivery_status: 'outcome_unknown',
      error_code: 'agent_run_delivery_outcome_unknown',
      completed_at: later,
      updated_at: later,
    });
    const client = scriptedClient(async (sql) => {
      if (
        sql.includes('FROM agent_runs AS run') &&
        sql.includes('execution_lease_expires_at <= clock_timestamp()')
      ) {
        return result({
          id: row.run_id,
          execution_attempt: row.run_execution_attempt,
          execution_lease_token: row.run_execution_lease_token,
        });
      }
      if (sql.includes('FROM agent_run_text_deliveries')) {
        return result(row);
      }
      if (sql.includes('FROM agent_run_text_delivery_attempts')) {
        return emptyResult();
      }
      if (sql.includes('UPDATE agent_run_text_deliveries')) {
        return affected();
      }
      if (sql.includes('UPDATE agent_runs')) return result(reconciledRun);
      throw new Error(`unexpected_query:${sql}`);
    });

    await expect(reconcileExpiredPostgresAgentRunTextDelivery({
      client: client as never,
      runId: row.run_id,
      sessionId: 'messenger:session',
      generation: 1,
      sessionAuthorityGeneration: 0,
      reconciledAt: later,
    })).resolves.toMatchObject({
      status: 'reconciliation_required',
      reason: 'delivery_outcome_unknown',
      run: {
        status: 'reconciliation_required',
        deliveryStatus: 'outcome_unknown',
      },
    });
  });
});

function deliveryRow(
  patch: Partial<AgentRunTextDeliveryStorageRow> = {},
): AgentRunTextDeliveryStorageRow {
  return {
    schema_version: 'kfc-agent-run-text-delivery-v1',
    run_id: 'run-1',
    run_execution_attempt: 1,
    run_execution_origin_attempt: 1,
    run_execution_lease_token: 'execution-token-1',
    run_execution_lease_token_digest: '4'.repeat(64),
    prior_run_execution_lease_token_digests: [],
    channel: 'messenger',
    assistant_turn_id: 'assistant-turn-1',
    recipient_binding_digest: '1'.repeat(64),
    presentation_binding_digest: '2'.repeat(64),
    delivery_binding_digest: '3'.repeat(64),
    status: 'sending',
    delivery_attempt: 1,
    delivery_attempt_token: 'delivery-token-1',
    provider_message_id: null,
    outcome_code: null,
    created_at: instant,
    updated_at: instant,
    ...patch,
    last_delivery_run_execution_attempt:
      patch.last_delivery_run_execution_attempt === undefined
        ? 1
        : patch.last_delivery_run_execution_attempt,
  };
}

function agentRunRow(patch: Partial<AgentRunRow> = {}): AgentRunRow {
  return {
    id: 'run-1',
    session_id: 'messenger:session',
    generation: 1,
    session_authority_generation: 0,
    channel: 'messenger',
    external_user_id: 'customer',
    status: 'running',
    execution_attempt: 1,
    execution_lease_token: 'execution-token-1',
    execution_lease_expires_at: '2026-07-20T06:00:01.000Z',
    coalesced_input_text: 'hello',
    superseded_by_run_id: null,
    irreversible_side_effect_at: null,
    irreversible_tool_name: null,
    assistant_turn_id: 'assistant-turn-1',
    delivery_status: 'pending',
    delivery_external_message_id: null,
    error_code: null,
    error_message: null,
    scheduled_at: instant,
    started_at: instant,
    completed_at: null,
    updated_at: instant,
    ...patch,
  };
}

function scriptedClient(
  operation: (
    sql: string,
    bindings?: readonly unknown[],
  ) => Promise<unknown>,
) {
  return {
    query: vi.fn((
      sql: string,
      bindings?: readonly unknown[],
    ) => operation(sql, bindings)),
    release: vi.fn(),
  };
}

function poolFor(client: ReturnType<typeof scriptedClient>) {
  return {
    query: client.query,
    connect: vi.fn(async () => client),
  };
}

function result<Row>(row: Row) {
  return { rows: [row], rowCount: 1 };
}

function affected() {
  return { rows: [], rowCount: 1 };
}

function emptyResult() {
  return { rows: [], rowCount: 0 };
}

function execution(executionAttempt: number, executionLeaseToken: string) {
  return {
    runId: 'run-1',
    executionAttempt,
    executionLeaseToken,
  };
}

async function rejectedDelivery(): Promise<AgentRunTextDeliveryRecord> {
  const pending = await createPendingAgentRunTextDelivery({
    execution: execution(1, 'execution-token-1'),
    channel: 'messenger',
    assistantTurnId: 'assistant-turn-1',
    recipientId: 'private-recipient',
    presentationText: 'Private presentation',
    createdAt: instant,
  });
  const begun = beginAgentRunTextDeliveryAttempt(pending, {
    execution: execution(1, 'execution-token-1'),
    nextDeliveryAttempt: 1,
    deliveryAttemptToken: 'delivery-token-1',
    updatedAt: instant,
  });
  if (begun.status !== 'dispatch_authorized') {
    throw new Error(`fixture_begin_failed:${begun.reason}`);
  }
  const completed = completeAgentRunTextDeliveryAttempt(begun.record, {
    execution: execution(1, 'execution-token-1'),
    deliveryAttempt: 1,
    deliveryAttemptToken: 'delivery-token-1',
    outcome: {
      status: 'confirmed_not_sent',
      errorCode: 'provider_rejected',
      message: 'Provider rejected before sending',
    },
    updatedAt: instant,
  });
  if (completed.status !== 'transitioned') {
    throw new Error(`fixture_completion_failed:${completed.reason}`);
  }
  return completed.record;
}

async function reboundRejectedDelivery(): Promise<AgentRunTextDeliveryRecord> {
  const rejected = await rejectedDelivery();
  const rebound = await rebindRetryableAgentRunTextDelivery(rejected, {
    execution: execution(2, 'execution-token-2'),
    channel: 'messenger',
    assistantTurnId: 'assistant-turn-1',
    recipientId: 'private-recipient',
    presentationText: 'Private presentation',
    updatedAt: later,
  });
  if (rebound.status !== 'rebound') {
    throw new Error(`fixture_rebind_failed:${rebound.reason}`);
  }
  return rebound.record;
}

function storageRow(
  record: AgentRunTextDeliveryRecord,
): AgentRunTextDeliveryStorageRow {
  return {
    schema_version: record.schemaVersion,
    run_id: record.runId,
    run_execution_attempt: record.runExecutionAttempt,
    run_execution_origin_attempt: record.runExecutionOriginAttempt,
    run_execution_lease_token: record.runExecutionLeaseToken,
    run_execution_lease_token_digest:
      record.runExecutionLeaseTokenDigest,
    prior_run_execution_lease_token_digests:
      record.priorRunExecutionLeaseTokenDigests,
    channel: record.channel,
    assistant_turn_id: record.assistantTurnId,
    recipient_binding_digest: record.recipientBindingDigest,
    presentation_binding_digest: record.presentationBindingDigest,
    delivery_binding_digest: record.deliveryBindingDigest,
    status: record.status,
    delivery_attempt: record.deliveryAttempt,
    last_delivery_run_execution_attempt:
      record.lastDeliveryRunExecutionAttempt,
    delivery_attempt_token: record.deliveryAttemptToken,
    provider_message_id: record.providerMessageId,
    outcome_code: record.outcomeCode,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
}

function deliveryRowFromBindings(
  bindings: readonly unknown[],
): AgentRunTextDeliveryStorageRow {
  return {
    schema_version: String(bindings[0]),
    run_id: String(bindings[1]),
    run_execution_attempt: Number(bindings[2]),
    run_execution_origin_attempt: Number(bindings[3]),
    run_execution_lease_token: String(bindings[4]),
    run_execution_lease_token_digest: String(bindings[5]),
    prior_run_execution_lease_token_digests: String(bindings[6]),
    channel: bindings[7] as 'messenger' | 'zalo',
    assistant_turn_id: String(bindings[8]),
    recipient_binding_digest: String(bindings[9]),
    presentation_binding_digest: String(bindings[10]),
    delivery_binding_digest: String(bindings[11]),
    status: bindings[12] as AgentRunTextDeliveryRecord['status'],
    delivery_attempt: Number(bindings[13]),
    last_delivery_run_execution_attempt:
      bindings[14] === null ? null : Number(bindings[14]),
    delivery_attempt_token:
      bindings[15] === null ? null : String(bindings[15]),
    provider_message_id:
      bindings[16] === null ? null : String(bindings[16]),
    outcome_code:
      bindings[17] === null ? null : String(bindings[17]),
    created_at: String(bindings[18]),
    updated_at: String(bindings[19]),
  };
}

function deliveryRowAfterWrite(
  existing: AgentRunTextDeliveryStorageRow,
  bindings: readonly unknown[],
): AgentRunTextDeliveryStorageRow {
  return {
    ...existing,
    run_execution_attempt: Number(bindings[1]),
    run_execution_lease_token: String(bindings[2]),
    run_execution_lease_token_digest: String(bindings[3]),
    prior_run_execution_lease_token_digests: String(bindings[4]),
    delivery_binding_digest: String(bindings[5]),
    status: bindings[6] as AgentRunTextDeliveryRecord['status'],
    delivery_attempt: Number(bindings[7]),
    last_delivery_run_execution_attempt:
      bindings[8] === null ? null : Number(bindings[8]),
    delivery_attempt_token:
      bindings[9] === null ? null : String(bindings[9]),
    provider_message_id:
      bindings[10] === null ? null : String(bindings[10]),
    outcome_code:
      bindings[11] === null ? null : String(bindings[11]),
    updated_at: String(bindings[12]),
  };
}
