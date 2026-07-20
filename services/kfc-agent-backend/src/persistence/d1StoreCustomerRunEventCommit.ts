import type {
  AppendCustomerRunEventsIfRunCurrentInput,
  AppendCustomerRunEventsIfRunCurrentResult,
} from './contracts.js';
import {
  prepareCustomerRunEventBatch,
} from './customerRunEventCommit.js';
import type {
  D1DatabaseLike,
  D1PreparedStatement,
} from './d1StoreSupport.js';
import {
  d1RunCommitEligibility,
} from './d1StoreTurnCommit.js';

export async function appendD1CustomerRunEventsIfRunCurrent(input: {
  db: D1DatabaseLike;
  operation: AppendCustomerRunEventsIfRunCurrentInput;
}): Promise<AppendCustomerRunEventsIfRunCurrentResult> {
  const prepared = prepareCustomerRunEventBatch({
    runId: input.operation.fence.runId,
    events: input.operation.events,
  });
  const eligible = d1RunCommitEligibility(input.operation);
  if (prepared.length === 0) {
    const current = await input.db.prepare(
      `SELECT 1 AS current WHERE ${eligible.sql}`,
    ).bind(...eligible.bindings).first<{ current: number }>();
    return current?.current === 1
      ? { status: 'committed', events: [] }
      : { status: 'stale' };
  }
  if (!input.db.batch) {
    throw new Error('d1_atomic_customer_run_event_commit_unavailable');
  }

  const firstSequence = prepared[0]!.sequence;
  const statements: D1PreparedStatement[] = prepared.map((event) =>
    input.db.prepare(
      `INSERT INTO customer_run_events (
         event_id, run_id, sequence, schema_version, type,
         occurred_at, payload
       )
       SELECT ?, ?, ?, ?, ?, ?, ?
       WHERE ${eligible.sql}
         AND EXISTS (
           SELECT 1
           FROM customer_runs
           WHERE id = ?
             AND next_event_sequence = ?
         )`,
    ).bind(
      event.eventId,
      event.runId,
      event.sequence,
      event.schemaVersion,
      event.type,
      event.occurredAt,
      JSON.stringify(event.payload),
      ...eligible.bindings,
      input.operation.fence.runId,
      firstSequence,
    ));
  const last = prepared.at(-1)!;
  statements.push(
    input.db.prepare(
      `UPDATE customer_runs
       SET next_event_sequence = next_event_sequence + ?,
           updated_at = ?
       WHERE id = ?
         AND next_event_sequence = ?
         AND ${eligible.sql}`,
    ).bind(
      prepared.length,
      last.occurredAt,
      input.operation.fence.runId,
      firstSequence,
      ...eligible.bindings,
    ),
  );

  const results = await input.db.batch(statements);
  const changes = results.map(
    (result) => Number(result.meta.changes ?? 0),
  );
  if (changes.every((change) => change === 0)) {
    return { status: 'stale' };
  }
  if (!changes.every((change) => change === 1)) {
    throw new Error('d1_atomic_customer_run_event_commit_inconsistent');
  }
  return {
    status: 'committed',
    events: structuredClone(prepared),
  };
}
