import { randomUUID } from 'node:crypto';
import type {
  AppendEventIfRunCurrentInput,
  AppendEventIfRunCurrentResult,
  IsRunCommitFenceCurrentInput,
  StoredEvent,
} from './contracts.js';
import type { Queryable } from './postgresStoreSupport.js';
import {
  isConnectablePostgres,
  lockPostgresRunCommitOwner,
} from './postgresStoreRunOwner.js';

export async function isPostgresRunCommitFenceCurrent(input: {
  db: Queryable;
  guard: IsRunCommitFenceCurrentInput;
}): Promise<boolean> {
  const { guard } = input;
  if (
    guard.notAfter !== undefined &&
    !Number.isFinite(Date.parse(guard.notAfter))
  ) {
    return false;
  }
  const result = await (() => {
    switch (guard.fence.kind) {
      case 'agent_run':
        return input.db.query<{ current: boolean }>(
          `SELECT EXISTS (
             SELECT 1
             FROM session_agent_state AS state
             INNER JOIN agent_runs AS run
               ON run.id = state.current_run_id
              AND run.session_id = state.session_id
              AND run.generation = state.generation
             WHERE state.session_id = $1
               AND state.current_run_id = $2
               AND state.generation = $3
               AND run.id = $2
               AND run.session_id = $1
               AND run.generation = $3
               AND run.session_authority_generation = $4
               AND run.status = 'running'
               AND run.execution_attempt = $5
               AND run.execution_lease_token = $6
               AND run.execution_lease_expires_at IS NOT NULL
               AND clock_timestamp() < run.execution_lease_expires_at
               AND (
                 EXISTS (
                   SELECT 1
                   FROM session_controls AS control
                   WHERE control.session_id = $1
                     AND control.agent_mode = 'ai_active'
                     AND control.session_authority_generation = $4
                 )
                 OR (
                   $4 = 0
                   AND NOT EXISTS (
                     SELECT 1
                     FROM session_controls AS control
                     WHERE control.session_id = $1
                   )
                 )
               )
               AND ($7::timestamptz IS NULL OR clock_timestamp() < $7)
           ) AS current`,
          [
            guard.sessionId,
            guard.fence.runId,
            guard.fence.generation,
            guard.fence.sessionAuthorityGeneration,
            guard.fence.executionAttempt,
            guard.fence.executionLeaseToken,
            guard.notAfter ?? null,
          ],
        );
      case 'customer_run':
        return input.db.query<{ current: boolean }>(
          `SELECT EXISTS (
             SELECT 1
             FROM customer_runs AS run
             WHERE run.id = $1
               AND run.session_id = $2
               AND run.session_authority_generation = $3
               AND run.status IN ('accepted', 'running')
               AND (
                 EXISTS (
                   SELECT 1
                   FROM session_controls AS control
                   WHERE control.session_id = $2
                     AND control.agent_mode = 'ai_active'
                     AND control.session_authority_generation = $3
                 )
                 OR (
                   $3 = 0
                   AND NOT EXISTS (
                     SELECT 1
                     FROM session_controls AS control
                     WHERE control.session_id = $2
                   )
                 )
               )
               AND ($4::timestamptz IS NULL OR clock_timestamp() < $4)
           ) AS current`,
          [
            guard.fence.runId,
            guard.sessionId,
            guard.fence.sessionAuthorityGeneration,
            guard.notAfter ?? null,
          ],
        );
      case 'operation_lease':
        return input.db.query<{ current: boolean }>(
          `SELECT EXISTS (
             SELECT 1
             FROM irreversible_operations AS operation
             WHERE operation.request_id = $1
               AND operation.session_id = $2
               AND operation.operation = $3
               AND operation.binding_fingerprint = $4
               AND operation.session_authority_generation = $5
               AND operation.status = 'attempting'
               AND operation.attempt_count = $6
               AND operation.lease_token = $7
               AND clock_timestamp() < operation.lease_expires_at
               AND (
                 EXISTS (
                   SELECT 1
                   FROM session_controls AS control
                   WHERE control.session_id = $2
                     AND control.agent_mode = 'ai_active'
                     AND control.session_authority_generation = $5
                 )
                 OR (
                   $5 = 0
                   AND NOT EXISTS (
                     SELECT 1
                     FROM session_controls AS control
                     WHERE control.session_id = $2
                   )
                 )
               )
               AND ($8::timestamptz IS NULL OR clock_timestamp() < $8)
           ) AS current`,
          [
            guard.fence.requestId,
            guard.sessionId,
            guard.fence.operation,
            guard.fence.bindingFingerprint,
            guard.fence.sessionAuthorityGeneration,
            guard.fence.attempt,
            guard.fence.leaseToken,
            guard.notAfter ?? null,
          ],
        );
    }
  })();
  return result.rows[0]?.current === true;
}

export async function appendPostgresEventIfRunCurrent(input: {
  db: Queryable;
  operation: AppendEventIfRunCurrentInput;
}): Promise<AppendEventIfRunCurrentResult> {
  const { operation } = input;
  const event: StoredEvent = {
    id: `event_${randomUUID()}`,
    sessionId: operation.sessionId,
    sourceType: operation.sourceType,
    payload: operation.payload,
    createdAt: new Date().toISOString(),
  };
  if (!isConnectablePostgres(input.db)) {
    throw new Error('postgres_atomic_run_event_commit_unavailable');
  }
  const client = await input.db.connect();
  try {
    await client.query('BEGIN');
    const current = await lockPostgresRunCommitOwner(client, operation);
    if (!current) {
      await client.query('COMMIT');
      return { status: 'stale' };
    }
    const result = await client.query(
      `INSERT INTO conversation_events
         (id, session_id, source_type, payload, created_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [
        event.id,
        event.sessionId,
        event.sourceType,
        event.payload,
        event.createdAt,
      ],
    );
    if (result.rowCount !== 1) {
      throw new Error('postgres_run_event_commit_missing');
    }
    await client.query('COMMIT');
    return { status: 'committed', event };
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
