import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import {
  createAgent,
  providerStrategy,
  type ProviderStrategy,
} from 'langchain';
import type { z } from 'zod';
import { AGENT_SYSTEM_PROMPT } from './agentModelInvocation.js';
import { createKfcCreateAgentMiddleware } from './kfcCreateAgentMiddleware.js';
import { kfcCreateAgentContextSchema } from './kfcCreateAgentRuntime.js';
import {
  createKfcCreateAgentTools,
  type KfcCreateAgentToolDependencies,
} from './kfcCreateAgentTools.js';
import { providerPortableToolSchema } from './providerPortableToolSchema.js';
import { groundedResponseSchema } from './responseGrounding.js';

export const KFC_CREATE_AGENT_RESPONSE_SCHEMA = providerPortableToolSchema(
  groundedResponseSchema,
);

export const KFC_CREATE_AGENT_SYSTEM_PROMPT = AGENT_SYSTEM_PROMPT.replace(
  /When ready to answer, call submitGroundedResponse exactly once instead of returning plain text\./u,
  'When ready to answer, return the final response through the provider-native structured output schema.',
);

type ProviderJsonSchema = Record<string, unknown> & {
  type: 'object';
};

const groundedResponseProviderStrategy = providerStrategy({
  // Pass the already-normalized JSON Schema to the provider strategy.
  // Passing the Zod schema here makes LangChain regenerate JSON Schema and can
  // emit nested property $refs that OpenAI strict structured output rejects.
  schema: KFC_CREATE_AGENT_RESPONSE_SCHEMA as ProviderJsonSchema,
  strict: true,
}) as ProviderStrategy<z.infer<typeof groundedResponseSchema>>;

export function createKfcAgent(input: {
  model: BaseChatModel;
  toolDependencies?: KfcCreateAgentToolDependencies;
}) {
  return createAgent({
    model: input.model,
    tools: createKfcCreateAgentTools(input.toolDependencies),
    systemPrompt: KFC_CREATE_AGENT_SYSTEM_PROMPT,
    contextSchema: kfcCreateAgentContextSchema,
    responseFormat: groundedResponseProviderStrategy,
    middleware: createKfcCreateAgentMiddleware(),
    version: 'v1',
  });
}
