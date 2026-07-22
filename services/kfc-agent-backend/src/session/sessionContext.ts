import type { ConversationTurn } from '../domain/types.js';
import type { ConversationEvent } from '../channels/conversationEvent.js';

const defaultRecentTurnLimit = 8;

export function sessionIdForConversationEvent(
  event: Pick<ConversationEvent, 'channel' | 'externalThreadId'>,
): string {
  if (event.channel === 'messenger' || event.channel === 'zalo') {
    return `${event.channel}:${event.externalThreadId}`;
  }
  return event.externalThreadId;
}

export function buildBoundedRecentTurns(
  turns: ConversationTurn[],
  limit = defaultRecentTurnLimit,
): ConversationTurn[] {
  return turns
    .filter((turn) => turn.role === 'user' || turn.role === 'assistant')
    .slice(-limit);
}
