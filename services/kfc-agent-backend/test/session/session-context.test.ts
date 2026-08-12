import { describe, expect, it } from 'vitest';
import {
  buildBoundedRecentTurns,
  sessionIdForConversationEvent,
} from '../../src/session/sessionContext.js';
import type { ConversationTurn } from '../../src/domain/types.js';

describe('session context helpers', () => {
  it('derives channel-scoped session IDs from normalized channel events', () => {
    expect(
      sessionIdForConversationEvent({
        channel: 'messenger',
        externalThreadId: 'same_thread',
      }),
    ).toBe('messenger:same_thread');
    expect(
      sessionIdForConversationEvent({
        channel: 'zalo',
        externalThreadId: 'same_thread',
      }),
    ).toBe('zalo:same_thread');
  });

  it('builds bounded recent chat turns for prompt context', () => {
    const turns: ConversationTurn[] = [
      turn('old_user', 'user'),
      turn('old_assistant', 'assistant'),
      turn('tool_ignored', 'tool'),
      turn('system_ignored', 'system'),
      turn('u1', 'user'),
      turn('a1', 'assistant'),
      turn('u2', 'user'),
      turn('a2', 'assistant'),
      turn('u3', 'user'),
      turn('a3', 'assistant'),
      turn('u4', 'user'),
      turn('a4', 'assistant'),
      turn('latest_user', 'user'),
    ];

    expect(buildBoundedRecentTurns(turns).map((entry) => entry.text)).toEqual([
      'a1',
      'u2',
      'a2',
      'u3',
      'a3',
      'u4',
      'a4',
      'latest_user',
    ]);
  });
});

function turn(text: string, role: ConversationTurn['role']): ConversationTurn {
  return {
    id: `turn_${text}`,
    sessionId: 'session_1',
    channel: 'messenger',
    role,
    text,
    externalMessageId: null,
    externalUserId: 'psid_user_1',
    deliveryStatus: 'received',
    metadata: null,
    createdAt: `2026-07-09T00:00:${String(text.length).padStart(2, '0')}.000Z`,
  };
}
