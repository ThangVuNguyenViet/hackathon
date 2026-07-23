import { ToolMessage } from '@langchain/core/messages';
import { tool, type ToolRuntime } from 'langchain';
import { toolNames } from '../ordering/toolCatalog.js';
import { commerceToolDefinitions } from './agentToolDefinitions.js';
import {
  kfcCreateAgentContextSchema,
  type KfcCreateAgentContext,
} from './kfcCreateAgentRuntime.js';
import { executePortableCommerceCall } from './singleAgentRuntime.js';

export type { KfcCreateAgentContext } from './kfcCreateAgentRuntime.js';

export interface KfcCreateAgentToolDependencies {
  execute: typeof executePortableCommerceCall;
}

const toolDefinitions = new Map(
  commerceToolDefinitions().map((definition) => [definition.name, definition]),
);

export function createKfcCreateAgentTools(
  dependencies: KfcCreateAgentToolDependencies = {
    execute: executePortableCommerceCall,
  },
) {
  return toolNames.map((name) => {
    const definition = toolDefinitions.get(name);
    if (!definition) {
      throw new Error('kfc_create_agent_tool_definition_missing');
    }
    return tool(
      async (
        args: Record<string, unknown>,
        runtime: ToolRuntime<unknown, KfcCreateAgentContext>,
      ) => {
        const parsedContext = kfcCreateAgentContextSchema.safeParse(
          runtime.context,
        );
        if (!parsedContext.success) {
          throw new Error('kfc_create_agent_context_missing');
        }
        const context = parsedContext.data;
        const call = {
          id: runtime.toolCallId,
          toolName: name,
          arguments: args,
        } as const;
        if (context.toolCoordinator) {
          const result = await context.toolCoordinator.execute(call);
          return new ToolMessage({
            content: JSON.stringify(result.receipt),
            tool_call_id: runtime.toolCallId,
            name,
            status: result.ok ? 'success' : 'error',
          });
        }
        return dependencies.execute({
          runtime: context.runtime,
          state: context.state,
          call,
          currentTurnToolTrace: context.currentTurnToolTrace,
          currentTurnStatusOrder: context.currentTurnStatusOrder,
        });
      },
      {
        name,
        description: definition.description ?? name,
        schema: definition.schema,
      },
    );
  });
}
