import type { PoolClient } from 'pg';
import type {
  CommitConfirmationPauseIfRunCurrentInput,
  CommitConfirmationPauseIfRunCurrentResult,
  StoredEvent,
} from './contracts.js';
import {
  confirmationPauseSnapshotFromStorageRow,
  confirmationPauseStorageValues,
  currentConfirmationPauseAuthoritySql,
  type ConfirmationPauseStorageRow,
} from './confirmationPause.js';
import {
  prepareConfirmationPauseCommit,
} from './confirmationPauseCommitPreparation.js';
import {
  isConnectablePostgres,
  lockPostgresRunCommitOwner,
} from './postgresStoreRunOwner.js';
import type {
  Queryable,
  StoredEventRow,
} from './postgresStoreSupport.js';
import {
  storedEventFromRow,
} from './postgresStoreSupport.js';

export async function commitPostgresConfirmationPauseIfRunCurrent(input: {
  db: Queryable;
  operation: CommitConfirmationPauseIfRunCurrentInput;
}): Promise<CommitConfirmationPauseIfRunCurrentResult> {
  if (!isConnectablePostgres(input.db)) {
    throw new Error('postgres_atomic_confirmation_pause_commit_unavailable');
  }
  const prepared = await prepareConfirmationPauseCommit(input.operation);
  const client = await input.db.connect();
  try {
    await client.query('BEGIN');
    if (!await lockPostgresRunCommitOwner(client, {
      sessionId: prepared.record.sessionId,
      fence: prepared.input.fence,
      notAfter: earlierExpiry(
        prepared.input.notAfter,
        prepared.record.expiresAt,
      ),
    })) {
      await client.query('ROLLBACK');
      return { status: 'stale' };
    }
    const generation = await lockPauseGeneration(
      client,
      prepared.record.sessionId,
    );
    const existing = await readPause(
      client,
      prepared.record.requestId,
    );
    if (existing) {
      const replay = await replayResult(client, prepared, existing);
      await client.query('ROLLBACK');
      return replay;
    }
    await client.query(
      `INSERT INTO confirmation_pauses (
         schema_version, request_id, checkpoint_thread_id,
         checkpoint_namespace, checkpoint_id, session_id,
         session_generation, session_authority_generation,
         pause_identity_digest, customer_id, channel,
         action_json, action_digest, approval_binding_json,
         approval_binding_digest, principal_json, authenticated_subject,
         authentication_evidence_ref, created_at, expires_at, status,
         rejection_receipt_id, rejection_receipt_json, rejected_at,
         completion_status, result_json, completion_error, completed_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
         $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26,
         $27, $28
       )`,
      [
        ...confirmationPauseStorageValues(
          prepared.record,
          generation,
          prepared.input.fence.sessionAuthorityGeneration,
          prepared.identityDigest,
        ),
      ],
    );
    await insertEvent(client, prepared.stateEvent);
    await insertEvent(client, prepared.pauseEvent);
    await client.query('COMMIT');
    return {
      status: 'created',
      stateEvent: structuredClone(prepared.stateEvent),
      pauseEvent: structuredClone(prepared.pauseEvent),
      record: structuredClone(prepared.record),
    };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the original error; an uncertain transaction is fail-closed.
    }
    throw error;
  } finally {
    client.release();
  }
}

async function lockPauseGeneration(
  client: PoolClient,
  sessionId: string,
): Promise<number> {
  const result = await client.query<{ generation: number }>(
    `INSERT INTO confirmation_pause_sessions (session_id, generation)
     VALUES ($1, 0)
     ON CONFLICT (session_id) DO UPDATE SET
       generation = confirmation_pause_sessions.generation
     RETURNING generation`,
    [sessionId],
  );
  const generation = result.rows[0]?.generation;
  if (generation === undefined) {
    throw new Error('confirmation_pause_generation_missing');
  }
  return generation;
}

async function readPause(
  client: PoolClient,
  requestId: string,
) {
  const result = await client.query<ConfirmationPauseStorageRow>(
    `SELECT pause.*
     FROM confirmation_pauses AS pause
     JOIN confirmation_pause_sessions AS session
       ON session.session_id = pause.session_id
      AND session.generation = pause.session_generation
     WHERE pause.request_id = $1
       AND ${currentConfirmationPauseAuthoritySql('pause')}
     FOR UPDATE OF pause`,
    [requestId],
  );
  return result.rows[0]
    ? confirmationPauseSnapshotFromStorageRow(result.rows[0])
    : undefined;
}

async function replayResult(
  client: PoolClient,
  prepared: Awaited<
    ReturnType<typeof prepareConfirmationPauseCommit>
  >,
  existing: Awaited<ReturnType<typeof readPause>>,
): Promise<CommitConfirmationPauseIfRunCurrentResult> {
  if (
    !existing ||
    existing.identityDigest !== prepared.identityDigest
  ) {
    return { status: 'conflict' };
  }
  const result = await client.query<StoredEventRow>(
    `SELECT *
     FROM conversation_events
     WHERE id IN ($1, $2)`,
    [prepared.stateEvent.id, prepared.pauseEvent.id],
  );
  const events = result.rows.map(storedEventFromRow);
  const stateEvent = events.find(
    ({ id }) => id === prepared.stateEvent.id,
  );
  const pauseEvent = events.find(
    ({ id }) => id === prepared.pauseEvent.id,
  );
  return stateEvent && pauseEvent
    ? {
        status: 'replay',
        stateEvent,
        pauseEvent,
        record: existing.record,
      }
    : { status: 'conflict' };
}

async function insertEvent(
  client: PoolClient,
  event: StoredEvent,
): Promise<void> {
  await client.query(
    `INSERT INTO conversation_events
       (id, session_id, source_type, payload, created_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      event.id,
      event.sessionId,
      event.sourceType,
      event.payload,
      event.createdAt,
    ],
  );
}

function earlierExpiry(
  left: string | undefined,
  right: string,
): string {
  return left === undefined || right < left ? right : left;
}
