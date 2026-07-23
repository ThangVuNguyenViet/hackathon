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
  UpsertPendingCustomerTurnResult,
  WebhookDelivery,
  WebhookDeliveryChannel,
  AppendCustomerRunEventInput,
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
  D1Result,
  D1PreparedStatement,
  D1DatabaseLike,
  ConversationTurnRow,
  ConversationProfileRow,
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
  dashboardEventFromRow,
  webhookDeliveryFromRow,
  sessionControlFromRow,
  customerRunFromRow,
  customerRunEventFromRow,
  defaultSessionControl,
  pendingCustomerTurnFromRow,
  agentRunFromRow,
  agentRunTurnFromRow,
} from './d1StoreSupport.js';
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

  async claimAgentRun(
    input: CreateAgentRunInput,
  ): Promise<ClaimAgentRunResult> {
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
        `SELECT * FROM conversation_turns WHERE session_id = ? ORDER BY ordinal ASC`,
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
        `SELECT * FROM conversation_turns WHERE session_id = ? ORDER BY ordinal DESC LIMIT ?`,
      )
      .bind(sessionId, limit)
      .all<ConversationTurnRow>();
    return (rows.results ?? []).map(turnFromRow).reverse();
  }

  async searchHistory(
    sessionId: string,
    query: string,
  ): Promise<HistorySearchResult[]> {
    const lower = query.toLowerCase();
    const rows = await this.db
      .prepare(
        `SELECT * FROM conversation_turns
         WHERE session_id = ? AND instr(lower(text), ?) > 0
         ORDER BY ordinal ASC`,
      )
      .bind(sessionId, lower)
      .all<ConversationTurnRow>();
    return (rows.results ?? [])
      .map(turnFromRow)
      .map((turn) => {
        const text = turn.text.toLowerCase();
        const directHit = text.includes(lower);
        return { ...turn, confidence: directHit ? 0.7 : 0 };
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
      if (event.type === 'session_intelligence_updated') {
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
              : (existing?.sessionIntelligence ?? sessionIntelligence ?? null),
        });
      } else if (!existing) {
        summaries.set(event.session_id, {
          sessionId: event.session_id,
          latestEventType: event.type,
          updatedAt: event.created_at,
          sessionIntelligence: null,
        });
      } else if (existing.latestEventType === 'session_intelligence_updated') {
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
