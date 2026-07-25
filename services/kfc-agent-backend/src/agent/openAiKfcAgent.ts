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

export type OpenAiToolRetryReason =
  'empty_result' | 'tool_error' | 'invalid_arguments' | 'invalid_result';

export interface OpenAiToolRetryPolicy {
  maxAttempts: number;
  retryOn: readonly OpenAiToolRetryReason[];
}

export interface OpenAiFunctionTool {
  definition: OpenAiFunctionToolDefinition;
  execute(arguments_: Record<string, unknown>): Promise<unknown>;
  retryPolicy?: OpenAiToolRetryPolicy;
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
  reviewToolGroundedResponse?: boolean;
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
  '# Role',
  'You are a friendly, natural KFC Vietnam ordering assistant. Understand the customer’s intent, use the available capabilities when needed, and help complete the request with as little friction as possible.',
  '',
  '# Grounding',
  'Treat tool results and verified business state as the only authority for menu facts, prices, availability, options, promotions, policies, fulfillment, payments, order state, and human support.',
  'Only state facts that the current evidence directly supports. Missing data is not proof that something exists or does not exist. Never fill gaps with assumptions, common knowledge, or market conventions.',
  'Keep every returned attribute attached to the exact item, option, or branch that supplied it. Use verified identifiers internally and never invent identifiers.',
  'Before publishing, reconcile the draft response with the exact current tool results and verified business state. Correct any unsupported name, category, option, price, quantity, availability, action, or completeness claim.',
  '',
  '# Actions',
  'When the customer’s intent and required data are clear, finish all safe steps in the same turn instead of merely describing what could be done.',
  'Perform a reversible action when the customer clearly requests it. Perform an irreversible action only after an explicit customer request or a trusted Generative UI action that represents that request. Supplying an address or asking for a delivery quote is not an order confirmation.',
  'If a request is materially ambiguous and acting could change the wrong item, quantity, option, address, payment, or order, ask one natural clarification.',
  'When a tool result requires recovery, follow its recovery instruction in the same turn with materially corrected arguments. Stop when recovery is exhausted. Never repeat an uncertain mutation.',
  'When the customer explicitly selects a named product from earlier verified menu evidence, preserve that exact product across later turns. Treat a requested drink, side, or other extra as a separate add-on unless the customer explicitly asks to replace an included option. Do not substitute another product merely because a combined search is empty; retry the exact product without unrelated constraints, then search the add-on separately.',
  'A follow-up that supplies a missing choice completes the pending request using its already selected product and known constraints. Do not reopen or replace an already selected product unless the customer explicitly requests that change.',
  'If an option is unavailable inside the current item, continue with an appropriate standalone menu item when that satisfies the same clear request. When the customer delegates a recommendation, choose one complete verified option and explain it briefly.',
  'When the customer delegates a reversible menu or cart decision and provides sufficient constraints, choose and execute a complete verified plan in the same turn. Treat a stated budget as a maximum unless the customer asks to spend close to it. For a close-to-target request, keep improving the verified cart while another available item reduces the distance to that target without exceeding it; fall back beyond a preferred category when that better satisfies the customer’s constraints. Use the Python tool for nontrivial combination arithmetic over verified menu candidates. For every recommendation containing multiple priced items and an explicit numeric budget, you must use the Python tool before answering, even when the menu evidence is already present in conversation context. Recalculate the complete proposed total, compare it with every explicit lower or upper bound, and correct the selection before presenting or mutating the cart. For a delegated multi-item plan, finish all required information gathering and arithmetic before the first cart mutation. Do not construct a delegated multi-item plan through incremental cart mutations. Satisfy every explicit component constraint, then report the final verified cart. Ask for clarification only when missing information would materially change the choice.',
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
  for (const call of input.toolCalls) {
    if (call.name !== 'updateCart') continue;
    const changedCodes = new Set<string>();
    if (typeof call.arguments.itemCode === 'string') {
      changedCodes.add(call.arguments.itemCode);
    }
    if (Array.isArray(call.arguments.changes)) {
      for (const change of call.arguments.changes) {
        if (isRecord(change) && typeof change.itemCode === 'string') {
          changedCodes.add(change.itemCode);
        }
      }
    }
    for (const { code, name } of authoritativeItemLabels([call])) {
      if (!changedCodes.has(code)) continue;
      const variantName = /^(.*\S)\s+\([^()]+\)$/u.exec(name);
      if (!variantName?.[1]) continue;
      customerText = customerText.replace(
        new RegExp(`${escapedRegExp(variantName[1])}\\s+\\([^()\\n]+\\)`, 'gu'),
        name,
      );
    }
  }
  return stripStructuralLabels(customerText, structuralLabels);
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
            ? 'Handle the verified structured address update and describe only its resulting draft, missing fields, serviceability, or quote.'
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
      reviewToolGroundedResponse:
        input.channel !== 'messenger' && input.channel !== 'messenger_mock',
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

type ToolChoice = 'auto' | 'required' | 'none';

interface ToolRecovery {
  required: boolean;
  exhausted?: true;
  reason: OpenAiToolRetryReason;
  attempt: number;
  maxAttempts: number;
  instruction: string;
}

function toolErrorCode(result: unknown): string | undefined {
  if (!isRecord(result) || result.ok !== false) return undefined;
  return typeof result.errorCode === 'string' ? result.errorCode : undefined;
}

function isInvalidArgumentsResult(result: unknown): boolean {
  const errorCode = toolErrorCode(result);
  return (
    errorCode === 'invalid_arguments' ||
    errorCode === 'invalid_tool_arguments' ||
    errorCode === 'unverified_payment_method'
  );
}

function resultPayload(result: unknown): unknown {
  return isRecord(result) && result.ok === true && 'value' in result
    ? result.value
    : result;
}

function isEmptyToolResult(result: unknown): boolean {
  const payload = resultPayload(result);
  if (Array.isArray(payload)) return payload.length === 0;
  if (!isRecord(payload)) return false;
  if (Array.isArray(payload.items)) return payload.items.length === 0;
  return payload.total === 0;
}

function isInvalidToolResult(result: unknown): boolean {
  const payload = resultPayload(result);
  if (payload === undefined) return true;
  return isRecord(payload) && Object.keys(payload).length === 0;
}

function retryReasonForResult(
  tool: OpenAiFunctionTool,
  result: unknown,
): OpenAiToolRetryReason | undefined {
  const retryOn = tool.retryPolicy?.retryOn ?? [];
  if (
    isInvalidArgumentsResult(result) &&
    retryOn.includes('invalid_arguments')
  ) {
    return 'invalid_arguments';
  }
  if (
    isRecord(result) &&
    result.ok === false &&
    retryOn.includes('tool_error')
  ) {
    return 'tool_error';
  }
  if (isEmptyToolResult(result) && retryOn.includes('empty_result')) {
    return 'empty_result';
  }
  if (isInvalidToolResult(result) && retryOn.includes('invalid_result')) {
    return 'invalid_result';
  }
  return undefined;
}

function retryReasonForThrownError(
  tool: OpenAiFunctionTool,
  error: unknown,
): OpenAiToolRetryReason | undefined {
  const retryOn = tool.retryPolicy?.retryOn ?? [];
  const errorName =
    isRecord(error) && typeof error.name === 'string' ? error.name : '';
  if (
    (errorName === 'ZodError' || error instanceof SyntaxError) &&
    retryOn.includes('invalid_arguments')
  ) {
    return 'invalid_arguments';
  }
  return retryOn.includes('tool_error') ? 'tool_error' : undefined;
}

function toolFailureResult(
  reason: OpenAiToolRetryReason,
  error: unknown,
): Record<string, unknown> {
  const message =
    error instanceof Error && error.message.trim().length > 0
      ? error.message
      : reason === 'invalid_arguments'
        ? 'Tool arguments were invalid'
        : 'Tool execution failed';
  return {
    ok: false,
    errorCode: reason,
    message,
  };
}

function withRecovery(
  result: unknown,
  recovery: ToolRecovery,
): Record<string, unknown> {
  return {
    ...(isRecord(result) ? result : { result }),
    recovery,
  };
}

function authoritativeItemLabels(
  toolCalls: readonly OpenAiToolCallTrace[],
): Array<{ code: string; name: string }> {
  const labels = new Map<string, string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!isRecord(value)) return;
    const code =
      typeof value.code === 'string'
        ? value.code
        : typeof value.itemCode === 'string'
          ? value.itemCode
          : undefined;
    if (code && typeof value.name === 'string' && !labels.has(code)) {
      labels.set(code, value.name);
    }
    for (const nested of Object.values(value)) visit(nested);
  };
  for (const call of toolCalls) visit(call.result);
  return [...labels].map(([code, name]) => ({ code, name }));
}

function recoveryForAttempt(input: {
  toolName: string;
  reason: OpenAiToolRetryReason;
  attempt: number;
  maxAttempts: number;
}): ToolRecovery {
  const exhausted = input.attempt >= input.maxAttempts;
  return {
    required: !exhausted,
    ...(exhausted ? { exhausted: true as const } : {}),
    reason: input.reason,
    attempt: input.attempt,
    maxAttempts: input.maxAttempts,
    instruction: exhausted
      ? 'Stop retrying and answer honestly from verified evidence.'
      : input.toolName === 'searchMenu'
        ? 'You must make another corrected read call before answering the customer. Retry searchMenu with materially corrected arguments. For a category-wide request, use category with an empty query for category-wide retrieval and retain applicable inclusive or exclusive price constraints. For modifier requirements, broaden only the product terms while retaining modifierQueries. An unconstrained exact-product search may verify that the product exists, but do not answer from an unconstrained product result as though the modifier requirement matched; inspect that exact product with getModifierOptions before making the modifier claim. Search requested standalone drinks, sides, or other add-ons independently. An empty constrained result does not prove that the requested product is absent. Do not repeat identical arguments or substitute another product before verifying the requested product independently.'
        : 'Retry with materially corrected or broader arguments. Do not repeat identical arguments. You may choose another suitable read tool.',
  };
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
  let nextToolChoice: ToolChoice = 'auto';
  let semanticFailureAttempts = 0;
  let responseReviewPerformed = false;
  let draftResponseText: string | undefined;

  for (let round = 0; round <= options.maxToolRounds; round += 1) {
    const hostedTools =
      options.allowModelToolCalls !== false && nextToolChoice === 'auto'
        ? [
            {
              type: 'code_interpreter',
              container: { type: 'auto' },
            },
          ]
        : [];
    const response = await options.client.responses.create({
      model: options.model,
      instructions: options.instructions,
      tools: [...modelTools.map((tool) => tool.definition), ...hostedTools],
      tool_choice:
        options.allowModelToolCalls === false ? 'none' : nextToolChoice,
      parallel_tool_calls: true,
      input,
    });
    if (!response) {
      if (responseReviewPerformed && draftResponseText !== undefined) {
        return {
          responseText: draftResponseText,
          toolCalls,
          usage,
        };
      }
      throw new Error('OpenAI returned no response');
    }

    usage.inputTokens += response.usage?.input_tokens ?? 0;
    usage.outputTokens += response.usage?.output_tokens ?? 0;
    usage.totalTokens += response.usage?.total_tokens ?? 0;

    const calls = response.output.filter(isFunctionCall);
    if (calls.length === 0) {
      if (
        options.reviewToolGroundedResponse === true &&
        options.allowModelToolCalls !== false &&
        toolCalls.length > 0 &&
        !responseReviewPerformed
      ) {
        draftResponseText = response.output_text;
        responseReviewPerformed = true;
        nextToolChoice = 'none';
        const itemLabels = authoritativeItemLabels(toolCalls);
        input.push({
          role: 'developer',
          content: [
            'Review the draft against the exact current-turn tool results before publishing it.',
            'Do not simply repeat or lightly edit the draft: independently reconstruct the answer from the current user request and current-turn function_call_output evidence.',
            'Copy every returned product and variant name character-for-character. Keep categories, prices, quantities, availability, modifier properties, actions, and cart contents attached to the exact evidence that supplied them.',
            ...(itemLabels.length > 0
              ? [
                  `Authoritative customer-facing item labels: ${JSON.stringify(itemLabels)}`,
                ]
              : []),
            'Apply numeric boundaries mechanically: strict below excludes equality, while at most includes equality.',
            'A modifier or ingredient claim requires matching option evidence for that exact item. An unconstrained search result does not satisfy a dropped customer constraint.',
            'A newly added item must be an exact current-turn menu candidate of the requested kind and must appear in the returned cart.',
            'A complete-menu claim is valid only when every returned menu item is presented. Check every explicit party-size, component, exclusion, and budget constraint before claiming the plan is complete.',
            'If the draft conflicts with the evidence, correct it now. Otherwise preserve it. Return only the final natural customer-facing response and do not mention this review.',
            `Draft response: ${JSON.stringify(response.output_text)}`,
          ].join('\n'),
        });
        continue;
      }
      return {
        responseText: response.output_text || draftResponseText || '',
        toolCalls,
        usage,
      };
    }
    if (round === options.maxToolRounds) {
      throw new Error(`OpenAI exceeded ${options.maxToolRounds} tool rounds`);
    }

    input.push(...response.output);
    nextToolChoice = 'auto';
    for (const call of calls) {
      const tool = toolsByName.get(call.name);
      if (!tool) throw new Error(`OpenAI requested unknown tool: ${call.name}`);
      let arguments_: Record<string, unknown> = {};
      let result: unknown;
      let retryReason: OpenAiToolRetryReason | undefined;
      try {
        const parsedArguments: unknown = JSON.parse(call.arguments);
        if (!isRecord(parsedArguments)) {
          throw new SyntaxError('Tool arguments must be a JSON object');
        }
        arguments_ = parsedArguments;
      } catch (error) {
        retryReason = tool.retryPolicy?.retryOn.includes('invalid_arguments')
          ? 'invalid_arguments'
          : undefined;
        result = toolFailureResult('invalid_arguments', error);
      }
      if (result === undefined) {
        try {
          result = await tool.execute(arguments_);
          retryReason = retryReasonForResult(tool, result);
        } catch (error) {
          retryReason = retryReasonForThrownError(tool, error);
          result = toolFailureResult(retryReason ?? 'tool_error', error);
        }
      }

      if (retryReason && tool.retryPolicy) {
        semanticFailureAttempts += 1;
        const maxAttempts = Math.min(tool.retryPolicy.maxAttempts, 3);
        const recovery = recoveryForAttempt({
          toolName: call.name,
          reason: retryReason,
          attempt: semanticFailureAttempts,
          maxAttempts,
        });
        result = withRecovery(result, recovery);
        nextToolChoice = recovery.exhausted ? 'none' : 'required';
      }

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
