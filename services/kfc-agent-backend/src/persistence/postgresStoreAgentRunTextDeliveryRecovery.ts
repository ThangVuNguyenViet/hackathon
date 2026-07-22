import type { PoolClient } from 'pg';
import {
  reconcileAgentRunTextDelivery,
  type AgentRunTextDeliveryRecord,
} from './agentRunTextDelivery.js';
import {
  agentRunTextDeliveryFromStorageRow,
  type AgentRunTextDeliveryStorageRow,
} from './agentRunTextDeliveryStorage.js';
import type { ClaimAgentRunExecutionResult } from './contracts.js';
import { agentRunFromRow, type AgentRunRow } from './postgresStoreSupport.js';

interface DeliveryAttemptTokenRow {
  delivery_attempt_token: string;
}

export async function reconcileExpiredPostgresAgentRunTextDelivery(input: {
  client: PoolClient;
  runId: string;
  sessionId: string;
  generation: number;
  sessionAuthorityGeneration: number;
  reconciledAt: string;
}): Promise<
  | Extract<ClaimAgentRunExecutionResult, { status: 'reconciliation_required' }>
  | undefined
> {
  const locked = await input.client.query<{
    id: string;
    execution_attempt: number;
    execution_lease_token: string;
  }>(
    `SELECT run.id,
            run.execution_attempt,
            run.execution_lease_token
     FROM agent_runs AS run
     WHERE run.id = $1
       AND run.session_id = $2
       AND run.generation = $3
       AND run.session_authority_generation = $4
       AND run.status = 'running'
       AND run.execution_lease_expires_at IS NOT NULL
       AND run.execution_lease_expires_at <= clock_timestamp()
     FOR UPDATE OF run`,
    [
      input.runId,
      input.sessionId,
      input.generation,
      input.sessionAuthorityGeneration,
    ],
  );
  const lockedRun = locked.rows[0];
  if (!lockedRun) return undefined;
  const delivery = await readLockedDelivery(input.client, input.runId);
  if (
    !delivery ||
    delivery.status !== 'sending' ||
    delivery.runExecutionAttempt !== Number(lockedRun.execution_attempt) ||
    delivery.runExecutionLeaseToken !== lockedRun.execution_lease_token
  ) {
    return undefined;
  }
  const reconciledAt = new Date(
    Math.max(Date.parse(input.reconciledAt), Date.parse(delivery.updatedAt)),
  ).toISOString();
  const transition = reconcileAgentRunTextDelivery(delivery, {
    execution: {
      runId: delivery.runId,
      executionAttempt: delivery.runExecutionAttempt,
      executionLeaseToken: delivery.runExecutionLeaseToken,
    },
    outcomeCode: 'agent_run_execution_lease_expired',
    updatedAt: reconciledAt,
  });
  if (transition.status !== 'reconciled') return undefined;
  await updateDelivery(input.client, delivery, transition.record);
  const run = await reconcileRun(input.client, transition.record, reconciledAt);
  return {
    status: 'reconciliation_required',
    reason: 'delivery_outcome_unknown',
    run,
  };
}

async function readLockedDelivery(
  client: PoolClient,
  runId: string,
): Promise<AgentRunTextDeliveryRecord | undefined> {
  const deliveryResult = await client.query<AgentRunTextDeliveryStorageRow>(
    `SELECT *
       FROM agent_run_text_deliveries
       WHERE run_id = $1
       FOR UPDATE`,
    [runId],
  );
  const row = deliveryResult.rows[0];
  if (!row) return undefined;
  const attempts = await client.query<DeliveryAttemptTokenRow>(
    `SELECT delivery_attempt_token
     FROM agent_run_text_delivery_attempts
     WHERE run_id = $1
       AND delivery_attempt < $2
     ORDER BY delivery_attempt ASC`,
    [runId, row.delivery_attempt],
  );
  return agentRunTextDeliveryFromStorageRow(
    row,
    attempts.rows.map((attempt) => attempt.delivery_attempt_token),
  );
}

async function updateDelivery(
  client: PoolClient,
  existing: Extract<AgentRunTextDeliveryRecord, { status: 'sending' }>,
  next: Extract<
    AgentRunTextDeliveryRecord,
    { status: 'delivery_outcome_unknown' }
  >,
): Promise<void> {
  const result = await client.query(
    `UPDATE agent_run_text_deliveries
     SET status = 'delivery_outcome_unknown',
         provider_message_id = NULL,
         outcome_code = $4,
         updated_at = $5
     WHERE run_id = $1
       AND status = 'sending'
       AND run_execution_attempt = $2
       AND run_execution_lease_token = $3
       AND last_delivery_run_execution_attempt = $2
       AND delivery_attempt = $6
       AND delivery_attempt_token = $7
       AND updated_at = $8::timestamptz`,
    [
      next.runId,
      next.runExecutionAttempt,
      next.runExecutionLeaseToken,
      next.outcomeCode,
      next.updatedAt,
      existing.deliveryAttempt,
      existing.deliveryAttemptToken,
      existing.updatedAt,
    ],
  );
  if (result.rowCount !== 1) {
    throw new Error('postgres_expired_delivery_reconciliation_lost');
  }
}

async function reconcileRun(
  client: PoolClient,
  delivery: Extract<
    AgentRunTextDeliveryRecord,
    { status: 'delivery_outcome_unknown' }
  >,
  reconciledAt: string,
) {
  const result = await client.query<AgentRunRow>(
    `UPDATE agent_runs
     SET status = 'reconciliation_required',
         delivery_status = 'outcome_unknown',
         error_code = 'agent_run_delivery_outcome_unknown',
         error_message =
           'Channel delivery outcome requires reconciliation',
         completed_at = COALESCE(completed_at, $4),
         updated_at = $4
     WHERE id = $1
       AND status = 'running'
       AND execution_attempt = $2
       AND execution_lease_token = $3
     RETURNING *`,
    [
      delivery.runId,
      delivery.runExecutionAttempt,
      delivery.runExecutionLeaseToken,
      reconciledAt,
    ],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error('postgres_expired_delivery_run_reconciliation_lost');
  }
  return agentRunFromRow(row);
}
