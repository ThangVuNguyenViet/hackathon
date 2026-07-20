import type { Pool, PoolClient, QueryResult } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { PostgresStore } from '../../src/persistence/postgresStore.js';
import { resetPostgresSession } from '../../src/persistence/postgresStoreSessionReset.js';

interface QueryLog {
  text: string;
  values: readonly unknown[];
}

function postgresHarness(unresolved: boolean) {
  const queries: QueryLog[] = [];
  const query = vi.fn(
    async (text: string, values: readonly unknown[] = []) => {
      queries.push({ text, values });
      if (
        text.includes('SELECT *') &&
        text.includes('FROM session_controls')
      ) {
        return result([{
          session_id: 'messenger:reset-me',
          agent_mode: 'human_paused',
          assigned_agent_id: 'agent-1',
          session_authority_generation: 4,
          updated_at: '2026-07-20T00:00:00.000Z',
        }]);
      }
      if (text.includes('AS unresolved')) {
        return result([{ unresolved }]);
      }
      if (
        text.includes('INSERT INTO session_controls') &&
        text.includes('RETURNING *')
      ) {
        return result([{
          session_id: 'messenger:reset-me',
          agent_mode: 'ai_active',
          assigned_agent_id: null,
          session_authority_generation: 5,
          updated_at: '2026-07-20T00:00:01.000Z',
        }]);
      }
      return result([]);
    },
  );
  const client = {
    query,
    release: vi.fn(),
  } as unknown as PoolClient;
  const db = {
    connect: vi.fn(async () => client),
    query,
  } as unknown as Pool;
  return { db, client, queries };
}

function result(rows: Record<string, unknown>[]): QueryResult {
  return {
    command: '',
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows,
  };
}

describe('Postgres session reset non-agent delivery fence', () => {
  it('rolls back before destructive reset when a publication is unresolved', async () => {
    const harness = postgresHarness(true);

    await expect(
      resetPostgresSession({
        db: harness.db,
        sessionId: 'messenger:reset-me',
      }),
    ).rejects.toMatchObject({ code: 'session_reset_conflict' });

    const unresolvedQuery = harness.queries.find((entry) =>
      entry.text.includes('AS unresolved')
    )?.text;
    expect(unresolvedQuery).toContain(
      'FROM non_agent_text_deliveries',
    );
    expect(unresolvedQuery).toContain("status = 'sending'");
    expect(harness.queries.map((entry) => entry.text)).toContain('ROLLBACK');
    expect(
      harness.queries.some((entry) =>
        entry.text.includes('DELETE FROM conversation_turns')
      ),
    ).toBe(false);
  });

  it('abandons pending, reconciles expired sending, and preserves dedicated journals', async () => {
    const harness = postgresHarness(false);

    await expect(
      resetPostgresSession({
        db: harness.db,
        sessionId: 'messenger:reset-me',
      }),
    ).resolves.toMatchObject({
      agentMode: 'ai_active',
      sessionAuthorityGeneration: 5,
    });

    const resetQuery = harness.queries.find((entry) =>
      entry.text.includes('deleted_deliveries AS')
    )?.text;
    expect(resetQuery).toContain('DELETE FROM webhook_deliveries');
    expect(resetQuery).not.toContain('non_agent_text_deliveries');
    expect(harness.queries.some((entry) =>
      entry.text.includes("SET status = 'outcome_unknown'") &&
      entry.text.includes(
        "'non_agent_delivery_reset_sending_lease_expired'",
      )
    )).toBe(true);
    expect(harness.queries.some((entry) =>
      entry.text.includes("SET status = 'confirmed_not_sent'") &&
      entry.text.includes(
        "'non_agent_delivery_abandoned_by_reset'",
      )
    )).toBe(true);
    expect(harness.queries.some((entry) =>
      entry.text.includes('DELETE FROM non_agent_text_deliveries') ||
      entry.text.includes('DELETE FROM non_agent_text_delivery_attempts')
    )).toBe(false);
    expect(
      resetQuery,
    ).toContain(
      'DELETE FROM webhook_deliveries\n         WHERE session_id = $1',
    );
    expect(harness.queries.map((entry) => entry.text)).toContain('COMMIT');
  });

  it('serializes a losing reservation behind reset and rejects its stale generation', async () => {
    const harness = orderedPostgresHarness();
    const store = new PostgresStore(harness.db);
    const reset = store.resetSession('messenger:reset-me');
    await harness.resetPaused;

    let reservationSettled = false;
    const reservation = store.reserveNonAgentTextDelivery({
      requestKey: 'a'.repeat(64),
      sessionId: 'messenger:reset-me',
      expectedSessionAuthorityGeneration: 1,
      expectedAgentId: 'agent-1',
      channel: 'messenger',
      assistantTurnId: 'turn_human_race',
      recipientId: 'recipient-race',
      presentationText: 'hello after reset',
      createdAt: '2026-07-20T00:00:00.000Z',
    }).finally(() => {
      reservationSettled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reservationSettled).toBe(false);

    harness.continueReset();
    await expect(reset).resolves.toMatchObject({
      agentMode: 'ai_active',
      sessionAuthorityGeneration: 2,
    });
    await expect(reservation).resolves.toEqual({
      status: 'stale_authority',
    });
    expect(harness.deliveryRows).toEqual([]);
  });
});

function orderedPostgresHarness() {
  let control: Record<string, unknown> = {
    session_id: 'messenger:reset-me',
    agent_mode: 'human_paused',
    assigned_agent_id: 'agent-1',
    session_authority_generation: 1,
    updated_at: '2026-07-20T00:00:00.000Z',
  };
  const deliveryRows: Record<string, unknown>[] = [];
  let lockOwner: number | undefined;
  const lockWaiters: Array<() => void> = [];
  let continueReset: () => void = () => undefined;
  let noteResetPaused: () => void = () => undefined;
  const resetPaused = new Promise<void>((resolve) => {
    noteResetPaused = resolve;
  });
  const resetContinuation = new Promise<void>((resolve) => {
    continueReset = resolve;
  });
  let nextClientId = 0;

  const connect = vi.fn(async () => {
    const clientId = ++nextClientId;
    let ownsLock = false;
    const releaseLock = () => {
      if (!ownsLock) return;
      ownsLock = false;
      lockOwner = undefined;
      lockWaiters.shift()?.();
    };
    const query = vi.fn(
      async (text: string, values: readonly unknown[] = []) => {
        if (text.includes('pg_advisory_xact_lock')) {
          if (lockOwner !== undefined) {
            await new Promise<void>((resolve) => lockWaiters.push(resolve));
          }
          lockOwner = clientId;
          ownsLock = true;
          return result([]);
        }
        if (text === 'COMMIT' || text === 'ROLLBACK') {
          releaseLock();
          return result([]);
        }
        if (
          text.includes('FROM non_agent_text_deliveries') &&
          text.includes('FOR UPDATE')
        ) {
          return result([]);
        }
        if (
          text.includes('SELECT *') &&
          text.includes('FROM session_controls')
        ) {
          return result([control]);
        }
        if (text.includes('AS unresolved')) {
          return result([{ unresolved: false }]);
        }
        if (
          clientId === 1 &&
          text.includes('UPDATE confirmation_pause_sessions')
        ) {
          noteResetPaused();
          await resetContinuation;
          return result([]);
        }
        if (
          text.includes('INSERT INTO session_controls') &&
          text.includes('RETURNING *')
        ) {
          control = {
            ...control,
            agent_mode: 'ai_active',
            assigned_agent_id: null,
            session_authority_generation: Number(values[1]),
            updated_at: String(values[2]),
          };
          return result([control]);
        }
        if (text.includes('INSERT INTO non_agent_text_deliveries')) {
          throw new Error('stale reservation must not insert');
        }
        return result([]);
      },
    );
    return {
      query,
      release: vi.fn(releaseLock),
    } as unknown as PoolClient;
  });
  return {
    db: { connect, query: vi.fn() } as unknown as Pool,
    deliveryRows,
    resetPaused,
    continueReset,
  };
}
