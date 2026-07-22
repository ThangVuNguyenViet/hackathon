import type {
  ChannelMediaDeliveryResult,
  ChannelTextOutcomeClient,
  ChannelTextSendOutcome,
  ExternalClients,
} from '../clients/interfaces.js';
import type { DashboardEventBus } from '../dashboard/eventBus.js';
import type {
  ConversationStore,
  RunCommitFence,
} from '../persistence/memoryStore.js';
import {
  createPendingAgentRunTextDelivery,
  type AgentRunTextDeliveryExecutionBinding,
  type AgentRunTextDeliveryRecord,
} from '../persistence/agentRunTextDelivery.js';
import type { ChannelPresentationPlan } from '../presentation/channelPresentation.js';

export interface ChannelTextDeliveryRuntimeResult {
  outcome: ChannelTextSendOutcome;
  replayed: boolean;
  suppressed: boolean;
}

export interface DeliverChannelAssistantReplyInput {
  clients: Pick<ExternalClients, 'messenger' | 'zalo'>;
  sessionId: string;
  externalUserId: string;
  presentation: ChannelPresentationPlan;
  channel: 'messenger' | 'zalo';
  assistantTurnId: string;
  runGuard: {
    isCurrent(): Promise<boolean>;
    commitFence: Extract<RunCommitFence, { kind: 'agent_run' }>;
  };
}

export interface DeliverChannelAssistantReplyResult {
  ok: boolean;
  suppressed?: boolean;
  externalMessageId?: string | null;
  errorCode?: string;
  errorMessage?: string;
}

export async function deliverChannelAssistantReply(input: {
  store: ConversationStore;
  dashboard: DashboardEventBus;
  delivery: DeliverChannelAssistantReplyInput;
}): Promise<DeliverChannelAssistantReplyResult> {
  const { store, dashboard, delivery } = input;
  if (!(await delivery.runGuard.isCurrent())) {
    dashboard.emitEvent({
      id: `dash_${delivery.sessionId}_assistant_suppressed_${Date.now()}`,
      sessionId: delivery.sessionId,
      type: 'agent_run_delivery_suppressed',
      payload: {
        reason: 'stale_agent_run',
        assistantTurnId: delivery.assistantTurnId,
      },
      createdAt: new Date().toISOString(),
    });
    return {
      ok: false,
      suppressed: true,
      errorCode: 'stale_agent_run',
      errorMessage: 'Agent run is no longer current',
    };
  }

  const commitFence = delivery.runGuard.commitFence;
  if (commitFence?.kind !== 'agent_run') {
    return {
      ok: false,
      errorCode: 'agent_run_delivery_fence_required',
      errorMessage: 'AgentRun delivery authority is required',
    };
  }
  const run = await store.getAgentRun(commitFence.runId);
  const assistantTurn = (await store.listTurns(delivery.sessionId)).find(
    (turn) => turn.id === delivery.assistantTurnId,
  );
  if (
    typeof delivery.assistantTurnId !== 'string' ||
    delivery.assistantTurnId.trim().length === 0 ||
    !run ||
    run.sessionId !== delivery.sessionId ||
    run.channel !== delivery.channel ||
    run.externalUserId !== delivery.externalUserId ||
    run.generation !== commitFence.generation ||
    run.sessionAuthorityGeneration !== commitFence.sessionAuthorityGeneration ||
    run.executionAttempt !== commitFence.executionAttempt ||
    run.executionLeaseToken !== commitFence.executionLeaseToken ||
    run.assistantTurnId !== delivery.assistantTurnId ||
    assistantTurn?.sessionId !== delivery.sessionId ||
    assistantTurn.channel !== delivery.channel ||
    assistantTurn.role !== 'assistant'
  ) {
    return {
      ok: false,
      errorCode: 'agent_run_delivery_assistant_authority_invalid',
      errorMessage: 'AgentRun assistant delivery authority is invalid',
    };
  }

  const textDelivery = await sendChannelTextWithAgentRunDelivery({
    store,
    client:
      delivery.channel === 'messenger'
        ? delivery.clients.messenger
        : delivery.clients.zalo,
    channel: delivery.channel,
    recipientId: delivery.externalUserId,
    text: delivery.presentation.text,
    assistantTurnId: delivery.assistantTurnId,
    commitFence,
  });
  const textSent = textDelivery.outcome.status === 'confirmed_sent';
  const turnDeliveryStatus =
    textDelivery.outcome.status === 'confirmed_sent'
      ? 'sent'
      : textDelivery.outcome.status === 'delivery_outcome_unknown'
        ? 'outcome_unknown'
        : 'failed';
  await store.updateTurnDeliveryStatus(
    delivery.assistantTurnId,
    turnDeliveryStatus,
    textDelivery.outcome.status === 'confirmed_sent'
      ? textDelivery.outcome.messageId
      : null,
  );

  let mediaResult: ChannelMediaDeliveryResult | undefined;
  if (
    textSent &&
    !textDelivery.replayed &&
    delivery.presentation.media?.length
  ) {
    try {
      mediaResult =
        delivery.channel === 'messenger'
          ? await delivery.clients.messenger.sendMedia?.(
              delivery.externalUserId,
              delivery.presentation.media,
            )
          : await delivery.clients.zalo.sendMedia?.(
              delivery.externalUserId,
              delivery.presentation.media,
            );
    } catch {
      mediaResult = {
        status: 'failed',
        items: delivery.presentation.media.map((item) => ({
          key: item.key,
          status: 'failed',
          errorCode: `${delivery.channel}_media_send_failed`,
          errorMessage: `${delivery.channel} media delivery failed`,
        })),
      };
    }
  }
  const mediaDeliveryStatus = delivery.presentation.media?.length
    ? (mediaResult?.status ?? 'failed')
    : 'not_requested';
  const safeMediaItems = (mediaResult?.items ?? []).map((item) =>
    item.status === 'sent'
      ? item
      : {
          key: item.key,
          status: 'failed' as const,
          errorCode: `${delivery.channel}_media_send_failed`,
          errorMessage: `${delivery.channel} media delivery failed`,
        },
  );

  dashboard.emitEvent({
    id: `dash_${delivery.sessionId}_assistant_${Date.now()}`,
    sessionId: delivery.sessionId,
    type: 'assistant_reply_sent',
    payload: {
      deliveryStatus: turnDeliveryStatus,
      textDeliveryStatus: turnDeliveryStatus,
      textDeliveryOutcome: textDelivery.outcome.status,
      textDeliveryReplayed: textDelivery.replayed,
      mediaDeliveryStatus,
      mediaItems: safeMediaItems,
    },
    createdAt: new Date().toISOString(),
  });

  return {
    ok: textSent,
    ...(textDelivery.suppressed ? { suppressed: true } : {}),
    externalMessageId:
      textDelivery.outcome.status === 'confirmed_sent'
        ? textDelivery.outcome.messageId
        : null,
    ...(textDelivery.outcome.status === 'confirmed_sent'
      ? {}
      : {
          errorCode: textDelivery.outcome.errorCode,
          errorMessage: textDelivery.outcome.message,
        }),
  };
}

export async function sendChannelTextWithAgentRunDelivery(input: {
  store: ConversationStore;
  client: ChannelTextOutcomeClient;
  channel: 'messenger' | 'zalo';
  recipientId: string;
  text: string;
  assistantTurnId: string;
  commitFence?: RunCommitFence;
}): Promise<ChannelTextDeliveryRuntimeResult> {
  if (input.commitFence?.kind !== 'agent_run') {
    return blockedOutcome('agent_run_delivery_fence_required');
  }

  const execution: AgentRunTextDeliveryExecutionBinding = {
    runId: input.commitFence.runId,
    executionAttempt: input.commitFence.executionAttempt,
    executionLeaseToken: input.commitFence.executionLeaseToken,
  };
  const existing = await input.store.getAgentRunTextDelivery(execution.runId);
  if (existing) {
    const candidate = await createPendingAgentRunTextDelivery({
      execution,
      channel: input.channel,
      assistantTurnId: input.assistantTurnId,
      recipientId: input.recipientId,
      presentationText: input.text,
      createdAt: new Date().toISOString(),
    });
    if (!sameImmutableDeliveryBinding(existing, candidate)) {
      return blockedOutcome('agent_run_text_delivery_binding_conflict');
    }
    if (existing.status === 'confirmed_sent') {
      return {
        outcome: {
          status: 'confirmed_sent',
          messageId: existing.providerMessageId,
        },
        replayed: true,
        suppressed: false,
      };
    }
    if (
      existing.status === 'sending' ||
      existing.status === 'delivery_outcome_unknown'
    ) {
      return unknownOutcome(
        existing.outcomeCode ?? 'agent_run_text_delivery_outcome_unknown',
        true,
      );
    }
  }

  const created = await input.store.createAgentRunTextDelivery({
    execution,
    channel: input.channel,
    assistantTurnId: input.assistantTurnId,
    recipientId: input.recipientId,
    presentationText: input.text,
    createdAt: new Date().toISOString(),
  });
  if (created.status === 'stale') {
    return {
      ...blockedOutcome('stale_agent_run'),
      suppressed: true,
    };
  }
  if (created.status === 'conflict') {
    return blockedOutcome('agent_run_text_delivery_binding_conflict');
  }
  if (!created.record) {
    return blockedOutcome('agent_run_text_delivery_record_missing');
  }
  const deliveryAttemptToken = crypto.randomUUID();
  const begun = await input.store.beginAgentRunTextDeliveryAttempt({
    execution,
    nextDeliveryAttempt: created.record.deliveryAttempt + 1,
    deliveryAttemptToken,
    updatedAt: new Date().toISOString(),
  });
  if (begun.status === 'dispatch_blocked') {
    if (begun.reason === 'confirmed_sent') {
      const replay = await input.store.getAgentRunTextDelivery(execution.runId);
      if (
        replay?.status === 'confirmed_sent' &&
        sameImmutableDeliveryBinding(replay, created.record)
      ) {
        return {
          outcome: {
            status: 'confirmed_sent',
            messageId: replay.providerMessageId,
          },
          replayed: true,
          suppressed: false,
        };
      }
    }
    if (
      begun.reason === 'sending_in_progress' ||
      begun.reason === 'delivery_outcome_unknown'
    ) {
      return unknownOutcome(`agent_run_text_delivery_${begun.reason}`, true);
    }
    return blockedOutcome(`agent_run_text_delivery_${begun.reason}`);
  }

  const outcome = await sendTextOutcome(input);
  try {
    const completed = await input.store.completeAgentRunTextDeliveryAttempt({
      execution,
      deliveryAttempt: begun.record.deliveryAttempt,
      deliveryAttemptToken,
      outcome,
      updatedAt: new Date().toISOString(),
    });
    if (completed.status === 'transitioned') {
      return {
        outcome,
        replayed: false,
        suppressed: false,
      };
    }
  } catch {
    // The exact durable sending claim below is the only safe fallback.
  }

  const reconciled = await input.store.reconcileAgentRunTextDelivery({
    execution,
    outcomeCode: 'agent_run_text_delivery_completion_unknown',
    updatedAt: new Date().toISOString(),
  });
  return unknownOutcome(
    reconciled.status === 'reconciliation_blocked'
      ? `agent_run_text_delivery_${reconciled.reason}`
      : reconciled.record.outcomeCode,
    false,
  );
}

async function sendTextOutcome(input: {
  client: ChannelTextOutcomeClient;
  recipientId: string;
  text: string;
  channel: 'messenger' | 'zalo';
}): Promise<ChannelTextSendOutcome> {
  try {
    return await input.client.sendTextWithOutcome(
      input.recipientId,
      input.text,
    );
  } catch (error) {
    return {
      status: 'delivery_outcome_unknown',
      errorCode: `${input.channel}_delivery_outcome_unknown`,
      message:
        error instanceof Error
          ? error.message
          : `${input.channel} delivery outcome is unknown`,
    };
  }
}

function sameImmutableDeliveryBinding(
  left: AgentRunTextDeliveryRecord,
  right: AgentRunTextDeliveryRecord,
): boolean {
  return (
    left.channel === right.channel &&
    left.assistantTurnId === right.assistantTurnId &&
    left.recipientBindingDigest === right.recipientBindingDigest &&
    left.presentationBindingDigest === right.presentationBindingDigest
  );
}

function blockedOutcome(errorCode: string): ChannelTextDeliveryRuntimeResult {
  return {
    outcome: {
      status: 'not_dispatched',
      errorCode,
      message: 'Channel text dispatch was not authorized',
    },
    replayed: false,
    suppressed: false,
  };
}

function unknownOutcome(
  errorCode: string,
  replayed: boolean,
): ChannelTextDeliveryRuntimeResult {
  return {
    outcome: {
      status: 'delivery_outcome_unknown',
      errorCode,
      message: 'Channel text delivery outcome requires reconciliation',
    },
    replayed,
    suppressed: false,
  };
}
