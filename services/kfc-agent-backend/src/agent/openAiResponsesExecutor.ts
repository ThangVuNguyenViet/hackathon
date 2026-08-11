import {
  Agent,
  invokeFunctionTool,
  OpenAIProvider,
  retryPolicies,
  RunContext,
  Runner,
  assistant,
  user,
  type AgentInputItem,
  type OpenAIClient,
} from '@kfc/openai-agents-runtime';
import type {
  AgentSessionItemsMutation,
  AppendConversationTurnInput,
  ConversationStore,
} from '../persistence/contracts.js';
import { BufferedConversationStoreAgentSession } from './bufferedConversationStoreAgentSession.js';
import type {
  DirectAgentExecutionResult,
  DirectAgentLifecycleObserver,
  DirectAgentToolCallTrace,
  DirectAgentTurnResult,
  DirectAgentUsage,
} from './directAgentTurn.js';
import {
  ObservedOpenAiResponsesCompactionSession,
  type OpenAiCompactionEvent,
} from './observedOpenAiResponsesCompactionSession.js';
import type {
  OpenAiAgentRunContext,
  OpenAiFunctionTool,
} from './openAiSdkTool.js';

type MaybePromise<T> = Promise<T> | T;

export type {
  DirectAgentExecutionResult as OpenAiResponsesExecutionResult,
  DirectAgentLifecycleObserver as OpenAiResponsesLifecycleObserver,
  DirectAgentToolCallTrace as OpenAiResponsesToolCallTrace,
  DirectAgentUsage as OpenAiResponsesUsage,
};

export interface OpenAiAgentProfile {
  readonly name: string;
  readonly instructions: string;
}

export interface OpenAiResponsesExecutorOptions {
  client: OpenAIClient;
  model: string;
  maxTurns?: number;
  /** Null omits the parameter for OpenAI-compatible providers that reject it. */
  modelTemperature?: number | null;
  compaction?: {
    enabled: boolean;
    thresholdBytes: number;
    model?: string;
  };
}

export interface OpenAiResponsesAdaptedOutput<TOutput> {
  responseText: string;
  assistantMetadata?: AppendConversationTurnInput['metadata'];
  output?: TOutput;
}

export interface OpenAiResponsesTurnInput<TOutput = undefined> {
  /** Explicit pack-owned profile. Never inferred from session IDs or prose. */
  profile: OpenAiAgentProfile;
  sessionId: string;
  customerId: string;
  channel: AppendConversationTurnInput['channel'];
  text: string;
  externalMessageId: string | null;
  metadata: AppendConversationTurnInput['metadata'];
  store: ConversationStore;
  tools: OpenAiFunctionTool[];
  developerMessages?: readonly string[];
  requiredToolCalls?: Array<{
    name: string;
    arguments: Record<string, unknown>;
  }>;
  allowModelToolCalls?: boolean;
  requireEvidenceTool?: boolean;
  adaptOutput?: (
    execution: DirectAgentExecutionResult,
  ) => MaybePromise<OpenAiResponsesAdaptedOutput<TOutput>>;
  lifecycle?: DirectAgentLifecycleObserver;
}

export interface OpenAiResponsesTurnResult<
  TOutput = undefined,
> extends DirectAgentTurnResult {
  assistantTurn: AppendConversationTurnInput;
  sdkSessionMutation: AgentSessionItemsMutation;
  output?: TOutput;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOpenAiAgentRunContext(
  value: unknown,
): value is OpenAiAgentRunContext {
  return (
    isRecord(value) &&
    Array.isArray(value.toolCalls) &&
    Array.isArray(value.developerMessages) &&
    (value.toolStartedAt === undefined || value.toolStartedAt instanceof Map) &&
    (value.lifecycle === undefined || isRecord(value.lifecycle))
  );
}

/** Business-neutral OpenAI Responses model/tool/history execution host. */
export class OpenAiResponsesExecutor {
  private readonly model: string;
  private readonly maxTurns: number;
  private readonly client: OpenAIClient;
  private readonly compaction: OpenAiResponsesExecutorOptions['compaction'];
  private readonly runner: Runner;

  constructor(options: OpenAiResponsesExecutorOptions) {
    this.model = options.model || 'gpt-4.1-mini';
    this.maxTurns = options.maxTurns ?? 12;
    this.client = options.client;
    this.compaction = options.compaction;
    this.runner = new Runner({
      modelProvider: new OpenAIProvider({
        openAIClient: options.client,
      }),
      tracingDisabled:
        process.env.OPENAI_AGENTS_TRACING_DISABLED === 'true' ||
        process.env.NODE_ENV === 'test',
      traceIncludeSensitiveData: false,
      toolExecution: { maxFunctionToolConcurrency: 1 },
      modelSettings: {
        ...(options.modelTemperature === null
          ? {}
          : { temperature: options.modelTemperature ?? 0 }),
        parallelToolCalls: false,
        retry: {
          maxRetries: 2,
          backoff: { initialDelayMs: 250, maxDelayMs: 1_000, jitter: true },
          policy: retryPolicies.any(
            retryPolicies.networkError(),
            retryPolicies.providerSuggested(),
            retryPolicies.httpStatus([408, 409, 429, 500, 502, 503, 504]),
          ),
        },
      },
    });
    this.runner.on('agent_tool_start', (runContext, _agent, _tool, details) => {
      const context: unknown = runContext.context;
      if (!isOpenAiAgentRunContext(context)) return;
      if ('callId' in details.toolCall) {
        context.toolStartedAt?.set(details.toolCall.callId, Date.now());
      }
    });
    this.runner.on(
      'agent_tool_end',
      (runContext, _agent, tool_, result, details) => {
        const context: unknown = runContext.context;
        if (!isOpenAiAgentRunContext(context)) return;
        const callId =
          'callId' in details.toolCall ? details.toolCall.callId : undefined;
        const startedAt =
          (callId ? context.toolStartedAt?.get(callId) : undefined) ??
          Date.now();
        if (callId) context.toolStartedAt?.delete(callId);
        const durationMs = Math.max(0, Date.now() - startedAt);
        let status: 'success' | 'error' = 'success';
        try {
          const value = JSON.parse(result) as unknown;
          if (isRecord(value) && value.ok === false) status = 'error';
        } catch {
          // Non-JSON tool output is still a completed SDK tool call.
        }
        const trace = [...context.toolCalls]
          .reverse()
          .find((call) => call.name === tool_.name);
        if (trace) {
          trace.status = status;
          trace.durationMs = durationMs;
        }
        void context.lifecycle?.onToolEnd?.({
          name: tool_.name,
          status,
          durationMs,
        });
      },
    );
  }

  private createSdkAgent(input: OpenAiResponsesTurnInput<unknown>) {
    return new Agent<OpenAiAgentRunContext>({
      name: input.profile.name,
      model: this.model,
      instructions: (runContext) =>
        [
          input.profile.instructions,
          ...runContext.context.developerMessages,
        ].join('\n\n'),
      modelSettings:
        input.requireEvidenceTool === true &&
        input.allowModelToolCalls !== false &&
        input.tools.length > 0
          ? { toolChoice: 'required' }
          : {},
      tools: input.allowModelToolCalls === false ? [] : input.tools,
      toolUseBehavior: 'run_llm_again',
      resetToolChoice: true,
    });
  }

  async respond<TOutput = undefined>(
    input: OpenAiResponsesTurnInput<TOutput>,
  ): Promise<OpenAiResponsesTurnResult<TOutput>> {
    const existingUserTurn = input.externalMessageId
      ? await input.store.findTurnByExternalMessage(
          input.sessionId,
          input.externalMessageId,
        )
      : undefined;
    const userTurn =
      existingUserTurn ??
      (await input.store.appendTurn({
        sessionId: input.sessionId,
        channel: input.channel,
        role: 'user',
        text: input.text,
        externalMessageId: input.externalMessageId,
        externalUserId: input.customerId,
        deliveryStatus: 'received',
        metadata: input.metadata,
      }));
    const runContext: OpenAiAgentRunContext = {
      toolCalls: [],
      developerMessages: [...(input.developerMessages ?? [])],
      toolStartedAt: new Map<string, number>(),
      lifecycle: input.lifecycle,
    };
    const bufferedSession = new BufferedConversationStoreAgentSession(
      input.store,
      input.sessionId,
    );
    const session =
      this.compaction?.enabled === true
        ? new ObservedOpenAiResponsesCompactionSession({
            client: this.client,
            underlyingSession: bufferedSession,
            model: this.compaction.model ?? this.model,
            thresholdBytes: this.compaction.thresholdBytes,
            onCompactionEnd: input.lifecycle?.onCompactionEnd,
          })
        : bufferedSession;
    const runStartedAt = Date.now();
    await input.lifecycle?.onRunStart?.();
    let completedUsage: DirectAgentUsage | undefined;
    let runStatus: 'success' | 'error' = 'error';
    try {
      const trustedItems: AgentInputItem[] = [];
      for (const requiredCall of input.requiredToolCalls ?? []) {
        const trustedTool = input.tools.find(
          (tool) => tool.name === requiredCall.name,
        );
        if (!trustedTool) {
          throw new Error(
            `Required tool call requested unknown tool: ${requiredCall.name}`,
          );
        }
        const callId = `trusted_${crypto.randomUUID()}`;
        const toolStartedAt = Date.now();
        let result: unknown;
        try {
          result = await invokeFunctionTool({
            tool: trustedTool,
            runContext: new RunContext(runContext),
            input: JSON.stringify(requiredCall.arguments),
          });
        } catch (error) {
          await input.lifecycle?.onToolEnd?.({
            name: requiredCall.name,
            status: 'error',
            durationMs: Math.max(0, Date.now() - toolStartedAt),
          });
          throw error;
        }
        const trustedStatus =
          isRecord(result) && result.ok === false ? 'error' : 'success';
        const trustedDurationMs = Math.max(0, Date.now() - toolStartedAt);
        const trustedTrace = [...runContext.toolCalls]
          .reverse()
          .find(
            (call) =>
              call.name === requiredCall.name && call.durationMs === undefined,
          );
        if (trustedTrace) {
          trustedTrace.status = trustedStatus;
          trustedTrace.durationMs = trustedDurationMs;
        }
        await input.lifecycle?.onToolEnd?.({
          name: requiredCall.name,
          status: trustedStatus,
          durationMs: trustedDurationMs,
        });
        trustedItems.push(
          {
            type: 'function_call',
            callId,
            name: requiredCall.name,
            arguments: JSON.stringify(requiredCall.arguments),
            status: 'completed',
          },
          {
            type: 'function_call_result',
            callId,
            name: requiredCall.name,
            status: 'completed',
            output: {
              type: 'text',
              text: JSON.stringify(result),
            },
          },
        );
        runContext.developerMessages.push(
          `Trusted required tool result: ${JSON.stringify(result)}`,
        );
      }

      const runResult = await this.runner.run(
        this.createSdkAgent(input),
        trustedItems.length > 0
          ? [user(input.text), ...trustedItems]
          : input.text,
        {
          context: runContext,
          maxTurns: this.maxTurns,
          session,
        },
      );
      const execution: DirectAgentExecutionResult = {
        responseText:
          typeof runResult.finalOutput === 'string'
            ? runResult.finalOutput
            : '',
        toolCalls: runContext.toolCalls,
        usage: {
          inputTokens: runResult.runContext.usage.inputTokens,
          outputTokens: runResult.runContext.usage.outputTokens,
          totalTokens: runResult.runContext.usage.totalTokens,
        },
      };
      completedUsage = execution.usage;
      const adapted = input.adaptOutput
        ? await input.adaptOutput(execution)
        : { responseText: execution.responseText };
      if (adapted.responseText !== execution.responseText) {
        const rawAssistant = await session.popItem();
        if (
          rawAssistant &&
          'role' in rawAssistant &&
          rawAssistant.role === 'assistant'
        ) {
          await session.addItems([assistant(adapted.responseText)]);
        } else if (rawAssistant) {
          await session.addItems([
            rawAssistant,
            assistant(adapted.responseText),
          ]);
        }
      }
      const assistantTurn: AppendConversationTurnInput = {
        id: `turn_${crypto.randomUUID()}`,
        sessionId: input.sessionId,
        channel: input.channel,
        role: 'assistant',
        text: adapted.responseText,
        externalMessageId: null,
        externalUserId: input.customerId,
        deliveryStatus: 'pending',
        metadata: adapted.assistantMetadata ?? null,
      };
      runStatus = 'success';
      return {
        ...execution,
        responseText: adapted.responseText,
        userTurnId: userTurn.id,
        assistantTurnId: assistantTurn.id!,
        assistantTurn,
        sdkSessionMutation: bufferedSession.pendingMutation(),
        ...('output' in adapted ? { output: adapted.output } : {}),
      };
    } finally {
      await input.lifecycle?.onRunEnd?.({
        status: runStatus,
        latencyMs: Math.max(0, Date.now() - runStartedAt),
        ...(runStatus === 'success' && completedUsage
          ? { usage: completedUsage }
          : {}),
      });
    }
  }
}

export type { OpenAiCompactionEvent };
