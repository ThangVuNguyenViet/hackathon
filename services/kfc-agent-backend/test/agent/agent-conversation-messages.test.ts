import { describe, expect, it } from 'vitest';
import { freshMessages } from '../../src/agent/agentConversationMessages.js';
import type { AgentState } from '../../src/agent/agentState.js';
import type { AgentTurnInput } from '../../src/agent/agentTurn.js';
import type { ConversationTurn } from '../../src/domain/types.js';

function turn(
  ordinal: number,
  role: 'user' | 'assistant',
  text: string,
): ConversationTurn {
  return {
    id: `turn-${ordinal}`,
    ordinal,
    sessionId: 'latest-user-last',
    channel: 'kfc',
    role,
    text,
    externalMessageId: null,
    externalUserId: null,
    deliveryStatus: 'not_applicable',
    metadata: null,
    createdAt: `2026-07-27T00:00:0${ordinal}.000Z`,
  };
}

describe('agent conversation message assembly', () => {
  it('keeps the current user turn last after compacted recent history', () => {
    const current = turn(4, 'user', 'current request');
    const messages = freshMessages(
      {
        recentTurns: [
          turn(1, 'user', 'older request'),
          turn(2, 'assistant', 'older response'),
        ],
      } as AgentState,
      {} as AgentTurnInput,
      current,
    );

    expect(messages.map(({ content }) => content)).toEqual([
      'older request',
      'older response',
      'current request',
    ]);
    expect(messages.at(-1)?.id).toBe('conversation:turn-4');
  });
});
