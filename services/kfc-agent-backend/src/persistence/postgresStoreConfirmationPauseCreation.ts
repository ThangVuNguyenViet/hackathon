import type {
  CreateConfirmationPauseInput,
  CreateConfirmationPauseResult,
  SessionControl,
} from './contracts.js';
import {
  confirmationPauseIdentityDigest,
  confirmationPauseSnapshotFromStorageRow,
  confirmationPauseStorageValues,
  currentConfirmationPauseAuthoritySql,
  immutableConfirmationPauseMatches,
  parseCreateConfirmationPauseInput,
  parseCreateConfirmationPauseShape,
  pendingConfirmationPause,
  type ConfirmationPauseStorageRow,
} from './confirmationPause.js';
import { isConnectablePostgres } from './postgresStoreRunOwner.js';
import { captureActivePostgresSessionAuthority } from './postgresStoreSessionAuthority.js';
import type { Queryable } from './postgresStoreSupport.js';

export async function createPostgresConfirmationPause(input: {
  db: Queryable;
  value: CreateConfirmationPauseInput;
  readSessionControl(
    sessionId: string,
  ): Promise<SessionControl>;
}): Promise<CreateConfirmationPauseResult> {
  const shape = parseCreateConfirmationPauseShape(input.value);
  const capturedPauseGeneration = (
    await input.db.query<{ generation: number }>(
      `INSERT INTO confirmation_pause_sessions (session_id, generation)
       VALUES ($1, 0)
       ON CONFLICT (session_id) DO UPDATE SET
         generation = confirmation_pause_sessions.generation
       RETURNING generation`,
      [shape.sessionId],
    )
  ).rows[0]?.generation;
  if (capturedPauseGeneration === undefined) {
    throw new Error('confirmation_pause_generation_missing');
  }
  const capturedControl = await input.readSessionControl(shape.sessionId);
  if (capturedControl.agentMode !== 'ai_active') {
    return { status: 'conflict' };
  }
  const pause = await parseCreateConfirmationPauseInput(shape);
  const record = pendingConfirmationPause(pause);
  const identityDigest = await confirmationPauseIdentityDigest(pause);
  if (!isConnectablePostgres(input.db)) {
    throw new Error('postgres_atomic_confirmation_pause_create_unavailable');
  }
  const client = await input.db.connect();
  try {
    await client.query('BEGIN');
    const sessionAuthorityGeneration =
      await captureActivePostgresSessionAuthority(
        client,
        pause.sessionId,
      );
    if (
      sessionAuthorityGeneration === undefined ||
      sessionAuthorityGeneration !==
        capturedControl.sessionAuthorityGeneration
    ) {
      await client.query('ROLLBACK');
      return { status: 'conflict' };
    }
    const generationResult = await client.query<{ generation: number }>(
      `INSERT INTO confirmation_pause_sessions (session_id, generation)
       VALUES ($1, 0)
       ON CONFLICT (session_id) DO UPDATE SET
         generation = confirmation_pause_sessions.generation
       RETURNING generation`,
      [shape.sessionId],
    );
    const sessionGeneration = generationResult.rows[0]?.generation;
    if (sessionGeneration === undefined) {
      throw new Error('confirmation_pause_generation_missing');
    }
    if (sessionGeneration !== capturedPauseGeneration) {
      await client.query('ROLLBACK');
      return { status: 'conflict' };
    }
    const result = await client.query<ConfirmationPauseStorageRow>(
      `INSERT INTO confirmation_pauses (
        schema_version, request_id, checkpoint_thread_id,
        checkpoint_namespace, checkpoint_id, session_id,
        session_generation, session_authority_generation,
        pause_identity_digest, customer_id, channel, action_json,
        action_digest, approval_binding_json, approval_binding_digest,
        principal_json, authenticated_subject,
        authentication_evidence_ref, created_at, expires_at, status,
        rejection_receipt_id, rejection_receipt_json, rejected_at,
        completion_status, result_json, completion_error, completed_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
        $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26,
        $27, $28
      )
      ON CONFLICT (request_id) DO NOTHING
      RETURNING *`,
      [
        ...confirmationPauseStorageValues(
          record,
          sessionGeneration,
          sessionAuthorityGeneration,
          identityDigest,
        ),
      ],
    );
    const row = result.rows[0] ?? (
      await client.query<ConfirmationPauseStorageRow>(
        `SELECT pause.*
         FROM confirmation_pauses AS pause
         JOIN confirmation_pause_sessions AS session
           ON session.session_id = pause.session_id
          AND session.generation = pause.session_generation
         WHERE pause.request_id = $1
           AND ${currentConfirmationPauseAuthoritySql('pause')}
         FOR UPDATE OF pause`,
        [pause.requestId],
      )
    ).rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      return { status: 'conflict' };
    }
    const snapshot = await confirmationPauseSnapshotFromStorageRow(row);
    const authorityMatches =
      snapshot.sessionGeneration === sessionGeneration &&
      snapshot.sessionAuthorityGeneration === sessionAuthorityGeneration &&
      snapshot.identityDigest === identityDigest;
    const status =
      result.rows[0] !== undefined
        ? (authorityMatches ? 'created' : 'conflict')
        : (
            authorityMatches &&
            immutableConfirmationPauseMatches(snapshot.record, pause)
              ? 'replay'
              : 'conflict'
          );
    if (status === 'conflict') {
      await client.query('ROLLBACK');
      return { status };
    }
    await client.query('COMMIT');
    return { status, record: snapshot.record };
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
