import type {
  CommitConfirmationPauseIfRunCurrentInput,
  CommitConfirmationPauseIfRunCurrentResult,
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
  d1RunCommitEligibility,
} from './d1StoreTurnCommit.js';
import type {
  D1DatabaseLike,
  StoredEventRow,
} from './d1StoreSupport.js';
import {
  storedEventFromRow,
} from './d1StoreSupport.js';

export async function commitD1ConfirmationPauseIfRunCurrent(input: {
  db: D1DatabaseLike;
  operation: CommitConfirmationPauseIfRunCurrentInput;
}): Promise<CommitConfirmationPauseIfRunCurrentResult> {
  if (!input.db.batch) {
    throw new Error('d1_atomic_confirmation_pause_commit_unavailable');
  }
  const prepared = await prepareConfirmationPauseCommit(input.operation);
  const eligible = () => d1RunCommitEligibility({
    sessionId: prepared.record.sessionId,
    fence: prepared.input.fence,
    notAfter: earlierExpiry(
      prepared.input.notAfter,
      prepared.record.expiresAt,
    ),
  });
  const gate = eligible();
  const pause = eligible();
  const state = eligible();
  const audit = eligible();
  const values = confirmationPauseStorageValues(
    prepared.record,
    0,
    prepared.input.fence.sessionAuthorityGeneration,
    prepared.identityDigest,
  );
  const pauseValues = [
    ...values.slice(0, 6),
    ...values.slice(7),
  ];
  const results = await input.db.batch([
    input.db.prepare(
      `INSERT INTO confirmation_pause_sessions (session_id, generation)
       SELECT ?, 0
       WHERE ${gate.sql}
       ON CONFLICT(session_id) DO UPDATE SET
         generation = confirmation_pause_sessions.generation`,
    ).bind(
      prepared.record.sessionId,
      ...gate.bindings,
    ),
    input.db.prepare(
      `INSERT OR IGNORE INTO confirmation_pauses (
         schema_version, request_id, checkpoint_thread_id,
         checkpoint_namespace, checkpoint_id, session_id,
         session_generation, session_authority_generation,
         pause_identity_digest, customer_id, channel,
         action_json, action_digest, approval_binding_json,
         approval_binding_digest, principal_json, authenticated_subject,
         authentication_evidence_ref, created_at, expires_at, status,
         rejection_receipt_id, rejection_receipt_json, rejected_at,
         completion_status, result_json, completion_error, completed_at
       )
       SELECT ?, ?, ?, ?, ?, ?, generation, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
              ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       FROM confirmation_pause_sessions
       WHERE session_id = ?
         AND ${pause.sql}`,
    ).bind(
      ...pauseValues,
      prepared.record.sessionId,
      ...pause.bindings,
    ),
    conditionalEvent(
      input.db,
      prepared.stateEvent,
      prepared.record.requestId,
      prepared.identityDigest,
      state,
    ),
    conditionalEvent(
      input.db,
      prepared.pauseEvent,
      prepared.record.requestId,
      prepared.identityDigest,
      audit,
    ),
  ]);
  if (Number(results[0]?.meta.changes ?? 0) !== 1) {
    return { status: 'stale' };
  }
  const snapshot = await readPause(
    input.db,
    prepared.record.requestId,
  );
  if (
    !snapshot ||
    snapshot.identityDigest !== prepared.identityDigest
  ) {
    return { status: 'conflict' };
  }
  const events = await readEvents(
    input.db,
    prepared.stateEvent.id,
    prepared.pauseEvent.id,
  );
  if (!events) return { status: 'conflict' };
  return {
    status:
      Number(results[1]?.meta.changes ?? 0) === 1
        ? 'created'
        : 'replay',
    stateEvent: events.stateEvent,
    pauseEvent: events.pauseEvent,
    record: snapshot.record,
  };
}

function conditionalEvent(
  db: D1DatabaseLike,
  event: {
    id: string;
    sessionId: string;
    sourceType: string;
    payload: Record<string, unknown>;
    createdAt: string;
  },
  requestId: string,
  identityDigest: string,
  eligible: { sql: string; bindings: unknown[] },
) {
  return db.prepare(
    `INSERT OR IGNORE INTO conversation_events
       (id, session_id, source_type, payload, created_at)
     SELECT ?, ?, ?, ?, ?
     WHERE ${eligible.sql}
       AND EXISTS (
         SELECT 1
         FROM confirmation_pauses
         WHERE request_id = ?
           AND pause_identity_digest = ?
       )`,
  ).bind(
    event.id,
    event.sessionId,
    event.sourceType,
    JSON.stringify(event.payload),
    event.createdAt,
    ...eligible.bindings,
    requestId,
    identityDigest,
  );
}

async function readPause(
  db: D1DatabaseLike,
  requestId: string,
) {
  const row = await db.prepare(
    `SELECT pause.*
     FROM confirmation_pauses AS pause
     JOIN confirmation_pause_sessions AS session
       ON session.session_id = pause.session_id
      AND session.generation = pause.session_generation
     WHERE pause.request_id = ?
       AND ${currentConfirmationPauseAuthoritySql('pause')}
     LIMIT 1`,
  ).bind(requestId).first<ConfirmationPauseStorageRow>();
  return row
    ? confirmationPauseSnapshotFromStorageRow(row)
    : undefined;
}

async function readEvents(
  db: D1DatabaseLike,
  stateEventId: string,
  pauseEventId: string,
) {
  const rows = await db.prepare(
    `SELECT *
     FROM conversation_events
     WHERE id IN (?, ?)`,
  ).bind(stateEventId, pauseEventId).all<StoredEventRow>();
  const events = (rows.results ?? []).map(storedEventFromRow);
  const stateEvent = events.find(({ id }) => id === stateEventId);
  const pauseEvent = events.find(({ id }) => id === pauseEventId);
  return stateEvent && pauseEvent
    ? { stateEvent, pauseEvent }
    : undefined;
}

function earlierExpiry(
  left: string | undefined,
  right: string,
): string {
  return left === undefined || right < left ? right : left;
}
