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
} from "./memoryStore.js";
import { confirmationPauseFromEvent, type ConfirmationPauseRecord } from "./memoryStore.js";
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
  SessionAgentStateRow,
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
  agentRunTurnFromRow,
  sessionAgentStateFromRow,
  defaultSessionAgentState
} from './d1StoreSupport.js';

import { D1StoreConversationOperations } from './d1StoreConversationOperations.js';

export class D1StoreAgentOperations extends D1StoreConversationOperations {
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
    await this.db
      .prepare(
        `INSERT INTO agent_runs (
          id, session_id, generation, channel, external_user_id, status, coalesced_input_text,
          superseded_by_run_id, irreversible_side_effect_at, irreversible_tool_name, assistant_turn_id,
          delivery_status, delivery_external_message_id, error_code, error_message,
          scheduled_at, started_at, completed_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
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
      )
      .run();
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

  async listCheckpointIdentifiers(sessionId: string) {
    const rows = await this.db.prepare(
      `SELECT checkpoint_ns, checkpoint_id, parent_checkpoint_id FROM langgraph_checkpoints
       WHERE thread_id = ? ORDER BY checkpoint_ns ASC, checkpoint_id ASC`,
    ).bind(sessionId).all<{ checkpoint_ns: string; checkpoint_id: string; parent_checkpoint_id: string | null }>();
    return (rows.results ?? []).map((row) => ({
      checkpointNamespace: row.checkpoint_ns,
      checkpointId: row.checkpoint_id,
      parentCheckpointId: row.parent_checkpoint_id,
    }));
  }

  async getSessionAgentState(sessionId: string): Promise<SessionAgentState> {
    const row = await this.db
      .prepare(`SELECT * FROM session_agent_state WHERE session_id = ? LIMIT 1`)
      .bind(sessionId)
      .first<SessionAgentStateRow>();
    return row
      ? sessionAgentStateFromRow(row)
      : defaultSessionAgentState(sessionId);
  }

  async setSessionAgentState(
    input: SessionAgentStateInput,
  ): Promise<SessionAgentState> {
    const state: SessionAgentState = {
      ...input,
      updatedAt: input.updatedAt ?? new Date().toISOString(),
    };
    await this.db
      .prepare(
        `INSERT INTO session_agent_state (session_id, current_run_id, generation, debounce_deadline_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET
           current_run_id = excluded.current_run_id,
           generation = excluded.generation,
           debounce_deadline_at = excluded.debounce_deadline_at,
           updated_at = excluded.updated_at`,
      )
      .bind(
        state.sessionId,
        state.currentRunId,
        state.generation,
        state.debounceDeadlineAt,
        state.updatedAt,
      )
      .run();
    return state;
  }

  async listDueSessionAgentStates(
    now: string,
    limit: number,
  ): Promise<SessionAgentState[]> {
    const rows = await this.db
      .prepare(
        `SELECT *
         FROM session_agent_state
         WHERE current_run_id IS NULL
           AND debounce_deadline_at IS NOT NULL
           AND debounce_deadline_at <= ?
         ORDER BY debounce_deadline_at ASC, session_id ASC
         LIMIT ?`,
      )
      .bind(now, limit)
      .all<SessionAgentStateRow>();
    return (rows.results ?? []).map(sessionAgentStateFromRow);
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

  async listEvents(sessionId: string): Promise<StoredEvent[]> {
    const rows = await this.db
      .prepare(
        `SELECT * FROM conversation_events WHERE session_id = ? ORDER BY created_at ASC, id ASC`,
      )
      .bind(sessionId)
      .all<StoredEventRow>();
    return (rows.results ?? []).map(storedEventFromRow);
  }

  async findConfirmationPause(requestId: string): Promise<ConfirmationPauseRecord | undefined> {
    const row = await this.db.prepare(
      `SELECT * FROM conversation_events WHERE source_type = 'confirmation_pause_created' AND json_extract(payload, '$.requestId') = ? ORDER BY created_at DESC LIMIT 1`,
    ).bind(requestId).first<StoredEventRow>();
    return row ? confirmationPauseFromEvent(storedEventFromRow(row)) : undefined;
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
