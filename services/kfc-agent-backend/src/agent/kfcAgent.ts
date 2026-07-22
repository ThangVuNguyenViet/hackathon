import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import {
  HumanMessage,
  SystemMessage,
  ToolMessage,
  isAIMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import type { StructuredToolParams } from '@langchain/core/tools';
import type { ToolCall } from '@langchain/core/messages/tool';
import type { ExternalCallContext } from '../clients/interfaces.js';
import type { AgentTurnInput, AgentTurnOutput } from './agentTurn.js';
import type { AgentState } from './agentState.js';
import { stateRevision, toolExecutionContext } from './turnSupport.js';
import {
  applyToolResultToState,
  loadPriorVerifiedState,
} from './verifiedState.js';
import {
  agentToolDescriptions,
  toolArgumentSchemas,
  toolNames,
} from '../ordering/toolCatalog.js';
import { executeToolCall } from '../ordering/toolExecutor.js';
import type {
  ToolCallResult,
  ToolName,
  ToolTraceEntry,
} from '../ordering/types.js';
import {
  createNoopAgentTracer,
  createSafeAgentTracer,
} from '../observability/agentTracing.js';
import { resolveResponseProfile } from '../presentation/responseProfile.js';
import { providerPortableToolSchema } from './providerPortableToolSchema.js';
import { freshMessages, messageText } from './agentConversationMessages.js';
import { persistCompletedTurn } from './agentTurnPersistence.js';
import { assembleLoadedTurnState } from './agentTurnStateHydration.js';
import { loadOrAppendAgentCurrentUserTurn } from './agentTurnIntake.js';
import { semanticConversationTurns } from './trustedActionConversation.js';

const DEFAULT_MAX_TOOL_ROUNDS = 20;
const toolNameSet: ReadonlySet<string> = new Set(toolNames);

export const KFC_AGENT_INSTRUCTIONS = [
  'Bạn là trợ lý KFC Việt Nam thân thiện, tự nhiên và chủ động.',
  'Hiểu yêu cầu của khách và tự chọn công cụ phù hợp. Không cần giải thích quy trình nội bộ.',
  'Dùng dữ liệu từ lịch sử hội thoại, trạng thái nghiệp vụ đã xác minh và kết quả công cụ. Không tự bịa mã món, giá, cửa hàng, đơn hàng hoặc trạng thái thanh toán.',
  'Nếu khách yêu cầu đầy đủ thực đơn, gọi searchMenu với truy vấn rỗng và dùng toàn bộ kết quả; không tự rút gọn danh sách dữ liệu.',
  'Nếu khách đã yêu cầu rõ ràng thực hiện một thao tác, hãy thực hiện trong cùng lượt khi đã đủ dữ liệu thay vì hỏi xác nhận lặp lại.',
  'Khi công cụ báo thiếu dữ liệu hoặc thất bại, nói ngắn gọn điều còn thiếu và tiếp tục tự nhiên.',
  'Trả lời bằng ngôn ngữ của khách.',
].join('\n');

function toolDefinitions(): StructuredToolParams[] {
  return toolNames.map((name) => ({
    name,
    description: agentToolDescriptions[name],
    schema: providerPortableToolSchema(toolArgumentSchemas[name]),
  }));
}

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

function modelMessages(
  input: AgentTurnInput,
  state: AgentState,
  currentUserTurn: Awaited<ReturnType<typeof loadOrAppendAgentCurrentUserTurn>>,
): BaseMessage[] {
  const context = verifiedContext(state);
  const messages: BaseMessage[] = [new SystemMessage(KFC_AGENT_INSTRUCTIONS)];
  if (Object.keys(context).length > 0) {
    messages.push(
      new SystemMessage(
        `Verified current business state. Reuse these exact identifiers and values: ${JSON.stringify(context)}`,
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

function toolNameFor(call: ToolCall): ToolName {
  if (!isToolName(call.name)) {
    throw new Error(`Unknown KFC tool requested by model: ${call.name}`);
  }
  return call.name;
}

function isToolName(value: string): value is ToolName {
  return toolNameSet.has(value);
}

function toolArguments(call: ToolCall): Record<string, unknown> {
  if (
    typeof call.args !== 'object' ||
    call.args === null ||
    Array.isArray(call.args)
  ) {
    throw new Error(`Invalid arguments for KFC tool: ${call.name}`);
  }
  return call.args as Record<string, unknown>;
}

async function executeModelTool(input: {
  turnInput: AgentTurnInput;
  state: AgentState;
  call: ToolCall;
  externalCallContext: ExternalCallContext;
  currentTurnToolTrace: ToolTraceEntry[];
}): Promise<ToolCallResult> {
  const toolName = toolNameFor(input.call);
  const args = toolArguments(input.call);
  if (toolName === 'placeOrder') input.state.userConfirmedOrder = true;
  const bindingFingerprint = await stateRevision({
    sessionId: input.turnInput.sessionId,
    externalMessageId: input.turnInput.externalMessageId ?? null,
    callId: input.call.id ?? null,
    toolName,
    args,
  });
  const result = await executeToolCall(
    input.turnInput.clients,
    { toolName, arguments: args },
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
  return result;
}

async function runToolLoop(input: {
  turnInput: AgentTurnInput;
  model: BaseChatModel;
  state: AgentState;
  messages: BaseMessage[];
  externalCallContext: ExternalCallContext;
  currentTurnToolTrace: ToolTraceEntry[];
  maxToolRounds?: number;
}): Promise<string> {
  const bound = input.model.bindTools?.(toolDefinitions());
  if (!bound) throw new Error('kfc_agent_model_does_not_support_tools');
  const messages = [...input.messages];
  const maxToolRounds = input.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS;

  for (let round = 0; round <= maxToolRounds; round += 1) {
    await input.turnInput.observeRun?.({ kind: 'planning' });
    const response = await bound.invoke(messages, {
      signal: input.externalCallContext.signal,
    });
    if (!isAIMessage(response))
      throw new Error('kfc_agent_model_response_invalid');
    messages.push(response);
    const calls = response.tool_calls ?? [];
    if (calls.length === 0) {
      const text = messageText(response);
      if (!text) throw new Error('kfc_agent_model_response_empty');
      return text;
    }
    if (round === maxToolRounds) {
      throw new Error(`kfc_agent_tool_round_limit:${maxToolRounds}`);
    }

    for (const call of calls) {
      const result = await executeModelTool({
        turnInput: input.turnInput,
        state: input.state,
        call,
        externalCallContext: input.externalCallContext,
        currentTurnToolTrace: input.currentTurnToolTrace,
      });
      messages.push(
        new ToolMessage({
          name: call.name,
          tool_call_id: call.id ?? `${call.name}:${round}`,
          content: JSON.stringify(result),
        }),
      );
    }
  }
  throw new Error('kfc_agent_tool_loop_ended_unexpectedly');
}

export async function runAgentTurn(
  input: AgentTurnInput,
): Promise<AgentTurnOutput> {
  if (!input.agentModel) throw new Error('kfc_agent_not_configured');
  const tracer = createSafeAgentTracer(
    input.tracer ?? createNoopAgentTracer(),
    (code, error) => {
      void input.store
        .appendEvent(input.sessionId, code, {
          message: error instanceof Error ? error.message : String(error),
        })
        .catch(() => undefined);
    },
  );
  const turnTrace = await tracer.startTurn({
    name: 'kfc_agent_turn',
    inputs: {
      sessionId: input.sessionId,
      channel: input.channel,
      text: input.text,
    },
    metadata: { runtime: 'simple-model-tool-loop' },
    tags: ['kfc-agent'],
  });
  const abortController = new AbortController();
  const externalCallContext: ExternalCallContext = {
    signal: abortController.signal,
    deadlineAt: Number.MAX_SAFE_INTEGER,
  };

  try {
    const responseProfile = resolveResponseProfile(input);
    const currentUserTurn = await loadOrAppendAgentCurrentUserTurn(
      input,
      responseProfile,
    );
    const [prior, turns] = await Promise.all([
      loadPriorVerifiedState(input.store, input.sessionId),
      input.store.listTurns(input.sessionId),
    ]);
    const loaded = assembleLoadedTurnState({
      turnInput: input,
      prior,
      semanticTurns: semanticConversationTurns(turns),
      currentUserTurn,
    });
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
    const responseText = await runToolLoop({
      turnInput: input,
      model: input.agentModel,
      state,
      messages: modelMessages(input, state, currentUserTurn),
      externalCallContext,
      currentTurnToolTrace,
    });
    const output = await persistCompletedTurn({
      turnInput: input,
      turnTrace,
      state,
      currentTurnToolTrace,
      responseText,
    });
    await turnTrace.end({
      toolCalls: currentTurnToolTrace.length,
      responseText: output.responseText,
    });
    await tracer.flush();
    return output;
  } catch (error) {
    abortController.abort(error);
    await turnTrace.fail(error);
    await tracer.flush();
    throw error;
  }
}
