import { expect, it } from 'vitest';
import { D1Store } from '../../src/persistence/d1Store.js';
import { FakeD1Database } from '../support/fakeD1Database.js';

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
    { attempt: first.attempt, leaseToken: first.leaseToken },
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
    { attempt: unknownFirst.attempt, leaseToken: unknownFirst.leaseToken },
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
    { attempt: crashedFirst.attempt, leaseToken: crashedFirst.leaseToken },
    'late attempt one failure',
  );
  expect(await store.completeIrreversibleOperation(
    crashed,
    { attempt: crashedFirst.attempt, leaseToken: crashedFirst.leaseToken },
    { ok: true, message: 'stale result' },
  )).toEqual({ status: 'lost' });
  expect(await store.getIrreversibleOperation(crashed)).toEqual({ status: 'pending' });
  expect(await store.reserveIrreversibleOperation(crashed)).toEqual({ status: 'pending' });

  expect(await store.completeIrreversibleOperation(
    crashed,
    { attempt: crashedSecond.attempt, leaseToken: crashedSecond.leaseToken },
    { ok: true, message: 'active result' },
  )).toEqual({ status: 'completed', result: { ok: true, message: 'active result' } });
  await store.failIrreversibleOperation(
    crashed,
    { attempt: crashedFirst.attempt, leaseToken: crashedFirst.leaseToken },
    'later stale failure',
  );
  expect(await store.getIrreversibleOperation(crashed)).toEqual({
    status: 'completed', result: { ok: true, message: 'active result' },
  });
});

it('adds lease fencing through an additive migration without rewriting migration 0009', () => {
  const original = readFileSync('migrations/0009_irreversible_operations.sql', 'utf8');
  const additive = readFileSync('migrations/0011_irreversible_operation_lease_fencing.sql', 'utf8');
  const initializer = readFileSync('src/persistence/d1Store.ts', 'utf8');

  expect(original).not.toContain('lease_token');
  expect(additive).toContain('ADD COLUMN lease_token');
  expect(additive).toContain("'legacy:' || request_id || ':' || attempt_count");
  expect(initializer).toContain('lease_token TEXT NOT NULL');
});
import { readFileSync } from 'node:fs';
