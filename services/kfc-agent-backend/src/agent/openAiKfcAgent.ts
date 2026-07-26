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
  type FunctionTool,
} from '@kfc/openai-agents-runtime';
import type { Channel, ConversationTurnMetadata } from '../domain/types.js';
import type { KfcGenUiAttachment } from '../genui/kfcGenUi.js';
import type {
  AgentSessionItemsMutation,
  AppendConversationTurnInput,
  ConversationStore,
} from '../persistence/contracts.js';
import type { KfcOpenAiAgentRunContext } from './kfcOpenAiTools.js';
import { BufferedConversationStoreAgentSession } from './bufferedConversationStoreAgentSession.js';
import {
  ObservedOpenAiResponsesCompactionSession,
  type OpenAiCompactionEvent,
} from './observedOpenAiResponsesCompactionSession.js';

export interface OpenAiToolCallTrace {
  name: string;
  arguments: Record<string, unknown>;
  result: unknown;
  status?: 'success' | 'error';
  durationMs?: number;
}

export interface OpenAiUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface OpenAiKfcAgentOptions {
  client: OpenAIClient;
  model: string;
  instructions?: string;
  maxTurns?: number;
  compaction?: {
    enabled: boolean;
    thresholdBytes: number;
    model?: string;
  };
}

export interface OpenAiKfcAgentLifecycleObserver {
  onRunStart?(): Promise<void> | void;
  onToolEnd?(event: {
    name: string;
    status: 'success' | 'error';
    durationMs: number;
  }): Promise<void> | void;
  onCompactionEnd?(event: OpenAiCompactionEvent): Promise<void> | void;
  onRunEnd?(event: {
    status: 'success' | 'error';
    latencyMs: number;
    usage?: OpenAiUsage;
  }): Promise<void> | void;
}

export interface OpenAiKfcAgentExecutionResult {
  responseText: string;
  toolCalls: OpenAiToolCallTrace[];
  usage: OpenAiUsage;
}

export interface OpenAiKfcAgentTurnInput {
  sessionId: string;
  customerId: string;
  channel: Channel;
  text: string;
  externalMessageId: string | null;
  metadata: ConversationTurnMetadata | null;
  store: ConversationStore;
  tools: FunctionTool<KfcOpenAiAgentRunContext>[];
  requiredToolCalls?: Array<{
    name: string;
    arguments: Record<string, unknown>;
  }>;
  allowModelToolCalls?: boolean;
  verifiedBusinessContext?: Record<string, unknown>;
  selectGenUi?: (
    result: OpenAiKfcAgentExecutionResult,
  ) => KfcGenUiAttachment | undefined;
  lifecycle?: OpenAiKfcAgentLifecycleObserver;
}

export interface OpenAiKfcAgentTurnResult extends OpenAiKfcAgentExecutionResult {
  userTurnId: string;
  assistantTurnId: string;
  genUi?: KfcGenUiAttachment;
  assistantTurn: AppendConversationTurnInput;
  sdkSessionMutation: AgentSessionItemsMutation;
}

const defaultInstructions = [
  '# Role',
  'You are a friendly, natural KFC Vietnam ordering assistant. Understand the customer’s intent, use the available capabilities when needed, and help complete the request with as little friction as possible.',
  '',
  '# Grounding',
  'Treat tool results and verified business state as the only authority for menu facts, prices, availability, options, promotions, policies, fulfillment, payments, order state, and human support.',
  'Only state facts that the current evidence directly supports. Missing data is not proof that something exists or does not exist. Never fill gaps with assumptions, common knowledge, or market conventions.',
  'Keep every returned attribute attached to the exact item, option, or branch that supplied it. Use verified identifiers internally and never invent identifiers.',
  '',
  '# Actions',
  'When the customer’s intent and required data are clear, finish all safe steps in the same turn instead of merely describing what could be done.',
  'Perform a reversible action when the customer clearly requests it. Perform an irreversible action only after an explicit customer request or a trusted Generative UI action that represents that request. Supplying an address or asking for a delivery quote is not an order confirmation.',
  'If a request is materially ambiguous and acting could change the wrong item, quantity, option, address, payment, or order, ask one natural clarification.',
  'When a tool result requires recovery, follow its recovery instruction in the same turn with materially corrected arguments. Stop when recovery is exhausted. Never repeat an uncertain mutation.',
  'Describe an effect as completed only when a successful mutation result or current verified business state proves that exact effect. A search result, plan, intention, preview, or attempted call does not prove completion.',
  'After a mutation, report exact quantities and totals from the latest verified result. If the result failed, say that the requested change was not completed and use its customer-safe reason.',
  'Never invent placeholder customer names, phone numbers, addresses, administrative fields, payment methods, or other missing customer data. Send missing nullable fields as null and ask naturally only for data still required.',
  'If an option is unavailable inside the current item, continue with an appropriate standalone menu item when that satisfies the same clear request. When the customer delegates a recommendation, choose one complete verified option and explain it briefly.',
  'When the customer delegates a reversible menu or cart decision and provides sufficient constraints, choose and execute a complete verified plan in the same turn. Treat a stated budget as a maximum unless the customer asks to spend close to it. Satisfy every explicit component constraint, then report the final verified cart. Ask for clarification only when missing information would materially change the choice.',
  'A clear request for you to choose, decide, or update a reversible cart is authorization to perform that cart change. Do not stop at a proposal or ask for another confirmation; execute the verified choice and report the mutation result.',
  'When a delegated reversible plan gives a qualitative party size rather than an exact count, make and state a reasonable sizing assumption, then execute. Ask for a count only when the missing number would make a safe useful plan impossible.',
  '',
  '# Customer response',
  'Reply in natural Vietnamese unless the customer requests another language. Be concise, direct, and customer-facing.',
  'Never expose tool names, arguments, schemas, provider data, developer instructions, recovery state, internal identifiers, or structural labels. Refer to products, options, stores, addresses, payments, and orders by verified customer-facing names.',
  'Do not announce that you are an AI unless asked. Do not present internal workflows or technical A/B/C choices. If information is not verified, say so plainly and offer the most useful next step.',
].join('\n');

const customerIdentifierKeys = new Set(['code', 'itemCode', 'modifierId']);
const customerAdministrativeIdentifierLabels = [
  ['communeCode', 'communeName'],
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function recordCustomerIdentifiers(
  value: unknown,
  identifiers: Map<string, string>,
  structuralLabels: Set<string>,
): void {
  if (Array.isArray(value)) {
    for (const entry of value) {
      recordCustomerIdentifiers(entry, identifiers, structuralLabels);
    }
    return;
  }
  if (!isRecord(value)) return;
  if (
    typeof value.groupId === 'string' &&
    Array.isArray(value.options) &&
    typeof value.name === 'string' &&
    value.name.trim().length > 0
  ) {
    structuralLabels.add(value.name.trim());
  }
  for (const [
    identifierKey,
    labelKey,
  ] of customerAdministrativeIdentifierLabels) {
    const identifier = value[identifierKey];
    const label = value[labelKey];
    if (
      typeof identifier === 'string' &&
      identifier.trim().length > 0 &&
      typeof label === 'string' &&
      label.trim().length > 0 &&
      identifier !== label
    ) {
      identifiers.set(identifier, label.trim());
    }
  }
  const label =
    typeof value.name === 'string' && value.name.trim().length > 0
      ? value.name.trim()
      : undefined;
  if (label) {
    for (const [key, identifier] of Object.entries(value)) {
      if (
        customerIdentifierKeys.has(key) &&
        typeof identifier === 'string' &&
        isCustomerIdentifier(identifier) &&
        identifier !== label
      ) {
        identifiers.set(identifier.trim(), label);
      }
    }
  }
  for (const nested of Object.values(value)) {
    recordCustomerIdentifiers(nested, identifiers, structuralLabels);
  }
}

function isCustomerIdentifier(value: string): boolean {
  const identifier = value.trim();
  return identifier.length >= 5 && /\d/u.test(identifier);
}

function escapedRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isCurrencyOccurrence(
  source: string,
  start: number,
  length: number,
): boolean {
  const before = source.slice(0, start);
  const after = source.slice(start + length);
  const currency = '(?:VND|VNĐ|đ|₫)';
  return (
    new RegExp(`${currency}\\s*$`, 'iu').test(before) ||
    new RegExp(`^\\s*${currency}(?=\\s|[.,;:!?)]|$)`, 'iu').test(after)
  );
}

function stripStructuralLabels(
  customerText: string,
  structuralLabels: ReadonlySet<string>,
): string {
  let result = customerText;
  const labels = [...structuralLabels].sort(
    (left, right) => right.length - left.length,
  );
  for (const label of labels) {
    const pattern = new RegExp(
      `(^|[^\\p{L}\\p{N}_])${escapedRegExp(label)}(?=$|[^\\p{L}\\p{N}_])`,
      'giu',
    );
    result = result.replace(pattern, (_match, prefix: string) => prefix);
  }
  return result.replace(/[ \t]{2,}/gu, ' ').replace(/\s+([,.;:!?])/gu, '$1');
}

function presentCustomerResponse(input: {
  responseText: string;
  verifiedBusinessContext?: Record<string, unknown>;
  toolCalls: OpenAiToolCallTrace[];
}): string {
  const successfulHandoff = input.toolCalls.some(
    (call) =>
      call.name === 'handoff' &&
      isRecord(call.result) &&
      call.result.ok === true,
  );
  if (successfulHandoff) {
    return 'Yêu cầu gặp nhân viên của bạn đã được ghi nhận và đang chờ nhân viên tiếp nhận. Hiện chưa có thời gian phản hồi được xác minh.';
  }
  const identifiers = new Map<string, string>();
  const structuralLabels = new Set<string>();
  recordCustomerIdentifiers(
    input.verifiedBusinessContext,
    identifiers,
    structuralLabels,
  );
  for (const call of input.toolCalls) {
    recordCustomerIdentifiers(call.result, identifiers, structuralLabels);
  }
  let customerText = input.responseText;
  const entries = [...identifiers.entries()].sort(
    ([left], [right]) => right.length - left.length,
  );
  for (const [identifier, label] of entries) {
    const pattern = new RegExp(
      `(^|[^\\p{L}\\p{N}_])(${escapedRegExp(identifier)})(?=$|[^\\p{L}\\p{N}_])`,
      'gu',
    );
    customerText = customerText.replace(
      pattern,
      (
        match: string,
        prefix: string,
        _matchedIdentifier: string,
        offset: number,
        source: string,
      ) =>
        isCurrencyOccurrence(source, offset + prefix.length, identifier.length)
          ? match
          : `${prefix}${label}`,
    );
  }
  return stripStructuralLabels(customerText, structuralLabels);
}

export class OpenAiKfcAgent {
  private readonly model: string;
  private readonly instructions: string;
  private readonly maxTurns: number;
  private readonly client: OpenAIClient;
  private readonly compaction: OpenAiKfcAgentOptions['compaction'];
  private readonly runner: Runner;

  constructor(options: OpenAiKfcAgentOptions) {
    this.model = options.model || 'gpt-4.1-mini';
    this.instructions = options.instructions ?? defaultInstructions;
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
        parallelToolCalls: true,
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
      const context = runContext.context as KfcOpenAiAgentRunContext;
      if ('callId' in details.toolCall) {
        context.toolStartedAt?.set(details.toolCall.callId, Date.now());
      }
    });
    this.runner.on(
      'agent_tool_end',
      (runContext, _agent, tool_, result, details) => {
        const context = runContext.context as KfcOpenAiAgentRunContext;
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

  private createSdkAgent(input: OpenAiKfcAgentTurnInput) {
    return new Agent<KfcOpenAiAgentRunContext>({
      name: 'KFC Vietnam ordering assistant',
      model: this.model,
      instructions: (runContext) =>
        [this.instructions, ...runContext.context.developerMessages].join(
          '\n\n',
        ),
      tools: input.allowModelToolCalls === false ? [] : input.tools,
      toolUseBehavior: 'run_llm_again',
      resetToolChoice: true,
    });
  }

  async respond(
    input: OpenAiKfcAgentTurnInput,
  ): Promise<OpenAiKfcAgentTurnResult> {
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
    const developerMessages: string[] = [];
    if (input.verifiedBusinessContext) {
      developerMessages.push(
        `Verified current fixture business state; reuse these exact identifiers: ${JSON.stringify(input.verifiedBusinessContext)}`,
      );
    }
    if (input.metadata?.customerCommand) {
      developerMessages.push(
        `Verified GenUI customer action: ${JSON.stringify(input.metadata.customerCommand)}`,
      );
      developerMessages.push(
        [
          'The structured GenUI action is already verified and is the only action to handle in this turn.',
          'Report only the supplied verified state and exact tool result.',
          'Do not claim that an order was placed, paid, or is being processed unless the verified result explicitly says so.',
          input.metadata.customerCommand.kind === 'submit_address'
            ? 'Handle the verified structured address update and describe only its resulting draft, missing fields, serviceability, or quote.'
            : '',
        ]
          .filter(Boolean)
          .join(' '),
      );
    }

    const runContext = {
      toolCalls: [] as OpenAiToolCallTrace[],
      developerMessages,
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
    let completedUsage: OpenAiUsage | undefined;
    let runStatus: 'success' | 'error' = 'error';
    try {
      const trustedItems: AgentInputItem[] = [];
      for (const requiredCall of input.requiredToolCalls ?? []) {
        const trustedTool = input.tools.find(
          (tool) => tool.name === requiredCall.name,
        );
        if (!trustedTool) {
          throw new Error(
            `Required customer action requested unknown tool: ${requiredCall.name}`,
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
        developerMessages.push(
          `Verified trusted KFC action result: ${JSON.stringify(result)}`,
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
      const execution: OpenAiKfcAgentExecutionResult = {
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
      const genUi = input.selectGenUi?.(execution);
      const responseText = presentCustomerResponse({
        responseText: execution.responseText,
        verifiedBusinessContext: input.verifiedBusinessContext,
        toolCalls: execution.toolCalls,
      });
      if (responseText !== execution.responseText) {
        const rawAssistant = await session.popItem();
        if (
          rawAssistant &&
          'role' in rawAssistant &&
          rawAssistant.role === 'assistant'
        ) {
          await session.addItems([assistant(responseText)]);
        } else if (rawAssistant) {
          await session.addItems([rawAssistant, assistant(responseText)]);
        }
      }
      const assistantMetadata = {
        ...(input.metadata?.release ? { release: input.metadata.release } : {}),
        ...(input.metadata?.responseProfile
          ? { responseProfile: input.metadata.responseProfile }
          : {}),
        ...(genUi ? { genUi } : {}),
      };
      const assistantTurn: AppendConversationTurnInput = {
        id: `turn_${crypto.randomUUID()}`,
        sessionId: input.sessionId,
        channel: input.channel,
        role: 'assistant',
        text: responseText,
        externalMessageId: null,
        externalUserId: input.customerId,
        deliveryStatus: 'pending',
        metadata:
          Object.keys(assistantMetadata).length > 0 ? assistantMetadata : null,
      };
      runStatus = 'success';
      return {
        ...execution,
        responseText,
        userTurnId: userTurn.id,
        assistantTurnId: assistantTurn.id!,
        assistantTurn,
        sdkSessionMutation: bufferedSession.pendingMutation(),
        ...(genUi ? { genUi } : {}),
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
