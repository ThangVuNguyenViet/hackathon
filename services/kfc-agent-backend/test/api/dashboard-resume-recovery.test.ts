import { describe, expect, it, vi } from 'vitest';
import { AgentRunCoordinator } from '../../src/agentRuns/coordinator.js';
import { enqueueDashboardResumeRecovery } from '../../src/api/dashboardResumeRecovery.js';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';

async function recoveryHarness() {
  const store = new MemoryStore();
  const dashboard = new DashboardEventBus();
  const deferred: Array<() => Promise<void>> = [];
  const processAgentRun = vi.fn(async (_runId: string) => undefined);
  await store.setSessionControl('messenger:customer-1', {
    agentMode: 'ai_active',
    assignedAgentId: null,
  });
  await store.appendTurn({
    sessionId: 'messenger:customer-1',
    channel: 'messenger',
    role: 'user',
    text: 'Please continue helping me.',
    externalMessageId: 'message-1',
    externalUserId: 'customer-1',
    deliveryStatus: 'received',
    metadata: null,
  });
  return {
    store,
    dashboard,
    deferred,
    processAgentRun,
    enqueue: () => enqueueDashboardResumeRecovery({
      sessionId: 'messenger:customer-1',
      store,
      dashboard,
      defer: (task) => deferred.push(task),
      processAgentRun,
    }),
  };
}

describe('dashboard resume recovery', () => {
  it('durably queues before returning without awaiting agent execution', async () => {
    const harness = await recoveryHarness();
    const result = await harness.enqueue();

    expect(result).toMatchObject({ queued: true, generation: 1 });
    expect(harness.processAgentRun).not.toHaveBeenCalled();
    expect(harness.deferred).toHaveLength(1);
    await expect(
      harness.store.listDueSessionAgentStates(
        new Date(Date.now() + 1_000).toISOString(),
        10,
      ),
    ).resolves.toHaveLength(1);
  });

  it('lets only the newest reversed recovery generation execute', async () => {
    const harness = await recoveryHarness();
    await harness.enqueue();
    await harness.enqueue();

    await harness.deferred[1]!();
    await harness.deferred[0]!();

    expect(harness.processAgentRun).toHaveBeenCalledOnce();
    const runId = harness.processAgentRun.mock.calls[0]?.[0];
    await expect(harness.store.getAgentRun(runId!)).resolves.toMatchObject({
      generation: 2,
    });
  });

  it('invalidates queued recovery when a human rejoins first', async () => {
    const harness = await recoveryHarness();
    await harness.enqueue();
    await harness.store.advanceSessionAgentGeneration({
      sessionId: 'messenger:customer-1',
      debounceDeadlineAt: null,
    });
    await harness.store.setSessionControl('messenger:customer-1', {
      agentMode: 'human_paused',
      assignedAgentId: 'agent-1',
    });

    await harness.deferred[0]!();

    expect(harness.processAgentRun).not.toHaveBeenCalled();
    await expect(
      harness.store.listAgentRuns('messenger:customer-1'),
    ).resolves.toEqual([]);
  });

  it('converges cron and deferred recovery on one claimed run', async () => {
    const harness = await recoveryHarness();
    await harness.enqueue();
    const coordinator = new AgentRunCoordinator({
      store: harness.store,
      dashboard: harness.dashboard,
    });
    const claims = await coordinator.claimDueRuns(
      new Date(Date.now() + 1_000).toISOString(),
    );
    const cronRunId = claims.find((claim) => claim.claimed)?.runId;
    expect(cronRunId).toBeTruthy();

    await harness.processAgentRun(cronRunId!);
    await harness.deferred[0]!();

    expect(harness.processAgentRun).toHaveBeenCalledOnce();
    await expect(
      harness.store.listAgentRuns('messenger:customer-1'),
    ).resolves.toHaveLength(1);
  });
});
