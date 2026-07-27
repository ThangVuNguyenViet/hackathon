import type { ConversationStore } from '../persistence/contracts.js';
import { runDetachedWork } from '../runtime/deferredWork.js';
import {
  advanceConversationSummary,
  assembleConversationContext,
  completeConversationExchanges,
  type AsyncTokenCounter,
  type SummarizeConversationExchanges,
} from './conversationContext.js';

export function scheduleConversationCompaction(input: {
  store: Pick<
    ConversationStore,
    'listTurns' | 'getConversationSummary' | 'compareAndSwapConversationSummary'
  >;
  sessionId: string;
  tokenBudget: number;
  countTokens: AsyncTokenCounter;
  summarize: SummarizeConversationExchanges;
  deferWork?: (task: () => Promise<void>) => void;
  onError?: (error: unknown) => void;
}): void {
  const task = async () => {
    try {
      const [turns, summary] = await Promise.all([
        input.store.listTurns(input.sessionId),
        input.store.getConversationSummary(input.sessionId),
      ]);
      const exchanges = completeConversationExchanges(turns);
      const context = await assembleConversationContext({
        ...(summary ? { summary } : {}),
        exchanges,
        tokenBudget: input.tokenBudget,
        countTokens: input.countTokens,
      });
      if (context.omittedExchanges.length === 0) return;
      await advanceConversationSummary({
        store: input.store,
        sessionId: input.sessionId,
        exchanges: context.omittedExchanges,
        summarize: input.summarize,
      });
    } catch (error) {
      input.onError?.(error);
    }
  };

  try {
    if (input.deferWork) input.deferWork(task);
    else runDetachedWork(task);
  } catch (error) {
    input.onError?.(error);
  }
}
