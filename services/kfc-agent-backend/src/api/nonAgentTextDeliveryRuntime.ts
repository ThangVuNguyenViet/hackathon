import type {
  ChannelTextOutcomeClient,
  ChannelTextSendOutcome,
} from '../clients/interfaces.js';
import type { ConversationTurn } from '../domain/types.js';
import type { ConversationStore } from '../persistence/memoryStore.js';
import type { NonAgentTextDeliveryRecord } from '../persistence/nonAgentTextDelivery.js';

type NonAgentTextChannel = 'kfc' | 'messenger' | 'zalo';
const sendingLeaseMilliseconds = 30_000;

interface DeliveryIdentity {
  assistantTurnId: string;
  requestKey: string;
}

export interface NonAgentTextDeliveryResult {
  ok: boolean;
  turn?: ConversationTurn;
  created: boolean;
  replayed: boolean;
  externalMessageId?: string | null;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * Reserves and publishes a human-authored outbound message independently of
 * the AI AgentRun lifecycle. Its dedicated durable CAS journal contains opaque
 * digests and never the raw session/recipient, message text, agent ID, or
 * provider error.
 */
export async function deliverNonAgentText(input: {
  store: ConversationStore;
  client?: ChannelTextOutcomeClient;
  channel: NonAgentTextChannel;
  sessionId: string;
  clientRequestId: string;
  agentId: string;
  expectedSessionAuthorityGeneration: number;
  recipientId: string;
  text: string;
}): Promise<NonAgentTextDeliveryResult> {
  const identity = await deliveryIdentity(input);
  const now = new Date();
  const reservation = await input.store.reserveNonAgentTextDelivery({
    requestKey: identity.requestKey,
    sessionId: input.sessionId,
    expectedSessionAuthorityGeneration:
      input.expectedSessionAuthorityGeneration,
    expectedAgentId: input.agentId,
    channel: input.channel,
    assistantTurnId: identity.assistantTurnId,
    recipientId: input.recipientId,
    presentationText: input.text,
    createdAt: now.toISOString(),
  });
  if (reservation.status !== 'reserved' && reservation.status !== 'replay') {
    return failedResult(
      reservation.status === 'stale_authority'
        ? 'human_message_session_authority_stale'
        : 'human_message_idempotency_conflict',
    );
  }
  let record = reservation.record;
  if (
    record.status === 'sending' &&
    record.sendingLeaseExpiresAt <= now.toISOString()
  ) {
    const reconciled = await input.store.reconcileNonAgentTextDelivery({
      requestKey: record.requestKey,
      sessionId: input.sessionId,
      deliveryAttempt: record.deliveryAttempt,
      deliveryAttemptToken: record.deliveryAttemptToken,
      reason: 'sending_lease_expired',
      reconciledAt: now.toISOString(),
    });
    if (reconciled.status === 'reconciled' || reconciled.status === 'replay') {
      record = reconciled.record;
    }
  }
  if (
    record.status === 'confirmed_sent' ||
    record.status === 'outcome_unknown' ||
    record.status === 'sending'
  ) {
    return replayExisting(input.store, input.sessionId, record);
  }

  const client =
    input.channel === 'kfc' ? undefined : availableClient(input.client);
  if (input.channel !== 'kfc' && !client) {
    return failedResult('human_message_delivery_client_missing');
  }
  let prepared;
  try {
    prepared = await input.store.prepareNonAgentTextDeliveryTurn({
      requestKey: record.requestKey,
      sessionId: input.sessionId,
      expectedSessionAuthorityGeneration:
        input.expectedSessionAuthorityGeneration,
      expectedAgentId: input.agentId,
      turn: {
        id: identity.assistantTurnId,
        ordinal: 0,
        sessionId: input.sessionId,
        channel: input.channel,
        role: 'assistant',
        text: input.text,
        externalMessageId: null,
        externalUserId: input.recipientId,
        deliveryStatus: 'pending',
        metadata: { authorType: 'human_agent', agentId: input.agentId },
        createdAt: record.createdAt,
      },
    });
  } catch {
    return failedResult('human_message_turn_persistence_failed');
  }
  if (prepared.status === 'prepare_blocked') {
    return failedResult(
      prepared.reason === 'stale_authority'
        ? 'human_message_session_authority_stale'
        : prepared.reason === 'turn_binding_conflict'
          ? 'human_message_turn_binding_conflict'
          : `human_message_delivery_${prepared.reason}`,
      prepared.turn,
    );
  }
  const turn = prepared.turn;

  const startedAt = new Date();
  const begun = await input.store.beginNonAgentTextDeliveryAttempt({
    requestKey: record.requestKey,
    sessionId: input.sessionId,
    expectedSessionAuthorityGeneration:
      input.expectedSessionAuthorityGeneration,
    expectedAgentId: input.agentId,
    nextDeliveryAttempt: record.deliveryAttempt + 1,
    deliveryAttemptToken: crypto.randomUUID(),
    leaseExpiresAt: new Date(
      startedAt.getTime() + sendingLeaseMilliseconds,
    ).toISOString(),
    updatedAt: startedAt.toISOString(),
  });
  if (begun.status === 'dispatch_blocked') {
    return replayOrBlocked(
      input.store,
      input.sessionId,
      begun.record,
      turn,
      begun.reason,
    );
  }

  const outcome =
    input.channel === 'kfc'
      ? ({ status: 'confirmed_sent', messageId: '' } as const)
      : await safeOutcome({
          client: client!,
          channel: input.channel,
          recipientId: input.recipientId,
          text: input.text,
        });
  let completed;
  try {
    completed = await input.store.completeNonAgentTextDeliveryAttempt({
      requestKey: begun.record.requestKey,
      sessionId: input.sessionId,
      deliveryAttempt: begun.record.deliveryAttempt,
      deliveryAttemptToken: begun.record.deliveryAttemptToken,
      outcome,
      updatedAt: new Date().toISOString(),
    });
  } catch {
    const reconciled = await input.store.reconcileNonAgentTextDelivery({
      requestKey: begun.record.requestKey,
      sessionId: input.sessionId,
      deliveryAttempt: begun.record.deliveryAttempt,
      deliveryAttemptToken: begun.record.deliveryAttemptToken,
      reason: 'completion_persistence_failed',
      reconciledAt: new Date().toISOString(),
    });
    return reconciled.status === 'reconciled' || reconciled.status === 'replay'
      ? replayExisting(input.store, input.sessionId, reconciled.record)
      : failedResult('human_message_delivery_outcome_unknown', turn);
  }
  if (completed.status !== 'transitioned') {
    return replayOrBlocked(
      input.store,
      input.sessionId,
      completed.record,
      turn,
      completed.reason,
    );
  }
  record = completed.record;
  const deliveryStatus =
    record.status === 'confirmed_sent'
      ? 'sent'
      : record.status === 'outcome_unknown'
        ? 'outcome_unknown'
        : 'failed';
  const externalMessageId =
    record.status === 'confirmed_sent' ? record.providerMessageId : null;
  const updatedTurn = await input.store.updateTurnDeliveryStatus(
    turn.id,
    deliveryStatus,
    externalMessageId,
  );

  if (record.status === 'confirmed_sent') {
    return {
      ok: true,
      turn: updatedTurn,
      created: true,
      replayed: false,
      externalMessageId,
    };
  }

  return {
    ok: false,
    turn: updatedTurn,
    created: true,
    replayed: false,
    externalMessageId: null,
    errorCode: record.outcomeCode,
    errorMessage: 'Human message delivery was not confirmed',
  };
}

/**
 * Completes a text send whose idempotent owner is an already-reserved inbound
 * webhook delivery. It must not be used by dashboard/public outbound routes.
 */
export async function deliverWebhookOwnedNonAgentText(input: {
  store: ConversationStore;
  client: ChannelTextOutcomeClient;
  channel: 'messenger' | 'zalo';
  assistantTurnId: string;
  recipientId: string;
  text: string;
}): Promise<NonAgentTextDeliveryResult> {
  const outcome = await safeOutcome(input);
  const deliveryStatus =
    outcome.status === 'confirmed_sent'
      ? 'sent'
      : outcome.status === 'delivery_outcome_unknown'
        ? 'outcome_unknown'
        : 'failed';
  const externalMessageId =
    outcome.status === 'confirmed_sent' ? outcome.messageId : null;
  const turn = await input.store.updateTurnDeliveryStatus(
    input.assistantTurnId,
    deliveryStatus,
    externalMessageId,
  );
  return outcome.status === 'confirmed_sent'
    ? {
        ok: true,
        turn,
        created: false,
        replayed: false,
        externalMessageId,
      }
    : {
        ok: false,
        turn,
        created: false,
        replayed: false,
        externalMessageId: null,
        errorCode: outcome.errorCode,
        errorMessage: 'Webhook-owned text delivery was not confirmed',
      };
}

async function replayExisting(
  store: ConversationStore,
  sessionId: string,
  record: NonAgentTextDeliveryRecord,
): Promise<NonAgentTextDeliveryResult> {
  let turn = (await store.listTurns(sessionId)).find(
    (candidate) => candidate.id === record.assistantTurnId,
  );
  if (record.status === 'confirmed_sent') {
    if (
      turn &&
      (turn.deliveryStatus !== 'sent' ||
        turn.externalMessageId !== record.providerMessageId)
    ) {
      turn = await store.updateTurnDeliveryStatus(
        turn.id,
        'sent',
        record.providerMessageId,
      );
    }
    return {
      ok: true,
      turn,
      created: false,
      replayed: true,
      externalMessageId: record.providerMessageId,
    };
  }
  if (record.status === 'outcome_unknown') {
    if (turn && turn.deliveryStatus !== 'outcome_unknown') {
      turn = await store.updateTurnDeliveryStatus(
        turn.id,
        'outcome_unknown',
        null,
      );
    }
    return failedResult(
      record.outcomeCode ?? 'human_message_delivery_outcome_unknown',
      turn,
      true,
    );
  }
  return failedResult(
    record.status === 'sending'
      ? 'human_message_delivery_in_progress'
      : (record.outcomeCode ?? 'human_message_delivery_not_confirmed'),
    turn,
    true,
  );
}

async function replayOrBlocked(
  store: ConversationStore,
  sessionId: string,
  record: NonAgentTextDeliveryRecord | undefined,
  turn: ConversationTurn | undefined,
  reason: string,
): Promise<NonAgentTextDeliveryResult> {
  return record
    ? replayExisting(store, sessionId, record)
    : failedResult(`human_message_delivery_${reason}`, turn, true);
}

function failedResult(
  errorCode: string,
  turn?: ConversationTurn,
  replayed = false,
): NonAgentTextDeliveryResult {
  return {
    ok: false,
    turn,
    created: false,
    replayed,
    externalMessageId: null,
    errorCode,
  };
}

async function deliveryIdentity(input: {
  channel: NonAgentTextChannel;
  sessionId: string;
  clientRequestId: string;
  agentId: string;
  recipientId: string;
  text: string;
}): Promise<DeliveryIdentity> {
  const requestScopeDigest = await digest([
    'non_agent_text_delivery_request_v1',
    input.channel,
    input.sessionId,
    input.clientRequestId,
  ]);
  const assistantTurnId = `turn_human_${requestScopeDigest}`;
  return {
    assistantTurnId,
    requestKey: requestScopeDigest,
  };
}

async function digest(value: readonly string[]): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function availableClient(
  client: ChannelTextOutcomeClient | undefined,
): ChannelTextOutcomeClient | undefined {
  return client && typeof client.sendTextWithOutcome === 'function'
    ? client
    : undefined;
}

async function safeOutcome(input: {
  client: ChannelTextOutcomeClient;
  channel: 'messenger' | 'zalo';
  recipientId: string;
  text: string;
}): Promise<ChannelTextSendOutcome> {
  try {
    return await input.client.sendTextWithOutcome(
      input.recipientId,
      input.text,
    );
  } catch {
    return {
      status: 'delivery_outcome_unknown',
      errorCode: `${input.channel}_delivery_outcome_unknown`,
      message: `${input.channel} delivery outcome is unknown`,
    };
  }
}
