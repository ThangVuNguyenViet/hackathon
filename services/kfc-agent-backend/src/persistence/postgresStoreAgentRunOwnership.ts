import type { PoolClient } from 'pg';
import type {
  AdvanceSessionAgentGenerationInput,
  AdvanceSessionAgentGenerationResult,
  AgentRunPatch,
  ClaimAgentRunExecutionInput,
  ClaimAgentRunExecutionResult,
  ClaimSessionAgentRunOwnershipInput,
  ClaimSessionAgentRunOwnershipResult,
  UpdateAgentRunIfExecutionCurrentInput,
  UpdateAgentRunIfExecutionCurrentResult,
} from './contracts.js';
import {
  MAXIMUM_AGENT_RUN_EXECUTION_ATTEMPTS,
  agentRunExecutionClaimRejection,
  agentRunExecutionReconciliationReason,
  assertAgentRunExecutionClaim,
} from './agentRunExecutionLease.js';
import { isConnectablePostgres } from './postgresStoreRunOwner.js';
import {
  agentRunFromRow,
  defaultSessionAgentState,
  sessionAgentStateFromRow,
  type AgentRunRow,
  type Queryable,
  type SessionAgentStateRow,
} from './postgresStoreSupport.js';
import {
  captureActivePostgresSessionAuthority,
} from './postgresStoreSessionAuthority.js';
import {
  reconcileExpiredPostgresAgentRunTextDelivery,
} from './postgresStoreAgentRunTextDeliveryRecovery.js';

export async function advancePostgresSessionAgentGeneration(input: {
  db: Queryable;
  operation: AdvanceSessionAgentGenerationInput;
}): Promise<AdvanceSessionAgentGenerationResult> {
  if (!isConnectablePostgres(input.db)) {
    throw new Error('postgres_atomic_agent_generation_advance_unavailable');
  }
  const updatedAt = input.operation.updatedAt ?? new Date().toISOString();
  const client = await input.db.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO session_agent_state (
         session_id, current_run_id, generation, debounce_deadline_at, updated_at
       ) VALUES ($1, NULL, 0, NULL, $2)
       ON CONFLICT (session_id) DO NOTHING`,
      [input.operation.sessionId, updatedAt],
    );
    const locked = await client.query<SessionAgentStateRow>(
      `SELECT *
       FROM session_agent_state
       WHERE session_id = $1
       FOR UPDATE`,
      [input.operation.sessionId],
    );
    const previous = locked.rows[0];
    if (!previous) throw new Error('postgres_agent_generation_lock_missing');
    const updated = await client.query<SessionAgentStateRow>(
      `UPDATE session_agent_state
       SET current_run_id = NULL,
           generation = generation + 1,
           debounce_deadline_at = $2,
           updated_at = $3
       WHERE session_id = $1
         AND generation = $4
       RETURNING *`,
      [
        input.operation.sessionId,
        input.operation.debounceDeadlineAt,
        updatedAt,
        previous.generation,
      ],
    );
    const state = updated.rows[0];
    if (!state) throw new Error('postgres_agent_generation_advance_missing');
    await client.query('COMMIT');
    return {
      state: sessionAgentStateFromRow(state),
      invalidatedRunId: previous.current_run_id,
    };
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  } finally {
    client.release();
  }
}

export async function claimPostgresSessionAgentRunOwnership(input: {
  db: Queryable;
  operation: ClaimSessionAgentRunOwnershipInput;
}): Promise<ClaimSessionAgentRunOwnershipResult> {
  if (!isConnectablePostgres(input.db)) {
    throw new Error('postgres_atomic_agent_ownership_claim_unavailable');
  }
  const updatedAt = input.operation.updatedAt ?? new Date().toISOString();
  const client = await input.db.connect();
  try {
    await client.query('BEGIN');
    const authority = await captureActivePostgresSessionAuthority(
      client,
      input.operation.sessionId,
    );
    const claimed =
      authority === undefined
        ? undefined
        : (
            await client.query<SessionAgentStateRow>(
              `UPDATE session_agent_state AS state
               SET current_run_id = $2,
                   debounce_deadline_at = NULL,
                   updated_at = $3
               FROM agent_runs AS run
               WHERE state.session_id = $1
                 AND state.generation = $4
                 AND state.current_run_id IS NOT DISTINCT FROM $5::text
                 AND state.debounce_deadline_at = $6
                 AND run.id = $2
                 AND run.session_id = state.session_id
                 AND run.generation = state.generation
                 AND run.session_authority_generation = $7
                 AND run.status = 'scheduled'
               RETURNING state.*`,
              [
                input.operation.sessionId,
                input.operation.runId,
                updatedAt,
                input.operation.expectedGeneration,
                input.operation.expectedCurrentRunId,
                input.operation.expectedDebounceDeadlineAt,
                authority,
              ],
            )
          ).rows[0];
    if (claimed) {
      await client.query('COMMIT');
      return {
        status: 'claimed',
        state: sessionAgentStateFromRow(claimed),
      };
    }
    const state = await readPostgresSessionAgentState(
      client,
      input.operation.sessionId,
    );
    await client.query('COMMIT');
    return { status: 'stale', state };
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  } finally {
    client.release();
  }
}

export async function claimPostgresAgentRunExecution(input: {
  db: Queryable;
  operation: ClaimAgentRunExecutionInput;
}): Promise<ClaimAgentRunExecutionResult> {
  assertAgentRunExecutionClaim(input.operation);
  if (!isConnectablePostgres(input.db)) {
    throw new Error('postgres_atomic_agent_execution_claim_unavailable');
  }
  const client = await input.db.connect();
  try {
    await client.query('BEGIN');
    const authority = await captureActivePostgresSessionAuthority(
      client,
      input.operation.sessionId,
    );
    const expiredDelivery =
      authority !== input.operation.sessionAuthorityGeneration
        ? undefined
        : await reconcileExpiredPostgresAgentRunTextDelivery({
            client,
            runId: input.operation.runId,
            sessionId: input.operation.sessionId,
            generation: input.operation.generation,
            sessionAuthorityGeneration:
              input.operation.sessionAuthorityGeneration,
            reconciledAt: input.operation.claimedAt,
          });
    if (expiredDelivery) {
      await client.query('COMMIT');
      return expiredDelivery;
    }
    const claimed =
      authority !== input.operation.sessionAuthorityGeneration
        ? undefined
        : (
            await client.query<AgentRunRow>(
               `UPDATE agent_runs AS run
               SET status = 'running',
                   execution_attempt = execution_attempt + 1,
                   execution_lease_token = $6,
                   execution_lease_expires_at = $7,
                   started_at = COALESCE(started_at, $4),
                   updated_at = $4
               WHERE run.id = $1
                 AND run.session_id = $2
                 AND run.generation = $3
                 AND run.session_authority_generation = $5
                 AND run.execution_attempt < $8
                 AND run.irreversible_side_effect_at IS NULL
                 AND run.irreversible_tool_name IS NULL
                 AND NOT EXISTS (
                   SELECT 1
                   FROM agent_run_text_deliveries AS delivery
                   WHERE delivery.run_id = run.id
                     AND delivery.status IN (
                       'sending',
                       'confirmed_sent',
                       'delivery_outcome_unknown'
                     )
                 )
                 AND (
                   (
                     run.status = 'scheduled'
                     AND run.execution_attempt = 0
                     AND run.execution_lease_token IS NULL
                     AND run.execution_lease_expires_at IS NULL
                   )
                   OR (
                     run.status = 'running'
                     AND run.execution_lease_expires_at IS NOT NULL
                     AND run.execution_lease_expires_at <= clock_timestamp()
                   )
                 )
                 AND clock_timestamp() < $7
                 AND EXISTS (
                   SELECT 1
                   FROM session_agent_state AS state
                   WHERE state.session_id = $2
                     AND state.current_run_id = $1
                     AND state.generation = $3
                 )
               RETURNING run.*`,
              [
                input.operation.runId,
                input.operation.sessionId,
                input.operation.generation,
                input.operation.claimedAt,
                input.operation.sessionAuthorityGeneration,
                input.operation.executionLeaseToken,
                input.operation.executionLeaseExpiresAt,
                MAXIMUM_AGENT_RUN_EXECUTION_ATTEMPTS,
              ],
            )
          ).rows[0];
    if (claimed) {
      await client.query('COMMIT');
      return { status: 'claimed', run: agentRunFromRow(claimed) };
    }
    const reconciled =
      authority !== input.operation.sessionAuthorityGeneration
        ? undefined
        : (
            await client.query<AgentRunRow>(
              `UPDATE agent_runs AS run
               SET status = 'reconciliation_required',
                   delivery_status = 'not_applicable',
                   error_code = CASE
                     WHEN run.irreversible_side_effect_at IS NOT NULL
                       OR run.irreversible_tool_name IS NOT NULL
                       THEN 'agent_run_outcome_unknown'
                     ELSE 'agent_run_execution_attempts_exhausted'
                   END,
                   error_message = CASE
                     WHEN run.irreversible_side_effect_at IS NOT NULL
                       OR run.irreversible_tool_name IS NOT NULL
                       THEN 'Irreversible provider outcome requires reconciliation'
                     ELSE 'Agent run execution attempts exhausted'
                   END,
                   completed_at = COALESCE(run.completed_at, $4),
                   updated_at = $4
               FROM session_agent_state AS state
               WHERE run.id = $1
                 AND run.session_id = $2
                 AND run.generation = $3
                 AND run.session_authority_generation = $5
                 AND run.status = 'running'
                 AND run.execution_lease_expires_at IS NOT NULL
                 AND run.execution_lease_expires_at <= clock_timestamp()
                 AND NOT EXISTS (
                   SELECT 1
                   FROM agent_run_text_deliveries AS delivery
                   WHERE delivery.run_id = run.id
                     AND delivery.status IN (
                       'sending',
                       'confirmed_sent',
                       'delivery_outcome_unknown'
                     )
                 )
                 AND (
                   run.irreversible_side_effect_at IS NOT NULL
                   OR run.irreversible_tool_name IS NOT NULL
                   OR run.execution_attempt >= $6
                 )
                 AND state.session_id = $2
                 AND state.current_run_id = $1
                 AND state.generation = $3
               RETURNING run.*`,
              [
                input.operation.runId,
                input.operation.sessionId,
                input.operation.generation,
                input.operation.claimedAt,
                input.operation.sessionAuthorityGeneration,
                MAXIMUM_AGENT_RUN_EXECUTION_ATTEMPTS,
              ],
            )
          ).rows[0];
    if (reconciled) {
      const run = agentRunFromRow(reconciled);
      const reason = agentRunExecutionReconciliationReason(run);
      if (!reason) {
        throw new Error('postgres_agent_run_reconciliation_reason_missing');
      }
      await client.query('COMMIT');
      return { status: 'reconciliation_required', reason, run };
    }
    const existing = await client.query<AgentRunRow>(
      `SELECT * FROM agent_runs WHERE id = $1 LIMIT 1`,
      [input.operation.runId],
    );
    await client.query('COMMIT');
    return agentRunExecutionClaimRejection(
      existing.rows[0] ? agentRunFromRow(existing.rows[0]) : undefined,
    );
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  } finally {
    client.release();
  }
}

export async function updatePostgresAgentRunIfExecutionCurrent(input: {
  db: Queryable;
  operation: UpdateAgentRunIfExecutionCurrentInput;
}): Promise<UpdateAgentRunIfExecutionCurrentResult> {
  if (!isConnectablePostgres(input.db)) {
    throw new Error('postgres_atomic_agent_execution_update_unavailable');
  }
  const client = await input.db.connect();
  try {
    await client.query('BEGIN');
    const authority = await captureActivePostgresSessionAuthority(
      client,
      input.operation.sessionId,
    );
    const patch = postgresAgentRunPatchAssignments(input.operation.patch);
    const updatedAtParameter = patch.bindings.length + 1;
    const runIdParameter = updatedAtParameter + 1;
    const sessionIdParameter = runIdParameter + 1;
    const generationParameter = sessionIdParameter + 1;
    const authorityParameter = generationParameter + 1;
    const attemptParameter = authorityParameter + 1;
    const tokenParameter = attemptParameter + 1;
    const updated =
      authority !== input.operation.fence.sessionAuthorityGeneration
        ? undefined
        : (
            await client.query<AgentRunRow>(
              `UPDATE agent_runs AS run
               SET ${[
                 ...patch.assignments,
                 `updated_at = $${updatedAtParameter}`,
               ].join(',\n                   ')}
               FROM session_agent_state AS state
               WHERE run.id = $${runIdParameter}
                 AND run.session_id = $${sessionIdParameter}
                 AND run.generation = $${generationParameter}
                 AND run.session_authority_generation = $${authorityParameter}
                 AND run.status = 'running'
                 AND run.execution_attempt = $${attemptParameter}
                 AND run.execution_lease_token = $${tokenParameter}
                 AND run.execution_lease_expires_at IS NOT NULL
                 AND clock_timestamp() < run.execution_lease_expires_at
                 AND state.session_id = $${sessionIdParameter}
                 AND state.current_run_id = $${runIdParameter}
                 AND state.generation = $${generationParameter}
               RETURNING run.*`,
              [
                ...patch.bindings,
                new Date().toISOString(),
                input.operation.fence.runId,
                input.operation.sessionId,
                input.operation.fence.generation,
                input.operation.fence.sessionAuthorityGeneration,
                input.operation.fence.executionAttempt,
                input.operation.fence.executionLeaseToken,
              ],
            )
          ).rows[0];
    if (updated) {
      await client.query('COMMIT');
      return { status: 'committed', run: agentRunFromRow(updated) };
    }
    const existing = await client.query<AgentRunRow>(
      `SELECT * FROM agent_runs WHERE id = $1 LIMIT 1`,
      [input.operation.fence.runId],
    );
    await client.query('COMMIT');
    return {
      status: 'stale',
      ...(existing.rows[0]
        ? { run: agentRunFromRow(existing.rows[0]) }
        : {}),
    };
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  } finally {
    client.release();
  }
}

function postgresAgentRunPatchAssignments(patch: AgentRunPatch): {
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
    bindings.push(patch[key]);
    assignments.push(`${column} = $${bindings.length}`);
  }
  return { assignments, bindings };
}

async function readPostgresSessionAgentState(
  db: Queryable,
  sessionId: string,
) {
  const result = await db.query<SessionAgentStateRow>(
    `SELECT * FROM session_agent_state WHERE session_id = $1 LIMIT 1`,
    [sessionId],
  );
  return result.rows[0]
    ? sessionAgentStateFromRow(result.rows[0])
    : defaultSessionAgentState(sessionId);
}

async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Preserve the original failure; uncertain ownership is fail-closed.
  }
}
