import type {
  AgentMode,
  ConversationProfile,
  DashboardEvent,
  ConversationTurn,
  MonitorSessionIntelligence,
} from "../domain/types.js";
import {
  parseMonitorSessionIntelligencePayload,
  preserveMonitorContext,
} from "../monitor/sessionIntelligence.js";
import {
  commerceApprovalPrincipalStorageEvidenceRef,
  commerceApprovalPrincipalStorageSubject,
} from '../ordering/commerceApprovalPrincipal.js';
import type {
  AgentRun,
  AgentRunTurn,
  PendingCustomerTurn,
  SessionAgentState,
} from "../domain/types.js";
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
} from "./memoryStore.js";
import {
  completionMatches,
  confirmationPauseIdentityDigest,
  confirmationPauseSnapshotFromStorageRow,
  confirmationPauseSnapshotsMatch,
  confirmationPauseStorageValues,
  currentConfirmationPauseAuthoritySql,
  confirmationRejectionAuthorityMatches,
  confirmationRejectionMatches,
  immutableConfirmationPauseMatches,
  parseClaimConfirmationRejectionInput,
  parseCompleteConfirmationResumeInput,
  parseCreateConfirmationPauseShape,
  parseCreateConfirmationPauseInput,
  pendingConfirmationPause,
  rejectionClaimReplays,
  type ConfirmationPauseStorageRow,
  type ConfirmationPauseStorageSnapshot,
} from './confirmationPause.js';
import {
  d1ActiveSessionAuthoritySource,
} from './d1StoreSessionAuthority.js';
import {
  CustomerRunIdempotencyConflictError,
  CustomerRunSequenceConflictError,
  customerRunEventSchema,
  type CustomerRun,
  type CustomerRunEvent,
} from "../customerRuns/contracts.js";
import {
  D1Result,
  D1PreparedStatement,
  D1DatabaseLike,
  ConversationTurnRow,
  ConversationProfileRow,
  StoredEventRow,
  IrreversibleOperationRow,
  DashboardEventRow,
  DashboardSessionSummary,
  WebhookDeliveryRow,
  SessionControlRow,
  PendingCustomerTurnRow,
  AgentRunRow,
  AgentRunTurnRow,
  CustomerRunRow,
  CustomerRunEventRow,
  D1TableInfoRow,
  schemaStatements,
  parsePayload,
  turnFromRow,
  parseNullablePayload,
  profileFromRow,
  storedEventFromRow,
  dashboardEventFromRow,
  webhookDeliveryFromRow,
  sessionControlFromRow,
  customerRunFromRow,
  customerRunEventFromRow,
  defaultSessionControl,
  pendingCustomerTurnFromRow,
  agentRunFromRow,
  agentRunTurnFromRow
} from './d1StoreSupport.js';
import { reserveD1ConfirmationResumeOperation } from './d1StoreConfirmationResumeOperations.js';
import { appendD1EventIfRunCurrent } from './d1StoreRunCommit.js';
import {
  advanceD1SessionAgentGeneration,
  claimD1AgentRunExecution,
  claimD1SessionAgentRunOwnership,
  getD1SessionAgentState,
  listDueD1SessionAgentStates,
  setD1SessionAgentState,
  updateD1AgentRunIfExecutionCurrent,
} from './d1StoreAgentRunOwnership.js';

import { D1StoreConversationOperations } from './d1StoreConversationOperations.js';
import {
  claimD1AgentRun,
  createD1AgentRun,
} from './d1StoreAgentRunCreation.js';

export class D1StoreAgentOperations extends D1StoreConversationOperations {
  async createAgentRun(input: CreateAgentRunInput): Promise<AgentRun> {
    return createD1AgentRun({ db: this.db, operation: input });
  }

  async claimAgentRun(input: CreateAgentRunInput): Promise<ClaimAgentRunResult> {
    return claimD1AgentRun({ db: this.db, operation: input });
  }

  async updateAgentRun(runId: string, patch: AgentRunPatch): Promise<AgentRun> {
    const existing = await this.getAgentRun(runId);
    if (!existing) throw new Error(`Agent run not found: ${runId}`);
    const updated: AgentRun = {
      ...existing,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    await this.db
      .prepare(
        `UPDATE agent_runs
         SET status = ?,
             superseded_by_run_id = ?,
             irreversible_side_effect_at = ?,
             irreversible_tool_name = ?,
             assistant_turn_id = ?,
             delivery_status = ?,
             delivery_external_message_id = ?,
             error_code = ?,
             error_message = ?,
             started_at = ?,
             completed_at = ?,
             updated_at = ?
         WHERE id = ?`,
      )
      .bind(
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
        runId,
      )
      .run();
    return updated;
  }

  async getAgentRun(runId: string): Promise<AgentRun | undefined> {
    const row = await this.db
      .prepare(`SELECT * FROM agent_runs WHERE id = ? LIMIT 1`)
      .bind(runId)
      .first<AgentRunRow>();
    return row ? agentRunFromRow(row) : undefined;
  }

  async listAgentRuns(sessionId: string): Promise<AgentRun[]> {
    const rows = await this.db
      .prepare(
        `SELECT * FROM agent_runs WHERE session_id = ? ORDER BY generation ASC, id ASC`,
      )
      .bind(sessionId)
      .all<AgentRunRow>();
    return (rows.results ?? []).map(agentRunFromRow);
  }

  async linkAgentRunTurn(input: AgentRunTurn): Promise<AgentRunTurn> {
    await this.db
      .prepare(
        `INSERT OR IGNORE INTO agent_run_turns (run_id, turn_id, sequence) VALUES (?, ?, ?)`,
      )
      .bind(input.runId, input.turnId, input.sequence)
      .run();
    return input;
  }

  async listAgentRunTurns(runId: string): Promise<AgentRunTurn[]> {
    const rows = await this.db
      .prepare(
        `SELECT * FROM agent_run_turns WHERE run_id = ? ORDER BY sequence ASC, turn_id ASC`,
      )
      .bind(runId)
      .all<AgentRunTurnRow>();
    return (rows.results ?? []).map(agentRunTurnFromRow);
  }

  async getSessionAgentState(sessionId: string): Promise<SessionAgentState> {
    return getD1SessionAgentState(this.db, sessionId);
  }

  async setSessionAgentState(
    input: SessionAgentStateInput,
  ): Promise<SessionAgentState> {
    return setD1SessionAgentState(this.db, input);
  }

  async advanceSessionAgentGeneration(
    input: AdvanceSessionAgentGenerationInput,
  ): Promise<AdvanceSessionAgentGenerationResult> {
    return advanceD1SessionAgentGeneration({ db: this.db, operation: input });
  }

  async claimSessionAgentRunOwnership(
    input: ClaimSessionAgentRunOwnershipInput,
  ): Promise<ClaimSessionAgentRunOwnershipResult> {
    return claimD1SessionAgentRunOwnership({ db: this.db, operation: input });
  }

  async claimAgentRunExecution(
    input: ClaimAgentRunExecutionInput,
  ): Promise<ClaimAgentRunExecutionResult> {
    return claimD1AgentRunExecution({ db: this.db, operation: input });
  }

  async updateAgentRunIfExecutionCurrent(
    input: UpdateAgentRunIfExecutionCurrentInput,
  ): Promise<UpdateAgentRunIfExecutionCurrentResult> {
    return updateD1AgentRunIfExecutionCurrent({
      db: this.db,
      operation: input,
    });
  }

  async listDueSessionAgentStates(
    now: string,
    limit: number,
  ): Promise<SessionAgentState[]> {
    return listDueD1SessionAgentStates(this.db, now, limit);
  }

  async listTurns(sessionId: string): Promise<ConversationTurn[]> {
    const rows = await this.db
      .prepare(
        `SELECT * FROM conversation_turns WHERE session_id = ? ORDER BY created_at ASC, id ASC`,
      )
      .bind(sessionId)
      .all<ConversationTurnRow>();
    return (rows.results ?? []).map(turnFromRow);
  }

  async listRecentTurns(
    sessionId: string,
    limit: number,
  ): Promise<ConversationTurn[]> {
    const rows = await this.db
      .prepare(
        `SELECT * FROM conversation_turns WHERE session_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
      )
      .bind(sessionId, limit)
      .all<ConversationTurnRow>();
    return (rows.results ?? []).map(turnFromRow).reverse();
  }

  async appendEvent(
    sessionId: string,
    sourceType: string,
    payload: Record<string, unknown>,
  ): Promise<StoredEvent> {
    const event: StoredEvent = {
      id: `event_${crypto.randomUUID()}`,
      sessionId,
      sourceType,
      payload,
      createdAt: new Date().toISOString(),
    };
    await this.db
      .prepare(
        `INSERT INTO conversation_events (id, session_id, source_type, payload, created_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(
        event.id,
        event.sessionId,
        event.sourceType,
        JSON.stringify(event.payload),
        event.createdAt,
      )
      .run();
    return event;
  }

  async appendEventIfRunCurrent(
    input: AppendEventIfRunCurrentInput,
  ): Promise<AppendEventIfRunCurrentResult> {
    return appendD1EventIfRunCurrent({
      db: this.db,
      operation: input,
    });
  }

  async listEvents(sessionId: string): Promise<StoredEvent[]> {
    const rows = await this.db
      .prepare(
        `SELECT * FROM conversation_events WHERE session_id = ? ORDER BY created_at ASC, id ASC`,
      )
      .bind(sessionId)
      .all<StoredEventRow>();
    return (rows.results ?? []).map(storedEventFromRow);
  }

  async reserveConfirmationResumeOperation(
    input: ReserveConfirmationResumeOperationInput,
  ): Promise<ReserveConfirmationResumeOperationResult> {
    return reserveD1ConfirmationResumeOperation(this.db, input);
  }

  async createConfirmationPause(
    value: CreateConfirmationPauseInput,
  ): Promise<CreateConfirmationPauseResult> {
    const shape = parseCreateConfirmationPauseShape(value);
    const generationRow = await this.db.prepare(
      `INSERT INTO confirmation_pause_sessions (session_id, generation)
       VALUES (?, 0)
       ON CONFLICT(session_id) DO UPDATE SET
         generation = confirmation_pause_sessions.generation
       RETURNING generation`,
    ).bind(shape.sessionId).first<{ generation: number }>();
    if (!generationRow) {
      throw new Error('confirmation_pause_generation_missing');
    }
    const sessionGeneration = generationRow.generation;
    const capturedControl = await this.getSessionControl(shape.sessionId);
    if (capturedControl.agentMode !== 'ai_active') {
      return { status: 'conflict' };
    }
    const input = await parseCreateConfirmationPauseInput(shape);
    const record = pendingConfirmationPause(input);
    const identityDigest = await confirmationPauseIdentityDigest(input);
    const values = confirmationPauseStorageValues(
      record,
      sessionGeneration,
      0,
      identityDigest,
    );
    const valuesWithoutAuthority = [
      ...values.slice(0, 7),
      ...values.slice(8),
    ];
    const result = await this.db.prepare(
      `INSERT OR IGNORE INTO confirmation_pauses (
        schema_version, request_id, checkpoint_thread_id, checkpoint_namespace,
        checkpoint_id, session_id, session_generation,
        session_authority_generation, pause_identity_digest,
        customer_id, channel, action_json, action_digest,
        approval_binding_json, approval_binding_digest, principal_json,
        authenticated_subject, authentication_evidence_ref, created_at,
        expires_at, status, rejection_receipt_id, rejection_receipt_json,
        rejected_at, completion_status, result_json, completion_error,
        completed_at
      )
      SELECT ?, ?, ?, ?, ?, ?, ?,
             authority.session_authority_generation,
             ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      FROM confirmation_pause_sessions AS pause_session,
           (${d1ActiveSessionAuthoritySource}) AS authority
      WHERE pause_session.session_id = ?
        AND pause_session.generation = ?
        AND authority.session_authority_generation = ?`,
    ).bind(
      ...valuesWithoutAuthority,
      input.sessionId,
      input.sessionId,
      sessionGeneration,
      capturedControl.sessionAuthorityGeneration,
    ).run();
    if (Number(result.meta.changes ?? 0) > 0) {
      return { status: 'created', record };
    }
    const existing = await this.confirmationPauseSnapshot(input.requestId);
    if (!existing) return { status: 'conflict' };
    return (
      existing.sessionGeneration === sessionGeneration &&
      existing.sessionAuthorityGeneration >= 0 &&
      existing.identityDigest === identityDigest &&
      immutableConfirmationPauseMatches(existing.record, input)
    )
      ? { status: 'replay', record: existing.record }
      : { status: 'conflict' };
  }

  private async confirmationPauseSnapshot(
    requestId: string,
  ): Promise<ConfirmationPauseStorageSnapshot | undefined> {
    const row = await this.db.prepare(
      `SELECT pause.*
       FROM confirmation_pauses AS pause
       JOIN confirmation_pause_sessions AS session
         ON session.session_id = pause.session_id
        AND session.generation = pause.session_generation
       WHERE pause.request_id = ?
         AND ${currentConfirmationPauseAuthoritySql('pause')}
       LIMIT 1`,
    ).bind(requestId).first<ConfirmationPauseStorageRow>();
    return row ? confirmationPauseSnapshotFromStorageRow(row) : undefined;
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
      const result = await this.db.prepare(
        `UPDATE confirmation_pauses
         SET status = 'expired'
         WHERE request_id = ?
           AND status = 'pending'
           AND expires_at <= ?
           AND checkpoint_thread_id = ?
           AND checkpoint_namespace = ?
           AND checkpoint_id = ?
           AND created_at = ?
           AND expires_at = ?
           AND action_digest = ?
           AND approval_binding_digest = ?
           AND session_id = ?
           AND customer_id = ?
           AND channel = ?
           AND authenticated_subject = ?
           AND authentication_evidence_ref = ?
           AND session_generation = ?
           AND pause_identity_digest = ?
           AND EXISTS (
             SELECT 1
             FROM confirmation_pause_sessions AS session
             WHERE session.session_id = confirmation_pauses.session_id
               AND session.generation =
                 confirmation_pauses.session_generation
           )
           AND ${currentConfirmationPauseAuthoritySql(
             'confirmation_pauses',
           )}`,
      ).bind(
        input.requestId,
        input.rejectedAt,
        existing.record.checkpointThreadId,
        existing.record.checkpointNamespace,
        existing.record.checkpointId,
        existing.record.createdAt,
        existing.record.expiresAt,
        existing.record.actionDigest,
        existing.record.approvalBindingDigest,
        existing.record.sessionId,
        existing.record.customerId,
        existing.record.channel,
        commerceApprovalPrincipalStorageSubject(existing.record.principal),
        commerceApprovalPrincipalStorageEvidenceRef(
          existing.record.principal,
        ),
        existing.sessionGeneration,
        existing.identityDigest,
      ).run();
      const expired = await this.confirmationPauseSnapshot(input.requestId);
      if (!expired) return { status: 'not_found' };
      if (!confirmationPauseSnapshotsMatch(expired, existing)) {
        return { status: 'conflict' };
      }
      if (
        Number(result.meta.changes ?? 0) > 0 &&
        expired.record.status === 'expired'
      ) {
        return { status: 'expired' };
      }
      if (expired.record.status === 'expired') return { status: 'expired' };
      return expired.record.status === 'rejected' &&
        rejectionClaimReplays(expired.record, input)
        ? { status: 'replay', record: expired.record }
        : { status: 'conflict' };
    }
    if (!(await confirmationRejectionMatches(existing.record, input))) {
      return { status: 'conflict' };
    }
    const result = await this.db.prepare(
      `UPDATE confirmation_pauses
       SET status = 'rejected',
           rejection_receipt_id = ?,
           rejection_receipt_json = ?,
           rejected_at = ?
       WHERE request_id = ?
         AND status = 'pending'
         AND expires_at > ?
         AND action_digest = ?
         AND approval_binding_digest = ?
         AND session_id = ?
         AND customer_id = ?
         AND channel = ?
         AND authenticated_subject = ?
         AND authentication_evidence_ref = ?
         AND checkpoint_thread_id = ?
         AND checkpoint_namespace = ?
         AND checkpoint_id = ?
         AND created_at = ?
         AND expires_at = ?
         AND session_generation = ?
         AND pause_identity_digest = ?
         AND EXISTS (
           SELECT 1
           FROM confirmation_pause_sessions AS session
           WHERE session.session_id = confirmation_pauses.session_id
             AND session.generation = confirmation_pauses.session_generation
         )
         AND ${currentConfirmationPauseAuthoritySql(
           'confirmation_pauses',
         )}`,
    ).bind(
      input.receipt.receiptId,
      JSON.stringify(input.receipt),
      input.rejectedAt,
      input.requestId,
      input.rejectedAt,
      input.actionDigest,
      input.approvalBindingDigest,
      input.principal.sessionId,
      input.principal.customerId,
      input.principal.channel,
      commerceApprovalPrincipalStorageSubject(input.principal),
      commerceApprovalPrincipalStorageEvidenceRef(input.principal),
      existing.record.checkpointThreadId,
      existing.record.checkpointNamespace,
      existing.record.checkpointId,
      existing.record.createdAt,
      existing.record.expiresAt,
      existing.sessionGeneration,
      existing.identityDigest,
    ).run();
    const claimed = await this.confirmationPauseSnapshot(input.requestId);
    if (!claimed) return { status: 'not_found' };
    if (!confirmationPauseSnapshotsMatch(claimed, existing)) {
      return { status: 'conflict' };
    }
    if (
      Number(result.meta.changes ?? 0) > 0 &&
      claimed.record.status === 'rejected' &&
      rejectionClaimReplays(claimed.record, input)
    ) {
      return { status: 'claimed', record: claimed.record };
    }
    if (claimed.record.status === 'expired') return { status: 'expired' };
    return claimed.record.status === 'rejected' &&
      rejectionClaimReplays(claimed.record, input)
      ? { status: 'replay', record: claimed.record }
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
    const result = await this.db.prepare(
      `UPDATE confirmation_pauses
       SET completion_status = ?,
           result_json = ?,
           completion_error = ?,
           completed_at = ?
         WHERE request_id = ?
         AND status = 'rejected'
         AND completion_status = 'pending'
         AND rejection_receipt_id = ?
         AND checkpoint_thread_id = ?
         AND checkpoint_namespace = ?
         AND checkpoint_id = ?
         AND created_at = ?
         AND expires_at = ?
         AND action_digest = ?
         AND approval_binding_digest = ?
         AND session_id = ?
         AND customer_id = ?
         AND channel = ?
         AND authenticated_subject = ?
         AND authentication_evidence_ref = ?
         AND session_generation = ?
         AND pause_identity_digest = ?
         AND EXISTS (
           SELECT 1
           FROM confirmation_pause_sessions AS session
           WHERE session.session_id = confirmation_pauses.session_id
             AND session.generation = confirmation_pauses.session_generation
         )
         AND ${currentConfirmationPauseAuthoritySql(
           'confirmation_pauses',
         )}`,
    ).bind(
      completionStatus,
      resultJson,
      completionError,
      input.completedAt,
      input.requestId,
      input.receiptId,
      existing.record.checkpointThreadId,
      existing.record.checkpointNamespace,
      existing.record.checkpointId,
      existing.record.createdAt,
      existing.record.expiresAt,
      existing.record.actionDigest,
      existing.record.approvalBindingDigest,
      existing.record.sessionId,
      existing.record.customerId,
      existing.record.channel,
      commerceApprovalPrincipalStorageSubject(existing.record.principal),
      commerceApprovalPrincipalStorageEvidenceRef(
        existing.record.principal,
      ),
      existing.sessionGeneration,
      existing.identityDigest,
    ).run();
    const completed = await this.confirmationPauseSnapshot(input.requestId);
    if (!completed) return { status: 'lost' };
    if (!confirmationPauseSnapshotsMatch(completed, existing)) {
      return { status: 'conflict' };
    }
    if (
      Number(result.meta.changes ?? 0) > 0 &&
      completionMatches(completed.record, input)
    ) {
      return { status: 'completed', record: completed.record };
    }
    return completionMatches(completed.record, input)
      ? { status: 'replay', record: completed.record }
      : { status: 'conflict' };
  }

  async findConfirmationPause(
    requestId: string,
  ): Promise<ConfirmationPauseRecord | undefined> {
    return this.getConfirmationPause(requestId);
  }

  async searchHistory(
    sessionId: string,
    query: string,
  ): Promise<HistorySearchResult[]> {
    const sessionEvents = await this.listEvents(sessionId);
    const lower = query.toLowerCase();
    return sessionEvents
      .filter((event) => typeof event.payload.text === "string")
      .map((event) => {
        const text = String(event.payload.text).toLowerCase();
        const directHit = text.includes(lower);
        return { ...event, confidence: directHit ? 0.7 : 0 };
      })
      .filter((event) => event.confidence > 0)
      .sort((a, b) => b.confidence - a.confidence);
  }

  async appendDashboardEvent(event: DashboardEvent): Promise<void> {
    await this.db
      .prepare(
        `INSERT OR IGNORE INTO dashboard_events (id, session_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(
        event.id,
        event.sessionId,
        event.type,
        JSON.stringify(event.payload),
        event.createdAt,
      )
      .run();
  }

  async listDashboardEvents(
    sessionId?: string,
    limit = 200,
  ): Promise<DashboardEvent[]> {
    if (sessionId) {
      const rows = await this.db
        .prepare(
          `SELECT * FROM dashboard_events WHERE session_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
        )
        .bind(sessionId, limit)
        .all<DashboardEventRow>();
      return (rows.results ?? []).map(dashboardEventFromRow).reverse();
    }
    const rows = await this.db
      .prepare(`SELECT * FROM dashboard_events ORDER BY created_at ASC, id ASC`)
      .all<DashboardEventRow>();
    return (rows.results ?? []).map(dashboardEventFromRow);
  }

  async listDashboardSessionSummaries(
    limit = 50,
    eventScanLimit = 500,
  ): Promise<DashboardSessionSummary[]> {
    const rows = await this.db
      .prepare(
        `SELECT id, session_id, type, payload, created_at
         FROM dashboard_events
         ORDER BY created_at DESC, id DESC
         LIMIT ?`,
      )
      .bind(eventScanLimit)
      .all<DashboardEventRow>();
    const summaries = new Map<string, DashboardSessionSummary>();
    for (const event of rows.results ?? []) {
      const existing = summaries.get(event.session_id);
      if (event.type === "session_intelligence_updated") {
        const sessionIntelligence = parseMonitorSessionIntelligencePayload(
          JSON.parse(event.payload) as Record<string, unknown>,
        );
        summaries.set(event.session_id, {
          sessionId: event.session_id,
          latestEventType: existing?.latestEventType ?? event.type,
          updatedAt: existing?.updatedAt ?? event.created_at,
          sessionIntelligence:
            existing?.sessionIntelligence && sessionIntelligence
              ? preserveMonitorContext(
                  existing.sessionIntelligence,
                  sessionIntelligence,
                )
              : existing?.sessionIntelligence ?? sessionIntelligence ?? null,
        });
      } else if (!existing) {
        summaries.set(event.session_id, {
          sessionId: event.session_id,
          latestEventType: event.type,
          updatedAt: event.created_at,
          sessionIntelligence: null,
        });
      } else if (existing.latestEventType === "session_intelligence_updated") {
        summaries.set(event.session_id, {
          ...existing,
          latestEventType: event.type,
        });
      }
      if (summaries.size >= limit) break;
    }
    return [...summaries.values()];
  }

}
