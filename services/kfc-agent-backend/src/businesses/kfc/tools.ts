import { tool, type ToolRuntime } from 'langchain';
import { commerceToolDefinitions } from '../../agent/agentToolDefinitions.js';
import type { AgentGraphState } from '../../graph/state.js';
import { agentToolCallDisposition } from '../../ordering/toolCallDisposition.js';
import { toolNames } from '../../ordering/toolCatalog.js';
import type { ToolCallRequest, ToolName } from '../../ordering/types.js';
import type { KfcTurnToolReceipt } from './toolReceipts.js';

export type { KfcCoreToolReceipt } from './toolReceipts.js';

export interface KfcTrustedToolExecution {
  readonly evidenceId?: string;
  readonly result: unknown;
}

export interface KfcTrustedToolExecutorInput {
  readonly call: ToolCallRequest & { readonly id: string };
  readonly state: AgentGraphState;
}

export type KfcTrustedToolExecutor = (
  input: KfcTrustedToolExecutorInput,
) => Promise<KfcTrustedToolExecution>;

export interface KfcPendingConfirmation {
  readonly action: ToolCallRequest & { readonly id: string };
}

export function createKfcLangChainTools(input: {
  readonly state: AgentGraphState;
  readonly activeToolNames?: readonly ToolName[];
  readonly resolveActiveToolNames?: () => readonly ToolName[];
  readonly executeTool: KfcTrustedToolExecutor;
  readonly receipts: KfcTurnToolReceipt[];
  readonly setPendingConfirmation: (pending: KfcPendingConfirmation) => void;
}) {
  const activeToolNames = input.activeToolNames ?? toolNames;
  const definitions = new Map(
    commerceToolDefinitions(activeToolNames).map((definition) => [
      definition.name,
      definition,
    ]),
  );
  return activeToolNames.map((name) => {
    const definition = definitions.get(name);
    if (!definition) throw new Error('kfc_tool_definition_missing');
    return tool(
      async (
        rawArguments: Record<string, unknown>,
        runtime: ToolRuntime<unknown, Record<string, never>>,
      ) => {
        const currentToolNames =
          input.resolveActiveToolNames?.() ?? activeToolNames;
        if (!currentToolNames.includes(name)) {
          input.receipts.push({
            id: runtime.toolCallId,
            name,
            effect: 'provider_read',
            status: 'error',
          });
          return {
            ok: false,
            errorCode: 'kfc_tool_not_authorized',
          };
        }
        const disposition = agentToolCallDisposition(name, rawArguments);
        if (!disposition.success) {
          input.receipts.push({
            id: runtime.toolCallId,
            name,
            effect: 'provider_read',
            status: 'error',
          });
          return {
            ok: false,
            errorCode: 'kfc_tool_arguments_invalid',
          };
        }
        const call = {
          id: runtime.toolCallId,
          toolName: name,
          arguments: disposition.data.arguments,
        } as const;
        if (disposition.data.effect === 'irreversible_mutation') {
          input.setPendingConfirmation({ action: call });
          input.receipts.push({
            id: call.id,
            name,
            effect: disposition.data.effect,
            status: 'confirmation_required',
          });
          return {
            ok: false,
            errorCode: 'kfc_confirmation_required',
            action: { toolName: name },
          };
        }
        try {
          const execution = await input.executeTool({
            call,
            state: input.state,
          });
          input.receipts.push({
            id: call.id,
            name,
            effect: disposition.data.effect,
            status: 'success',
            ...(execution.evidenceId
              ? { evidenceId: execution.evidenceId }
              : {}),
          });
          return execution.result;
        } catch {
          input.receipts.push({
            id: call.id,
            name,
            effect: disposition.data.effect,
            status: 'error',
          });
          return {
            ok: false,
            errorCode: 'kfc_tool_execution_failed',
          };
        }
      },
      {
        name,
        description: definition.description ?? name,
        schema: definition.schema,
      },
    );
  });
}
