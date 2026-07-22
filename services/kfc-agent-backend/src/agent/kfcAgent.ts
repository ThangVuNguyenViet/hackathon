import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import {
  HumanMessage,
  isAIMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import { createAgent, tool, type ToolRuntime } from 'langchain';
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

export const KFC_AGENT_INSTRUCTIONS = [
  'Bạn là trợ lý KFC Việt Nam thân thiện, tự nhiên và chủ động.',
  'Hiểu yêu cầu của khách và tự chọn công cụ phù hợp. Không cần giải thích quy trình nội bộ.',
  'Dùng dữ liệu từ lịch sử hội thoại, trạng thái nghiệp vụ đã xác minh và kết quả công cụ. Không tự bịa mã món, giá, cửa hàng, đơn hàng hoặc trạng thái thanh toán.',
  'Nếu khách yêu cầu đầy đủ thực đơn, gọi searchMenu với truy vấn rỗng và dùng toàn bộ kết quả; không tự rút gọn danh sách dữ liệu.',
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
): BaseMessage[] {
  const messages: BaseMessage[] = [];
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

async function executeModelTool(input: {
  turnInput: AgentTurnInput;
  state: AgentState;
  toolName: ToolName;
  args: Record<string, unknown>;
  callId: string;
  externalCallContext: ExternalCallContext;
  currentTurnToolTrace: ToolTraceEntry[];
}): Promise<ToolCallResult> {
  const bindingFingerprint = await stateRevision({
    sessionId: input.turnInput.sessionId,
    externalMessageId: input.turnInput.externalMessageId ?? null,
    callId: input.callId,
    toolName: input.toolName,
    args: input.args,
  });
  const result = await executeToolCall(
    input.turnInput.clients,
    { toolName: input.toolName, arguments: input.args },
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
    input.args,
    input.currentTurnToolTrace,
  );
  return result;
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
        schema: providerPortableToolSchema(toolArgumentSchemas[toolName]),
      },
    ),
  );
}

async function runModelAgent(input: {
  turnInput: AgentTurnInput;
  model: BaseChatModel;
  state: AgentState;
  messages: BaseMessage[];
  externalCallContext: ExternalCallContext;
  currentTurnToolTrace: ToolTraceEntry[];
}): Promise<string> {
  const agent = createAgent({
    model: input.model,
    tools: createKfcTools(input),
    systemPrompt: systemPrompt(input.state),
  });
  await input.turnInput.observeRun?.({ kind: 'planning' });
  const result = await agent.invoke(
    { messages: input.messages },
    {
      signal: input.externalCallContext.signal,
    },
  );
  const response = result.messages.at(-1);
  if (!response || !isAIMessage(response)) {
    throw new Error('kfc_agent_model_response_invalid');
  }
  const text = messageText(response);
  if (!text) throw new Error('kfc_agent_model_response_empty');
  return text;
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
    metadata: { runtime: 'langchain-create-agent' },
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
    const responseText = await runModelAgent({
      turnInput: input,
      model: input.agentModel,
      state,
      messages: conversationMessages(input, state, currentUserTurn),
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
