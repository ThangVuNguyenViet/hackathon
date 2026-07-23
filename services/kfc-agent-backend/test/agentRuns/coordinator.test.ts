import { describe, expect, it } from 'vitest';
import { AgentRunCoordinator } from '../../src/agentRuns/coordinator.js';
import { agentRunExecutionFence } from '../../src/persistence/agentRunExecutionLease.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';

describe('AgentRunCoordinator', () => {
  it('lets only one worker claim a session generation', async () => {
    const store = new MemoryStore();
    const coordinator = new AgentRunCoordinator({
      store,
      options: { debounceWindowMs: 0 },
    });
    const wakeup = await coordinator.recordPendingTurn(
      {
        channel: 'messenger',
        externalUserId: 'customer-1',
        externalThreadId: 'thread-1',
        text: 'Cho mình một combo.',
        eventType: 'message',
        rawEventId: 'message-1',
        receivedAt: '2026-07-16T00:00:00.000Z',
        shouldRunAgent: true,
      },
      'messenger:customer-1',
    );

    const results = await Promise.all([
      coordinator.claimWakeupRun(wakeup),
      coordinator.claimWakeupRun(wakeup),
    ]);

    expect(results.filter((result) => result.claimed)).toHaveLength(1);
    expect(
      results.filter((result) => result.reason === 'already_claimed'),
    ).toHaveLength(1);
    expect(results.every((result) => result.dispatch)).toBe(true);
    expect(new Set(results.map((result) => result.runId)).size).toBe(1);
    await expect(
      store.listAgentRuns('messenger:customer-1'),
    ).resolves.toHaveLength(1);
  });

  it('does not advance or supersede a run for a duplicate pending event', async () => {
    const store = new MemoryStore();
    const coordinator = new AgentRunCoordinator({
      store,
      options: { debounceWindowMs: 0 },
    });
    const sessionId = 'messenger:duplicate-pending';
    const event = messengerEvent('message-duplicate-pending');
    const wakeup = await coordinator.recordPendingTurn(event, sessionId);
    const scheduled = await coordinator.claimWakeupRun(wakeup);
    const before = await store.getSessionAgentState(sessionId);

    const replayWakeup = await coordinator.recordPendingTurn(event, sessionId);
    const after = await store.getSessionAgentState(sessionId);
    const replayClaim = await coordinator.claimWakeupRun(replayWakeup);

    expect(after).toEqual(before);
    expect(replayWakeup.generation).toBe(wakeup.generation);
    expect(replayClaim).toMatchObject({
      claimed: false,
      dispatch: true,
      runId: scheduled.runId,
      reason: 'already_claimed',
    });
    await expect(store.listAgentRuns(sessionId)).resolves.toHaveLength(1);
  });

  it('suppresses a newly-created run when human invalidation wins ownership CAS', async () => {
    const store = new MemoryStore();
    const coordinator = new AgentRunCoordinator({
      store,
      options: { debounceWindowMs: 0 },
    });
    const wakeup = await coordinator.recordPendingTurn(
      messengerEvent('message-human-race'),
      'messenger:human-race',
    );
    const originalClaim = store.claimAgentRun.bind(store);
    store.claimAgentRun = async (input) => {
      const claim = await originalClaim(input);
      await store.advanceSessionAgentGeneration({
        sessionId: input.sessionId,
        debounceDeadlineAt: null,
        updatedAt: '2026-07-16T00:00:01.000Z',
      });
      return claim;
    };

    const result = await coordinator.claimWakeupRun(wakeup);
    const run = (await store.listAgentRuns(wakeup.sessionId))[0]!;

    expect(result).toMatchObject({
      claimed: false,
      runId: run.id,
      reason: 'stale_generation',
    });
    expect(run).toMatchObject({
      status: 'superseded',
      deliveryStatus: 'suppressed',
    });
    await expect(
      store.claimAgentRunExecution(executionClaim(run)),
    ).resolves.toMatchObject({ status: 'stale' });
  });

  it('allows only one exact scheduled run execution claim', async () => {
    const store = new MemoryStore();
    const coordinator = new AgentRunCoordinator({
      store,
      options: { debounceWindowMs: 0 },
    });
    const wakeup = await coordinator.recordPendingTurn(
      messengerEvent('message-redelivery-race'),
      'messenger:redelivery-race',
    );
    const scheduled = await coordinator.claimWakeupRun(wakeup);
    const run = (await store.getAgentRun(scheduled.runId!))!;
    const input = executionClaim(run);

    const claims = await Promise.all([
      store.claimAgentRunExecution(input),
      store.claimAgentRunExecution(input),
    ]);

    expect(claims.filter((claim) => claim.status === 'claimed')).toHaveLength(
      1,
    );
    expect(claims.filter((claim) => claim.status === 'stale')).toHaveLength(1);
    expect(claims).toContainEqual(
      expect.objectContaining({ status: 'stale', reason: 'lease_active' }),
    );
  });

  it('rejects execution when generation invalidation follows scheduling', async () => {
    const store = new MemoryStore();
    const coordinator = new AgentRunCoordinator({
      store,
      options: { debounceWindowMs: 0 },
    });
    const wakeup = await coordinator.recordPendingTurn(
      messengerEvent('message-reverse-race'),
      'messenger:reverse-race',
    );
    const scheduled = await coordinator.claimWakeupRun(wakeup);
    const invalidated = await store.advanceSessionAgentGeneration({
      sessionId: wakeup.sessionId,
      debounceDeadlineAt: null,
      updatedAt: '2026-07-16T00:00:01.000Z',
    });

    expect(invalidated.invalidatedRunId).toBe(scheduled.runId);
    const run = (await store.getAgentRun(scheduled.runId!))!;
    await expect(
      store.claimAgentRunExecution(executionClaim(run)),
    ).resolves.toMatchObject({ status: 'stale' });
  });

  it('does not supersede a running execution with an in-flight delivery', async () => {
    const store = new MemoryStore();
    const coordinator = new AgentRunCoordinator({
      store,
      options: { debounceWindowMs: 0 },
    });
    const sessionId = 'messenger:delivery-race';
    const wakeup = await coordinator.recordPendingTurn(
      messengerEvent('message-delivery-race-1'),
      sessionId,
    );
    const scheduled = await coordinator.claimWakeupRun(wakeup);
    const run = (await store.getAgentRun(scheduled.runId!))!;
    const claimed = await store.claimAgentRunExecution(executionClaim(run));
    if (claimed.status !== 'claimed') {
      throw new Error('test_execution_claim_failed');
    }
    const assistantTurn = await store.appendTurn({
      sessionId,
      channel: 'messenger',
      role: 'assistant',
      text: 'Verified reply',
      externalMessageId: null,
      externalUserId: run.externalUserId,
      deliveryStatus: 'pending',
      metadata: null,
    });
    const fence = agentRunExecutionFence(claimed.run);
    const bound = await store.updateAgentRunIfExecutionCurrent({
      sessionId,
      fence,
      patch: { assistantTurnId: assistantTurn.id },
    });
    expect(bound.status).toBe('committed');
    const created = await store.createAgentRunTextDelivery({
      execution: {
        runId: fence.runId,
        executionAttempt: fence.executionAttempt,
        executionLeaseToken: fence.executionLeaseToken,
      },
      channel: 'messenger',
      assistantTurnId: assistantTurn.id,
      recipientId: run.externalUserId,
      presentationText: assistantTurn.text,
      createdAt: new Date().toISOString(),
    });
    expect(created.status).toBe('created');
    const begun = await store.beginAgentRunTextDeliveryAttempt({
      execution: {
        runId: fence.runId,
        executionAttempt: fence.executionAttempt,
        executionLeaseToken: fence.executionLeaseToken,
      },
      nextDeliveryAttempt: 1,
      deliveryAttemptToken: 'delivery-race-attempt-token-000000000001',
      updatedAt: new Date().toISOString(),
    });
    expect(begun.status).toBe('dispatch_authorized');

    await coordinator.recordPendingTurn(
      messengerEvent('message-delivery-race-2'),
      sessionId,
    );

    await expect(store.getAgentRun(run.id)).resolves.toMatchObject({
      status: 'running',
    });
    await expect(store.getAgentRunTextDelivery(run.id)).resolves.toMatchObject({
      status: 'sending',
    });
    await expect(
      store.completeAgentRunTextDeliveryAttempt({
        execution: {
          runId: fence.runId,
          executionAttempt: fence.executionAttempt,
          executionLeaseToken: fence.executionLeaseToken,
        },
        deliveryAttempt: 1,
        deliveryAttemptToken: 'delivery-race-attempt-token-000000000001',
        outcome: {
          status: 'confirmed_sent',
          messageId: 'provider-delivery-race-message',
        },
        updatedAt: new Date().toISOString(),
      }),
    ).resolves.toMatchObject({
      status: 'transitioned',
      record: { status: 'confirmed_sent' },
    });
    await expect(store.getAgentRun(run.id)).resolves.toMatchObject({
      status: 'completed',
      deliveryStatus: 'sent',
      deliveryExternalMessageId: 'provider-delivery-race-message',
    });
  });
});

function messengerEvent(rawEventId: string) {
  return {
    channel: 'messenger' as const,
    externalUserId: 'customer-1',
    externalThreadId: 'thread-1',
    text: 'Cho mình một combo.',
    eventType: 'message' as const,
    rawEventId,
    receivedAt: '2026-07-16T00:00:00.000Z',
    shouldRunAgent: true,
  };
}

function executionClaim(run: {
  id: string;
  sessionId: string;
  generation: number;
  sessionAuthorityGeneration: number;
}) {
  const claimedAt = new Date();
  return {
    runId: run.id,
    sessionId: run.sessionId,
    generation: run.generation,
    sessionAuthorityGeneration: run.sessionAuthorityGeneration,
    claimedAt: claimedAt.toISOString(),
    executionLeaseToken: crypto.randomUUID(),
    executionLeaseExpiresAt: new Date(
      claimedAt.getTime() + 60_000,
    ).toISOString(),
  };
}
