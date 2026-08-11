import { RunContext, tool } from '@kfc/openai-agents-runtime';
import { classifyToolSideEffect } from '../ordering/toolExecutor.js';
import type { ToolName } from '../ordering/types.js';
import type { DirectAgentToolCallTrace } from './directAgentTurn.js';
import type {
  OpenAiAgentRunContext,
  OpenAiFunctionTool,
  OpenAiStrictJsonObjectSchema,
} from './openAiSdkTool.js';

export type KfcStrictJsonObjectSchema = OpenAiStrictJsonObjectSchema;

export type KfcArgumentParseResult =
  { success: true; data: Record<string, unknown> } | { success: false };

export interface KfcCanonicalToolDefinition {
  type: 'function';
  name: ToolName;
  description: string;
  parameters: KfcStrictJsonObjectSchema;
  strict: true;
}

export interface KfcCanonicalTool {
  definition: KfcCanonicalToolDefinition;
  parseArguments(value: unknown): KfcArgumentParseResult;
  execute(
    arguments_: Record<string, unknown>,
    options?: { signal: AbortSignal; deadlineAt: number },
  ): Promise<unknown>;
}

export type KfcOpenAiAgentRunContext = OpenAiAgentRunContext;
export type KfcOpenAiFunctionTool = OpenAiFunctionTool;

function safeSdkToolFailure(
  errorCode: 'invalid_tool_input' | 'tool_execution_failed' | 'tool_timed_out',
) {
  return {
    ok: false,
    errorCode,
    message: 'The requested action could not be completed safely.',
  };
}

function toolTraceSink(runContext: RunContext): unknown[] | undefined {
  const context: unknown = runContext.context;
  if (
    typeof context !== 'object' ||
    context === null ||
    !('toolCalls' in context) ||
    !Array.isArray(context.toolCalls)
  ) {
    return undefined;
  }
  return context.toolCalls;
}

function recordSafeSdkFailure(input: {
  runContext: RunContext;
  toolName: ToolName;
  errorCode: 'invalid_tool_input' | 'tool_execution_failed' | 'tool_timed_out';
}): string {
  const result = safeSdkToolFailure(input.errorCode);
  toolTraceSink(input.runContext)?.push({
    name: input.toolName,
    arguments: {},
    result,
  });
  return JSON.stringify(result);
}

/** Adapts canonical KFC capabilities to official Agents SDK function tools. */
export function createKfcOpenAiAgentsTools(
  tools: readonly KfcCanonicalTool[],
  options: { timeoutMs?: number } = {},
): KfcOpenAiFunctionTool[] {
  return tools.map((canonicalTool) =>
    tool({
      name: canonicalTool.definition.name,
      description: canonicalTool.definition.description,
      parameters: canonicalTool.definition.parameters,
      strict: true,
      errorFunction: (runContext, error) =>
        recordSafeSdkFailure({
          runContext,
          toolName: canonicalTool.definition.name,
          errorCode:
            error instanceof Error && error.name === 'InvalidToolInputError'
              ? 'invalid_tool_input'
              : 'tool_execution_failed',
        }),
      async execute(
        arguments_,
        runContext?: RunContext<KfcOpenAiAgentRunContext>,
      ) {
        if (!runContext) {
          throw new Error('KFC tool is missing its run context');
        }
        const parsed = canonicalTool.parseArguments(arguments_);
        if (!parsed.success) {
          const result = safeSdkToolFailure('invalid_tool_input');
          runContext.context.toolCalls.push({
            name: canonicalTool.definition.name,
            arguments: {},
            result,
          });
          return result;
        }
        const trace: DirectAgentToolCallTrace = {
          name: canonicalTool.definition.name,
          arguments: parsed.data,
          result: undefined,
        };
        runContext.context.toolCalls.push(trace);
        const abortController = new AbortController();
        const timeoutMs = options.timeoutMs ?? 120_000;
        const localDeadlineAt = Date.now() + timeoutMs;
        const sideEffect = classifyToolSideEffect(
          canonicalTool.definition.name,
          parsed.data,
        );
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        try {
          const execution = canonicalTool.execute(
            parsed.data,
            sideEffect === 'irreversible'
              ? undefined
              : {
                  signal: abortController.signal,
                  deadlineAt: localDeadlineAt,
                },
          );
          if (sideEffect === 'irreversible') {
            const result = await execution;
            trace.result = result;
            return result;
          }
          const timedOut = Symbol('kfc_tool_timed_out');
          const timeout = new Promise<typeof timedOut>((resolve) => {
            timeoutId = setTimeout(() => resolve(timedOut), timeoutMs);
          });
          const result = await Promise.race([execution, timeout]);
          if (
            result === timedOut ||
            (isRecord(result) &&
              result.errorCode === 'agent_tool_execution_cancelled')
          ) {
            abortController.abort();
            const safe = safeSdkToolFailure('tool_timed_out');
            trace.result = safe;
            return safe;
          }
          trace.result = result;
          return result;
        } catch {
          const result = safeSdkToolFailure('tool_execution_failed');
          trace.result = result;
          return result;
        } finally {
          if (timeoutId) clearTimeout(timeoutId);
        }
      },
    }),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
