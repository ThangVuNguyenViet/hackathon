import { describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { PostgresStore } from '../../src/persistence/postgresStore.js';
import type { PendingCustomerTurnRow } from '../../src/persistence/postgresStoreSupport.js';

describe('PostgresStore pending customer turn ignored transition', () => {
  it('guards the update with pending, linked, failed, and current-run predicates', async () => {
    const pool = new Pool();
    const query = vi
      .spyOn(pool, 'query')
      .mockImplementation(async (sql, bindings) => {
        expect(bindings).toEqual(['pending-1', 'run-1']);
        expect(String(sql)).toContain("pending_turn.status = 'pending'");
        expect(String(sql)).toContain('pending_turn.claimed_run_id IS NULL');
        expect(String(sql)).toContain('run_turn.run_id = $2');
        expect(String(sql)).toContain("run.status = 'failed'");
        expect(String(sql)).toContain('state.current_run_id = run.id');
        expect(String(sql)).toContain('state.generation = run.generation');
        return {
          command: 'UPDATE',
          rowCount: 1,
          oid: 0,
          fields: [],
          rows: [pendingRow({ status: 'ignored', claimed_run_id: 'run-1' })],
        };
      });
    const store = new PostgresStore(pool);

    await expect(
      store.markPendingCustomerTurnIgnored('pending-1', 'run-1'),
    ).resolves.toMatchObject({
      status: 'ignored',
      claimedRunId: 'run-1',
    });
    expect(query).toHaveBeenCalledOnce();
  });

  it('returns the unchanged row when the compare-and-set does not apply', async () => {
    const pool = new Pool();
    let queryCount = 0;
    const query = vi.spyOn(pool, 'query').mockImplementation(async () => {
      queryCount += 1;
      return {
        command: 'SELECT',
        rowCount: queryCount === 1 ? 0 : 1,
        oid: 0,
        fields: [],
        rows:
          queryCount === 1
            ? []
            : [
                pendingRow({
                  status: 'claimed',
                  claimed_run_id: 'run-prior',
                }),
              ],
      };
    });
    const store = new PostgresStore(pool);

    await expect(
      store.markPendingCustomerTurnIgnored('pending-1', 'run-1'),
    ).resolves.toMatchObject({
      status: 'claimed',
      claimedRunId: 'run-prior',
    });
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1]).toEqual([
      expect.stringContaining('SELECT * FROM pending_customer_turns'),
      ['pending-1'],
    ]);
  });
});

function pendingRow(
  patch: Partial<PendingCustomerTurnRow> = {},
): PendingCustomerTurnRow {
  return {
    turn_id: 'pending-1',
    session_id: 'messenger:customer-1',
    channel: 'messenger',
    external_message_id: 'mid-1',
    external_user_id: 'customer-1',
    text: 'One combo',
    steer_mode: 'steering',
    status: 'pending',
    claimed_run_id: null,
    received_at: '2026-07-22T00:00:00.000Z',
    updated_at: '2026-07-22T00:00:00.000Z',
    ...patch,
  };
}
