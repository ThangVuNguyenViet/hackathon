import type {
  AgentRunTextDeliveryRecord,
  BeginAgentRunTextDeliveryAttemptResult,
  CompleteAgentRunTextDeliveryAttemptResult,
} from './agentRunTextDelivery.js';
import type { AgentRun } from '../domain/types.js';
import type { SupersedeAgentRunExecutionIfNoLongerCurrentInput } from './contracts.js';
import type { D1Result } from './d1StoreSupport.js';
import { d1ActiveSessionAuthoritySource } from './d1StoreSessionAuthority.js';

export const d1AgentRunTextDeliveryColumns = `
  schema_version,
  run_id,
  run_execution_attempt,
  run_execution_origin_attempt,
  run_execution_lease_token,
  run_execution_lease_token_digest,
  prior_run_execution_lease_token_digests,
  channel,
  assistant_turn_id,
  recipient_binding_digest,
  presentation_binding_digest,
  delivery_binding_digest,
  status,
  delivery_attempt,
  last_delivery_run_execution_attempt,
  delivery_attempt_token,
  provider_message_id,
  outcome_code,
  created_at,
  updated_at
`;

export const d1AgentRunTextDeliveryInsertPlaceholders =
  d1AgentRunTextDeliveryColumns
    .split(',')
    .map(() => '?')
    .join(', ');

export const d1ConfirmedSentRunUpdateSql = `
  UPDATE agent_runs
  SET status = 'completed',
      assistant_turn_id = ?,
      delivery_status = 'sent',
      delivery_external_message_id = ?,
      error_code = NULL,
      error_message = NULL,
      completed_at = COALESCE(completed_at, ?),
      updated_at = ?
  WHERE id = ?
    AND execution_attempt = ?
    AND execution_lease_token = ?
    AND EXISTS (
      SELECT 1
      FROM agent_run_text_deliveries
      WHERE run_id = agent_runs.id
        AND status = ?
        AND delivery_attempt = ?
        AND delivery_attempt_token = ?
        AND updated_at = ?
    )
  RETURNING *
`;

export const d1UnknownRunUpdateSql = `
  UPDATE agent_runs
  SET status = 'reconciliation_required',
      delivery_status = 'outcome_unknown',
      error_code = 'agent_run_delivery_outcome_unknown',
      error_message = 'Channel delivery outcome requires reconciliation',
      completed_at = COALESCE(completed_at, ?),
      updated_at = ?
  WHERE id = ?
    AND execution_attempt = ?
    AND execution_lease_token = ?
    AND EXISTS (
      SELECT 1
      FROM agent_run_text_deliveries
      WHERE run_id = agent_runs.id
        AND status = ?
        AND delivery_attempt = ?
        AND delivery_attempt_token = ?
        AND updated_at = ?
    )
  RETURNING *
`;

export function d1CurrentDeliveryExecutionSql(): string {
  return `EXISTS (
    SELECT 1
    FROM agent_runs
    JOIN conversation_turns
      ON conversation_turns.id = ?
     AND conversation_turns.session_id = agent_runs.session_id
     AND conversation_turns.role = 'assistant'
     AND conversation_turns.channel = ?
    WHERE agent_runs.id = ?
      AND agent_runs.channel = ?
      AND agent_runs.execution_attempt = ?
      AND agent_runs.execution_lease_token = ?
      AND agent_runs.status = 'running'
      AND agent_runs.execution_lease_expires_at IS NOT NULL
      AND julianday('now') < julianday(agent_runs.execution_lease_expires_at)
      AND agent_runs.assistant_turn_id = ?
      AND EXISTS (
        SELECT 1
        FROM session_agent_state
        WHERE session_id = agent_runs.session_id
          AND current_run_id = agent_runs.id
          AND generation = agent_runs.generation
      )
      AND EXISTS (
        SELECT 1
        FROM (${d1ActiveSessionAuthoritySource}) AS authority
        WHERE authority.session_authority_generation =
          agent_runs.session_authority_generation
      )
  )`;
}

export function d1CurrentDeliveryExecutionBindings(
  record: AgentRunTextDeliveryRecord,
): readonly unknown[] {
  return [
    record.assistantTurnId,
    record.channel,
    record.runId,
    record.channel,
    record.runExecutionAttempt,
    record.runExecutionLeaseToken,
    record.assistantTurnId,
    record.runId,
  ];
}

export function d1DeliverySelectColumns(alias: string): string {
  return d1AgentRunTextDeliveryColumns
    .split(',')
    .map((column) => column.trim())
    .filter(Boolean)
    .map((column) => `${alias}.${column}`)
    .join(', ');
}

export function d1ExactRunFence(
  run: AgentRun,
  input: SupersedeAgentRunExecutionIfNoLongerCurrentInput,
): boolean {
  return (
    run.id === input.fence.runId &&
    run.sessionId === input.sessionId &&
    run.generation === input.fence.generation &&
    run.sessionAuthorityGeneration === input.fence.sessionAuthorityGeneration &&
    run.executionAttempt === input.fence.executionAttempt &&
    run.executionLeaseToken === input.fence.executionLeaseToken &&
    run.status === 'running'
  );
}

export function d1FirstResult<Row>(
  result: D1Result | undefined,
): Row | undefined {
  return result?.results?.[0] as Row | undefined;
}

export function d1BlockedDeliveryBegin(
  reason: Extract<
    BeginAgentRunTextDeliveryAttemptResult,
    { status: 'dispatch_blocked' }
  >['reason'],
): BeginAgentRunTextDeliveryAttemptResult {
  return { status: 'dispatch_blocked', reason };
}

export function d1BlockedDeliveryCompletion(
  reason: Extract<
    CompleteAgentRunTextDeliveryAttemptResult,
    { status: 'transition_blocked' }
  >['reason'],
): CompleteAgentRunTextDeliveryAttemptResult {
  return { status: 'transition_blocked', reason };
}
