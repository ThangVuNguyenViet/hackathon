import type { Pool, PoolClient } from 'pg';
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
  IrreversibleOperationRow,
  Queryable,
} from './postgresStoreSupport.js';
import {
  lockPostgresSessionAuthority,
} from './postgresStoreSessionAuthority.js';
import {
  commerceApprovalPrincipalStorageEvidenceRef,
  commerceApprovalPrincipalStorageSubject,
} from '../ordering/commerceApprovalPrincipal.js';

function currentPauseExistsSql(firstParameter: number): string {
  const parameter = (offset: number) => `$${firstParameter + offset}`;
  return `EXISTS (
    SELECT 1
    FROM confirmation_pauses AS pause
    JOIN confirmation_pause_sessions AS session
      ON session.session_id = pause.session_id
     AND session.generation = pause.session_generation
    WHERE pause.request_id = ${parameter(0)}
      AND pause.status = 'pending'
      AND pause.expires_at > ${parameter(1)}
      AND pause.checkpoint_thread_id = ${parameter(2)}
      AND pause.checkpoint_namespace = ${parameter(3)}
      AND pause.checkpoint_id = ${parameter(4)}
      AND pause.created_at = ${parameter(5)}
      AND pause.expires_at = ${parameter(6)}
      AND pause.action_digest = ${parameter(7)}
      AND pause.approval_binding_digest = ${parameter(8)}
      AND pause.session_id = ${parameter(9)}
      AND pause.customer_id = ${parameter(10)}
      AND pause.channel = ${parameter(11)}
      AND pause.authenticated_subject = ${parameter(12)}
      AND pause.authentication_evidence_ref = ${parameter(13)}
      AND pause.session_generation = ${parameter(14)}
      AND pause.pause_identity_digest = ${parameter(15)}
      AND ${currentConfirmationPauseAuthoritySql('pause')}
  )`;
}

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
  db: Queryable,
  requestId: string,
): Promise<ConfirmationPauseStorageSnapshot | undefined> {
  const result = await db.query<ConfirmationPauseStorageRow>(
    `SELECT pause.*
     FROM confirmation_pauses AS pause
     JOIN confirmation_pause_sessions AS session
       ON session.session_id = pause.session_id
      AND session.generation = pause.session_generation
     WHERE pause.request_id = $1
       AND ${currentConfirmationPauseAuthoritySql('pause')}
     LIMIT 1`,
    [requestId],
  );
  return result.rows[0]
    ? confirmationPauseSnapshotFromStorageRow(result.rows[0])
    : undefined;
}

async function operationRow(
  db: Queryable,
  input: ReserveConfirmationResumeOperationInput,
): Promise<IrreversibleOperationRow | 'conflict' | undefined> {
  const result = await db.query<IrreversibleOperationRow>(
    `SELECT *
     FROM irreversible_operations
     WHERE request_id = $1
     LIMIT 1`,
    [input.requestId],
  );
  const row = result.rows[0];
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
    return { status: 'completed', result: row.result_json };
  }
  return row.status === 'unknown'
    ? { status: 'unknown', lastError: row.last_error }
    : { status: 'pending' };
}

async function missingOperationResult(
  db: Queryable,
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

async function reservePostgresConfirmationResumeOperationWithClient(
  db: Queryable,
  input: ReserveConfirmationResumeOperationInput,
  sessionAuthorityGeneration: number,
): Promise<ReserveConfirmationResumeOperationResult> {
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
  );
  const leaseToken = crypto.randomUUID();
  const inserted = await db.query<IrreversibleOperationRow>(
    `INSERT INTO irreversible_operations (
       request_id, session_id, operation, binding_fingerprint, result_json,
       session_authority_generation, status, attempt_count,
       lease_expires_at, lease_token, last_error, created_at, completed_at
     )
     SELECT $1, $2, $3, $4, NULL, $8, 'attempting', 1,
            $5, $6, NULL, $7, NULL
     WHERE ${currentPauseExistsSql(9)}
     ON CONFLICT (request_id) DO NOTHING
     RETURNING *`,
    [
      input.requestId,
      input.sessionId,
      input.operation,
      input.bindingFingerprint,
      leaseExpiresAt,
      leaseToken,
      new Date(input.claimedAt),
      sessionAuthorityGeneration,
      ...currentPauseBindings(pause, input.claimedAt),
    ],
  );
  if (inserted.rows[0]) {
    return {
      status: 'reserved',
      attempt: 1,
      leaseToken,
      reconciliation: false,
      sessionAuthorityGeneration:
        inserted.rows[0].session_authority_generation,
    };
  }
  let operation = await operationRow(db, input);
  if (operation === 'conflict') return { status: 'conflict' };
  if (!operation) return missingOperationResult(db, input);
  if (operation.status === 'completed') {
    return existingOperationResult(operation);
  }
  const leaseExpired =
    operation.lease_expires_at !== null &&
    new Date(operation.lease_expires_at).getTime() <=
      Date.parse(input.claimedAt);
  if (operation.status === 'unknown' || leaseExpired) {
    const nextLeaseToken = crypto.randomUUID();
    const claimed = await db.query<IrreversibleOperationRow>(
      `UPDATE irreversible_operations
       SET status = 'attempting',
           attempt_count = attempt_count + 1,
           lease_expires_at = $1,
           lease_token = $2,
           last_error = NULL
       WHERE request_id = $3
         AND session_id = $4
         AND operation = $5
         AND binding_fingerprint = $6
         AND status <> 'completed'
         AND (status = 'unknown' OR lease_expires_at <= $7)
         AND session_authority_generation = $8
         AND ${currentPauseExistsSql(9)}
       RETURNING *`,
      [
        leaseExpiresAt,
        nextLeaseToken,
        input.requestId,
        input.sessionId,
        input.operation,
        input.bindingFingerprint,
        new Date(input.claimedAt),
        sessionAuthorityGeneration,
        ...currentPauseBindings(pause, input.claimedAt),
      ],
    );
    if (claimed.rows[0]) {
      return {
        status: 'reserved',
        attempt: claimed.rows[0].attempt_count,
        leaseToken: nextLeaseToken,
        reconciliation: true,
        sessionAuthorityGeneration:
          claimed.rows[0].session_authority_generation,
      };
    }
  }
  operation = await operationRow(db, input);
  if (operation === 'conflict') return { status: 'conflict' };
  return operation
    ? existingOperationResult(operation)
    : missingOperationResult(db, input);
}

interface ConnectablePostgres {
  connect(): Promise<PoolClient>;
}

function isConnectable(
  db: Queryable,
): db is Pool & ConnectablePostgres {
  return typeof (db as Partial<ConnectablePostgres>).connect === 'function';
}

export async function reservePostgresConfirmationResumeOperation(
  db: Queryable,
  value: ReserveConfirmationResumeOperationInput,
): Promise<ReserveConfirmationResumeOperationResult> {
  const input = await parseReserveConfirmationResumeOperationInput(value);
  if (!isConnectable(db)) {
    throw new Error('postgres_atomic_confirmation_claim_unavailable');
  }
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await lockPostgresSessionAuthority(client, input.sessionId);
    const authority = await client.query<{
      session_authority_generation: number;
    }>(
      `SELECT COALESCE(control.session_authority_generation, 0)
         AS session_authority_generation
       FROM (SELECT 1) AS singleton
       LEFT JOIN session_controls AS control
         ON control.session_id = $1
       WHERE COALESCE(control.agent_mode, 'ai_active') = 'ai_active'`,
      [input.sessionId],
    );
    const sessionAuthorityGeneration =
      authority.rows[0]?.session_authority_generation;
    if (sessionAuthorityGeneration === undefined) {
      await client.query('COMMIT');
      return { status: 'conflict' };
    }
    const locked = await client.query<{ generation: number }>(
      `SELECT generation
       FROM confirmation_pause_sessions
       WHERE session_id = $1
       FOR UPDATE`,
      [input.sessionId],
    );
    if (
      locked.rows[0]?.generation !== input.expectedSessionGeneration
    ) {
      await client.query('COMMIT');
      return { status: 'not_found' };
    }
    const result =
      await reservePostgresConfirmationResumeOperationWithClient(
        client,
        input,
        Number(sessionAuthorityGeneration),
      );
    await client.query('COMMIT');
    return result;
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
