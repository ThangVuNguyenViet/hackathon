import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { StructuredTool } from '@langchain/core/tools';
import {
  createAgent,
  createMiddleware,
  modelCallLimitMiddleware,
  providerStrategy,
  toolCallLimitMiddleware,
} from 'langchain';
import { KFC_LANGCHAIN_SYSTEM_PROMPT } from '../businesses/kfc/instructions.js';
import { kfcGroundedPublicationSchema } from '../businesses/kfc/publication.js';
import { providerPortableToolSchema } from './providerPortableToolSchema.js';

export const KFC_CREATE_AGENT_RESPONSE_SCHEMA = providerPortableToolSchema(
  kfcGroundedPublicationSchema,
);

export const KFC_CREATE_AGENT_SYSTEM_PROMPT = KFC_LANGCHAIN_SYSTEM_PROMPT;

export function createKfcAgent(input: {
  model: BaseChatModel;
  tools: readonly StructuredTool[];
  resolveActiveToolNames?: () => readonly string[];
}) {
  const applicationToolAuthorization = createMiddleware({
    name: 'kfc-application-tool-authorization',
    wrapModelCall(request, handler) {
      const applicationTools = new Set(input.tools.map(({ name }) => name));
      const allowed = new Set(
        input.resolveActiveToolNames?.() ?? input.tools.map(({ name }) => name),
      );
      return handler({
        ...request,
        tools: request.tools.filter(
          ({ name }) =>
            typeof name !== 'string' ||
            !applicationTools.has(name) ||
            allowed.has(name),
        ),
      });
    },
  });
  return createAgent({
    model: input.model,
    tools: [...input.tools],
    systemPrompt: KFC_CREATE_AGENT_SYSTEM_PROMPT,
    responseFormat: providerStrategy({
      // The portable JSON Schema is runtime-equivalent to this Zod schema,
      // but LangChain's overload does not preserve that relationship.
      schema:
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        KFC_CREATE_AGENT_RESPONSE_SCHEMA as unknown as typeof kfcGroundedPublicationSchema,
      strict: true,
    }),
    middleware: [
      applicationToolAuthorization,
      modelCallLimitMiddleware({ runLimit: 6, exitBehavior: 'error' }),
      toolCallLimitMiddleware({ runLimit: 8, exitBehavior: 'error' }),
    ],
  });
}
