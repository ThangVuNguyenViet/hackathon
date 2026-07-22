import { afterEach, expect, it, vi } from 'vitest';
import { reservePostgresIrreversibleOperation } from '../../src/persistence/postgresStoreIrreversibleOperations.js';
import type { IrreversibleOperationRow } from '../../src/persistence/postgresStoreSupport.js';

const operation = {
  requestId: 'postgres-shared-lease-duration',
  sessionId: 'postgres-shared-lease-session',
  operation: 'placeOrder',
  bindingFingerprint: 'postgres-shared-lease-binding',
};

function dateBinding(value: unknown): Date {
  if (!(value instanceof Date)) {
    throw new Error('expected Date query binding');
  }
  return value;
}

class ReservationPostgresClient {
  row: IrreversibleOperationRow | undefined;

  async query(query: string, bindings: unknown[] = []) {
    if (/^\s*(?:BEGIN|COMMIT|ROLLBACK)\s*$/u.test(query)) {
      return { rowCount: 0, rows: [] };
    }
    if (/pg_advisory_xact_lock/u.test(query)) {
      return { rowCount: 1, rows: [] };
    }
    if (/FROM session_controls/u.test(query)) {
      return { rowCount: 0, rows: [] };
    }
    if (/^\s*SELECT \*[\s\S]+FROM irreversible_operations/u.test(query)) {
      return {
        rowCount: this.row ? 1 : 0,
        rows: this.row ? [this.row] : [],
      };
    }
    if (/^\s*INSERT INTO irreversible_operations/u.test(query)) {
      this.row = {
        request_id: String(bindings[0]),
        session_id: String(bindings[1]),
        operation: String(bindings[2]),
        binding_fingerprint: String(bindings[3]),
        session_authority_generation: Number(bindings[4]),
        result_json: null,
        status: 'attempting',
        attempt_count: 1,
        lease_expires_at: dateBinding(bindings[5]),
        lease_token: String(bindings[6]),
        last_error: null,
      };
      return { rowCount: 1, rows: [this.row] };
    }
    if (/^\s*UPDATE irreversible_operations/u.test(query)) {
      if (!this.row) throw new Error('missing reclaim row');
      this.row = {
        ...this.row,
        status: 'attempting',
        attempt_count: this.row.attempt_count + 1,
        lease_expires_at: dateBinding(bindings[0]),
        lease_token: String(bindings[1]),
        last_error: null,
      };
      return { rowCount: 1, rows: [this.row] };
    }
    throw new Error(`unexpected query: ${query}`);
  }

  release() {}
}

class ReservationPostgres {
  readonly client = new ReservationPostgresClient();

  async connect() {
    return this.client;
  }
}

afterEach(() => {
  vi.useRealTimers();
});

it('uses the shared lease duration for PostgreSQL initial and reclaimed attempts', async () => {
  vi.useFakeTimers();
  vi.setSystemTime('2026-07-20T00:00:00.000Z');
  const db = new ReservationPostgres();
  // The production contract narrows to Queryable while runtime requires connect().
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const queryableDb = db as never;

  await expect(
    reservePostgresIrreversibleOperation({
      db: queryableDb,
      operation,
    }),
  ).resolves.toMatchObject({ status: 'reserved', attempt: 1 });
  expect(db.client.row?.lease_expires_at).toEqual(
    new Date('2026-07-20T00:01:00.000Z'),
  );

  db.client.row = {
    ...db.client.row!,
    status: 'unknown',
    lease_expires_at: null,
  };
  vi.setSystemTime('2026-07-20T00:02:00.000Z');

  await expect(
    reservePostgresIrreversibleOperation({
      db: queryableDb,
      operation,
    }),
  ).resolves.toMatchObject({
    status: 'reserved',
    attempt: 2,
    reconciliation: true,
  });
  expect(db.client.row?.lease_expires_at).toEqual(
    new Date('2026-07-20T00:03:00.000Z'),
  );
});
