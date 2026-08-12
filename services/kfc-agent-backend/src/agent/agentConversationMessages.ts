import type { BaseMessage } from '@langchain/core/messages';
import {
  AIMessage,
  HumanMessage,
} from '@langchain/core/messages';
import type { ConversationTurn } from '../domain/types.js';
import type { AgentTurnInput } from '../businesses/kfc/turnContracts.js';
import type { AgentGraphState } from '../graph/state.js';
import {
  semanticConversationTurns,
} from './trustedActionConversation.js';

export function freshMessages(
  state: AgentGraphState,
  input: AgentTurnInput,
  currentUserTurn: ConversationTurn | undefined,
): BaseMessage[] {
  const recentTurns = semanticConversationTurns(state.recentTurns ?? []);
  const history: BaseMessage[] = [];
  const appendTurnMessage = (turn: ConversationTurn): void => {
    if (turn.role === 'user') {
      history.push(new HumanMessage({
        id: `conversation:${turn.id}`,
        content: turn.text,
      }));
    } else if (turn.role === 'assistant') {
      history.push(new AIMessage({
        id: `conversation:${turn.id}`,
        content: turn.text,
      }));
    }
  };
  if (input.trustedCustomerAction) {
    for (const turn of recentTurns) appendTurnMessage(turn);
    return history;
  }
  if (!currentUserTurn) throw new Error('agent_current_user_turn_missing');
  const currentTurnIndex = recentTurns.findIndex(
    (turn) => turn.id === currentUserTurn.id,
  );
  if (currentTurnIndex < 0) {
    throw new Error('agent_current_user_turn_missing');
  }
  for (const turn of recentTurns.slice(0, currentTurnIndex)) {
    appendTurnMessage(turn);
  }
  return [
    ...history,
    new HumanMessage({
      id: `conversation:${currentUserTurn.id}`,
      content: currentUserTurn.text,
    }),
  ];
}

export function messageText(message: BaseMessage | undefined): string {
  if (!message) return '';
  if (typeof message.content === 'string') return message.content.trim();
  return message.content
    .flatMap((part) =>
      typeof part === 'object' &&
      part !== null &&
      'text' in part &&
      typeof part.text === 'string'
        ? [part.text]
        : [],
    )
    .join('')
    .trim();
}
