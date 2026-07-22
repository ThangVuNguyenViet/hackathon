import type { ConversationTurn } from '../domain/types.js';
import { KFC_GENUI_SCHEMA_VERSION } from '../genui/kfcGenUi.js';
import type { AgentTurnInput } from './agentTurn.js';
import { emitDashboardEvent } from './turnSupport.js';
import {
  responseProfileForChannel,
  type ResponseProfile,
} from '../presentation/responseProfile.js';

export async function loadOrAppendAgentCurrentUserTurn(
  input: AgentTurnInput,
  responseProfile: ResponseProfile,
): Promise<ConversationTurn | undefined> {
  const existingTurns = await input.store.listTurns(input.sessionId);
  const conflictingTurn = existingTurns.find(
    (turn) =>
      (turn.metadata?.responseProfile ??
        responseProfileForChannel(turn.channel)) !== responseProfile,
  );
  if (conflictingTurn) {
    throw new Error(
      `session_response_profile_mismatch:${input.sessionId}:` +
        `${
          conflictingTurn.metadata?.responseProfile ??
          responseProfileForChannel(conflictingTurn.channel)
        }:` +
        responseProfile,
    );
  }

  let currentUserTurn = input.externalMessageId
    ? await input.store.findTurnByExternalMessage(
        input.sessionId,
        input.externalMessageId,
      )
    : undefined;
  if (currentUserTurn) {
    return currentUserTurn;
  }

  const currentTurnMetadata = input.trustedCustomerAction
    ? {
        rawEvent: {
          source: input.trustedCustomerAction.source,
          schemaVersion: KFC_GENUI_SCHEMA_VERSION,
          assistantTurnId: input.trustedCustomerAction.assistantTurnId,
          verifiedRevision: input.trustedCustomerAction.verifiedRevision,
          actionDigest: input.trustedCustomerAction.actionDigest,
        },
        ...(input.responseProfile
          ? { responseProfile: input.responseProfile }
          : {}),
      }
    : {
        ...(input.metadata ?? {}),
        ...(input.responseProfile
          ? { responseProfile: input.responseProfile }
          : {}),
      };
  currentUserTurn = await input.store.appendTurn({
    sessionId: input.sessionId,
    channel: input.channel,
    role: 'user',
    // A structured action is server-verified typed authority, not customer
    // prose. Persist only an empty audit turn so publication identity remains
    // durable without leaking synthetic UI action text into
    // conversation or model context.
    text: input.trustedCustomerAction ? '' : input.text,
    externalMessageId: input.externalMessageId ?? null,
    externalUserId: input.customerId,
    deliveryStatus: 'received',
    metadata:
      Object.keys(currentTurnMetadata).length > 0 ? currentTurnMetadata : null,
  });
  emitDashboardEvent(input, 'customer_message_received', {
    turnId: currentUserTurn.id,
    channel: currentUserTurn.channel,
    externalMessageId: currentUserTurn.externalMessageId,
    externalUserId: currentUserTurn.externalUserId,
    text: currentUserTurn.text,
    metadata: currentUserTurn.metadata,
  });
  emitDashboardEvent(input, 'conversation_turn_created', {
    turnId: currentUserTurn.id,
    role: currentUserTurn.role,
    channel: currentUserTurn.channel,
    deliveryStatus: currentUserTurn.deliveryStatus,
    externalMessageId: currentUserTurn.externalMessageId,
    externalUserId: currentUserTurn.externalUserId,
    text: currentUserTurn.text,
    metadata: currentUserTurn.metadata,
  });
  return currentUserTurn;
}
