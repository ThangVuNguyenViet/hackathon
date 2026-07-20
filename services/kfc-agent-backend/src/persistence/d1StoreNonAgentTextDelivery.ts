import type {
  BeginNonAgentTextDeliveryAttemptInput,
  BeginNonAgentTextDeliveryAttemptResult,
  CompleteNonAgentTextDeliveryAttemptInput,
  CompleteNonAgentTextDeliveryAttemptResult,
  NonAgentTextDeliveryRecord,
  PrepareNonAgentTextDeliveryTurnInput,
  PrepareNonAgentTextDeliveryTurnResult,
  ReconcileNonAgentTextDeliveryInput,
  ReconcileNonAgentTextDeliveryResult,
  ReserveNonAgentTextDeliveryInput,
  ReserveNonAgentTextDeliveryResult,
} from './contracts.js';
import {
  beginNonAgentTextDeliveryAttempt,
  completeNonAgentTextDeliveryAttempt,
  createPendingNonAgentTextDelivery,
  nonAgentTextDeliveryAgentBindingDigest,
  nonAgentTextDeliveryRecordSchema,
  nonAgentTextDeliverySessionBindingDigest,
  nonAgentTextDeliveryTurnBindingMatches,
  reconcileNonAgentTextDelivery,
  samePreparedNonAgentTextDeliveryTurn,
  sameNonAgentTextDeliveryBinding,
} from './nonAgentTextDelivery.js';
import {
  turnFromRow,
  type ConversationTurnRow,
  type D1DatabaseLike,
  type D1Result,
} from './d1StoreSupport.js';

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
  sending_lease_expires_at: string | null;
  provider_message_id: string | null;
  outcome_code: string | null;
  created_at: string;
  updated_at: string;
}

const columns = [
  'schema_version',
  'request_key',
  'session_binding_digest',
  'reserved_session_authority_generation',
  'channel',
  'assistant_turn_id',
  'agent_binding_digest',
  'recipient_binding_digest',
  'presentation_binding_digest',
  'delivery_binding_digest',
  'status',
  'delivery_attempt',
  'delivery_attempt_token',
  'sending_lease_expires_at',
  'provider_message_id',
  'outcome_code',
  'created_at',
  'updated_at',
].join(', ');

export async function reserveD1NonAgentTextDelivery(input: {
  db: D1DatabaseLike;
  reservation: ReserveNonAgentTextDeliveryInput;
}): Promise<ReserveNonAgentTextDeliveryResult> {
  const pending = await createPendingNonAgentTextDelivery(input.reservation);
  const existing = await getD1NonAgentTextDelivery({
    db: input.db,
    requestKey: pending.requestKey,
  });
  if (existing) {
    return sameNonAgentTextDeliveryBinding(existing, pending)
      ? { status: 'replay', record: existing }
      : { status: 'conflict' };
  }
  const inserted = await input.db
    .prepare(
      `INSERT INTO non_agent_text_deliveries (${columns})
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       FROM session_controls
       WHERE session_id = ?
         AND session_authority_generation = ?
         AND agent_mode = 'human_paused'
         AND assigned_agent_id = ?
       ON CONFLICT(request_key) DO NOTHING
       RETURNING *`,
    )
    .bind(
      ...storageValues(pending),
      input.reservation.sessionId,
      pending.reservedSessionAuthorityGeneration,
      input.reservation.expectedAgentId,
    )
    .first<NonAgentTextDeliveryRow>();
  if (inserted) {
    return { status: 'reserved', record: recordFromRow(inserted) };
  }
  const current = await getD1NonAgentTextDelivery({
    db: input.db,
    requestKey: pending.requestKey,
  });
  if (current) {
    return sameNonAgentTextDeliveryBinding(current, pending)
      ? { status: 'replay', record: current }
      : { status: 'conflict' };
  }
  return { status: 'stale_authority' };
}

export async function getD1NonAgentTextDelivery(input: {
  db: D1DatabaseLike;
  requestKey: string;
}): Promise<NonAgentTextDeliveryRecord | undefined> {
  const row = await input.db
    .prepare(
      `SELECT ${columns}
       FROM non_agent_text_deliveries
       WHERE request_key = ?
       LIMIT 1`,
    )
    .bind(input.requestKey)
    .first<NonAgentTextDeliveryRow>();
  return row ? recordFromRow(row) : undefined;
}

export async function prepareD1NonAgentTextDeliveryTurn(input: {
  db: D1DatabaseLike;
  preparation: PrepareNonAgentTextDeliveryTurnInput;
}): Promise<PrepareNonAgentTextDeliveryTurnResult> {
  const operation = input.preparation;
  const record = await getD1NonAgentTextDelivery({
    db: input.db,
    requestKey: operation.requestKey,
  });
  if (!record) return blockedPrepare('not_found');
  if (
    record.sessionBindingDigest !==
      await nonAgentTextDeliverySessionBindingDigest(operation.sessionId)
  ) {
    return blockedPrepare('not_found');
  }
  if (!await reservationAuthorityMatches(record, operation) ||
      !await exactHumanAuthority(input.db, operation)) {
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
  const existing = await readPreparedTurn(
    input.db,
    operation.turn.id,
  );
  if (existing) {
    return samePreparedNonAgentTextDeliveryTurn(existing, operation.turn)
      ? { status: 'replay', turn: existing, record }
      : blockedPrepare('turn_binding_conflict', record, existing);
  }
  if (!input.db.batch) {
    throw new Error('d1_atomic_non_agent_delivery_prepare_unavailable');
  }
  const sessionBindingDigest =
    await nonAgentTextDeliverySessionBindingDigest(operation.sessionId);
  const agentBindingDigest =
    await nonAgentTextDeliveryAgentBindingDigest(operation.expectedAgentId);
  const eventId = `event_non_agent_${operation.requestKey}`;
  const eventPayload = JSON.stringify({
    text: operation.turn.text,
    channel: operation.turn.channel,
    deliveryStatus: operation.turn.deliveryStatus,
    externalMessageId: operation.turn.externalMessageId,
    externalUserId: operation.turn.externalUserId,
    metadata: operation.turn.metadata,
  });
  const predicates = `
    request_key = ?
    AND session_binding_digest = ?
    AND reserved_session_authority_generation = ?
    AND agent_binding_digest = ?
    AND status IN ('pending', 'confirmed_not_sent')
    AND EXISTS (
      SELECT 1 FROM session_controls
      WHERE session_id = ?
        AND session_authority_generation = ?
        AND agent_mode = 'human_paused'
        AND assigned_agent_id = ?
    )`;
  const predicateValues = [
    operation.requestKey,
    sessionBindingDigest,
    operation.expectedSessionAuthorityGeneration,
    agentBindingDigest,
    operation.sessionId,
    operation.expectedSessionAuthorityGeneration,
    operation.expectedAgentId,
  ] as const;
  const results = await input.db.batch([
    input.db.prepare(
      `INSERT INTO conversation_turns (
         id, session_id, channel, role, text, external_message_id,
         external_user_id, delivery_status, metadata, created_at
       )
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       FROM non_agent_text_deliveries
       WHERE ${predicates}
       ON CONFLICT(id) DO NOTHING
       RETURNING *`,
    ).bind(
      operation.turn.id,
      operation.turn.sessionId,
      operation.turn.channel,
      operation.turn.role,
      operation.turn.text,
      operation.turn.externalMessageId,
      operation.turn.externalUserId,
      operation.turn.deliveryStatus,
      JSON.stringify(operation.turn.metadata),
      operation.turn.createdAt,
      ...predicateValues,
    ),
    input.db.prepare(
      `INSERT INTO conversation_events (
         id, session_id, source_type, payload, created_at
       )
       SELECT ?, ?, ?, ?, ?
       FROM non_agent_text_deliveries
       WHERE ${predicates}
         AND EXISTS (
           SELECT 1 FROM conversation_turns
           WHERE id = ?
             AND session_id = ?
             AND channel = ?
             AND role = ?
             AND text = ?
             AND external_message_id IS ?
             AND external_user_id IS ?
             AND delivery_status = ?
             AND metadata = ?
             AND created_at = ?
         )
       ON CONFLICT(id) DO NOTHING`,
    ).bind(
      eventId,
      operation.turn.sessionId,
      'conversation_turn:assistant',
      eventPayload,
      operation.turn.createdAt,
      ...predicateValues,
      operation.turn.id,
      operation.turn.sessionId,
      operation.turn.channel,
      operation.turn.role,
      operation.turn.text,
      operation.turn.externalMessageId,
      operation.turn.externalUserId,
      operation.turn.deliveryStatus,
      JSON.stringify(operation.turn.metadata),
      operation.turn.createdAt,
    ),
  ]);
  const inserted = results[0]?.results?.[0] as
    | ConversationTurnRow
    | undefined;
  if (inserted) {
    return {
      status: 'prepared',
      turn: turnFromRow(inserted),
      record,
    };
  }
  const racedRecord = await getD1NonAgentTextDelivery({
    db: input.db,
    requestKey: operation.requestKey,
  });
  if (
    !racedRecord ||
    !await reservationAuthorityMatches(racedRecord, operation) ||
    !await exactHumanAuthority(input.db, operation)
  ) {
    return blockedPrepare('stale_authority', racedRecord);
  }
  const racedTurn = await readPreparedTurn(input.db, operation.turn.id);
  return racedTurn &&
    samePreparedNonAgentTextDeliveryTurn(racedTurn, operation.turn)
    ? { status: 'replay', turn: racedTurn, record: racedRecord }
    : blockedPrepare(
        racedTurn ? 'turn_binding_conflict' : 'delivery_not_dispatchable',
        racedRecord,
        racedTurn,
      );
}

export async function beginD1NonAgentTextDeliveryAttempt(input: {
  db: D1DatabaseLike;
  attempt: BeginNonAgentTextDeliveryAttemptInput;
}): Promise<BeginNonAgentTextDeliveryAttemptResult> {
  const existing = await getD1NonAgentTextDelivery({
    db: input.db,
    requestKey: input.attempt.requestKey,
  });
  if (
    !existing ||
    existing.sessionBindingDigest !==
      await nonAgentTextDeliverySessionBindingDigest(input.attempt.sessionId)
  ) {
    return blockedBegin('not_found', existing);
  }
  if (!await reservationAuthorityMatches(existing, input.attempt)) {
    return blockedBegin('stale_authority', existing);
  }
  if (!await exactHumanAuthority(input.db, input.attempt)) {
    return blockedBegin('stale_authority', existing);
  }
  const transition = beginNonAgentTextDeliveryAttempt(
    existing,
    input.attempt,
  );
  if (transition.status !== 'dispatch_authorized') return transition;
  const next = transition.record;
  if (!input.db.batch) {
    throw new Error('d1_atomic_non_agent_delivery_begin_unavailable');
  }
  let results: D1Result[];
  try {
    results = await input.db.batch([
      input.db.prepare(
      `UPDATE non_agent_text_deliveries
       SET status = ?,
           delivery_attempt = ?,
           delivery_attempt_token = ?,
           sending_lease_expires_at = ?,
           provider_message_id = ?,
           outcome_code = ?,
           updated_at = ?
       WHERE request_key = ?
         AND session_binding_digest = ?
         AND reserved_session_authority_generation = ?
         AND agent_binding_digest = ?
         AND status = ?
         AND delivery_attempt = ?
         AND delivery_attempt_token IS ?
         AND updated_at = ?
         AND EXISTS (
           SELECT 1
           FROM session_controls
           WHERE session_id = ?
             AND session_authority_generation = ?
             AND agent_mode = 'human_paused'
             AND assigned_agent_id = ?
         )
       RETURNING *`,
      ).bind(
        ...mutableStorageValues(next),
        existing.requestKey,
        existing.sessionBindingDigest,
        existing.reservedSessionAuthorityGeneration,
        existing.agentBindingDigest,
        existing.status,
        existing.deliveryAttempt,
        existing.deliveryAttemptToken,
        existing.updatedAt,
        input.attempt.sessionId,
        input.attempt.expectedSessionAuthorityGeneration,
        input.attempt.expectedAgentId,
      ),
      input.db.prepare(
        `INSERT INTO non_agent_text_delivery_attempts (
           request_key,
           delivery_attempt,
           delivery_attempt_token,
           created_at
         )
         SELECT request_key, delivery_attempt, delivery_attempt_token, updated_at
         FROM non_agent_text_deliveries
         WHERE request_key = ?
           AND session_binding_digest = ?
           AND status = 'sending'
           AND delivery_attempt = ?
           AND delivery_attempt_token = ?
           AND updated_at = ?`,
      ).bind(
        next.requestKey,
        next.sessionBindingDigest,
        next.deliveryAttempt,
        next.deliveryAttemptToken,
        next.updatedAt,
      ),
    ]);
  } catch (error) {
    if (await attemptTokenExists(input.db, input.attempt.deliveryAttemptToken)) {
      return blockedBegin('delivery_attempt_token_reused', existing);
    }
    throw error;
  }
  const updated = results[0]?.results?.[0] as
    | NonAgentTextDeliveryRow
    | undefined;
  if (updated && Number(results[1]?.meta.changes ?? 0) === 1) {
    const record = recordFromRow(updated);
    if (record.status !== 'sending') {
      throw new Error('d1_non_agent_delivery_begin_state_invalid');
    }
    return {
      status: 'dispatch_authorized',
      record,
    };
  }
  const current = await getD1NonAgentTextDelivery({
    db: input.db,
    requestKey: existing.requestKey,
  });
  if (!await exactHumanAuthority(input.db, input.attempt)) {
    return blockedBegin('stale_authority', current);
  }
  if (
    !current ||
    current.sessionBindingDigest !==
      await nonAgentTextDeliverySessionBindingDigest(input.attempt.sessionId)
  ) {
    return blockedBegin('not_found', current);
  }
  if (!await reservationAuthorityMatches(current, input.attempt)) {
    return blockedBegin('stale_authority', current);
  }
  const classified = beginNonAgentTextDeliveryAttempt(
    current,
    input.attempt,
  );
  return classified.status === 'dispatch_blocked'
    ? classified
    : blockedBegin('sending_in_progress', current);
}

export async function completeD1NonAgentTextDeliveryAttempt(input: {
  db: D1DatabaseLike;
  completion: CompleteNonAgentTextDeliveryAttemptInput;
}): Promise<CompleteNonAgentTextDeliveryAttemptResult> {
  const existing = await getD1NonAgentTextDelivery({
    db: input.db,
    requestKey: input.completion.requestKey,
  });
  if (!existing) return blockedComplete('not_found');
  if (
    existing.sessionBindingDigest !==
      await nonAgentTextDeliverySessionBindingDigest(input.completion.sessionId)
  ) {
    return blockedComplete('session_mismatch', existing);
  }
  const transition = completeNonAgentTextDeliveryAttempt(
    existing,
    input.completion,
  );
  if (transition.status !== 'transitioned') return transition;
  const next = transition.record;
  const updated = await input.db
    .prepare(
      `UPDATE non_agent_text_deliveries
       SET status = ?,
           delivery_attempt = ?,
           delivery_attempt_token = ?,
           sending_lease_expires_at = ?,
           provider_message_id = ?,
           outcome_code = ?,
           updated_at = ?
       WHERE request_key = ?
         AND session_binding_digest = ?
         AND status = 'sending'
         AND delivery_attempt = ?
         AND delivery_attempt_token = ?
         AND updated_at = ?
       RETURNING *`,
    )
    .bind(
      ...mutableStorageValues(next),
      existing.requestKey,
      existing.sessionBindingDigest,
      existing.deliveryAttempt,
      existing.deliveryAttemptToken,
      existing.updatedAt,
    )
    .first<NonAgentTextDeliveryRow>();
  if (updated) {
    const record = recordFromRow(updated);
    if (record.status === 'pending' || record.status === 'sending') {
      throw new Error('d1_non_agent_delivery_completion_state_invalid');
    }
    return {
      status: 'transitioned',
      record,
    };
  }
  return classifyBlockedCompletion(input.db, input.completion);
}

export async function reconcileD1NonAgentTextDelivery(input: {
  db: D1DatabaseLike;
  reconciliation: ReconcileNonAgentTextDeliveryInput;
}): Promise<ReconcileNonAgentTextDeliveryResult> {
  const existing = await getD1NonAgentTextDelivery({
    db: input.db,
    requestKey: input.reconciliation.requestKey,
  });
  if (!existing) return blockedReconcile('not_found');
  if (
    existing.sessionBindingDigest !==
      await nonAgentTextDeliverySessionBindingDigest(
        input.reconciliation.sessionId,
      )
  ) {
    return blockedReconcile('session_mismatch', existing);
  }
  const transition = reconcileNonAgentTextDelivery(
    existing,
    input.reconciliation,
  );
  if (transition.status !== 'reconciled') return transition;
  const next = transition.record;
  const updated = await input.db
    .prepare(
      `UPDATE non_agent_text_deliveries
       SET status = ?,
           delivery_attempt = ?,
           delivery_attempt_token = ?,
           sending_lease_expires_at = ?,
           provider_message_id = ?,
           outcome_code = ?,
           updated_at = ?
       WHERE request_key = ?
         AND session_binding_digest = ?
         AND status = 'sending'
         AND delivery_attempt = ?
         AND delivery_attempt_token = ?
         AND sending_lease_expires_at = ?
         AND updated_at = ?
       RETURNING *`,
    )
    .bind(
      ...mutableStorageValues(next),
      existing.requestKey,
      existing.sessionBindingDigest,
      existing.deliveryAttempt,
      existing.deliveryAttemptToken,
      existing.sendingLeaseExpiresAt,
      existing.updatedAt,
    )
    .first<NonAgentTextDeliveryRow>();
  if (updated) {
    const record = recordFromRow(updated);
    if (record.status !== 'outcome_unknown') {
      throw new Error('d1_non_agent_delivery_reconcile_state_invalid');
    }
    return {
      status: 'reconciled',
      record,
    };
  }
  return classifyBlockedReconciliation(input.db, input.reconciliation);
}

async function classifyBlockedCompletion(
  db: D1DatabaseLike,
  completion: CompleteNonAgentTextDeliveryAttemptInput,
): Promise<CompleteNonAgentTextDeliveryAttemptResult> {
  const current = await getD1NonAgentTextDelivery({
    db,
    requestKey: completion.requestKey,
  });
  if (!current) return blockedComplete('not_found');
  if (
    current.sessionBindingDigest !==
      await nonAgentTextDeliverySessionBindingDigest(completion.sessionId)
  ) {
    return blockedComplete('session_mismatch', current);
  }
  const classified = completeNonAgentTextDeliveryAttempt(
    current,
    completion,
  );
  return classified.status === 'transition_blocked'
    ? classified
    : blockedComplete('delivery_not_sending', current);
}

async function classifyBlockedReconciliation(
  db: D1DatabaseLike,
  reconciliation: ReconcileNonAgentTextDeliveryInput,
): Promise<ReconcileNonAgentTextDeliveryResult> {
  const current = await getD1NonAgentTextDelivery({
    db,
    requestKey: reconciliation.requestKey,
  });
  if (!current) return blockedReconcile('not_found');
  if (
    current.sessionBindingDigest !==
      await nonAgentTextDeliverySessionBindingDigest(reconciliation.sessionId)
  ) {
    return blockedReconcile('session_mismatch', current);
  }
  const classified = reconcileNonAgentTextDelivery(
    current,
    reconciliation,
  );
  return classified.status !== 'reconciled'
    ? classified
    : blockedReconcile('delivery_not_sending', current);
}

async function exactHumanAuthority(
  db: D1DatabaseLike,
  input: {
    sessionId: string;
    expectedSessionAuthorityGeneration: number;
    expectedAgentId: string;
  },
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS authorized
       FROM session_controls
       WHERE session_id = ?
         AND session_authority_generation = ?
         AND agent_mode = 'human_paused'
         AND assigned_agent_id = ?
       LIMIT 1`,
    )
    .bind(
      input.sessionId,
      input.expectedSessionAuthorityGeneration,
      input.expectedAgentId,
    )
    .first<{ authorized: number }>();
  return row?.authorized === 1;
}

async function reservationAuthorityMatches(
  record: NonAgentTextDeliveryRecord,
  input: Pick<
    BeginNonAgentTextDeliveryAttemptInput,
    'expectedSessionAuthorityGeneration' | 'expectedAgentId'
  >,
): Promise<boolean> {
  return (
    record.reservedSessionAuthorityGeneration ===
      input.expectedSessionAuthorityGeneration &&
    record.agentBindingDigest ===
      await nonAgentTextDeliveryAgentBindingDigest(input.expectedAgentId)
  );
}

async function attemptTokenExists(
  db: D1DatabaseLike,
  token: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS token_exists
       FROM non_agent_text_delivery_attempts
       WHERE delivery_attempt_token = ?
       LIMIT 1`,
    )
    .bind(token)
    .first<{ token_exists: number }>();
  return row?.token_exists === 1;
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

function recordFromRow(row: NonAgentTextDeliveryRow): NonAgentTextDeliveryRecord {
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
    sendingLeaseExpiresAt: row.sending_lease_expires_at,
    providerMessageId: row.provider_message_id,
    outcomeCode: row.outcome_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

async function readPreparedTurn(
  db: D1DatabaseLike,
  turnId: string,
) {
  const row = await db
    .prepare('SELECT * FROM conversation_turns WHERE id = ? LIMIT 1')
    .bind(turnId)
    .first<ConversationTurnRow>();
  return row ? turnFromRow(row) : undefined;
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

function blockedBegin(
  reason: Extract<
    BeginNonAgentTextDeliveryAttemptResult,
    { status: 'dispatch_blocked' }
  >['reason'],
  record?: NonAgentTextDeliveryRecord,
): BeginNonAgentTextDeliveryAttemptResult {
  return {
    status: 'dispatch_blocked',
    reason,
    ...(record ? { record } : {}),
  };
}

function blockedComplete(
  reason: Extract<
    CompleteNonAgentTextDeliveryAttemptResult,
    { status: 'transition_blocked' }
  >['reason'],
  record?: NonAgentTextDeliveryRecord,
): CompleteNonAgentTextDeliveryAttemptResult {
  return {
    status: 'transition_blocked',
    reason,
    ...(record ? { record } : {}),
  };
}

function blockedReconcile(
  reason: Extract<
    ReconcileNonAgentTextDeliveryResult,
    { status: 'reconciliation_blocked' }
  >['reason'],
  record?: NonAgentTextDeliveryRecord,
): ReconcileNonAgentTextDeliveryResult {
  return {
    status: 'reconciliation_blocked',
    reason,
    ...(record ? { record } : {}),
  };
}
