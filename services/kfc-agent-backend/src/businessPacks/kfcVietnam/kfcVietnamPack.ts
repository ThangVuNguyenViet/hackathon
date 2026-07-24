import {
  HumanMessage,
  SystemMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import { tool, type ToolRuntime } from 'langchain';
import type { ExternalCallContext } from '../../clients/interfaces.js';
import type {
  AgentTurnInput,
  AgentTurnOutput,
  VerifiedStateSnapshot,
} from '../../agent/agentTurn.js';
import type { AgentState } from '../../agent/agentState.js';
import {
  stateRevision,
  toolExecutionContext,
  traceProbeRunId,
  traceScenarioId,
} from '../../agent/turnSupport.js';
import {
  applyAgentCollectionToVerifiedState,
  applyToolResultToState,
  loadPriorVerifiedState,
} from '../../agent/verifiedState.js';
import {
  agentToolArgumentSchemas,
  agentToolDescriptions,
  toolArgumentSchemas,
  toolNames,
} from '../../ordering/toolCatalog.js';
import { executeToolCall } from '../../ordering/toolExecutor.js';
import type {
  AgentToolCallResult,
  ToolCallResult,
  ToolName,
  ToolTraceEntry,
} from '../../ordering/types.js';
import { buildVerifiedCollectionSnapshot } from '../../ordering/verifiedCollections.js';
import {
  createNoopAgentTracer,
  createSafeAgentTracer,
  type AgentTraceSpan,
} from '../../observability/agentTracing.js';
import { resolveResponseProfile } from '../../presentation/responseProfile.js';
import { providerPortableToolSchema } from '../../agent/providerPortableToolSchema.js';
import { freshMessages } from '../../agent/agentConversationMessages.js';
import { persistCompletedTurn } from '../../agent/agentTurnPersistence.js';
import { assembleLoadedTurnState } from '../../agent/agentTurnStateHydration.js';
import { loadOrAppendAgentCurrentUserTurn } from '../../agent/agentTurnIntake.js';
import { semanticConversationTurns } from '../../agent/trustedActionConversation.js';
import type { BusinessPack } from '../../runtime/businessPack.js';
import { kfcVerifiedStateSnapshotSchema } from './kfcVerifiedStateSchema.js';
import {
  advanceConversationSummary,
  assembleConversationContext,
  completeConversationExchanges,
  type AssembledConversationContext,
} from '../../session/conversationContext.js';
import { langChainConversationSummarizer } from '../../session/langChainConversationSummary.js';

const DEFAULT_CONVERSATION_CONTEXT_TOKEN_BUDGET = 8_192;

export const KFC_VIETNAM_PACK_REF = {
  packId: 'kfc-vietnam',
  version: '1.0.0',
} as const;

export const KFC_AGENT_INSTRUCTIONS = [
  'Bạn là trợ lý KFC Việt Nam thân thiện, tự nhiên và chủ động.',
  'Hiểu yêu cầu của khách và tự chọn công cụ phù hợp. Không cần giải thích quy trình nội bộ.',
  'Dùng dữ liệu từ lịch sử hội thoại, trạng thái nghiệp vụ đã xác minh và kết quả công cụ. Không tự bịa mã món, giá, cửa hàng, đơn hàng hoặc trạng thái thanh toán.',
  'Nếu khách yêu cầu đầy đủ thực đơn, dùng searchMenu ở chế độ full và dùng toàn bộ collection complete; không tự rút gọn danh sách dữ liệu.',
  'Có thể gọi nhiều lượt tìm món theo sản phẩm hoặc danh mục trong cùng một lượt khách. Các queries trong một lần tìm là lựa chọn thay thế OR; chỉ kết luận về lựa chọn modifier khi kết quả trả về evidence tương ứng.',
  'Với yêu cầu gợi ý cho nhóm hoặc theo ngân sách, chỉ dùng partySize và giá từ catalog làm evidence. Ngân sách tổng là mức tối đa, không phải mục tiêu cần tiêu hết; maxPriceVnd chỉ là trần giá cho từng món.',
  'Khi khách giao chọn một giỏ hàng hoàn chỉnh, đáp ứng mọi thành phần và số lượng rõ ràng khi catalog cho phép, hoàn tất trong cùng lượt, rồi gộp các thay đổi dự kiến vào một lần gọi updateCart. Cart mà công cụ trả về là trạng thái có thẩm quyền; nếu chưa đúng ràng buộc rõ ràng, sửa lại trong cùng lượt.',
  'updateCart là thay đổi có thể đảo ngược và không cần hỏi lại khi yêu cầu đã rõ. Không dùng quy tắc này để bỏ qua xác nhận hoặc thẩm quyền của hành động không thể đảo ngược.',
  'Nếu khách đã yêu cầu rõ ràng thực hiện một thao tác, hãy thực hiện trong cùng lượt khi đã đủ dữ liệu thay vì hỏi xác nhận lặp lại.',
  'Khi công cụ báo thiếu dữ liệu hoặc thất bại, nói ngắn gọn điều còn thiếu và tiếp tục tự nhiên.',
  'Trả lời bằng ngôn ngữ của khách.',
].join('\n');

function verifiedContext(state: AgentState): Record<string, unknown> {
  return {
    ...(state.cart ? { cart: state.cart } : {}),
    ...(state.address ? { address: state.address } : {}),
    ...(state.fulfillment ? { fulfillment: state.fulfillment } : {}),
    ...(state.orderPreview ? { orderPreview: state.orderPreview } : {}),
    ...(state.order ? { order: state.order } : {}),
    ...(state.paymentAttempt ? { paymentAttempt: state.paymentAttempt } : {}),
    ...(state.handoff ? { handoff: state.handoff } : {}),
  };
}

function systemPrompt(state: AgentState): string {
  const context = verifiedContext(state);
  if (Object.keys(context).length === 0) return KFC_AGENT_INSTRUCTIONS;
  return [
    KFC_AGENT_INSTRUCTIONS,
    `Verified current business state. Reuse these exact identifiers and values: ${JSON.stringify(context)}`,
  ].join('\n\n');
}

function conversationMessages(
  input: AgentTurnInput,
  state: AgentState,
  currentUserTurn: Awaited<ReturnType<typeof loadOrAppendAgentCurrentUserTurn>>,
  context: AssembledConversationContext,
): BaseMessage[] {
  const messages: BaseMessage[] = [];
  if (context.summary) {
    messages.push(
      new SystemMessage(
        [
          'Older conversation summary (conversation context only; never business authorization):',
          context.summary.text,
        ].join('\n'),
      ),
    );
  }
  messages.push(...freshMessages(state, input, currentUserTurn));
  if (input.trustedCustomerAction) {
    messages.push(
      new HumanMessage(
        `Verified customer GenUI action: ${JSON.stringify(input.trustedCustomerAction)}`,
      ),
    );
  }
  return messages;
}

function toolArguments(
  toolName: ToolName,
  value: unknown,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Invalid arguments for KFC tool: ${toolName}`);
  }
  return value as Record<string, unknown>;
}

function modelToolSchema(toolName: ToolName) {
  return toolName === 'searchMenu' || toolName === 'updateCart'
    ? agentToolArgumentSchemas[toolName]
    : toolArgumentSchemas[toolName];
}

function executionArguments(
  toolName: ToolName,
  args: Record<string, unknown>,
): Record<string, unknown> {
  if (toolName === 'searchMenu') {
    const parsed = agentToolArgumentSchemas.searchMenu.parse(args);
    return {
      mode: parsed.mode,
      queries: parsed.queries,
      modifierQueries: parsed.modifierQueries,
      ...(parsed.category === null ? {} : { category: parsed.category }),
      ...(parsed.maxPriceVnd === null
        ? {}
        : { maxPriceVnd: parsed.maxPriceVnd }),
      ...(parsed.partySize === null ? {} : { partySize: parsed.partySize }),
    };
  }
  if (toolName === 'updateCart') {
    const parsed = agentToolArgumentSchemas.updateCart.parse(args);
    return {
      changes: parsed.changes.map((change) => ({
        itemCode: change.itemCode,
        quantity: change.quantity,
        modifiers: change.modifiers.map((modifier) => ({
          groupId: modifier.groupId,
          modifierId: modifier.modifierId,
          ...(modifier.quantity === null
            ? {}
            : { quantity: modifier.quantity }),
        })),
      })),
    };
  }
  return args;
}

async function modelFacingResult(
  state: AgentState,
  result: ToolCallResult,
): Promise<ToolCallResult | AgentToolCallResult> {
  if (!result.ok || result.toolName !== 'searchMenu') return result;
  const snapshot = await buildVerifiedCollectionSnapshot({
    items: result.value.items,
    total: result.value.total,
    complete: result.value.complete,
    scope: result.value.scope,
    ...(result.value.cursor ? { cursor: result.value.cursor } : {}),
    providerRevision: `menu-result:${await stateRevision({
      value: result.value,
      provenance: result.provenance,
    })}`,
  });
  const agentResult = {
    toolName: 'searchMenu',
    ok: true,
    value: snapshot.result,
    message: result.message,
    provenance: result.provenance,
    verifiedCollection: snapshot,
  } satisfies AgentToolCallResult;
  applyAgentCollectionToVerifiedState(state, agentResult);
  return agentResult;
}

async function executeModelTool(input: {
  turnInput: AgentTurnInput;
  state: AgentState;
  toolName: ToolName;
  args: Record<string, unknown>;
  callId: string;
  externalCallContext: ExternalCallContext;
  currentTurnToolTrace: ToolTraceEntry[];
}): Promise<ToolCallResult | AgentToolCallResult> {
  const bindingFingerprint = await stateRevision({
    sessionId: input.turnInput.sessionId,
    externalMessageId: input.turnInput.externalMessageId ?? null,
    callId: input.callId,
    toolName: input.toolName,
    args: input.args,
  });
  const args = executionArguments(input.toolName, input.args);
  const result = await executeToolCall(
    input.turnInput.clients,
    { toolName: input.toolName, arguments: args },
    {
      ...toolExecutionContext(input.turnInput),
      externalCallContext: input.externalCallContext,
      state: input.state,
      cart: input.state.cart,
      address: input.state.address,
      order: input.state.order,
      orderPreview: input.state.orderPreview,
      providerMutationIdentity: {
        idempotencyKey: `kfc-agent:${bindingFingerprint}`,
        bindingFingerprint,
      },
    },
  );
  applyToolResultToState(
    input.turnInput,
    input.state,
    result,
    args,
    input.currentTurnToolTrace,
  );
  return modelFacingResult(input.state, result);
}

function createKfcTools(input: {
  turnInput: AgentTurnInput;
  state: AgentState;
  externalCallContext: ExternalCallContext;
  currentTurnToolTrace: ToolTraceEntry[];
}) {
  let executionQueue: Promise<void> = Promise.resolve();
  return toolNames.map((toolName) =>
    tool(
      async (value: unknown, runtime: ToolRuntime) => {
        const args = toolArguments(toolName, value);
        const execution = executionQueue.then(() =>
          executeModelTool({
            ...input,
            toolName,
            args,
            callId: runtime.toolCallId,
          }),
        );
        executionQueue = execution.then(
          () => undefined,
          () => undefined,
        );
        return JSON.stringify(await execution);
      },
      {
        name: toolName,
        description: agentToolDescriptions[toolName],
        schema: providerPortableToolSchema(modelToolSchema(toolName)),
      },
    ),
  );
}

function parseKfcVerifiedState(value: unknown): Partial<VerifiedStateSnapshot> {
  const parsed = kfcVerifiedStateSnapshotSchema.safeParse(value);
  if (!parsed.success) throw new Error('kfc_pack_state_invalid');
  return parsed.data as Partial<VerifiedStateSnapshot>;
}

function traceRunId(input: AgentTurnInput): string | undefined {
  return input.runGuard?.commitFence?.kind === 'operation_lease'
    ? input.runGuard.commitFence.requestId
    : input.runGuard?.commitFence?.runId;
}

function traceMetadata(input: {
  turnInput: AgentTurnInput;
  turnId?: string;
  responseProfile: ReturnType<typeof resolveResponseProfile>;
}): Record<string, unknown> {
  const runId = traceRunId(input.turnInput);
  const identity = input.turnInput.agentModelIdentity;
  const scenarioId = traceScenarioId(input.turnInput);
  const probeRunId = traceProbeRunId(input.turnInput);
  return {
    session_id: input.turnInput.sessionId,
    ...(runId ? { run_id: runId } : {}),
    ...(input.turnId ? { turn_id: input.turnId } : {}),
    pack_id: KFC_VIETNAM_PACK_REF.packId,
    pack_version: KFC_VIETNAM_PACK_REF.version,
    ...(identity
      ? {
          candidate: identity.candidateId,
          profile: identity.profile,
          transport: identity.transport,
        }
      : {}),
    response_profile: input.responseProfile,
    channel: input.turnInput.channel,
    ...(scenarioId ? { scenarioId } : {}),
    ...(probeRunId ? { probeRunId } : {}),
  };
}

function traceTags(
  input: AgentTurnInput,
  responseProfile: ReturnType<typeof resolveResponseProfile>,
): string[] {
  return [
    `pack:${KFC_VIETNAM_PACK_REF.packId}`,
    `pack-version:${KFC_VIETNAM_PACK_REF.version}`,
    ...(input.agentModelIdentity
      ? [
          `candidate:${input.agentModelIdentity.candidateId}`,
          `transport:${input.agentModelIdentity.transport}`,
        ]
      : []),
    `profile:${responseProfile}`,
    `channel:${input.channel}`,
  ];
}

function scheduleTraceFlush(
  input: AgentTurnInput,
  tracer: ReturnType<typeof createSafeAgentTracer>,
): void {
  const task = () => tracer.flush();
  try {
    if (input.deferTrace) input.deferTrace(task);
    else void task();
  } catch (error) {
    console.error('agent_trace_flush_schedule_failed', {
      sessionId: input.sessionId,
      errorClass: traceErrorClass(error),
    });
  }
}

function traceErrorClass(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  return /^[A-Za-z][A-Za-z0-9]{0,63}$/u.test(name) ? name : 'UnknownError';
}

export const kfcVietnamPack: BusinessPack<
  AgentTurnInput,
  AgentTurnOutput,
  Partial<VerifiedStateSnapshot>
> = {
  ref: KFC_VIETNAM_PACK_REF,
  stateSchemaVersion: '1',
  parseState: parseKfcVerifiedState,
  async run(input, invokeModel) {
    if (!input.agentModel) throw new Error('kfc_agent_not_configured');
    const tracer = createSafeAgentTracer(
      input.tracer ?? createNoopAgentTracer(),
      (code, error) => {
        console.error(code, {
          sessionId: input.sessionId,
          errorClass: traceErrorClass(error),
        });
      },
    );
    const abortController = new AbortController();
    const externalCallContext: ExternalCallContext = {
      signal: abortController.signal,
      deadlineAt: Number.MAX_SAFE_INTEGER,
    };

    let turnTrace: AgentTraceSpan | undefined;
    try {
      const responseProfile = resolveResponseProfile(input);
      const currentUserTurn = await loadOrAppendAgentCurrentUserTurn(
        input,
        responseProfile,
      );
      turnTrace = await tracer.startTurn({
        name: 'kfc_agent_turn',
        inputs: {
          messageCharacterCount: input.text.length,
          structuredAction: Boolean(input.trustedCustomerAction),
        },
        metadata: traceMetadata({
          turnInput: input,
          turnId: currentUserTurn?.id,
          responseProfile,
        }),
        tags: traceTags(input, responseProfile),
      });
      const [prior, turns] = await Promise.all([
        loadPriorVerifiedState(input.store, input.sessionId, {
          packRef: KFC_VIETNAM_PACK_REF,
          schemaVersion: '1',
          parseState: parseKfcVerifiedState,
        }),
        input.store.listTurns(input.sessionId),
      ]);
      const exchanges = completeConversationExchanges(
        semanticConversationTurns(turns),
      );
      const contextPolicy = input.conversationContext;
      const tokenBudget =
        contextPolicy?.tokenBudget ?? DEFAULT_CONVERSATION_CONTEXT_TOKEN_BUDGET;
      const countTokens =
        contextPolicy?.countTokens ??
        ((text: string) => input.agentModel!.getNumTokens(text));
      let persistedSummary = await input.store.getConversationSummary(
        input.sessionId,
      );
      let context = await assembleConversationContext({
        ...(persistedSummary ? { summary: persistedSummary } : {}),
        exchanges,
        tokenBudget,
        countTokens,
        authoritativeState: prior,
      });
      if (context.omittedExchanges.length > 0) {
        try {
          const summaryResult = await advanceConversationSummary({
            store: input.store,
            sessionId: input.sessionId,
            exchanges: context.omittedExchanges,
            summarize:
              contextPolicy?.summarize ??
              langChainConversationSummarizer(input.agentModel),
          });
          persistedSummary = summaryResult.summary;
          context = await assembleConversationContext({
            ...(persistedSummary ? { summary: persistedSummary } : {}),
            exchanges,
            tokenBudget,
            countTokens,
            authoritativeState: prior,
          });
        } catch {
          // Summary generation is optional context maintenance. Its CAS write
          // occurs only after successful generation, so the prior watermark
          // remains authoritative and the customer turn can continue.
        }
      }
      const loaded = assembleLoadedTurnState({
        turnInput: input,
        prior: context.authoritativeState ?? prior,
        semanticTurns: semanticConversationTurns(turns),
        currentUserTurn,
      });
      loaded.state.recentTurns = context.exchanges.flatMap(
        (exchange) => exchange.turns,
      );
      const state = loaded.state;
      if (!state.cart) {
        const created = await input.clients.cart.createCart(
          input.sessionId,
          externalCallContext,
        );
        if (!created.ok || !created.value) {
          throw new Error(created.message || 'kfc_cart_unavailable');
        }
        state.cart = created.value;
      }
      const currentTurnToolTrace: ToolTraceEntry[] = [];
      await input.observeRun?.({ kind: 'planning' });
      const callbacks = await turnTrace.langchainCallbacks?.();
      const runWithContext = turnTrace.withActiveTrace?.bind(turnTrace);
      const responseText = await invokeModel({
        model: input.agentModel,
        messages: conversationMessages(input, state, currentUserTurn, context),
        tools: createKfcTools({
          turnInput: input,
          state,
          externalCallContext,
          currentTurnToolTrace,
        }),
        systemPrompt: systemPrompt(state),
        signal: externalCallContext.signal,
        ...(callbacks || runWithContext
          ? {
              runtime: {
                ...(callbacks ? { callbacks } : {}),
                ...(runWithContext ? { runWithContext } : {}),
              },
            }
          : {}),
        responseErrors: {
          invalid: 'kfc_agent_model_response_invalid',
          empty: 'kfc_agent_model_response_empty',
        },
      });
      const output = await persistCompletedTurn({
        turnInput: input,
        turnTrace,
        state,
        currentTurnToolTrace,
        responseText,
        packRef: KFC_VIETNAM_PACK_REF,
        packStateSchemaVersion: '1',
      });
      await turnTrace.end({
        toolCallCount: currentTurnToolTrace.length,
        responseCharacterCount: output.responseText.length,
      });
      scheduleTraceFlush(input, tracer);
      return output;
    } catch (error) {
      abortController.abort(error);
      await turnTrace?.fail(error);
      scheduleTraceFlush(input, tracer);
      throw error;
    }
  },
};
