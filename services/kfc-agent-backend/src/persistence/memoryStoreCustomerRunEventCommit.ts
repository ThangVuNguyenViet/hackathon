import type {
  CustomerRun,
  CustomerRunEvent,
} from '../customerRuns/contracts.js';
import {
  CustomerRunSequenceConflictError,
  customerRunEventSchema,
} from '../customerRuns/contracts.js';
import type {
  AppendCustomerRunEventInput,
  AppendCustomerRunEventsIfRunCurrentInput,
  AppendCustomerRunEventsIfRunCurrentResult,
  SessionControl,
} from './contracts.js';
import { prepareCustomerRunEventBatch } from './customerRunEventCommit.js';

export function appendMemoryCustomerRunEvents(input: {
  operations: readonly AppendCustomerRunEventInput[];
  customerRuns: Map<string, CustomerRun>;
  customerRunEvents: CustomerRunEvent[];
}): CustomerRunEvent[] {
  if (input.operations.length === 0) return [];
  const first = input.operations[0]!;
  const run = input.customerRuns.get(first.runId);
  if (!run) throw new Error(`Customer run not found: ${first.runId}`);
  for (const [index, operation] of input.operations.entries()) {
    const expectedSequence = run.nextEventSequence + index;
    if (
      operation.runId !== run.id ||
      operation.expectedSequence !== expectedSequence
    ) {
      throw new CustomerRunSequenceConflictError(
        operation.runId,
        operation.expectedSequence,
        expectedSequence,
      );
    }
  }
  const events = input.operations.map(({ expectedSequence, ...eventInput }) =>
    customerRunEventSchema.parse({
      ...eventInput,
      sequence: expectedSequence,
    }),
  );
  input.customerRunEvents.push(...events);
  input.customerRuns.set(run.id, {
    ...run,
    nextEventSequence: run.nextEventSequence + events.length,
    updatedAt: events.at(-1)!.occurredAt,
  });
  return events;
}

export function appendMemoryCustomerRunEvent(input: {
  operation: AppendCustomerRunEventInput;
  customerRuns: Map<string, CustomerRun>;
  customerRunEvents: CustomerRunEvent[];
}): CustomerRunEvent {
  return appendMemoryCustomerRunEvents({
    operations: [input.operation],
    customerRuns: input.customerRuns,
    customerRunEvents: input.customerRunEvents,
  })[0]!;
}

export function appendMemoryCustomerRunEventsIfRunCurrent(input: {
  operation: AppendCustomerRunEventsIfRunCurrentInput;
  customerRuns: Map<string, CustomerRun>;
  customerRunEvents: CustomerRunEvent[];
  sessionControls: ReadonlyMap<string, SessionControl>;
}): AppendCustomerRunEventsIfRunCurrentResult {
  const prepared = prepareCustomerRunEventBatch({
    runId: input.operation.fence.runId,
    events: input.operation.events,
  });
  const run = input.customerRuns.get(input.operation.fence.runId);
  const control = input.sessionControls.get(input.operation.sessionId);
  const authorityGeneration = control?.sessionAuthorityGeneration ?? 0;
  if (
    !run ||
    run.sessionId !== input.operation.sessionId ||
    run.sessionAuthorityGeneration !==
      input.operation.fence.sessionAuthorityGeneration ||
    run.sessionAuthorityGeneration !== authorityGeneration ||
    (run.status !== 'accepted' && run.status !== 'running') ||
    (control?.agentMode ?? 'ai_active') !== 'ai_active' ||
    (prepared.length > 0 && prepared[0]?.sequence !== run.nextEventSequence)
  ) {
    return { status: 'stale' };
  }
  if (prepared.length === 0) {
    return { status: 'committed', events: [] };
  }
  input.customerRunEvents.push(...prepared);
  input.customerRuns.set(run.id, {
    ...run,
    nextEventSequence: run.nextEventSequence + prepared.length,
    updatedAt: prepared.at(-1)!.occurredAt,
  });
  return {
    status: 'committed',
    events: structuredClone(prepared),
  };
}
