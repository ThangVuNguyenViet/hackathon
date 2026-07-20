import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import type {
  IrreversibleOperationInput,
  IrreversibleOperationOwner,
} from '../../src/persistence/contracts.js';

const fixedNow = '2026-07-20T00:00:00.000Z';
const sessionId = 'messenger:irreversible-authority';

function operation(
  requestId: string,
): IrreversibleOperationInput {
  return {
    requestId,
    sessionId,
    operation: 'placeOrder',
    bindingFingerprint: `binding:${requestId}`,
  };
}

async function reserveOwner(
  store: MemoryStore,
  input: IrreversibleOperationInput,
): Promise<IrreversibleOperationOwner> {
  const reservation =
    await store.reserveIrreversibleOperation(input);
  expect(reservation).toMatchObject({
    status: 'reserved',
    attempt: 1,
    reconciliation: false,
    sessionAuthorityGeneration: 0,
  });
  if (reservation.status !== 'reserved') {
    throw new Error('expected irreversible operation owner');
  }
  return {
    attempt: reservation.attempt,
    leaseToken: reservation.leaseToken,
    sessionAuthorityGeneration:
      reservation.sessionAuthorityGeneration,
  };
}

async function pauseThenResume(
  store: MemoryStore,
): Promise<void> {
  await expect(
    store.transitionSessionAuthority({
      sessionId,
      expectedGeneration: 0,
      agentMode: 'human_paused',
      assignedAgentId: 'support-agent-1',
      updatedAt: '2026-07-20T00:00:01.000Z',
    }),
  ).resolves.toMatchObject({
    status: 'transitioned',
    control: {
      agentMode: 'human_paused',
      sessionAuthorityGeneration: 1,
    },
  });
  await expect(
    store.transitionSessionAuthority({
      sessionId,
      expectedGeneration: 1,
      agentMode: 'ai_active',
      assignedAgentId: null,
      updatedAt: '2026-07-20T00:00:02.000Z',
    }),
  ).resolves.toMatchObject({
    status: 'transitioned',
    control: {
      agentMode: 'ai_active',
      sessionAuthorityGeneration: 2,
    },
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('MemoryStore irreversible-operation authority fencing', () => {
  it('does not reveal or replay a completed result after pause and resume advance the authority generation', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);
    const store = new MemoryStore();
    const input = operation('completed-before-takeover');
    const owner = await reserveOwner(store, input);
    const result = {
      ok: true,
      value: { orderId: 'order-old-authority' },
    };

    await expect(
      store.completeIrreversibleOperation(input, owner, result),
    ).resolves.toEqual({ status: 'completed', result });
    await expect(
      store.getIrreversibleOperation(input),
    ).resolves.toEqual({ status: 'completed', result });

    await pauseThenResume(store);

    await expect(
      store.getIrreversibleOperation(input),
    ).resolves.toBeUndefined();
    await expect(
      store.reserveIrreversibleOperation(input),
    ).rejects.toThrow('session_ai_authority_unavailable');
  });

  it('transitions an exact active expired attempt to outcome unknown only once', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);
    const store = new MemoryStore();
    const input = operation('expired-active-attempt');
    await reserveOwner(store, input);

    vi.advanceTimersByTime(30_001);

    await expect(
      store.markIrreversibleOperationOutcomeUnknownIfExpired({
        ...input,
        reason: 'lease_expired_before_durable_outcome',
      }),
    ).resolves.toEqual({
      status: 'unknown',
      lastError: 'lease_expired_before_durable_outcome',
      transitioned: true,
    });
    await expect(
      store.markIrreversibleOperationOutcomeUnknownIfExpired({
        ...input,
        reason: 'must_not_replace_original_reason',
      }),
    ).resolves.toEqual({
      status: 'unknown',
      lastError: 'lease_expired_before_durable_outcome',
      transitioned: false,
    });
    await expect(
      store.getIrreversibleOperation(input),
    ).resolves.toEqual({
      status: 'unknown',
      lastError: 'lease_expired_before_durable_outcome',
    });
  });

  it('leaves an unexpired active attempt pending', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);
    const store = new MemoryStore();
    const input = operation('unexpired-active-attempt');
    await reserveOwner(store, input);

    vi.advanceTimersByTime(29_999);

    await expect(
      store.markIrreversibleOperationOutcomeUnknownIfExpired({
        ...input,
        reason: 'must_not_be_recorded',
      }),
    ).resolves.toEqual({ status: 'pending' });
    await expect(
      store.getIrreversibleOperation(input),
    ).resolves.toEqual({ status: 'pending' });
  });

  it('cannot transition an expired attempt during human pause or after authority advances', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);
    const store = new MemoryStore();
    const input = operation('expired-stale-authority');
    await reserveOwner(store, input);
    vi.advanceTimersByTime(30_001);

    await expect(
      store.transitionSessionAuthority({
        sessionId,
        expectedGeneration: 0,
        agentMode: 'human_paused',
        assignedAgentId: 'support-agent-1',
      }),
    ).resolves.toMatchObject({
      status: 'transitioned',
      control: { sessionAuthorityGeneration: 1 },
    });
    await expect(
      store.markIrreversibleOperationOutcomeUnknownIfExpired({
        ...input,
        reason: 'must_not_transition_while_paused',
      }),
    ).resolves.toEqual({ status: 'pending' });

    await expect(
      store.transitionSessionAuthority({
        sessionId,
        expectedGeneration: 1,
        agentMode: 'ai_active',
        assignedAgentId: null,
      }),
    ).resolves.toMatchObject({
      status: 'transitioned',
      control: { sessionAuthorityGeneration: 2 },
    });
    await expect(
      store.markIrreversibleOperationOutcomeUnknownIfExpired({
        ...input,
        reason: 'must_not_transition_under_new_authority',
      }),
    ).resolves.toEqual({ status: 'pending' });
    await expect(
      store.getIrreversibleOperation(input),
    ).resolves.toBeUndefined();
  });

  it('rejects stale completion and failure after an expired attempt becomes outcome unknown', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);
    const store = new MemoryStore();
    const input = operation('stale-owner-after-unknown');
    const owner = await reserveOwner(store, input);
    vi.advanceTimersByTime(30_001);

    await expect(
      store.markIrreversibleOperationOutcomeUnknownIfExpired({
        ...input,
        reason: 'lease_expired_without_outcome',
      }),
    ).resolves.toMatchObject({
      status: 'unknown',
      transitioned: true,
    });
    await expect(
      store.completeIrreversibleOperation(input, owner, {
        ok: true,
        value: { orderId: 'late-order' },
      }),
    ).resolves.toEqual({ status: 'lost' });
    await store.failIrreversibleOperation(
      input,
      owner,
      'late_attempt_failure',
    );
    await expect(
      store.getIrreversibleOperation(input),
    ).resolves.toEqual({
      status: 'unknown',
      lastError: 'lease_expired_without_outcome',
    });
  });
});
