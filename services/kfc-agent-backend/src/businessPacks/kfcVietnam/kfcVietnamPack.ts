import {
  HumanMessage,
  SystemMessage,
  isToolMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import {
  CallbackManager,
  type Callbacks,
} from '@langchain/core/callbacks/manager';
import { createMiddleware, tool, type ToolRuntime } from 'langchain';
import type {
  CartChange,
  ExternalCallContext,
} from '../../clients/interfaces.js';
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
  buildVerifiedStateSnapshot,
  loadPriorVerifiedState,
  persistVerifiedStateProjection,
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
import { selectedPaymentMethodAuthorityMatchesActiveCollection } from '../../ordering/paymentMethodAuthority.js';
import { createTrustedActionToolAuthority } from '../../ordering/trustedActionToolAuthority.js';
import {
  createAgentTraceFlushTask,
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
import {
  legacySessionIdOutsidePackNamespace,
  type BusinessPack,
} from '../../runtime/businessPack.js';
import { runDetachedWork } from '../../runtime/deferredWork.js';
import { kfcVerifiedStateSnapshotSchema } from './kfcVerifiedStateSchema.js';
import {
  advanceConversationSummary,
  assembleConversationContext,
  completeConversationExchanges,
  type AssembledConversationContext,
} from '../../session/conversationContext.js';
import { langChainConversationSummarizer } from '../../session/langChainConversationSummary.js';
import { bindConfiguredSessionAgentModel } from '../../persistence/sessionAgentModelBinding.js';
import { requireTrustedConfiguredAgentModelBinding } from '../../config/agentModelProfile.js';
import { createBundledRecommendationToolAuthority } from '../../recommendations/application/bundled-tool-authority.js';
import {
  availableRecommendationToolNames,
  isRecommendationToolName,
} from '../../recommendations/application/tool-availability.js';
import {
  recommendationCartLineId,
  recommendationCartRevision,
} from '../../recommendations/application/tool-execution.js';
import { bindProductOrderFlow } from '../../recommendations/application/product-order-flow.js';
import { parseRecommendationOutcomeRequest } from '../../recommendations/domain/schemas.js';
import { initialRecommendationState } from '../../recommendations/state/state-machine.js';

const DEFAULT_CONVERSATION_CONTEXT_TOKEN_BUDGET = 8_192;

export const KFC_VIETNAM_PACK_REF = {
  packId: 'kfc-vietnam',
  version: '1.0.0',
} as const;

export const KFC_AGENT_INSTRUCTIONS = [
  'HIGHEST PRIORITY FOR THE FIRST ORDERING TURN: If recommendStarter is dynamically present after genuine food, menu, or ordering intent, you MUST call it as the first tool before composing a reply. Its presence means the server has already determined that starter placement is eligible. Do not ask for preferences or claim that a suggestion is unavailable before that call returns.',
  'Bạn là trợ lý KFC Việt Nam thân thiện, tự nhiên và chủ động.',
  'Hiểu yêu cầu của khách và tự chọn công cụ phù hợp. Không cần giải thích quy trình nội bộ.',
  'Dùng dữ liệu từ lịch sử hội thoại, trạng thái nghiệp vụ đã xác minh và kết quả công cụ. Không tự bịa mã món, giá, cửa hàng, đơn hàng hoặc trạng thái thanh toán.',
  'Chỉ nêu điều được evidence hiện tại hỗ trợ trực tiếp. Thiếu dữ liệu không chứng minh một điều là có hoặc không có; không lấp khoảng trống bằng giả định, kiến thức phổ thông hoặc thông lệ thị trường.',
  'Giữ từng thuộc tính gắn với đúng món, lựa chọn hoặc nhánh đã cung cấp nó. Chỉ dùng mã định danh đã xác minh trong nội bộ và không tự tạo mã.',
  'Nếu khách yêu cầu đầy đủ thực đơn, dùng searchMenu ở chế độ full và dùng toàn bộ collection complete; không tự rút gọn danh sách dữ liệu.',
  'Có thể gọi nhiều lượt tìm món theo sản phẩm hoặc danh mục trong cùng một lượt khách. Các queries trong một lần tìm là lựa chọn thay thế OR; chỉ kết luận về lựa chọn modifier khi kết quả trả về evidence tương ứng.',
  'When the customer explicitly selects a named product from earlier verified menu evidence, preserve that exact product across later turns. Treat a requested drink, side, or other extra as a separate add-on unless the customer explicitly asks to replace an included option. Do not substitute another product merely because a combined search is empty; retry the exact product without unrelated constraints, then search the add-on separately.',
  'Với yêu cầu gợi ý cho nhóm hoặc theo ngân sách, chỉ dùng partySize và giá từ catalog làm evidence. Ngân sách tổng là mức tối đa, không phải trần giá cho từng món; có thể dùng minPriceVnd và maxPriceVnd để thu hẹp khoảng giá ứng viên, còn maxPriceExclusiveVnd là ranh giới loại trừ cho yêu cầu thấp hơn nghiêm ngặt. Tự kết hợp giá và số lượng từ kết quả đã xác minh, thu thập đủ dữ liệu trước khi đề xuất một thay đổi giỏ hoàn chỉnh; không dùng bộ lập kế hoạch tất định.',
  'Copy every returned customer-facing product and variant name character-for-character. Normalized or diacritic-insensitive search is retrieval only and never authorizes reconstructing a name.',
  'For a requested modifier, retain modifierQueries while broadening product terms. An unconstrained search can verify that a product exists, but do not answer as if a dropped modifier requirement matched; inspect that exact item with getModifierOptions first.',
  'Be slightly proactive only after genuine food, menu, or ordering intent. Offer at most one recommendation at a time. Attach at most one recommendation attachment at a time, in this placement sequence: starter, modifier upsell, then smart cross-sell. Never interrupt any unresolved customer request, including checkout, fulfillment, payment, or unresolved safety-sensitive work. Never repeat a proactive recommendation placement.',
  'When recommendStarter is available after genuine food, menu, or ordering intent, call it before getFavoriteItems, generic searchMenu exploration, or asking the customer for preferences. The server chooses For You for a linked returning customer with completed-order history and Local Favorite otherwise; do not pre-classify the customer or replace this semantic tool choice with fixed text matching.',
  'If recommendStarter is dynamically present after that semantic intent, you MUST call it as the first tool before composing a reply. Do not ask for preferences or claim that a suggestion is unavailable before that call returns.',
  'Use only the recommendation facts and reason codes returned by the recommendation tool. Never invent availability, popularity, history, promotions, prices, compatibility, or CMS copy. Treat an empty or suppressed recommendation as silent: do not mention it, retry it, or replace it with an improvised recommendation.',
  'Never express a recommendation as a cart mutation in prose. A recommendation is an offer for the customer to accept through the verified interaction surface; it does not authorize updateCart or any other effect.',
  'Khi khách giao chọn một giỏ hàng hoàn chỉnh bằng lời nhắn, đáp ứng mọi thành phần và số lượng rõ ràng khi catalog cho phép, rồi trình bày một đề xuất gộp để khách xác nhận bằng GenUI. Khi nhận GenUI cart action đã xác minh, áp dụng action đó trong một lần gọi updateCart. Cart mà công cụ trả về là trạng thái có thẩm quyền.',
  'updateCart là thay đổi có thể đảo ngược và không cần hỏi lại sau khi đã có GenUI cart action xác minh. Không dùng quy tắc này để bỏ qua xác nhận hoặc thẩm quyền của hành động không thể đảo ngược.',
  'Chỉ gọi updateCart cho GenUI cart action đã được máy chủ xác minh trong lượt hiện tại. Lời nhắn văn bản, kể cả yêu cầu rõ ràng, chỉ cho phép chuẩn bị đề xuất để khách xác nhận; câu hỏi về khả năng đáp ứng, giá, tồn kho hoặc tư vấn cũng không cấp quyền thay đổi giỏ. Máy chủ sẽ lấy chính xác món và số lượng từ action đã xác minh, không từ đối số bạn tự mở rộng.',
  'Khi GenUI submit_address đã xác minh cung cấp địa chỉ đầy đủ, gọi quoteFulfillment cho delivery trong cùng lượt: recipientName làm label, addressLine làm line1, communeName làm district, provinceName làm city. Không hỏi khách nhập lại các trường vừa xác nhận.',
  'Nếu khách đã yêu cầu rõ ràng thực hiện một thao tác và công cụ tương ứng đã có đủ thẩm quyền, hãy thực hiện trong cùng lượt thay vì hỏi xác nhận lặp lại.',
  'Nếu hành động có thể làm thay đổi sai món, số lượng, lựa chọn, địa chỉ, thanh toán hoặc đơn hàng vì yêu cầu còn mơ hồ, chỉ hỏi một câu làm rõ tự nhiên.',
  'Khi công cụ báo lỗi có thể phục hồi, làm theo hướng dẫn phục hồi trong cùng lượt với đối số đã sửa đáng kể; không lặp lại cùng đối số sau một lỗi có thể phục hồi. Dừng khi hết lượt phục hồi và không bao giờ lặp lại một mutation có kết quả không chắc chắn.',
  'When a read result says recovery is required, make another corrected tool call before answering. Do not convert an empty constrained result into a customer-facing absence claim while recovery remains required.',
  'Trả lời từng phần quan trọng trong yêu cầu mới nhất. Nếu một phần chưa thể xác minh, nói rõ phần đó chưa được xác minh thay vì bỏ qua.',
  'Khi một lần đọc thất bại ảnh hưởng đến câu trả lời, nói rõ giới hạn có ý nghĩa với khách và yêu cầu đúng thông tin hoặc hành động tiếp theo để có thể xác minh.',
  'Trả lời ngắn gọn, trực tiếp và hướng tới khách hàng. Không để lộ tên công cụ, đối số, schema, dữ liệu nhà cung cấp, chỉ dẫn nội bộ, trạng thái phục hồi, mã nội bộ hoặc nhãn cấu trúc.',
  'Nếu thông tin chưa được xác minh, nói rõ điều đó và đề xuất bước tiếp theo hữu ích nhất.',
  'Trả lời bằng ngôn ngữ của khách.',
].join('\n');

function verifiedContext(state: AgentState): Record<string, unknown> {
  return {
    ...(state.cart
      ? {
          cart: state.cart,
          recommendationCartLines: state.cart.items.map((item, index) => ({
            parentCartLineId: recommendationCartLineId(item.itemCode, index),
            itemCode: item.itemCode,
            name: item.name,
            quantity: item.quantity,
          })),
        }
      : {}),
    ...(state.address ? { address: state.address } : {}),
    ...(state.fulfillment ? { fulfillment: state.fulfillment } : {}),
    ...(state.orderPreview ? { orderPreview: state.orderPreview } : {}),
    ...(state.order ? { order: state.order } : {}),
    ...(state.paymentAttempt ? { paymentAttempt: state.paymentAttempt } : {}),
    ...(state.handoff
      ? {
          humanSupport: {
            status: 'queued',
            description: 'awaiting a human operator',
            responseTimeVerified: false,
          },
        }
      : {}),
  };
}

async function bindCurrentProductOrderFlow(state: AgentState): Promise<void> {
  if (!state.cart) throw new Error('kfc_cart_unavailable');
  const binding = await bindProductOrderFlow({
    sessionId: state.sessionId,
    cart: state.cart,
    order: state.order,
    prior: state.productOrderFlow,
  });
  if (state.recommendationState?.orderFlowId !== binding.orderFlowId) {
    state.recommendationState = initialRecommendationState(binding.orderFlowId);
  }
  state.productOrderFlow = binding;
}

async function refreshRecommendationState(
  input: AgentTurnInput,
  state: AgentState,
): Promise<void> {
  const latest = await loadPriorVerifiedState(input.store, input.sessionId, {
    packRef: KFC_VIETNAM_PACK_REF,
    schemaVersion: '1',
    parseState: parseKfcVerifiedState,
  });
  if (latest.recommendationState) {
    state.recommendationState = latest.recommendationState;
  }
}

function laterInstant(instant: string, milliseconds: number): string {
  const parsed = Date.parse(instant);
  if (!Number.isFinite(parsed)) {
    throw new Error('trusted_recommendation_action_time_invalid');
  }
  return new Date(parsed + milliseconds).toISOString();
}

async function recordTrustedRecommendationOutcome(input: {
  turnInput: AgentTurnInput;
  state: AgentState;
  eventType:
    | 'selected'
    | 'explicitly_dismissed'
    | 'cart_mutation_succeeded'
    | 'cart_mutation_failed';
  recommendationId: string;
  actionId: string | null;
  cartRevision: string;
  occurredAt: string;
}): Promise<void> {
  const recommendations = input.turnInput.recommendations;
  const actionDigest = input.turnInput.trustedCustomerAction?.actionDigest;
  if (!recommendations || !actionDigest) {
    throw new Error('trusted_recommendation_action_authority_unavailable');
  }
  const eventDigest = await stateRevision({
    actionDigest,
    eventType: input.eventType,
  });
  const result = await recommendations.recordOutcome(
    input.recommendationId,
    parseRecommendationOutcomeRequest({
      schemaVersion: 'kfc-recommendation-event-v1',
      eventId: `recommendation-event:${eventDigest.slice(0, 24)}`,
      eventType: input.eventType,
      occurredAt: input.occurredAt,
      actor: 'customer',
      actionId: input.actionId,
      cartRevision: input.cartRevision,
      payload: {},
    }),
  );
  if (result.status !== 'recorded' && result.status !== 'replay') {
    throw new Error(`trusted_recommendation_outcome_${result.status}`);
  }
  await refreshRecommendationState(input.turnInput, input.state);
}

async function prepareTrustedRecommendationAction(input: {
  turnInput: AgentTurnInput;
  state: AgentState;
  occurredAt: string;
}): Promise<void> {
  const command = input.turnInput.trustedCustomerAction?.command;
  if (
    command?.kind !== 'recommendation_select' &&
    command?.kind !== 'recommendation_dismiss'
  ) {
    return;
  }
  const recommendations = input.turnInput.recommendations;
  const cart = input.state.cart;
  if (!recommendations || !cart) {
    throw new Error('trusted_recommendation_action_authority_unavailable');
  }
  const recommendationActionId =
    command.kind === 'recommendation_select'
      ? command.recommendationActionId
      : input.state.recommendationState?.pendingRecommendation?.actionIds[0];
  if (!recommendationActionId) {
    throw new Error('trusted_recommendation_action_not_pending');
  }
  const cartRevision = await recommendationCartRevision(cart);
  const resolution = await recommendations.resolveTrustedAction({
    recommendationId: command.recommendationId,
    recommendationActionId,
    sessionId: input.turnInput.sessionId,
    customerId: input.turnInput.customerId,
    cartRevision,
  });
  if (resolution.status !== 'resolved') {
    throw new Error(`trusted_recommendation_action_${resolution.status}`);
  }
  if (command.kind === 'recommendation_dismiss') {
    await recordTrustedRecommendationOutcome({
      ...input,
      eventType: 'explicitly_dismissed',
      recommendationId: command.recommendationId,
      actionId: null,
      cartRevision,
    });
    return;
  }
  input.state.trustedRecommendationAction = resolution.action;
  await recordTrustedRecommendationOutcome({
    ...input,
    eventType: 'selected',
    recommendationId: command.recommendationId,
    actionId: resolution.action.actionId,
    cartRevision,
  });
}

async function commitTrustedRecommendationAction(input: {
  turnInput: AgentTurnInput;
  state: AgentState;
  status: 'succeeded' | 'failed' | 'dismissed';
  recommendationId: string;
  recommendationActionId: string | null;
}): Promise<void> {
  await persistVerifiedStateProjection({
    store: input.turnInput.store,
    sessionId: input.turnInput.sessionId,
    packRef: KFC_VIETNAM_PACK_REF,
    schemaVersion: '1',
    state: buildVerifiedStateSnapshot(input.state),
  });
  await input.turnInput.completeTrustedCustomerAction?.({
    status: input.status,
    recommendationId: input.recommendationId,
    recommendationActionId: input.recommendationActionId,
  });
}

const VERIFIED_QUEUED_HANDOFF_RESPONSE =
  'Yêu cầu gặp nhân viên của bạn đã được ghi nhận và đang chờ nhân viên tiếp nhận. Hiện chưa có thời gian phản hồi được xác minh.';

const retryableEmptyReadTools = new Set<ToolName>([
  'searchMenu',
  'findStores',
  'searchPromotions',
  'listMembershipRewards',
  'listMembershipTools',
  'listPaymentMethods',
  'searchContentPolicy',
  'answerAllergenQuestion',
]);

function isEmptyReadResult(
  toolName: ToolName,
  result: ToolCallResult | AgentToolCallResult,
): boolean {
  if (!retryableEmptyReadTools.has(toolName) || !result.ok) return false;
  const value: unknown = result.value;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value !== 'object' || value === null) return false;
  if ('items' in value && Array.isArray(value.items)) {
    return value.items.length === 0;
  }
  return 'total' in value && value.total === 0;
}

function withEmptyReadRecovery(
  toolName: ToolName,
  result: ToolCallResult | AgentToolCallResult,
  attempts: Map<ToolName, number>,
): ToolCallResult | AgentToolCallResult | Record<string, unknown> {
  if (!isEmptyReadResult(toolName, result)) return result;
  const attempt = (attempts.get(toolName) ?? 0) + 1;
  attempts.set(toolName, attempt);
  const exhausted = attempt >= 3;
  return {
    ...result,
    recovery: {
      required: !exhausted,
      ...(exhausted ? { exhausted: true } : {}),
      reason: 'empty_result',
      attempt,
      maxAttempts: 3,
      instruction: exhausted
        ? 'Stop retrying and answer honestly from verified evidence.'
        : toolName === 'searchMenu'
          ? 'You must make another corrected read call before answering the customer. Retry searchMenu with materially corrected arguments. For a category-wide request, use category with an empty queries array and retain applicable inclusive or exclusive price constraints. For modifier requirements, broaden only the product terms while retaining modifierQueries. An unconstrained exact-product search may verify that the product exists, but do not answer from it as though the modifier requirement matched; inspect that exact product with getModifierOptions before making the modifier claim. Search requested standalone drinks, sides, or other add-ons independently. An empty constrained result does not prove that the product is absent. Do not repeat identical arguments or substitute another product before verifying the requested product independently.'
          : 'Retry with materially corrected or broader arguments. Do not repeat identical arguments. You may choose another suitable read tool.',
    },
  };
}

function toolMessageRequiresRecovery(
  message: BaseMessage | undefined,
): boolean {
  if (
    !message ||
    !isToolMessage(message) ||
    typeof message.content !== 'string'
  )
    return false;
  try {
    const value: unknown = JSON.parse(message.content);
    return (
      typeof value === 'object' &&
      value !== null &&
      'recovery' in value &&
      typeof value.recovery === 'object' &&
      value.recovery !== null &&
      'required' in value.recovery &&
      value.recovery.required === true
    );
  } catch {
    return false;
  }
}

const kfcTypedRecoveryMiddleware = createMiddleware({
  name: 'KfcTypedRecoveryMiddleware',
  wrapModelCall: (request, handler) =>
    handler(
      toolMessageRequiresRecovery(request.messages.at(-1))
        ? { ...request, toolChoice: 'required' }
        : request,
    ),
});

function verifiedCustomerResponse(
  responseText: string,
  currentTurnToolTrace: ToolTraceEntry[],
  state: AgentState,
): string {
  if (
    currentTurnToolTrace.some(
      (entry) => entry.ok && entry.toolName === 'handoff',
    )
  ) {
    return VERIFIED_QUEUED_HANDOFF_RESPONSE;
  }
  const labelsByBase = new Map<string, Set<string>>();
  for (const name of [
    ...(state.menuSearchResults ?? []).map((item) => item.name),
    ...(state.menuItemDetail ? [state.menuItemDetail.name] : []),
    ...(state.cart?.items ?? []).map((item) => item.name),
  ]) {
    const variant = /^(.*\S)\s+\([^()]+\)$/u.exec(name);
    if (!variant?.[1]) continue;
    const labels = labelsByBase.get(variant[1]) ?? new Set<string>();
    labels.add(name);
    labelsByBase.set(variant[1], labels);
  }
  let verified = responseText;
  for (const [base, labels] of labelsByBase) {
    if (labels.size !== 1) continue;
    const [label] = labels;
    verified = verified.replace(
      new RegExp(`${escapedRegExp(base)}\\s+\\([^()\\n]+\\)`, 'gu'),
      label!,
    );
  }
  return verified;
}

function escapedRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
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
  if (toolName === 'createPaymentLink') {
    return toolArgumentSchemas.placeOrder;
  }
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
      ...(parsed.minPriceVnd === null
        ? {}
        : { minPriceVnd: parsed.minPriceVnd }),
      ...(parsed.maxPriceVnd === null
        ? {}
        : { maxPriceVnd: parsed.maxPriceVnd }),
      ...(parsed.maxPriceExclusiveVnd === null
        ? {}
        : { maxPriceExclusiveVnd: parsed.maxPriceExclusiveVnd }),
      ...(parsed.partySize === null ? {} : { partySize: parsed.partySize }),
    };
  }
  if (toolName === 'updateCart') {
    agentToolArgumentSchemas.updateCart.parse(args);
    return {};
  }
  return args;
}

function existingCartModifiers(
  state: AgentState,
  itemCode: string,
  targetCartLineId?: string,
): CartChange['modifiers'] {
  return state.cart?.items
    .find(
      (item, index) =>
        item.itemCode === itemCode &&
        (!targetCartLineId ||
          recommendationCartLineId(item.itemCode, index) === targetCartLineId),
    )
    ?.modifiers?.map((modifier) => ({
      groupId: modifier.groupId,
      modifierId: modifier.modifierId,
      quantity: modifier.quantity,
    }));
}

function trustedModifierBatchChange(
  state: AgentState,
  command: {
    itemCode: string;
    selections: readonly { groupId: string; modifierId: string }[];
  },
): CartChange | undefined {
  const currentItem = state.cart?.items.find(
    (item) => item.itemCode === command.itemCode,
  );
  const tree = state.menuModifierOptions;
  if (!currentItem || !tree || tree.itemCode !== command.itemCode) {
    return undefined;
  }
  const groups = tree.modifierGroups.flatMap(
    function flatten(group): typeof tree.modifierGroups {
      return [
        group,
        ...group.options.flatMap((option) =>
          option.modifierGroups.flatMap(flatten),
        ),
      ];
    },
  );
  const replacementGroups = new Set<string>();
  const replacements: NonNullable<CartChange['modifiers']> = [];
  for (const selection of command.selections) {
    const matchingGroups = groups.filter(
      (group) => group.groupId === selection.groupId,
    );
    if (matchingGroups.length !== 1) return undefined;
    const matchingOptions = matchingGroups[0]!.options.filter(
      (option) => option.modifierId === selection.modifierId,
    );
    if (matchingOptions.length !== 1) return undefined;
    replacementGroups.add(selection.groupId);
    replacements.push({
      groupId: selection.groupId,
      modifierId: selection.modifierId,
    });
  }
  return {
    itemCode: command.itemCode,
    quantity: currentItem.quantity,
    modifiers: [
      ...(existingCartModifiers(state, command.itemCode) ?? []).filter(
        (modifier) => !replacementGroups.has(modifier.groupId),
      ),
      ...replacements,
    ],
  };
}

function trustedCartChanges(
  input: AgentTurnInput,
  state: AgentState,
): CartChange[] | undefined {
  const command = input.trustedCustomerAction?.command;
  if (!command) return undefined;
  switch (command.kind) {
    case 'cart_update': {
      const modifiers = existingCartModifiers(state, command.itemCode);
      return [
        {
          itemCode: command.itemCode,
          quantity: command.quantity,
          ...(modifiers ? { modifiers } : {}),
        },
      ];
    }
    case 'cart_batch_update':
      return command.items.map(({ itemCode, quantity }) => {
        const modifiers = existingCartModifiers(state, itemCode);
        return {
          itemCode,
          quantity,
          ...(modifiers ? { modifiers } : {}),
        };
      });
    case 'cart_draft_commit':
      return command.items.map(({ itemCode, quantity }) => {
        const modifiers = existingCartModifiers(state, itemCode);
        return {
          itemCode,
          quantity,
          ...(modifiers ? { modifiers } : {}),
        };
      });
    case 'modifier_selection': {
      const currentItem = state.cart?.items.find(
        (item) => item.itemCode === command.itemCode,
      );
      if (!currentItem) return undefined;
      const modifiers = (existingCartModifiers(state, command.itemCode) ?? [])
        .filter((modifier) => modifier.groupId !== command.groupId)
        .concat({
          groupId: command.groupId,
          modifierId: command.modifierId,
        });
      return [
        {
          itemCode: command.itemCode,
          quantity: currentItem.quantity,
          modifiers,
        },
      ];
    }
    case 'modifier_batch_selection': {
      const change = trustedModifierBatchChange(state, command);
      return change ? [change] : undefined;
    }
    case 'recommendation_select': {
      const action = state.trustedRecommendationAction;
      if (
        !action ||
        action.actionId !== command.recommendationActionId ||
        !state.cart
      ) {
        return undefined;
      }
      if (action.type === 'add_product') {
        return [
          {
            itemCode: action.sellableItemId,
            quantity: action.quantity,
          },
        ];
      }
      if (action.type === 'replace_cart_line') {
        const replaced = state.cart.items.find(
          (item, index) =>
            recommendationCartLineId(item.itemCode, index) ===
            action.replacedCartLineId,
        );
        if (
          !replaced ||
          action.replacement.cartRevision !== action.cartRevision
        ) {
          return undefined;
        }
        return [
          {
            itemCode: action.replacement.sellableItemId,
            quantity: action.replacement.quantity,
            targetCartLineId: action.replacedCartLineId,
          },
        ];
      }
      const parent = state.cart.items.find(
        (item, index) =>
          item.itemCode === action.parentSellableItemId &&
          recommendationCartLineId(item.itemCode, index) ===
            action.parentCartLineId,
      );
      const groupId = action.groupPath.at(-1);
      if (!parent || !groupId) return undefined;
      return [
        {
          itemCode: parent.itemCode,
          quantity: parent.quantity,
          targetCartLineId: action.parentCartLineId,
          modifiers: [
            ...(
              existingCartModifiers(
                state,
                parent.itemCode,
                action.parentCartLineId,
              ) ?? []
            ).filter((modifier) => modifier.groupId !== groupId),
            {
              groupId,
              modifierId: action.optionId,
              quantity: action.quantity,
            },
          ],
        },
      ];
    }
    default:
      return undefined;
  }
}

function hasTrustedCartMutationAction(
  input: AgentTurnInput,
  state: AgentState,
): boolean {
  const kind = input.trustedCustomerAction?.command.kind;
  return (
    kind === 'cart_update' ||
    kind === 'cart_batch_update' ||
    kind === 'cart_draft_commit' ||
    kind === 'modifier_selection' ||
    kind === 'modifier_batch_selection' ||
    (kind === 'recommendation_select' &&
      state.trustedRecommendationAction !== undefined)
  );
}

function modelMayUseTool(
  input: AgentTurnInput,
  state: AgentState,
  toolName: ToolName,
): boolean {
  const command = input.trustedCustomerAction?.command.kind;
  switch (toolName) {
    case 'recommendStarter':
    case 'recommendModifierUpsell':
    case 'recommendSmartCrossSell':
      return Boolean(input.recommendations);
    case 'updateCart':
      return hasTrustedCartMutationAction(input, state);
    case 'placeOrder':
      return command === 'confirm_order';
    case 'createPaymentLink':
      return (
        input.trustedCustomerAction?.command.kind === 'select_payment_method' &&
        selectedPaymentMethodAuthorityMatchesActiveCollection(
          state,
          input.trustedCustomerAction.command.selection,
        )
      );
    case 'acquireVoucher':
    case 'redeemReward':
    case 'resolveHandoff':
      return false;
    default:
      return true;
  }
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
  durableTurnId: string;
  durableTurnCreatedAt: string;
  operationOccurrence: number;
  externalCallContext: ExternalCallContext;
  currentTurnToolTrace: ToolTraceEntry[];
}): Promise<ToolCallResult | AgentToolCallResult> {
  const executionStartedAt = new Date();
  const executionStartedAtMs = executionStartedAt.getTime();
  let args = executionArguments(input.toolName, input.args);
  const authorizedCartChanges =
    input.toolName === 'updateCart'
      ? trustedCartChanges(input.turnInput, input.state)
      : undefined;
  if (input.toolName === 'updateCart' && authorizedCartChanges) {
    args = {
      changes: authorizedCartChanges.map(
        ({ targetCartLineId: _serverOnlyTarget, ...change }) => change,
      ),
    };
  }
  if (input.toolName === 'quoteFulfillment') {
    args = {
      ...args,
      itemCodes: input.state.cart?.items.map((item) => item.itemCode) ?? [],
    };
  }
  const trustedActionToolName =
    input.turnInput.trustedCustomerAction?.command.kind === 'confirm_order'
      ? 'placeOrder'
      : input.turnInput.trustedCustomerAction?.command.kind ===
          'select_payment_method'
        ? 'createPaymentLink'
        : undefined;
  if (input.toolName === 'createPaymentLink') {
    const command = input.turnInput.trustedCustomerAction?.command;
    if (
      command?.kind === 'select_payment_method' &&
      selectedPaymentMethodAuthorityMatchesActiveCollection(
        input.state,
        command.selection,
      )
    ) {
      args = { methodId: command.selection.methodId };
    } else {
      args = {};
    }
  }
  const durableRequestIdentity =
    input.turnInput.externalMessageId ??
    input.turnInput.trustedCustomerAction?.actionDigest ??
    traceRunId(input.turnInput) ??
    input.durableTurnId;
  const currentRunIdentity = traceRunId(input.turnInput) ?? input.durableTurnId;
  const operationFingerprint = await stateRevision({
    sessionId: input.turnInput.sessionId,
    durableRequestIdentity,
    trustedAction: input.turnInput.trustedCustomerAction
      ? {
          actionDigest: input.turnInput.trustedCustomerAction.actionDigest,
          verifiedRevision:
            input.turnInput.trustedCustomerAction.verifiedRevision,
        }
      : null,
    toolName: input.toolName,
    operationOccurrence: input.operationOccurrence,
  });
  const bindingFingerprint = await stateRevision({
    operationFingerprint,
    args,
  });
  const trustedActionAuthority =
    trustedActionToolName === input.toolName
      ? await createTrustedActionToolAuthority({
          action: input.turnInput.trustedCustomerAction,
          sessionId: input.turnInput.sessionId,
          currentRunIdentity,
          durableRequestIdentity,
          request: { toolName: input.toolName, arguments: args },
        })
      : undefined;
  const recommendationAuthority =
    isRecommendationToolName(input.toolName) && input.turnInput.recommendations
      ? await createBundledRecommendationToolAuthority({
          turnInput: input.turnInput,
          state: input.state,
          application: input.turnInput.recommendations,
          durableDecisionTime: input.durableTurnCreatedAt,
        })
      : undefined;
  let rawResult: ToolCallResult;
  let modelResult: ToolCallResult | AgentToolCallResult;
  if (input.toolName === 'handoff' && input.state.handoff) {
    rawResult = {
      toolName: 'handoff',
      ok: true,
      value: { escalationId: input.state.handoff.escalationId },
      message: 'Human-support request is already queued',
      provenance: [],
    };
  } else if (
    trustedActionToolName === input.toolName &&
    input.operationOccurrence > 0
  ) {
    rawResult = {
      toolName: input.toolName,
      ok: false,
      message: 'Verified current-turn action has already been consumed',
      errorCode: 'trusted_action_already_consumed',
      provenance: [],
    } as ToolCallResult;
  } else if (input.toolName === 'updateCart') {
    if (!authorizedCartChanges) {
      rawResult = {
        toolName: 'updateCart',
        ok: false,
        message:
          'A verified current-turn cart action is required before cart mutation',
        errorCode: 'explicit_cart_mutation_required',
        provenance: [],
      };
    } else {
      rawResult = await executeToolCall(
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
            idempotencyKey: `kfc-agent:${operationFingerprint}`,
            bindingFingerprint,
          },
          trustedCartChanges: authorizedCartChanges,
        },
      );
    }
  } else {
    rawResult = await executeToolCall(
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
          idempotencyKey: `kfc-agent:${operationFingerprint}`,
          bindingFingerprint,
        },
        currentRunIdentity,
        durableRequestIdentity,
        ...(recommendationAuthority
          ? { recommendation: recommendationAuthority }
          : {}),
        ...(trustedActionAuthority
          ? {
              trustedActionAuthority,
            }
          : {}),
      },
    );
  }
  applyToolResultToState(
    input.turnInput,
    input.state,
    rawResult,
    args,
    input.currentTurnToolTrace,
  );
  if (recommendationAuthority) {
    const latest = await loadPriorVerifiedState(
      input.turnInput.store,
      input.turnInput.sessionId,
      {
        packRef: KFC_VIETNAM_PACK_REF,
        schemaVersion: '1',
        parseState: parseKfcVerifiedState,
      },
    );
    input.state.recommendationState = latest.recommendationState;
  }
  modelResult = await modelFacingResult(input.state, rawResult);
  const completedAt = new Date();
  await input.turnInput.recordLocalToolEvidence?.({
    phase: 'completed',
    callId: input.callId,
    toolName: input.toolName,
    arguments: args,
    rawResult,
    modelFacingResult: modelResult,
    executionStartedAt: executionStartedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    executionDurationMs: Math.max(
      0,
      completedAt.getTime() - executionStartedAtMs,
    ),
  });
  return modelResult;
}

function localToolEvidenceCallbacks(
  input: AgentTurnInput,
  callbacks: Callbacks | undefined,
): Callbacks | undefined {
  const record = input.recordLocalToolEvidence;
  if (!record) return callbacks;
  const starts = new Map<
    string,
    {
      callId: string;
      toolName: string;
      arguments: unknown;
      requestedAt: string;
      requestedAtMs: number;
      executionStartedAt?: string;
      executionStartedAtMs?: number;
    }
  >();
  const modelStarts = new Map<
    string,
    {
      callId: string;
      toolName: string;
      arguments: unknown;
      requestedAt: string;
      requestedAtMs: number;
    }
  >();
  const handler = BaseCallbackHandler.fromMethods({
    async handleLLMEnd(output) {
      for (const call of toolCallsFromLlmOutput(output)) {
        const requestedAt = new Date();
        const start = {
          callId: call.callId,
          toolName: call.toolName,
          arguments: call.arguments,
          requestedAt: requestedAt.toISOString(),
          requestedAtMs: requestedAt.getTime(),
        };
        modelStarts.set(call.callId, start);
        await record({
          phase: 'started',
          callId: start.callId,
          toolName: start.toolName,
          arguments: start.arguments,
          requestedAt: start.requestedAt,
        });
        if (!validModelToolArguments(call.toolName, call.arguments)) {
          const completedAt = new Date();
          await record({
            phase: 'failed',
            callId: start.callId,
            toolName: start.toolName,
            arguments: start.arguments,
            error: new Error('local_evidence_tool_arguments_invalid'),
            requestedAt: start.requestedAt,
            completedAt: completedAt.toISOString(),
            totalDurationMs: Math.max(
              0,
              completedAt.getTime() - start.requestedAtMs,
            ),
          });
          modelStarts.delete(call.callId);
        }
      }
    },
    async handleToolStart(
      tool,
      serializedInput,
      runId,
      _parentRunId,
      _tags,
      _metadata,
      runName,
      toolCallId,
    ) {
      const callId = toolCallId ?? runId;
      const existing = modelStarts.get(callId);
      const executionStartedAt = new Date();
      const start = {
        ...(existing ?? {
          callId,
          toolName: callbackToolName(tool, runName),
          arguments: parseCallbackToolInput(serializedInput),
          requestedAt: executionStartedAt.toISOString(),
          requestedAtMs: executionStartedAt.getTime(),
        }),
        executionStartedAt: executionStartedAt.toISOString(),
        executionStartedAtMs: executionStartedAt.getTime(),
      };
      starts.set(runId, start);
      if (!existing) {
        await record({
          phase: 'started',
          callId: start.callId,
          toolName: start.toolName,
          arguments: start.arguments,
          requestedAt: start.requestedAt,
        });
      }
    },
    async handleToolError(error, runId) {
      const start = starts.get(runId);
      const completedAt = new Date();
      await record({
        phase: 'failed',
        callId: start?.callId ?? runId,
        toolName: start?.toolName ?? 'unknown_tool',
        arguments: start?.arguments,
        error,
        requestedAt: start?.requestedAt ?? completedAt.toISOString(),
        ...(start?.executionStartedAt
          ? { executionStartedAt: start.executionStartedAt }
          : {}),
        completedAt: completedAt.toISOString(),
        totalDurationMs: Math.max(
          0,
          completedAt.getTime() -
            (start?.requestedAtMs ?? completedAt.getTime()),
        ),
        ...(start?.executionStartedAtMs !== undefined
          ? {
              executionDurationMs: Math.max(
                0,
                completedAt.getTime() - start.executionStartedAtMs,
              ),
            }
          : {}),
      });
      if (start) modelStarts.delete(start.callId);
      starts.delete(runId);
    },
    handleToolEnd(_output, runId) {
      const start = starts.get(runId);
      if (start) modelStarts.delete(start.callId);
      starts.delete(runId);
    },
  });
  handler.awaitHandlers = true;
  handler.raiseError = true;
  const manager = CallbackManager.configure(callbacks);
  if (manager) {
    manager.addHandler(handler, true);
    return manager;
  }
  return CallbackManager.configure([handler]);
}

function toolCallsFromLlmOutput(output: unknown): Array<{
  callId: string;
  toolName: string;
  arguments: unknown;
}> {
  if (
    typeof output !== 'object' ||
    output === null ||
    !('generations' in output) ||
    !Array.isArray(output.generations)
  ) {
    return [];
  }
  const calls: Array<{
    callId: string;
    toolName: string;
    arguments: unknown;
  }> = [];
  for (const candidates of output.generations) {
    if (!Array.isArray(candidates)) continue;
    for (const generation of candidates) {
      if (
        typeof generation !== 'object' ||
        generation === null ||
        !('message' in generation) ||
        typeof generation.message !== 'object' ||
        generation.message === null
      ) {
        continue;
      }
      for (const key of ['tool_calls', 'invalid_tool_calls'] as const) {
        if (
          !(key in generation.message) ||
          !Array.isArray(generation.message[key])
        ) {
          continue;
        }
        for (const call of generation.message[key]) {
          if (
            typeof call !== 'object' ||
            call === null ||
            typeof call.id !== 'string' ||
            typeof call.name !== 'string'
          ) {
            continue;
          }
          calls.push({
            callId: call.id,
            toolName: call.name,
            arguments: 'args' in call ? call.args : undefined,
          });
        }
      }
    }
  }
  return calls;
}

function validModelToolArguments(toolName: string, value: unknown): boolean {
  if (!(toolNames as readonly string[]).includes(toolName)) return false;
  return modelToolSchema(toolName as ToolName).safeParse(value).success;
}

function callbackToolName(tool: unknown, runName: string | undefined): string {
  if (
    typeof tool === 'object' &&
    tool !== null &&
    'name' in tool &&
    typeof tool.name === 'string'
  ) {
    return tool.name;
  }
  return runName ?? 'unknown_tool';
}

function parseCallbackToolInput(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function createKfcTools(input: {
  turnInput: AgentTurnInput;
  state: AgentState;
  externalCallContext: ExternalCallContext;
  currentTurnToolTrace: ToolTraceEntry[];
  durableTurnId: string;
  durableTurnCreatedAt: string;
}) {
  let executionQueue: Promise<void> = Promise.resolve();
  const operationOccurrences = new Map<ToolName, number>();
  const emptyReadAttempts = new Map<ToolName, number>();
  return toolNames
    .filter(
      (toolName) =>
        modelMayUseTool(input.turnInput, input.state, toolName) &&
        !(
          toolName === 'updateCart' &&
          input.currentTurnToolTrace.some(
            (entry) => entry.toolName === 'updateCart',
          )
        ),
    )
    .map((toolName) =>
      tool(
        async (value: unknown, runtime: ToolRuntime) => {
          const args = toolArguments(toolName, value);
          const operationOccurrence = operationOccurrences.get(toolName) ?? 0;
          operationOccurrences.set(toolName, operationOccurrence + 1);
          const execution = executionQueue.then(() =>
            executeModelTool({
              ...input,
              toolName,
              args,
              callId: runtime.toolCallId,
              operationOccurrence,
            }),
          );
          executionQueue = execution.then(
            () => undefined,
            () => undefined,
          );
          return JSON.stringify(
            withEmptyReadRecovery(toolName, await execution, emptyReadAttempts),
          );
        },
        {
          name: toolName,
          description: agentToolDescriptions[toolName],
          schema: providerPortableToolSchema(modelToolSchema(toolName)),
        },
      ),
    );
}

function requestToolName(toolValue: unknown): ToolName | undefined {
  if (
    typeof toolValue !== 'object' ||
    toolValue === null ||
    !('name' in toolValue) ||
    typeof toolValue.name !== 'string'
  ) {
    return undefined;
  }
  return toolNames.includes(toolValue.name as ToolName)
    ? (toolValue.name as ToolName)
    : undefined;
}

function recommendationToolAvailabilityMiddleware(input: {
  turnInput: AgentTurnInput;
  state: AgentState;
}) {
  return createMiddleware({
    name: 'KfcRecommendationToolAvailabilityMiddleware',
    wrapModelCall: async (request, handler) => {
      const latest = await loadPriorVerifiedState(
        input.turnInput.store,
        input.turnInput.sessionId,
        {
          packRef: KFC_VIETNAM_PACK_REF,
          schemaVersion: '1',
          parseState: parseKfcVerifiedState,
        },
      );
      const available = new Set(
        availableRecommendationToolNames(
          latest.productOrderFlow?.orderFlowId ===
            input.state.productOrderFlow?.orderFlowId
            ? (latest.recommendationState ?? input.state.recommendationState)
            : input.state.recommendationState,
        ),
      );
      return handler({
        ...request,
        tools: request.tools.filter((candidate) => {
          const name = requestToolName(candidate);
          return (
            !name || !isRecommendationToolName(name) || available.has(name)
          );
        }),
      });
    },
  });
}

function modelToolPublicationEvidenceMiddleware(input: {
  record: (providerBoundToolNames: ToolName[]) => void;
}) {
  return createMiddleware({
    name: 'KfcModelToolPublicationEvidenceMiddleware',
    wrapModelCall: async (request, handler) => {
      input.record(
        request.tools.flatMap((candidate) => {
          const name = requestToolName(candidate);
          return name ? [name] : [];
        }),
      );
      return handler(request);
    },
  });
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
  const task = createAgentTraceFlushTask(tracer);
  try {
    if (input.deferTrace) input.deferTrace(task);
    else runDetachedWork(task);
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
  scopeInput: (input) => ({
    ...input,
    sessionId: legacySessionIdOutsidePackNamespace(input.sessionId),
  }),
  async run(input, invokeModel) {
    const agent = requireTrustedConfiguredAgentModelBinding(
      input.agentModelBinding,
      {
        model: input.agentModel,
        identity: input.agentModelIdentity,
      },
    );
    input = {
      ...input,
      agentModel: agent.model,
      agentModelIdentity: agent.identity,
    };
    if (input.channel !== 'kfc') {
      await bindConfiguredSessionAgentModel({
        store: input.store,
        sessionId: input.sessionId,
        identity: agent.identity,
      });
    }
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
      if (!currentUserTurn) {
        throw new Error('kfc_current_user_turn_required');
      }
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
        ((text: string) => agent.model.getNumTokens(text));
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
              langChainConversationSummarizer(agent.model),
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
      const trustedCommand = input.trustedCustomerAction?.command;
      if (trustedCommand?.kind === 'cart_draft_commit') {
        state.trustedPresentation = {
          preferredSurface: trustedCommand.continueToFulfillment
            ? 'fulfillment'
            : 'cart',
        };
      } else if (trustedCommand?.kind === 'start_fulfillment') {
        state.trustedPresentation = { preferredSurface: 'fulfillment' };
      } else if (trustedCommand?.kind === 'edit_cart') {
        state.trustedPresentation = { preferredSurface: 'cart' };
      } else if (trustedCommand?.kind === 'submit_address') {
        state.trustedPresentation = { preferredSurface: 'fulfillment' };
        if (trustedCommand.address) {
          state.deliveryAddressDraft = trustedCommand.address;
        }
      } else if (trustedCommand?.kind === 'accept_fulfillment') {
        state.trustedPresentation = { fulfillmentAccepted: true };
      }
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
      if (input.recommendations) {
        await bindCurrentProductOrderFlow(state);
        await prepareTrustedRecommendationAction({
          turnInput: input,
          state,
          occurredAt: currentUserTurn.createdAt,
        });
        if (trustedCommand?.kind === 'recommendation_dismiss') {
          await commitTrustedRecommendationAction({
            turnInput: input,
            state,
            status: 'dismissed',
            recommendationId: trustedCommand.recommendationId,
            recommendationActionId: null,
          });
        }
      }
      if (hasTrustedCartMutationAction(input, state)) {
        const trustedMutationResult = await executeModelTool({
          turnInput: input,
          state,
          toolName: 'updateCart',
          args: {},
          callId: `trusted-action:${input.trustedCustomerAction!.actionDigest}`,
          durableTurnId: currentUserTurn.id,
          durableTurnCreatedAt: currentUserTurn.createdAt,
          operationOccurrence: 0,
          externalCallContext,
          currentTurnToolTrace,
        });
        const recommendationCommand = input.trustedCustomerAction?.command;
        const recommendationAction = state.trustedRecommendationAction;
        if (
          recommendationCommand?.kind === 'recommendation_select' &&
          recommendationAction
        ) {
          await recordTrustedRecommendationOutcome({
            turnInput: input,
            state,
            eventType: trustedMutationResult.ok
              ? 'cart_mutation_succeeded'
              : 'cart_mutation_failed',
            recommendationId: recommendationCommand.recommendationId,
            actionId: recommendationAction.actionId,
            cartRevision: await recommendationCartRevision(state.cart!),
            occurredAt: laterInstant(currentUserTurn.createdAt, 1),
          });
          await commitTrustedRecommendationAction({
            turnInput: input,
            state,
            status: trustedMutationResult.ok ? 'succeeded' : 'failed',
            recommendationId: recommendationCommand.recommendationId,
            recommendationActionId: recommendationAction.actionId,
          });
        }
      }
      await input.observeRun?.({ kind: 'planning' });
      const callbacks = localToolEvidenceCallbacks(
        input,
        await turnTrace.langchainCallbacks?.(),
      );
      const runWithContext = turnTrace.withActiveTrace?.bind(turnTrace);
      const modelToolPublicationCalls: Array<{
        sequence: number;
        providerBoundToolNames: ToolName[];
      }> = [];
      const responseText = await invokeModel({
        model: agent.model,
        messages: conversationMessages(input, state, currentUserTurn, context),
        tools: createKfcTools({
          turnInput: input,
          state,
          externalCallContext,
          currentTurnToolTrace,
          durableTurnId: currentUserTurn.id,
          durableTurnCreatedAt: currentUserTurn.createdAt,
        }),
        middleware: [
          kfcTypedRecoveryMiddleware,
          ...(input.recommendations
            ? [
                recommendationToolAvailabilityMiddleware({
                  turnInput: input,
                  state,
                }),
              ]
            : []),
          modelToolPublicationEvidenceMiddleware({
            record: (providerBoundToolNames) => {
              modelToolPublicationCalls.push({
                sequence: modelToolPublicationCalls.length + 1,
                providerBoundToolNames,
              });
            },
          }),
        ],
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
        responseText: verifiedCustomerResponse(
          responseText,
          currentTurnToolTrace,
          state,
        ),
        modelToolPublicationCalls,
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
