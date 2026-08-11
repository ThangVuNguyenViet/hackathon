import { randomUUID } from 'node:crypto';
import {
  commerceApprovalPrincipalStorageEvidenceRef,
  commerceApprovalPrincipalStorageSubject,
} from '../ordering/commerceApprovalPrincipal.js';
import type {
  AgentMode,
  AgentRun,
  AgentRunTurn,
  ConversationProfile,
  DashboardEvent,
  ConversationTurn,
  PendingCustomerTurn,
  SessionAgentState,
} from '../domain/types.js';
import type {
  AgentRunPatch,
  AppendConversationTurnInput,
  ConversationStore,
  CreateAgentRunInput,
  ClaimAgentRunResult,
  HistorySearchResult,
  IrreversibleOperationInput,
  IrreversibleOperationCompletion,
  IrreversibleOperationReservation,
  ImportedConversationTurn,
  ImportedConversationTurnResult,
  PendingCustomerTurnInput,
  ReserveWebhookDeliveryInput,
  ReserveWebhookDeliveryResult,
  SessionControl,
  SessionResetHook,
  SessionAgentStateInput,
  StoredEvent,
  UpsertPendingCustomerTurnResult,
  WebhookDelivery,
  WebhookDeliveryChannel,
  AppendCustomerRunEventInput,
  AppendEventIfRunCurrentInput,
  AppendEventIfRunCurrentResult,
  ClaimConfirmationRejectionInput,
  ClaimConfirmationRejectionResult,
  CompleteConfirmationResumeInput,
  CompleteConfirmationResumeResult,
  ConfirmationPauseRecord,
  CreateConfirmationPauseInput,
  CreateConfirmationPauseResult,
  ReserveConfirmationResumeOperationInput,
  ReserveConfirmationResumeOperationResult,
  CustomerRunPatch,
  AdvanceSessionAgentGenerationInput,
  AdvanceSessionAgentGenerationResult,
  ClaimSessionAgentRunOwnershipInput,
  ClaimSessionAgentRunOwnershipResult,
  ClaimAgentRunExecutionInput,
  ClaimAgentRunExecutionResult,
  UpdateAgentRunIfExecutionCurrentInput,
  UpdateAgentRunIfExecutionCurrentResult,
} from './memoryStore.js';
import {
  completionMatches,
  confirmationPauseSnapshotFromStorageRow,
  confirmationPauseSnapshotsMatch,
  currentConfirmationPauseAuthoritySql,
  confirmationRejectionAuthorityMatches,
  confirmationRejectionMatches,
  parseClaimConfirmationRejectionInput,
  parseCompleteConfirmationResumeInput,
  rejectionClaimReplays,
  type ConfirmationPauseStorageRow,
  type ConfirmationPauseStorageSnapshot,
} from './confirmationPause.js';
import {
  CustomerRunIdempotencyConflictError,
  CustomerRunSequenceConflictError,
  customerRunEventSchema,
  type CustomerRun,
  type CustomerRunEvent,
} from '../customerRuns/contracts.js';
import {
  Queryable,
  ConversationTurnRow,
  ConversationProfileRow,
  StoredEventRow,
  DashboardEventRow,
  WebhookDeliveryRow,
  SessionControlRow,
  PendingCustomerTurnRow,
  AgentRunRow,
  AgentRunTurnRow,
  SessionAgentStateRow,
  CustomerRunRow,
  CustomerRunEventRow,
  IrreversibleOperationRow,
  normalizeDate,
  turnFromRow,
  profileFromRow,
  storedEventFromRow,
  dashboardEventFromRow,
  nullableDate,
  webhookDeliveryFromRow,
  sessionControlFromRow,
  customerRunFromRow,
  customerRunEventFromRow,
  defaultSessionControl,
  pendingCustomerTurnFromRow,
  agentRunFromRow,
  agentRunTurnFromRow,
  sessionAgentStateFromRow,
  defaultSessionAgentState
} from './postgresStoreSupport.js';
import { reservePostgresConfirmationResumeOperation } from './postgresStoreConfirmationResumeOperations.js';
import {
  appendPostgresEventIfRunCurrent,
} from './postgresStoreRunCommit.js';
import {
  advancePostgresSessionAgentGeneration,
  claimPostgresAgentRunExecution,
  claimPostgresSessionAgentRunOwnership,
  updatePostgresAgentRunIfExecutionCurrent,
} from './postgresStoreAgentRunOwnership.js';

import { PostgresStoreConversationOperations } from './postgresStoreConversationOperations.js';
import {
  claimPostgresAgentRun,
  createPostgresAgentRun,
} from './postgresStoreAgentRunCreation.js';
import { createPostgresConfirmationPause } from './postgresStoreConfirmationPauseCreation.js';

export class PostgresStoreAgentOperations extends PostgresStoreConversationOperations {
  async createAgentRun(input: CreateAgentRunInput): Promise<AgentRun> {
    return createPostgresAgentRun({ db: this.db, operation: input });
  }

  async claimAgentRun(input: CreateAgentRunInput): Promise<ClaimAgentRunResult> {
    return claimPostgresAgentRun({ db: this.db, operation: input });
  }

  async updateAgentRun(runId: string, patch: AgentRunPatch): Promise<AgentRun> {
    const existing = await this.getAgentRun(runId);
    if (!existing) throw new Error(`Agent run not found: ${runId}`);
    const updated: AgentRun = {
      ...existing,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    const result = await this.db.query<AgentRunRow>(
      `
        UPDATE agent_runs
        SET status = $2,
            superseded_by_run_id = $3,
            irreversible_side_effect_at = $4,
            irreversible_tool_name = $5,
            assistant_turn_id = $6,
            delivery_status = $7,
            delivery_external_message_id = $8,
            error_code = $9,
            error_message = $10,
            started_at = $11,
            completed_at = $12,
            updated_at = $13
        WHERE id = $1
        RETURNING *
      `,
      [
        runId,
        updated.status,
        updated.supersededByRunId,
        updated.irreversibleSideEffectAt,
        updated.irreversibleToolName,
        updated.assistantTurnId,
        updated.deliveryStatus,
        updated.deliveryExternalMessageId,
        updated.errorCode,
        updated.errorMessage,
        updated.startedAt,
        updated.completedAt,
        updated.updatedAt,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`Agent run not found: ${runId}`);
    return agentRunFromRow(row);
  }

  async getAgentRun(runId: string): Promise<AgentRun | undefined> {
    const result = await this.db.query<AgentRunRow>(
      `
        SELECT *
        FROM agent_runs
        WHERE id = $1
        LIMIT 1
      `,
      [runId],
    );
    return result.rows[0] ? agentRunFromRow(result.rows[0]) : undefined;
  }

  async listAgentRuns(sessionId: string): Promise<AgentRun[]> {
    const result = await this.db.query<AgentRunRow>(
      `
        SELECT *
        FROM agent_runs
        WHERE session_id = $1
        ORDER BY generation ASC, id ASC
      `,
      [sessionId],
    );
    return result.rows.map(agentRunFromRow);
  }

  async linkAgentRunTurn(input: AgentRunTurn): Promise<AgentRunTurn> {
    await this.db.query(
      `
        INSERT INTO agent_run_turns (run_id, turn_id, sequence)
        VALUES ($1, $2, $3)
        ON CONFLICT (run_id, turn_id) DO NOTHING
      `,
      [input.runId, input.turnId, input.sequence],
    );
    return input;
  }

  async listAgentRunTurns(runId: string): Promise<AgentRunTurn[]> {
    const result = await this.db.query<AgentRunTurnRow>(
      `
        SELECT *
        FROM agent_run_turns
        WHERE run_id = $1
        ORDER BY sequence ASC, turn_id ASC
      `,
      [runId],
    );
    return result.rows.map(agentRunTurnFromRow);
  }

  async getSessionAgentState(sessionId: string): Promise<SessionAgentState> {
    const result = await this.db.query<SessionAgentStateRow>(
      `
        SELECT *
        FROM session_agent_state
        WHERE session_id = $1
        LIMIT 1
      `,
      [sessionId],
    );
    return result.rows[0] ? sessionAgentStateFromRow(result.rows[0]) : defaultSessionAgentState(sessionId);
  }

  async setSessionAgentState(input: SessionAgentStateInput): Promise<SessionAgentState> {
    const state: SessionAgentState = {
      ...input,
      updatedAt: input.updatedAt ?? new Date().toISOString(),
    };
    const result = await this.db.query<SessionAgentStateRow>(
      `
        INSERT INTO session_agent_state (session_id, current_run_id, generation, debounce_deadline_at, updated_at)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (session_id) DO UPDATE SET
          current_run_id = EXCLUDED.current_run_id,
          generation = EXCLUDED.generation,
          debounce_deadline_at = EXCLUDED.debounce_deadline_at,
          updated_at = EXCLUDED.updated_at
        RETURNING *
      `,
      [state.sessionId, state.currentRunId, state.generation, state.debounceDeadlineAt, state.updatedAt],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`Failed to set session agent state: ${state.sessionId}`);
    return sessionAgentStateFromRow(row);
  }

  async advanceSessionAgentGeneration(
    input: AdvanceSessionAgentGenerationInput,
  ): Promise<AdvanceSessionAgentGenerationResult> {
    return advancePostgresSessionAgentGeneration({
      db: this.db,
      operation: input,
    });
  }

  async claimSessionAgentRunOwnership(
    input: ClaimSessionAgentRunOwnershipInput,
  ): Promise<ClaimSessionAgentRunOwnershipResult> {
    return claimPostgresSessionAgentRunOwnership({
      db: this.db,
      operation: input,
    });
  }

  async claimAgentRunExecution(
    input: ClaimAgentRunExecutionInput,
  ): Promise<ClaimAgentRunExecutionResult> {
    return claimPostgresAgentRunExecution({ db: this.db, operation: input });
  }

  async updateAgentRunIfExecutionCurrent(
    input: UpdateAgentRunIfExecutionCurrentInput,
  ): Promise<UpdateAgentRunIfExecutionCurrentResult> {
    return updatePostgresAgentRunIfExecutionCurrent({
      db: this.db,
      operation: input,
    });
  }

  async listDueSessionAgentStates(now: string, limit: number): Promise<SessionAgentState[]> {
    const result = await this.db.query<SessionAgentStateRow>(
      `
        SELECT *
        FROM session_agent_state
        WHERE current_run_id IS NULL
          AND debounce_deadline_at IS NOT NULL
          AND debounce_deadline_at <= $1
        ORDER BY debounce_deadline_at ASC, session_id ASC
        LIMIT $2
      `,
      [now, limit],
    );
    return result.rows.map(sessionAgentStateFromRow);
  }

  async listTurns(sessionId: string): Promise<ConversationTurn[]> {
    const result = await this.db.query<ConversationTurnRow>(
      `
        SELECT *
        FROM conversation_turns
        WHERE session_id = $1
        ORDER BY created_at ASC, id ASC
      `,
      [sessionId],
    );
    return result.rows.map(turnFromRow);
  }

  async appendEvent(sessionId: string, sourceType: string, payload: Record<string, unknown>): Promise<StoredEvent> {
    const event: StoredEvent = {
      id: `event_${randomUUID()}`,
      sessionId,
      sourceType,
      payload,
      createdAt: new Date().toISOString(),
    };
    await this.db.query(
      `
        INSERT INTO conversation_events (id, session_id, source_type, payload, created_at)
        VALUES ($1, $2, $3, $4, $5)
      `,
      [event.id, event.sessionId, event.sourceType, JSON.stringify(event.payload), event.createdAt],
    );
    return event;
  }

  async appendEventIfRunCurrent(
    input: AppendEventIfRunCurrentInput,
  ): Promise<AppendEventIfRunCurrentResult> {
    return appendPostgresEventIfRunCurrent({
      db: this.db,
      operation: input,
    });
  }

  async listEvents(sessionId: string): Promise<StoredEvent[]> {
    const result = await this.db.query<StoredEventRow>(
      `
        SELECT *
        FROM conversation_events
        WHERE session_id = $1
        ORDER BY created_at ASC, id ASC
      `,
      [sessionId],
    );
    return result.rows.map(storedEventFromRow);
  }

  async reserveConfirmationResumeOperation(
    input: ReserveConfirmationResumeOperationInput,
  ): Promise<ReserveConfirmationResumeOperationResult> {
    return reservePostgresConfirmationResumeOperation(this.db, input);
  }

  async createConfirmationPause(
    value: CreateConfirmationPauseInput,
  ): Promise<CreateConfirmationPauseResult> {
    return createPostgresConfirmationPause({
      db: this.db,
      value,
      readSessionControl: (sessionId) => this.getSessionControl(sessionId),
    });
  }

  private async confirmationPauseSnapshot(
    requestId: string,
  ): Promise<ConfirmationPauseStorageSnapshot | undefined> {
    const result = await this.db.query<ConfirmationPauseStorageRow>(
      `SELECT pause.*
       FROM confirmation_pauses AS pause
       JOIN confirmation_pause_sessions AS session
         ON session.session_id = pause.session_id
        AND session.generation = pause.session_generation
       WHERE pause.request_id = $1
         AND ${currentConfirmationPauseAuthoritySql('pause')}
       LIMIT 1`,
      [requestId],
    );
    return result.rows[0]
      ? confirmationPauseSnapshotFromStorageRow(result.rows[0])
      : undefined;
  }

  async getConfirmationPauseStorageSnapshot(
    requestId: string,
  ): Promise<ConfirmationPauseStorageSnapshot | undefined> {
    return this.confirmationPauseSnapshot(requestId);
  }

  async getConfirmationPause(
    requestId: string,
  ): Promise<ConfirmationPauseRecord | undefined> {
    return (await this.confirmationPauseSnapshot(requestId))?.record;
  }

  async claimConfirmationRejection(
    value: ClaimConfirmationRejectionInput,
  ): Promise<ClaimConfirmationRejectionResult> {
    const input = await parseClaimConfirmationRejectionInput(value);
    const existing = await this.confirmationPauseSnapshot(input.requestId);
    if (!existing) return { status: 'not_found' };
    if (existing.record.status === 'expired') return { status: 'expired' };
    if (existing.record.status === 'rejected') {
      return rejectionClaimReplays(existing.record, input)
        ? { status: 'replay', record: existing.record }
        : { status: 'conflict' };
    }
    if (
      !(await confirmationRejectionAuthorityMatches(existing.record, input))
    ) {
      return { status: 'conflict' };
    }
    if (
      Date.parse(existing.record.expiresAt) <= Date.parse(input.rejectedAt)
    ) {
      const expired = await this.db.query<ConfirmationPauseStorageRow>(
        `UPDATE confirmation_pauses
         SET status = 'expired'
         WHERE request_id = $1
           AND status = 'pending'
           AND expires_at <= $2
           AND checkpoint_thread_id = $3
           AND checkpoint_namespace = $4
           AND checkpoint_id = $5
           AND created_at = $6
           AND expires_at = $7
           AND action_digest = $8
           AND approval_binding_digest = $9
           AND session_id = $10
           AND customer_id = $11
           AND channel = $12
           AND authenticated_subject = $13
           AND authentication_evidence_ref = $14
           AND session_generation = $15
           AND pause_identity_digest = $16
         AND EXISTS (
           SELECT 1
           FROM confirmation_pause_sessions AS session
           WHERE session.session_id = confirmation_pauses.session_id
             AND session.generation =
               confirmation_pauses.session_generation
         )
         AND ${currentConfirmationPauseAuthoritySql(
           'confirmation_pauses',
         )}
         RETURNING *`,
        [
          input.requestId,
          input.rejectedAt,
          existing.record.sourceTurnId,
          existing.record.actionScope,
          existing.record.actionId,
          existing.record.createdAt,
          existing.record.expiresAt,
          existing.record.actionDigest,
          existing.record.approvalBindingDigest,
          existing.record.sessionId,
          existing.record.customerId,
          existing.record.channel,
          commerceApprovalPrincipalStorageSubject(
            existing.record.principal,
          ),
          commerceApprovalPrincipalStorageEvidenceRef(
            existing.record.principal,
          ),
          existing.sessionGeneration,
          existing.identityDigest,
        ],
      );
      if (expired.rows[0]) {
        const claimedExpiry = await confirmationPauseSnapshotFromStorageRow(
          expired.rows[0],
        );
        return confirmationPauseSnapshotsMatch(claimedExpiry, existing) &&
          claimedExpiry.record.status === 'expired'
          ? { status: 'expired' }
          : { status: 'conflict' };
      }
      const current = await this.confirmationPauseSnapshot(input.requestId);
      if (!current) return { status: 'not_found' };
      if (!confirmationPauseSnapshotsMatch(current, existing)) {
        return { status: 'conflict' };
      }
      if (current.record.status === 'expired') return { status: 'expired' };
      return current.record.status === 'rejected' &&
        rejectionClaimReplays(current.record, input)
        ? { status: 'replay', record: current.record }
        : { status: 'conflict' };
    }
    if (!(await confirmationRejectionMatches(existing.record, input))) {
      return { status: 'conflict' };
    }
    const result = await this.db.query<ConfirmationPauseStorageRow>(
      `UPDATE confirmation_pauses
       SET status = 'rejected',
           rejection_receipt_id = $2,
           rejection_receipt_json = $3,
           rejected_at = $4
       WHERE request_id = $1
         AND status = 'pending'
         AND expires_at > $4
         AND action_digest = $5
         AND approval_binding_digest = $6
         AND session_id = $7
         AND customer_id = $8
         AND channel = $9
         AND authenticated_subject = $10
         AND authentication_evidence_ref = $11
         AND checkpoint_thread_id = $12
         AND checkpoint_namespace = $13
         AND checkpoint_id = $14
         AND created_at = $15
         AND expires_at = $16
         AND session_generation = $17
         AND pause_identity_digest = $18
       AND EXISTS (
         SELECT 1
         FROM confirmation_pause_sessions AS session
         WHERE session.session_id = confirmation_pauses.session_id
           AND session.generation = confirmation_pauses.session_generation
       )
       AND ${currentConfirmationPauseAuthoritySql(
         'confirmation_pauses',
       )}
       RETURNING *`,
      [
        input.requestId,
        input.receipt.receiptId,
        JSON.stringify(input.receipt),
        input.rejectedAt,
        input.actionDigest,
        input.approvalBindingDigest,
        input.principal.sessionId,
        input.principal.customerId,
        input.principal.channel,
        commerceApprovalPrincipalStorageSubject(input.principal),
        commerceApprovalPrincipalStorageEvidenceRef(input.principal),
        existing.record.sourceTurnId,
        existing.record.actionScope,
        existing.record.actionId,
        existing.record.createdAt,
        existing.record.expiresAt,
        existing.sessionGeneration,
        existing.identityDigest,
      ],
    );
    if (result.rows[0]) {
      const claimed = await confirmationPauseSnapshotFromStorageRow(
        result.rows[0],
      );
      if (
        !confirmationPauseSnapshotsMatch(claimed, existing) ||
        claimed.record.status !== 'rejected' ||
        !rejectionClaimReplays(claimed.record, input)
      ) {
        return { status: 'conflict' };
      }
      return {
        status: 'claimed',
        record: claimed.record,
      };
    }
    const current = await this.confirmationPauseSnapshot(input.requestId);
    if (!current) return { status: 'not_found' };
    if (!confirmationPauseSnapshotsMatch(current, existing)) {
      return { status: 'conflict' };
    }
    if (current.record.status === 'expired') return { status: 'expired' };
    return current.record.status === 'rejected' &&
      rejectionClaimReplays(current.record, input)
      ? { status: 'replay', record: current.record }
      : { status: 'conflict' };
  }

  async completeConfirmationResume(
    value: CompleteConfirmationResumeInput,
  ): Promise<CompleteConfirmationResumeResult> {
    const input = parseCompleteConfirmationResumeInput(value);
    const existing = await this.confirmationPauseSnapshot(input.requestId);
    if (!existing) return { status: 'lost' };
    if (
      existing.record.status !== 'rejected' ||
      existing.record.rejectionReceipt?.receiptId !== input.receiptId ||
      !existing.record.rejectedAt ||
      Date.parse(input.completedAt) < Date.parse(existing.record.rejectedAt)
    ) {
      return { status: 'conflict' };
    }
    if (existing.record.completionStatus !== 'pending') {
      return completionMatches(existing.record, input)
        ? { status: 'replay', record: existing.record }
        : { status: 'conflict' };
    }
    const completionStatus = input.completion.status;
    const resultJson =
      completionStatus === 'completed'
        ? JSON.stringify(input.completion.result)
        : null;
    const completionError =
      completionStatus === 'failed' ? input.completion.error : null;
    const result = await this.db.query<ConfirmationPauseStorageRow>(
      `UPDATE confirmation_pauses
       SET completion_status = $2,
           result_json = $3,
           completion_error = $4,
           completed_at = $5
       WHERE request_id = $1
         AND status = 'rejected'
         AND completion_status = 'pending'
         AND rejection_receipt_id = $6
         AND checkpoint_thread_id = $7
         AND checkpoint_namespace = $8
         AND checkpoint_id = $9
         AND created_at = $10
         AND expires_at = $11
         AND action_digest = $12
         AND approval_binding_digest = $13
         AND session_id = $14
         AND customer_id = $15
         AND channel = $16
         AND authenticated_subject = $17
         AND authentication_evidence_ref = $18
         AND session_generation = $19
         AND pause_identity_digest = $20
       AND EXISTS (
         SELECT 1
         FROM confirmation_pause_sessions AS session
         WHERE session.session_id = confirmation_pauses.session_id
           AND session.generation = confirmation_pauses.session_generation
       )
       AND ${currentConfirmationPauseAuthoritySql(
         'confirmation_pauses',
       )}
       RETURNING *`,
      [
        input.requestId,
        completionStatus,
        resultJson,
        completionError,
        input.completedAt,
        input.receiptId,
        existing.record.sourceTurnId,
        existing.record.actionScope,
        existing.record.actionId,
        existing.record.createdAt,
        existing.record.expiresAt,
        existing.record.actionDigest,
        existing.record.approvalBindingDigest,
        existing.record.sessionId,
        existing.record.customerId,
        existing.record.channel,
        commerceApprovalPrincipalStorageSubject(
          existing.record.principal,
        ),
        commerceApprovalPrincipalStorageEvidenceRef(
          existing.record.principal,
        ),
        existing.sessionGeneration,
        existing.identityDigest,
      ],
    );
    if (result.rows[0]) {
      const completed = await confirmationPauseSnapshotFromStorageRow(
        result.rows[0],
      );
      if (
        !confirmationPauseSnapshotsMatch(completed, existing) ||
        !completionMatches(completed.record, input)
      ) {
        return { status: 'conflict' };
      }
      return {
        status: 'completed',
        record: completed.record,
      };
    }
    const current = await this.confirmationPauseSnapshot(input.requestId);
    if (!current) return { status: 'lost' };
    if (!confirmationPauseSnapshotsMatch(current, existing)) {
      return { status: 'conflict' };
    }
    return completionMatches(current.record, input)
      ? { status: 'replay', record: current.record }
      : { status: 'conflict' };
  }

  async findConfirmationPause(
    requestId: string,
  ): Promise<ConfirmationPauseRecord | undefined> {
    return this.getConfirmationPause(requestId);
  }

  async searchHistory(sessionId: string, query: string): Promise<HistorySearchResult[]> {
    const sessionEvents = await this.listEvents(sessionId);
    const lower = query.toLowerCase();
    return sessionEvents
      .filter((event) => typeof event.payload.text === 'string')
      .map((event) => {
        const text = String(event.payload.text).toLowerCase();
        const directHit = text.includes(lower);
        return { ...event, confidence: directHit ? 0.7 : 0 };
      })
      .filter((event) => event.confidence > 0)
      .sort((a, b) => b.confidence - a.confidence);
  }

  async appendDashboardEvent(event: DashboardEvent): Promise<void> {
    await this.db.query(
      `
        INSERT INTO dashboard_events (id, session_id, type, payload, created_at)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (id) DO NOTHING
      `,
      [event.id, event.sessionId, event.type, JSON.stringify(event.payload), event.createdAt],
    );
  }

  async listDashboardEvents(): Promise<DashboardEvent[]> {
    const result = await this.db.query<DashboardEventRow>(`
      SELECT *
      FROM dashboard_events
      ORDER BY event_sequence ASC, created_at ASC, id ASC
    `);
    return result.rows.map(dashboardEventFromRow);
  }

}
