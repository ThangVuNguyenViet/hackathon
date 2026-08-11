import {
  OpenAiResponsesExecutor,
  type OpenAiResponsesExecutorOptions,
} from './openAiResponsesExecutor.js';

/**
 * KFC constructor compatibility only. Business behavior is supplied by
 * `KfcAgentPack`; the inherited executor is business-neutral.
 */
export class OpenAiKfcAgent extends OpenAiResponsesExecutor {}

export type OpenAiKfcAgentOptions = OpenAiResponsesExecutorOptions;
export type {
  OpenAiResponsesExecutionResult as OpenAiKfcAgentExecutionResult,
  OpenAiResponsesLifecycleObserver as OpenAiKfcAgentLifecycleObserver,
  OpenAiResponsesToolCallTrace as OpenAiToolCallTrace,
  OpenAiResponsesTurnInput as OpenAiKfcAgentTurnInput,
  OpenAiResponsesTurnResult as OpenAiKfcAgentTurnResult,
  OpenAiResponsesUsage as OpenAiUsage,
} from './openAiResponsesExecutor.js';
