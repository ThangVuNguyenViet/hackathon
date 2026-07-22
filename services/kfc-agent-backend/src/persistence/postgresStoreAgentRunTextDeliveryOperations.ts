import type { PoolClient } from 'pg';
import type { AgentRun } from '../domain/types.js';
import {
  beginAgentRunTextDeliveryAttempt,
  completeAgentRunTextDeliveryAttempt,
  createPendingAgentRunTextDelivery,
  rebindRetryableAgentRunTextDelivery,
  reconcileAgentRunTextDelivery,
  type AgentRunTextDeliveryRecord,
  type BeginAgentRunTextDeliveryAttemptInput,
  type BeginAgentRunTextDeliveryAttemptResult,
  type CompleteAgentRunTextDeliveryAttemptInput,
  type CompleteAgentRunTextDeliveryAttemptResult,
  type CreatePendingAgentRunTextDeliveryInput,
  type ReconcileAgentRunTextDeliveryInput,
  type ReconcileAgentRunTextDeliveryResult,
} from './agentRunTextDelivery.js';
import {
  agentRunTextDeliveryFromStorageRow,
  agentRunTextDeliveryStorageValues,
  sameAgentRunTextDeliveryBinding,
  type AgentRunTextDeliveryStorageRow,
} from './agentRunTextDeliveryStorage.js';
import type {
  CreateAgentRunTextDeliveryResult,
  SupersedeAgentRunExecutionIfNoLongerCurrentInput,
  SupersedeAgentRunExecutionIfNoLongerCurrentResult,
} from './contracts.js';
import {
  isConnectablePostgres,
} from './postgresStoreRunOwner.js';
import {
  captureActivePostgresSessionAuthority,
} from './postgresStoreSessionAuthority.js';
import {
  agentRunFromRow,
  type AgentRunRow,
  type Queryable,
} from './postgresStoreSupport.js';
import { PostgresStoreVerifiedRefOperations } from './postgresStoreVerifiedRefOperations.js';

const deliveryColumns = `
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

interface DeliveryAttemptTokenRow {
  delivery_attempt_token: string;
}

export class PostgresStoreAgentRunTextDeliveryOperations
  extends PostgresStoreVerifiedRefOperations
{
  async createAgentRunTextDelivery(
    input: CreatePendingAgentRunTextDeliveryInput,
  ): Promise<CreateAgentRunTextDeliveryResult> {
    const pending = await createPendingAgentRunTextDelivery(input);
    return withPostgresDeliveryTransaction(
      this.db,
      async (client) => {
        if (!await lockCurrentDeliveryExecution(client, pending)) {
          return { status: 'stale' };
        }
        const existing = await readDelivery(client, pending.runId, true);
        if (!existing) {
          const inserted = await insertDelivery(client, pending);
          return { status: 'created', record: inserted };
        }
        if (sameAgentRunTextDeliveryBinding(existing, pending)) {
          return { status: 'replay', record: existing };
        }
        const rebound = await rebindRetryableAgentRunTextDelivery(
          existing,
          {
            execution: input.execution,
            channel: input.channel,
            assistantTurnId: input.assistantTurnId,
            recipientId: input.recipientId,
            presentationText: input.presentationText,
            updatedAt: input.createdAt,
          },
        );
        if (rebound.status !== 'rebound') {
          return { status: 'conflict', record: existing };
        }
        await writeDelivery(client, existing, rebound.record);
        return { status: 'rebound', record: rebound.record };
      },
    );
  }

  async getAgentRunTextDelivery(
    runId: string,
  ): Promise<AgentRunTextDeliveryRecord | undefined> {
    return readDelivery(this.db, runId, false);
  }

  async beginAgentRunTextDeliveryAttempt(
    input: BeginAgentRunTextDeliveryAttemptInput,
  ): Promise<BeginAgentRunTextDeliveryAttemptResult> {
    return withPostgresDeliveryTransaction(
      this.db,
      async (client) => {
        const observed = await readDelivery(
          client,
          input.execution.runId,
          false,
        );
        if (!observed) return blockedBegin('execution_binding_mismatch');
        if (!await lockCurrentDeliveryExecution(client, observed)) {
          return blockedBegin('execution_binding_mismatch');
        }
        const existing = await readDelivery(
          client,
          input.execution.runId,
          true,
        );
        if (!existing) return blockedBegin('execution_binding_mismatch');
        const transition = beginAgentRunTextDeliveryAttempt(
          existing,
          input,
        );
        if (transition.status !== 'dispatch_authorized') {
          return transition;
        }
        const tokenInserted = await client.query(
          `INSERT INTO agent_run_text_delivery_attempts (
             run_id,
             delivery_attempt,
             delivery_attempt_token,
             created_at
           ) VALUES ($1, $2, $3, $4)
           ON CONFLICT DO NOTHING
           RETURNING run_id`,
          [
            existing.runId,
            transition.record.deliveryAttempt,
            transition.record.deliveryAttemptToken,
            transition.record.updatedAt,
          ],
        );
        if (tokenInserted.rowCount !== 1) {
          return blockedBegin('delivery_attempt_token_reused');
        }
        await writeDelivery(client, existing, transition.record);
        return transition;
      },
    );
  }

  async completeAgentRunTextDeliveryAttempt(
    input: CompleteAgentRunTextDeliveryAttemptInput,
  ): Promise<CompleteAgentRunTextDeliveryAttemptResult> {
    return withPostgresDeliveryTransaction(
      this.db,
      async (client) => {
        if (!await lockStoredExecution(client, input.execution)) {
          return blockedCompletion('execution_binding_mismatch');
        }
        const existing = await readDelivery(
          client,
          input.execution.runId,
          true,
        );
        if (!existing) {
          return blockedCompletion('execution_binding_mismatch');
        }
        const transition = completeAgentRunTextDeliveryAttempt(
          existing,
          input,
        );
        if (transition.status !== 'transitioned') return transition;
        await writeDelivery(client, existing, transition.record);
        if (transition.record.status === 'confirmed_sent') {
          await completeRunAsSent(
            client,
            transition.record,
            input.updatedAt,
          );
        } else if (
          transition.record.status === 'delivery_outcome_unknown'
        ) {
          await reconcileRunForUnknownDelivery(
            client,
            transition.record,
            input.updatedAt,
          );
        }
        return transition;
      },
    );
  }

  async reconcileAgentRunTextDelivery(
    input: ReconcileAgentRunTextDeliveryInput,
  ): Promise<ReconcileAgentRunTextDeliveryResult> {
    return withPostgresDeliveryTransaction(
      this.db,
      async (client) => {
        if (!await lockStoredExecution(client, input.execution)) {
          return {
            status: 'reconciliation_blocked',
            reason: 'execution_binding_mismatch',
          };
        }
        const existing = await readDelivery(
          client,
          input.execution.runId,
          true,
        );
        if (!existing) {
          return {
            status: 'reconciliation_blocked',
            reason: 'execution_binding_mismatch',
          };
        }
        const transition = reconcileAgentRunTextDelivery(
          existing,
          input,
        );
        if (
          transition.status !== 'reconciled' &&
          transition.status !== 'replay'
        ) {
          return transition;
        }
        if (transition.status === 'reconciled') {
          await writeDelivery(client, existing, transition.record);
        }
        await reconcileRunForUnknownDelivery(
          client,
          transition.record,
          input.updatedAt,
        );
        return transition;
      },
    );
  }

  async supersedeAgentRunExecutionIfNoLongerCurrent(
    input: SupersedeAgentRunExecutionIfNoLongerCurrentInput,
  ): Promise<SupersedeAgentRunExecutionIfNoLongerCurrentResult> {
    return withPostgresDeliveryTransaction(
      this.db,
      async (client) => {
        const session = await client.query<{ session_id: string }>(
          `SELECT session_id FROM agent_runs WHERE id = $1`,
          [input.fence.runId],
        );
        if (session.rows[0]?.session_id !== input.sessionId) {
          return { status: 'stale' };
        }
        const authority = await captureActivePostgresSessionAuthority(
          client,
          input.sessionId,
        );
        const locked = await client.query<AgentRunRow>(
          `SELECT *
           FROM agent_runs
           WHERE id = $1
             AND session_id = $2
             AND generation = $3
             AND session_authority_generation = $4
             AND execution_attempt = $5
             AND execution_lease_token = $6
             AND status = 'running'
           FOR UPDATE`,
          [
            input.fence.runId,
            input.sessionId,
            input.fence.generation,
            input.fence.sessionAuthorityGeneration,
            input.fence.executionAttempt,
            input.fence.executionLeaseToken,
          ],
        );
        const row = locked.rows[0];
        if (!row) {
          return {
            status: 'stale',
            ...(await readAgentRun(client, input.fence.runId)),
          };
        }
        const run = agentRunFromRow(row);
        if (
          run.irreversibleSideEffectAt !== null ||
          run.irreversibleToolName !== null
        ) {
          return {
            status: 'reconciliation_required',
            reason: 'irreversible_outcome_unknown',
            run,
          };
        }
        const delivery = await readDelivery(client, run.id, true);
        if (
          delivery?.status === 'sending' ||
          delivery?.status === 'delivery_outcome_unknown' ||
          delivery?.status === 'confirmed_sent'
        ) {
          return {
            status: 'reconciliation_required',
            reason: 'delivery_outcome_unknown',
            run,
          };
        }
        if (
          authority === run.sessionAuthorityGeneration &&
          run.executionLeaseExpiresAt !== null &&
          await sessionAgentRunIsCurrent(client, run)
        ) {
          return { status: 'still_current', run };
        }
        const updated = await client.query<AgentRunRow>(
          `UPDATE agent_runs
           SET status = 'superseded',
               superseded_by_run_id = $2,
               delivery_status = 'suppressed',
               error_code = 'stale_agent_run',
               error_message = $3,
               completed_at = $4,
               updated_at = $4
           WHERE id = $1
             AND status = 'running'
             AND execution_attempt = $5
             AND execution_lease_token = $6
           RETURNING *`,
          [
            run.id,
            input.supersededByRunId ?? null,
            input.errorMessage,
            input.completedAt,
            input.fence.executionAttempt,
            input.fence.executionLeaseToken,
          ],
        );
        const superseded = updated.rows[0];
        if (!superseded) return { status: 'stale', run };
        return {
          status: 'superseded',
          run: agentRunFromRow(superseded),
        };
      },
    );
  }
}

async function lockCurrentDeliveryExecution(
  client: PoolClient,
  delivery: AgentRunTextDeliveryRecord,
): Promise<boolean> {
  const session = await client.query<{ session_id: string }>(
    `SELECT session_id FROM agent_runs WHERE id = $1`,
    [delivery.runId],
  );
  const sessionId = session.rows[0]?.session_id;
  if (!sessionId) return false;
  const authority = await captureActivePostgresSessionAuthority(
    client,
    sessionId,
  );
  if (authority === undefined) return false;
  const result = await client.query(
    `SELECT run.id
     FROM agent_runs AS run
     JOIN session_agent_state AS state
       ON state.session_id = run.session_id
      AND state.current_run_id = run.id
      AND state.generation = run.generation
     JOIN conversation_turns AS turn
       ON turn.id = $4
      AND turn.session_id = run.session_id
      AND turn.role = 'assistant'
      AND turn.channel = $5
     WHERE run.id = $1
       AND run.status = 'running'
       AND run.execution_attempt = $2
       AND run.execution_lease_token = $3
       AND run.execution_lease_expires_at IS NOT NULL
       AND clock_timestamp() < run.execution_lease_expires_at
       AND run.session_authority_generation = $6
       AND run.channel = $5
       AND run.assistant_turn_id = $4
     FOR UPDATE OF run, state, turn`,
    [
      delivery.runId,
      delivery.runExecutionAttempt,
      delivery.runExecutionLeaseToken,
      delivery.assistantTurnId,
      delivery.channel,
      authority,
    ],
  );
  return result.rowCount === 1;
}

async function lockStoredExecution(
  client: PoolClient,
  execution: {
    runId: string;
    executionAttempt: number;
    executionLeaseToken: string;
  },
): Promise<boolean> {
  const result = await client.query(
    `SELECT id
     FROM agent_runs
     WHERE id = $1
       AND execution_attempt = $2
       AND execution_lease_token = $3
     FOR UPDATE`,
    [
      execution.runId,
      execution.executionAttempt,
      execution.executionLeaseToken,
    ],
  );
  return result.rowCount === 1;
}

async function sessionAgentRunIsCurrent(
  client: PoolClient,
  run: AgentRun,
): Promise<boolean> {
  const result = await client.query(
    `SELECT session_id
     FROM session_agent_state
     WHERE session_id = $1
       AND current_run_id = $2
       AND generation = $3
       AND clock_timestamp() < $4::timestamptz
     FOR UPDATE`,
    [
      run.sessionId,
      run.id,
      run.generation,
      run.executionLeaseExpiresAt,
    ],
  );
  return result.rowCount === 1;
}

async function readDelivery(
  db: Queryable,
  runId: string,
  forUpdate: boolean,
): Promise<AgentRunTextDeliveryRecord | undefined> {
  const result = await db.query<AgentRunTextDeliveryStorageRow>(
    `SELECT ${deliverySelectColumns()}
     FROM agent_run_text_deliveries
     WHERE run_id = $1
     ${forUpdate ? 'FOR UPDATE' : ''}`,
    [runId],
  );
  const row = result.rows[0];
  return row ? deliveryFromRow(db, row) : undefined;
}

async function deliveryFromRow(
  db: Queryable,
  row: AgentRunTextDeliveryStorageRow,
): Promise<AgentRunTextDeliveryRecord> {
  const attempts = await db.query<DeliveryAttemptTokenRow>(
    `SELECT delivery_attempt_token
     FROM agent_run_text_delivery_attempts
     WHERE run_id = $1
       AND delivery_attempt < $2
     ORDER BY delivery_attempt ASC`,
    [row.run_id, row.delivery_attempt],
  );
  return agentRunTextDeliveryFromStorageRow(
    row,
    attempts.rows.map((attempt) => attempt.delivery_attempt_token),
  );
}

async function insertDelivery(
  client: PoolClient,
  record: AgentRunTextDeliveryRecord,
): Promise<AgentRunTextDeliveryRecord> {
  const result = await client.query<AgentRunTextDeliveryStorageRow>(
    `INSERT INTO agent_run_text_deliveries (${deliveryColumns})
     VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8,
       $9, $10, $11, $12, $13, $14, $15, $16,
       $17, $18, $19, $20
     )
     RETURNING ${deliverySelectColumns()}`,
    [...agentRunTextDeliveryStorageValues(record)],
  );
  const row = result.rows[0];
  if (!row) throw new Error('postgres_agent_run_delivery_insert_missing');
  return agentRunTextDeliveryFromStorageRow(row);
}

async function writeDelivery(
  client: PoolClient,
  existing: AgentRunTextDeliveryRecord,
  next: AgentRunTextDeliveryRecord,
): Promise<void> {
  const result = await client.query(
    `UPDATE agent_run_text_deliveries
     SET run_execution_attempt = $2,
         run_execution_lease_token = $3,
         run_execution_lease_token_digest = $4,
         prior_run_execution_lease_token_digests = $5,
         delivery_binding_digest = $6,
         status = $7,
         delivery_attempt = $8,
         last_delivery_run_execution_attempt = $9,
         delivery_attempt_token = $10,
         provider_message_id = $11,
         outcome_code = $12,
         updated_at = $13
     WHERE run_id = $1
       AND run_execution_attempt = $14
       AND run_execution_origin_attempt = $15
       AND run_execution_lease_token = $16
       AND run_execution_lease_token_digest = $17
       AND prior_run_execution_lease_token_digests = $18::jsonb
       AND delivery_binding_digest = $19
       AND status = $20
       AND delivery_attempt = $21
       AND last_delivery_run_execution_attempt
             IS NOT DISTINCT FROM $22
       AND delivery_attempt_token IS NOT DISTINCT FROM $23
       AND provider_message_id IS NOT DISTINCT FROM $24
       AND outcome_code IS NOT DISTINCT FROM $25
       AND updated_at = $26::timestamptz`,
    [
      next.runId,
      next.runExecutionAttempt,
      next.runExecutionLeaseToken,
      next.runExecutionLeaseTokenDigest,
      JSON.stringify(next.priorRunExecutionLeaseTokenDigests),
      next.deliveryBindingDigest,
      next.status,
      next.deliveryAttempt,
      next.lastDeliveryRunExecutionAttempt,
      next.deliveryAttemptToken,
      next.providerMessageId,
      next.outcomeCode,
      next.updatedAt,
      existing.runExecutionAttempt,
      existing.runExecutionOriginAttempt,
      existing.runExecutionLeaseToken,
      existing.runExecutionLeaseTokenDigest,
      JSON.stringify(existing.priorRunExecutionLeaseTokenDigests),
      existing.deliveryBindingDigest,
      existing.status,
      existing.deliveryAttempt,
      existing.lastDeliveryRunExecutionAttempt,
      existing.deliveryAttemptToken,
      existing.providerMessageId,
      existing.outcomeCode,
      existing.updatedAt,
    ],
  );
  if (result.rowCount !== 1) {
    throw new Error('postgres_agent_run_delivery_update_missing');
  }
}

async function completeRunAsSent(
  client: PoolClient,
  delivery: Extract<
    AgentRunTextDeliveryRecord,
    { status: 'confirmed_sent' }
  >,
  updatedAt: string,
): Promise<AgentRun> {
  const result = await client.query<AgentRunRow>(
    `UPDATE agent_runs
     SET status = 'completed',
         assistant_turn_id = $4,
         delivery_status = 'sent',
         delivery_external_message_id = $5,
         error_code = NULL,
         error_message = NULL,
         completed_at = COALESCE(completed_at, $6),
         updated_at = $6
     WHERE id = $1
       AND status = 'running'
       AND execution_attempt = $2
       AND execution_lease_token = $3
     RETURNING *`,
    [
      delivery.runId,
      delivery.runExecutionAttempt,
      delivery.runExecutionLeaseToken,
      delivery.assistantTurnId,
      delivery.providerMessageId,
      updatedAt,
    ],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error('postgres_agent_run_delivery_execution_binding_lost');
  }
  return agentRunFromRow(row);
}

async function reconcileRunForUnknownDelivery(
  client: PoolClient,
  delivery: Extract<
    AgentRunTextDeliveryRecord,
    { status: 'delivery_outcome_unknown' }
  >,
  updatedAt: string,
): Promise<AgentRun> {
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
       AND execution_attempt = $2
       AND execution_lease_token = $3
       AND status IN ('running', 'reconciliation_required')
     RETURNING *`,
    [
      delivery.runId,
      delivery.runExecutionAttempt,
      delivery.runExecutionLeaseToken,
      updatedAt,
    ],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error('postgres_agent_run_delivery_execution_binding_lost');
  }
  return agentRunFromRow(row);
}

async function readAgentRun(
  db: Queryable,
  runId: string,
): Promise<{ run: AgentRun } | Record<string, never>> {
  const result = await db.query<AgentRunRow>(
    `SELECT * FROM agent_runs WHERE id = $1`,
    [runId],
  );
  return result.rows[0]
    ? { run: agentRunFromRow(result.rows[0]) }
    : {};
}

function deliverySelectColumns(alias?: string): string {
  const prefix = alias ? `${alias}.` : '';
  return deliveryColumns
    .split(',')
    .map((column) => column.trim())
    .filter(Boolean)
    .map((column) => `${prefix}${column}`)
    .join(', ');
}

function blockedBegin(
  reason: Extract<
    BeginAgentRunTextDeliveryAttemptResult,
    { status: 'dispatch_blocked' }
  >['reason'],
): BeginAgentRunTextDeliveryAttemptResult {
  return { status: 'dispatch_blocked', reason };
}

function blockedCompletion(
  reason: Extract<
    CompleteAgentRunTextDeliveryAttemptResult,
    { status: 'transition_blocked' }
  >['reason'],
): CompleteAgentRunTextDeliveryAttemptResult {
  return { status: 'transition_blocked', reason };
}

async function withPostgresDeliveryTransaction<Result>(
  db: Queryable,
  operation: (client: PoolClient) => Promise<Result>,
): Promise<Result> {
  if (!isConnectablePostgres(db)) {
    throw new Error('postgres_atomic_agent_run_delivery_unavailable');
  }
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the original failure; uncertain delivery is fail-closed.
    }
    throw error;
  } finally {
    client.release();
  }
}
