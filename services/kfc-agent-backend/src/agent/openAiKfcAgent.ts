import type {
  Channel,
  ConversationTurnMetadata,
} from '../domain/types.js';
import type { KfcGenUiAttachment } from '../genui/kfcGenUi.js';
import type { ConversationStore } from '../persistence/contracts.js';
import { buildBoundedRecentTurns } from '../session/sessionContext.js';

export interface OpenAiFunctionToolDefinition {
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict: boolean;
}

export interface OpenAiFunctionTool {
  definition: OpenAiFunctionToolDefinition;
  execute(arguments_: Record<string, unknown>): Promise<unknown>;
}

export interface OpenAiToolCallTrace {
  name: string;
  arguments: Record<string, unknown>;
  result: unknown;
}

export interface OpenAiUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

interface FunctionCallItem {
  type: 'function_call';
  call_id: string;
  name: string;
  arguments: string;
  [key: string]: unknown;
}

interface ResponseLike {
  output: Array<Record<string, unknown>>;
  output_text: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  } | null;
}

export interface ResponsesClientLike {
  responses: {
    create(request: Record<string, unknown>): Promise<ResponseLike | undefined>;
  };
}

export interface RunResponsesToolLoopInput {
  client: ResponsesClientLike;
  model: string;
  instructions: string;
  input: Array<Record<string, unknown>>;
  tools: OpenAiFunctionTool[];
  maxToolRounds: number;
}

export interface RunResponsesToolLoopResult {
  responseText: string;
  toolCalls: OpenAiToolCallTrace[];
  usage: OpenAiUsage;
}

export interface OpenAiKfcAgentOptions {
  client: ResponsesClientLike;
  model: string;
  instructions?: string;
  maxToolRounds?: number;
}

export interface OpenAiKfcAgentTurnInput {
  sessionId: string;
  customerId: string;
  channel: Channel;
  text: string;
  externalMessageId: string | null;
  metadata: ConversationTurnMetadata | null;
  store: ConversationStore;
  tools: OpenAiFunctionTool[];
  verifiedBusinessContext?: Record<string, unknown>;
  selectGenUi?: (result: RunResponsesToolLoopResult) => KfcGenUiAttachment | undefined;
}

export interface OpenAiKfcAgentTurnResult extends RunResponsesToolLoopResult {
  userTurnId: string;
  assistantTurnId: string;
  genUi?: KfcGenUiAttachment;
}

const defaultInstructions = [
  'Bạn là trợ lý KFC Việt Nam thân thiện và tự nhiên.',
  'Dùng các công cụ khi cần dữ liệu hoặc cần thực hiện thao tác.',
  'Trả lời trực tiếp dựa trên kết quả công cụ; không bịa dữ liệu.',
  'Luôn dùng đúng mã món, cửa hàng và đơn hàng từ kết quả công cụ hoặc trạng thái nghiệp vụ đã xác minh; không tự tạo mã.',
  'Khi khách đã yêu cầu rõ ràng đặt hoặc hoàn tất đơn, hãy xem trước nếu cần rồi gọi placeOrder ngay trong cùng lượt; không hỏi xác nhận lần nữa.',
].join(' ');

export class OpenAiKfcAgent {
  private readonly client: ResponsesClientLike;
  private readonly model: string;
  private readonly instructions: string;
  private readonly maxToolRounds: number;

  constructor(options: OpenAiKfcAgentOptions) {
    this.client = options.client;
    this.model = options.model;
    this.instructions = options.instructions ?? defaultInstructions;
    this.maxToolRounds = options.maxToolRounds ?? 12;
  }

  async respond(input: OpenAiKfcAgentTurnInput): Promise<OpenAiKfcAgentTurnResult> {
    const existingUserTurn = input.externalMessageId
      ? await input.store.findTurnByExternalMessage(input.sessionId, input.externalMessageId)
      : undefined;
    const userTurn = existingUserTurn ?? await input.store.appendTurn({
      sessionId: input.sessionId,
      channel: input.channel,
      role: 'user',
      text: input.text,
      externalMessageId: input.externalMessageId,
      externalUserId: input.customerId,
      deliveryStatus: 'received',
      metadata: input.metadata,
    });
    const history: Array<Record<string, unknown>> = buildBoundedRecentTurns(
      await input.store.listTurns(input.sessionId),
    )
      .filter((turn) => turn.role === 'user' || turn.role === 'assistant')
      .map((turn) => ({ role: turn.role, content: turn.text }));
    if (input.verifiedBusinessContext) {
      history.push({
        role: 'developer',
        content: `Verified current fixture business state; reuse these exact identifiers: ${JSON.stringify(input.verifiedBusinessContext)}`,
      });
    }
    if (input.metadata?.customerCommand) {
      history.push({
        role: 'developer',
        content: `Verified GenUI customer action: ${JSON.stringify(input.metadata.customerCommand)}`,
      });
    }
    const response = await runResponsesToolLoop({
      client: this.client,
      model: this.model,
      instructions: this.instructions,
      input: history,
      tools: input.tools,
      maxToolRounds: this.maxToolRounds,
    });
    const genUi = input.selectGenUi?.(response);
    const assistantMetadata = {
      ...(input.metadata?.release ? { release: input.metadata.release } : {}),
      ...(input.metadata?.responseProfile ? { responseProfile: input.metadata.responseProfile } : {}),
      ...(genUi ? { genUi } : {}),
    };
    const assistantTurn = await input.store.appendTurn({
      sessionId: input.sessionId,
      channel: input.channel,
      role: 'assistant',
      text: response.responseText,
      externalMessageId: null,
      externalUserId: input.customerId,
      deliveryStatus: 'pending',
      metadata: Object.keys(assistantMetadata).length > 0 ? assistantMetadata : null,
    });
    return {
      ...response,
      userTurnId: userTurn.id,
      assistantTurnId: assistantTurn.id,
      ...(genUi ? { genUi } : {}),
    };
  }
}

function isFunctionCall(item: Record<string, unknown>): item is FunctionCallItem {
  return (
    item.type === 'function_call' &&
    typeof item.call_id === 'string' &&
    typeof item.name === 'string' &&
    typeof item.arguments === 'string'
  );
}

export async function runResponsesToolLoop(
  options: RunResponsesToolLoopInput,
): Promise<RunResponsesToolLoopResult> {
  const input = structuredClone(options.input);
  const toolsByName = new Map(options.tools.map((tool) => [tool.definition.name, tool]));
  const toolCalls: OpenAiToolCallTrace[] = [];
  const usage: OpenAiUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

  for (let round = 0; round <= options.maxToolRounds; round += 1) {
    const response = await options.client.responses.create({
      model: options.model,
      instructions: options.instructions,
      tools: options.tools.map((tool) => tool.definition),
      tool_choice: 'auto',
      input,
    });
    if (!response) throw new Error('OpenAI returned no response');

    usage.inputTokens += response.usage?.input_tokens ?? 0;
    usage.outputTokens += response.usage?.output_tokens ?? 0;
    usage.totalTokens += response.usage?.total_tokens ?? 0;

    const calls = response.output.filter(isFunctionCall);
    if (calls.length === 0) {
      return { responseText: response.output_text, toolCalls, usage };
    }
    if (round === options.maxToolRounds) {
      throw new Error(`OpenAI exceeded ${options.maxToolRounds} tool rounds`);
    }

    input.push(...response.output);
    for (const call of calls) {
      const tool = toolsByName.get(call.name);
      if (!tool) throw new Error(`OpenAI requested unknown tool: ${call.name}`);
      const arguments_ = JSON.parse(call.arguments) as Record<string, unknown>;
      const result = await tool.execute(arguments_);
      toolCalls.push({ name: call.name, arguments: arguments_, result });
      input.push({
        type: 'function_call_output',
        call_id: call.call_id,
        output: JSON.stringify(result),
      });
    }
  }

  throw new Error('OpenAI tool loop ended unexpectedly');
}
