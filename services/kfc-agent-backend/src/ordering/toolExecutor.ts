import type { ExternalClients } from '../clients/interfaces.js';
import type { Address, Cart, Order, ToolResult, ToolSideEffectClass } from '../domain/types.js';
import type { AgentGraphState } from '../graph/state.js';
import { parseToolArguments, toolArgumentSchemas } from './toolCatalog.js';
import type {
  CartWithModifiers,
  SourceProvenance,
  ToolCallRequest,
  ToolCallFailure,
  ToolCallResult,
  ToolCallSuccessFor,
  ToolName,
  ToolResultByName,
} from './types.js';

interface ExecutorContext {
  state?: AgentGraphState | undefined;
  cart?: CartWithModifiers | undefined;
  address?: Address | undefined;
  order?: Order | undefined;
  orderPreview?: Order | undefined;
  sessionId?: string | undefined;
  clientMessageId?: string | undefined;
  commerceTraceId?: string | undefined;
  commerceScenarioId?: string | undefined;
  runGuard?: {
    isCurrent(): Promise<boolean>;
    recordIrreversibleBoundary?(toolName: ToolCallRequest['toolName']): Promise<void>;
  } | undefined;
}

const emptyProvenance: SourceProvenance[] = [];

function isToolCallRequest(value: unknown): value is ToolCallRequest {
  return typeof value === 'object' && value !== null && 'toolName' in value && 'arguments' in value;
}

function resultFromToolResult<Name extends ToolName>(
  toolName: Name,
  response: ToolResult<ToolResultByName[Name]>,
): ToolCallFailure | ToolCallSuccessFor<Name> {
  return response.ok
    ? {
        toolName,
        ok: true,
        value: response.value,
        message: response.message,
        provenance: collectProvenance(response.value),
      }
    : {
        toolName,
        ok: false,
        errorCode: response.errorCode,
        message: response.message,
        provenance: [],
      };
}

function result(
  toolName: ToolName,
  _ok: false,
  _value: undefined,
  message: string,
  errorCode?: string,
  provenance: SourceProvenance[] = emptyProvenance,
): ToolCallFailure {
  return { toolName, ok: false, errorCode, message, provenance };
}

function collectProvenance(value: unknown, seen = new Set<unknown>()): SourceProvenance[] {
  if (!isRecord(value) && !Array.isArray(value)) return [];
  if (seen.has(value)) return [];
  seen.add(value);

  const matches: SourceProvenance[] = [];
  const candidate: Record<string, unknown> = Array.isArray(value) ? {} : value;
  if (isSourceProvenance(candidate)) matches.push(candidate);
  if (isSourceProvenance(candidate["provenance"])) matches.push(candidate["provenance"]);
  if (isSourceProvenance(candidate["source"])) matches.push(candidate["source"]);

  if (Array.isArray(value)) {
    for (const entry of value) {
      matches.push(...collectProvenance(entry, seen));
    }
  } else {
    for (const nested of Object.values(candidate)) {
      matches.push(...collectProvenance(nested, seen));
    }
  }

  const deduped = new Map(matches.map((entry) => [`${entry.fixtureMode}:${entry.sourceFile}:${entry.sourceUrl ?? ''}:${entry.sourceApi ?? ''}`, entry]));
  return [...deduped.values()];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSourceProvenance(value: unknown): value is SourceProvenance {
  return (
    typeof value === 'object' &&
    value !== null &&
    'fixtureMode' in value &&
    'sourceFile' in value &&
    typeof (value as { fixtureMode?: unknown | undefined }).fixtureMode === 'string' &&
    typeof (value as { sourceFile?: unknown | undefined }).sourceFile === 'string'
  );
}

function buildVoucherCart(subtotalVnd: number): Cart {
  return {
    id: 'cart_validation_only',
    items: [],
    subtotalVnd,
    discountVnd: 0,
    deliveryFeeVnd: 0,
    totalVnd: subtotalVnd,
    voucherCode: null,
  };
}

function normalizeExecution(
  requestOrState: ToolCallRequest | AgentGraphState,
  maybeRequestOrContext?: ToolCallRequest | ExecutorContext,
  maybeContext?: ExecutorContext,
): { request: ToolCallRequest; context: ExecutorContext } {
  if (isToolCallRequest(requestOrState)) {
    const context = maybeRequestOrContext && !isToolCallRequest(maybeRequestOrContext)
      ? maybeRequestOrContext
      : maybeContext ?? {};
    return { request: requestOrState, context };
  }

  if (!isToolCallRequest(maybeRequestOrContext)) {
    throw new Error('ToolCallRequest is required when executeToolCall is called with graph state');
  }

  return {
    request: maybeRequestOrContext,
    context: { state: requestOrState, ...maybeContext },
  };
}

function getCart(context: ExecutorContext): CartWithModifiers | undefined {
  return context.cart ?? context.state?.cart;
}

function getAddress(context: ExecutorContext): Address | undefined {
  return context.address ?? context.state?.address;
}

function getOrderPreview(context: ExecutorContext): Order | undefined {
  return context.orderPreview ?? context.state?.orderPreview;
}

function getOrder(context: ExecutorContext): Order | undefined {
  return context.order ?? context.state?.order;
}

function hasCreatedOrder(order: Order | undefined): order is Order {
  return order?.status === 'created';
}

function getSessionId(context: ExecutorContext): string | undefined {
  return context.sessionId ?? context.state?.sessionId;
}

export function classifyToolSideEffect(
  toolName: ToolCallRequest['toolName'],
  args: Record<string, unknown>,
): ToolSideEffectClass {
  switch (toolName) {
    case 'updateCart':
    case 'previewOrder':
    case 'collectInvoice':
      return 'reversible';
    case 'placeOrder':
    case 'createPaymentLink':
    case 'handoff':
      return 'irreversible';
    case 'acquireVoucher':
    case 'redeemReward':
      return args["confirmed"] === true ? 'irreversible' : 'read';
    default:
      return 'read';
  }
}

export async function executeToolCall(
  clients: ExternalClients,
  request: ToolCallRequest,
  context?: ExecutorContext,
): Promise<ToolCallResult>;
export async function executeToolCall(
  clients: ExternalClients,
  state: AgentGraphState,
  request: ToolCallRequest,
  context?: ExecutorContext,
): Promise<ToolCallResult>;
export async function executeToolCall(
  clients: ExternalClients,
  requestOrState: ToolCallRequest | AgentGraphState,
  maybeRequestOrContext?: ToolCallRequest | ExecutorContext,
  maybeContext?: ExecutorContext,
): Promise<ToolCallResult> {
  const normalized = normalizeExecution(requestOrState, maybeRequestOrContext, maybeContext);
  const { request, context } = normalized;

  const parsed = parseToolArguments(request.toolName, request.arguments);
  if (!parsed.success) {
    return result(request.toolName, false, undefined, parsed.error.message, 'invalid_tool_arguments');
  }

  const sideEffectClass = classifyToolSideEffect(request.toolName, request.arguments);
  if (context.runGuard && sideEffectClass === 'irreversible') {
    const isCurrent = await context.runGuard.isCurrent();
    if (!isCurrent) {
      return result(
        request.toolName,
        false,
        undefined,
        'Agent run is no longer current; irreversible tool call suppressed',
        'stale_agent_run',
      );
    }
    await context.runGuard.recordIrreversibleBoundary?.(request.toolName);
  }

  const cart = getCart(context);
  const address = getAddress(context);
  const order = getOrder(context);
  const orderPreview = getOrderPreview(context);
  const sessionId = getSessionId(context);

  switch (request.toolName) {
    case 'searchMenu':
      const searchMenuArgs = toolArgumentSchemas.searchMenu.parse(request.arguments);
      return resultFromToolResult(request.toolName, await clients.menu.searchMenu(searchMenuArgs.query));
    case 'getItemDetails':
      const getItemDetailsArgs = toolArgumentSchemas.getItemDetails.parse(request.arguments);
      return resultFromToolResult(request.toolName, await clients.menu.getItemDetails(getItemDetailsArgs.code));
    case 'getModifierOptions':
      const getModifierOptionsArgs = toolArgumentSchemas.getModifierOptions.parse(request.arguments);
      return resultFromToolResult(request.toolName, await clients.menu.getModifierOptions(getModifierOptionsArgs.code));
    case 'updateCart':
      const updateCartArgs = toolArgumentSchemas.updateCart.parse(request.arguments);
      if (!cart) return result(request.toolName, false, undefined, 'Cart is required before updateCart', 'cart_required');
      return resultFromToolResult(
        request.toolName,
        'changes' in updateCartArgs
          ? await clients.cart.applyChanges(cart, updateCartArgs.changes)
          : await clients.cart.updateCart(cart, updateCartArgs.itemCode, updateCartArgs.quantity, updateCartArgs.modifiers),
      );
    case 'previewCart':
      if (!cart) return result(request.toolName, false, undefined, 'Cart is required before previewCart', 'cart_required');
      return resultFromToolResult(request.toolName, await clients.cart.previewCart(cart));
    case 'recommendAddOns':
      if (!cart) return result(request.toolName, false, undefined, 'Cart is required before recommendAddOns', 'cart_required');
      return resultFromToolResult(request.toolName, await clients.recommendation.recommendAddOns(cart));
    case 'findStores':
      const findStoresArgs = toolArgumentSchemas.findStores.parse(request.arguments);
      return resultFromToolResult(request.toolName, await clients.storeLocator.findStores(findStoresArgs));
    case 'checkStoreAvailability':
      const checkStoreAvailabilityArgs = toolArgumentSchemas.checkStoreAvailability.parse(request.arguments);
      return resultFromToolResult(
        request.toolName,
        await clients.inventory.checkInventory(checkStoreAvailabilityArgs.storeId, checkStoreAvailabilityArgs.itemCodes, checkStoreAvailabilityArgs.disposition),
      );
    case 'quoteFulfillment':
      const quoteFulfillmentArgs = toolArgumentSchemas.quoteFulfillment.parse(request.arguments);
      return resultFromToolResult(request.toolName, await clients.fulfillment.quoteFulfillment(quoteFulfillmentArgs));
    case 'searchPromotions':
      const searchPromotionsArgs = toolArgumentSchemas.searchPromotions.parse(request.arguments);
      return resultFromToolResult(request.toolName, await clients.promotion.searchPromotions(searchPromotionsArgs.query));
    case 'explainPromotion':
      const explainPromotionArgs = toolArgumentSchemas.explainPromotion.parse(request.arguments);
      return resultFromToolResult(request.toolName, await clients.promotion.explainPromotion(explainPromotionArgs.offerId));
    case 'validateVoucher':
      const validateVoucherArgs = toolArgumentSchemas.validateVoucher.parse(request.arguments);
      return resultFromToolResult(
        request.toolName,
        await clients.promotion.validateVoucherInput(cart ?? buildVoucherCart(validateVoucherArgs.subtotalVnd), validateVoucherArgs.voucherText),
      );
    case 'getMembershipProfile':
      return resultFromToolResult(request.toolName, await clients.membership.getProfile());
    case 'listMembershipRewards':
      const listMembershipRewardsArgs = toolArgumentSchemas.listMembershipRewards.parse(request.arguments);
      return resultFromToolResult(request.toolName, await clients.membership.listRewards({ query: listMembershipRewardsArgs.query }));
    case 'listMembershipWallet':
      const listMembershipWalletArgs = toolArgumentSchemas.listMembershipWallet.parse(request.arguments);
      return resultFromToolResult(request.toolName, await clients.membership.listWallet({ status: listMembershipWalletArgs.status }));
    case 'getMembershipPointHistory':
      const getMembershipPointHistoryArgs = toolArgumentSchemas.getMembershipPointHistory.parse(request.arguments);
      return resultFromToolResult(request.toolName, await clients.membership.getPointHistory({ days: getMembershipPointHistoryArgs.days }));
    case 'listMembershipTools':
      const listMembershipToolsArgs = toolArgumentSchemas.listMembershipTools.parse(request.arguments);
      return resultFromToolResult(request.toolName, await clients.membership.listTools({ sideEffect: listMembershipToolsArgs.sideEffect }));
    case 'listPaymentMethods':
      const listPaymentMethodsArgs = toolArgumentSchemas.listPaymentMethods.parse(request.arguments);
      return resultFromToolResult(request.toolName, await clients.payment.listMethods({ query: listPaymentMethodsArgs.query, paymentSurface: listPaymentMethodsArgs.paymentSurface }));
    case 'acquireVoucher':
      const acquireVoucherArgs = toolArgumentSchemas.acquireVoucher.parse(request.arguments);
      return resultFromToolResult(
        request.toolName,
        await clients.membership.acquireVoucher({ rewardId: acquireVoucherArgs.rewardId, confirmed: acquireVoucherArgs.confirmed }),
      );
    case 'redeemReward':
      const redeemRewardArgs = toolArgumentSchemas.redeemReward.parse(request.arguments);
      return resultFromToolResult(
        request.toolName,
        await clients.membership.redeemReward({ voucherId: redeemRewardArgs.voucherId, channel: redeemRewardArgs.channel, confirmed: redeemRewardArgs.confirmed }),
      );
    case 'searchContentPolicy':
      const searchContentPolicyArgs = toolArgumentSchemas.searchContentPolicy.parse(request.arguments);
      return resultFromToolResult(request.toolName, await clients.content.searchContent(searchContentPolicyArgs.kind, searchContentPolicyArgs.query));
    case 'answerAllergenQuestion':
      const answerAllergenQuestionArgs = toolArgumentSchemas.answerAllergenQuestion.parse(request.arguments);
      return resultFromToolResult(request.toolName, await clients.content.answerAllergenQuestion(answerAllergenQuestionArgs.query));
    case 'previewOrder':
      if (!cart) return result(request.toolName, false, undefined, 'Cart is required before previewOrder', 'cart_required');
      if (!address) return result(request.toolName, false, undefined, 'Address is required before previewOrder', 'address_required');
      if (!context.state?.fulfillment?.storeId) {
        return result(request.toolName, false, undefined, 'Fulfillment store is required before previewOrder', 'fulfillment_required');
      }
      return resultFromToolResult(
        request.toolName,
        await clients.oms.previewOrder({ cart, address, storeId: context.state.fulfillment.storeId }),
      );
    case 'placeOrder':
      if (!orderPreview) {
        return result(request.toolName, false, undefined, 'Order preview is required before placeOrder', 'order_preview_required');
      }
      return resultFromToolResult(
        request.toolName,
        await clients.oms.placeOrder({
          preview: orderPreview,
          userConfirmed: context.state?.userConfirmedOrder ?? false,
          context:
            context.sessionId && context.clientMessageId
              ? {
                  sessionId: context.sessionId,
                  clientMessageId: context.clientMessageId,
                  traceId: context.commerceTraceId ?? crypto.randomUUID(),
                  scenarioId: context.commerceScenarioId ?? "live-agent",
                }
              : undefined,
        }),
      );
    case 'getOrderStatus':
      const getOrderStatusArgs = toolArgumentSchemas.getOrderStatus.parse(request.arguments);
      return resultFromToolResult(request.toolName, await clients.oms.getOrderStatus(getOrderStatusArgs.orderId));
    case 'createPaymentLink':
      const createPaymentLinkArgs = toolArgumentSchemas.createPaymentLink.parse(request.arguments);
      if (!order) {
        return result(request.toolName, false, undefined, 'Order is required before createPaymentLink', 'order_required');
      }
      if (!hasCreatedOrder(order)) {
        return result(
          request.toolName,
          false,
          undefined,
          'Created order is required before createPaymentLink',
          'created_order_required',
        );
      }
      return resultFromToolResult(request.toolName, await clients.payment.createPaymentLink(order, createPaymentLinkArgs.method));
    case 'checkPaymentStatus':
      const checkPaymentStatusArgs = toolArgumentSchemas.checkPaymentStatus.parse(request.arguments);
      return resultFromToolResult(request.toolName, await clients.payment.checkPaymentStatus(checkPaymentStatusArgs.orderId));
    case 'collectInvoice':
      const collectInvoiceArgs = toolArgumentSchemas.collectInvoice.parse(request.arguments);
      return resultFromToolResult(request.toolName, await clients.invoice.collectInvoice({
        ...(collectInvoiceArgs.companyName ? { companyName: collectInvoiceArgs.companyName } : {}),
        ...(collectInvoiceArgs.taxCode ? { taxCode: collectInvoiceArgs.taxCode } : {}),
        ...(collectInvoiceArgs.email ? { email: collectInvoiceArgs.email } : {}),
      }));
    case 'handoff':
      const handoffArgs = toolArgumentSchemas.handoff.parse(request.arguments);
      if (!sessionId) return result(request.toolName, false, undefined, 'Session id is required before handoff', 'session_required');
      return resultFromToolResult(request.toolName, await clients.handoff.escalateToHuman(sessionId, handoffArgs.reasons));
  }
}
