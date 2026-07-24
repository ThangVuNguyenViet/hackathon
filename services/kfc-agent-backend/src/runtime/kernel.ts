import { isAIMessage } from '@langchain/core/messages';
import {
  createAgent,
  modelCallLimitMiddleware,
  toolCallLimitMiddleware,
  type AnyAgentMiddleware,
} from 'langchain';
import {
  validatePackStateEnvelope,
  type BusinessPackRegistry,
  type PackStateEnvelope,
  type TrustedPackBinding,
} from './businessPack.js';

const MAX_MODEL_CALLS_PER_RUN = 12;
const MAX_TOOL_CALLS_PER_RUN = 12;
// createAgent's internal graph counts more than model calls. Keep its guard
// above our explicit budgets so the stable middleware limits own termination.
const AGENT_RECURSION_LIMIT = 100;

export async function runSemanticKernel<TInput, TOutput, TState>(input: {
  registry: BusinessPackRegistry<TInput, TOutput, TState>;
  binding: TrustedPackBinding | unknown;
  packInput: TInput;
  stateEnvelope?: PackStateEnvelope<unknown>;
}): Promise<TOutput> {
  const pack = input.registry.resolve(input.binding);
  if (input.stateEnvelope) {
    await validatePackStateEnvelope(input.stateEnvelope, {
      packRef: pack.ref,
      schemaVersion: pack.stateSchemaVersion,
      parseState: (value) => pack.parseState(value),
    });
  }
  return pack.run(pack.scopeInput(input.packInput), async (invocation) => {
    const middleware: AnyAgentMiddleware[] = [
      ...(invocation.middleware ?? []),
      modelCallLimitMiddleware({
        runLimit: MAX_MODEL_CALLS_PER_RUN,
        exitBehavior: 'error',
      }),
      toolCallLimitMiddleware({
        runLimit: MAX_TOOL_CALLS_PER_RUN,
        exitBehavior: 'error',
      }),
    ];
    const agent = createAgent({
      model: invocation.model,
      tools: invocation.tools,
      systemPrompt: invocation.systemPrompt,
      middleware,
    });
    const invoke = () =>
      agent.invoke(
        { messages: invocation.messages },
        invocation.signal || invocation.runtime?.callbacks
          ? {
              recursionLimit: AGENT_RECURSION_LIMIT,
              ...(invocation.signal ? { signal: invocation.signal } : {}),
              ...(invocation.runtime?.callbacks
                ? { callbacks: invocation.runtime.callbacks }
                : {}),
            }
          : { recursionLimit: AGENT_RECURSION_LIMIT },
      );
    const result = invocation.runtime?.runWithContext
      ? await invocation.runtime.runWithContext(invoke)
      : await invoke();
    const response = result.messages.at(-1);
    if (!response || !isAIMessage(response)) {
      throw new Error(
        invocation.responseErrors?.invalid ??
          'semantic_kernel_model_response_invalid',
      );
    }
    const text = messageText(response);
    if (!text) {
      throw new Error(
        invocation.responseErrors?.empty ??
          'semantic_kernel_model_response_empty',
      );
    }
    return text;
  });
}

function messageText(message: {
  content: string | Array<{ text?: string } | unknown>;
}): string {
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
