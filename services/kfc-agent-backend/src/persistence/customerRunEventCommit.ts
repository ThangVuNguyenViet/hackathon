import {
  customerRunEventSchema,
  type CustomerRunEvent,
} from '../customerRuns/contracts.js';
import type {
  AppendCustomerRunEventInput,
} from './contracts.js';

export function prepareCustomerRunEventBatch(input: {
  runId: string;
  events: readonly AppendCustomerRunEventInput[];
}): CustomerRunEvent[] {
  const first = input.events[0];
  if (!first) return [];
  return input.events.map((event, index) => {
    if (
      event.runId !== input.runId ||
      event.expectedSequence !== first.expectedSequence + index
    ) {
      throw new Error('customer_run_event_fence_mismatch');
    }
    const { expectedSequence, ...eventInput } = event;
    return customerRunEventSchema.parse({
      ...eventInput,
      sequence: expectedSequence,
    });
  });
}
