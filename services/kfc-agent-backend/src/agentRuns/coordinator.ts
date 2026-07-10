import type { ConversationEvent } from '../channels/conversationEvent.js';
import type { DashboardEventBus } from '../dashboard/eventBus.js';
import type { ConversationStore } from '../persistence/memoryStore.js';

export interface AgentRunWakeupJob {
  channel: 'agent_run_wakeup';
  sessionId: string;
  generation: number;
  dueAt: string;
  queuedAt: string;
}

export interface AgentRunCoordinatorOptions {
  debounceWindowMs?: number;
  recoveryLimit?: number;
}

export class AgentRunCoordinator {
  constructor(
    private readonly input: {
      store: ConversationStore;
      dashboard?: DashboardEventBus;
      options?: AgentRunCoordinatorOptions;
    },
  ) {}

  async recordPendingTurn(event: ConversationEvent, sessionId: string): Promise<AgentRunWakeupJob> {
    if (event.channel !== 'messenger' && event.channel !== 'zalo') {
      throw new Error(`Unsupported interruption channel: ${event.channel}`);
    }

    await this.input.store.upsertPendingCustomerTurn({
      turnId: `pending_${event.rawEventId}`,
      sessionId,
      channel: event.channel,
      externalMessageId: event.rawEventId,
      externalUserId: event.externalUserId,
      text: event.text,
      steerMode: event.shouldRunAgent ? 'steering' : 'record_only',
      status: 'pending',
      claimedRunId: null,
      receivedAt: event.receivedAt,
    });

    const current = await this.input.store.getSessionAgentState(sessionId);
    let currentRunId = current.currentRunId;
    if (currentRunId && event.shouldRunAgent) {
      const currentRun = await this.input.store.getAgentRun(currentRunId);
      if (currentRun && !currentRun.irreversibleSideEffectAt && (currentRun.status === 'scheduled' || currentRun.status === 'running')) {
        await this.input.store.updateAgentRun(currentRun.id, {
          status: 'superseded',
          deliveryStatus: 'suppressed',
          completedAt: new Date().toISOString(),
        });
        this.input.dashboard?.emitEvent({
          id: `dash_${sessionId}_${currentRun.id}_superseded`,
          sessionId,
          type: 'agent_run_superseded',
          payload: {
            runId: currentRun.id,
            generation: currentRun.generation,
            supersededByExternalMessageId: event.rawEventId,
            reason: 'new_customer_turn',
          },
          createdAt: new Date().toISOString(),
        });
        currentRunId = null;
      }
    }
    const generation = current.generation + 1;
    const now = new Date();
    const dueAt = new Date(now.getTime() + this.debounceWindowMs()).toISOString();
    await this.input.store.setSessionAgentState({
      sessionId,
      currentRunId,
      generation,
      debounceDeadlineAt: dueAt,
    });
    const pendingTurnCount = (await this.input.store.listPendingCustomerTurns(sessionId)).filter(
      (turn) => turn.status === 'pending',
    ).length;
    this.input.dashboard?.emitEvent({
      id: `dash_${sessionId}_${event.rawEventId}_pending`,
      sessionId,
      type: 'agent_run_pending',
      payload: {
        generation,
        channel: event.channel,
        externalMessageId: event.rawEventId,
        pendingTurnCount,
        debounceDeadlineAt: dueAt,
        reason: 'customer_turn_reserved',
      },
      createdAt: now.toISOString(),
    });

    return {
      channel: 'agent_run_wakeup',
      sessionId,
      generation,
      dueAt,
      queuedAt: now.toISOString(),
    };
  }

  async claimWakeupRun(job: AgentRunWakeupJob): Promise<{ claimed: boolean; runId?: string; reason?: string }> {
    const state = await this.input.store.getSessionAgentState(job.sessionId);
    if (state.generation !== job.generation) {
      return { claimed: false, reason: 'stale_generation' };
    }
    if (state.currentRunId) {
      const existing = await this.input.store.getAgentRun(state.currentRunId);
      if (existing?.generation === job.generation) {
        return { claimed: false, runId: existing.id, reason: 'already_claimed' };
      }
    }

    const turns = (await this.input.store.listPendingCustomerTurns(job.sessionId)).filter(
      (turn) => turn.status === 'pending',
    );
    if (turns.length === 0) {
      return { claimed: false, reason: 'no_pending_turns' };
    }

    const runId = `run_${crypto.randomUUID()}`;
    const run = await this.input.store.createAgentRun({
      id: runId,
      sessionId: job.sessionId,
      generation: job.generation,
      channel: turns[0]!.channel,
      externalUserId: turns[0]!.externalUserId,
      status: 'scheduled',
      coalescedInputText: turns.map((turn, index) => `${index + 1}. ${turn.text}`).join('\n'),
      deliveryStatus: 'pending',
      scheduledAt: new Date().toISOString(),
    });

    for (const [index, turn] of turns.entries()) {
      await this.input.store.linkAgentRunTurn({ runId: run.id, turnId: turn.turnId, sequence: index });
    }
    await this.input.store.setSessionAgentState({
      sessionId: job.sessionId,
      currentRunId: run.id,
      generation: job.generation,
      debounceDeadlineAt: null,
    });

    this.input.dashboard?.emitEvent({
      id: `dash_${job.sessionId}_${run.id}_scheduled`,
      sessionId: job.sessionId,
      type: 'agent_run_scheduled',
      payload: {
        runId: run.id,
        generation: run.generation,
        channel: run.channel,
        includedTurnIds: turns.map((turn) => turn.turnId),
        reason: 'debounce_wakeup',
      },
      createdAt: new Date().toISOString(),
    });

    return { claimed: true, runId: run.id };
  }

  async claimDueRuns(now: string): Promise<Array<{ sessionId: string; generation: number; claimed: boolean; runId?: string; reason?: string }>> {
    const states = await this.input.store.listDueSessionAgentStates(now, this.recoveryLimit());
    const results: Array<{ sessionId: string; generation: number; claimed: boolean; runId?: string; reason?: string }> = [];
    for (const state of states) {
      const result = await this.claimWakeupRun({
        channel: 'agent_run_wakeup',
        sessionId: state.sessionId,
        generation: state.generation,
        dueAt: state.debounceDeadlineAt ?? now,
        queuedAt: now,
      });
      results.push({ sessionId: state.sessionId, generation: state.generation, ...result });
    }
    return results;
  }

  private debounceWindowMs(): number {
    return this.input.options?.debounceWindowMs ?? 1500;
  }

  private recoveryLimit(): number {
    return this.input.options?.recoveryLimit ?? 50;
  }
}
