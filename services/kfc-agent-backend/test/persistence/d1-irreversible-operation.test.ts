import { expect, it } from 'vitest';
import { D1Store } from '../../src/persistence/d1Store.js';
import { FakeD1Database } from '../support/fakeD1Database.js';

it('atomically reserves and replays one irreversible operation result', async () => {
  const store = new D1Store(new FakeD1Database());
  await store.initialize();
  const operation = {
    requestId: 'confirmation-1',
    sessionId: 'session-1',
    operation: 'placeOrder',
    bindingFingerprint: 'binding-1',
  };

  expect(await store.reserveIrreversibleOperation(operation)).toEqual({
    status: 'reserved', attempt: 1, reconciliation: false,
  });
  expect(await store.reserveIrreversibleOperation(operation)).toEqual({ status: 'pending' });
  await store.completeIrreversibleOperation(operation, { ok: true, message: 'placed', value: { id: 'order-1' } });
  expect(await store.reserveIrreversibleOperation(operation)).toEqual({
    status: 'completed',
    result: { ok: true, message: 'placed', value: { id: 'order-1' } },
  });
  await expect(store.reserveIrreversibleOperation({ ...operation, bindingFingerprint: 'changed' }))
    .rejects.toThrow('binding conflict');
});
