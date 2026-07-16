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
  SessionResetHook,
  SessionAgentStateInput,
  StoredEvent,
  UpsertPendingCustomerTurnResult,
  WebhookDelivery,
  WebhookDeliveryChannel,
  AppendCustomerRunEventInput,
  CustomerRunPatch,
} from './memoryStore.js';
import { confirmationPauseFromEvent, type ConfirmationPauseRecord } from './memoryStore.js';
import {
  CustomerRunIdempotencyConflictError,
  CustomerRunSequenceConflictError,
  customerRunEventSchema,
  type CustomerRun,
  type CustomerRunEvent,
} from '../customerRuns/contracts.js';
import { PostgresCheckpointSaver } from './postgresCheckpointSaver.js';
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

import { PostgresStoreConversationOperations } from './postgresStoreConversationOperations.js';

export class PostgresStoreAgentOperations extends PostgresStoreConversationOperations {
  async createAgentRun(input: CreateAgentRunInput): Promise<AgentRun> {
    const run: AgentRun = {
      ...input,
      supersededByRunId: input.supersededByRunId ?? null,
      irreversibleSideEffectAt: input.irreversibleSideEffectAt ?? null,
      irreversibleToolName: input.irreversibleToolName ?? null,
      assistantTurnId: input.assistantTurnId ?? null,
      deliveryExternalMessageId: input.deliveryExternalMessageId ?? null,
      errorCode: input.errorCode ?? null,
      errorMessage: input.errorMessage ?? null,
      startedAt: input.startedAt ?? null,
      completedAt: input.completedAt ?? null,
      updatedAt: input.updatedAt ?? new Date().toISOString(),
    };
    await this.db.query(
      `
        INSERT INTO agent_runs (
          id, session_id, generation, channel, external_user_id, status, coalesced_input_text,
          superseded_by_run_id, irreversible_side_effect_at, irreversible_tool_name, assistant_turn_id,
          delivery_status, delivery_external_message_id, error_code, error_message,
          scheduled_at, started_at, completed_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
      `,
      [
        run.id,
        run.sessionId,
        run.generation,
        run.channel,
        run.externalUserId,
        run.status,
        run.coalescedInputText,
        run.supersededByRunId,
        run.irreversibleSideEffectAt,
        run.irreversibleToolName,
        run.assistantTurnId,
        run.deliveryStatus,
        run.deliveryExternalMessageId,
        run.errorCode,
        run.errorMessage,
        run.scheduledAt,
        run.startedAt,
        run.completedAt,
        run.updatedAt,
      ],
    );
    return run;
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

  async listCheckpointIdentifiers(sessionId: string) {
    const result = await this.db.query<{
      checkpoint_ns: string;
      checkpoint_id: string;
      parent_checkpoint_id: string | null;
    }>(
      `SELECT checkpoint_ns, checkpoint_id, parent_checkpoint_id FROM langgraph_checkpoints
       WHERE thread_id = $1 ORDER BY checkpoint_ns ASC, checkpoint_id ASC`,
      [sessionId],
    );
    return result.rows.map((row) => ({
      checkpointNamespace: row.checkpoint_ns,
      checkpointId: row.checkpoint_id,
      parentCheckpointId: row.parent_checkpoint_id,
    }));
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

  async findConfirmationPause(requestId: string): Promise<ConfirmationPauseRecord | undefined> {
    const result = await this.db.query<StoredEventRow>(
      `SELECT * FROM conversation_events WHERE source_type = 'confirmation_pause_created' AND payload->>'requestId' = $1 ORDER BY created_at DESC LIMIT 1`,
      [requestId],
    );
    return result.rows[0] ? confirmationPauseFromEvent(storedEventFromRow(result.rows[0])) : undefined;
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
