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
import { d1RunCommitEligibility } from './d1StoreTurnCommit.js';
import type {
  D1DatabaseLike,
  D1PreparedStatement,
  StoredEventRow,
} from './d1StoreSupport.js';
import {
  storedEventFromRow,
  turnFromRow,
  type ConversationTurnRow,
} from './d1StoreSupport.js';
import { verifiedRefStorageValues } from './verifiedRef.js';

export async function commitD1ConfirmationTurnIfRunCurrent(input: {
  db: D1DatabaseLike;
  operation: CommitConfirmationTurnIfRunCurrentInput;
}): Promise<CommitConfirmationTurnIfRunCurrentResult> {
  if (!input.db.batch) {
    throw new Error('d1_atomic_confirmation_turn_commit_unavailable');
  }
  const prepared = await prepareConfirmationTurnCommit(input.operation);
  const eligibility = d1RunCommitEligibility({
    sessionId: prepared.record.sessionId,
    fence: input.operation.fence,
    notAfter: earlierExpiry(
      input.operation.notAfter,
      prepared.record.expiresAt,
    ),
  });
  const values = confirmationPauseStorageValues(
    prepared.record,
    0,
    input.operation.fence.sessionAuthorityGeneration,
    prepared.identityDigest,
  );
  const pauseValues = [...values.slice(0, 6), ...values.slice(7)];
  const statements: D1PreparedStatement[] = [
    input.db
      .prepare(
        `INSERT INTO confirmation_pause_sessions (session_id, generation)
       SELECT ?, 0 WHERE ${eligibility.sql}
       ON CONFLICT(session_id) DO UPDATE SET
         generation = confirmation_pause_sessions.generation`,
      )
      .bind(prepared.record.sessionId, ...eligibility.bindings),
    input.db
      .prepare(
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
       WHERE session_id = ? AND ${eligibility.sql}`,
      )
      .bind(...pauseValues, prepared.record.sessionId, ...eligibility.bindings),
  ];
  for (const record of prepared.verifiedRefs) {
    statements.push(
      conditionalVerifiedRef(input.db, record, prepared, eligibility),
    );
  }
  statements.push(
    conditionalEvent(input.db, prepared.stateEvent, prepared, eligibility),
    conditionalEvent(input.db, prepared.pauseEvent, prepared, eligibility),
    conditionalTurn(input.db, prepared, eligibility),
    conditionalEvent(input.db, prepared.turnEvent, prepared, eligibility),
  );
  if (prepared.auditEvent) {
    statements.push(
      conditionalEvent(input.db, prepared.auditEvent, prepared, eligibility),
    );
  }
  const results = await input.db.batch(statements);
  if (Number(results[0]?.meta.changes ?? 0) !== 1) return { status: 'stale' };
  const [snapshot, turn, events] = await Promise.all([
    readPause(input.db, prepared.record.requestId),
    readTurn(input.db, prepared.turn.id),
    readEvents(input.db, [
      prepared.stateEvent.id,
      prepared.pauseEvent.id,
      prepared.turnEvent.id,
    ]),
  ]);
  const exact =
    snapshot?.identityDigest === prepared.identityDigest &&
    turn &&
    JSON.stringify(turn) === JSON.stringify(prepared.turn) &&
    events.length === 3;
  if (!exact || !snapshot || !turn) return { status: 'conflict' };
  return {
    status: Number(results[1]?.meta.changes ?? 0) === 1 ? 'created' : 'replay',
    stateEvent: events.find(({ id }) => id === prepared.stateEvent.id)!,
    pauseEvent: events.find(({ id }) => id === prepared.pauseEvent.id)!,
    turnEvent: events.find(({ id }) => id === prepared.turnEvent.id)!,
    turn,
    record: snapshot.record,
    verifiedRefs: structuredClone(prepared.verifiedRefs),
  };
}

function conditionalVerifiedRef(
  db: D1DatabaseLike,
  record: Awaited<
    ReturnType<typeof prepareConfirmationTurnCommit>
  >['verifiedRefs'][number],
  prepared: Awaited<ReturnType<typeof prepareConfirmationTurnCommit>>,
  eligible: { sql: string; bindings: unknown[] },
) {
  const values = verifiedRefStorageValues(record, 0);
  const withoutGeneration = [...values.slice(0, 4), ...values.slice(5)];
  return db
    .prepare(
      `INSERT OR IGNORE INTO verified_refs (
         schema_version, ref_id, kind, session_id,
         session_generation, customer_id, channel,
         authenticated_subject, authentication_evidence_ref,
         verified_revision, lifecycle, payload_json, created_at,
         expires_at, claimed_use_id, claimed_at
       )
       SELECT ?, ?, ?, ?, generation, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       FROM confirmation_pause_sessions
       WHERE session_id = ? AND ${eligible.sql}
         AND EXISTS (SELECT 1 FROM confirmation_pauses
           WHERE request_id = ? AND pause_identity_digest = ?)`,
    )
    .bind(
      ...withoutGeneration,
      prepared.record.sessionId,
      ...eligible.bindings,
      prepared.record.requestId,
      prepared.identityDigest,
    );
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
  prepared: Awaited<ReturnType<typeof prepareConfirmationTurnCommit>>,
  eligible: { sql: string; bindings: unknown[] },
) {
  return db
    .prepare(
      `INSERT OR IGNORE INTO conversation_events
       (id, session_id, source_type, payload, created_at)
     SELECT ?, ?, ?, ?, ? WHERE ${eligible.sql}
       AND EXISTS (SELECT 1 FROM confirmation_pauses
         WHERE request_id = ? AND pause_identity_digest = ?)`,
    )
    .bind(
      event.id,
      event.sessionId,
      event.sourceType,
      JSON.stringify(event.payload),
      event.createdAt,
      ...eligible.bindings,
      prepared.record.requestId,
      prepared.identityDigest,
    );
}

function conditionalTurn(
  db: D1DatabaseLike,
  prepared: Awaited<ReturnType<typeof prepareConfirmationTurnCommit>>,
  eligible: { sql: string; bindings: unknown[] },
) {
  const turn = prepared.turn;
  return db
    .prepare(
      `INSERT OR IGNORE INTO conversation_turns (
       id, session_id, channel, role, text, external_message_id,
       external_user_id, delivery_status, metadata, created_at
     ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${eligible.sql}
       AND EXISTS (SELECT 1 FROM confirmation_pauses
         WHERE request_id = ? AND pause_identity_digest = ?)`,
    )
    .bind(
      turn.id,
      turn.sessionId,
      turn.channel,
      turn.role,
      turn.text,
      turn.externalMessageId,
      turn.externalUserId,
      turn.deliveryStatus,
      JSON.stringify(turn.metadata),
      turn.createdAt,
      ...eligible.bindings,
      prepared.record.requestId,
      prepared.identityDigest,
    );
}

async function readPause(db: D1DatabaseLike, requestId: string) {
  const row = await db
    .prepare(
      `SELECT pause.* FROM confirmation_pauses AS pause
     JOIN confirmation_pause_sessions AS session
       ON session.session_id = pause.session_id
      AND session.generation = pause.session_generation
     WHERE pause.request_id = ?
       AND ${currentConfirmationPauseAuthoritySql('pause')} LIMIT 1`,
    )
    .bind(requestId)
    .first<ConfirmationPauseStorageRow>();
  return row ? confirmationPauseSnapshotFromStorageRow(row) : undefined;
}

async function readTurn(db: D1DatabaseLike, id: string) {
  const row = await db
    .prepare('SELECT * FROM conversation_turns WHERE id = ? LIMIT 1')
    .bind(id)
    .first<ConversationTurnRow>();
  return row ? turnFromRow(row) : undefined;
}

async function readEvents(db: D1DatabaseLike, ids: string[]) {
  const rows = await db
    .prepare('SELECT * FROM conversation_events WHERE id IN (?, ?, ?)')
    .bind(...ids)
    .all<StoredEventRow>();
  return (rows.results ?? []).map(storedEventFromRow);
}

function earlierExpiry(left: string | undefined, right: string): string {
  return left === undefined || right < left ? right : left;
}
