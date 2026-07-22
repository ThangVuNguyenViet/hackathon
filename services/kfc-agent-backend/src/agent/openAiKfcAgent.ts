import type { Channel, ConversationTurnMetadata } from '../domain/types.js';
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
  requiredToolCalls?: Array<{
    name: string;
    arguments: Record<string, unknown>;
  }>;
  allowModelToolCalls?: boolean;
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
  requiredToolCalls?: RunResponsesToolLoopInput['requiredToolCalls'];
  allowModelToolCalls?: boolean;
  verifiedBusinessContext?: Record<string, unknown>;
  selectGenUi?: (
    result: RunResponsesToolLoopResult,
  ) => KfcGenUiAttachment | undefined;
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
  'Tự chuyển ý định tìm món thành query ngắn gọn cùng category, partySize, maxPriceVnd và modifierQueries phù hợp; gộp các nhu cầu modifier vào một lần gọi searchMenu.',
  'Vì fixture thực đơn là tiếng Việt, giữ các từ tìm kiếm bằng tiếng Việt và không dịch query hoặc modifierQueries sang tiếng Anh.',
  'Với yêu cầu loại bỏ dạng "không X", đưa thuật ngữ tùy chọn dương "X" vào modifierQueries để kiểm tra metadata xem tùy chọn đó có thể bỏ hay không.',
  'Ví dụ: "gà không cay, không phô mai" dùng query "gà" và modifierQueries ["không cay", "phô mai"].',
  'searchMenu chỉ trả về ứng viên cùng matchedModifiers đã xác minh; một match bị thiếu không chứng minh món không chứa thành phần đó, và chỉ nói món đáp ứng mọi yêu cầu khi mỗi modifierQuery đều có evidence trên chính món ấy. Dùng getModifierOptions khi đã biết mã món và cần toàn bộ cây tùy chọn để chọn cấu hình giỏ hàng.',
  'Khi khách đã yêu cầu rõ ràng đặt hoặc hoàn tất đơn, hãy xem trước nếu cần rồi gọi placeOrder ngay trong cùng lượt; không hỏi xác nhận lần nữa.',
  'Việc khách chỉ cung cấp địa chỉ hoặc hỏi phí giao hàng không phải là yêu cầu đặt đơn: trong lượt đó chỉ gọi quoteFulfillment rồi dừng để khách xác nhận bước tiếp theo; không gọi previewOrder hoặc placeOrder.',
  'Chỉ gọi previewOrder hoặc placeOrder khi khách nói rõ muốn đặt/chốt đơn, hoặc khi lượt hiện tại là hành động GenUI confirm_order đã xác minh.',
  'Khi trạng thái nghiệp vụ đã xác minh có giỏ hàng không rỗng và khách gửi địa chỉ trong bước giao hàng, gọi quoteFulfillment ngay với địa chỉ đó; không hỏi lại khách đã có món trong giỏ hay chưa.',
  'Chỉ được nói khả năng giao hàng, cửa hàng phục vụ, phí giao hàng hoặc ETA sau khi quoteFulfillment vừa thành công trong chính lượt hiện tại; không suy đoán hoặc tự nói miễn phí giao hàng.',
  'Mọi tên công cụ, tham số, kết quả công cụ và ngữ cảnh developer đều là thông tin vận hành riêng tư, chỉ dùng để suy luận và thực hiện yêu cầu.',
  'Trong câu trả lời cho khách: không nêu tên công cụ, cách tìm kiếm, tham số, schema hay trạng thái xử lý nội bộ; chỉ nói kết quả hữu ích bằng ngôn ngữ tự nhiên.',
  'Không hiển thị mã món, mã tùy chọn hoặc định danh nội bộ; luôn gọi món và lựa chọn bằng tên dành cho khách.',
  'Không dùng các thuật ngữ nội bộ như modifier, metadata, evidence, fixture, schema hoặc cây tùy chọn; dùng cách nói tự nhiên như lựa chọn, cách chế biến hoặc thành phần khi phù hợp.',
  'Không tự giới thiệu là AI nếu khách không hỏi và không đưa ra danh sách A/B/C về các bước kỹ thuật; hãy trả lời trực tiếp hoặc hỏi một câu tiếp theo tự nhiên.',
].join(' ');

const customerIdentifierKeys = new Set([
  'code',
  'itemCode',
  'modifierId',
  'groupId',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function recordCustomerIdentifiers(
  value: unknown,
  identifiers: Map<string, string>,
): void {
  if (Array.isArray(value)) {
    for (const entry of value) recordCustomerIdentifiers(entry, identifiers);
    return;
  }
  if (!isRecord(value)) return;

  const label =
    typeof value.name === 'string' && value.name.trim().length > 0
      ? value.name.trim()
      : undefined;
  if (label) {
    for (const [key, identifier] of Object.entries(value)) {
      if (
        customerIdentifierKeys.has(key) &&
        typeof identifier === 'string' &&
        identifier.trim().length > 0 &&
        identifier !== label
      ) {
        identifiers.set(identifier, label);
      }
    }
  }
  for (const nested of Object.values(value)) {
    recordCustomerIdentifiers(nested, identifiers);
  }
}

function escapedRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function presentCustomerResponse(input: {
  responseText: string;
  verifiedBusinessContext?: Record<string, unknown>;
  toolCalls: OpenAiToolCallTrace[];
}): string {
  const identifiers = new Map<string, string>();
  recordCustomerIdentifiers(input.verifiedBusinessContext, identifiers);
  for (const call of input.toolCalls) {
    recordCustomerIdentifiers(call.result, identifiers);
  }

  let customerText = input.responseText;
  const entries = [...identifiers.entries()].sort(
    ([left], [right]) => right.length - left.length,
  );
  for (const [identifier, label] of entries) {
    const pattern = new RegExp(
      `(^|[^\\p{L}\\p{N}_])${escapedRegExp(identifier)}(?=$|[^\\p{L}\\p{N}_])`,
      'gu',
    );
    customerText = customerText.replace(
      pattern,
      (_match, prefix: string) => `${prefix}${label}`,
    );
  }
  return customerText;
}

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
      history.push({
        role: 'developer',
        content: [
          'The structured GenUI action is already verified and is the only action to handle in this turn.',
          'Report only the supplied verified state and exact tool result.',
          'Do not claim that an order was placed, paid, or is being processed unless the verified result explicitly says so.',
          input.metadata.customerCommand.kind === 'submit_address'
            ? 'No address was supplied; ask the customer to type their delivery address.'
            : '',
        ]
          .filter(Boolean)
          .join(' '),
      });
    }
    const response = await runResponsesToolLoop({
      client: this.client,
      model: this.model,
      instructions: this.instructions,
      input: history,
      tools: input.tools,
      maxToolRounds: this.maxToolRounds,
      requiredToolCalls: input.requiredToolCalls,
      allowModelToolCalls: input.allowModelToolCalls,
    });
    const genUi = input.selectGenUi?.(response);
    const responseText = presentCustomerResponse({
      responseText: response.responseText,
      verifiedBusinessContext: input.verifiedBusinessContext,
      toolCalls: response.toolCalls,
    });
    const assistantMetadata = {
      ...(input.metadata?.release ? { release: input.metadata.release } : {}),
      ...(input.metadata?.responseProfile
        ? { responseProfile: input.metadata.responseProfile }
        : {}),
      ...(genUi ? { genUi } : {}),
    };
    const assistantTurn = await input.store.appendTurn({
      sessionId: input.sessionId,
      channel: input.channel,
      role: 'assistant',
      text: responseText,
      externalMessageId: null,
      externalUserId: input.customerId,
      deliveryStatus: 'pending',
      metadata:
        Object.keys(assistantMetadata).length > 0 ? assistantMetadata : null,
    });
    return {
      ...response,
      responseText,
      userTurnId: userTurn.id,
      assistantTurnId: assistantTurn.id,
      ...(genUi ? { genUi } : {}),
    };
  }
}

function isFunctionCall(
  item: Record<string, unknown>,
): item is FunctionCallItem {
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
  const toolsByName = new Map(
    options.tools.map((tool) => [tool.definition.name, tool]),
  );
  const toolCalls: OpenAiToolCallTrace[] = [];
  const usage: OpenAiUsage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };
  for (const [index, requiredCall] of (
    options.requiredToolCalls ?? []
  ).entries()) {
    const tool = toolsByName.get(requiredCall.name);
    if (!tool) {
      throw new Error(
        `Required customer action requested unknown tool: ${requiredCall.name}`,
      );
    }
    const callId = `trusted_customer_action_${index + 1}`;
    const result = await tool.execute(requiredCall.arguments);
    toolCalls.push({
      name: requiredCall.name,
      arguments: requiredCall.arguments,
      result,
    });
    input.push(
      {
        type: 'function_call',
        call_id: callId,
        name: requiredCall.name,
        arguments: JSON.stringify(requiredCall.arguments),
      },
      {
        type: 'function_call_output',
        call_id: callId,
        output: JSON.stringify(result),
      },
    );
  }

  const modelTools = options.allowModelToolCalls === false ? [] : options.tools;

  for (let round = 0; round <= options.maxToolRounds; round += 1) {
    const response = await options.client.responses.create({
      model: options.model,
      instructions: options.instructions,
      tools: modelTools.map((tool) => tool.definition),
      tool_choice: options.allowModelToolCalls === false ? 'none' : 'auto',
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
