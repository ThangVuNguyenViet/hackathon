import { describe, expect, it } from 'vitest';
import type { ConversationTurn } from '../../src/domain/types.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import {
  advanceConversationSummary,
  assembleConversationContext,
  completeConversationExchanges,
} from '../../src/session/conversationContext.js';

function turn(
  ordinal: number,
  role: ConversationTurn['role'],
  text: string,
  createdAt = '2026-07-01T00:00:00.000Z',
): ConversationTurn {
  return {
    id: `turn-${ordinal}`,
    ordinal,
    sessionId: 'session-a',
    channel: 'kfc',
    role,
    text,
    externalMessageId: null,
    externalUserId: 'customer-a',
    deliveryStatus: role === 'user' ? 'received' : 'sent',
    metadata: null,
    createdAt,
  };
}

describe('conversation context', () => {
  it('groups only complete exchanges in ordinal order and leaves the incoming user separate', () => {
    const turns = [
      turn(4, 'assistant', 'second answer'),
      turn(1, 'user', 'first question'),
      turn(5, 'user', 'incoming question'),
      turn(2, 'assistant', 'first answer'),
      turn(3, 'user', 'second question'),
    ];

    expect(completeConversationExchanges(turns)).toEqual([
      { turns: [turns[1], turns[3]], throughOrdinal: 2 },
      { turns: [turns[4], turns[0]], throughOrdinal: 4 },
    ]);
  });

  it('selects newest whole exchanges under an async token budget', async () => {
    const exchanges = completeConversationExchanges([
      turn(1, 'user', 'old-q'),
      turn(2, 'assistant', 'old-a'),
      turn(3, 'user', 'new-q'),
      turn(4, 'assistant', 'new-a'),
      turn(5, 'user', 'incoming'),
    ]);
    const counts = new Map([
      ['summary', 2],
      ['user:new-q\nassistant:new-a', 5],
      ['user:old-q\nassistant:old-a', 5],
    ]);

    const context = await assembleConversationContext({
      summary: {
        schemaVersion: 1,
        text: 'summary',
        throughOrdinal: 0,
        revision: 1,
        updatedAt: '2026-07-01T00:00:00.000Z',
      },
      exchanges,
      tokenBudget: 8,
      countTokens: async (text) => counts.get(text) ?? 100,
    });

    expect(context.summary?.text).toBe('summary');
    expect(context.exchanges.map((exchange) => exchange.throughOrdinal)).toEqual([
      4,
    ]);
    expect(context.omittedExchanges.map((exchange) => exchange.throughOrdinal)).toEqual([
      2,
    ]);
    expect(context.usedTokens).toBe(7);
  });

  it('fails safely without truncating when the newest exchange exceeds the budget', async () => {
    const exchanges = completeConversationExchanges([
      turn(1, 'user', 'small-q'),
      turn(2, 'assistant', 'small-a'),
      turn(3, 'user', 'oversized-q'),
      turn(4, 'assistant', 'oversized-a'),
    ]);

    const context = await assembleConversationContext({
      exchanges,
      tokenBudget: 3,
      countTokens: async (text) => (text.includes('oversized') ? 4 : 1),
    });

    expect(context.exchanges).toEqual([]);
    expect(context.omittedExchanges).toEqual(exchanges);
    expect(context.oversizedNewestExchange).toBe(true);
  });

  it('advances the summary only through complete exchanges and preserves it on failure', async () => {
    const store = new MemoryStore();
    const turns = [
      turn(1, 'user', 'first question'),
      turn(2, 'assistant', 'first answer'),
      turn(3, 'user', 'orphan'),
    ];
    const exchanges = completeConversationExchanges(turns);
    const committed = await advanceConversationSummary({
      store,
      sessionId: 'session-a',
      exchanges,
      summarize: async ({ exchanges: input }) =>
        input.flatMap((exchange) => exchange.turns.map((entry) => entry.text)).join(' | '),
      now: () => '2026-07-08T00:00:00.000Z',
    });

    expect(committed).toMatchObject({
      status: 'committed',
      summary: { throughOrdinal: 2, revision: 1 },
    });
    await expect(
      advanceConversationSummary({
        store,
        sessionId: 'session-a',
        exchanges: [
          ...exchanges,
          {
            turns: [turn(3, 'user', 'second'), turn(4, 'assistant', 'answer')],
            throughOrdinal: 4,
          },
        ],
        summarize: async () => {
          throw new Error('summary_model_failed');
        },
      }),
    ).rejects.toThrow('summary_model_failed');
    expect(await store.getConversationSummary('session-a')).toMatchObject({
      throughOrdinal: 2,
      revision: 1,
    });
  });

  it('rejects a malformed exchange instead of advancing its watermark', async () => {
    const store = new MemoryStore();

    await expect(
      advanceConversationSummary({
        store,
        sessionId: 'session-a',
        exchanges: [
          {
            turns: [turn(1, 'user', 'orphan')],
            throughOrdinal: 1,
          },
        ],
        summarize: async () => 'must not commit',
      }),
    ).rejects.toThrow('conversation_exchange_incomplete');
    expect(await store.getConversationSummary('session-a')).toBeUndefined();
  });

  it('retains week-old exchanges because context has no inactivity TTL', async () => {
    const context = await assembleConversationContext({
      exchanges: completeConversationExchanges([
        turn(1, 'user', 'week old', '2026-07-01T00:00:00.000Z'),
        turn(2, 'assistant', 'still relevant', '2026-07-01T00:01:00.000Z'),
      ]),
      tokenBudget: 100,
      countTokens: async () => 2,
    });

    expect(context.exchanges).toHaveLength(1);
    expect(context.exchanges[0]?.throughOrdinal).toBe(2);
  });

  it('returns typed authoritative business state separately from summarized context', async () => {
    const state = { cart: { id: 'cart-a', totalVnd: 120_000 } };
    const counted: string[] = [];
    const context = await assembleConversationContext({
      authoritativeState: state,
      exchanges: [],
      tokenBudget: 10,
      countTokens: async (text) => {
        counted.push(text);
        return 1;
      },
    });

    expect(context.authoritativeState).toEqual(state);
    expect(context.authoritativeState).not.toBe(state);
    expect(counted).toEqual([]);
  });
});
