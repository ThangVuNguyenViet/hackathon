import {
  confirmationPauseSnapshotFromStorageRow,
  confirmationResumeOperationAuthorityMatches,
  currentConfirmationPauseAuthoritySql,
  parseReserveConfirmationResumeOperationInput,
  type ConfirmationPauseStorageRow,
  type ConfirmationPauseStorageSnapshot,
} from './confirmationPause.js';
import type {
  ReserveConfirmationResumeOperationInput,
  ReserveConfirmationResumeOperationResult,
} from './contracts.js';
import type {
  D1DatabaseLike,
  IrreversibleOperationRow,
} from './d1StoreSupport.js';
import {
  d1ActiveSessionAuthoritySource,
} from './d1StoreSessionAuthority.js';
import {
  commerceApprovalPrincipalStorageEvidenceRef,
  commerceApprovalPrincipalStorageSubject,
} from '../ordering/commerceApprovalPrincipal.js';

const currentPauseExistsSql = `EXISTS (
  SELECT 1
  FROM confirmation_pauses AS pause
  JOIN confirmation_pause_sessions AS session
    ON session.session_id = pause.session_id
   AND session.generation = pause.session_generation
  WHERE pause.request_id = ?
    AND pause.status = 'pending'
    AND pause.expires_at > ?
    AND pause.checkpoint_thread_id = ?
    AND pause.checkpoint_namespace = ?
    AND pause.checkpoint_id = ?
    AND pause.created_at = ?
    AND pause.expires_at = ?
    AND pause.action_digest = ?
    AND pause.approval_binding_digest = ?
    AND pause.session_id = ?
    AND pause.customer_id = ?
    AND pause.channel = ?
    AND pause.authenticated_subject = ?
    AND pause.authentication_evidence_ref = ?
    AND pause.session_generation = ?
    AND pause.pause_identity_digest = ?
    AND ${currentConfirmationPauseAuthoritySql('pause')}
)`;

function currentPauseBindings(
  snapshot: ConfirmationPauseStorageSnapshot,
  claimedAt: string,
): unknown[] {
  const record = snapshot.record;
  return [
    record.requestId,
    claimedAt,
    record.sourceTurnId,
    record.actionScope,
    record.actionId,
    record.createdAt,
    record.expiresAt,
    record.actionDigest,
    record.approvalBindingDigest,
    record.sessionId,
    record.customerId,
    record.channel,
    commerceApprovalPrincipalStorageSubject(record.principal),
    commerceApprovalPrincipalStorageEvidenceRef(record.principal),
    snapshot.sessionGeneration,
    snapshot.identityDigest,
  ];
}

async function currentPause(
  db: D1DatabaseLike,
  requestId: string,
): Promise<ConfirmationPauseStorageSnapshot | undefined> {
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
  return row ? confirmationPauseSnapshotFromStorageRow(row) : undefined;
}

async function operationRow(
  db: D1DatabaseLike,
  input: ReserveConfirmationResumeOperationInput,
): Promise<IrreversibleOperationRow | 'conflict' | undefined> {
  const row = await db.prepare(
    `SELECT request_id, session_id, operation, binding_fingerprint,
            session_authority_generation, result_json, status,
            attempt_count, lease_expires_at, lease_token, last_error
     FROM irreversible_operations
     WHERE request_id = ?`,
  ).bind(input.requestId).first<IrreversibleOperationRow>();
  if (!row) return undefined;
  return (
    row.session_id === input.sessionId &&
    row.operation === input.operation &&
    row.binding_fingerprint === input.bindingFingerprint
  )
    ? row
    : 'conflict';
}

function existingOperationResult(
  row: IrreversibleOperationRow,
): ReserveConfirmationResumeOperationResult {
  if (row.status === 'completed' && row.result_json) {
    return {
      status: 'completed',
      result: JSON.parse(row.result_json) as Record<string, unknown>,
    };
  }
  return row.status === 'unknown'
    ? { status: 'unknown', lastError: row.last_error }
    : { status: 'pending' };
}

async function missingOperationResult(
  db: D1DatabaseLike,
  input: ReserveConfirmationResumeOperationInput,
): Promise<ReserveConfirmationResumeOperationResult> {
  const pause = await currentPause(db, input.requestId);
  if (!pause) return { status: 'not_found' };
  if (
    pause.record.status === 'expired' ||
    Date.parse(pause.record.expiresAt) <= Date.parse(input.claimedAt)
  ) {
    return { status: 'expired' };
  }
  return { status: 'conflict' };
}

export async function reserveD1ConfirmationResumeOperation(
  db: D1DatabaseLike,
  value: ReserveConfirmationResumeOperationInput,
): Promise<ReserveConfirmationResumeOperationResult> {
  const input = await parseReserveConfirmationResumeOperationInput(value);
  const pause = await currentPause(db, input.requestId);
  if (!pause) return { status: 'not_found' };
  if (
    pause.record.status === 'expired' ||
    Date.parse(pause.record.expiresAt) <= Date.parse(input.claimedAt)
  ) {
    return { status: 'expired' };
  }
  if (
    pause.sessionGeneration !== input.expectedSessionGeneration ||
    !(await confirmationResumeOperationAuthorityMatches(
      pause.record,
      input,
    ))
  ) {
    return { status: 'conflict' };
  }

  const leaseExpiresAt = new Date(
    Date.parse(input.claimedAt) + input.leaseTtlMs,
  ).toISOString();
  const leaseToken = crypto.randomUUID();
  const inserted = await db.prepare(
    `INSERT OR IGNORE INTO irreversible_operations (
       request_id, session_id, operation, binding_fingerprint, result_json,
       session_authority_generation, status, attempt_count,
       lease_expires_at, lease_token, last_error, created_at, completed_at
     )
     SELECT ?, ?, ?, ?, NULL, authority.session_authority_generation,
            'attempting', 1, ?, ?, NULL, ?, NULL
     FROM (${d1ActiveSessionAuthoritySource}) AS authority
     WHERE ${currentPauseExistsSql}`,
  ).bind(
    input.requestId,
    input.sessionId,
    input.operation,
    input.bindingFingerprint,
    leaseExpiresAt,
    leaseToken,
    input.claimedAt,
    input.sessionId,
    ...currentPauseBindings(pause, input.claimedAt),
  ).run();
  let operation = await operationRow(db, input);
  if (operation === 'conflict') return { status: 'conflict' };
  if (!operation) return missingOperationResult(db, input);
  if (Number(inserted.meta.changes ?? 0) > 0) {
    return {
      status: 'reserved',
      attempt: 1,
      leaseToken,
      reconciliation: false,
      sessionAuthorityGeneration:
        operation.session_authority_generation,
    };
  }
  if (operation.status === 'completed') {
    return existingOperationResult(operation);
  }
  if (
    operation.status === 'unknown' ||
    (
      operation.lease_expires_at !== null &&
      operation.lease_expires_at <= input.claimedAt
    )
  ) {
    const nextLeaseToken = crypto.randomUUID();
    const claimed = await db.prepare(
      `UPDATE irreversible_operations
       SET status = 'attempting',
           attempt_count = attempt_count + 1,
           lease_expires_at = ?,
           lease_token = ?,
           last_error = NULL
       WHERE request_id = ?
         AND session_id = ?
         AND operation = ?
         AND binding_fingerprint = ?
         AND status <> 'completed'
         AND (status = 'unknown' OR lease_expires_at <= ?)
         AND EXISTS (
           SELECT 1
           FROM (${d1ActiveSessionAuthoritySource}) AS authority
           WHERE authority.session_authority_generation =
             irreversible_operations.session_authority_generation
         )
         AND ${currentPauseExistsSql}`,
    ).bind(
      leaseExpiresAt,
      nextLeaseToken,
      input.requestId,
      input.sessionId,
      input.operation,
      input.bindingFingerprint,
      input.claimedAt,
      input.sessionId,
      ...currentPauseBindings(pause, input.claimedAt),
    ).run();
    if (Number(claimed.meta.changes ?? 0) > 0) {
      operation = await operationRow(db, input);
      if (!operation || operation === 'conflict') {
        return { status: 'conflict' };
      }
      return {
        status: 'reserved',
        attempt: operation.attempt_count,
        leaseToken: nextLeaseToken,
        reconciliation: true,
        sessionAuthorityGeneration:
          operation.session_authority_generation,
      };
    }
  }
  operation = await operationRow(db, input);
  if (operation === 'conflict') return { status: 'conflict' };
  return operation
    ? existingOperationResult(operation)
    : missingOperationResult(db, input);
}
