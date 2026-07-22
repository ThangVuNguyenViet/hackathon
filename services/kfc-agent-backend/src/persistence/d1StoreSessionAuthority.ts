import type {
  SessionControl,
  TransitionSessionAuthorityInput,
  TransitionSessionAuthorityResult,
} from './contracts.js';
import {
  defaultSessionControl,
  sessionControlFromRow,
  type D1DatabaseLike,
  type SessionControlRow,
} from './d1StoreSupport.js';

export const d1ActiveSessionAuthoritySource = `SELECT
  COALESCE(control.session_authority_generation, 0)
    AS session_authority_generation
  FROM (SELECT 1) AS singleton
  LEFT JOIN session_controls AS control
    ON control.session_id = ?
  WHERE COALESCE(control.agent_mode, 'ai_active') = 'ai_active'`;

export async function transitionD1SessionAuthority(input: {
  db: D1DatabaseLike;
  operation: TransitionSessionAuthorityInput;
}): Promise<TransitionSessionAuthorityResult> {
  const operation = input.operation;
  const updatedAt = operation.updatedAt ?? new Date().toISOString();
  const changed = await input.db
    .prepare(
      `INSERT INTO session_controls (
       session_id, agent_mode, assigned_agent_id,
       session_authority_generation, updated_at
     )
     SELECT ?, ?, ?, 1, ?
     WHERE ? = 0
       AND (? <> 'ai_active' OR ? IS NOT NULL)
     ON CONFLICT(session_id) DO UPDATE SET
       agent_mode = excluded.agent_mode,
       assigned_agent_id = excluded.assigned_agent_id,
       session_authority_generation =
         session_controls.session_authority_generation + 1,
       updated_at = excluded.updated_at
     WHERE session_controls.session_authority_generation = ?
       AND (
         session_controls.agent_mode <> excluded.agent_mode OR
         session_controls.assigned_agent_id IS NOT excluded.assigned_agent_id
       )
     RETURNING *`,
    )
    .bind(
      operation.sessionId,
      operation.agentMode,
      operation.assignedAgentId,
      updatedAt,
      operation.expectedGeneration,
      operation.agentMode,
      operation.assignedAgentId,
      operation.expectedGeneration,
    )
    .first<SessionControlRow>();
  if (changed) {
    return {
      status: 'transitioned',
      control: sessionControlFromRow(changed),
    };
  }
  const control = await readD1SessionControl(input.db, operation.sessionId);
  return {
    status:
      control.agentMode === operation.agentMode &&
      control.assignedAgentId === operation.assignedAgentId
        ? 'unchanged'
        : 'stale',
    control,
  };
}

async function readD1SessionControl(
  db: D1DatabaseLike,
  sessionId: string,
): Promise<SessionControl> {
  const row = await db
    .prepare(`SELECT * FROM session_controls WHERE session_id = ? LIMIT 1`)
    .bind(sessionId)
    .first<SessionControlRow>();
  return row ? sessionControlFromRow(row) : defaultSessionControl(sessionId);
}
