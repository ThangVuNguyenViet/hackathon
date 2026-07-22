import type { ConversationEvent } from '../channels/conversationEvent.js';
import type { DashboardEventBus } from '../dashboard/eventBus.js';
import type { ConversationStore } from '../persistence/memoryStore.js';
import {
  MAXIMUM_AGENT_RUN_EXECUTION_ATTEMPTS,
  agentRunExecutionFence,
} from '../persistence/agentRunExecutionLease.js';

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

export interface AgentRunWakeupClaimResult {
  claimed: boolean;
  dispatch: boolean;
  runId?: string;
  reason?: string;
}

export class AgentRunCoordinator {
  constructor(
    private readonly input: {
      store: ConversationStore;
      dashboard?: DashboardEventBus;
      options?: AgentRunCoordinatorOptions;
    },
  ) {}

  async recordPendingTurn(
    event: ConversationEvent,
    sessionId: string,
  ): Promise<AgentRunWakeupJob> {
    if (event.channel !== 'messenger' && event.channel !== 'zalo') {
      throw new Error(`Unsupported interruption channel: ${event.channel}`);
    }

    const pendingTurn = await this.input.store.upsertPendingCustomerTurn({
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

    const now = new Date();
    if (!pendingTurn.inserted) {
      const state = await this.input.store.getSessionAgentState(sessionId);
      return {
        channel: 'agent_run_wakeup',
        sessionId,
        generation: state.generation,
        dueAt: state.debounceDeadlineAt ?? now.toISOString(),
        queuedAt: now.toISOString(),
      };
    }
    const dueAt = new Date(
      now.getTime() + this.debounceWindowMs(),
    ).toISOString();
    const advanced = await this.input.store.advanceSessionAgentGeneration({
      sessionId,
      debounceDeadlineAt: dueAt,
      updatedAt: now.toISOString(),
    });
    if (advanced.invalidatedRunId) {
      const currentRun = await this.input.store.getAgentRun(
        advanced.invalidatedRunId,
      );
      const completedAt = new Date().toISOString();
      let superseded = false;
      if (
        currentRun &&
        !currentRun.irreversibleSideEffectAt &&
        !currentRun.irreversibleToolName &&
        currentRun.status === 'scheduled'
      ) {
        const updated = await this.input.store.updateAgentRun(currentRun.id, {
          status: 'superseded',
          deliveryStatus: 'suppressed',
          completedAt,
        });
        superseded = updated.status === 'superseded';
      } else if (
        currentRun &&
        !currentRun.irreversibleSideEffectAt &&
        !currentRun.irreversibleToolName &&
        currentRun.status === 'running' &&
        currentRun.executionLeaseToken
      ) {
        const result =
          await this.input.store.supersedeAgentRunExecutionIfNoLongerCurrent({
            sessionId,
            fence: agentRunExecutionFence(currentRun),
            errorMessage: 'A newer customer turn invalidated the run owner',
            completedAt,
          });
        superseded = result.status === 'superseded';
      }
      if (currentRun && superseded) {
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
          createdAt: completedAt,
        });
      }
    }
    const generation = advanced.state.generation;
    const pendingTurnCount = (
      await this.input.store.listPendingCustomerTurns(sessionId)
    ).filter((turn) => turn.status === 'pending').length;
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

  async claimWakeupRun(
    job: AgentRunWakeupJob,
  ): Promise<AgentRunWakeupClaimResult> {
    const state = await this.input.store.getSessionAgentState(job.sessionId);
    if (state.generation !== job.generation) {
      return { claimed: false, dispatch: false, reason: 'stale_generation' };
    }
    if (state.currentRunId) {
      const existing = await this.input.store.getAgentRun(state.currentRunId);
      if (existing?.generation === job.generation) {
        const decision = executionDispatchDecision(existing);
        return {
          claimed: false,
          dispatch: decision.dispatch,
          runId: existing.id,
          reason: decision.reason,
        };
      }
    }

    const turns = (
      await this.input.store.listPendingCustomerTurns(job.sessionId)
    ).filter((turn) => turn.status === 'pending');
    if (turns.length === 0) {
      return { claimed: false, dispatch: false, reason: 'no_pending_turns' };
    }

    const runId = `run_${crypto.randomUUID()}`;
    const claim = await this.input.store.claimAgentRun({
      id: runId,
      sessionId: job.sessionId,
      generation: job.generation,
      channel: turns[0]!.channel,
      externalUserId: turns[0]!.externalUserId,
      status: 'scheduled',
      coalescedInputText: turns
        .map((turn, index) => `${index + 1}. ${turn.text}`)
        .join('\n'),
      deliveryStatus: 'pending',
      scheduledAt: new Date().toISOString(),
    });
    const run = claim.run;

    for (const [index, turn] of turns.entries()) {
      await this.input.store.linkAgentRunTurn({
        runId: run.id,
        turnId: turn.turnId,
        sequence: index,
      });
    }
    const ownership = await this.input.store.claimSessionAgentRunOwnership({
      sessionId: job.sessionId,
      runId: run.id,
      expectedGeneration: job.generation,
      expectedCurrentRunId: null,
      expectedDebounceDeadlineAt: job.dueAt,
    });
    if (ownership.status === 'stale') {
      if (
        ownership.state.currentRunId === run.id &&
        ownership.state.generation === job.generation
      ) {
        const decision = executionDispatchDecision(run);
        return {
          claimed: false,
          dispatch: decision.dispatch,
          runId: run.id,
          reason: decision.reason,
        };
      }
      if (claim.claimed) {
        await this.input.store.updateAgentRun(run.id, {
          status: 'superseded',
          deliveryStatus: 'suppressed',
          completedAt: new Date().toISOString(),
        });
      }
      return {
        claimed: false,
        dispatch: false,
        runId: run.id,
        reason:
          ownership.state.generation === job.generation
            ? 'ownership_lost'
            : 'stale_generation',
      };
    }

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

    return { claimed: true, dispatch: true, runId: run.id };
  }

  async claimDueRuns(now: string): Promise<
    Array<
      {
        sessionId: string;
        generation: number;
      } & AgentRunWakeupClaimResult
    >
  > {
    const states = await this.input.store.listDueSessionAgentStates(
      now,
      this.recoveryLimit(),
    );
    const results: Array<
      {
        sessionId: string;
        generation: number;
      } & AgentRunWakeupClaimResult
    > = [];
    for (const state of states) {
      const result = await this.claimWakeupRun({
        channel: 'agent_run_wakeup',
        sessionId: state.sessionId,
        generation: state.generation,
        dueAt: state.debounceDeadlineAt ?? now,
        queuedAt: now,
      });
      results.push({
        sessionId: state.sessionId,
        generation: state.generation,
        ...result,
      });
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

function executionDispatchDecision(run: {
  status: string;
  executionAttempt: number;
  irreversibleSideEffectAt: string | null;
  irreversibleToolName: string | null;
  executionLeaseExpiresAt: string | null;
}): { dispatch: boolean; reason: string } {
  if (run.status === 'scheduled') {
    if (run.executionAttempt >= MAXIMUM_AGENT_RUN_EXECUTION_ATTEMPTS) {
      return { dispatch: false, reason: 'attempts_exhausted' };
    }
    if (
      run.irreversibleSideEffectAt !== null ||
      run.irreversibleToolName !== null
    ) {
      return { dispatch: false, reason: 'irreversible_outcome_unknown' };
    }
    return { dispatch: true, reason: 'already_claimed' };
  }
  if (run.status !== 'running') {
    return { dispatch: false, reason: 'already_claimed' };
  }
  const expiry =
    run.executionLeaseExpiresAt === null
      ? Number.NaN
      : Date.parse(run.executionLeaseExpiresAt);
  if (!Number.isFinite(expiry) || expiry > Date.now()) {
    return { dispatch: false, reason: 'execution_in_progress' };
  }
  if (
    run.irreversibleSideEffectAt !== null ||
    run.irreversibleToolName !== null
  ) {
    return { dispatch: true, reason: 'reconciliation_pending' };
  }
  if (run.executionAttempt >= MAXIMUM_AGENT_RUN_EXECUTION_ATTEMPTS) {
    return { dispatch: true, reason: 'reconciliation_pending' };
  }
  return { dispatch: true, reason: 'execution_lease_expired' };
}
