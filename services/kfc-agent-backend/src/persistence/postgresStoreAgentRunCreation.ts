import type { AgentRun } from '../domain/types.js';
import type {
  ClaimAgentRunResult,
  CreateAgentRunInput,
} from './contracts.js';
import {
  agentRunFromRow,
  type AgentRunRow,
  type Queryable,
} from './postgresStoreSupport.js';
import {
  isConnectablePostgres,
} from './postgresStoreRunOwner.js';
import {
  captureActivePostgresSessionAuthority,
} from './postgresStoreSessionAuthority.js';

const insertAgentRunSql = `INSERT INTO agent_runs (
  id, session_id, generation, session_authority_generation,
  channel, external_user_id, status, coalesced_input_text,
  superseded_by_run_id, irreversible_side_effect_at,
  irreversible_tool_name, assistant_turn_id, delivery_status,
  delivery_external_message_id, error_code, error_message,
  scheduled_at, started_at, completed_at, updated_at
)
VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
  $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
)`;

export async function createPostgresAgentRun(input: {
  db: Queryable;
  operation: CreateAgentRunInput;
}): Promise<AgentRun> {
  return withAgentRunCreation(input, async (authority, client) => {
    const result = await client.query<AgentRunRow>(
      `${insertAgentRunSql} RETURNING *`,
      agentRunValues(input.operation, authority),
    );
    const row = result.rows[0];
    if (!row) throw new Error('postgres_agent_run_creation_missing');
    return agentRunFromRow(row);
  });
}

export async function claimPostgresAgentRun(input: {
  db: Queryable;
  operation: CreateAgentRunInput;
}): Promise<ClaimAgentRunResult> {
  return withAgentRunCreation(input, async (authority, client) => {
    const existing = await client.query<AgentRunRow>(
      `SELECT *
       FROM agent_runs
       WHERE session_id = $1 AND generation = $2
       FOR UPDATE`,
      [input.operation.sessionId, input.operation.generation],
    );
    if (existing.rows[0]) {
      return {
        run: agentRunFromRow(existing.rows[0]),
        claimed: false,
      };
    }
    const result = await client.query<AgentRunRow>(
      `${insertAgentRunSql} RETURNING *`,
      agentRunValues(input.operation, authority),
    );
    const inserted = result.rows[0];
    if (!inserted) throw new Error('postgres_agent_run_claim_missing');
    return { run: agentRunFromRow(inserted), claimed: true };
  });
}

function agentRunValues(
  input: CreateAgentRunInput,
  sessionAuthorityGeneration: number,
): unknown[] {
  return [
    input.id,
    input.sessionId,
    input.generation,
    sessionAuthorityGeneration,
    input.channel,
    input.externalUserId,
    input.status,
    input.coalescedInputText,
    input.supersededByRunId ?? null,
    input.irreversibleSideEffectAt ?? null,
    input.irreversibleToolName ?? null,
    input.assistantTurnId ?? null,
    input.deliveryStatus,
    input.deliveryExternalMessageId ?? null,
    input.errorCode ?? null,
    input.errorMessage ?? null,
    input.scheduledAt,
    input.startedAt ?? null,
    input.completedAt ?? null,
    input.updatedAt ?? new Date().toISOString(),
  ];
}

async function withAgentRunCreation<Result>(
  input: {
    db: Queryable;
    operation: CreateAgentRunInput;
  },
  operation: (
    authority: number,
    client: import('pg').PoolClient,
  ) => Promise<Result>,
): Promise<Result> {
  if (!isConnectablePostgres(input.db)) {
    throw new Error('postgres_atomic_agent_run_creation_unavailable');
  }
  const client = await input.db.connect();
  try {
    await client.query('BEGIN');
    const authority = await captureActivePostgresSessionAuthority(
      client,
      input.operation.sessionId,
    );
    if (authority === undefined) {
      throw new Error('session_ai_authority_unavailable');
    }
    const result = await operation(authority, client);
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
