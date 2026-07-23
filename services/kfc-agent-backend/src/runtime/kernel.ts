import { isAIMessage } from '@langchain/core/messages';
import { createAgent } from 'langchain';
import {
  validatePackStateEnvelope,
  type BusinessPackRegistry,
  type PackStateEnvelope,
  type TrustedPackBinding,
} from './businessPack.js';

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
  return pack.run(input.packInput, async (invocation) => {
    const agent = createAgent({
      model: invocation.model,
      tools: invocation.tools,
      systemPrompt: invocation.systemPrompt,
    });
    const result = await agent.invoke(
      { messages: invocation.messages },
      invocation.signal ? { signal: invocation.signal } : undefined,
    );
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
