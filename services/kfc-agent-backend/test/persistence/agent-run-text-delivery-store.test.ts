import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentRun } from '../../src/domain/types.js';
import {
  agentRunExecutionFence,
} from '../../src/persistence/agentRunExecutionLease.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';

const sessionId = 'messenger:delivery-store';
const start = '2026-07-20T06:00:00.000Z';
const leaseMs = 1_000;
const leaseTokens = [
  '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000102',
  '00000000-0000-4000-8000-000000000103',
] as const;

describe('MemoryStore durable AgentRun text delivery', () => {
  afterEach(() => vi.useRealTimers());

  it('persists a pending intent only for the current run assistant turn', async () => {
    const fixture = await runningFixture();

    await expect(fixture.store.createAgentRunTextDelivery({
      execution: fixture.execution,
      channel: 'messenger',
      assistantTurnId: fixture.assistantTurnId,
      recipientId: 'private-recipient',
      presentationText: 'Private presentation',
      createdAt: now(),
    })).resolves.toMatchObject({
      status: 'created',
      record: {
        status: 'pending',
        runId: fixture.run.id,
        priorDeliveryAttemptTokens: [],
      },
    });

    const unrelated = await fixture.store.appendTurn({
      sessionId: 'messenger:other-session',
      channel: 'messenger',
      role: 'assistant',
      text: 'Other session',
      externalMessageId: null,
      externalUserId: 'other',
      deliveryStatus: 'pending',
      metadata: null,
    });
    await expect(fixture.store.createAgentRunTextDelivery({
      execution: fixture.execution,
      channel: 'messenger',
      assistantTurnId: unrelated.id,
      recipientId: 'private-recipient',
      presentationText: 'Private presentation',
      createdAt: now(),
    })).resolves.toEqual({ status: 'stale' });

    const wrongAssistant = await fixture.store.appendTurn({
      sessionId,
      channel: 'messenger',
      role: 'assistant',
      text: 'Wrong assistant turn',
      externalMessageId: null,
      externalUserId: 'customer',
      deliveryStatus: 'pending',
      metadata: null,
    });
    await expect(fixture.store.createAgentRunTextDelivery({
      execution: fixture.execution,
      channel: 'messenger',
      assistantTurnId: wrongAssistant.id,
      recipientId: 'private-recipient',
      presentationText: 'Wrong assistant turn',
      createdAt: now(),
    })).resolves.toEqual({ status: 'stale' });

    const wrongChannel = await fixture.store.appendTurn({
      sessionId,
      channel: 'zalo',
      role: 'assistant',
      text: 'Wrong channel',
      externalMessageId: null,
      externalUserId: 'customer',
      deliveryStatus: 'pending',
      metadata: null,
    });
    await fixture.store.updateAgentRun(fixture.run.id, {
      assistantTurnId: wrongChannel.id,
    });
    await expect(fixture.store.createAgentRunTextDelivery({
      execution: fixture.execution,
      channel: 'zalo',
      assistantTurnId: wrongChannel.id,
      recipientId: 'private-recipient',
      presentationText: 'Wrong channel',
      createdAt: now(),
    })).resolves.toEqual({ status: 'stale' });
  });

  it('records confirmed sent after lease expiry and terminally completes the run', async () => {
    const fixture = await runningFixture();
    await createIntent(fixture);
    const sending = await begin(fixture, 1, 'delivery-token-1');
    expect(sending.status).toBe('dispatch_authorized');

    vi.advanceTimersByTime(leaseMs + 1);
    await expect(fixture.store.completeAgentRunTextDeliveryAttempt({
      execution: fixture.execution,
      deliveryAttempt: 1,
      deliveryAttemptToken: 'delivery-token-1',
      outcome: {
        status: 'confirmed_sent',
        messageId: 'provider-message-1',
      },
      updatedAt: now(),
    })).resolves.toMatchObject({
      status: 'transitioned',
      record: {
        status: 'confirmed_sent',
        providerMessageId: 'provider-message-1',
      },
    });
    await expect(fixture.store.getAgentRun(fixture.run.id)).resolves
      .toMatchObject({
        status: 'completed',
        deliveryStatus: 'sent',
        deliveryExternalMessageId: 'provider-message-1',
      });
    await expect(fixture.store.claimAgentRunExecution({
      ...claimInput(fixture.run, leaseTokens[1]),
    })).resolves.toMatchObject({
      status: 'stale',
      reason: 'not_current',
      run: { status: 'completed', deliveryStatus: 'sent' },
    });
  });

  it('atomically quarantines an unknown provider outcome without calling it failed', async () => {
    const fixture = await runningFixture();
    await createIntent(fixture);
    await begin(fixture, 1, 'delivery-token-unknown');

    await expect(fixture.store.completeAgentRunTextDeliveryAttempt({
      execution: fixture.execution,
      deliveryAttempt: 1,
      deliveryAttemptToken: 'delivery-token-unknown',
      outcome: {
        status: 'delivery_outcome_unknown',
        errorCode: 'provider_timeout',
        message: 'No definitive provider result',
      },
      updatedAt: now(),
    })).resolves.toMatchObject({
      status: 'transitioned',
      record: {
        status: 'delivery_outcome_unknown',
        outcomeCode: 'provider_timeout',
      },
    });
    await expect(fixture.store.getAgentRun(fixture.run.id)).resolves
      .toMatchObject({
        status: 'reconciliation_required',
        deliveryStatus: 'outcome_unknown',
        errorCode: 'agent_run_delivery_outcome_unknown',
      });
  });

  it('rebinds a crash-before-dispatch pending intent to a newer execution', async () => {
    const fixture = await runningFixture();
    await createIntent(fixture);
    vi.advanceTimersByTime(leaseMs + 1);
    const reclaimed = await fixture.store.claimAgentRunExecution(
      claimInput(fixture.run, leaseTokens[1]),
    );
    if (reclaimed.status !== 'claimed') {
      throw new Error(`delivery_reclaim_failed:${reclaimed.status}`);
    }

    await expect(fixture.store.createAgentRunTextDelivery({
      execution: {
        runId: reclaimed.run.id,
        executionAttempt: reclaimed.run.executionAttempt,
        executionLeaseToken: reclaimed.run.executionLeaseToken!,
      },
      channel: 'messenger',
      assistantTurnId: fixture.assistantTurnId,
      recipientId: 'private-recipient',
      presentationText: 'Private presentation',
      createdAt: now(),
    })).resolves.toMatchObject({
      status: 'rebound',
      record: {
        status: 'pending',
        runExecutionAttempt: 2,
        runExecutionLeaseToken: leaseTokens[1],
      },
    });
  });

  it('requires another execution after a failed first dispatch from rebound pending state', async () => {
    const fixture = await runningFixture();
    await createIntent(fixture);
    await rebindAfterLease(fixture, leaseTokens[1]);
    await begin(fixture, 1, 'delivery-token-rebound-first');
    await confirmedNotSent(
      fixture,
      1,
      'delivery-token-rebound-first',
    );

    await expect(
      begin(fixture, 2, 'delivery-token-rebound-second'),
    ).resolves.toEqual({
      status: 'dispatch_blocked',
      reason: 'execution_rebind_required',
    });
  });

  it('turns an expired sending delivery into unknown instead of reclaiming', async () => {
    const fixture = await runningFixture();
    await createIntent(fixture);
    vi.advanceTimersByTime(500);
    await begin(fixture, 1, 'delivery-token-inflight');
    const sendingAt = now();
    vi.advanceTimersByTime(leaseMs - 499);
    const staleClaim = claimInput(fixture.run, leaseTokens[1]);
    staleClaim.claimedAt = start;

    await expect(fixture.store.claimAgentRunExecution(
      staleClaim,
    )).resolves.toMatchObject({
      status: 'reconciliation_required',
      reason: 'delivery_outcome_unknown',
      run: {
        executionAttempt: 1,
        status: 'reconciliation_required',
        deliveryStatus: 'outcome_unknown',
      },
    });
    await expect(fixture.store.getAgentRunTextDelivery(fixture.run.id))
      .resolves.toMatchObject({
        status: 'delivery_outcome_unknown',
        outcomeCode: 'agent_run_execution_lease_expired',
        updatedAt: sendingAt,
      });
  });

  it('never reuses any prior opaque delivery-attempt token', async () => {
    const fixture = await runningFixture();
    await createIntent(fixture);
    await begin(fixture, 1, 'delivery-token-1');
    await confirmedNotSent(fixture, 1, 'delivery-token-1');
    await expect(begin(fixture, 2, 'delivery-token-2')).resolves.toEqual({
      status: 'dispatch_blocked',
      reason: 'execution_rebind_required',
    });
    await rebindAfterLease(fixture, leaseTokens[1]);
    await begin(fixture, 2, 'delivery-token-2');
    await confirmedNotSent(fixture, 2, 'delivery-token-2');
    await rebindAfterLease(fixture, leaseTokens[2]);

    await expect(begin(fixture, 3, 'delivery-token-1')).resolves.toEqual({
      status: 'dispatch_blocked',
      reason: 'delivery_attempt_token_reused',
    });
    await expect(begin(fixture, 3, 'delivery-token-3')).resolves
      .toMatchObject({
        status: 'dispatch_authorized',
        record: {
          deliveryAttempt: 3,
          priorDeliveryAttemptTokens: [
            'delivery-token-1',
            'delivery-token-2',
          ],
        },
      });
    await confirmedNotSent(fixture, 3, 'delivery-token-3');
    await expect(begin(fixture, 4, 'delivery-token-4')).resolves.toEqual({
      status: 'dispatch_blocked',
      reason: 'attempts_exhausted',
    });
  });

  it('never reuses an opaque delivery-attempt token across runs', async () => {
    const store = new MemoryStore();
    const first = await runningFixture({
      store,
      sessionId: 'messenger:delivery-store:first',
    });
    const second = await runningFixture({
      store,
      sessionId: 'messenger:delivery-store:second',
    });
    await createIntent(first);
    await createIntent(second);
    await begin(first, 1, 'globally-unique-delivery-token');

    await expect(
      begin(second, 1, 'globally-unique-delivery-token'),
    ).resolves.toEqual({
      status: 'dispatch_blocked',
      reason: 'delivery_attempt_token_reused',
    });
  });

  it('supersedes only a stale pre-dispatch execution fence', async () => {
    const fixture = await runningFixture();
    await expect(
      fixture.store.supersedeAgentRunExecutionIfNoLongerCurrent({
        sessionId,
        fence: agentRunExecutionFence(fixture.claimedRun),
        errorMessage: 'owner changed',
        completedAt: now(),
      }),
    ).resolves.toMatchObject({ status: 'still_current' });

    await fixture.store.setSessionAgentState({
      sessionId,
      currentRunId: null,
      generation: fixture.run.generation + 1,
      debounceDeadlineAt: null,
    });
    await expect(
      fixture.store.supersedeAgentRunExecutionIfNoLongerCurrent({
        sessionId,
        fence: agentRunExecutionFence(fixture.claimedRun),
        errorMessage: 'owner changed',
        completedAt: now(),
      }),
    ).resolves.toMatchObject({
      status: 'superseded',
      run: {
        status: 'superseded',
        deliveryStatus: 'suppressed',
        errorCode: 'stale_agent_run',
      },
    });
  });

  it('removes the delivery head and attempt history on session reset', async () => {
    const fixture = await runningFixture();
    await createIntent(fixture);
    await begin(fixture, 1, 'delivery-token-reset');

    await fixture.store.resetSession(fixture.run.sessionId);

    await expect(
      fixture.store.getAgentRunTextDelivery(fixture.run.id),
    ).resolves.toBeUndefined();
    await expect(
      fixture.store.listAgentRuns(fixture.run.sessionId),
    ).resolves.toEqual([]);
  });
});

interface RunningFixture {
  store: MemoryStore;
  run: AgentRun;
  claimedRun: AgentRun;
  assistantTurnId: string;
  execution: {
    runId: string;
    executionAttempt: number;
    executionLeaseToken: string;
  };
}

async function runningFixture(input: {
  store?: MemoryStore;
  sessionId?: string;
} = {}): Promise<RunningFixture> {
  vi.useFakeTimers();
  vi.setSystemTime(start);
  const store = input.store ?? new MemoryStore();
  const fixtureSessionId = input.sessionId ?? sessionId;
  const run = await store.createAgentRun({
    id: `run_${crypto.randomUUID()}`,
    sessionId: fixtureSessionId,
    generation: 1,
    channel: 'messenger',
    externalUserId: 'customer',
    status: 'scheduled',
    coalescedInputText: 'One combo',
    deliveryStatus: 'pending',
    scheduledAt: now(),
  });
  await store.setSessionAgentState({
    sessionId: fixtureSessionId,
    currentRunId: run.id,
    generation: run.generation,
    debounceDeadlineAt: null,
  });
  const claimed = await store.claimAgentRunExecution(
    claimInput(run, leaseTokens[0]),
  );
  if (claimed.status !== 'claimed') {
    throw new Error(`delivery_fixture_claim_failed:${claimed.status}`);
  }
  const assistant = await store.appendTurn({
    sessionId: fixtureSessionId,
    channel: 'messenger',
    role: 'assistant',
    text: 'Private presentation',
    externalMessageId: null,
    externalUserId: 'customer',
    deliveryStatus: 'pending',
    metadata: null,
  });
  await store.updateAgentRun(run.id, {
    assistantTurnId: assistant.id,
  });
  return {
    store,
    run,
    claimedRun: claimed.run,
    assistantTurnId: assistant.id,
    execution: {
      runId: claimed.run.id,
      executionAttempt: claimed.run.executionAttempt,
      executionLeaseToken: claimed.run.executionLeaseToken!,
    },
  };
}

function claimInput(run: AgentRun, executionLeaseToken: string) {
  const claimedAt = new Date();
  return {
    runId: run.id,
    sessionId: run.sessionId,
    generation: run.generation,
    sessionAuthorityGeneration: run.sessionAuthorityGeneration,
    claimedAt: claimedAt.toISOString(),
    executionLeaseToken,
    executionLeaseExpiresAt: new Date(
      claimedAt.getTime() + leaseMs,
    ).toISOString(),
  };
}

function createIntent(fixture: RunningFixture) {
  return fixture.store.createAgentRunTextDelivery({
    execution: fixture.execution,
    channel: 'messenger',
    assistantTurnId: fixture.assistantTurnId,
    recipientId: 'private-recipient',
    presentationText: 'Private presentation',
    createdAt: now(),
  });
}

function begin(
  fixture: RunningFixture,
  nextDeliveryAttempt: number,
  deliveryAttemptToken: string,
) {
  return fixture.store.beginAgentRunTextDeliveryAttempt({
    execution: fixture.execution,
    nextDeliveryAttempt,
    deliveryAttemptToken,
    updatedAt: now(),
  });
}

function confirmedNotSent(
  fixture: RunningFixture,
  deliveryAttempt: number,
  deliveryAttemptToken: string,
) {
  return fixture.store.completeAgentRunTextDeliveryAttempt({
    execution: fixture.execution,
    deliveryAttempt,
    deliveryAttemptToken,
    outcome: {
      status: 'confirmed_not_sent',
      errorCode: 'provider_rejected',
      message: 'Provider definitively rejected before send',
    },
    updatedAt: now(),
  });
}

async function rebindAfterLease(
  fixture: RunningFixture,
  executionLeaseToken: string,
): Promise<void> {
  vi.advanceTimersByTime(leaseMs + 1);
  const reclaimed = await fixture.store.claimAgentRunExecution(
    claimInput(fixture.run, executionLeaseToken),
  );
  if (reclaimed.status !== 'claimed') {
    throw new Error(`delivery_reclaim_failed:${reclaimed.status}`);
  }
  fixture.claimedRun = reclaimed.run;
  fixture.execution = {
    runId: reclaimed.run.id,
    executionAttempt: reclaimed.run.executionAttempt,
    executionLeaseToken: reclaimed.run.executionLeaseToken!,
  };
  await expect(
    fixture.store.createAgentRunTextDelivery({
      execution: fixture.execution,
      channel: 'messenger',
      assistantTurnId: fixture.assistantTurnId,
      recipientId: 'private-recipient',
      presentationText: 'Private presentation',
      createdAt: now(),
    }),
  ).resolves.toMatchObject({
    status: 'rebound',
    record: {
      runExecutionAttempt: reclaimed.run.executionAttempt,
    },
  });
}

function now(): string {
  return new Date().toISOString();
}
