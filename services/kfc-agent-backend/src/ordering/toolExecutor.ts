import type {
  ExternalCallContext,
  ExternalClients,
  ProviderMutationIdentity,
} from '../clients/interfaces.js';
import type {
  Address,
  Cart,
  CustomerAccessContext,
  CustomerAccessScope,
  Order,
  ToolSideEffectClass,
} from '../domain/types.js';
import type { AgentState } from '../agent/agentState.js';
import { authorizeCustomerAccess } from '../security/customerAccessContext.js';
import {
  parseToolArguments,
  resolvedFulfillmentAddressSchema,
  toolArgumentSchemas,
} from './toolCatalog.js';
import type {
  CartWithModifiers,
  ToolCallRequest,
  ToolCallResult,
} from './types.js';
import {
  readCustomerFavoriteItems,
  readCustomerRecentOrder,
  readCustomerSavedAddresses,
} from './customerContextReadTools.js';
import {
  cancelledResult,
  externalCallCancelledErrorCode,
  result,
  resultFromToolResult,
} from './toolExecutionResult.js';
import { paymentOrderIdentifierMatches } from './paymentOrderAuthority.js';
import { executePaymentToolCall } from './paymentToolExecution.js';
import { searchMenuCollection } from './orderingDataRetrieval.js';

export interface ExecutorContext {
  externalCallContext: ExternalCallContext;
  state?: AgentState;
  accessContext?: CustomerAccessContext;
  cart?: CartWithModifiers;
  address?: Address;
  order?: Order;
  orderPreview?: Order;
  sessionId?: string;
  clientMessageId?: string;
  commerceTraceId?: string;
  commerceScenarioId?: string;
  providerMutationIdentity?: ProviderMutationIdentity;
  runGuard?: {
    isCurrent(): Promise<boolean>;
    recordIrreversibleBoundary?(
      toolName: ToolCallRequest['toolName'],
    ): Promise<void>;
  };
}

export { externalCallCancelledErrorCode };

const privateToolScopes: Partial<
  Record<ToolCallRequest['toolName'], readonly CustomerAccessScope[]>
> = {
  getMembershipProfile: ['membership:read'],
  listMembershipRewards: ['membership:read'],
  listMembershipWallet: ['membership:read'],
  getMembershipPointHistory: ['membership:read'],
  listMembershipTools: ['membership:read'],
  getSavedAddresses: ['customer:read'],
  getRecentOrder: ['customer:read', 'order:read'],
  getFavoriteItems: ['customer:read'],
  acquireVoucher: ['membership:write'],
  redeemReward: ['membership:write'],
  resolveHandoff: ['handoff:write'],
  getOrderStatus: ['order:read'],
  checkPaymentStatus: ['payment:read'],
};

function isToolCallRequest(value: unknown): value is ToolCallRequest {
  return (
    typeof value === 'object' &&
    value !== null &&
    'toolName' in value &&
    'arguments' in value
  );
}

export function externalCallIsCancelled(context: ExternalCallContext): boolean {
  return context.signal.aborted || Date.now() >= context.deadlineAt;
}

function providerMutationIdentityIsValid(
  identity: ProviderMutationIdentity | undefined,
): identity is ProviderMutationIdentity {
  return Boolean(
    identity &&
    identity.idempotencyKey.length > 0 &&
    identity.idempotencyKey.length <= 512 &&
    identity.idempotencyKey.trim() === identity.idempotencyKey &&
    /^[a-f0-9]{64}$/u.test(identity.bindingFingerprint),
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
  requestOrState: ToolCallRequest | AgentState,
  maybeRequest?: ToolCallRequest,
  maybeContext?: ExecutorContext,
): { request: ToolCallRequest; context: ExecutorContext } {
  if (isToolCallRequest(requestOrState)) {
    const context =
      (maybeRequest as ExecutorContext | undefined) ?? maybeContext;
    if (!context) {
      throw new Error('ExecutorContext is required');
    }
    return { request: requestOrState, context };
  }

  if (!maybeRequest) {
    throw new Error(
      'ToolCallRequest is required when executeToolCall is called with graph state',
    );
  }
  if (!maybeContext) {
    throw new Error('ExecutorContext is required');
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

async function checkInventory(
  clients: ExternalClients,
  context: ExecutorContext,
  input: {
    storeId: string;
    itemCodes: string[];
    disposition?: 'pickup' | 'delivery';
  },
): Promise<ToolCallResult> {
  const atomicCheck = clients.inventory.checkInventoryWithAuthority;
  if (!atomicCheck || !input.disposition) {
    return resultFromToolResult(
      'checkStoreAvailability',
      await clients.inventory.checkInventory(
        input.storeId,
        input.itemCodes,
        input.disposition,
        context.externalCallContext,
      ),
    );
  }
  const response = await atomicCheck(
    input.storeId,
    input.itemCodes,
    input.disposition,
    context.externalCallContext,
  );
  if (!response.ok || response.value === undefined) {
    return {
      toolName: 'checkStoreAvailability',
      ok: false,
      errorCode: response.errorCode,
      message: response.message,
      provenance: response.provenance ?? [],
    };
  }
  const availabilitySource = response.provenance?.find(
    ({ sourceFile }) => sourceFile.trim().length > 0,
  );
  if (!availabilitySource) {
    return {
      toolName: 'checkStoreAvailability',
      ok: false,
      errorCode: 'inventory_availability_provenance_missing',
      message: 'Atomic inventory availability provenance is required',
      provenance: [],
    };
  }
  const legacy = resultFromToolResult('checkStoreAvailability', {
    ...response,
    provenance: [availabilitySource],
    value: response.value.availability,
  });
  return legacy.ok
    ? {
        ...legacy,
        inventoryAvailabilityAuthority: {
          providerRevision: response.value.providerRevision,
          observedAt: response.value.observedAt,
          expiresAt: response.value.expiresAt,
        },
      }
    : legacy;
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
    case 'resolveHandoff':
      return 'irreversible';
    case 'acquireVoucher':
    case 'redeemReward':
      return 'irreversible';
    default:
      return 'read';
  }
}

export async function executeToolCall(
  clients: ExternalClients,
  request: ToolCallRequest,
  context: ExecutorContext,
): Promise<ToolCallResult>;
export async function executeToolCall(
  clients: ExternalClients,
  state: AgentState,
  request: ToolCallRequest,
  context: ExecutorContext,
): Promise<ToolCallResult>;
export async function executeToolCall(
  clients: ExternalClients,
  requestOrState: ToolCallRequest | AgentState,
  maybeRequestOrContext?: ToolCallRequest | ExecutorContext,
  maybeContext?: ExecutorContext,
): Promise<ToolCallResult> {
  const normalized = isToolCallRequest(requestOrState)
    ? normalizeExecution(
        requestOrState,
        undefined,
        maybeRequestOrContext as ExecutorContext | undefined,
      )
    : normalizeExecution(
        requestOrState,
        maybeRequestOrContext as ToolCallRequest,
        maybeContext,
      );
  const { request, context } = normalized;

  if (externalCallIsCancelled(context.externalCallContext)) {
    return cancelledResult(request);
  }

  const parsed = parseToolArguments(request.toolName, request.arguments);
  if (!parsed.success) {
    return result(
      request,
      false,
      undefined,
      parsed.error.message,
      'invalid_tool_arguments',
    );
  }

  const cart = getCart(context);
  const address = getAddress(context);
  const order = getOrder(context);
  const orderPreview = getOrderPreview(context);
  const sessionId = getSessionId(context);
  const customerId = context.state?.customerId;
  const requiredScopes = privateToolScopes[request.toolName];
  if (requiredScopes) {
    if (!sessionId || !customerId || !context.state?.channel) {
      return result(
        request,
        false,
        undefined,
        'Trusted customer access context is required',
        'authentication_required',
      );
    }
    for (const requiredScope of requiredScopes) {
      const access = authorizeCustomerAccess(context.accessContext, {
        channel: context.state.channel,
        sessionId,
        customerId,
        scope: requiredScope,
      });
      if (!access.allowed) {
        return result(
          request,
          false,
          undefined,
          access.message,
          access.errorCode,
        );
      }
    }
  }

  const sideEffectClass = classifyToolSideEffect(
    request.toolName,
    request.arguments,
  );
  if (
    sideEffectClass === 'irreversible' &&
    !providerMutationIdentityIsValid(context.providerMutationIdentity)
  ) {
    return result(
      request,
      false,
      undefined,
      'Irreversible provider mutation identity is required',
      'provider_mutation_identity_required',
    );
  }
  if (context.runGuard && sideEffectClass === 'irreversible') {
    try {
      const isCurrent = await context.runGuard.isCurrent();
      if (externalCallIsCancelled(context.externalCallContext)) {
        return cancelledResult(request);
      }
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
    } catch (error) {
      if (externalCallIsCancelled(context.externalCallContext)) {
        return cancelledResult(request);
      }
      throw error;
    }
  }

  if (externalCallIsCancelled(context.externalCallContext)) {
    return cancelledResult(request);
  }

  switch (request.toolName) {
    case 'searchMenu': {
      const args = toolArgumentSchemas.searchMenu.parse(request.arguments);
      const response = await clients.menu.searchMenu(
        '',
        context.externalCallContext,
      );
      if (!response.ok || !response.value) {
        return {
          toolName: 'searchMenu',
          ok: false,
          errorCode: response.errorCode,
          message: response.message,
          provenance: response.provenance ?? [],
        };
      }
      return resultFromToolResult(request.toolName, {
        ok: true,
        value: searchMenuCollection(response.value, args),
        message: 'verified_menu_collection',
        provenance: response.provenance,
      });
    }
    case 'getItemDetails': {
      const args = toolArgumentSchemas.getItemDetails.parse(request.arguments);
      return resultFromToolResult(
        request.toolName,
        await clients.menu.getItemDetails(
          args.code,
          context.externalCallContext,
        ),
      );
    }
    case 'getModifierOptions': {
      const args = toolArgumentSchemas.getModifierOptions.parse(
        request.arguments,
      );
      return resultFromToolResult(
        request.toolName,
        await clients.menu.getModifierOptions(
          args.code,
          context.externalCallContext,
        ),
      );
    }
    case 'updateCart': {
      const args = toolArgumentSchemas.updateCart.parse(request.arguments);
      if (!cart)
        return result(
          request,
          false,
          undefined,
          'Cart is required before updateCart',
          'cart_required',
        );
      return resultFromToolResult(
        request.toolName,
        await clients.cart.applyChanges(
          cart,
          args.changes,
          context.externalCallContext,
        ),
      );
    }
    case 'previewCart':
      if (!cart)
        return result(
          request,
          false,
          undefined,
          'Cart is required before previewCart',
          'cart_required',
        );
      return resultFromToolResult(
        request.toolName,
        await clients.cart.previewCart(cart, context.externalCallContext),
      );
    case 'recommendAddOns':
      if (!cart)
        return result(
          request,
          false,
          undefined,
          'Cart is required before recommendAddOns',
          'cart_required',
        );
      return resultFromToolResult(
        request.toolName,
        await clients.recommendation.recommendAddOns(
          cart,
          context.externalCallContext,
        ),
      );
    case 'findStores': {
      const args = toolArgumentSchemas.findStores.parse(request.arguments);
      return resultFromToolResult(
        request.toolName,
        await clients.storeLocator.findStores(
          args,
          context.externalCallContext,
        ),
      );
    }
    case 'checkStoreAvailability': {
      const args = toolArgumentSchemas.checkStoreAvailability.parse(
        request.arguments,
      );
      return checkInventory(clients, context, args);
    }
    case 'quoteFulfillment': {
      const args = toolArgumentSchemas.quoteFulfillment.parse(
        request.arguments,
      );
      const providerResult = await clients.fulfillment.quoteFulfillment(
        args,
        context.externalCallContext,
      );
      if (
        providerResult.ok &&
        !resolvedFulfillmentAddressSchema.safeParse(
          providerResult.value?.resolvedAddress,
        ).success
      ) {
        return result(
          request,
          false,
          undefined,
          'Fulfillment provider did not return a normalized address',
          'invalid_fulfillment_address_resolution',
          providerResult.provenance ?? [],
        );
      }
      if (
        providerResult.ok &&
        (providerResult.value?.method !== args.method ||
          providerResult.value.disposition !== args.method)
      ) {
        return result(
          request,
          false,
          undefined,
          'Fulfillment provider returned a quote for a different method',
          'invalid_fulfillment_quote_binding',
          providerResult.provenance ?? [],
        );
      }
      return resultFromToolResult(request.toolName, providerResult);
    }
    case 'searchPromotions': {
      const args = toolArgumentSchemas.searchPromotions.parse(
        request.arguments,
      );
      return resultFromToolResult(
        request.toolName,
        await clients.promotion.searchPromotions(
          args.query,
          context.externalCallContext,
        ),
      );
    }
    case 'explainPromotion': {
      const args = toolArgumentSchemas.explainPromotion.parse(
        request.arguments,
      );
      return resultFromToolResult(
        request.toolName,
        await clients.promotion.explainPromotion(
          args.offerId,
          context.externalCallContext,
        ),
      );
    }
    case 'validateVoucher': {
      const args = toolArgumentSchemas.validateVoucher.parse(request.arguments);
      return resultFromToolResult(
        request.toolName,
        await clients.promotion.validateVoucherInput(
          cart ?? buildVoucherCart(args.subtotalVnd),
          args.voucherText,
          context.externalCallContext,
        ),
      );
    }
    case 'getMembershipProfile':
      return resultFromToolResult(
        request.toolName,
        await clients.membership.getProfile(context.externalCallContext),
      );
    case 'listMembershipRewards': {
      const args = toolArgumentSchemas.listMembershipRewards.parse(
        request.arguments,
      );
      return resultFromToolResult(
        request.toolName,
        await clients.membership.listRewards(
          { query: args.query },
          context.externalCallContext,
        ),
      );
    }
    case 'listMembershipWallet': {
      const args = toolArgumentSchemas.listMembershipWallet.parse(
        request.arguments,
      );
      return resultFromToolResult(
        request.toolName,
        await clients.membership.listWallet(
          { status: args.status },
          context.externalCallContext,
        ),
      );
    }
    case 'getMembershipPointHistory': {
      const args = toolArgumentSchemas.getMembershipPointHistory.parse(
        request.arguments,
      );
      return resultFromToolResult(
        request.toolName,
        await clients.membership.getPointHistory(
          { days: args.days },
          context.externalCallContext,
        ),
      );
    }
    case 'listMembershipTools': {
      const args = toolArgumentSchemas.listMembershipTools.parse(
        request.arguments,
      );
      return resultFromToolResult(
        request.toolName,
        await clients.membership.listTools(
          { sideEffect: args.sideEffect },
          context.externalCallContext,
        ),
      );
    }
    case 'listPaymentMethods': {
      const args = toolArgumentSchemas.listPaymentMethods.parse(
        request.arguments,
      );
      return resultFromToolResult(
        request.toolName,
        await clients.payment.listMethods(
          {
            query: args.query,
            paymentSurface: args.paymentSurface,
          },
          context.externalCallContext,
        ),
      );
    }
    case 'getSavedAddresses':
      return resultFromToolResult(
        request.toolName,
        await readCustomerSavedAddresses({
          customer: clients.customer,
          // The private-tool scope guard above requires this server-owned id.
          customerId: customerId!,
          externalCallContext: context.externalCallContext,
        }),
      );
    case 'getRecentOrder':
      return resultFromToolResult(
        request.toolName,
        await readCustomerRecentOrder({
          customer: clients.customer,
          customerId: customerId!,
          externalCallContext: context.externalCallContext,
        }),
      );
    case 'getFavoriteItems':
      return resultFromToolResult(
        request.toolName,
        await readCustomerFavoriteItems({
          customer: clients.customer,
          customerId: customerId!,
          externalCallContext: context.externalCallContext,
        }),
      );
    case 'acquireVoucher': {
      const args = toolArgumentSchemas.acquireVoucher.parse(request.arguments);
      return resultFromToolResult(
        request.toolName,
        await clients.membership.acquireVoucher(
          { rewardId: args.rewardId, confirmed: true },
          context.externalCallContext,
          context.providerMutationIdentity!,
        ),
      );
    }
    case 'redeemReward': {
      const args = toolArgumentSchemas.redeemReward.parse(request.arguments);
      return resultFromToolResult(
        request.toolName,
        await clients.membership.redeemReward(
          {
            voucherId: args.voucherId,
            channel: args.channel,
            confirmed: true,
          },
          context.externalCallContext,
          context.providerMutationIdentity!,
        ),
      );
    }
    case 'searchContentPolicy': {
      const args = toolArgumentSchemas.searchContentPolicy.parse(
        request.arguments,
      );
      return resultFromToolResult(
        request.toolName,
        await clients.content.searchContent(
          args.kind,
          args.query,
          context.externalCallContext,
        ),
      );
    }
    case 'answerAllergenQuestion': {
      const args = toolArgumentSchemas.answerAllergenQuestion.parse(
        request.arguments,
      );
      return resultFromToolResult(
        request.toolName,
        await clients.content.answerAllergenQuestion(
          args.query,
          context.externalCallContext,
        ),
      );
    }
    case 'previewOrder':
      if (!cart)
        return result(
          request,
          false,
          undefined,
          'Cart is required before previewOrder',
          'cart_required',
        );
      if (!address)
        return result(
          request,
          false,
          undefined,
          'Address is required before previewOrder',
          'address_required',
        );
      if (!context.state?.fulfillment?.storeId) {
        return result(
          request,
          false,
          undefined,
          'Fulfillment store is required before previewOrder',
          'fulfillment_required',
        );
      }
      return resultFromToolResult(
        request.toolName,
        await clients.oms.previewOrder(
          { cart, address, storeId: context.state.fulfillment.storeId },
          context.externalCallContext,
        ),
      );
    case 'placeOrder':
      if (!orderPreview) {
        return result(
          request,
          false,
          undefined,
          'Order preview is required before placeOrder',
          'order_preview_required',
        );
      }
      return resultFromToolResult(
        request.toolName,
        await clients.oms.placeOrder(
          {
            preview: orderPreview,
            userConfirmed: true,
            context:
              context.sessionId && context.clientMessageId
                ? {
                    sessionId: context.sessionId,
                    clientMessageId: context.clientMessageId,
                    traceId: context.commerceTraceId ?? crypto.randomUUID(),
                    scenarioId: context.commerceScenarioId ?? 'live-agent',
                  }
                : undefined,
          },
          context.externalCallContext,
          context.providerMutationIdentity!,
        ),
      );
    case 'getOrderStatus': {
      const args = toolArgumentSchemas.getOrderStatus.parse(request.arguments);
      if (!paymentOrderIdentifierMatches(order, args.orderId)) {
        return result(
          request,
          false,
          undefined,
          'Order ownership could not be verified',
          'order_access_unverified',
        );
      }
      return resultFromToolResult(
        request.toolName,
        await clients.oms.getOrderStatus(
          args.orderId,
          context.externalCallContext,
        ),
      );
    }
    case 'createPaymentLink':
    case 'checkPaymentStatus':
      return executePaymentToolCall(clients, request, context, order);
    case 'collectInvoice': {
      const args = toolArgumentSchemas.collectInvoice.parse(request.arguments);
      return resultFromToolResult(
        request.toolName,
        await clients.invoice.collectInvoice(args, context.externalCallContext),
      );
    }
    case 'handoff': {
      const args = toolArgumentSchemas.handoff.parse(request.arguments);
      if (!sessionId)
        return result(
          request,
          false,
          undefined,
          'Session id is required before handoff',
          'session_required',
        );
      return resultFromToolResult(
        request.toolName,
        await clients.handoff.escalateToHuman(
          sessionId,
          args.reasons,
          context.externalCallContext,
          context.providerMutationIdentity!,
        ),
      );
    }
    case 'resolveHandoff': {
      const args = toolArgumentSchemas.resolveHandoff.parse(request.arguments);
      if (!sessionId) {
        return result(
          request,
          false,
          undefined,
          'Session id is required before handoff resolution',
          'session_required',
        );
      }
      return resultFromToolResult(
        request.toolName,
        await clients.handoff.resolveEscalation(
          sessionId,
          args.escalationId,
          context.externalCallContext,
          context.providerMutationIdentity!,
        ),
      );
    }
  }
}
