import { afterEach, expect, it, vi } from 'vitest';
import { D1Store } from '../../src/persistence/d1Store.js';
import { FakeD1Database } from '../support/fakeD1Database.js';

const fixedNow = '2026-07-20T00:00:00.000Z';

function leaseExpiration(db: FakeD1Database, requestId: string): string {
  const row = db.tables.irreversible_operations.find(
    (candidate) => candidate.request_id === requestId,
  );
  if (!row) throw new Error(`missing operation row: ${requestId}`);
  return String(row.lease_expires_at);
}

afterEach(() => {
  vi.useRealTimers();
});

it('uses the shared lease duration for D1 initial and reclaimed attempts', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(fixedNow);
  const db = new FakeD1Database();
  const store = new D1Store(db);
  await store.initialize();
  const operation = {
    requestId: 'shared-lease-duration',
    sessionId: 'session-shared-lease-duration',
    operation: 'placeOrder',
    bindingFingerprint: 'binding-shared-lease-duration',
  };

  await expect(store.reserveIrreversibleOperation(operation)).resolves
    .toMatchObject({ status: 'reserved', attempt: 1 });
  expect(leaseExpiration(db, operation.requestId)).toBe(
    '2026-07-20T00:01:00.000Z',
  );

  db.tables.irreversible_operations.find(
    (candidate) => candidate.request_id === operation.requestId,
  )!.lease_expires_at = '2026-07-19T23:59:59.999Z';
  vi.setSystemTime('2026-07-20T00:02:00.000Z');

  await expect(store.reserveIrreversibleOperation(operation)).resolves
    .toMatchObject({
      status: 'reserved',
      attempt: 2,
      reconciliation: true,
    });
  expect(leaseExpiration(db, operation.requestId)).toBe(
    '2026-07-20T00:03:00.000Z',
  );
});

it('keeps a nonzero-millisecond D1 lease current through 59,999 ms and stale at 60,000 ms', async () => {
  vi.useFakeTimers();
  vi.setSystemTime('2026-07-20T00:00:00.500Z');
  const db = new FakeD1Database();
  const store = new D1Store(db);
  await store.initialize();
  const operation = {
    requestId: 'millisecond-precision-lease',
    sessionId: 'session-millisecond-precision-lease',
    operation: 'placeOrder',
    bindingFingerprint: 'binding-millisecond-precision-lease',
  };
  const reservation = await store.reserveIrreversibleOperation(operation);
  if (reservation.status !== 'reserved') {
    throw new Error('expected millisecond-precision reservation owner');
  }
  const fence = {
    kind: 'operation_lease' as const,
    ...operation,
    attempt: reservation.attempt,
    leaseToken: reservation.leaseToken,
    sessionAuthorityGeneration:
      reservation.sessionAuthorityGeneration,
  };

  vi.advanceTimersByTime(59_999);
  await expect(store.isRunCommitFenceCurrent({
    sessionId: operation.sessionId,
    fence,
  })).resolves.toBe(true);

  vi.advanceTimersByTime(1);
  await expect(store.isRunCommitFenceCurrent({
    sessionId: operation.sessionId,
    fence,
  })).resolves.toBe(false);
});

it('uses millisecond-precision D1 comparisons for every irreversible-operation lease predicate', () => {
  const core = readFileSync('src/persistence/d1StoreCore.ts', 'utf8');
  const turnCommit = readFileSync(
    'src/persistence/d1StoreTurnCommit.ts',
    'utf8',
  );

  expect(core.match(
    /julianday\('now'\) (?:<|>=) julianday\(lease_expires_at\)/gu,
  ) ?? []).toHaveLength(3);
  expect(turnCommit).toContain(
    "julianday('now') < julianday(operation.lease_expires_at)",
  );
  expect(core).not.toMatch(
    /unixepoch\('now'\) (?:<|>=) unixepoch\(lease_expires_at\)/u,
  );
  expect(turnCommit).not.toContain(
    "unixepoch('now') < unixepoch(operation.lease_expires_at)",
  );
});

it('atomically reserves and replays one irreversible operation result', async () => {
  const db = new FakeD1Database();
  const store = new D1Store(db);
  await store.initialize();
  const operation = {
    requestId: 'confirmation-1',
    sessionId: 'session-1',
    operation: 'placeOrder',
    bindingFingerprint: 'binding-1',
  };

  const first = await store.reserveIrreversibleOperation(operation);
  expect(first).toMatchObject({ status: 'reserved', attempt: 1, reconciliation: false });
  if (first.status !== 'reserved') throw new Error('expected reservation owner');
  expect(await store.reserveIrreversibleOperation(operation)).toEqual({ status: 'pending' });
  await store.completeIrreversibleOperation(
    operation,
    {
      attempt: first.attempt,
      leaseToken: first.leaseToken,
      sessionAuthorityGeneration:
        first.sessionAuthorityGeneration,
    },
    { ok: true, message: 'placed', value: { id: 'order-1' } },
  );
  expect(await store.reserveIrreversibleOperation(operation)).toEqual({
    status: 'completed',
    result: { ok: true, message: 'placed', value: { id: 'order-1' } },
  });
  await expect(store.reserveIrreversibleOperation({ ...operation, bindingFingerprint: 'changed' }))
    .rejects.toThrow('binding conflict');

  const unknown = { ...operation, requestId: 'confirmation-unknown' };
  const unknownFirst = await store.reserveIrreversibleOperation(unknown);
  expect(unknownFirst).toMatchObject({ status: 'reserved', attempt: 1 });
  if (unknownFirst.status !== 'reserved') throw new Error('expected reservation owner');
  await store.failIrreversibleOperation(
    unknown,
    {
      attempt: unknownFirst.attempt,
      leaseToken: unknownFirst.leaseToken,
      sessionAuthorityGeneration:
        unknownFirst.sessionAuthorityGeneration,
    },
    'connection_lost_after_submit',
  );
  expect(await store.getIrreversibleOperation(unknown)).toEqual({
    status: 'unknown', lastError: 'connection_lost_after_submit',
  });
  expect(await store.reserveIrreversibleOperation(unknown)).toMatchObject({
    status: 'reserved', attempt: 2, reconciliation: true,
  });

  const crashed = { ...operation, requestId: 'confirmation-crashed' };
  const crashedFirst = await store.reserveIrreversibleOperation(crashed);
  if (crashedFirst.status !== 'reserved') throw new Error('expected first crash owner');
  db.tables.irreversible_operations.find((row) => row.request_id === crashed.requestId)!.lease_expires_at = '2000-01-01T00:00:00.000Z';
  const crashedSecond = await store.reserveIrreversibleOperation(crashed);
  expect(crashedSecond).toMatchObject({
    status: 'reserved', attempt: 2, reconciliation: true,
  });
  if (crashedSecond.status !== 'reserved') throw new Error('expected reconciliation owner');

  await store.failIrreversibleOperation(
    crashed,
    {
      attempt: crashedFirst.attempt,
      leaseToken: crashedFirst.leaseToken,
      sessionAuthorityGeneration:
        crashedFirst.sessionAuthorityGeneration,
    },
    'late attempt one failure',
  );
  expect(await store.completeIrreversibleOperation(
    crashed,
    {
      attempt: crashedFirst.attempt,
      leaseToken: crashedFirst.leaseToken,
      sessionAuthorityGeneration:
        crashedFirst.sessionAuthorityGeneration,
    },
    { ok: true, message: 'stale result' },
  )).toEqual({ status: 'lost' });
  expect(await store.getIrreversibleOperation(crashed)).toEqual({ status: 'pending' });
  expect(await store.reserveIrreversibleOperation(crashed)).toEqual({ status: 'pending' });

  expect(await store.completeIrreversibleOperation(
    crashed,
    {
      attempt: crashedSecond.attempt,
      leaseToken: crashedSecond.leaseToken,
      sessionAuthorityGeneration:
        crashedSecond.sessionAuthorityGeneration,
    },
    { ok: true, message: 'active result' },
  )).toEqual({ status: 'completed', result: { ok: true, message: 'active result' } });
  await store.failIrreversibleOperation(
    crashed,
    {
      attempt: crashedFirst.attempt,
      leaseToken: crashedFirst.leaseToken,
      sessionAuthorityGeneration:
        crashedFirst.sessionAuthorityGeneration,
    },
    'later stale failure',
  );
  expect(await store.getIrreversibleOperation(crashed)).toEqual({
    status: 'completed', result: { ok: true, message: 'active result' },
  });
});

it('adds lease fencing through an additive migration without rewriting migration 0009', () => {
  const original = readFileSync('migrations/0009_irreversible_operations.sql', 'utf8');
  const additive = readFileSync('migrations/0011_irreversible_operation_lease_fencing.sql', 'utf8');
  const initializer = readFileSync('src/persistence/d1StoreSupport.ts', 'utf8');

  expect(original).not.toContain('lease_token');
  expect(additive).toContain('ADD COLUMN lease_token');
  expect(additive).toContain("'legacy:' || request_id || ':' || attempt_count");
  expect(initializer).toContain('lease_token TEXT NOT NULL');
});
import { readFileSync } from 'node:fs';
