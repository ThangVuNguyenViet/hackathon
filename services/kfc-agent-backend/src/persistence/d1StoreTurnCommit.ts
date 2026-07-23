import type {
  CommitAssistantTurnIfRunCurrentInput,
  CommitAssistantTurnIfRunCurrentResult,
  RunCommitFence,
} from './contracts.js';
import {
  turnFromRow,
  type ConversationTurnRow,
  type D1DatabaseLike,
  type D1PreparedStatement,
} from './d1StoreSupport.js';
import { prepareAssistantTurnCommit } from './runCommitPreparation.js';
import { verifiedRefStorageValues } from './verifiedRef.js';

export interface D1RunCommitPredicate {
  sql: string;
  bindings: unknown[];
}

export async function commitD1AssistantTurnIfRunCurrent(input: {
  db: D1DatabaseLike;
  operation: CommitAssistantTurnIfRunCurrentInput;
}): Promise<CommitAssistantTurnIfRunCurrentResult> {
  if (!input.db.batch) {
    throw new Error('d1_atomic_agent_turn_commit_unavailable');
  }
  const prepared = prepareAssistantTurnCommit(input.operation);
  const statements: D1PreparedStatement[] = [];
  const requiredResultIndexes: number[] = [];

  if (prepared.verifiedRefs.length > 0) {
    const eligible = assistantTurnEligibility(input.operation);
    statements.push(
      input.db
        .prepare(
          `INSERT OR IGNORE INTO session_generations
           (session_id, generation)
         SELECT ?, 0
         WHERE ${eligible.sql}`,
        )
        .bind(prepared.turn.sessionId, ...eligible.bindings),
    );
    for (const record of prepared.verifiedRefs) {
      const values = verifiedRefStorageValues(record, 0);
      const withoutGeneration = [...values.slice(0, 4), ...values.slice(5)];
      const current = assistantTurnEligibility(input.operation);
      requiredResultIndexes.push(statements.length);
      statements.push(
        input.db
          .prepare(
            `INSERT INTO verified_refs (
             schema_version, ref_id, kind, session_id,
             session_generation, customer_id, channel,
             authenticated_subject, authentication_evidence_ref,
             verified_revision, lifecycle, payload_json, created_at,
             expires_at, claimed_use_id, claimed_at
           )
           SELECT ?, ?, ?, ?, generation, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
           FROM session_generations
           WHERE session_id = ?
             AND ${current.sql}`,
          )
          .bind(
            ...withoutGeneration,
            prepared.turn.sessionId,
            ...current.bindings,
          ),
      );
    }
  }

  requiredResultIndexes.push(statements.length);
  statements.push(
    eventStatement(
      input.db,
      prepared.stateEvent,
      assistantTurnEligibility(input.operation),
    ),
  );
  if (input.operation.packState) {
    const packState = input.operation.packState;
    if (packState.sessionId !== prepared.turn.sessionId) {
      throw new Error('agent_turn_commit_pack_state_session_mismatch');
    }
    const eligible = assistantTurnEligibility(input.operation);
    requiredResultIndexes.push(statements.length);
    statements.push(
      input.db
        .prepare(
          `INSERT INTO pack_state_projections (
             session_id, pack_id, pack_version, envelope_json, updated_at
           )
           SELECT ?, ?, ?, ?, ?
           WHERE ${eligible.sql}
           ON CONFLICT(session_id, pack_id, pack_version) DO UPDATE SET
             envelope_json = excluded.envelope_json,
             updated_at = excluded.updated_at`,
        )
        .bind(
          packState.sessionId,
          packState.envelope.packRef.packId,
          packState.envelope.packRef.version,
          JSON.stringify(packState.envelope),
          prepared.turn.createdAt,
          ...eligible.bindings,
        ),
    );
  }
  requiredResultIndexes.push(statements.length);
  statements.push(
    turnStatement(
      input.db,
      prepared.turn,
      assistantTurnEligibility(input.operation),
    ),
  );
  requiredResultIndexes.push(statements.length);
  statements.push(
    eventStatement(
      input.db,
      prepared.turnEvent,
      assistantTurnEligibility(input.operation),
    ),
  );

  const results = await input.db.batch(statements);
  const changes = requiredResultIndexes.map((index) =>
    Number(results[index]?.meta.changes ?? 0),
  );
  if (changes.every((count) => count === 0)) return { status: 'stale' };
  if (!changes.every((count) => count === 1)) {
    throw new Error('d1_atomic_agent_turn_commit_inconsistent');
  }
  const turnRow = await input.db
    .prepare(`SELECT * FROM conversation_turns WHERE id = ? LIMIT 1`)
    .bind(prepared.turn.id)
    .first<ConversationTurnRow>();
  if (!turnRow) throw new Error('d1_atomic_agent_turn_commit_missing_turn');
  return {
    status: 'committed',
    ...structuredClone(prepared),
    turn: turnFromRow(turnRow),
  };
}

function eventStatement(
  db: D1DatabaseLike,
  event: {
    id: string;
    sessionId: string;
    sourceType: string;
    payload: Record<string, unknown>;
    createdAt: string;
  },
  eligible: D1RunCommitPredicate,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO conversation_events
       (id, session_id, source_type, payload, created_at)
     SELECT ?, ?, ?, ?, ?
     WHERE ${eligible.sql}`,
    )
    .bind(
      event.id,
      event.sessionId,
      event.sourceType,
      JSON.stringify(event.payload),
      event.createdAt,
      ...eligible.bindings,
    );
}

function turnStatement(
  db: D1DatabaseLike,
  turn: {
    id: string;
    sessionId: string;
    channel: string;
    role: string;
    text: string;
    externalMessageId: string | null;
    externalUserId: string | null;
    deliveryStatus: string;
    metadata: unknown;
    createdAt: string;
  },
  eligible: D1RunCommitPredicate,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO conversation_turns (
       id, session_id, ordinal, channel, role, text, external_message_id,
       external_user_id, delivery_status, metadata, created_at
     )
     SELECT ?, ?, COALESCE((
       SELECT MAX(ordinal) FROM conversation_turns WHERE session_id = ?
     ), 0) + 1, ?, ?, ?, ?, ?, ?, ?, ?
     WHERE ${eligible.sql}`,
    )
    .bind(
      turn.id,
      turn.sessionId,
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
    );
}

export function d1RunCommitEligibility(input: {
  sessionId: string;
  fence: RunCommitFence;
  notAfter?: string;
}): D1RunCommitPredicate {
  const owner = runOwnerPredicate(input.sessionId, input.fence);
  return {
    sql: `(? IS NULL OR unixepoch('now') < unixepoch(?))
      AND ${owner.sql}`,
    bindings: [
      input.notAfter ?? null,
      input.notAfter ?? null,
      ...owner.bindings,
    ],
  };
}

function assistantTurnEligibility(
  input: CommitAssistantTurnIfRunCurrentInput,
): D1RunCommitPredicate {
  return d1RunCommitEligibility({
    sessionId: input.stateEvent.sessionId,
    fence: input.fence,
    ...(input.notAfter === undefined ? {} : { notAfter: input.notAfter }),
  });
}

function runOwnerPredicate(
  sessionId: string,
  fence: RunCommitFence,
): D1RunCommitPredicate {
  const owner: D1RunCommitPredicate = (() => {
    switch (fence.kind) {
      case 'agent_run':
        return {
          sql: `EXISTS (
          SELECT 1
          FROM session_agent_state AS state
          INNER JOIN agent_runs AS run
            ON run.id = state.current_run_id
           AND run.session_id = state.session_id
           AND run.generation = state.generation
          WHERE state.session_id = ?
            AND state.current_run_id = ?
            AND state.generation = ?
            AND run.session_authority_generation = ?
            AND run.status = 'running'
            AND run.execution_attempt = ?
            AND run.execution_lease_token = ?
            AND run.execution_lease_expires_at IS NOT NULL
            AND unixepoch('now') < unixepoch(run.execution_lease_expires_at)
        )`,
          bindings: [
            sessionId,
            fence.runId,
            fence.generation,
            fence.sessionAuthorityGeneration,
            fence.executionAttempt,
            fence.executionLeaseToken,
          ],
        };
      case 'customer_run':
        return {
          sql: `EXISTS (
          SELECT 1
          FROM customer_runs AS run
          WHERE run.id = ?
            AND run.session_id = ?
            AND run.session_authority_generation = ?
            AND run.status IN ('accepted', 'running')
        )`,
          bindings: [fence.runId, sessionId, fence.sessionAuthorityGeneration],
        };
      case 'operation_lease':
        return {
          sql: `EXISTS (
          SELECT 1
          FROM irreversible_operations AS operation
          WHERE operation.request_id = ?
            AND operation.session_id = ?
            AND operation.operation = ?
            AND operation.binding_fingerprint = ?
            AND operation.session_authority_generation = ?
            AND operation.status = 'attempting'
            AND operation.attempt_count = ?
            AND operation.lease_token = ?
            AND unixepoch('now') < unixepoch(operation.lease_expires_at)
        )`,
          bindings: [
            fence.requestId,
            sessionId,
            fence.operation,
            fence.bindingFingerprint,
            fence.sessionAuthorityGeneration,
            fence.attempt,
            fence.leaseToken,
          ],
        };
    }
  })();
  return {
    sql: `${owner.sql}
      AND (
        EXISTS (
          SELECT 1
          FROM session_controls AS control
          WHERE control.session_id = ?
            AND control.agent_mode = 'ai_active'
            AND control.session_authority_generation = ?
        )
        OR (
          ? = 0
          AND NOT EXISTS (
            SELECT 1
            FROM session_controls AS control
            WHERE control.session_id = ?
          )
        )
      )`,
    bindings: [
      ...owner.bindings,
      sessionId,
      fence.sessionAuthorityGeneration,
      fence.sessionAuthorityGeneration,
      sessionId,
    ],
  };
}
