import type { AgentRun } from '../domain/types.js';
import type {
  ClaimAgentRunResult,
  CreateAgentRunInput,
} from './contracts.js';
import {
  agentRunFromRow,
  type AgentRunRow,
  type D1DatabaseLike,
} from './d1StoreSupport.js';
import {
  d1ActiveSessionAuthoritySource,
} from './d1StoreSessionAuthority.js';

const insertAgentRunSql = `INSERT INTO agent_runs (
  id, session_id, generation, session_authority_generation,
  channel, external_user_id, status, coalesced_input_text,
  superseded_by_run_id, irreversible_side_effect_at,
  irreversible_tool_name, assistant_turn_id, delivery_status,
  delivery_external_message_id, error_code, error_message,
  scheduled_at, started_at, completed_at, updated_at
)
SELECT ?, ?, ?, authority.session_authority_generation,
       ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
FROM (${d1ActiveSessionAuthoritySource}) AS authority`;

export async function createD1AgentRun(input: {
  db: D1DatabaseLike;
  operation: CreateAgentRunInput;
}): Promise<AgentRun> {
  const values = agentRunValues(input.operation);
  const inserted = await input.db.prepare(insertAgentRunSql)
    .bind(...values, input.operation.sessionId)
    .run();
  if (Number(inserted.meta.changes ?? 0) !== 1) {
    throw new Error('session_ai_authority_unavailable');
  }
  const row = await input.db.prepare(
    `SELECT * FROM agent_runs WHERE id = ? LIMIT 1`,
  ).bind(input.operation.id).first<AgentRunRow>();
  if (!row) throw new Error('d1_agent_run_insert_missing');
  return agentRunFromRow(row);
}

export async function claimD1AgentRun(input: {
  db: D1DatabaseLike;
  operation: CreateAgentRunInput;
}): Promise<ClaimAgentRunResult> {
  const values = agentRunValues(input.operation);
  const inserted = await input.db.prepare(
    insertAgentRunSql.replace(
      'INSERT INTO agent_runs',
      'INSERT OR IGNORE INTO agent_runs',
    ),
  ).bind(...values, input.operation.sessionId).run();
  const row = await input.db.prepare(
    `SELECT * FROM agent_runs
     WHERE session_id = ? AND generation = ? LIMIT 1`,
  ).bind(
    input.operation.sessionId,
    input.operation.generation,
  ).first<AgentRunRow>();
  if (!row) throw new Error(
    `Agent run claim missing: ${
      input.operation.sessionId
    }/${input.operation.generation}`,
  );
  return {
    run: agentRunFromRow(row),
    claimed: Number(inserted.meta.changes ?? 0) === 1,
  };
}

function agentRunValues(input: CreateAgentRunInput): unknown[] {
  return [
    input.id,
    input.sessionId,
    input.generation,
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
