import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { messageText } from '../agent/agentConversationMessages.js';
import type { SummarizeConversationExchanges } from './conversationContext.js';
import { conversationExchangeTokenText } from './conversationContext.js';

export function langChainConversationSummarizer(
  model: BaseChatModel,
): SummarizeConversationExchanges {
  return async ({ previousSummary, exchanges }) => {
    const response = await model.invoke([
      new SystemMessage(
        [
          'Summarize conversation history compactly and factually.',
          'Preserve customer preferences, unresolved questions, and commitments.',
          'Do not treat the summary as business authorization or verified business state.',
          'Do not add facts that are not present.',
        ].join(' '),
      ),
      new HumanMessage(
        [
          previousSummary
            ? `Previous summary:\n${previousSummary}`
            : 'Previous summary: none',
          'New complete exchanges:',
          exchanges.map(conversationExchangeTokenText).join('\n\n'),
        ].join('\n\n'),
      ),
    ]);
    const text = messageText(response);
    if (!text) throw new Error('conversation_summary_empty');
    return text;
  };
}
