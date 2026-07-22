import type { ConversationTurn } from '../domain/types.js';
import type { AppendConversationTurnInput } from './contracts.js';

export async function appendMemoryConversationTurn(input: {
  turn: AppendConversationTurnInput;
  turns: ConversationTurn[];
  appendEvent: (
    sessionId: string,
    sourceType: string,
    payload: Record<string, unknown>,
  ) => Promise<unknown>;
}): Promise<ConversationTurn> {
  const existing = input.turn.id
    ? input.turns.find((turn) => turn.id === input.turn.id)
    : undefined;
  if (existing) return structuredClone(existing);
  const turn: ConversationTurn = {
    ...input.turn,
    metadata: input.turn.metadata ?? null,
    id: input.turn.id ?? `turn_${input.turns.length + 1}`,
    createdAt:
      input.turn.createdAt ??
      new Date('2026-07-07T00:00:00.000Z').toISOString(),
  };
  input.turns.push(turn);
  await input.appendEvent(
    input.turn.sessionId,
    `conversation_turn:${input.turn.role}`,
    {
      text: input.turn.text,
      channel: input.turn.channel,
      deliveryStatus: input.turn.deliveryStatus,
      externalMessageId: input.turn.externalMessageId,
      externalUserId: input.turn.externalUserId,
      metadata: input.turn.metadata,
    },
  );
  return turn;
}
