import type { Pool, PoolClient } from 'pg';
import type {
  SessionControl,
  TransitionSessionAuthorityInput,
  TransitionSessionAuthorityResult,
} from './contracts.js';
import {
  defaultSessionControl,
  sessionControlFromRow,
  type Queryable,
  type SessionControlRow,
} from './postgresStoreSupport.js';

interface ConnectablePostgres {
  connect(): Promise<PoolClient>;
}

function isConnectablePostgres(
  db: Queryable,
): db is Pool & ConnectablePostgres {
  return typeof (db as Partial<ConnectablePostgres>).connect === 'function';
}

export async function lockPostgresSessionAuthority(
  client: PoolClient,
  sessionId: string,
): Promise<void> {
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
    [sessionId],
  );
}

export async function lockActivePostgresSessionAuthority(input: {
  client: PoolClient;
  sessionId: string;
  expectedGeneration: number;
}): Promise<boolean> {
  const generation = await captureActivePostgresSessionAuthority(
    input.client,
    input.sessionId,
  );
  return generation === input.expectedGeneration;
}

export async function captureActivePostgresSessionAuthority(
  client: PoolClient,
  sessionId: string,
): Promise<number | undefined> {
  await lockPostgresSessionAuthority(client, sessionId);
  const result = await client.query<SessionControlRow>(
    `SELECT * FROM session_controls
     WHERE session_id = $1
     FOR UPDATE`,
    [sessionId],
  );
  const row = result.rows[0];
  return row
    ? (
        row.agent_mode === 'ai_active'
          ? Number(row.session_authority_generation)
          : undefined
      )
    : 0;
}

export async function transitionPostgresSessionAuthority(input: {
  db: Queryable;
  operation: TransitionSessionAuthorityInput;
}): Promise<TransitionSessionAuthorityResult> {
  if (!isConnectablePostgres(input.db)) {
    throw new Error('postgres_atomic_session_authority_unavailable');
  }
  const client = await input.db.connect();
  try {
    await client.query('BEGIN');
    await lockPostgresSessionAuthority(
      client,
      input.operation.sessionId,
    );
    const current = await readLockedControl(
      client,
      input.operation.sessionId,
    );
    if (
      current.agentMode === input.operation.agentMode &&
      current.assignedAgentId === input.operation.assignedAgentId
    ) {
      await client.query('COMMIT');
      return { status: 'unchanged', control: current };
    }
    if (
      current.sessionAuthorityGeneration !==
      input.operation.expectedGeneration
    ) {
      await client.query('COMMIT');
      return { status: 'stale', control: current };
    }
    const control = await writeTransition(
      client,
      input.operation,
      current.sessionAuthorityGeneration + 1,
    );
    await client.query('COMMIT');
    return { status: 'transitioned', control };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the original transaction failure.
    }
    throw error;
  } finally {
    client.release();
  }
}

async function readLockedControl(
  client: PoolClient,
  sessionId: string,
): Promise<SessionControl> {
  const result = await client.query<SessionControlRow>(
    `SELECT * FROM session_controls
     WHERE session_id = $1
     FOR UPDATE`,
    [sessionId],
  );
  return result.rows[0]
    ? sessionControlFromRow(result.rows[0])
    : defaultSessionControl(sessionId);
}

async function writeTransition(
  client: PoolClient,
  operation: TransitionSessionAuthorityInput,
  generation: number,
): Promise<SessionControl> {
  const result = await client.query<SessionControlRow>(
    `INSERT INTO session_controls (
       session_id, agent_mode, assigned_agent_id,
       session_authority_generation, updated_at
     ) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (session_id) DO UPDATE SET
       agent_mode = EXCLUDED.agent_mode,
       assigned_agent_id = EXCLUDED.assigned_agent_id,
       session_authority_generation =
         EXCLUDED.session_authority_generation,
       updated_at = EXCLUDED.updated_at
     RETURNING *`,
    [
      operation.sessionId,
      operation.agentMode,
      operation.assignedAgentId,
      generation,
      operation.updatedAt ?? new Date().toISOString(),
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error('postgres_session_authority_write_missing');
  return sessionControlFromRow(row);
}
