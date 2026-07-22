import { CustomerRunIdempotencyConflictError } from '../customerRuns/contracts.js';
import type {
  CommitPausedCustomerRunIntakeInput,
  CommitPausedCustomerRunIntakeResult,
} from './contracts.js';
import {
  assertExactPausedCustomerRunReplay,
  assertExactPausedCustomerUserTurn,
  validatePausedCustomerRunIntake,
} from './pausedCustomerRunIntake.js';
import {
  customerRunEventFromRow,
  customerRunFromRow,
  turnFromRow,
  type ConversationTurnRow,
  type CustomerRunEventRow,
  type CustomerRunRow,
  type D1DatabaseLike,
} from './d1StoreSupport.js';

const pausedAuthoritySql = `EXISTS (
  SELECT 1
  FROM session_controls AS control
  WHERE control.session_id = ?
    AND control.agent_mode = 'human_paused'
    AND control.session_authority_generation = ?
)`;

export async function commitD1PausedCustomerRunIntake(input: {
  db: D1DatabaseLike;
  operation: CommitPausedCustomerRunIntakeInput;
}): Promise<CommitPausedCustomerRunIntakeResult> {
  const prepared = validatePausedCustomerRunIntake(input.operation);
  const replay = await existingReplay(input.db, input.operation);
  if (replay) return replay;
  await assertExistingTurnIsExact(input.db, input.operation);
  if (!input.db.batch) {
    throw new Error('d1_atomic_paused_customer_intake_unavailable');
  }

  const turnId = `turn_${crypto.randomUUID()}`;
  const turnCreatedAt =
    input.operation.userTurn.createdAt ?? new Date().toISOString();
  const metadata = JSON.stringify(input.operation.userTurn.metadata ?? null);
  const runAbsentSql = `NOT EXISTS (
    SELECT 1
    FROM customer_runs
    WHERE id = ?
       OR (
         session_id = ?
         AND client_message_id = ?
       )
  )`;
  const eventAbsentSql = `NOT EXISTS (
    SELECT 1
    FROM customer_run_events
    WHERE event_id = ?
  )`;
  const exactTurnSql = `EXISTS (
    SELECT 1
    FROM conversation_turns
    WHERE session_id = ?
      AND external_message_id = ?
      AND channel = ?
      AND role = 'user'
      AND text = ?
      AND external_user_id = ?
      AND delivery_status = 'received'
      AND NOT EXISTS (
        SELECT stored.fullkey, stored.type, stored.atom
        FROM json_tree(conversation_turns.metadata) AS stored
        EXCEPT
        SELECT expected.fullkey, expected.type, expected.atom
        FROM json_tree(?) AS expected
      )
      AND NOT EXISTS (
        SELECT expected.fullkey, expected.type, expected.atom
        FROM json_tree(?) AS expected
        EXCEPT
        SELECT stored.fullkey, stored.type, stored.atom
        FROM json_tree(conversation_turns.metadata) AS stored
      )
  )`;
  const commonBindings = [
    input.operation.run.sessionId,
    input.operation.expectedSessionAuthorityGeneration,
    input.operation.run.id,
    input.operation.run.sessionId,
    input.operation.run.clientMessageId,
    prepared.event.eventId,
  ];
  const results = await input.db.batch([
    input.db
      .prepare(
        `INSERT OR IGNORE INTO conversation_turns (
         id, session_id, channel, role, text, external_message_id,
         external_user_id, delivery_status, metadata, created_at
       )
       SELECT ?, ?, ?, 'user', ?, ?, ?, 'received', ?, ?
       WHERE ${pausedAuthoritySql}
         AND ${runAbsentSql}
         AND ${eventAbsentSql}`,
      )
      .bind(
        turnId,
        input.operation.userTurn.sessionId,
        input.operation.userTurn.channel,
        input.operation.userTurn.text,
        input.operation.userTurn.externalMessageId,
        input.operation.userTurn.externalUserId,
        metadata,
        turnCreatedAt,
        ...commonBindings,
      ),
    input.db
      .prepare(
        `INSERT OR IGNORE INTO customer_runs (
         id, schema_version, session_id, customer_id, client_message_id,
         request_fingerprint, generation, session_authority_generation,
         status, phase, next_event_sequence, client_schema_version,
         accepted_at, started_at, terminal_at, updated_at
       )
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       WHERE ${pausedAuthoritySql}
         AND ${runAbsentSql}
         AND ${eventAbsentSql}
         AND ${exactTurnSql}`,
      )
      .bind(
        input.operation.run.id,
        input.operation.run.schemaVersion,
        input.operation.run.sessionId,
        input.operation.run.customerId,
        input.operation.run.clientMessageId,
        input.operation.run.requestFingerprint,
        input.operation.run.generation,
        input.operation.expectedSessionAuthorityGeneration,
        input.operation.run.status,
        input.operation.run.phase,
        input.operation.run.nextEventSequence + 1,
        input.operation.run.clientSchemaVersion,
        input.operation.run.acceptedAt,
        input.operation.run.startedAt,
        input.operation.run.terminalAt,
        input.operation.run.updatedAt,
        ...commonBindings,
        input.operation.userTurn.sessionId,
        input.operation.userTurn.externalMessageId,
        input.operation.userTurn.channel,
        input.operation.userTurn.text,
        input.operation.userTurn.externalUserId,
        metadata,
        metadata,
      ),
    input.db
      .prepare(
        `INSERT OR IGNORE INTO customer_run_events (
         event_id, run_id, sequence, schema_version, type,
         occurred_at, payload
       )
       SELECT ?, ?, ?, ?, ?, ?, ?
       FROM customer_runs
       WHERE id = ?
         AND session_id = ?
         AND session_authority_generation = ?
         AND status = 'superseded'
         AND next_event_sequence = ?`,
      )
      .bind(
        prepared.event.eventId,
        prepared.event.runId,
        prepared.event.sequence,
        prepared.event.schemaVersion,
        prepared.event.type,
        prepared.event.occurredAt,
        JSON.stringify(prepared.event.payload),
        input.operation.run.id,
        input.operation.run.sessionId,
        input.operation.expectedSessionAuthorityGeneration,
        input.operation.run.nextEventSequence + 1,
      ),
  ]);
  const runInserted = Number(results[1]?.meta.changes ?? 0);
  const eventInserted = Number(results[2]?.meta.changes ?? 0);
  if (runInserted === 1 && eventInserted === 1) {
    const committed = await existingReplay(input.db, input.operation);
    if (!committed || committed.status !== 'replayed') {
      throw new Error('d1_paused_customer_intake_commit_missing');
    }
    return {
      status: 'committed',
      run: committed.run,
      turn: committed.turn,
      events: committed.events,
    };
  }
  if (runInserted !== 0 || eventInserted !== 0) {
    throw new Error('d1_atomic_paused_customer_intake_inconsistent');
  }
  const concurrentReplay = await existingReplay(input.db, input.operation);
  if (concurrentReplay) return concurrentReplay;
  await assertExistingTurnIsExact(input.db, input.operation);
  return { status: 'stale' };
}

async function existingReplay(
  db: D1DatabaseLike,
  input: CommitPausedCustomerRunIntakeInput,
): Promise<CommitPausedCustomerRunIntakeResult | undefined> {
  const row = await db
    .prepare(
      `SELECT *
     FROM customer_runs
     WHERE session_id = ?
       AND client_message_id = ?
     LIMIT 1`,
    )
    .bind(input.run.sessionId, input.run.clientMessageId)
    .first<CustomerRunRow>();
  if (!row) return undefined;
  const run = customerRunFromRow(row);
  if (run.requestFingerprint !== input.run.requestFingerprint) {
    throw new CustomerRunIdempotencyConflictError(
      input.run.sessionId,
      input.run.clientMessageId,
    );
  }
  const turn = await db
    .prepare(
      `SELECT *
     FROM conversation_turns
     WHERE session_id = ?
       AND external_message_id = ?
     LIMIT 1`,
    )
    .bind(input.run.sessionId, input.run.clientMessageId)
    .first<ConversationTurnRow>();
  const events = await db
    .prepare(
      `SELECT *
     FROM customer_run_events
     WHERE run_id = ?
     ORDER BY sequence ASC`,
    )
    .bind(run.id)
    .all<CustomerRunEventRow>();
  if (!turn || (events.results ?? []).length === 0) {
    throw new Error('d1_paused_customer_intake_replay_incomplete');
  }
  const storedTurn = turnFromRow(turn);
  const storedEvents = (events.results ?? [])
    .map(customerRunEventFromRow)
    .sort((left, right) => left.sequence - right.sequence);
  assertExactPausedCustomerRunReplay({
    operation: input,
    run,
    turn: storedTurn,
    events: storedEvents,
  });
  return {
    status: 'replayed',
    run,
    turn: storedTurn,
    events: storedEvents,
  };
}

async function assertExistingTurnIsExact(
  db: D1DatabaseLike,
  input: CommitPausedCustomerRunIntakeInput,
): Promise<void> {
  const turn = await db
    .prepare(
      `SELECT *
     FROM conversation_turns
     WHERE session_id = ?
       AND external_message_id = ?
     LIMIT 1`,
    )
    .bind(input.run.sessionId, input.run.clientMessageId)
    .first<ConversationTurnRow>();
  if (turn) {
    assertExactPausedCustomerUserTurn(input, turnFromRow(turn));
  }
}
