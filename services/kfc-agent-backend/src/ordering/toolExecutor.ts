import type { ExternalClients } from '../clients/interfaces.js';
import type { Address, Cart, Order, ToolResult, ToolSideEffectClass } from '../domain/types.js';
import type { AgentGraphState } from '../graph/state.js';
import { parseToolArguments } from './toolCatalog.js';
import type { CartWithModifiers, SourceProvenance, ToolCallRequest, ToolCallResult } from './types.js';

interface ExecutorContext {
  state?: AgentGraphState;
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

function isToolCallRequest(value: ToolCallRequest | ExecutorContext): value is ToolCallRequest {
  return typeof value === 'object' && value !== null && 'toolName' in value && 'arguments' in value;
}

function resultFromToolResult(request: ToolCallRequest, response: ToolResult<unknown>): ToolCallResult {
  return {
    toolName: request.toolName,
    ok: response.ok,
    value: response.value,
    message: response.message,
    errorCode: response.errorCode,
    provenance: collectProvenance(response.value),
  };
}

function result(
  request: ToolCallRequest,
  ok: boolean,
  value: unknown,
  message: string,
  errorCode?: string,
  provenance: SourceProvenance[] = emptyProvenance,
): ToolCallResult {
  return { toolName: request.toolName, ok, value, message, errorCode, provenance };
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

  const deduped = new Map(matches.map((entry) => [`${entry.fixtureMode}:${entry.sourceFile}:${entry.sourceUrl ?? ''}:${entry.sourceApi ?? ''}`, entry]));
  return [...deduped.values()];
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

  const args = parsed.data as any;
  const sideEffectClass = classifyToolSideEffect(request.toolName, args as Record<string, unknown>);
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

  const cart = getCart(context);
  const address = getAddress(context);
  const order = getOrder(context);
  const orderPreview = getOrderPreview(context);
  const sessionId = getSessionId(context);

  switch (request.toolName) {
    case 'searchMenu':
      return resultFromToolResult(request, await clients.menu.searchMenu(args.query));
    case 'getItemDetails':
      return resultFromToolResult(request, await clients.menu.getItemDetails(args.code));
    case 'getModifierOptions':
      return resultFromToolResult(request, await clients.menu.getModifierOptions(args.code));
    case 'updateCart':
      if (!cart) return result(request, false, undefined, 'Cart is required before updateCart', 'cart_required');
      return resultFromToolResult(
        request,
        Array.isArray(args.changes)
          ? await clients.cart.applyChanges(cart, args.changes)
          : await clients.cart.updateCart(cart, args.itemCode, args.quantity, args.modifiers),
      );
    case 'previewCart':
      if (!cart) return result(request, false, undefined, 'Cart is required before previewCart', 'cart_required');
      return resultFromToolResult(request, await clients.cart.previewCart(cart));
    case 'recommendAddOns':
      if (!cart) return result(request, false, undefined, 'Cart is required before recommendAddOns', 'cart_required');
      return resultFromToolResult(request, await clients.recommendation.recommendAddOns(cart));
    case 'findStores':
      return resultFromToolResult(request, await clients.storeLocator.findStores(args));
    case 'checkStoreAvailability':
      return resultFromToolResult(
        request,
        await clients.inventory.checkInventory(args.storeId, args.itemCodes, args.disposition),
      );
    case 'quoteFulfillment':
      return resultFromToolResult(request, await clients.fulfillment.quoteFulfillment(args));
    case 'searchPromotions':
      return resultFromToolResult(request, await clients.promotion.searchPromotions(args.query));
    case 'explainPromotion':
      return resultFromToolResult(request, await clients.promotion.explainPromotion(args.offerId));
    case 'validateVoucher':
      return resultFromToolResult(
        request,
        await clients.promotion.validateVoucherInput(cart ?? buildVoucherCart(args.subtotalVnd), args.voucherText),
      );
    case 'getMembershipProfile':
      return resultFromToolResult(request, await clients.membership.getProfile());
    case 'listMembershipRewards':
      return resultFromToolResult(request, await clients.membership.listRewards({ query: args.query }));
    case 'listMembershipWallet':
      return resultFromToolResult(request, await clients.membership.listWallet({ status: args.status }));
    case 'getMembershipPointHistory':
      return resultFromToolResult(request, await clients.membership.getPointHistory({ days: args.days }));
    case 'listMembershipTools':
      return resultFromToolResult(request, await clients.membership.listTools({ sideEffect: args.sideEffect }));
    case 'listPaymentMethods':
      return resultFromToolResult(request, await clients.payment.listMethods({ query: args.query, paymentSurface: args.paymentSurface }));
    case 'acquireVoucher':
      return resultFromToolResult(
        request,
        await clients.membership.acquireVoucher({ rewardId: args.rewardId, confirmed: args.confirmed }),
      );
    case 'redeemReward':
      return resultFromToolResult(
        request,
        await clients.membership.redeemReward({ voucherId: args.voucherId, channel: args.channel, confirmed: args.confirmed }),
      );
    case 'searchContentPolicy':
      return resultFromToolResult(request, await clients.content.searchContent(args.kind, args.query));
    case 'answerAllergenQuestion':
      return resultFromToolResult(request, await clients.content.answerAllergenQuestion(args.query));
    case 'previewOrder':
      if (!cart) return result(request, false, undefined, 'Cart is required before previewOrder', 'cart_required');
      if (!address) return result(request, false, undefined, 'Address is required before previewOrder', 'address_required');
      if (!context.state?.fulfillment?.storeId) {
        return result(request, false, undefined, 'Fulfillment store is required before previewOrder', 'fulfillment_required');
      }
      return resultFromToolResult(
        request,
        await clients.oms.previewOrder({ cart, address, storeId: context.state.fulfillment.storeId }),
      );
    case 'placeOrder':
      if (!orderPreview) {
        return result(request, false, undefined, 'Order preview is required before placeOrder', 'order_preview_required');
      }
      return resultFromToolResult(
        request,
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
      return resultFromToolResult(request, await clients.oms.getOrderStatus(args.orderId));
    case 'createPaymentLink':
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
      return resultFromToolResult(request, await clients.payment.createPaymentLink(order, args.method));
    case 'checkPaymentStatus':
      return resultFromToolResult(request, await clients.payment.checkPaymentStatus(args.orderId));
    case 'collectInvoice':
      return resultFromToolResult(request, await clients.invoice.collectInvoice(args));
    case 'handoff':
      if (!sessionId) return result(request, false, undefined, 'Session id is required before handoff', 'session_required');
      return resultFromToolResult(request, await clients.handoff.escalateToHuman(sessionId, args.reasons));
  }
}
