import type { ExternalClients } from '../clients/interfaces.js';
import type {
  Address,
  Cart,
  CustomerAccessContext,
  CustomerAccessScope,
  Order,
  ToolResult,
  ToolSideEffectClass,
} from '../domain/types.js';
import type { AgentGraphState } from '../graph/state.js';
import { authorizeCustomerAccess } from '../security/customerAccessContext.js';
import { parseToolArguments, toolArgumentSchemas } from './toolCatalog.js';
import type {
  CartWithModifiers,
  SourceProvenance,
  ToolCallFailure,
  ToolCallRequest,
  ToolCallResult,
  ToolCallSuccessFor,
  ToolName,
  ToolResultByName,
} from './types.js';

interface ExecutorContext {
  state?: AgentGraphState;
  accessContext?: CustomerAccessContext;
  cart?: CartWithModifiers;
  address?: Address;
  order?: Order;
  orderPreview?: Order;
  sessionId?: string;
  clientMessageId?: string;
  commerceTraceId?: string;
  commerceScenarioId?: string;
  runGuard?: {
    isCurrent(): Promise<boolean>;
    recordIrreversibleBoundary?(toolName: ToolCallRequest['toolName']): Promise<void>;
  };
}

const emptyProvenance: SourceProvenance[] = [];

const privateToolScopes: Partial<Record<ToolCallRequest['toolName'], CustomerAccessScope>> = {
  getMembershipProfile: 'membership:read',
  listMembershipRewards: 'membership:read',
  listMembershipWallet: 'membership:read',
  getMembershipPointHistory: 'membership:read',
  listMembershipTools: 'membership:read',
  acquireVoucher: 'membership:write',
  redeemReward: 'membership:write',
  getOrderStatus: 'order:read',
  checkPaymentStatus: 'payment:read',
};

function isToolCallRequest(value: ToolCallRequest | ExecutorContext): value is ToolCallRequest {
  return typeof value === 'object' && value !== null && 'toolName' in value && 'arguments' in value;
}

function resultFromToolResult<Name extends ToolName>(
  toolName: Name,
  response: ToolResult<ToolResultByName[Name]>,
): ToolCallFailure | ToolCallSuccessFor<Name> {
  const provenance = dedupeProvenance([
    ...(response.provenance ?? []),
    ...collectProvenance(response.value),
  ]);
  if (!response.ok || response.value === undefined) {
    return {
      toolName,
      ok: false,
      errorCode: response.errorCode,
      message: response.message,
      provenance,
    };
  }
  return {
    toolName,
    ok: true,
    value: response.value,
    message: response.message,
    provenance,
  };
}

function result(
  request: ToolCallRequest,
  _ok: false,
  _value: undefined,
  message: string,
  errorCode?: string,
  provenance: SourceProvenance[] = emptyProvenance,
): ToolCallFailure {
  return { toolName: request.toolName, ok: false, message, errorCode, provenance };
}

function collectProvenance(value: unknown, seen = new Set<unknown>()): SourceProvenance[] {
  if (!value || typeof value !== 'object' || seen.has(value)) return [];
  seen.add(value);

  const matches: SourceProvenance[] = [];
  const candidate = value as Record<string, unknown>;
  if (isSourceProvenance(candidate)) matches.push(candidate);
  if (isSourceProvenance(candidate.provenance)) matches.push(candidate.provenance);
  if (isSourceProvenance(candidate.source)) matches.push(candidate.source);

  if (Array.isArray(value)) {
    for (const entry of value) {
      matches.push(...collectProvenance(entry, seen));
    }
  } else {
    for (const nested of Object.values(candidate)) {
      matches.push(...collectProvenance(nested, seen));
    }
  }

  return dedupeProvenance(matches);
}

function dedupeProvenance(entries: SourceProvenance[]): SourceProvenance[] {
  return [...new Map(entries.map((entry) => [`${entry.fixtureMode}:${entry.sourceFile}:${entry.sourceUrl ?? ''}:${entry.sourceApi ?? ''}`, entry])).values()];
}

function isSourceProvenance(value: unknown): value is SourceProvenance {
  return (
    typeof value === 'object' &&
    value !== null &&
    'fixtureMode' in value &&
    'sourceFile' in value &&
    typeof (value as { fixtureMode?: unknown }).fixtureMode === 'string' &&
    typeof (value as { sourceFile?: unknown }).sourceFile === 'string'
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
  maybeRequest?: ToolCallRequest,
  maybeContext?: ExecutorContext,
): { request: ToolCallRequest; context: ExecutorContext } {
  if (isToolCallRequest(requestOrState)) {
    return { request: requestOrState, context: maybeRequest as ExecutorContext | undefined ?? maybeContext ?? {} };
  }

  if (!maybeRequest) {
    throw new Error('ToolCallRequest is required when executeToolCall is called with graph state');
  }

  return {
    request: maybeRequest,
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

function isCurrentOrder(order: Order | undefined, orderId: string): boolean {
  return Boolean(order && [order.id, order.commerceOrderId, order.omsOrderId].includes(orderId));
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
      return args.confirmed === true ? 'irreversible' : 'read';
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
  const normalized = isToolCallRequest(requestOrState)
    ? normalizeExecution(requestOrState, undefined, maybeRequestOrContext as ExecutorContext | undefined)
    : normalizeExecution(requestOrState, maybeRequestOrContext as ToolCallRequest, maybeContext);
  const { request, context } = normalized;

  const parsed = parseToolArguments(request.toolName, request.arguments);
  if (!parsed.success) {
    return result(request, false, undefined, parsed.error.message, 'invalid_tool_arguments');
  }

  const cart = getCart(context);
  const address = getAddress(context);
  const order = getOrder(context);
  const orderPreview = getOrderPreview(context);
  const sessionId = getSessionId(context);
  const customerId = context.state?.customerId;
  const requiredScope = privateToolScopes[request.toolName];
  if (requiredScope) {
    if (!sessionId || !customerId || !context.state?.channel) {
      return result(request, false, undefined, 'Trusted customer access context is required', 'authentication_required');
    }
    const access = authorizeCustomerAccess(context.accessContext, {
      channel: context.state.channel,
      sessionId,
      customerId,
      scope: requiredScope,
    });
    if (!access.allowed) {
      return result(request, false, undefined, access.message, access.errorCode);
    }
  }

  const sideEffectClass = classifyToolSideEffect(request.toolName, request.arguments);
  if (context.runGuard && sideEffectClass === 'irreversible') {
    const isCurrent = await context.runGuard.isCurrent();
    if (!isCurrent) {
      return result(
        request,
        false,
        undefined,
        'Agent run is no longer current; irreversible tool call suppressed',
        'stale_agent_run',
      );
    }
    await context.runGuard.recordIrreversibleBoundary?.(request.toolName);
  }

  switch (request.toolName) {
    case 'searchMenu': {
      const args = toolArgumentSchemas.searchMenu.parse(request.arguments);
      return resultFromToolResult(request.toolName, await clients.menu.searchMenu(args.query));
    }
    case 'getItemDetails': {
      const args = toolArgumentSchemas.getItemDetails.parse(request.arguments);
      return resultFromToolResult(request.toolName, await clients.menu.getItemDetails(args.code));
    }
    case 'getModifierOptions': {
      const args = toolArgumentSchemas.getModifierOptions.parse(request.arguments);
      return resultFromToolResult(request.toolName, await clients.menu.getModifierOptions(args.code));
    }
    case 'updateCart': {
      const args = toolArgumentSchemas.updateCart.parse(request.arguments);
      if (!cart) return result(request, false, undefined, 'Cart is required before updateCart', 'cart_required');
      return resultFromToolResult(
        request.toolName,
        'changes' in args
          ? await clients.cart.applyChanges(cart, args.changes)
          : await clients.cart.updateCart(cart, args.itemCode, args.quantity, args.modifiers),
      );
    }
    case 'previewCart':
      if (!cart) return result(request, false, undefined, 'Cart is required before previewCart', 'cart_required');
      return resultFromToolResult(request.toolName, await clients.cart.previewCart(cart));
    case 'recommendAddOns':
      if (!cart) return result(request, false, undefined, 'Cart is required before recommendAddOns', 'cart_required');
      return resultFromToolResult(request.toolName, await clients.recommendation.recommendAddOns(cart));
    case 'findStores': {
      const args = toolArgumentSchemas.findStores.parse(request.arguments);
      return resultFromToolResult(request.toolName, await clients.storeLocator.findStores(args));
    }
    case 'checkStoreAvailability': {
      const args = toolArgumentSchemas.checkStoreAvailability.parse(request.arguments);
      return resultFromToolResult(
        request.toolName,
        await clients.inventory.checkInventory(args.storeId, args.itemCodes, args.disposition),
      );
    }
    case 'quoteFulfillment': {
      const args = toolArgumentSchemas.quoteFulfillment.parse(request.arguments);
      return resultFromToolResult(request.toolName, await clients.fulfillment.quoteFulfillment(args));
    }
    case 'searchPromotions': {
      const args = toolArgumentSchemas.searchPromotions.parse(request.arguments);
      return resultFromToolResult(request.toolName, await clients.promotion.searchPromotions(args.query));
    }
    case 'explainPromotion': {
      const args = toolArgumentSchemas.explainPromotion.parse(request.arguments);
      return resultFromToolResult(request.toolName, await clients.promotion.explainPromotion(args.offerId));
    }
    case 'validateVoucher': {
      const args = toolArgumentSchemas.validateVoucher.parse(request.arguments);
      return resultFromToolResult(
        request.toolName,
        await clients.promotion.validateVoucherInput(cart ?? buildVoucherCart(args.subtotalVnd), args.voucherText),
      );
    }
    case 'getMembershipProfile':
      return resultFromToolResult(request.toolName, await clients.membership.getProfile());
    case 'listMembershipRewards': {
      const args = toolArgumentSchemas.listMembershipRewards.parse(request.arguments);
      return resultFromToolResult(request.toolName, await clients.membership.listRewards({ query: args.query }));
    }
    case 'listMembershipWallet': {
      const args = toolArgumentSchemas.listMembershipWallet.parse(request.arguments);
      return resultFromToolResult(request.toolName, await clients.membership.listWallet({ status: args.status }));
    }
    case 'getMembershipPointHistory': {
      const args = toolArgumentSchemas.getMembershipPointHistory.parse(request.arguments);
      return resultFromToolResult(request.toolName, await clients.membership.getPointHistory({ days: args.days }));
    }
    case 'listMembershipTools': {
      const args = toolArgumentSchemas.listMembershipTools.parse(request.arguments);
      return resultFromToolResult(request.toolName, await clients.membership.listTools({ sideEffect: args.sideEffect }));
    }
    case 'listPaymentMethods': {
      const args = toolArgumentSchemas.listPaymentMethods.parse(request.arguments);
      return resultFromToolResult(request.toolName, await clients.payment.listMethods({ query: args.query, paymentSurface: args.paymentSurface }));
    }
    case 'acquireVoucher': {
      const args = toolArgumentSchemas.acquireVoucher.parse(request.arguments);
      return resultFromToolResult(
        request.toolName,
        await clients.membership.acquireVoucher({ rewardId: args.rewardId, confirmed: args.confirmed }),
      );
    }
    case 'redeemReward': {
      const args = toolArgumentSchemas.redeemReward.parse(request.arguments);
      return resultFromToolResult(
        request.toolName,
        await clients.membership.redeemReward({ voucherId: args.voucherId, channel: args.channel, confirmed: args.confirmed }),
      );
    }
    case 'searchContentPolicy': {
      const args = toolArgumentSchemas.searchContentPolicy.parse(request.arguments);
      return resultFromToolResult(request.toolName, await clients.content.searchContent(args.kind, args.query));
    }
    case 'answerAllergenQuestion': {
      const args = toolArgumentSchemas.answerAllergenQuestion.parse(request.arguments);
      return resultFromToolResult(request.toolName, await clients.content.answerAllergenQuestion(args.query));
    }
    case 'previewOrder':
      if (!cart) return result(request, false, undefined, 'Cart is required before previewOrder', 'cart_required');
      if (!address) return result(request, false, undefined, 'Address is required before previewOrder', 'address_required');
      if (!context.state?.fulfillment?.storeId) {
        return result(request, false, undefined, 'Fulfillment store is required before previewOrder', 'fulfillment_required');
      }
      return resultFromToolResult(
        request.toolName,
        await clients.oms.previewOrder({ cart, address, storeId: context.state.fulfillment.storeId }),
      );
    case 'placeOrder':
      if (!orderPreview) {
        return result(request, false, undefined, 'Order preview is required before placeOrder', 'order_preview_required');
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
    case 'getOrderStatus': {
      const args = toolArgumentSchemas.getOrderStatus.parse(request.arguments);
      if (!isCurrentOrder(order, args.orderId)) {
        return result(request, false, undefined, 'Order ownership could not be verified', 'order_access_unverified');
      }
      return resultFromToolResult(request.toolName, await clients.oms.getOrderStatus(args.orderId));
    }
    case 'createPaymentLink': {
      const args = toolArgumentSchemas.createPaymentLink.parse(request.arguments);
      if (!order) {
        return result(request, false, undefined, 'Order is required before createPaymentLink', 'order_required');
      }
      if (!hasCreatedOrder(order)) {
        return result(
          request,
          false,
          undefined,
          'Created order is required before createPaymentLink',
          'created_order_required',
        );
      }
      return resultFromToolResult(request.toolName, await clients.payment.createPaymentLink(order, args.method));
    }
    case 'checkPaymentStatus': {
      const args = toolArgumentSchemas.checkPaymentStatus.parse(request.arguments);
      if (!isCurrentOrder(order, args.orderId)) {
        return result(request, false, undefined, 'Order ownership could not be verified', 'order_access_unverified');
      }
      return resultFromToolResult(request.toolName, await clients.payment.checkPaymentStatus(args.orderId));
    }
    case 'collectInvoice': {
      const args = toolArgumentSchemas.collectInvoice.parse(request.arguments);
      return resultFromToolResult(request.toolName, await clients.invoice.collectInvoice(args));
    }
    case 'handoff': {
      const args = toolArgumentSchemas.handoff.parse(request.arguments);
      if (!sessionId) return result(request, false, undefined, 'Session id is required before handoff', 'session_required');
      return resultFromToolResult(request.toolName, await clients.handoff.escalateToHuman(sessionId, args.reasons));
    }
  }
}
