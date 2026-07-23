import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
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
} from './nonAgentTextDelivery.js';
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
  defaultSessionAgentState,
} from './postgresStoreSupport.js';

import { PostgresStoreCore } from './postgresStoreCore.js';
import {
  lockPostgresSessionAuthority,
  transitionPostgresSessionAuthority,
} from './postgresStoreSessionAuthority.js';
import { commitPostgresAssistantTurnIfRunCurrent } from './postgresStoreTurnCommit.js';
import {
  beginPostgresNonAgentTextDeliveryAttempt,
  completePostgresNonAgentTextDeliveryAttempt,
  getPostgresNonAgentTextDelivery,
  preparePostgresNonAgentTextDeliveryTurn,
  reconcilePostgresNonAgentTextDelivery,
  reservePostgresNonAgentTextDelivery,
} from './postgresStoreNonAgentTextDelivery.js';

export abstract class PostgresStoreConversationOperations extends PostgresStoreCore {
  abstract appendEvent(
    sessionId: string,
    sourceType: string,
    payload: Record<string, unknown>,
  ): Promise<StoredEvent>;
  async commitAssistantTurnIfRunCurrent(
    input: CommitAssistantTurnIfRunCurrentInput,
  ): Promise<CommitAssistantTurnIfRunCurrentResult> {
    return commitPostgresAssistantTurnIfRunCurrent({
      db: this.db,
      operation: input,
    });
  }
  async commitAssistantTurn(
    _input: CommitAssistantTurnInput,
  ): Promise<CommitAssistantTurnResult> {
    throw new Error('postgres_context_state_not_supported');
  }
  async appendTurn(
    input: AppendConversationTurnInput,
  ): Promise<ConversationTurn> {
    if (input.id) {
      const existing = await this.db.query<ConversationTurnRow>(
        `SELECT * FROM conversation_turns WHERE id = $1 LIMIT 1`,
        [input.id],
      );
      if (existing.rows[0]) return turnFromRow(existing.rows[0]);
    }
    const turn: ConversationTurn = {
      ...input,
      id: input.id ?? `turn_${randomUUID()}`,
      ordinal: 0,
      createdAt: input.createdAt ?? new Date().toISOString(),
    };
    await this.db.query(
      `
        INSERT INTO conversation_turns (
          id, session_id, channel, role, text, external_message_id, external_user_id, delivery_status, metadata, created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `,
      [
        turn.id,
        turn.sessionId,
        turn.channel,
        turn.role,
        turn.text,
        turn.externalMessageId,
        turn.externalUserId,
        turn.deliveryStatus,
        input.metadata,
        turn.createdAt,
      ],
    );
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
    const turn: ConversationTurn = {
      ...input,
      id: input.id ?? `turn_${randomUUID()}`,
      ordinal: 0,
    };
    const result = await this.db.query<
      ConversationTurnRow & { inserted: boolean }
    >(
      `
        INSERT INTO conversation_turns (
          id, session_id, channel, role, text, external_message_id, external_user_id, delivery_status, metadata, created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (session_id, external_message_id) WHERE external_message_id IS NOT NULL
        DO UPDATE SET
          channel = EXCLUDED.channel,
          role = EXCLUDED.role,
          text = EXCLUDED.text,
          external_user_id = EXCLUDED.external_user_id,
          delivery_status = EXCLUDED.delivery_status,
          metadata = EXCLUDED.metadata,
          created_at = EXCLUDED.created_at
        RETURNING *, (xmax = 0) AS inserted
      `,
      [
        turn.id,
        turn.sessionId,
        turn.channel,
        turn.role,
        turn.text,
        turn.externalMessageId,
        turn.externalUserId,
        turn.deliveryStatus,
        turn.metadata,
        turn.createdAt,
      ],
    );
    const row = result.rows[0];
    if (!row)
      throw new Error(
        `Failed to upsert imported conversation turn: ${turn.externalMessageId ?? turn.id}`,
      );
    if (row.inserted) {
      await this.appendEvent(
        input.sessionId,
        `conversation_turn:${input.role}`,
        {
          text: input.text,
          channel: input.channel,
          deliveryStatus: input.deliveryStatus,
          externalMessageId: input.externalMessageId,
          externalUserId: input.externalUserId,
          metadata: input.metadata,
        },
      );
    }
    return { turn: turnFromRow(row), inserted: row.inserted };
  }

  async getConversationSummary(
    _sessionId: string,
  ): Promise<ConversationSummary | undefined> {
    throw new Error('postgres_context_state_not_supported');
  }

  async compareAndSwapConversationSummary(
    _input: CompareAndSwapConversationSummaryInput,
  ): Promise<CompareAndSwapConversationSummaryResult> {
    throw new Error('postgres_context_state_not_supported');
  }

  async getPackState(
    _sessionId: string,
    _packRef: PackRef,
  ): Promise<PackStateEnvelope | undefined> {
    throw new Error('postgres_context_state_not_supported');
  }

  async putPackState(
    _sessionId: string,
    _envelope: PackStateEnvelope,
  ): Promise<void> {
    throw new Error('postgres_context_state_not_supported');
  }

  async upsertProfile(
    input: ConversationProfile,
  ): Promise<ConversationProfile> {
    await this.db.query(
      `
        INSERT INTO conversation_profiles (
          channel, external_user_id, display_name, avatar_url, profile_source, profile_updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (channel, external_user_id) DO UPDATE SET
          display_name = EXCLUDED.display_name,
          avatar_url = EXCLUDED.avatar_url,
          profile_source = EXCLUDED.profile_source,
          profile_updated_at = EXCLUDED.profile_updated_at
      `,
      [
        input.channel,
        input.externalUserId,
        input.displayName,
        input.avatarUrl,
        input.profileSource,
        input.profileUpdatedAt,
      ],
    );
    return input;
  }

  async getProfile(
    channel: ConversationProfile['channel'],
    externalUserId: string,
  ): Promise<ConversationProfile | undefined> {
    const result = await this.db.query<ConversationProfileRow>(
      `
        SELECT *
        FROM conversation_profiles
        WHERE channel = $1 AND external_user_id = $2
        LIMIT 1
      `,
      [channel, externalUserId],
    );
    return result.rows[0] ? profileFromRow(result.rows[0]) : undefined;
  }

  async findTurnByExternalMessage(
    sessionId: string,
    externalMessageId: string,
  ): Promise<ConversationTurn | undefined> {
    const result = await this.db.query<ConversationTurnRow>(
      `
        SELECT *
        FROM conversation_turns
        WHERE session_id = $1 AND external_message_id = $2
        ORDER BY created_at ASC, id ASC
        LIMIT 1
      `,
      [sessionId, externalMessageId],
    );
    return result.rows[0] ? turnFromRow(result.rows[0]) : undefined;
  }

  async reserveWebhookDelivery(
    input: ReserveWebhookDeliveryInput,
  ): Promise<ReserveWebhookDeliveryResult> {
    const now = new Date().toISOString();
    const inserted = await this.db.query<WebhookDeliveryRow>(
      `
        INSERT INTO webhook_deliveries (
          channel, external_event_id, external_thread_id, external_user_id, session_id, status, payload,
          received_at, processed_at, failed_at, last_error, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, 'received', $6, $7, NULL, NULL, NULL, $8, $8)
        ON CONFLICT (channel, external_event_id) DO NOTHING
        RETURNING *
      `,
      [
        input.channel,
        input.externalEventId,
        input.externalThreadId,
        input.externalUserId,
        input.sessionId,
        JSON.stringify(input.payload),
        input.receivedAt,
        now,
      ],
    );
    if (inserted.rows[0])
      return {
        delivery: webhookDeliveryFromRow(inserted.rows[0]),
        reserved: true,
      };

    const existing = await this.getWebhookDelivery(
      input.channel,
      input.externalEventId,
    );
    if (!existing)
      throw new Error(
        `Webhook delivery reservation missing after conflict: ${input.channel}:${input.externalEventId}`,
      );
    return { delivery: existing, reserved: false };
  }

  async reserveNonAgentTextDelivery(
    input: ReserveNonAgentTextDeliveryInput,
  ): Promise<ReserveNonAgentTextDeliveryResult> {
    return reservePostgresNonAgentTextDelivery({
      db: this.db,
      reservation: input,
    });
  }

  async getNonAgentTextDelivery(
    requestKey: string,
  ): Promise<NonAgentTextDeliveryRecord | undefined> {
    return getPostgresNonAgentTextDelivery({
      db: this.db,
      requestKey,
    });
  }

  async prepareNonAgentTextDeliveryTurn(
    input: PrepareNonAgentTextDeliveryTurnInput,
  ): Promise<PrepareNonAgentTextDeliveryTurnResult> {
    return preparePostgresNonAgentTextDeliveryTurn({
      db: this.db,
      preparation: input,
    });
  }

  async beginNonAgentTextDeliveryAttempt(
    input: BeginNonAgentTextDeliveryAttemptInput,
  ): Promise<BeginNonAgentTextDeliveryAttemptResult> {
    return beginPostgresNonAgentTextDeliveryAttempt({
      db: this.db,
      attempt: input,
    });
  }

  async completeNonAgentTextDeliveryAttempt(
    input: CompleteNonAgentTextDeliveryAttemptInput,
  ): Promise<CompleteNonAgentTextDeliveryAttemptResult> {
    return completePostgresNonAgentTextDeliveryAttempt({
      db: this.db,
      completion: input,
    });
  }

  async reconcileNonAgentTextDelivery(
    input: ReconcileNonAgentTextDeliveryInput,
  ): Promise<ReconcileNonAgentTextDeliveryResult> {
    return reconcilePostgresNonAgentTextDelivery({
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
    const result = await this.db.query<WebhookDeliveryRow>(
      `
        SELECT *
        FROM webhook_deliveries
        WHERE channel = $1 AND external_event_id = $2
        LIMIT 1
      `,
      [channel, externalEventId],
    );
    return result.rows[0] ? webhookDeliveryFromRow(result.rows[0]) : undefined;
  }

  async listWebhookDeliveries(sessionId: string): Promise<WebhookDelivery[]> {
    const result = await this.db.query<WebhookDeliveryRow>(
      `SELECT * FROM webhook_deliveries
       WHERE session_id = $1 ORDER BY received_at ASC, external_event_id ASC`,
      [sessionId],
    );
    return result.rows.map(webhookDeliveryFromRow);
  }

  async listStaleWebhookDeliveries(
    channel: WebhookDeliveryChannel,
    receivedBefore: string,
    limit: number,
  ): Promise<WebhookDelivery[]> {
    const result = await this.db.query<WebhookDeliveryRow>(
      `
        SELECT *
        FROM webhook_deliveries
        WHERE channel = $1
          AND status = 'received'
          AND received_at < $2
        ORDER BY received_at ASC, external_event_id ASC
        LIMIT $3
      `,
      [channel, receivedBefore, Math.max(0, limit)],
    );
    return result.rows.map(webhookDeliveryFromRow);
  }

  private async updateWebhookDelivery(
    channel: WebhookDeliveryChannel,
    externalEventId: string,
    status: WebhookDelivery['status'],
    lastError: string | null,
  ): Promise<WebhookDelivery> {
    const result = await this.db.query<WebhookDeliveryRow>(
      `
        UPDATE webhook_deliveries
        SET status = $3,
            processed_at = CASE WHEN $3 = 'processed' THEN NOW() ELSE processed_at END,
            failed_at = CASE WHEN $3 = 'failed' THEN NOW() ELSE failed_at END,
            last_error = $4,
            updated_at = NOW()
        WHERE channel = $1 AND external_event_id = $2
        RETURNING *
      `,
      [channel, externalEventId, status, lastError],
    );
    const row = result.rows[0];
    if (!row)
      throw new Error(
        `Webhook delivery not found: ${channel}:${externalEventId}`,
      );
    return webhookDeliveryFromRow(row);
  }

  async updateTurnDeliveryStatus(
    turnId: string,
    deliveryStatus: ConversationTurn['deliveryStatus'],
    externalMessageId: string | null,
  ): Promise<ConversationTurn> {
    const result = await this.db.query<ConversationTurnRow>(
      `
        UPDATE conversation_turns
        SET delivery_status = $2, external_message_id = $3
        WHERE id = $1
        RETURNING *
      `,
      [turnId, deliveryStatus, externalMessageId],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`Conversation turn not found: ${turnId}`);
    return turnFromRow(row);
  }

  async getSessionControl(sessionId: string): Promise<SessionControl> {
    const result = await this.db.query<SessionControlRow>(
      `
        SELECT *
        FROM session_controls
        WHERE session_id = $1
        LIMIT 1
      `,
      [sessionId],
    );
    return result.rows[0]
      ? sessionControlFromRow(result.rows[0])
      : defaultSessionControl(sessionId);
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
    return transitionPostgresSessionAuthority({
      db: this.db,
      operation: input,
    });
  }

  async upsertPendingCustomerTurn(
    input: PendingCustomerTurnInput,
  ): Promise<UpsertPendingCustomerTurnResult> {
    const now = input.updatedAt ?? new Date().toISOString();
    const result = await this.db.query<
      PendingCustomerTurnRow & { inserted: boolean }
    >(
      `
        INSERT INTO pending_customer_turns (
          turn_id, session_id, channel, external_message_id, external_user_id, text, steer_mode,
          status, claimed_run_id, received_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (session_id, external_message_id) DO UPDATE SET
          updated_at = pending_customer_turns.updated_at
        RETURNING *, (xmax = 0) AS inserted
      `,
      [
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
      ],
    );
    const row = result.rows[0];
    if (!row)
      throw new Error(
        `Failed to upsert pending customer turn: ${input.externalMessageId}`,
      );
    return { turn: pendingCustomerTurnFromRow(row), inserted: row.inserted };
  }

  async listPendingCustomerTurns(
    sessionId: string,
  ): Promise<PendingCustomerTurn[]> {
    const result = await this.db.query<PendingCustomerTurnRow>(
      `
        SELECT *
        FROM pending_customer_turns
        WHERE session_id = $1
        ORDER BY received_at ASC, turn_id ASC
      `,
      [sessionId],
    );
    return result.rows.map(pendingCustomerTurnFromRow);
  }

  async markPendingCustomerTurnClaimed(
    turnId: string,
    runId: string,
  ): Promise<PendingCustomerTurn> {
    const result = await this.db.query<PendingCustomerTurnRow>(
      `
        UPDATE pending_customer_turns
        SET status = 'claimed', claimed_run_id = $2, updated_at = NOW()
        WHERE turn_id = $1
        RETURNING *
      `,
      [turnId, runId],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`Pending customer turn not found: ${turnId}`);
    return pendingCustomerTurnFromRow(row);
  }
}
