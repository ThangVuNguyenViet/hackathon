import type { ConversationTurn } from '../domain/types.js';
import type {
  CompareAndSwapConversationSummaryResult,
  ConversationStore,
  ConversationSummary,
} from '../persistence/contracts.js';

export type AsyncTokenCounter = (text: string) => Promise<number>;

export interface ConversationExchange {
  turns: ConversationTurn[];
  throughOrdinal: number;
}

export interface AssembledConversationContext<TState = unknown> {
  summary?: ConversationSummary;
  exchanges: ConversationExchange[];
  omittedExchanges: ConversationExchange[];
  usedTokens: number;
  oversizedNewestExchange: boolean;
  /** Typed business authority is carried separately and is never summarized. */
  authoritativeState?: TState;
}

export function completeConversationExchanges(
  turns: readonly ConversationTurn[],
  afterOrdinal = 0,
): ConversationExchange[] {
  const ordered = [...turns]
    .filter(
      (turn) =>
        turn.ordinal > afterOrdinal &&
        (turn.role === 'user' || turn.role === 'assistant'),
    )
    .sort((left, right) => left.ordinal - right.ordinal);
  const exchanges: ConversationExchange[] = [];
  let pendingUsers: ConversationTurn[] = [];
  for (const turn of ordered) {
    if (turn.role === 'user') {
      pendingUsers.push(turn);
      continue;
    }
    if (pendingUsers.length === 0) continue;
    exchanges.push({
      turns: [...pendingUsers, turn],
      throughOrdinal: turn.ordinal,
    });
    pendingUsers = [];
  }
  return exchanges;
}

export function conversationExchangeTokenText(
  exchange: ConversationExchange,
): string {
  return exchange.turns.map((turn) => `${turn.role}:${turn.text}`).join('\n');
}

export async function assembleConversationContext<TState = never>(input: {
  summary?: ConversationSummary;
  exchanges: readonly ConversationExchange[];
  tokenBudget: number;
  countTokens: AsyncTokenCounter;
  authoritativeState?: TState;
}): Promise<AssembledConversationContext<TState>> {
  if (!Number.isSafeInteger(input.tokenBudget) || input.tokenBudget < 0) {
    throw new Error('conversation_context_token_budget_invalid');
  }
  let usedTokens = 0;
  let summary: ConversationSummary | undefined;
  if (input.summary) {
    const summaryTokens = await safeTokenCount(
      input.countTokens,
      input.summary.text,
    );
    if (summaryTokens <= input.tokenBudget) {
      summary = structuredClone(input.summary);
      usedTokens = summaryTokens;
    }
  }

  const eligible = input.exchanges.filter(
    (exchange) => exchange.throughOrdinal > (summary?.throughOrdinal ?? 0),
  );
  const selected: ConversationExchange[] = [];
  let oversizedNewestExchange = false;
  for (let index = eligible.length - 1; index >= 0; index -= 1) {
    const exchange = eligible[index]!;
    const tokens = await safeTokenCount(
      input.countTokens,
      conversationExchangeTokenText(exchange),
    );
    if (tokens > input.tokenBudget - usedTokens) {
      if (selected.length === 0) oversizedNewestExchange = true;
      break;
    }
    selected.unshift(structuredClone(exchange));
    usedTokens += tokens;
  }
  const selectedOrdinals = new Set(
    selected.map((exchange) => exchange.throughOrdinal),
  );
  return {
    ...(summary ? { summary } : {}),
    exchanges: selected,
    omittedExchanges: eligible
      .filter((exchange) => !selectedOrdinals.has(exchange.throughOrdinal))
      .map((exchange) => structuredClone(exchange)),
    usedTokens,
    oversizedNewestExchange,
    ...(input.authoritativeState === undefined
      ? {}
      : { authoritativeState: structuredClone(input.authoritativeState) }),
  };
}

export type SummarizeConversationExchanges = (input: {
  previousSummary?: string;
  exchanges: readonly ConversationExchange[];
}) => Promise<string>;

export async function advanceConversationSummary(input: {
  store: Pick<
    ConversationStore,
    'getConversationSummary' | 'compareAndSwapConversationSummary'
  >;
  sessionId: string;
  exchanges: readonly ConversationExchange[];
  summarize: SummarizeConversationExchanges;
  now?: () => string;
}): Promise<
  | CompareAndSwapConversationSummaryResult
  | {
      status: 'unchanged';
      summary?: ConversationSummary;
    }
> {
  const prior = await input.store.getConversationSummary(input.sessionId);
  for (const exchange of input.exchanges) {
    assertCompleteExchange(exchange);
  }
  const pending = input.exchanges.filter(
    (exchange) => exchange.throughOrdinal > (prior?.throughOrdinal ?? 0),
  );
  if (pending.length === 0) {
    return {
      status: 'unchanged',
      ...(prior ? { summary: prior } : {}),
    };
  }
  const text = (
    await input.summarize({
      ...(prior ? { previousSummary: prior.text } : {}),
      exchanges: pending.map((exchange) => structuredClone(exchange)),
    })
  ).trim();
  if (!text) throw new Error('conversation_summary_empty');
  return input.store.compareAndSwapConversationSummary({
    sessionId: input.sessionId,
    expectedRevision: prior?.revision ?? null,
    expectedThroughOrdinal: prior?.throughOrdinal ?? 0,
    text,
    throughOrdinal: pending.at(-1)!.throughOrdinal,
    updatedAt: input.now?.() ?? new Date().toISOString(),
  });
}

function assertCompleteExchange(exchange: ConversationExchange): void {
  const assistant = exchange.turns.at(-1);
  const users = exchange.turns.slice(0, -1);
  const ordered = exchange.turns.every(
    (turn, index) =>
      index === 0 || turn.ordinal > exchange.turns[index - 1]!.ordinal,
  );
  if (
    !assistant ||
    assistant.role !== 'assistant' ||
    users.length === 0 ||
    users.some((turn) => turn.role !== 'user') ||
    !ordered ||
    exchange.throughOrdinal !== assistant.ordinal
  ) {
    throw new Error('conversation_exchange_incomplete');
  }
}

async function safeTokenCount(
  countTokens: AsyncTokenCounter,
  text: string,
): Promise<number> {
  const count = await countTokens(text);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error('conversation_token_count_invalid');
  }
  return count;
}
