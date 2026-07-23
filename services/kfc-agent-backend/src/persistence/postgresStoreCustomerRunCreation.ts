import {
  CustomerRunIdempotencyConflictError,
  type CustomerRun,
} from '../customerRuns/contracts.js';
import type {
  CreateCustomerRunInput,
} from './contracts.js';
import {
  isConnectablePostgres,
} from './postgresStoreRunOwner.js';
import {
  captureActivePostgresSessionAuthority,
} from './postgresStoreSessionAuthority.js';
import {
  customerRunFromRow,
  type CustomerRunRow,
  type Queryable,
} from './postgresStoreSupport.js';

export async function createPostgresCustomerRun(input: {
  db: Queryable;
  operation: CreateCustomerRunInput;
}): Promise<CustomerRun> {
  if (!isConnectablePostgres(input.db)) {
    throw new Error('postgres_atomic_customer_run_creation_unavailable');
  }
  const client = await input.db.connect();
  try {
    await client.query('BEGIN');
    const authority = await captureActivePostgresSessionAuthority(
      client,
      input.operation.sessionId,
    );
    const existing = await client.query<CustomerRunRow>(
      `SELECT *
       FROM customer_runs
       WHERE session_id = $1
         AND client_message_id = $2
       FOR UPDATE`,
      [
        input.operation.sessionId,
        input.operation.clientMessageId,
      ],
    );
    if (existing.rows[0]) {
      const run = customerRunFromRow(existing.rows[0]);
      assertMatchingRequest(run, input.operation);
      await client.query('COMMIT');
      return run;
    }
    if (authority === undefined) {
      throw new Error('session_ai_authority_unavailable');
    }
    const inserted = await client.query<CustomerRunRow>(
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
        input.operation.id,
        input.operation.schemaVersion,
        input.operation.sessionId,
        input.operation.customerId,
        input.operation.clientMessageId,
        input.operation.requestFingerprint,
        input.operation.generation,
        authority,
        input.operation.status,
        input.operation.phase,
        input.operation.nextEventSequence,
        input.operation.clientSchemaVersion,
        input.operation.acceptedAt,
        input.operation.startedAt,
        input.operation.terminalAt,
        input.operation.updatedAt,
      ],
    );
    const row = inserted.rows[0];
    if (!row) throw new Error('Customer run was not persisted');
    await client.query('COMMIT');
    return customerRunFromRow(row);
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

function assertMatchingRequest(
  stored: CustomerRun,
  input: CreateCustomerRunInput,
): void {
  if (stored.requestFingerprint !== input.requestFingerprint) {
    throw new CustomerRunIdempotencyConflictError(
      input.sessionId,
      input.clientMessageId,
    );
  }
}
