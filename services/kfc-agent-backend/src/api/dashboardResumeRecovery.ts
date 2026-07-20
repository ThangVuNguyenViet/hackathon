import { AgentRunCoordinator } from '../agentRuns/coordinator.js';
import type { ConversationEvent } from '../channels/conversationEvent.js';
import type { DashboardEventBus } from '../dashboard/eventBus.js';
import type { ConversationTurn } from '../domain/types.js';
import type { ConversationStore } from '../persistence/memoryStore.js';
import { dashboardSessionTarget } from '../dashboard/sessionVisibility.js';

export interface DashboardResumeRecovery {
  queued: boolean;
  pendingTurnId?: string;
  generation?: number;
}

export async function enqueueDashboardResumeRecovery(input: {
  sessionId: string;
  store: ConversationStore;
  dashboard: DashboardEventBus;
  defer?: (task: () => Promise<void>) => void;
  processAgentRun(runId: string): Promise<unknown>;
}): Promise<DashboardResumeRecovery> {
  const pendingTurn = latestUnansweredCustomerTurn(
    await input.store.listTurns(input.sessionId),
  );
  const target = dashboardSessionTarget(input.sessionId);
  if (
    !pendingTurn ||
    !pendingTurn.externalMessageId ||
    !pendingTurn.externalUserId ||
    (target?.channel !== 'messenger' && target?.channel !== 'zalo')
  ) {
    return { queued: false };
  }

  const coordinator = new AgentRunCoordinator({
    store: input.store,
    dashboard: input.dashboard,
    options: { debounceWindowMs: 0 },
  });
  const wakeup = await coordinator.recordPendingTurn(
    recoveryConversationEvent({
      turn: pendingTurn,
      channel: target.channel,
      externalMessageId: pendingTurn.externalMessageId,
      externalUserId: pendingTurn.externalUserId,
    }),
    input.sessionId,
  );
  scheduleRecovery(input, async () => {
    const control = await input.store.getSessionControl(input.sessionId);
    if (control.agentMode !== 'ai_active') return;
    const claimed = await coordinator.claimWakeupRun(wakeup);
    if (claimed.claimed && claimed.runId) {
      await input.processAgentRun(claimed.runId);
    }
  });
  return {
    queued: true,
    pendingTurnId: pendingTurn.id,
    generation: wakeup.generation,
  };
}

function latestUnansweredCustomerTurn(
  turns: readonly ConversationTurn[],
): ConversationTurn | undefined {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn?.role === 'assistant') return undefined;
    if (turn?.role === 'user') return turn;
  }
  return undefined;
}

function recoveryConversationEvent(input: {
  turn: ConversationTurn,
  channel: 'messenger' | 'zalo',
  externalMessageId: string;
  externalUserId: string;
}): ConversationEvent {
  return {
    channel: input.channel,
    externalUserId: input.externalUserId,
    externalThreadId: input.externalUserId,
    text: input.turn.text,
    eventType: 'message',
    rawEventId: input.externalMessageId,
    receivedAt: input.turn.createdAt,
    shouldRunAgent: true,
  };
}

function scheduleRecovery(
  input: {
    sessionId: string;
    store: ConversationStore;
    defer?: (task: () => Promise<void>) => void;
  },
  task: () => Promise<void>,
): void {
  const guardedTask = async () => {
    try {
      await task();
    } catch (error) {
      await input.store.appendEvent(
        input.sessionId,
        'agent:resume_recovery_failed',
        {
          errorCode: 'resume_recovery_failed',
          message: error instanceof Error ? error.message : String(error),
        },
      );
    }
  };
  if (input.defer) input.defer(guardedTask);
  else queueMicrotask(() => void guardedTask());
}
