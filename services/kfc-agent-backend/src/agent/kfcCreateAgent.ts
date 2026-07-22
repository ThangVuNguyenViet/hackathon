import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { createAgent, providerStrategy } from 'langchain';
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

export function createKfcAgent(input: {
  model: BaseChatModel;
  toolDependencies?: KfcCreateAgentToolDependencies;
}) {
  return createAgent({
    model: input.model,
    tools: createKfcCreateAgentTools(input.toolDependencies),
    systemPrompt: KFC_CREATE_AGENT_SYSTEM_PROMPT,
    contextSchema: kfcCreateAgentContextSchema,
    responseFormat: providerStrategy({
      // The portable JSON Schema is runtime-equivalent to this Zod schema,
      // but LangChain's overload does not preserve that relationship.
      schema:
        KFC_CREATE_AGENT_RESPONSE_SCHEMA as unknown as typeof groundedResponseSchema,
      strict: true,
    }),
    middleware: createKfcCreateAgentMiddleware(),
    version: 'v1',
  });
}
