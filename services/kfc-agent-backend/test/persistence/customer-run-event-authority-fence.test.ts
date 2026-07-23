import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import type {
  AppendCustomerRunEventInput,
  CreateCustomerRunInput,
} from '../../src/persistence/contracts.js';

const sessionId = 'kfc:customer-run-event-fence-customer';
const runId = 'customer-run-event-fence-run';

function customerRun(): CreateCustomerRunInput {
  return {
    id: runId,
    schemaVersion: 1,
    sessionId,
    customerId: 'customer-run-event-fence-customer',
    clientMessageId: 'customer-run-event-fence-message',
    requestFingerprint: 'customer-run-event-fence-fingerprint',
    generation: 1,
    status: 'running',
    phase: 'planning',
    nextEventSequence: 1,
    clientSchemaVersion: 1,
    acceptedAt: '2026-07-20T00:00:00.000Z',
    startedAt: '2026-07-20T00:00:00.000Z',
    terminalAt: null,
    updatedAt: '2026-07-20T00:00:00.000Z',
  };
}

function eventBatch(
  expectedSequence: number,
): AppendCustomerRunEventInput[] {
  return [
    {
      schemaVersion: 1,
      eventId: `customer-run-event-${expectedSequence}`,
      runId,
      expectedSequence,
      type: 'progress_updated',
      occurredAt: '2026-07-20T00:00:01.000Z',
      payload: { progress: 'first' },
    },
    {
      schemaVersion: 1,
      eventId: `customer-run-event-${expectedSequence + 1}`,
      runId,
      expectedSequence: expectedSequence + 1,
      type: 'phase_changed',
      occurredAt: '2026-07-20T00:00:02.000Z',
      payload: { phase: 'read_only_tool' },
    },
  ];
}

describe('MemoryStore customer-run event authority fence', () => {
  it('commits a whole batch in exact sequence for the active run and authority generation', async () => {
    const store = new MemoryStore();
    const run = await store.createCustomerRun(customerRun());

    const result = await store.appendCustomerRunEventsIfRunCurrent({
      sessionId,
      fence: {
        kind: 'customer_run',
        runId,
        sessionAuthorityGeneration:
          run.sessionAuthorityGeneration,
      },
      events: eventBatch(run.nextEventSequence),
    });

    expect(result).toMatchObject({
      status: 'committed',
      events: [
        {
          eventId: 'customer-run-event-1',
          sequence: 1,
          payload: { progress: 'first' },
        },
        {
          eventId: 'customer-run-event-2',
          sequence: 2,
          payload: { phase: 'read_only_tool' },
        },
      ],
    });
    await expect(
      store.listCustomerRunEvents(runId),
    ).resolves.toEqual(
      result.status === 'committed' ? result.events : [],
    );
    await expect(store.getCustomerRun(runId)).resolves.toMatchObject({
      sessionAuthorityGeneration: run.sessionAuthorityGeneration,
      nextEventSequence: 3,
      updatedAt: '2026-07-20T00:00:02.000Z',
    });
  });

  it('rejects the old run fence during human pause and after AI resumes at a newer authority generation', async () => {
    const store = new MemoryStore();
    const run = await store.createCustomerRun(customerRun());
    const operation = {
      sessionId,
      fence: {
        kind: 'customer_run' as const,
        runId,
        sessionAuthorityGeneration:
          run.sessionAuthorityGeneration,
      },
      events: eventBatch(run.nextEventSequence),
    };

    const paused = await store.transitionSessionAuthority({
      sessionId,
      expectedGeneration: run.sessionAuthorityGeneration,
      agentMode: 'human_paused',
      assignedAgentId: 'support-agent-1',
      updatedAt: '2026-07-20T00:00:03.000Z',
    });
    expect(paused).toMatchObject({
      status: 'transitioned',
      control: {
        agentMode: 'human_paused',
        sessionAuthorityGeneration: 1,
      },
    });
    await expect(
      store.appendCustomerRunEventsIfRunCurrent(operation),
    ).resolves.toEqual({ status: 'stale' });
    await expect(store.listCustomerRunEvents(runId)).resolves.toEqual([]);

    const resumed = await store.transitionSessionAuthority({
      sessionId,
      expectedGeneration:
        paused.control.sessionAuthorityGeneration,
      agentMode: 'ai_active',
      assignedAgentId: null,
      updatedAt: '2026-07-20T00:00:04.000Z',
    });
    expect(resumed).toMatchObject({
      status: 'transitioned',
      control: {
        agentMode: 'ai_active',
        sessionAuthorityGeneration: 2,
      },
    });
    await expect(
      store.appendCustomerRunEventsIfRunCurrent(operation),
    ).resolves.toEqual({ status: 'stale' });
    await expect(store.listCustomerRunEvents(runId)).resolves.toEqual([]);
    await expect(store.getCustomerRun(runId)).resolves.toMatchObject({
      nextEventSequence: 1,
    });
  });

  it('does not append any part of a batch whose first sequence is stale', async () => {
    const store = new MemoryStore();
    const run = await store.createCustomerRun(customerRun());
    const fence = {
      kind: 'customer_run' as const,
      runId,
      sessionAuthorityGeneration:
        run.sessionAuthorityGeneration,
    };

    await expect(
      store.appendCustomerRunEventsIfRunCurrent({
        sessionId,
        fence,
        events: eventBatch(run.nextEventSequence + 1),
      }),
    ).resolves.toEqual({ status: 'stale' });
    await expect(store.listCustomerRunEvents(runId)).resolves.toEqual([]);
    await expect(store.getCustomerRun(runId)).resolves.toMatchObject({
      nextEventSequence: 1,
    });

    const retry = await store.appendCustomerRunEventsIfRunCurrent({
      sessionId,
      fence,
      events: eventBatch(run.nextEventSequence),
    });
    expect(retry).toMatchObject({
      status: 'committed',
      events: [
        { eventId: 'customer-run-event-1', sequence: 1 },
        { eventId: 'customer-run-event-2', sequence: 2 },
      ],
    });
  });
});
