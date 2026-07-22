import type { Pool, PoolClient } from 'pg';
import type { RunCommitFence } from './contracts.js';
import type { Queryable } from './postgresStoreSupport.js';
import {
  lockActivePostgresSessionAuthority,
} from './postgresStoreSessionAuthority.js';

export interface PostgresRunCommitGuard {
  sessionId: string;
  fence: RunCommitFence;
  notAfter?: string;
}

interface ConnectablePostgres {
  connect(): Promise<PoolClient>;
}

export function isConnectablePostgres(
  db: Queryable,
): db is Pool & ConnectablePostgres {
  return typeof (db as Partial<ConnectablePostgres>).connect === 'function';
}

export async function lockPostgresRunCommitOwner(
  client: PoolClient,
  input: PostgresRunCommitGuard,
): Promise<boolean> {
  if (!await lockActivePostgresSessionAuthority({
    client,
    sessionId: input.sessionId,
    expectedGeneration:
      input.fence.sessionAuthorityGeneration,
  })) {
    return false;
  }
  switch (input.fence.kind) {
    case 'agent_run':
      return lockAgentRunOwner(client, input, input.fence);
    case 'customer_run':
      return hasLockedRow(client, {
        query: `SELECT id
          FROM customer_runs
          WHERE id = $1
            AND session_id = $2
            AND session_authority_generation = $3
            AND status IN ('accepted', 'running')
            AND (
              $4::timestamptz IS NULL OR
              clock_timestamp() < $4
            )
          FOR UPDATE`,
        bindings: [
          input.fence.runId,
          input.sessionId,
          input.fence.sessionAuthorityGeneration,
          input.notAfter ?? null,
        ],
      });
    case 'operation_lease':
      return hasLockedRow(client, {
        query: `SELECT request_id
          FROM irreversible_operations
          WHERE request_id = $1
            AND session_id = $2
            AND operation = $3
            AND binding_fingerprint = $4
            AND session_authority_generation = $5
            AND status = 'attempting'
            AND attempt_count = $6
            AND lease_token = $7
            AND clock_timestamp() < lease_expires_at
            AND (
              $8::timestamptz IS NULL OR
              clock_timestamp() < $8
            )
          FOR UPDATE`,
        bindings: [
          input.fence.requestId,
          input.sessionId,
          input.fence.operation,
          input.fence.bindingFingerprint,
          input.fence.sessionAuthorityGeneration,
          input.fence.attempt,
          input.fence.leaseToken,
          input.notAfter ?? null,
        ],
      });
  }
}

async function lockAgentRunOwner(
  client: PoolClient,
  input: PostgresRunCommitGuard,
  fence: Extract<RunCommitFence, { kind: 'agent_run' }>,
): Promise<boolean> {
  const run = await client.query<{ id: string }>(
    `SELECT id
     FROM agent_runs
     WHERE id = $1
       AND session_id = $2
       AND generation = $3
       AND session_authority_generation = $4
       AND status = 'running'
       AND execution_attempt = $5
       AND execution_lease_token = $6
       AND execution_lease_expires_at IS NOT NULL
       AND clock_timestamp() < execution_lease_expires_at
       AND (
         $7::timestamptz IS NULL OR
         clock_timestamp() < $7
       )
     FOR UPDATE`,
    [
      fence.runId,
      input.sessionId,
      fence.generation,
      fence.sessionAuthorityGeneration,
      fence.executionAttempt,
      fence.executionLeaseToken,
      input.notAfter ?? null,
    ],
  );
  if (run.rowCount !== 1) return false;
  return hasLockedRow(client, {
    query: `SELECT session_id
      FROM session_agent_state
      WHERE session_id = $1
        AND current_run_id = $2
        AND generation = $3
      FOR UPDATE`,
    bindings: [input.sessionId, fence.runId, fence.generation],
  });
}

async function hasLockedRow(
  client: PoolClient,
  input: { query: string; bindings: unknown[] },
): Promise<boolean> {
  const result = await client.query(input.query, input.bindings);
  return result.rowCount === 1;
}
