import type {
  AppendCustomerRunEventsIfRunCurrentInput,
  AppendCustomerRunEventsIfRunCurrentResult,
} from './contracts.js';
import { prepareCustomerRunEventBatch } from './customerRunEventCommit.js';
import {
  isConnectablePostgres,
  lockPostgresRunCommitOwner,
} from './postgresStoreRunOwner.js';
import type { Queryable } from './postgresStoreSupport.js';

export async function appendPostgresCustomerRunEventsIfRunCurrent(input: {
  db: Queryable;
  operation: AppendCustomerRunEventsIfRunCurrentInput;
}): Promise<AppendCustomerRunEventsIfRunCurrentResult> {
  const prepared = prepareCustomerRunEventBatch({
    runId: input.operation.fence.runId,
    events: input.operation.events,
  });
  if (!isConnectablePostgres(input.db)) {
    throw new Error('postgres_atomic_customer_run_event_commit_unavailable');
  }
  const client = await input.db.connect();
  try {
    await client.query('BEGIN');
    if (!(await lockPostgresRunCommitOwner(client, input.operation))) {
      await client.query('COMMIT');
      return { status: 'stale' };
    }
    const sequence = await client.query<{
      next_event_sequence: number;
    }>(
      `SELECT next_event_sequence
       FROM customer_runs
       WHERE id = $1`,
      [input.operation.fence.runId],
    );
    const expectedSequence = prepared[0]?.sequence;
    if (
      expectedSequence !== undefined &&
      Number(sequence.rows[0]?.next_event_sequence) !== expectedSequence
    ) {
      await client.query('COMMIT');
      return { status: 'stale' };
    }
    for (const event of prepared) {
      await client.query(
        `INSERT INTO customer_run_events (
           event_id, run_id, sequence, schema_version, type,
           occurred_at, payload
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          event.eventId,
          event.runId,
          event.sequence,
          event.schemaVersion,
          event.type,
          event.occurredAt,
          event.payload,
        ],
      );
    }
    if (prepared.length > 0) {
      const updated = await client.query(
        `UPDATE customer_runs
         SET next_event_sequence = next_event_sequence + $2,
             updated_at = $3
         WHERE id = $1
           AND next_event_sequence = $4`,
        [
          input.operation.fence.runId,
          prepared.length,
          prepared.at(-1)!.occurredAt,
          expectedSequence,
        ],
      );
      if (updated.rowCount !== 1) {
        throw new Error(
          'postgres_atomic_customer_run_event_commit_inconsistent',
        );
      }
    }
    await client.query('COMMIT');
    return {
      status: 'committed',
      events: structuredClone(prepared),
    };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the original failure and fail closed.
    }
    throw error;
  } finally {
    client.release();
  }
}
