import type { PoolClient } from 'pg';
import type {
  IrreversibleOperationCompletion,
  IrreversibleOperationInput,
  IrreversibleOperationOwner,
  IrreversibleOperationReservation,
  MarkIrreversibleOperationOutcomeUnknownIfExpiredInput,
  MarkIrreversibleOperationOutcomeUnknownIfExpiredResult,
} from './contracts.js';
import { isConnectablePostgres } from './postgresStoreRunOwner.js';
import { captureActivePostgresSessionAuthority } from './postgresStoreSessionAuthority.js';
import type {
  IrreversibleOperationRow,
  Queryable,
} from './postgresStoreSupport.js';

export async function reservePostgresIrreversibleOperation(input: {
  db: Queryable;
  operation: IrreversibleOperationInput;
}): Promise<IrreversibleOperationReservation> {
  return withOperationTransaction(input.db, async (client) => {
    const authority = await captureActivePostgresSessionAuthority(
      client,
      input.operation.sessionId,
    );
    const current = await readOperationRow(client, input.operation, true);
    if (current) {
      return reserveExistingOperation({
        client,
        operation: input.operation,
        current,
        authority,
      });
    }
    if (authority === undefined) {
      throw new Error('session_ai_authority_unavailable');
    }

    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + 30_000);
    const leaseToken = crypto.randomUUID();
    const inserted = await client.query<IrreversibleOperationRow>(
      `INSERT INTO irreversible_operations (
         request_id, session_id, operation, binding_fingerprint,
         session_authority_generation, result_json, status, attempt_count,
         lease_expires_at, lease_token, last_error, created_at, completed_at
       ) VALUES (
         $1, $2, $3, $4, $5, NULL, 'attempting', 1,
         $6, $7, NULL, $8, NULL
       )
       ON CONFLICT (request_id) DO NOTHING
       RETURNING *`,
      [
        input.operation.requestId,
        input.operation.sessionId,
        input.operation.operation,
        input.operation.bindingFingerprint,
        authority,
        leaseExpiresAt,
        leaseToken,
        now,
      ],
    );
    const row =
      inserted.rows[0] ??
      (await readOperationRow(client, input.operation, true));
    if (!row) throw new Error('postgres_operation_reservation_missing');
    if (inserted.rows[0] === undefined) {
      return reserveExistingOperation({
        client,
        operation: input.operation,
        current: row,
        authority,
      });
    }
    return {
      status: 'reserved',
      attempt: 1,
      leaseToken,
      reconciliation: false,
      sessionAuthorityGeneration: authority,
    };
  });
}

export async function getPostgresIrreversibleOperation(input: {
  db: Queryable;
  operation: IrreversibleOperationInput;
}): Promise<IrreversibleOperationReservation | undefined> {
  return withOperationTransaction(input.db, async (client) => {
    const authority = await captureActivePostgresSessionAuthority(
      client,
      input.operation.sessionId,
    );
    const current = await readOperationRow(client, input.operation, true);
    return current &&
      authority !== undefined &&
      current.session_authority_generation === authority
      ? existingOperationResult(current)
      : undefined;
  });
}

export async function completePostgresIrreversibleOperation(input: {
  db: Queryable;
  operation: IrreversibleOperationInput;
  owner: IrreversibleOperationOwner;
  result: Record<string, unknown>;
}): Promise<IrreversibleOperationCompletion> {
  return withOperationTransaction(input.db, async (client) => {
    const authority = await captureActivePostgresSessionAuthority(
      client,
      input.operation.sessionId,
    );
    if (authority === input.owner.sessionAuthorityGeneration) {
      await client.query(
        `UPDATE irreversible_operations
         SET result_json = $1,
             status = 'completed',
             lease_expires_at = NULL,
             last_error = NULL,
             completed_at = clock_timestamp()
         WHERE request_id = $2
           AND session_id = $3
           AND operation = $4
           AND binding_fingerprint = $5
           AND session_authority_generation = $6
           AND status = 'attempting'
           AND attempt_count = $7
           AND lease_token = $8
           AND clock_timestamp() < lease_expires_at`,
        [
          input.result,
          input.operation.requestId,
          input.operation.sessionId,
          input.operation.operation,
          input.operation.bindingFingerprint,
          input.owner.sessionAuthorityGeneration,
          input.owner.attempt,
          input.owner.leaseToken,
        ],
      );
    }
    const current = await readOperationRow(client, input.operation, true);
    if (!current) {
      throw new Error(
        `Irreversible operation reservation not found: ${
          input.operation.requestId
        }`,
      );
    }
    return authority === input.owner.sessionAuthorityGeneration &&
      current.session_authority_generation ===
        input.owner.sessionAuthorityGeneration &&
      current.status === 'completed' &&
      current.result_json
      ? { status: 'completed', result: current.result_json }
      : { status: 'lost' };
  });
}

export async function markPostgresIrreversibleOperationOutcomeUnknownIfExpired(input: {
  db: Queryable;
  operation: MarkIrreversibleOperationOutcomeUnknownIfExpiredInput;
}): Promise<MarkIrreversibleOperationOutcomeUnknownIfExpiredResult> {
  return withOperationTransaction(input.db, async (client) => {
    const authority = await captureActivePostgresSessionAuthority(
      client,
      input.operation.sessionId,
    );
    const current = await readOperationRow(client, input.operation, true);
    if (
      !current ||
      authority === undefined ||
      current.session_authority_generation !== authority
    ) {
      return { status: 'pending' };
    }
    if (current.status === 'completed' && current.result_json) {
      return { status: 'completed', result: current.result_json };
    }
    if (current.status === 'unknown') {
      return {
        status: 'unknown',
        lastError: current.last_error,
        transitioned: false,
      };
    }
    const changed = await client.query<IrreversibleOperationRow>(
      `UPDATE irreversible_operations
       SET status = 'unknown',
           lease_expires_at = NULL,
           last_error = $1
       WHERE request_id = $2
         AND session_id = $3
         AND operation = $4
         AND binding_fingerprint = $5
         AND session_authority_generation = $6
         AND status = 'attempting'
         AND clock_timestamp() >= lease_expires_at
       RETURNING *`,
      [
        input.operation.reason,
        input.operation.requestId,
        input.operation.sessionId,
        input.operation.operation,
        input.operation.bindingFingerprint,
        authority,
      ],
    );
    if (!changed.rows[0]) return { status: 'pending' };
    return {
      status: 'unknown',
      lastError: changed.rows[0].last_error,
      transitioned: true,
    };
  });
}

export async function failPostgresIrreversibleOperation(input: {
  db: Queryable;
  operation: IrreversibleOperationInput;
  owner: IrreversibleOperationOwner;
  error: string;
}): Promise<void> {
  await withOperationTransaction(input.db, async (client) => {
    const authority = await captureActivePostgresSessionAuthority(
      client,
      input.operation.sessionId,
    );
    if (authority === input.owner.sessionAuthorityGeneration) {
      await client.query(
        `UPDATE irreversible_operations
         SET status = 'unknown',
             lease_expires_at = NULL,
             last_error = $1
         WHERE request_id = $2
           AND session_id = $3
           AND operation = $4
           AND binding_fingerprint = $5
           AND session_authority_generation = $6
           AND status = 'attempting'
           AND attempt_count = $7
           AND lease_token = $8
           AND clock_timestamp() < lease_expires_at`,
        [
          input.error,
          input.operation.requestId,
          input.operation.sessionId,
          input.operation.operation,
          input.operation.bindingFingerprint,
          input.owner.sessionAuthorityGeneration,
          input.owner.attempt,
          input.owner.leaseToken,
        ],
      );
    }
    if (!(await readOperationRow(client, input.operation, true))) {
      throw new Error(
        `Irreversible operation reservation not found: ${
          input.operation.requestId
        }`,
      );
    }
  });
}

async function reserveExistingOperation(input: {
  client: PoolClient;
  operation: IrreversibleOperationInput;
  current: IrreversibleOperationRow;
  authority: number | undefined;
}): Promise<IrreversibleOperationReservation> {
  assertOperationMatches(input.current, input.operation);
  if (
    input.authority === undefined ||
    input.current.session_authority_generation !== input.authority
  ) {
    throw new Error('session_ai_authority_unavailable');
  }
  if (input.current.status === 'completed' && input.current.result_json) {
    return {
      status: 'completed',
      result: input.current.result_json,
    };
  }
  const now = new Date();
  const leaseExpired =
    input.current.lease_expires_at !== null &&
    new Date(input.current.lease_expires_at) <= now;
  if (input.current.status === 'unknown' || leaseExpired) {
    const leaseToken = crypto.randomUUID();
    const leaseExpiresAt = new Date(now.getTime() + 30_000);
    const claimed = await input.client.query<IrreversibleOperationRow>(
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
         AND session_authority_generation = $7
         AND status <> 'completed'
         AND (status = 'unknown' OR lease_expires_at <= $8)
       RETURNING *`,
      [
        leaseExpiresAt,
        leaseToken,
        input.operation.requestId,
        input.operation.sessionId,
        input.operation.operation,
        input.operation.bindingFingerprint,
        input.authority,
        now,
      ],
    );
    if (claimed.rows[0]) {
      return {
        status: 'reserved',
        attempt: claimed.rows[0].attempt_count,
        leaseToken,
        reconciliation: true,
        sessionAuthorityGeneration:
          claimed.rows[0].session_authority_generation,
      };
    }
  }
  return input.current.status === 'unknown'
    ? { status: 'unknown', lastError: input.current.last_error }
    : { status: 'pending' };
}

function existingOperationResult(
  current: IrreversibleOperationRow,
): IrreversibleOperationReservation {
  if (current.status === 'completed' && current.result_json) {
    return { status: 'completed', result: current.result_json };
  }
  return current.status === 'unknown'
    ? { status: 'unknown', lastError: current.last_error }
    : { status: 'pending' };
}

async function readOperationRow(
  db: Queryable,
  operation: IrreversibleOperationInput,
  forUpdate: boolean,
): Promise<IrreversibleOperationRow | undefined> {
  const result = await db.query<IrreversibleOperationRow>(
    `SELECT *
     FROM irreversible_operations
     WHERE request_id = $1
     ${forUpdate ? 'FOR UPDATE' : ''}`,
    [operation.requestId],
  );
  const row = result.rows[0];
  if (row) assertOperationMatches(row, operation);
  return row;
}

function assertOperationMatches(
  row: IrreversibleOperationRow,
  operation: IrreversibleOperationInput,
): void {
  if (
    row.session_id !== operation.sessionId ||
    row.operation !== operation.operation ||
    row.binding_fingerprint !== operation.bindingFingerprint
  ) {
    throw new Error(
      `Irreversible operation binding conflict: ${operation.requestId}`,
    );
  }
}

async function withOperationTransaction<Result>(
  db: Queryable,
  operation: (client: PoolClient) => Promise<Result>,
): Promise<Result> {
  if (!isConnectablePostgres(db)) {
    throw new Error('postgres_atomic_operation_reservation_unavailable');
  }
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
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
