import { randomUUID } from 'node:crypto';
import {
  CustomerRunIdempotencyConflictError,
  type CustomerRunEvent,
} from '../customerRuns/contracts.js';
import type {
  CommitPausedCustomerRunIntakeInput,
  CommitPausedCustomerRunIntakeResult,
} from './contracts.js';
import {
  assertExactPausedCustomerRunReplay,
  assertExactPausedCustomerUserTurn,
  validatePausedCustomerRunIntake,
} from './pausedCustomerRunIntake.js';
import { isConnectablePostgres } from './postgresStoreRunOwner.js';
import { lockPostgresSessionAuthority } from './postgresStoreSessionAuthority.js';
import {
  customerRunEventFromRow,
  customerRunFromRow,
  turnFromRow,
  type ConversationTurnRow,
  type CustomerRunEventRow,
  type CustomerRunRow,
  type Queryable,
  type SessionControlRow,
} from './postgresStoreSupport.js';

export async function commitPostgresPausedCustomerRunIntake(input: {
  db: Queryable;
  operation: CommitPausedCustomerRunIntakeInput;
}): Promise<CommitPausedCustomerRunIntakeResult> {
  const prepared = validatePausedCustomerRunIntake(input.operation);
  if (!isConnectablePostgres(input.db)) {
    throw new Error('postgres_atomic_paused_customer_intake_unavailable');
  }
  const client = await input.db.connect();
  try {
    await client.query('BEGIN');
    await lockPostgresSessionAuthority(client, input.operation.run.sessionId);
    const existing = await client.query<CustomerRunRow>(
      `SELECT *
       FROM customer_runs
       WHERE session_id = $1
         AND client_message_id = $2
       FOR UPDATE`,
      [input.operation.run.sessionId, input.operation.run.clientMessageId],
    );
    if (existing.rows[0]) {
      const run = customerRunFromRow(existing.rows[0]);
      if (run.requestFingerprint !== input.operation.run.requestFingerprint) {
        throw new CustomerRunIdempotencyConflictError(
          input.operation.run.sessionId,
          input.operation.run.clientMessageId,
        );
      }
      const replay = await readReplay(
        client,
        input.operation,
        existing.rows[0],
      );
      await client.query('COMMIT');
      return replay;
    }

    const control = await client.query<SessionControlRow>(
      `SELECT *
       FROM session_controls
       WHERE session_id = $1
       FOR UPDATE`,
      [input.operation.run.sessionId],
    );
    if (
      control.rows[0]?.agent_mode !== 'human_paused' ||
      Number(control.rows[0].session_authority_generation) !==
        input.operation.expectedSessionAuthorityGeneration
    ) {
      await client.query('COMMIT');
      return { status: 'stale' };
    }

    const turn = await ensureUserTurn(client, input.operation);
    const run = await client.query<CustomerRunRow>(
      `INSERT INTO customer_runs (
         id, schema_version, session_id, customer_id, client_message_id,
         request_fingerprint, generation, session_authority_generation,
         status, phase, next_event_sequence, client_schema_version,
         accepted_at, started_at, terminal_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8,
         $9, $10, $11, $12, $13, $14, $15, $16
       )
       RETURNING *`,
      [
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
      ],
    );
    const event = await client.query<CustomerRunEventRow>(
      `INSERT INTO customer_run_events (
         event_id, run_id, sequence, schema_version, type,
         occurred_at, payload
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        prepared.event.eventId,
        prepared.event.runId,
        prepared.event.sequence,
        prepared.event.schemaVersion,
        prepared.event.type,
        prepared.event.occurredAt,
        prepared.event.payload,
      ],
    );
    if (!run.rows[0] || !event.rows[0]) {
      throw new Error('postgres_paused_customer_intake_commit_missing');
    }
    await client.query('COMMIT');
    return {
      status: 'committed',
      run: customerRunFromRow(run.rows[0]),
      turn: turnFromRow(turn),
      events: [customerRunEventFromRow(event.rows[0])],
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

async function ensureUserTurn(
  client: import('pg').PoolClient,
  input: CommitPausedCustomerRunIntakeInput,
): Promise<ConversationTurnRow> {
  const existing = await client.query<ConversationTurnRow>(
    `SELECT *
     FROM conversation_turns
     WHERE session_id = $1
       AND external_message_id = $2
     FOR UPDATE`,
    [input.run.sessionId, input.run.clientMessageId],
  );
  if (existing.rows[0]) {
    assertExactPausedCustomerUserTurn(input, turnFromRow(existing.rows[0]));
    return existing.rows[0];
  }
  const turn = await client.query<ConversationTurnRow>(
    `INSERT INTO conversation_turns (
       id, session_id, channel, role, text, external_message_id,
       external_user_id, delivery_status, metadata, created_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      `turn_${randomUUID()}`,
      input.userTurn.sessionId,
      input.userTurn.channel,
      input.userTurn.role,
      input.userTurn.text,
      input.userTurn.externalMessageId,
      input.userTurn.externalUserId,
      input.userTurn.deliveryStatus,
      input.userTurn.metadata,
      input.userTurn.createdAt ?? new Date().toISOString(),
    ],
  );
  if (!turn.rows[0]) {
    throw new Error('postgres_paused_customer_intake_turn_missing');
  }
  return turn.rows[0];
}

async function readReplay(
  client: import('pg').PoolClient,
  input: CommitPausedCustomerRunIntakeInput,
  run: CustomerRunRow,
): Promise<CommitPausedCustomerRunIntakeResult> {
  const turn = await client.query<ConversationTurnRow>(
    `SELECT *
     FROM conversation_turns
     WHERE session_id = $1
       AND external_message_id = $2
     LIMIT 1`,
    [input.run.sessionId, input.run.clientMessageId],
  );
  const events = await client.query<CustomerRunEventRow>(
    `SELECT *
     FROM customer_run_events
     WHERE run_id = $1
     ORDER BY sequence ASC`,
    [run.id],
  );
  if (!turn.rows[0] || events.rows.length === 0) {
    throw new Error('postgres_paused_customer_intake_replay_incomplete');
  }
  const storedRun = customerRunFromRow(run);
  const storedTurn = turnFromRow(turn.rows[0]);
  const storedEvents = events.rows
    .map(customerRunEventFromRow)
    .sort((left, right) => left.sequence - right.sequence);
  assertExactPausedCustomerRunReplay({
    operation: input,
    run: storedRun,
    turn: storedTurn,
    events: storedEvents,
  });
  return {
    status: 'replayed',
    run: storedRun,
    turn: storedTurn,
    events: storedEvents,
  };
}
