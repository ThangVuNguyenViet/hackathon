import type { PoolClient } from 'pg';
import {
  beginNonAgentTextDeliveryAttempt,
  completeNonAgentTextDeliveryAttempt,
  createPendingNonAgentTextDelivery,
  nonAgentTextDeliveryAgentBindingDigest,
  nonAgentTextDeliveryRecordSchema,
  nonAgentTextDeliverySessionBindingDigest,
  nonAgentTextDeliveryTurnBindingMatches,
  reconcileNonAgentTextDelivery,
  sameNonAgentTextDeliveryBinding,
  samePreparedNonAgentTextDeliveryTurn,
  type BeginNonAgentTextDeliveryAttemptInput,
  type BeginNonAgentTextDeliveryAttemptResult,
  type CompleteNonAgentTextDeliveryAttemptInput,
  type CompleteNonAgentTextDeliveryAttemptResult,
  type NonAgentTextDeliveryRecord,
  type PrepareNonAgentTextDeliveryTurnInput,
  type PrepareNonAgentTextDeliveryTurnResult,
  type ReconcileNonAgentTextDeliveryInput,
  type ReconcileNonAgentTextDeliveryResult,
  type ReserveNonAgentTextDeliveryInput,
  type ReserveNonAgentTextDeliveryResult,
} from './nonAgentTextDelivery.js';
import {
  lockPostgresSessionAuthority,
} from './postgresStoreSessionAuthority.js';
import {
  isConnectablePostgres,
} from './postgresStoreRunOwner.js';
import {
  type ConversationTurnRow,
  type Queryable,
  type SessionControlRow,
  normalizeDate,
  turnFromRow,
} from './postgresStoreSupport.js';

interface NonAgentTextDeliveryRow {
  schema_version: string;
  request_key: string;
  session_binding_digest: string;
  reserved_session_authority_generation: number;
  channel: NonAgentTextDeliveryRecord['channel'];
  assistant_turn_id: string;
  agent_binding_digest: string;
  recipient_binding_digest: string;
  presentation_binding_digest: string;
  delivery_binding_digest: string;
  status: NonAgentTextDeliveryRecord['status'];
  delivery_attempt: number;
  delivery_attempt_token: string | null;
  sending_lease_expires_at: Date | string | null;
  provider_message_id: string | null;
  outcome_code: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

const deliveryColumns = `
  schema_version,
  request_key,
  session_binding_digest,
  reserved_session_authority_generation,
  channel,
  assistant_turn_id,
  agent_binding_digest,
  recipient_binding_digest,
  presentation_binding_digest,
  delivery_binding_digest,
  status,
  delivery_attempt,
  delivery_attempt_token,
  sending_lease_expires_at,
  provider_message_id,
  outcome_code,
  created_at,
  updated_at
`;

export async function initializePostgresNonAgentTextDeliverySchema(
  db: Queryable,
): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS non_agent_text_deliveries (
      schema_version text NOT NULL
        CHECK (schema_version = 'kfc-non-agent-text-delivery-v1'),
      request_key text PRIMARY KEY CHECK (
        length(request_key) = 64
        AND request_key !~ '[^0-9a-f]'
      ),
      session_binding_digest text NOT NULL CHECK (
        length(session_binding_digest) = 64
        AND session_binding_digest !~ '[^0-9a-f]'
      ),
      reserved_session_authority_generation integer NOT NULL
        CHECK (reserved_session_authority_generation >= 0),
      channel text NOT NULL CHECK (
        channel IN ('kfc', 'messenger', 'zalo')
      ),
      assistant_turn_id text NOT NULL,
      agent_binding_digest text NOT NULL,
      recipient_binding_digest text NOT NULL,
      presentation_binding_digest text NOT NULL,
      delivery_binding_digest text NOT NULL,
      status text NOT NULL CHECK (
        status IN (
          'pending',
          'sending',
          'confirmed_sent',
          'confirmed_not_sent',
          'outcome_unknown'
        )
      ),
      delivery_attempt integer NOT NULL
        CHECK (delivery_attempt BETWEEN 0 AND 3),
      delivery_attempt_token text,
      sending_lease_expires_at timestamptz,
      provider_message_id text,
      outcome_code text,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL,
      CHECK (
        (
          status = 'pending'
          AND delivery_attempt = 0
          AND delivery_attempt_token IS NULL
          AND sending_lease_expires_at IS NULL
          AND provider_message_id IS NULL
          AND outcome_code IS NULL
        )
        OR (
          status = 'sending'
          AND delivery_attempt BETWEEN 1 AND 3
          AND delivery_attempt_token IS NOT NULL
          AND sending_lease_expires_at IS NOT NULL
          AND provider_message_id IS NULL
          AND outcome_code IS NULL
        )
        OR (
          status = 'confirmed_sent'
          AND delivery_attempt BETWEEN 1 AND 3
          AND delivery_attempt_token IS NOT NULL
          AND sending_lease_expires_at IS NULL
          AND (channel = 'kfc' OR provider_message_id IS NOT NULL)
          AND outcome_code IS NULL
        )
        OR (
          status IN ('confirmed_not_sent', 'outcome_unknown')
          AND delivery_attempt BETWEEN 1 AND 3
          AND delivery_attempt_token IS NOT NULL
          AND sending_lease_expires_at IS NULL
          AND provider_message_id IS NULL
          AND outcome_code IS NOT NULL
        )
        OR (
          status = 'confirmed_not_sent'
          AND delivery_attempt = 0
          AND delivery_attempt_token IS NULL
          AND sending_lease_expires_at IS NULL
          AND provider_message_id IS NULL
          AND outcome_code =
            'non_agent_delivery_abandoned_by_reset'
        )
      )
    )
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS non_agent_text_deliveries_session_idx
    ON non_agent_text_deliveries (session_binding_digest, created_at)
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS non_agent_text_deliveries_recovery_idx
    ON non_agent_text_deliveries (status, sending_lease_expires_at)
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS non_agent_text_delivery_attempts (
      request_key text NOT NULL
        REFERENCES non_agent_text_deliveries(request_key)
        ON DELETE CASCADE,
      delivery_attempt integer NOT NULL
        CHECK (delivery_attempt BETWEEN 1 AND 3),
      delivery_attempt_token text NOT NULL UNIQUE,
      created_at timestamptz NOT NULL,
      PRIMARY KEY (request_key, delivery_attempt)
    )
  `);
}

export async function reservePostgresNonAgentTextDelivery(input: {
  db: Queryable;
  reservation: ReserveNonAgentTextDeliveryInput;
}): Promise<ReserveNonAgentTextDeliveryResult> {
  const pending = await createPendingNonAgentTextDelivery(input.reservation);
  return withSessionTransaction(
    input.db,
    input.reservation.sessionId,
    async (client) => {
      const existing = await readRecord(client, pending.requestKey, true);
      if (existing) {
        return sameNonAgentTextDeliveryBinding(existing, pending)
          ? { status: 'replay', record: existing }
          : { status: 'conflict' };
      }
      if (!await exactHumanAuthority(client, input.reservation)) {
        return { status: 'stale_authority' };
      }
      const result = await client.query<NonAgentTextDeliveryRow>(
        `INSERT INTO non_agent_text_deliveries (${deliveryColumns})
         VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9,
           $10, $11, $12, $13, $14, $15, $16, $17, $18
         )
         ON CONFLICT (request_key) DO NOTHING
         RETURNING ${deliveryColumns}`,
        storageValues(pending),
      );
      if (!result.rows[0]) {
        const raced = await readRecord(client, pending.requestKey, true);
        return raced && sameNonAgentTextDeliveryBinding(raced, pending)
          ? { status: 'replay', record: raced }
          : { status: 'conflict' };
      }
      return { status: 'reserved', record: pending };
    },
  );
}

export async function getPostgresNonAgentTextDelivery(input: {
  db: Queryable;
  requestKey: string;
}): Promise<NonAgentTextDeliveryRecord | undefined> {
  return readRecord(input.db, input.requestKey, false);
}

export async function preparePostgresNonAgentTextDeliveryTurn(input: {
  db: Queryable;
  preparation: PrepareNonAgentTextDeliveryTurnInput;
}): Promise<PrepareNonAgentTextDeliveryTurnResult> {
  const operation = input.preparation;
  return withSessionTransaction(
    input.db,
    operation.sessionId,
    async (client) => {
      const record = await readRecord(client, operation.requestKey, true);
      if (
        !record ||
        record.sessionBindingDigest !==
          await nonAgentTextDeliverySessionBindingDigest(operation.sessionId)
      ) {
        return blockedPrepare('not_found');
      }
      if (
        record.reservedSessionAuthorityGeneration !==
          operation.expectedSessionAuthorityGeneration ||
        record.agentBindingDigest !==
          await nonAgentTextDeliveryAgentBindingDigest(
            operation.expectedAgentId,
          ) ||
        !await exactHumanAuthority(client, operation)
      ) {
        return blockedPrepare('stale_authority', record);
      }
      if (
        record.status !== 'pending' &&
        record.status !== 'confirmed_not_sent'
      ) {
        return blockedPrepare('delivery_not_dispatchable', record);
      }
      if (!await nonAgentTextDeliveryTurnBindingMatches(record, operation)) {
        return blockedPrepare('turn_binding_conflict', record);
      }
      const existing = await client.query<ConversationTurnRow>(
        `SELECT * FROM conversation_turns
         WHERE id = $1
         LIMIT 1
         FOR UPDATE`,
        [operation.turn.id],
      );
      if (existing.rows[0]) {
        const turn = turnFromRow(existing.rows[0]);
        return samePreparedNonAgentTextDeliveryTurn(turn, operation.turn)
          ? { status: 'replay', turn, record }
          : blockedPrepare('turn_binding_conflict', record, turn);
      }
      const inserted = await client.query<ConversationTurnRow>(
        `INSERT INTO conversation_turns (
           id, session_id, channel, role, text, external_message_id,
           external_user_id, delivery_status, metadata, created_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
         )
         RETURNING *`,
        [
          operation.turn.id,
          operation.turn.sessionId,
          operation.turn.channel,
          operation.turn.role,
          operation.turn.text,
          operation.turn.externalMessageId,
          operation.turn.externalUserId,
          operation.turn.deliveryStatus,
          operation.turn.metadata,
          operation.turn.createdAt,
        ],
      );
      const row = inserted.rows[0];
      if (!row) {
        throw new Error('postgres_non_agent_delivery_turn_insert_missing');
      }
      await client.query(
        `INSERT INTO conversation_events (
           id, session_id, source_type, payload, created_at
         ) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO NOTHING`,
        [
          `event_non_agent_${operation.requestKey}`,
          operation.turn.sessionId,
          'conversation_turn:assistant',
          JSON.stringify({
            text: operation.turn.text,
            channel: operation.turn.channel,
            deliveryStatus: operation.turn.deliveryStatus,
            externalMessageId: operation.turn.externalMessageId,
            externalUserId: operation.turn.externalUserId,
            metadata: operation.turn.metadata,
          }),
          operation.turn.createdAt,
        ],
      );
      return {
        status: 'prepared',
        turn: turnFromRow(row),
        record,
      };
    },
  );
}

export async function beginPostgresNonAgentTextDeliveryAttempt(input: {
  db: Queryable;
  attempt: BeginNonAgentTextDeliveryAttemptInput;
}): Promise<BeginNonAgentTextDeliveryAttemptResult> {
  return withSessionTransaction(
    input.db,
    input.attempt.sessionId,
    async (client) => {
      const existing = await readRecord(
        client,
        input.attempt.requestKey,
        true,
      );
      const expectedSessionBindingDigest =
        await nonAgentTextDeliverySessionBindingDigest(
          input.attempt.sessionId,
        );
      if (
        !existing ||
        existing.sessionBindingDigest !== expectedSessionBindingDigest
      ) {
        return {
          status: 'dispatch_blocked',
          reason: 'not_found',
        };
      }
      const expectedAgentBindingDigest =
        await nonAgentTextDeliveryAgentBindingDigest(
          input.attempt.expectedAgentId,
        );
      if (
        existing.reservedSessionAuthorityGeneration !==
          input.attempt.expectedSessionAuthorityGeneration ||
        existing.agentBindingDigest !== expectedAgentBindingDigest ||
        !await exactHumanAuthority(client, input.attempt)
      ) {
        return {
          status: 'dispatch_blocked',
          reason: 'stale_authority',
          record: existing,
        };
      }
      const transition = beginNonAgentTextDeliveryAttempt(
        existing,
        input.attempt,
      );
      if (transition.status !== 'dispatch_authorized') return transition;
      const attemptClaim = await client.query(
        `INSERT INTO non_agent_text_delivery_attempts (
           request_key,
           delivery_attempt,
           delivery_attempt_token,
           created_at
         )
         VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING
         RETURNING request_key`,
        [
          transition.record.requestKey,
          transition.record.deliveryAttempt,
          transition.record.deliveryAttemptToken,
          transition.record.updatedAt,
        ],
      );
      if (attemptClaim.rowCount !== 1) {
        return {
          status: 'dispatch_blocked',
          reason: 'delivery_attempt_token_reused',
          record: existing,
        };
      }
      await writeRecord(client, existing, transition.record);
      return transition;
    },
  );
}

export async function completePostgresNonAgentTextDeliveryAttempt(input: {
  db: Queryable;
  completion: CompleteNonAgentTextDeliveryAttemptInput;
}): Promise<CompleteNonAgentTextDeliveryAttemptResult> {
  return withSessionTransaction(
    input.db,
    input.completion.sessionId,
    async (client) => {
      const existing = await readRecord(
        client,
        input.completion.requestKey,
        true,
      );
      if (!existing) {
        return {
          status: 'transition_blocked',
          reason: 'not_found',
        };
      }
      if (
        existing.sessionBindingDigest !==
          await nonAgentTextDeliverySessionBindingDigest(
            input.completion.sessionId,
          )
      ) {
        return {
          status: 'transition_blocked',
          reason: 'session_mismatch',
          record: existing,
        };
      }
      const transition = completeNonAgentTextDeliveryAttempt(
        existing,
        input.completion,
      );
      if (transition.status !== 'transitioned') return transition;
      await writeRecord(client, existing, transition.record);
      return transition;
    },
  );
}

export async function reconcilePostgresNonAgentTextDelivery(input: {
  db: Queryable;
  reconciliation: ReconcileNonAgentTextDeliveryInput;
}): Promise<ReconcileNonAgentTextDeliveryResult> {
  return withSessionTransaction(
    input.db,
    input.reconciliation.sessionId,
    async (client) => {
      const existing = await readRecord(
        client,
        input.reconciliation.requestKey,
        true,
      );
      if (!existing) {
        return {
          status: 'reconciliation_blocked',
          reason: 'not_found',
        };
      }
      if (
        existing.sessionBindingDigest !==
          await nonAgentTextDeliverySessionBindingDigest(
            input.reconciliation.sessionId,
          )
      ) {
        return {
          status: 'reconciliation_blocked',
          reason: 'session_mismatch',
          record: existing,
        };
      }
      const transition = reconcileNonAgentTextDelivery(
        existing,
        input.reconciliation,
      );
      if (transition.status !== 'reconciled') return transition;
      await writeRecord(client, existing, transition.record);
      return transition;
    },
  );
}

async function withSessionTransaction<Result>(
  db: Queryable,
  sessionId: string,
  operation: (client: PoolClient) => Promise<Result>,
): Promise<Result> {
  if (!isConnectablePostgres(db)) {
    throw new Error('postgres_atomic_non_agent_delivery_unavailable');
  }
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await lockPostgresSessionAuthority(client, sessionId);
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the original failure.
    }
    throw error;
  } finally {
    client.release();
  }
}

async function exactHumanAuthority(
  client: PoolClient,
  input: {
    sessionId: string;
    expectedSessionAuthorityGeneration: number;
    expectedAgentId: string;
  },
): Promise<boolean> {
  const result = await client.query<SessionControlRow>(
    `SELECT *
     FROM session_controls
     WHERE session_id = $1
     FOR UPDATE`,
    [input.sessionId],
  );
  const row = result.rows[0];
  return (
    row !== undefined &&
    Number(row.session_authority_generation) ===
      input.expectedSessionAuthorityGeneration &&
    row.agent_mode === 'human_paused' &&
    row.assigned_agent_id === input.expectedAgentId
  );
}

async function readRecord(
  db: Queryable,
  requestKey: string,
  forUpdate: boolean,
): Promise<NonAgentTextDeliveryRecord | undefined> {
  const result = await db.query<NonAgentTextDeliveryRow>(
    `SELECT ${deliveryColumns}
     FROM non_agent_text_deliveries
     WHERE request_key = $1
     LIMIT 1
     ${forUpdate ? 'FOR UPDATE' : ''}`,
    [requestKey],
  );
  const row = result.rows[0];
  return row ? recordFromRow(row) : undefined;
}

async function writeRecord(
  client: PoolClient,
  existing: NonAgentTextDeliveryRecord,
  next: NonAgentTextDeliveryRecord,
): Promise<void> {
  const result = await client.query(
    `UPDATE non_agent_text_deliveries
     SET status = $3,
         delivery_attempt = $4,
         delivery_attempt_token = $5,
         sending_lease_expires_at = $6,
         provider_message_id = $7,
         outcome_code = $8,
         updated_at = $9
     WHERE request_key = $1
       AND session_binding_digest = $2
       AND delivery_binding_digest = $10
       AND status = $11
       AND delivery_attempt = $12
       AND delivery_attempt_token IS NOT DISTINCT FROM $13
       AND sending_lease_expires_at IS NOT DISTINCT FROM $14::timestamptz
       AND provider_message_id IS NOT DISTINCT FROM $15
       AND outcome_code IS NOT DISTINCT FROM $16
       AND updated_at = $17::timestamptz
     RETURNING request_key`,
    [
      next.requestKey,
      next.sessionBindingDigest,
      ...mutableStorageValues(next),
      existing.deliveryBindingDigest,
      existing.status,
      existing.deliveryAttempt,
      existing.deliveryAttemptToken,
      existing.sendingLeaseExpiresAt,
      existing.providerMessageId,
      existing.outcomeCode,
      existing.updatedAt,
    ],
  );
  if (result.rowCount !== 1) {
    throw new Error('postgres_non_agent_delivery_cas_lost');
  }
}

function storageValues(record: NonAgentTextDeliveryRecord): unknown[] {
  return [
    record.schemaVersion,
    record.requestKey,
    record.sessionBindingDigest,
    record.reservedSessionAuthorityGeneration,
    record.channel,
    record.assistantTurnId,
    record.agentBindingDigest,
    record.recipientBindingDigest,
    record.presentationBindingDigest,
    record.deliveryBindingDigest,
    record.status,
    record.deliveryAttempt,
    record.deliveryAttemptToken,
    record.sendingLeaseExpiresAt,
    record.providerMessageId,
    record.outcomeCode,
    record.createdAt,
    record.updatedAt,
  ];
}

function mutableStorageValues(
  record: NonAgentTextDeliveryRecord,
): unknown[] {
  return [
    record.status,
    record.deliveryAttempt,
    record.deliveryAttemptToken,
    record.sendingLeaseExpiresAt,
    record.providerMessageId,
    record.outcomeCode,
    record.updatedAt,
  ];
}

function recordFromRow(
  row: NonAgentTextDeliveryRow,
): NonAgentTextDeliveryRecord {
  return nonAgentTextDeliveryRecordSchema.parse({
    schemaVersion: row.schema_version,
    requestKey: row.request_key,
    sessionBindingDigest: row.session_binding_digest,
    reservedSessionAuthorityGeneration:
      Number(row.reserved_session_authority_generation),
    channel: row.channel,
    assistantTurnId: row.assistant_turn_id,
    agentBindingDigest: row.agent_binding_digest,
    recipientBindingDigest: row.recipient_binding_digest,
    presentationBindingDigest: row.presentation_binding_digest,
    deliveryBindingDigest: row.delivery_binding_digest,
    status: row.status,
    deliveryAttempt: Number(row.delivery_attempt),
    deliveryAttemptToken: row.delivery_attempt_token,
    sendingLeaseExpiresAt:
      row.sending_lease_expires_at === null
        ? null
        : normalizeDate(row.sending_lease_expires_at),
    providerMessageId: row.provider_message_id,
    outcomeCode: row.outcome_code,
    createdAt: normalizeDate(row.created_at),
    updatedAt: normalizeDate(row.updated_at),
  });
}

function blockedPrepare(
  reason: Extract<
    PrepareNonAgentTextDeliveryTurnResult,
    { status: 'prepare_blocked' }
  >['reason'],
  record?: NonAgentTextDeliveryRecord,
  turn?: PrepareNonAgentTextDeliveryTurnInput['turn'],
): PrepareNonAgentTextDeliveryTurnResult {
  return {
    status: 'prepare_blocked',
    reason,
    ...(record ? { record } : {}),
    ...(turn ? { turn } : {}),
  };
}
