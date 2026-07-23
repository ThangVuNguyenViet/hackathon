import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentRun } from '../../src/domain/types.js';
import {
  agentRunExecutionFence,
} from '../../src/persistence/agentRunExecutionLease.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';

const sessionId = 'messenger:execution-lease';
const leaseDurationMs = 1_000;
const leaseTokens = [
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003',
  '00000000-0000-4000-8000-000000000004',
] as const;

describe('AgentRun execution lease', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('blocks a concurrent owner while an execution lease is active', async () => {
    const { store, run } = await scheduledRun();
    const first = await claim(store, run, leaseTokens[0]);
    expect(first.status).toBe('claimed');

    const concurrent = await claim(store, run, leaseTokens[1]);
    expect(concurrent).toMatchObject({
      status: 'stale',
      reason: 'lease_active',
      run: {
        executionAttempt: 1,
        executionLeaseToken: leaseTokens[0],
      },
    });
  });

  it('reclaims only an expired pre-boundary run and rejects the late owner', async () => {
    const { store, run } = await scheduledRun();
    const first = await claim(store, run, leaseTokens[0]);
    if (first.status !== 'claimed') throw new Error('first_claim_failed');
    const firstFence = agentRunExecutionFence(first.run);

    vi.advanceTimersByTime(leaseDurationMs + 1);
    const second = await claim(store, run, leaseTokens[1]);
    expect(second).toMatchObject({
      status: 'claimed',
      run: {
        executionAttempt: 2,
        executionLeaseToken: leaseTokens[1],
        startedAt: first.run.startedAt,
      },
    });
    if (second.status !== 'claimed') throw new Error('reclaim_failed');

    await expect(
      store.updateAgentRunIfExecutionCurrent({
        sessionId,
        fence: firstFence,
        patch: {
          status: 'completed',
          irreversibleSideEffectAt: new Date().toISOString(),
          irreversibleToolName: 'placeOrder',
        },
      }),
    ).resolves.toMatchObject({
      status: 'stale',
      run: {
        status: 'running',
        executionAttempt: 2,
        irreversibleSideEffectAt: null,
        irreversibleToolName: null,
      },
    });
  });

  it('moves an expired post-irreversible run to reconciliation_required', async () => {
    const { store, run } = await scheduledRun();
    const first = await claim(store, run, leaseTokens[0]);
    if (first.status !== 'claimed') throw new Error('first_claim_failed');
    const firstFence = agentRunExecutionFence(first.run);
    await expect(
      store.updateAgentRunIfExecutionCurrent({
        sessionId,
        fence: firstFence,
        patch: {
          irreversibleSideEffectAt: new Date().toISOString(),
          irreversibleToolName: 'placeOrder',
        },
      }),
    ).resolves.toMatchObject({ status: 'committed' });

    vi.advanceTimersByTime(leaseDurationMs + 1);
    const recovery = await claim(store, run, leaseTokens[1]);
    expect(recovery).toMatchObject({
      status: 'reconciliation_required',
      reason: 'irreversible_outcome_unknown',
      run: {
        status: 'reconciliation_required',
        deliveryStatus: 'not_applicable',
        errorCode: 'agent_run_outcome_unknown',
        executionAttempt: 1,
        executionLeaseToken: leaseTokens[0],
        irreversibleToolName: 'placeOrder',
      },
    });

    await expect(
      store.updateAgentRunIfExecutionCurrent({
        sessionId,
        fence: firstFence,
        patch: {
          status: 'completed',
          irreversibleSideEffectAt: null,
          irreversibleToolName: null,
        },
      }),
    ).resolves.toMatchObject({
      status: 'stale',
      run: {
        status: 'reconciliation_required',
        irreversibleToolName: 'placeOrder',
      },
    });
  });

  it('allows three expired attempts then terminally exhausts execution', async () => {
    const { store, run } = await scheduledRun();
    for (let index = 0; index < 3; index += 1) {
      const result = await claim(store, run, leaseTokens[index]!);
      expect(result).toMatchObject({
        status: 'claimed',
        run: { executionAttempt: index + 1 },
      });
      vi.advanceTimersByTime(leaseDurationMs + 1);
    }

    const exhausted = await claim(store, run, leaseTokens[3]);
    expect(exhausted).toMatchObject({
      status: 'reconciliation_required',
      reason: 'attempts_exhausted',
      run: {
        status: 'reconciliation_required',
        executionAttempt: 3,
        errorCode: 'agent_run_execution_attempts_exhausted',
        deliveryStatus: 'not_applicable',
      },
    });
    const afterTerminal = await claim(store, run, leaseTokens[3]);
    expect(afterTerminal).toMatchObject({
      status: 'stale',
      reason: 'attempts_exhausted',
      run: { status: 'reconciliation_required', executionAttempt: 3 },
    });
  });
});

async function scheduledRun(): Promise<{
  store: MemoryStore;
  run: AgentRun;
}> {
  vi.useFakeTimers();
  vi.setSystemTime('2026-07-20T00:00:00.000Z');
  const store = new MemoryStore();
  const run = await store.createAgentRun({
    id: `run_${crypto.randomUUID()}`,
    sessionId,
    generation: 1,
    channel: 'messenger',
    externalUserId: 'execution-lease-customer',
    status: 'scheduled',
    coalescedInputText: 'One combo',
    deliveryStatus: 'pending',
    scheduledAt: new Date().toISOString(),
  });
  await store.setSessionAgentState({
    sessionId,
    currentRunId: run.id,
    generation: run.generation,
    debounceDeadlineAt: null,
  });
  return { store, run };
}

function claim(
  store: MemoryStore,
  run: AgentRun,
  token: string,
) {
  const claimedAt = new Date();
  return store.claimAgentRunExecution({
    runId: run.id,
    sessionId: run.sessionId,
    generation: run.generation,
    sessionAuthorityGeneration: run.sessionAuthorityGeneration,
    claimedAt: claimedAt.toISOString(),
    executionLeaseToken: token,
    executionLeaseExpiresAt: new Date(
      claimedAt.getTime() + leaseDurationMs,
    ).toISOString(),
  });
}
