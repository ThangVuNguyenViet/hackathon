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
  ClaimAgentRunExecutionInput,
  ClaimAgentRunExecutionResult,
  CreateAgentRunTextDeliveryResult,
  SupersedeAgentRunExecutionIfNoLongerCurrentInput,
  SupersedeAgentRunExecutionIfNoLongerCurrentResult,
} from './contracts.js';
import { D1StoreVerifiedRefOperations } from './d1StoreVerifiedRefOperations.js';
import {
  agentRunFromRow,
  type AgentRunRow,
  type D1Result,
} from './d1StoreSupport.js';
import { d1ActiveSessionAuthoritySource } from './d1StoreSessionAuthority.js';
import { assertAgentRunExecutionClaim } from './agentRunExecutionLease.js';
import {
  d1AgentRunTextDeliveryColumns,
  d1AgentRunTextDeliveryInsertPlaceholders,
  d1BlockedDeliveryBegin,
  d1BlockedDeliveryCompletion,
  d1ConfirmedSentRunUpdateSql,
  d1CurrentDeliveryExecutionBindings,
  d1CurrentDeliveryExecutionSql,
  d1DeliverySelectColumns,
  d1ExactRunFence,
  d1FirstResult,
  d1UnknownRunUpdateSql,
} from './d1StoreAgentRunTextDeliverySql.js';

export class D1StoreAgentRunTextDeliveryOperations extends D1StoreVerifiedRefOperations {
  override async claimAgentRunExecution(
    input: ClaimAgentRunExecutionInput,
  ): Promise<ClaimAgentRunExecutionResult> {
    assertAgentRunExecutionClaim(input);
    const reconciled = await this.reconcileExpiredSendingDelivery(input);
    if (reconciled) return reconciled;
    const result = await super.claimAgentRunExecution(input);
    if (result.status !== 'stale') return result;
    const delivery = await this.getAgentRunTextDelivery(input.runId);
    return delivery?.status === 'delivery_outcome_unknown'
      ? {
          status: 'stale',
          reason: 'delivery_outcome_unknown',
          ...(result.run ? { run: result.run } : {}),
        }
      : result;
  }

  async supersedeAgentRunExecutionIfNoLongerCurrent(
    input: SupersedeAgentRunExecutionIfNoLongerCurrentInput,
  ): Promise<SupersedeAgentRunExecutionIfNoLongerCurrentResult> {
    const updated = await this.db
      .prepare(
        `UPDATE agent_runs
         SET status = 'superseded',
             superseded_by_run_id = ?,
             delivery_status = 'suppressed',
             error_code = 'stale_agent_run',
             error_message = ?,
             completed_at = ?,
             updated_at = ?
         WHERE id = ?
           AND session_id = ?
           AND generation = ?
           AND session_authority_generation = ?
           AND execution_attempt = ?
           AND execution_lease_token = ?
           AND status = 'running'
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
           AND NOT (
             execution_lease_expires_at IS NOT NULL
             AND julianday('now') < julianday(execution_lease_expires_at)
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
           )
         RETURNING *`,
      )
      .bind(
        input.supersededByRunId ?? null,
        input.errorMessage,
        input.completedAt,
        input.completedAt,
        input.fence.runId,
        input.sessionId,
        input.fence.generation,
        input.fence.sessionAuthorityGeneration,
        input.fence.executionAttempt,
        input.fence.executionLeaseToken,
        input.sessionId,
      )
      .first<AgentRunRow>();
    if (updated) {
      return { status: 'superseded', run: agentRunFromRow(updated) };
    }

    const run = await this.getAgentRun(input.fence.runId);
    if (!run || !d1ExactRunFence(run, input)) {
      return { status: 'stale', ...(run ? { run } : {}) };
    }
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
    const delivery = await this.getAgentRunTextDelivery(run.id);
    if (
      delivery?.status === 'sending' ||
      delivery?.status === 'confirmed_sent' ||
      delivery?.status === 'delivery_outcome_unknown'
    ) {
      return {
        status: 'reconciliation_required',
        reason: 'delivery_outcome_unknown',
        run,
      };
    }
    return (await this.d1RunOwnerIsCurrent(run))
      ? { status: 'still_current', run }
      : { status: 'stale', run };
  }

  async createAgentRunTextDelivery(
    input: CreatePendingAgentRunTextDeliveryInput,
  ): Promise<CreateAgentRunTextDeliveryResult> {
    const pending = await createPendingAgentRunTextDelivery(input);
    const inserted = await this.db
      .prepare(
        `INSERT INTO agent_run_text_deliveries (${d1AgentRunTextDeliveryColumns})
         SELECT ${d1AgentRunTextDeliveryInsertPlaceholders}
         WHERE ${d1CurrentDeliveryExecutionSql()}
         ON CONFLICT(run_id) DO NOTHING
         RETURNING *`,
      )
      .bind(
        ...agentRunTextDeliveryStorageValues(pending),
        ...d1CurrentDeliveryExecutionBindings(pending),
      )
      .first<AgentRunTextDeliveryStorageRow>();
    if (inserted) {
      return {
        status: 'created',
        record: agentRunTextDeliveryFromStorageRow(inserted),
      };
    }

    if (!(await this.d1DeliveryExecutionIsCurrent(pending))) {
      return { status: 'stale' };
    }
    const existing = await this.getAgentRunTextDelivery(pending.runId);
    if (!existing) return { status: 'stale' };
    if (sameAgentRunTextDeliveryBinding(existing, pending)) {
      return { status: 'replay', record: existing };
    }
    const rebound = await rebindRetryableAgentRunTextDelivery(existing, {
      execution: input.execution,
      channel: input.channel,
      assistantTurnId: input.assistantTurnId,
      recipientId: input.recipientId,
      presentationText: input.presentationText,
      updatedAt: input.createdAt,
    });
    if (rebound.status !== 'rebound') {
      return { status: 'conflict', record: existing };
    }
    const changed = await this.db
      .prepare(
        `UPDATE agent_run_text_deliveries
         SET run_execution_attempt = ?,
             run_execution_lease_token = ?,
             run_execution_lease_token_digest = ?,
             prior_run_execution_lease_token_digests = ?,
             delivery_binding_digest = ?,
             updated_at = ?
         WHERE run_id = ?
           AND run_execution_attempt = ?
           AND run_execution_origin_attempt = ?
           AND run_execution_lease_token = ?
           AND run_execution_lease_token_digest = ?
           AND prior_run_execution_lease_token_digests = ?
           AND last_delivery_run_execution_attempt IS ?
           AND delivery_binding_digest = ?
           AND status = ?
           AND delivery_attempt = ?
           AND updated_at = ?
           AND ${d1CurrentDeliveryExecutionSql()}
         RETURNING *`,
      )
      .bind(
        rebound.record.runExecutionAttempt,
        rebound.record.runExecutionLeaseToken,
        rebound.record.runExecutionLeaseTokenDigest,
        JSON.stringify(rebound.record.priorRunExecutionLeaseTokenDigests),
        rebound.record.deliveryBindingDigest,
        rebound.record.updatedAt,
        existing.runId,
        existing.runExecutionAttempt,
        existing.runExecutionOriginAttempt,
        existing.runExecutionLeaseToken,
        existing.runExecutionLeaseTokenDigest,
        JSON.stringify(existing.priorRunExecutionLeaseTokenDigests),
        existing.lastDeliveryRunExecutionAttempt,
        existing.deliveryBindingDigest,
        existing.status,
        existing.deliveryAttempt,
        existing.updatedAt,
        ...d1CurrentDeliveryExecutionBindings(rebound.record),
      )
      .first<AgentRunTextDeliveryStorageRow>();
    if (!changed) {
      const current = await this.getAgentRunTextDelivery(pending.runId);
      return current && sameAgentRunTextDeliveryBinding(current, rebound.record)
        ? { status: 'replay', record: current }
        : { status: 'conflict', ...(current ? { record: current } : {}) };
    }
    return {
      status: 'rebound',
      record: await this.deliveryRecordFromRow(changed),
    };
  }

  async getAgentRunTextDelivery(
    runId: string,
  ): Promise<AgentRunTextDeliveryRecord | undefined> {
    const row = await this.db
      .prepare(
        `SELECT ${d1AgentRunTextDeliveryColumns}
         FROM agent_run_text_deliveries
         WHERE run_id = ?
         LIMIT 1`,
      )
      .bind(runId)
      .first<AgentRunTextDeliveryStorageRow>();
    return row ? this.deliveryRecordFromRow(row) : undefined;
  }

  async beginAgentRunTextDeliveryAttempt(
    input: BeginAgentRunTextDeliveryAttemptInput,
  ): Promise<BeginAgentRunTextDeliveryAttemptResult> {
    const existing = await this.getAgentRunTextDelivery(input.execution.runId);
    if (!existing) {
      return d1BlockedDeliveryBegin('execution_binding_mismatch');
    }
    const transition = beginAgentRunTextDeliveryAttempt(existing, input);
    if (transition.status !== 'dispatch_authorized') return transition;
    if (!this.db.batch) {
      throw new Error('d1_atomic_agent_run_text_delivery_begin_unavailable');
    }
    const next = transition.record;
    let results: D1Result[];
    try {
      results = await this.db.batch([
        this.db
          .prepare(
            `UPDATE agent_run_text_deliveries
             SET status = 'sending',
                 delivery_attempt = ?,
                 delivery_attempt_token = ?,
                 last_delivery_run_execution_attempt = ?,
                 provider_message_id = NULL,
                 outcome_code = NULL,
                 updated_at = ?
             WHERE run_id = ?
               AND run_execution_attempt = ?
               AND run_execution_lease_token = ?
               AND delivery_binding_digest = ?
               AND status = ?
               AND delivery_attempt = ?
               AND delivery_attempt_token IS ?
               AND updated_at = ?
               AND NOT EXISTS (
                 SELECT 1
                 FROM agent_run_text_delivery_attempts
                 WHERE delivery_attempt_token = ?
               )
               AND ${d1CurrentDeliveryExecutionSql()}
             RETURNING *`,
          )
          .bind(
            next.deliveryAttempt,
            next.deliveryAttemptToken,
            next.lastDeliveryRunExecutionAttempt,
            next.updatedAt,
            existing.runId,
            existing.runExecutionAttempt,
            existing.runExecutionLeaseToken,
            existing.deliveryBindingDigest,
            existing.status,
            existing.deliveryAttempt,
            existing.deliveryAttemptToken,
            existing.updatedAt,
            next.deliveryAttemptToken,
            ...d1CurrentDeliveryExecutionBindings(existing),
          ),
        this.db
          .prepare(
            `INSERT INTO agent_run_text_delivery_attempts (
               run_id,
               delivery_attempt,
               delivery_attempt_token,
               created_at
             )
             SELECT run_id, delivery_attempt, delivery_attempt_token, updated_at
             FROM agent_run_text_deliveries
             WHERE run_id = ?
               AND run_execution_attempt = ?
               AND run_execution_lease_token = ?
               AND status = 'sending'
               AND delivery_attempt = ?
               AND delivery_attempt_token = ?
               AND updated_at = ?`,
          )
          .bind(
            next.runId,
            next.runExecutionAttempt,
            next.runExecutionLeaseToken,
            next.deliveryAttempt,
            next.deliveryAttemptToken,
            next.updatedAt,
          ),
      ]);
    } catch (error) {
      if (await this.deliveryAttemptTokenExists(input.deliveryAttemptToken)) {
        return d1BlockedDeliveryBegin('delivery_attempt_token_reused');
      }
      throw error;
    }
    const updated = d1FirstResult<AgentRunTextDeliveryStorageRow>(results[0]);
    if (updated && Number(results[1]?.meta.changes ?? 0) === 1) {
      const record = await this.deliveryRecordFromRow(updated);
      if (record.status !== 'sending') {
        throw new Error('d1_agent_run_text_delivery_begin_state_invalid');
      }
      return {
        status: 'dispatch_authorized',
        record,
      };
    }
    return this.classifyBlockedBegin(input);
  }

  async completeAgentRunTextDeliveryAttempt(
    input: CompleteAgentRunTextDeliveryAttemptInput,
  ): Promise<CompleteAgentRunTextDeliveryAttemptResult> {
    const existing = await this.getAgentRunTextDelivery(input.execution.runId);
    if (!existing || !(await this.d1StoredRunExecutionMatches(existing))) {
      return d1BlockedDeliveryCompletion('execution_binding_mismatch');
    }
    const transition = completeAgentRunTextDeliveryAttempt(existing, input);
    if (transition.status !== 'transitioned') return transition;
    if (existing.status !== 'sending') {
      throw new Error('d1_agent_run_text_delivery_completion_source_invalid');
    }
    const next = transition.record;
    if (next.status === 'confirmed_not_sent') {
      const updated = await this.updateSendingDelivery(existing, next);
      return updated
        ? { status: 'transitioned', record: updated }
        : this.classifyBlockedCompletion(input);
    }
    if (!this.db.batch) {
      throw new Error('d1_atomic_agent_run_text_delivery_complete_unavailable');
    }
    const results = await this.db.batch([
      this.updateSendingDeliveryStatement(existing, next),
      this.db
        .prepare(
          next.status === 'confirmed_sent'
            ? d1ConfirmedSentRunUpdateSql
            : d1UnknownRunUpdateSql,
        )
        .bind(
          ...(next.status === 'confirmed_sent'
            ? [
                next.assistantTurnId,
                next.providerMessageId,
                next.updatedAt,
                next.updatedAt,
              ]
            : [next.updatedAt, next.updatedAt]),
          next.runId,
          next.runExecutionAttempt,
          next.runExecutionLeaseToken,
          next.status,
          next.deliveryAttempt,
          next.deliveryAttemptToken,
          next.updatedAt,
        ),
    ]);
    const updated = d1FirstResult<AgentRunTextDeliveryStorageRow>(results[0]);
    if (updated && Number(results[1]?.meta.changes ?? 0) === 1) {
      const record = await this.deliveryRecordFromRow(updated);
      if (record.status === 'pending' || record.status === 'sending') {
        throw new Error('d1_agent_run_text_delivery_completion_state_invalid');
      }
      return {
        status: 'transitioned',
        record,
      };
    }
    return this.classifyBlockedCompletion(input);
  }

  async reconcileAgentRunTextDelivery(
    input: ReconcileAgentRunTextDeliveryInput,
  ): Promise<ReconcileAgentRunTextDeliveryResult> {
    const existing = await this.getAgentRunTextDelivery(input.execution.runId);
    if (!existing || !(await this.d1StoredRunExecutionMatches(existing))) {
      return {
        status: 'reconciliation_blocked',
        reason: 'execution_binding_mismatch',
        ...(existing ? { record: existing } : {}),
      };
    }
    const transition = reconcileAgentRunTextDelivery(existing, input);
    if (transition.status === 'replay') {
      await this.ensureRunReconciliation(
        transition.record,
        transition.record.updatedAt,
      );
      return transition;
    }
    if (transition.status !== 'reconciled') return transition;
    if (existing.status !== 'sending') {
      throw new Error('d1_agent_run_text_delivery_reconcile_source_invalid');
    }
    if (!this.db.batch) {
      throw new Error(
        'd1_atomic_agent_run_text_delivery_reconcile_unavailable',
      );
    }
    const next = transition.record;
    const results = await this.db.batch([
      this.updateSendingDeliveryStatement(existing, next),
      this.db
        .prepare(d1UnknownRunUpdateSql)
        .bind(
          next.updatedAt,
          next.updatedAt,
          next.runId,
          next.runExecutionAttempt,
          next.runExecutionLeaseToken,
          next.status,
          next.deliveryAttempt,
          next.deliveryAttemptToken,
          next.updatedAt,
        ),
    ]);
    const updated = d1FirstResult<AgentRunTextDeliveryStorageRow>(results[0]);
    if (updated && Number(results[1]?.meta.changes ?? 0) === 1) {
      const record = await this.deliveryRecordFromRow(updated);
      if (record.status !== 'delivery_outcome_unknown') {
        throw new Error('d1_agent_run_text_delivery_reconcile_state_invalid');
      }
      return {
        status: 'reconciled',
        record,
      };
    }
    const current = await this.getAgentRunTextDelivery(next.runId);
    if (
      current?.status === 'delivery_outcome_unknown' &&
      current.runExecutionAttempt === next.runExecutionAttempt &&
      current.runExecutionLeaseToken === next.runExecutionLeaseToken
    ) {
      return { status: 'replay', record: current };
    }
    return {
      status: 'reconciliation_blocked',
      reason: 'execution_binding_mismatch',
      ...(current ? { record: current } : {}),
    };
  }

  private async reconcileExpiredSendingDelivery(
    input: ClaimAgentRunExecutionInput,
  ): Promise<
    | Extract<
        ClaimAgentRunExecutionResult,
        { status: 'reconciliation_required' }
      >
    | undefined
  > {
    const row = await this.db
      .prepare(
        `SELECT ${d1DeliverySelectColumns('delivery')}
         FROM agent_run_text_deliveries AS delivery
         JOIN agent_runs AS run ON run.id = delivery.run_id
         WHERE run.id = ?
           AND run.session_id = ?
           AND run.generation = ?
           AND run.session_authority_generation = ?
           AND run.status = 'running'
           AND run.execution_lease_expires_at IS NOT NULL
           AND julianday(run.execution_lease_expires_at) <= julianday('now')
           AND delivery.status = 'sending'
           AND delivery.run_execution_attempt = run.execution_attempt
           AND delivery.run_execution_lease_token = run.execution_lease_token
         LIMIT 1`,
      )
      .bind(
        input.runId,
        input.sessionId,
        input.generation,
        input.sessionAuthorityGeneration,
      )
      .first<AgentRunTextDeliveryStorageRow>();
    if (!row) return undefined;
    const existing = await this.deliveryRecordFromRow(row);
    const reconciledAt =
      Date.parse(input.claimedAt) >= Date.parse(existing.updatedAt)
        ? input.claimedAt
        : existing.updatedAt;
    const transition = reconcileAgentRunTextDelivery(existing, {
      execution: {
        runId: existing.runId,
        executionAttempt: existing.runExecutionAttempt,
        executionLeaseToken: existing.runExecutionLeaseToken,
      },
      outcomeCode: 'agent_run_execution_lease_expired',
      updatedAt: reconciledAt,
    });
    if (transition.status !== 'reconciled') return undefined;
    if (!this.db.batch) {
      throw new Error('d1_atomic_expired_delivery_reconciliation_unavailable');
    }
    const next = transition.record;
    const results = await this.db.batch([
      this.db
        .prepare(
          `UPDATE agent_run_text_deliveries
           SET status = 'delivery_outcome_unknown',
               provider_message_id = NULL,
               outcome_code = ?,
               updated_at = ?
           WHERE run_id = ?
             AND run_execution_attempt = ?
             AND run_execution_lease_token = ?
             AND status = 'sending'
             AND delivery_attempt = ?
             AND delivery_attempt_token = ?
             AND updated_at = ?
             AND EXISTS (
               SELECT 1
               FROM agent_runs
               WHERE id = agent_run_text_deliveries.run_id
                 AND session_id = ?
                 AND generation = ?
                 AND session_authority_generation = ?
                 AND status = 'running'
                 AND execution_attempt =
                   agent_run_text_deliveries.run_execution_attempt
                 AND execution_lease_token =
                   agent_run_text_deliveries.run_execution_lease_token
                 AND execution_lease_expires_at IS NOT NULL
                 AND julianday(execution_lease_expires_at) <= julianday('now')
             )
           RETURNING *`,
        )
        .bind(
          next.outcomeCode,
          next.updatedAt,
          existing.runId,
          existing.runExecutionAttempt,
          existing.runExecutionLeaseToken,
          existing.deliveryAttempt,
          existing.deliveryAttemptToken,
          existing.updatedAt,
          input.sessionId,
          input.generation,
          input.sessionAuthorityGeneration,
        ),
      this.db
        .prepare(d1UnknownRunUpdateSql)
        .bind(
          next.updatedAt,
          next.updatedAt,
          next.runId,
          next.runExecutionAttempt,
          next.runExecutionLeaseToken,
          next.status,
          next.deliveryAttempt,
          next.deliveryAttemptToken,
          next.updatedAt,
        ),
    ]);
    const runRow = d1FirstResult<AgentRunRow>(results[1]);
    if (!d1FirstResult<AgentRunTextDeliveryStorageRow>(results[0]) || !runRow) {
      return undefined;
    }
    return {
      status: 'reconciliation_required',
      reason: 'delivery_outcome_unknown',
      run: agentRunFromRow(runRow),
    };
  }

  private async deliveryRecordFromRow(
    row: AgentRunTextDeliveryStorageRow,
  ): Promise<AgentRunTextDeliveryRecord> {
    const attempts = await this.db
      .prepare(
        `SELECT delivery_attempt_token
         FROM agent_run_text_delivery_attempts
         WHERE run_id = ?
           AND delivery_attempt < ?
         ORDER BY delivery_attempt ASC`,
      )
      .bind(row.run_id, Number(row.delivery_attempt))
      .all<{ delivery_attempt_token: string }>();
    return agentRunTextDeliveryFromStorageRow(
      row,
      (attempts.results ?? []).map((attempt) => attempt.delivery_attempt_token),
    );
  }

  private async d1DeliveryExecutionIsCurrent(
    record: AgentRunTextDeliveryRecord,
  ): Promise<boolean> {
    const row = await this.db
      .prepare(`SELECT 1 AS eligible WHERE ${d1CurrentDeliveryExecutionSql()}`)
      .bind(...d1CurrentDeliveryExecutionBindings(record))
      .first<{ eligible: number }>();
    return row?.eligible === 1;
  }

  private async d1StoredRunExecutionMatches(
    record: AgentRunTextDeliveryRecord,
  ): Promise<boolean> {
    const row = await this.db
      .prepare(
        `SELECT 1 AS eligible
         FROM agent_runs
         WHERE id = ?
           AND execution_attempt = ?
           AND execution_lease_token = ?
         LIMIT 1`,
      )
      .bind(
        record.runId,
        record.runExecutionAttempt,
        record.runExecutionLeaseToken,
      )
      .first<{ eligible: number }>();
    return row?.eligible === 1;
  }

  private async d1RunOwnerIsCurrent(run: AgentRun): Promise<boolean> {
    const row = await this.db
      .prepare(
        `SELECT 1 AS eligible
         FROM agent_runs
         WHERE id = ?
           AND status = 'running'
           AND execution_lease_expires_at IS NOT NULL
           AND julianday('now') < julianday(execution_lease_expires_at)
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
         LIMIT 1`,
      )
      .bind(run.id, run.sessionId)
      .first<{ eligible: number }>();
    return row?.eligible === 1;
  }

  private async deliveryAttemptTokenExists(token: string): Promise<boolean> {
    const row = await this.db
      .prepare(
        `SELECT 1 AS found
         FROM agent_run_text_delivery_attempts
         WHERE delivery_attempt_token = ?
         LIMIT 1`,
      )
      .bind(token)
      .first<{ found: number }>();
    return row?.found === 1;
  }

  private updateSendingDeliveryStatement(
    existing: Extract<AgentRunTextDeliveryRecord, { status: 'sending' }>,
    next: Exclude<
      AgentRunTextDeliveryRecord,
      { status: 'pending' | 'sending' }
    >,
  ) {
    return this.db
      .prepare(
        `UPDATE agent_run_text_deliveries
         SET status = ?,
             provider_message_id = ?,
             outcome_code = ?,
             updated_at = ?
         WHERE run_id = ?
           AND run_execution_attempt = ?
           AND run_execution_lease_token = ?
           AND status = 'sending'
           AND delivery_attempt = ?
           AND delivery_attempt_token = ?
           AND updated_at = ?
           AND EXISTS (
             SELECT 1
             FROM agent_runs
             WHERE id = agent_run_text_deliveries.run_id
               AND execution_attempt =
                 agent_run_text_deliveries.run_execution_attempt
               AND execution_lease_token =
                 agent_run_text_deliveries.run_execution_lease_token
           )
         RETURNING *`,
      )
      .bind(
        next.status,
        next.providerMessageId,
        next.outcomeCode,
        next.updatedAt,
        existing.runId,
        existing.runExecutionAttempt,
        existing.runExecutionLeaseToken,
        existing.deliveryAttempt,
        existing.deliveryAttemptToken,
        existing.updatedAt,
      );
  }

  private async updateSendingDelivery(
    existing: Extract<AgentRunTextDeliveryRecord, { status: 'sending' }>,
    next: Exclude<
      AgentRunTextDeliveryRecord,
      { status: 'pending' | 'sending' }
    >,
  ): Promise<
    | Exclude<AgentRunTextDeliveryRecord, { status: 'pending' | 'sending' }>
    | undefined
  > {
    const row = await this.updateSendingDeliveryStatement(
      existing,
      next,
    ).first<AgentRunTextDeliveryStorageRow>();
    if (!row) return undefined;
    const record = await this.deliveryRecordFromRow(row);
    if (record.status === 'pending' || record.status === 'sending') {
      throw new Error('d1_agent_run_text_delivery_completion_state_invalid');
    }
    return record;
  }

  private async ensureRunReconciliation(
    delivery: Extract<
      AgentRunTextDeliveryRecord,
      { status: 'delivery_outcome_unknown' }
    >,
    updatedAt: string,
  ): Promise<void> {
    await this.db
      .prepare(
        `UPDATE agent_runs
         SET status = 'reconciliation_required',
             delivery_status = 'outcome_unknown',
             error_code = 'agent_run_delivery_outcome_unknown',
             error_message =
               'Channel delivery outcome requires reconciliation',
             completed_at = COALESCE(completed_at, ?),
             updated_at = ?
         WHERE id = ?
           AND execution_attempt = ?
           AND execution_lease_token = ?`,
      )
      .bind(
        updatedAt,
        updatedAt,
        delivery.runId,
        delivery.runExecutionAttempt,
        delivery.runExecutionLeaseToken,
      )
      .run();
  }

  private async classifyBlockedBegin(
    input: BeginAgentRunTextDeliveryAttemptInput,
  ): Promise<BeginAgentRunTextDeliveryAttemptResult> {
    if (await this.deliveryAttemptTokenExists(input.deliveryAttemptToken)) {
      return d1BlockedDeliveryBegin('delivery_attempt_token_reused');
    }
    const current = await this.getAgentRunTextDelivery(input.execution.runId);
    return current
      ? beginAgentRunTextDeliveryAttempt(current, input)
      : d1BlockedDeliveryBegin('execution_binding_mismatch');
  }

  private async classifyBlockedCompletion(
    input: CompleteAgentRunTextDeliveryAttemptInput,
  ): Promise<CompleteAgentRunTextDeliveryAttemptResult> {
    const current = await this.getAgentRunTextDelivery(input.execution.runId);
    return current
      ? completeAgentRunTextDeliveryAttempt(current, input)
      : d1BlockedDeliveryCompletion('execution_binding_mismatch');
  }
}
