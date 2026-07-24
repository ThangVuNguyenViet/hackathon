import type {
  SessionAgentModelBinding,
  SessionAgentState,
} from '../domain/types.js';
import type {
  AdvanceSessionAgentGenerationInput,
  AdvanceSessionAgentGenerationResult,
  BindSessionAgentModelInput,
  AgentRunPatch,
  ClaimAgentRunExecutionInput,
  ClaimAgentRunExecutionResult,
  ClaimSessionAgentRunOwnershipInput,
  ClaimSessionAgentRunOwnershipResult,
  SessionAgentStateInput,
  UpdateAgentRunIfExecutionCurrentInput,
  UpdateAgentRunIfExecutionCurrentResult,
} from './contracts.js';
import {
  MAXIMUM_AGENT_RUN_EXECUTION_ATTEMPTS,
  agentRunExecutionClaimRejection,
  agentRunExecutionReconciliationReason,
  assertAgentRunExecutionClaim,
} from './agentRunExecutionLease.js';
import {
  agentRunFromRow,
  defaultSessionAgentState,
  sessionAgentStateFromRow,
  sessionAgentModelBindingJson,
  type AgentRunRow,
  type D1DatabaseLike,
  type D1Result,
  type SessionAgentStateRow,
} from './d1StoreSupport.js';
import { d1ActiveSessionAuthoritySource } from './d1StoreSessionAuthority.js';

export async function getD1SessionAgentState(
  db: D1DatabaseLike,
  sessionId: string,
): Promise<SessionAgentState> {
  return readD1SessionAgentState(db, sessionId);
}

export async function setD1SessionAgentState(
  db: D1DatabaseLike,
  input: SessionAgentStateInput,
): Promise<SessionAgentState> {
  const state = {
    ...input,
    updatedAt: input.updatedAt ?? new Date().toISOString(),
  };
  await db
    .prepare(
      `INSERT INTO session_agent_state (
       session_id, current_run_id, generation, debounce_deadline_at,
       agent_model_binding_json, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(session_id) DO UPDATE SET
       current_run_id = excluded.current_run_id,
       generation = excluded.generation,
       debounce_deadline_at = excluded.debounce_deadline_at,
       agent_model_binding_json = excluded.agent_model_binding_json,
       updated_at = excluded.updated_at`,
    )
    .bind(
      state.sessionId,
      state.currentRunId,
      state.generation,
      state.debounceDeadlineAt,
      state.agentModelBinding
        ? sessionAgentModelBindingJson(state.agentModelBinding)
        : null,
      state.updatedAt,
    )
    .run();
  return state;
}

export async function bindD1SessionAgentModel(
  db: D1DatabaseLike,
  input: BindSessionAgentModelInput,
): Promise<SessionAgentModelBinding> {
  const updatedAt = input.updatedAt ?? new Date().toISOString();
  const bindingJson = sessionAgentModelBindingJson(input.binding);
  const row = await db
    .prepare(
      `INSERT INTO session_agent_state (
       session_id, current_run_id, generation, debounce_deadline_at,
       agent_model_binding_json, updated_at
     ) VALUES (?, NULL, 0, NULL, ?, ?)
     ON CONFLICT(session_id) DO UPDATE SET
       agent_model_binding_json =
         COALESCE(session_agent_state.agent_model_binding_json,
                  excluded.agent_model_binding_json),
       updated_at =
         CASE
           WHEN session_agent_state.agent_model_binding_json IS NULL
           THEN excluded.updated_at
           ELSE session_agent_state.updated_at
         END
     RETURNING *`,
    )
    .bind(input.sessionId, bindingJson, updatedAt)
    .first<SessionAgentStateRow>();
  if (!row) throw new Error('d1_session_agent_model_binding_missing');
  const binding = sessionAgentStateFromRow(row).agentModelBinding;
  if (!binding) throw new Error('d1_session_agent_model_binding_missing');
  return binding;
}

export async function listDueD1SessionAgentStates(
  db: D1DatabaseLike,
  now: string,
  limit: number,
): Promise<SessionAgentState[]> {
  const rows = await db
    .prepare(
      `SELECT *
     FROM session_agent_state
     WHERE current_run_id IS NULL
       AND debounce_deadline_at IS NOT NULL
       AND debounce_deadline_at <= ?
     ORDER BY debounce_deadline_at ASC, session_id ASC
     LIMIT ?`,
    )
    .bind(now, limit)
    .all<SessionAgentStateRow>();
  return (rows.results ?? []).map(sessionAgentStateFromRow);
}

export async function advanceD1SessionAgentGeneration(input: {
  db: D1DatabaseLike;
  operation: AdvanceSessionAgentGenerationInput;
}): Promise<AdvanceSessionAgentGenerationResult> {
  if (!input.db.batch) {
    throw new Error('d1_atomic_agent_generation_advance_unavailable');
  }
  const updatedAt = input.operation.updatedAt ?? new Date().toISOString();
  const results = await input.db.batch([
    input.db
      .prepare(
        `INSERT OR IGNORE INTO session_agent_state (
         session_id, current_run_id, generation, debounce_deadline_at, updated_at
       ) VALUES (?, NULL, 0, NULL, ?)`,
      )
      .bind(input.operation.sessionId, updatedAt),
    input.db
      .prepare(
        `SELECT current_run_id
       FROM session_agent_state
       WHERE session_id = ?`,
      )
      .bind(input.operation.sessionId),
    input.db
      .prepare(
        `UPDATE session_agent_state
       SET current_run_id = NULL,
           generation = generation + 1,
           debounce_deadline_at = ?,
           updated_at = ?
       WHERE session_id = ?
       RETURNING *`,
      )
      .bind(
        input.operation.debounceDeadlineAt,
        updatedAt,
        input.operation.sessionId,
      ),
  ]);
  const previous = firstResult<{ current_run_id: string | null }>(results[1]);
  const state = firstResult<SessionAgentStateRow>(results[2]);
  if (!previous || !state) {
    throw new Error('d1_agent_generation_advance_missing');
  }
  return {
    state: sessionAgentStateFromRow(state),
    invalidatedRunId: previous.current_run_id,
  };
}

export async function claimD1SessionAgentRunOwnership(input: {
  db: D1DatabaseLike;
  operation: ClaimSessionAgentRunOwnershipInput;
}): Promise<ClaimSessionAgentRunOwnershipResult> {
  const updatedAt = input.operation.updatedAt ?? new Date().toISOString();
  const claimed = await input.db
    .prepare(
      `UPDATE session_agent_state
     SET current_run_id = ?,
         debounce_deadline_at = NULL,
         updated_at = ?
     WHERE session_id = ?
       AND generation = ?
       AND current_run_id IS ?
       AND debounce_deadline_at = ?
       AND EXISTS (
         SELECT 1
         FROM agent_runs
         WHERE id = ?
           AND session_id = ?
           AND generation = ?
           AND status = 'scheduled'
           AND EXISTS (
             SELECT 1
             FROM (${d1ActiveSessionAuthoritySource}) AS authority
             WHERE authority.session_authority_generation =
               agent_runs.session_authority_generation
           )
       )
     RETURNING *`,
    )
    .bind(
      input.operation.runId,
      updatedAt,
      input.operation.sessionId,
      input.operation.expectedGeneration,
      input.operation.expectedCurrentRunId,
      input.operation.expectedDebounceDeadlineAt,
      input.operation.runId,
      input.operation.sessionId,
      input.operation.expectedGeneration,
      input.operation.sessionId,
    )
    .first<SessionAgentStateRow>();
  if (claimed) {
    return { status: 'claimed', state: sessionAgentStateFromRow(claimed) };
  }
  return {
    status: 'stale',
    state: await readD1SessionAgentState(input.db, input.operation.sessionId),
  };
}

export async function claimD1AgentRunExecution(input: {
  db: D1DatabaseLike;
  operation: ClaimAgentRunExecutionInput;
}): Promise<ClaimAgentRunExecutionResult> {
  assertAgentRunExecutionClaim(input.operation);
  const claimed = await input.db
    .prepare(
      `UPDATE agent_runs
     SET status = 'running',
         execution_attempt = execution_attempt + 1,
         execution_lease_token = ?,
         execution_lease_expires_at = ?,
         started_at = COALESCE(started_at, ?),
         updated_at = ?
     WHERE id = ?
       AND session_id = ?
       AND generation = ?
       AND session_authority_generation = ?
       AND execution_attempt < ?
       AND irreversible_side_effect_at IS NULL
       AND irreversible_tool_name IS NULL
       AND NOT EXISTS (
         SELECT 1
         FROM agent_run_text_deliveries
         WHERE run_id = agent_runs.id
           AND status IN (
             'sending',
             'confirmed_sent',
             'delivery_outcome_unknown'
           )
       )
       AND (
         (
           status = 'scheduled'
           AND execution_attempt = 0
           AND execution_lease_token IS NULL
           AND execution_lease_expires_at IS NULL
         )
         OR (
           status = 'running'
           AND execution_lease_expires_at IS NOT NULL
           AND julianday(execution_lease_expires_at) <= julianday('now')
         )
       )
       AND julianday('now') < julianday(?)
       AND EXISTS (
         SELECT 1
         FROM (${d1ActiveSessionAuthoritySource}) AS authority
         WHERE authority.session_authority_generation = ?
       )
       AND EXISTS (
         SELECT 1
         FROM session_agent_state
         WHERE session_id = ?
           AND current_run_id = ?
           AND generation = ?
       )
     RETURNING *`,
    )
    .bind(
      input.operation.executionLeaseToken,
      input.operation.executionLeaseExpiresAt,
      input.operation.claimedAt,
      input.operation.claimedAt,
      input.operation.runId,
      input.operation.sessionId,
      input.operation.generation,
      input.operation.sessionAuthorityGeneration,
      MAXIMUM_AGENT_RUN_EXECUTION_ATTEMPTS,
      input.operation.executionLeaseExpiresAt,
      input.operation.sessionId,
      input.operation.sessionAuthorityGeneration,
      input.operation.sessionId,
      input.operation.runId,
      input.operation.generation,
    )
    .first<AgentRunRow>();
  if (claimed) {
    return { status: 'claimed', run: agentRunFromRow(claimed) };
  }
  const reconciled = await input.db
    .prepare(
      `UPDATE agent_runs
     SET status = 'reconciliation_required',
         delivery_status = 'not_applicable',
         error_code = CASE
           WHEN irreversible_side_effect_at IS NOT NULL
             OR irreversible_tool_name IS NOT NULL
             THEN 'agent_run_outcome_unknown'
           ELSE 'agent_run_execution_attempts_exhausted'
         END,
         error_message = CASE
           WHEN irreversible_side_effect_at IS NOT NULL
             OR irreversible_tool_name IS NOT NULL
             THEN 'Irreversible provider outcome requires reconciliation'
           ELSE 'Agent run execution attempts exhausted'
         END,
         completed_at = COALESCE(completed_at, ?),
         updated_at = ?
     WHERE id = ?
       AND session_id = ?
       AND generation = ?
       AND session_authority_generation = ?
       AND status = 'running'
       AND execution_lease_expires_at IS NOT NULL
       AND julianday(execution_lease_expires_at) <= julianday('now')
       AND (
         irreversible_side_effect_at IS NOT NULL
         OR irreversible_tool_name IS NOT NULL
         OR execution_attempt >= ?
       )
       AND EXISTS (
         SELECT 1
         FROM (${d1ActiveSessionAuthoritySource}) AS authority
         WHERE authority.session_authority_generation = ?
       )
       AND EXISTS (
         SELECT 1
         FROM session_agent_state
         WHERE session_id = ?
           AND current_run_id = ?
           AND generation = ?
       )
     RETURNING *`,
    )
    .bind(
      input.operation.claimedAt,
      input.operation.claimedAt,
      input.operation.runId,
      input.operation.sessionId,
      input.operation.generation,
      input.operation.sessionAuthorityGeneration,
      MAXIMUM_AGENT_RUN_EXECUTION_ATTEMPTS,
      input.operation.sessionId,
      input.operation.sessionAuthorityGeneration,
      input.operation.sessionId,
      input.operation.runId,
      input.operation.generation,
    )
    .first<AgentRunRow>();
  if (reconciled) {
    const run = agentRunFromRow(reconciled);
    const reason = agentRunExecutionReconciliationReason(run);
    if (!reason) throw new Error('d1_agent_run_reconciliation_reason_missing');
    return { status: 'reconciliation_required', reason, run };
  }
  const existing = await input.db
    .prepare(`SELECT * FROM agent_runs WHERE id = ? LIMIT 1`)
    .bind(input.operation.runId)
    .first<AgentRunRow>();
  return agentRunExecutionClaimRejection(
    existing ? agentRunFromRow(existing) : undefined,
  );
}

export async function updateD1AgentRunIfExecutionCurrent(input: {
  db: D1DatabaseLike;
  operation: UpdateAgentRunIfExecutionCurrentInput;
}): Promise<UpdateAgentRunIfExecutionCurrentResult> {
  const patch = d1AgentRunPatchAssignments(input.operation.patch);
  const updatedAt = new Date().toISOString();
  const updated = await input.db
    .prepare(
      `UPDATE agent_runs
     SET ${[...patch.assignments, 'updated_at = ?'].join(',\n         ')}
     WHERE id = ?
       AND session_id = ?
       AND generation = ?
       AND session_authority_generation = ?
       AND status = 'running'
       AND execution_attempt = ?
       AND execution_lease_token = ?
       AND execution_lease_expires_at IS NOT NULL
       AND julianday('now') < julianday(execution_lease_expires_at)
       AND EXISTS (
         SELECT 1
         FROM (${d1ActiveSessionAuthoritySource}) AS authority
         WHERE authority.session_authority_generation = ?
       )
       AND EXISTS (
         SELECT 1
         FROM session_agent_state
         WHERE session_id = ?
           AND current_run_id = ?
           AND generation = ?
       )
     RETURNING *`,
    )
    .bind(
      ...patch.bindings,
      updatedAt,
      input.operation.fence.runId,
      input.operation.sessionId,
      input.operation.fence.generation,
      input.operation.fence.sessionAuthorityGeneration,
      input.operation.fence.executionAttempt,
      input.operation.fence.executionLeaseToken,
      input.operation.sessionId,
      input.operation.fence.sessionAuthorityGeneration,
      input.operation.sessionId,
      input.operation.fence.runId,
      input.operation.fence.generation,
    )
    .first<AgentRunRow>();
  if (updated) {
    return { status: 'committed', run: agentRunFromRow(updated) };
  }
  const existing = await input.db
    .prepare(`SELECT * FROM agent_runs WHERE id = ? LIMIT 1`)
    .bind(input.operation.fence.runId)
    .first<AgentRunRow>();
  return {
    status: 'stale',
    ...(existing ? { run: agentRunFromRow(existing) } : {}),
  };
}

function d1AgentRunPatchAssignments(patch: AgentRunPatch): {
  assignments: string[];
  bindings: unknown[];
} {
  const columns: ReadonlyArray<readonly [keyof AgentRunPatch, string]> = [
    ['status', 'status'],
    ['supersededByRunId', 'superseded_by_run_id'],
    ['irreversibleSideEffectAt', 'irreversible_side_effect_at'],
    ['irreversibleToolName', 'irreversible_tool_name'],
    ['assistantTurnId', 'assistant_turn_id'],
    ['deliveryStatus', 'delivery_status'],
    ['deliveryExternalMessageId', 'delivery_external_message_id'],
    ['errorCode', 'error_code'],
    ['errorMessage', 'error_message'],
    ['startedAt', 'started_at'],
    ['completedAt', 'completed_at'],
  ];
  const assignments: string[] = [];
  const bindings: unknown[] = [];
  for (const [key, column] of columns) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
    assignments.push(`${column} = ?`);
    bindings.push(patch[key]);
  }
  return { assignments, bindings };
}

async function readD1SessionAgentState(db: D1DatabaseLike, sessionId: string) {
  const row = await db
    .prepare(`SELECT * FROM session_agent_state WHERE session_id = ? LIMIT 1`)
    .bind(sessionId)
    .first<SessionAgentStateRow>();
  return row
    ? sessionAgentStateFromRow(row)
    : defaultSessionAgentState(sessionId);
}

function firstResult<Row>(result: D1Result | undefined): Row | undefined {
  return result?.results?.[0] as Row | undefined;
}
