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
import type { Channel, ConversationTurnMetadata } from '../domain/types.js';
import type { KfcGenUiAttachment } from '../genui/kfcGenUi.js';
import type {
  AgentSessionItemsMutation,
  AppendConversationTurnInput,
  ConversationStore,
} from '../persistence/contracts.js';
import type { KfcOpenAiAgentRunContext } from './kfcOpenAiTools.js';
import type { KfcOpenAiFunctionTool } from './kfcOpenAiTools.js';
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
  tools: KfcOpenAiFunctionTool[];
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
  'You are a friendly, natural ordering and advisory assistant. Understand the customer’s intent, use any of the available tools freely to assist them, and complete requests smoothly with minimal friction.',
  '',
  '# Capabilities & Tool Usage',
  'Feel free to use any available tools whenever needed to look up information, perform calculations, verify details, check options, or execute customer requests.',
  'When a customer asks a question or makes a request, freely invoke the relevant tools to gather current evidence and carry out their intent in the same turn.',
  'Choose any tool that helps fulfill the customer’s request accurately and efficiently.',
  '',
  '# Grounding & Evidence',
  'Base customer-facing information about products, options, prices, availability, promotions, policies, fulfillment, and support on current tool results or verified business state.',
  'Translate tool results into clear, helpful, customer-friendly terms in natural prose.',
  'When details are incomplete or ambiguous, ask a friendly clarification to ensure the customer receives exactly what they need.',
  '',
  '# Response & Style',
  'Respond naturally in Vietnamese unless another language is requested.',
  'Provide helpful, relevant answers with clear outcomes and actionable next steps.',
  'Keep responses warm, polite, and direct, focusing on what is most useful to the customer.',
  '',
  '# Scope Boundary',
  'You are exclusively a KFC Vietnam ordering assistant. Do NOT provide information, advice, or assistance about any other business, brand, product category, or industry (such as fertilizers, agriculture, banking, or any non-KFC topic). If a customer asks about something completely outside KFC ordering (e.g., other companies, unrelated products), politely decline and redirect: "Mình chỉ hỗ trợ đặt món và tư vấn thực đơn KFC thôi nhé. Bạn có muốn tiếp tục với đơn hàng đang chọn không?"',
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
        temperature: 0,
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
    const isPvcfc =
      input.sessionId.startsWith('pvcfc:') ||
      (typeof input.verifiedBusinessContext?.organization === 'string' &&
        input.verifiedBusinessContext.organization.includes('Phân bón')) ||
      (typeof input.verifiedBusinessContext?.role === 'string' &&
        input.verifiedBusinessContext.role.includes('Phân Bón'));

    const agentName = isPvcfc
      ? 'PVCFC Agricultural Advisor'
      : 'KFC Vietnam ordering assistant';

    const systemInstructions = isPvcfc
      ? [
          '# Role',
          'You are the official Agricultural Advisory Assistant for Tổng Công ty Phân bón Dầu khí Cà Mau (PVCFC / Đạm Cà Mau).',
          'Your role is to help farmers and dealers with crop nutrition, fertilizer dosage calculation, soil acidity/phèn treatment, disease diagnosis, and PVCFC authorized dealer locations.',
          '',
          '1. Quy trình bón phân & dinh dưỡng cây trồng (Lúa, Sầu riêng, Cà phê, Cây ăn trái) theo thổ nhưỡng (đất phèn An Giang, đất phù sa ĐBSCL, đất đỏ Tây Nguyên).',
          '2. Tính toán lượng phân bón (Đạm Cà Mau, NPK Cà Mau 20-20-15, Organic OM Cà Mau, N46.Plus, Kali Cà Mau 61) và số bao 50kg theo diện tích (Héc-ta hoặc Công). N46.Plus là sản phẩm Đạm Cà Mau có hàm lượng Nitơ 46%, đây là sản phẩm chính thức trong danh mục của PVCFC.',
          '3. Chẩn đoán bệnh cây trồng (vàng lá thối rễ, ngộ độc hữu cơ) và phác đồ cấp bách ngưng đạm hóa học, rải vôi nâng pH & tưới Trichoderma.',
          '4. Tra cứu đại lý ủy quyền PVCFC chính hãng và hẹn Kỹ sư Nông nghiệp đo pH đất tận vườn. Đường dây hỗ trợ: 1800 599 978 (miễn phí). Website: https://damcamau.com.',
          '',
          '# Scope Boundary',
          'You are exclusively the PVCFC agricultural advisor. Do NOT provide information, directions, or assistance about any other business, brand, or industry (e.g., fast food, other fertilizer brands, banking). If a customer asks about something completely outside PVCFC agronomy (e.g., ordering food, unrelated companies), politely decline and redirect back: "Mình chỉ hỗ trợ về phân bón và kỹ thuật canh tác Đạm Cà Mau thôi nhé. Bạn còn câu hỏi nào về cây trồng hoặc phân bón không?"',
          '',
          '# Grounding & Response Style',
          'Respond in warm, polite, clear, natural Vietnamese.',
          'Provide direct, helpful agricultural advice with clear action steps.',
          'Base every factual claim about products, dosages, and dealers on verified business context.',
        ].join('\n')
      : this.instructions;

    return new Agent<KfcOpenAiAgentRunContext>({
      name: agentName,
      model: this.model,
      instructions: (runContext) =>
        [systemInstructions, ...runContext.context.developerMessages].join(
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
          'Give the customer a concise account of the supplied verified state and exact tool result.',
          'Treat order placement, payment, and processing as established when the verified result explicitly reports that state.',
          input.metadata.customerCommand.kind === 'submit_address'
            ? 'Handle the verified structured address update and describe its resulting draft, missing fields, serviceability, or quote.'
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
