import type { PoolClient } from 'pg';
import type {
  CommitConfirmationTurnIfRunCurrentInput,
  CommitConfirmationTurnIfRunCurrentResult,
} from './contracts.js';
import {
  confirmationPauseSnapshotFromStorageRow,
  confirmationPauseStorageValues,
  currentConfirmationPauseAuthoritySql,
  type ConfirmationPauseStorageRow,
} from './confirmationPause.js';
import { prepareConfirmationTurnCommit } from './confirmationTurnCommitPreparation.js';
import {
  isConnectablePostgres,
  lockPostgresRunCommitOwner,
} from './postgresStoreRunOwner.js';
import type {
  ConversationTurnRow,
  Queryable,
  StoredEventRow,
} from './postgresStoreSupport.js';
import { storedEventFromRow, turnFromRow } from './postgresStoreSupport.js';
import {
  insertPostgresEvent,
  insertPostgresVerifiedRef,
} from './postgresStoreTurnCommit.js';

export async function commitPostgresConfirmationTurnIfRunCurrent(input: {
  db: Queryable;
  operation: CommitConfirmationTurnIfRunCurrentInput;
}): Promise<CommitConfirmationTurnIfRunCurrentResult> {
  if (!isConnectablePostgres(input.db)) {
    throw new Error('postgres_atomic_confirmation_turn_commit_unavailable');
  }
  const prepared = await prepareConfirmationTurnCommit(input.operation);
  const client = await input.db.connect();
  try {
    await client.query('BEGIN');
    const current = await lockPostgresRunCommitOwner(client, {
      sessionId: prepared.record.sessionId,
      fence: input.operation.fence,
      notAfter: earlierExpiry(
        input.operation.notAfter,
        prepared.record.expiresAt,
      ),
    });
    if (!current) {
      await client.query('ROLLBACK');
      return { status: 'stale' };
    }
    const generation = await lockPauseGeneration(
      client,
      prepared.record.sessionId,
    );
    const existing = await readPause(client, prepared.record.requestId);
    if (existing) {
      const replay = await readPublishedConfirmationTurn(
        client,
        prepared,
        existing,
      );
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
          input.operation.fence.sessionAuthorityGeneration,
          prepared.identityDigest,
        ),
      ],
    );
    for (const record of prepared.verifiedRefs) {
      await insertPostgresVerifiedRef(client, record, generation);
    }
    await insertPostgresEvent(client, prepared.stateEvent);
    await insertPostgresEvent(client, prepared.pauseEvent);
    await insertTurn(client, prepared.turn);
    await insertPostgresEvent(client, prepared.turnEvent);
    if (prepared.auditEvent)
      await insertPostgresEvent(client, prepared.auditEvent);
    await client.query('COMMIT');
    return {
      status: 'created',
      stateEvent: structuredClone(prepared.stateEvent),
      pauseEvent: structuredClone(prepared.pauseEvent),
      turnEvent: structuredClone(prepared.turnEvent),
      turn: structuredClone(prepared.turn),
      record: structuredClone(prepared.record),
      verifiedRefs: structuredClone(prepared.verifiedRefs),
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

async function lockPauseGeneration(client: PoolClient, sessionId: string) {
  const result = await client.query<{ generation: number }>(
    `INSERT INTO confirmation_pause_sessions (session_id, generation)
     VALUES ($1, 0)
     ON CONFLICT (session_id) DO UPDATE SET
       generation = confirmation_pause_sessions.generation
     RETURNING generation`,
    [sessionId],
  );
  const generation = result.rows[0]?.generation;
  if (generation === undefined)
    throw new Error('confirmation_pause_generation_missing');
  return generation;
}

async function readPause(client: PoolClient, requestId: string) {
  const result = await client.query<ConfirmationPauseStorageRow>(
    `SELECT pause.* FROM confirmation_pauses AS pause
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

async function readPublishedConfirmationTurn(
  client: PoolClient,
  prepared: Awaited<ReturnType<typeof prepareConfirmationTurnCommit>>,
  existing: Awaited<ReturnType<typeof readPause>>,
): Promise<CommitConfirmationTurnIfRunCurrentResult> {
  if (!existing || existing.identityDigest !== prepared.identityDigest) {
    return { status: 'conflict' };
  }
  const [turnResult, eventResult] = await Promise.all([
    client.query<ConversationTurnRow>(
      'SELECT * FROM conversation_turns WHERE id = $1 LIMIT 1',
      [prepared.turn.id],
    ),
    client.query<StoredEventRow>(
      'SELECT * FROM conversation_events WHERE id IN ($1, $2, $3)',
      [prepared.stateEvent.id, prepared.pauseEvent.id, prepared.turnEvent.id],
    ),
  ]);
  const turn = turnResult.rows[0] ? turnFromRow(turnResult.rows[0]) : undefined;
  const events = eventResult.rows.map(storedEventFromRow);
  if (
    !turn ||
    JSON.stringify(turn) !== JSON.stringify(prepared.turn) ||
    events.length !== 3
  ) {
    return { status: 'conflict' };
  }
  return {
    status: 'replay',
    stateEvent: events.find(({ id }) => id === prepared.stateEvent.id)!,
    pauseEvent: events.find(({ id }) => id === prepared.pauseEvent.id)!,
    turnEvent: events.find(({ id }) => id === prepared.turnEvent.id)!,
    turn,
    record: existing.record,
    verifiedRefs: structuredClone(prepared.verifiedRefs),
  };
}

async function insertTurn(
  client: PoolClient,
  turn: Awaited<ReturnType<typeof prepareConfirmationTurnCommit>>['turn'],
) {
  await client.query(
    `INSERT INTO conversation_turns (
       id, session_id, channel, role, text, external_message_id,
       external_user_id, delivery_status, metadata, created_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      turn.id,
      turn.sessionId,
      turn.channel,
      turn.role,
      turn.text,
      turn.externalMessageId,
      turn.externalUserId,
      turn.deliveryStatus,
      turn.metadata,
      turn.createdAt,
    ],
  );
}

function earlierExpiry(left: string | undefined, right: string): string {
  return left === undefined || right < left ? right : left;
}
