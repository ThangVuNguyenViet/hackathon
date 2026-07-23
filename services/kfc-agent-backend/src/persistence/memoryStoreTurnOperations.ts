import type { ConversationTurn } from '../domain/types.js';
import type { AppendConversationTurnInput } from './contracts.js';

export async function appendMemoryConversationTurn(input: {
  turn: AppendConversationTurnInput;
  turns: ConversationTurn[];
}): Promise<ConversationTurn> {
  const existing = input.turn.id
    ? input.turns.find((turn) => turn.id === input.turn.id)
    : undefined;
  if (existing) return structuredClone(existing);
  const turn: ConversationTurn = {
    ...input.turn,
    metadata: input.turn.metadata ?? null,
    id: input.turn.id ?? `turn_${input.turns.length + 1}`,
    ordinal:
      input.turns
        .filter((turn) => turn.sessionId === input.turn.sessionId)
        .reduce((maximum, turn) => Math.max(maximum, turn.ordinal), 0) + 1,
    createdAt:
      input.turn.createdAt ??
      new Date('2026-07-07T00:00:00.000Z').toISOString(),
  };
  input.turns.push(turn);
  return turn;
}
