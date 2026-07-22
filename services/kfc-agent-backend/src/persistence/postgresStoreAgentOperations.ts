import { randomUUID } from 'node:crypto';
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
import { appendPostgresEventIfRunCurrent } from './postgresStoreRunCommit.js';
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

export class PostgresStoreAgentOperations extends PostgresStoreConversationOperations {
  async createAgentRun(input: CreateAgentRunInput): Promise<AgentRun> {
    return createPostgresAgentRun({ db: this.db, operation: input });
  }

  async claimAgentRun(
    input: CreateAgentRunInput,
  ): Promise<ClaimAgentRunResult> {
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
    return result.rows[0]
      ? sessionAgentStateFromRow(result.rows[0])
      : defaultSessionAgentState(sessionId);
  }

  async setSessionAgentState(
    input: SessionAgentStateInput,
  ): Promise<SessionAgentState> {
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
      [
        state.sessionId,
        state.currentRunId,
        state.generation,
        state.debounceDeadlineAt,
        state.updatedAt,
      ],
    );
    const row = result.rows[0];
    if (!row)
      throw new Error(`Failed to set session agent state: ${state.sessionId}`);
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

  async listDueSessionAgentStates(
    now: string,
    limit: number,
  ): Promise<SessionAgentState[]> {
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

  async appendEvent(
    sessionId: string,
    sourceType: string,
    payload: Record<string, unknown>,
  ): Promise<StoredEvent> {
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
      [
        event.id,
        event.sessionId,
        event.sourceType,
        JSON.stringify(event.payload),
        event.createdAt,
      ],
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

  async searchHistory(
    sessionId: string,
    query: string,
  ): Promise<HistorySearchResult[]> {
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
      [
        event.id,
        event.sessionId,
        event.type,
        JSON.stringify(event.payload),
        event.createdAt,
      ],
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
