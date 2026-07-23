import type {
  AgentMode,
  ConversationProfile,
  DashboardEvent,
  ConversationTurn,
  MonitorSessionIntelligence,
} from '../domain/types.js';
import {
  parseMonitorSessionIntelligencePayload,
  preserveMonitorContext,
} from '../monitor/sessionIntelligence.js';
import type {
  AgentRun,
  AgentRunTurn,
  PendingCustomerTurn,
  SessionAgentState,
} from '../domain/types.js';
import type {
  AgentRunPatch,
  AppendConversationTurnInput,
  CommitAssistantTurnIfRunCurrentInput,
  CommitAssistantTurnIfRunCurrentResult,
  CommitAssistantTurnInput,
  CommitAssistantTurnResult,
  ConversationStore,
  CreateAgentRunInput,
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
  TransitionSessionAuthorityInput,
  TransitionSessionAuthorityResult,
  SessionResetHook,
  SessionAgentStateInput,
  StoredEvent,
  UpsertPendingCustomerTurnResult,
  WebhookDelivery,
  WebhookDeliveryChannel,
  AppendCustomerRunEventInput,
  CustomerRunPatch,
  ConversationSummary,
  CompareAndSwapConversationSummaryInput,
  CompareAndSwapConversationSummaryResult,
} from './memoryStore.js';
import type { PackRef, PackStateEnvelope } from '../runtime/businessPack.js';
import type {
  BeginNonAgentTextDeliveryAttemptInput,
  BeginNonAgentTextDeliveryAttemptResult,
  CompleteNonAgentTextDeliveryAttemptInput,
  CompleteNonAgentTextDeliveryAttemptResult,
  NonAgentTextDeliveryRecord,
  PrepareNonAgentTextDeliveryTurnInput,
  PrepareNonAgentTextDeliveryTurnResult,
  ReconcileNonAgentTextDeliveryInput,
  ReconcileNonAgentTextDeliveryResult,
  ReserveNonAgentTextDeliveryInput,
  ReserveNonAgentTextDeliveryResult,
} from './contracts.js';
import {
  CustomerRunIdempotencyConflictError,
  CustomerRunSequenceConflictError,
  customerRunEventSchema,
  type CustomerRun,
  type CustomerRunEvent,
} from '../customerRuns/contracts.js';
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
  SessionAgentStateRow,
  CustomerRunRow,
  CustomerRunEventRow,
  D1TableInfoRow,
  ConversationSummaryRow,
  PackStateRow,
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
  agentRunTurnFromRow,
  sessionAgentStateFromRow,
  defaultSessionAgentState,
} from './d1StoreSupport.js';

import { D1StoreCore } from './d1StoreCore.js';
import { transitionD1SessionAuthority } from './d1StoreSessionAuthority.js';
import {
  commitD1AssistantTurn,
  commitD1AssistantTurnIfRunCurrent,
} from './d1StoreTurnCommit.js';
import {
  beginD1NonAgentTextDeliveryAttempt,
  completeD1NonAgentTextDeliveryAttempt,
  getD1NonAgentTextDelivery,
  prepareD1NonAgentTextDeliveryTurn,
  reconcileD1NonAgentTextDelivery,
  reserveD1NonAgentTextDelivery,
} from './d1StoreNonAgentTextDelivery.js';
import { resetD1Session } from './d1StoreSessionReset.js';

export abstract class D1StoreConversationOperations extends D1StoreCore {
  abstract appendEvent(
    sessionId: string,
    sourceType: string,
    payload: Record<string, unknown>,
  ): Promise<StoredEvent>;
  async commitAssistantTurnIfRunCurrent(
    input: CommitAssistantTurnIfRunCurrentInput,
  ): Promise<CommitAssistantTurnIfRunCurrentResult> {
    return commitD1AssistantTurnIfRunCurrent({
      db: this.db,
      operation: input,
    });
  }
  async commitAssistantTurn(
    input: CommitAssistantTurnInput,
  ): Promise<CommitAssistantTurnResult> {
    return commitD1AssistantTurn({ db: this.db, operation: input });
  }
  async upsertProfile(
    input: ConversationProfile,
  ): Promise<ConversationProfile> {
    await this.db
      .prepare(
        `INSERT INTO conversation_profiles (
          channel, external_user_id, display_name, avatar_url, profile_source, profile_updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(channel, external_user_id) DO UPDATE SET
          display_name = excluded.display_name,
          avatar_url = excluded.avatar_url,
          profile_source = excluded.profile_source,
          profile_updated_at = excluded.profile_updated_at`,
      )
      .bind(
        input.channel,
        input.externalUserId,
        input.displayName,
        input.avatarUrl,
        input.profileSource,
        input.profileUpdatedAt,
      )
      .run();
    return input;
  }

  async getProfile(
    channel: ConversationProfile['channel'],
    externalUserId: string,
  ): Promise<ConversationProfile | undefined> {
    const row = await this.db
      .prepare(
        `SELECT * FROM conversation_profiles WHERE channel = ? AND external_user_id = ? LIMIT 1`,
      )
      .bind(channel, externalUserId)
      .first<ConversationProfileRow>();
    return row ? profileFromRow(row) : undefined;
  }

  async listProfiles(limit = 200): Promise<ConversationProfile[]> {
    const rows = await this.db
      .prepare(
        `SELECT * FROM conversation_profiles ORDER BY profile_updated_at DESC LIMIT ?`,
      )
      .bind(limit)
      .all<ConversationProfileRow>();
    return (rows.results ?? []).map(profileFromRow);
  }

  async appendTurn(
    input: AppendConversationTurnInput,
  ): Promise<ConversationTurn> {
    if (input.id) {
      const row = await this.db
        .prepare(`SELECT * FROM conversation_turns WHERE id = ? LIMIT 1`)
        .bind(input.id)
        .first<ConversationTurnRow>();
      if (row) return turnFromRow(row);
    }
    const existing =
      input.externalMessageId === null
        ? undefined
        : await this.findTurnByExternalMessage(
            input.sessionId,
            input.externalMessageId,
          );
    if (existing) return existing;

    const turnId = input.id ?? `turn_${crypto.randomUUID()}`;
    const createdAt = input.createdAt ?? new Date().toISOString();
    await this.db
      .prepare(
        `INSERT INTO conversation_turns (
          id, session_id, ordinal, channel, role, text, external_message_id,
          external_user_id, delivery_status, metadata, created_at
        )
        SELECT ?, ?, COALESCE(MAX(ordinal), 0) + 1, ?, ?, ?, ?, ?, ?, ?, ?
        FROM conversation_turns
        WHERE session_id = ?`,
      )
      .bind(
        turnId,
        input.sessionId,
        input.channel,
        input.role,
        input.text,
        input.externalMessageId,
        input.externalUserId,
        input.deliveryStatus,
        JSON.stringify(input.metadata ?? null),
        createdAt,
        input.sessionId,
      )
      .run();
    const row = await this.db
      .prepare(`SELECT * FROM conversation_turns WHERE id = ? LIMIT 1`)
      .bind(turnId)
      .first<ConversationTurnRow>();
    if (!row) throw new Error('conversation_turn_insert_failed');
    const turn = turnFromRow(row);
    await this.appendEvent(input.sessionId, `conversation_turn:${input.role}`, {
      text: input.text,
      channel: input.channel,
      deliveryStatus: input.deliveryStatus,
      externalMessageId: input.externalMessageId,
      externalUserId: input.externalUserId,
      metadata: input.metadata,
    });
    return turn;
  }

  async upsertImportedTurn(
    input: ImportedConversationTurn,
  ): Promise<ImportedConversationTurnResult> {
    const existing =
      input.externalMessageId === null
        ? undefined
        : await this.findTurnByExternalMessage(
            input.sessionId,
            input.externalMessageId,
          );
    if (existing) {
      await this.db
        .prepare(
          `UPDATE conversation_turns
           SET channel = ?, role = ?, text = ?, external_user_id = ?, delivery_status = ?, metadata = ?, created_at = ?
           WHERE id = ?`,
        )
        .bind(
          input.channel,
          input.role,
          input.text,
          input.externalUserId,
          input.deliveryStatus,
          JSON.stringify(input.metadata ?? null),
          input.createdAt,
          existing.id,
        )
        .run();
      return {
        turn: {
          ...existing,
          channel: input.channel,
          role: input.role,
          text: input.text,
          externalUserId: input.externalUserId,
          deliveryStatus: input.deliveryStatus,
          metadata: input.metadata ?? null,
          createdAt: input.createdAt,
        },
        inserted: false,
      };
    }

    const turnId = input.id ?? `turn_${crypto.randomUUID()}`;
    await this.db
      .prepare(
        `INSERT INTO conversation_turns (
          id, session_id, ordinal, channel, role, text, external_message_id,
          external_user_id, delivery_status, metadata, created_at
        )
        SELECT ?, ?, COALESCE(MAX(ordinal), 0) + 1, ?, ?, ?, ?, ?, ?, ?, ?
        FROM conversation_turns
        WHERE session_id = ?`,
      )
      .bind(
        turnId,
        input.sessionId,
        input.channel,
        input.role,
        input.text,
        input.externalMessageId,
        input.externalUserId,
        input.deliveryStatus,
        JSON.stringify(input.metadata ?? null),
        input.createdAt,
        input.sessionId,
      )
      .run();
    await this.appendEvent(input.sessionId, `conversation_turn:${input.role}`, {
      text: input.text,
      channel: input.channel,
      deliveryStatus: input.deliveryStatus,
      externalMessageId: input.externalMessageId,
      externalUserId: input.externalUserId,
      metadata: input.metadata,
    });
    const row = await this.db
      .prepare(`SELECT * FROM conversation_turns WHERE id = ? LIMIT 1`)
      .bind(turnId)
      .first<ConversationTurnRow>();
    if (!row) throw new Error('conversation_turn_import_failed');
    return { turn: turnFromRow(row), inserted: true };
  }

  async getConversationSummary(
    sessionId: string,
  ): Promise<ConversationSummary | undefined> {
    const row = await this.db
      .prepare(
        `SELECT * FROM conversation_summaries WHERE session_id = ? LIMIT 1`,
      )
      .bind(sessionId)
      .first<ConversationSummaryRow>();
    return row
      ? {
          schemaVersion: Number(row.schema_version) as 1,
          text: row.text,
          throughOrdinal: Number(row.through_ordinal),
          revision: Number(row.revision),
          updatedAt: row.updated_at,
        }
      : undefined;
  }

  async compareAndSwapConversationSummary(
    input: CompareAndSwapConversationSummaryInput,
  ): Promise<CompareAndSwapConversationSummaryResult> {
    const existing = await this.getConversationSummary(input.sessionId);
    if (
      existing &&
      existing.text === input.text &&
      existing.throughOrdinal === input.throughOrdinal
    ) {
      return { status: 'unchanged', summary: existing };
    }
    if (
      input.throughOrdinal <= input.expectedThroughOrdinal ||
      (input.expectedRevision === null && input.expectedThroughOrdinal !== 0)
    ) {
      return { status: 'stale', ...(existing ? { summary: existing } : {}) };
    }
    const result =
      input.expectedRevision === null
        ? await this.db
            .prepare(
              `INSERT OR IGNORE INTO conversation_summaries (
                 session_id, schema_version, text, through_ordinal, revision, updated_at
               ) VALUES (?, 1, ?, ?, 1, ?)`,
            )
            .bind(
              input.sessionId,
              input.text,
              input.throughOrdinal,
              input.updatedAt,
            )
            .run()
        : await this.db
            .prepare(
              `UPDATE conversation_summaries
               SET text = ?, through_ordinal = ?, revision = revision + 1,
                   updated_at = ?
               WHERE session_id = ? AND revision = ? AND through_ordinal = ?
                 AND ? > through_ordinal`,
            )
            .bind(
              input.text,
              input.throughOrdinal,
              input.updatedAt,
              input.sessionId,
              input.expectedRevision,
              input.expectedThroughOrdinal,
              input.throughOrdinal,
            )
            .run();
    const summary = await this.getConversationSummary(input.sessionId);
    if (Number(result.meta.changes ?? 0) === 1 && summary) {
      return { status: 'committed', summary };
    }
    return summary?.text === input.text &&
      summary.throughOrdinal === input.throughOrdinal
      ? { status: 'unchanged', summary }
      : { status: 'stale', ...(summary ? { summary } : {}) };
  }

  async getPackState(
    sessionId: string,
    packRef: PackRef,
  ): Promise<PackStateEnvelope | undefined> {
    const row = await this.db
      .prepare(
        `SELECT envelope_json FROM pack_state_projections
         WHERE session_id = ? AND pack_id = ? AND pack_version = ? LIMIT 1`,
      )
      .bind(sessionId, packRef.packId, packRef.version)
      .first<PackStateRow>();
    return row
      ? (JSON.parse(row.envelope_json) as PackStateEnvelope)
      : undefined;
  }

  async putPackState(
    sessionId: string,
    envelope: PackStateEnvelope,
  ): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO pack_state_projections (
           session_id, pack_id, pack_version, envelope_json, updated_at
         ) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(session_id, pack_id, pack_version) DO UPDATE SET
           envelope_json = excluded.envelope_json,
           updated_at = excluded.updated_at`,
      )
      .bind(
        sessionId,
        envelope.packRef.packId,
        envelope.packRef.version,
        JSON.stringify(envelope),
        new Date().toISOString(),
      )
      .run();
  }

  async findTurnByExternalMessage(
    sessionId: string,
    externalMessageId: string,
  ): Promise<ConversationTurn | undefined> {
    const row = await this.db
      .prepare(
        `SELECT * FROM conversation_turns
         WHERE session_id = ? AND external_message_id = ?
         ORDER BY created_at ASC, id ASC
         LIMIT 1`,
      )
      .bind(sessionId, externalMessageId)
      .first<ConversationTurnRow>();
    return row ? turnFromRow(row) : undefined;
  }

  async reserveWebhookDelivery(
    input: ReserveWebhookDeliveryInput,
  ): Promise<ReserveWebhookDeliveryResult> {
    const existing = await this.getWebhookDelivery(
      input.channel,
      input.externalEventId,
    );
    if (existing) return { delivery: existing, reserved: false };

    const now = new Date().toISOString();
    const result = await this.db
      .prepare(
        `INSERT OR IGNORE INTO webhook_deliveries (
          channel, external_event_id, external_thread_id, external_user_id, session_id, status, payload,
          received_at, processed_at, failed_at, last_error, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'received', ?, ?, NULL, NULL, NULL, ?, ?)`,
      )
      .bind(
        input.channel,
        input.externalEventId,
        input.externalThreadId,
        input.externalUserId,
        input.sessionId,
        JSON.stringify(input.payload),
        input.receivedAt,
        now,
        now,
      )
      .run();
    const delivery = await this.getWebhookDelivery(
      input.channel,
      input.externalEventId,
    );
    if (!delivery)
      throw new Error(
        `Failed to reserve webhook delivery: ${input.channel}:${input.externalEventId}`,
      );
    return {
      delivery,
      reserved: Number(result.meta.changes ?? 0) > 0,
    };
  }

  async reserveNonAgentTextDelivery(
    input: ReserveNonAgentTextDeliveryInput,
  ): Promise<ReserveNonAgentTextDeliveryResult> {
    return reserveD1NonAgentTextDelivery({
      db: this.db,
      reservation: input,
    });
  }

  async getNonAgentTextDelivery(
    requestKey: string,
  ): Promise<NonAgentTextDeliveryRecord | undefined> {
    return getD1NonAgentTextDelivery({ db: this.db, requestKey });
  }

  async prepareNonAgentTextDeliveryTurn(
    input: PrepareNonAgentTextDeliveryTurnInput,
  ): Promise<PrepareNonAgentTextDeliveryTurnResult> {
    return prepareD1NonAgentTextDeliveryTurn({
      db: this.db,
      preparation: input,
    });
  }

  async beginNonAgentTextDeliveryAttempt(
    input: BeginNonAgentTextDeliveryAttemptInput,
  ): Promise<BeginNonAgentTextDeliveryAttemptResult> {
    return beginD1NonAgentTextDeliveryAttempt({
      db: this.db,
      attempt: input,
    });
  }

  async completeNonAgentTextDeliveryAttempt(
    input: CompleteNonAgentTextDeliveryAttemptInput,
  ): Promise<CompleteNonAgentTextDeliveryAttemptResult> {
    return completeD1NonAgentTextDeliveryAttempt({
      db: this.db,
      completion: input,
    });
  }

  async reconcileNonAgentTextDelivery(
    input: ReconcileNonAgentTextDeliveryInput,
  ): Promise<ReconcileNonAgentTextDeliveryResult> {
    return reconcileD1NonAgentTextDelivery({
      db: this.db,
      reconciliation: input,
    });
  }

  async markWebhookDeliveryProcessed(
    channel: WebhookDeliveryChannel,
    externalEventId: string,
  ): Promise<WebhookDelivery> {
    return this.updateWebhookDelivery(
      channel,
      externalEventId,
      'processed',
      null,
    );
  }

  async markWebhookDeliveryFailed(
    channel: WebhookDeliveryChannel,
    externalEventId: string,
    lastError: string,
  ): Promise<WebhookDelivery> {
    return this.updateWebhookDelivery(
      channel,
      externalEventId,
      'failed',
      lastError,
    );
  }

  async getWebhookDelivery(
    channel: WebhookDeliveryChannel,
    externalEventId: string,
  ): Promise<WebhookDelivery | undefined> {
    const row = await this.db
      .prepare(
        `SELECT * FROM webhook_deliveries WHERE channel = ? AND external_event_id = ? LIMIT 1`,
      )
      .bind(channel, externalEventId)
      .first<WebhookDeliveryRow>();
    return row ? webhookDeliveryFromRow(row) : undefined;
  }

  async listWebhookDeliveries(sessionId: string): Promise<WebhookDelivery[]> {
    const rows = await this.db
      .prepare(
        `SELECT * FROM webhook_deliveries WHERE session_id = ? ORDER BY received_at ASC, external_event_id ASC`,
      )
      .bind(sessionId)
      .all<WebhookDeliveryRow>();
    return (rows.results ?? []).map(webhookDeliveryFromRow);
  }

  async listStaleWebhookDeliveries(
    channel: WebhookDeliveryChannel,
    receivedBefore: string,
    limit: number,
  ): Promise<WebhookDelivery[]> {
    const rows = await this.db
      .prepare(
        `SELECT * FROM webhook_deliveries
         WHERE channel = ? AND status = 'received' AND received_at < ?
         ORDER BY received_at ASC, external_event_id ASC
         LIMIT ?`,
      )
      .bind(channel, receivedBefore, Math.max(0, limit))
      .all<WebhookDeliveryRow>();
    return (rows.results ?? []).map(webhookDeliveryFromRow);
  }

  async updateTurnDeliveryStatus(
    turnId: string,
    deliveryStatus: ConversationTurn['deliveryStatus'],
    externalMessageId: string | null,
  ): Promise<ConversationTurn> {
    await this.db
      .prepare(
        `UPDATE conversation_turns SET delivery_status = ?, external_message_id = ? WHERE id = ?`,
      )
      .bind(deliveryStatus, externalMessageId, turnId)
      .run();
    const rows = await this.db
      .prepare(`SELECT * FROM conversation_turns WHERE id = ? LIMIT 1`)
      .bind(turnId)
      .all<ConversationTurnRow>();
    const row = rows.results?.[0];
    if (!row) throw new Error(`Conversation turn not found: ${turnId}`);
    return turnFromRow(row);
  }

  async getSessionControl(sessionId: string): Promise<SessionControl> {
    const row = await this.db
      .prepare(`SELECT * FROM session_controls WHERE session_id = ? LIMIT 1`)
      .bind(sessionId)
      .first<SessionControlRow>();
    return row ? sessionControlFromRow(row) : defaultSessionControl(sessionId);
  }

  async listSessionControls(
    sessionIds: string[],
  ): Promise<Map<string, SessionControl>> {
    if (sessionIds.length === 0) return new Map();
    const placeholders = sessionIds.map(() => '?').join(', ');
    const rows = await this.db
      .prepare(
        `SELECT session_id, agent_mode, assigned_agent_id,
                session_authority_generation, updated_at
         FROM session_controls
         WHERE session_id IN (${placeholders})`,
      )
      .bind(...sessionIds)
      .all<SessionControlRow>();
    return new Map(
      (rows.results ?? []).map((row) => [
        row.session_id,
        sessionControlFromRow(row),
      ]),
    );
  }

  async setSessionControl(
    sessionId: string,
    patch: { agentMode: AgentMode; assignedAgentId?: string | null },
  ): Promise<SessionControl> {
    const current = await this.getSessionControl(sessionId);
    const result = await this.transitionSessionAuthority({
      sessionId,
      expectedGeneration: current.sessionAuthorityGeneration,
      agentMode: patch.agentMode,
      assignedAgentId:
        patch.assignedAgentId === undefined
          ? current.assignedAgentId
          : patch.assignedAgentId,
    });
    return result.control;
  }

  async transitionSessionAuthority(
    input: TransitionSessionAuthorityInput,
  ): Promise<TransitionSessionAuthorityResult> {
    return transitionD1SessionAuthority({
      db: this.db,
      operation: input,
    });
  }

  async resetSession(sessionId: string): Promise<SessionControl> {
    await resetD1Session({
      db: this.db,
      sessionId,
      ...(this.sessionResetHook ? { resetHook: this.sessionResetHook } : {}),
    });
    return this.getSessionControl(sessionId);
  }

  async upsertPendingCustomerTurn(
    input: PendingCustomerTurnInput,
  ): Promise<UpsertPendingCustomerTurnResult> {
    const existing = await this.db
      .prepare(
        `SELECT * FROM pending_customer_turns
         WHERE session_id = ? AND external_message_id = ?
         LIMIT 1`,
      )
      .bind(input.sessionId, input.externalMessageId)
      .first<PendingCustomerTurnRow>();
    if (existing)
      return { turn: pendingCustomerTurnFromRow(existing), inserted: false };

    const now = input.updatedAt ?? new Date().toISOString();
    await this.db
      .prepare(
        `INSERT INTO pending_customer_turns (
          turn_id, session_id, channel, external_message_id, external_user_id, text, steer_mode,
          status, claimed_run_id, received_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.turnId,
        input.sessionId,
        input.channel,
        input.externalMessageId,
        input.externalUserId,
        input.text,
        input.steerMode,
        input.status,
        input.claimedRunId,
        input.receivedAt,
        now,
      )
      .run();
    const turn = await this.db
      .prepare(`SELECT * FROM pending_customer_turns WHERE turn_id = ? LIMIT 1`)
      .bind(input.turnId)
      .first<PendingCustomerTurnRow>();
    if (!turn)
      throw new Error(
        `Pending customer turn not found after insert: ${input.turnId}`,
      );
    return { turn: pendingCustomerTurnFromRow(turn), inserted: true };
  }

  async listPendingCustomerTurns(
    sessionId: string,
  ): Promise<PendingCustomerTurn[]> {
    const rows = await this.db
      .prepare(
        `SELECT * FROM pending_customer_turns WHERE session_id = ? ORDER BY received_at ASC, turn_id ASC`,
      )
      .bind(sessionId)
      .all<PendingCustomerTurnRow>();
    return (rows.results ?? []).map(pendingCustomerTurnFromRow);
  }

  async markPendingCustomerTurnClaimed(
    turnId: string,
    runId: string,
  ): Promise<PendingCustomerTurn> {
    const now = new Date().toISOString();
    await this.db
      .prepare(
        `UPDATE pending_customer_turns
         SET status = 'claimed', claimed_run_id = ?, updated_at = ?
         WHERE turn_id = ?`,
      )
      .bind(runId, now, turnId)
      .run();
    const row = await this.db
      .prepare(`SELECT * FROM pending_customer_turns WHERE turn_id = ? LIMIT 1`)
      .bind(turnId)
      .first<PendingCustomerTurnRow>();
    if (!row) throw new Error(`Pending customer turn not found: ${turnId}`);
    return pendingCustomerTurnFromRow(row);
  }

  private async updateWebhookDelivery(
    channel: WebhookDeliveryChannel,
    externalEventId: string,
    status: WebhookDelivery['status'],
    lastError: string | null,
  ): Promise<WebhookDelivery> {
    const now = new Date().toISOString();
    await this.db
      .prepare(
        `UPDATE webhook_deliveries
         SET status = ?,
             processed_at = CASE WHEN ? = 'processed' THEN ? ELSE processed_at END,
             failed_at = CASE WHEN ? = 'failed' THEN ? ELSE failed_at END,
             last_error = ?,
             updated_at = ?
         WHERE channel = ? AND external_event_id = ?`,
      )
      .bind(
        status,
        status,
        now,
        status,
        now,
        lastError,
        now,
        channel,
        externalEventId,
      )
      .run();
    const delivery = await this.getWebhookDelivery(channel, externalEventId);
    if (!delivery)
      throw new Error(
        `Webhook delivery not found: ${channel}:${externalEventId}`,
      );
    return delivery;
  }
}
