import type { ExternalClients } from '../clients/interfaces.js';
import {
  providerHandoffResolutionSchema,
} from '../commerce/providerResponseSchemas.js';
import type { Cart, CustomerAccessContext, Order } from '../domain/types.js';
import type { AgentGraphState } from '../graph/state.js';
import type { RunCommitFence } from '../persistence/contracts.js';
import type {
  GuestCheckoutAuthority,
} from '../security/guestCheckoutAuthority.js';
import {
  buildCommerceApprovalBinding,
  verifyCommerceApprovalReceipt,
} from './approvalReceipt.js';
import {
  verifyCommerceApprovalExecutionFence,
  type CommerceApprovalExecutionFence,
} from './approvalExecutionFence.js';
import {
  agentFailure,
  currentAuthorityRevisions,
  currentCollectionMatchesProvider,
  isAgentCallFailure,
} from './agentToolAuthority.js';
import {
  buildVerifiedApprovalAction,
} from './agentApprovalActionAuthority.js';
import {
  activeMenuSnapshotContaining,
  authoritativeModifiers,
  itemCodeIsVerified,
} from './agentMenuAuthority.js';
import { adaptAgentToolResult } from './agentToolResultAdapter.js';
import {
  authorizeProtectedCartAvailability,
  bindExactCartAvailabilityCheck,
  captureExactCartAvailabilityObservation,
} from './agentExactCartAvailability.js';
import {
  bindAgentFulfillmentQuote,
  validateAgentFulfillmentQuote,
} from './agentFulfillmentQuoteAuthority.js';
import {
  authorizeCommerceApprovalPrincipal,
  commerceApprovalPrincipalBindingExtension,
} from './commerceApprovalPrincipalAuthority.js';
import { agentToolCallDisposition } from './toolCallDisposition.js';
import {
  agentToolArgumentSchemas,
  toolArgumentSchemas,
} from './toolCatalog.js';
import {
  capturePaymentApprovalAuthority,
  type CapturedPaymentApprovalAuthority,
} from './paymentApprovalAuthority.js';
import {
  executeToolCall,
  externalCallCancelledErrorCode,
  externalCallIsCancelled,
  type ExecutorContext,
} from './toolExecutor.js';
import type {
  AgentToolCallFailure,
  AgentToolCallResult,
  CollectionScope,
  CollectionToolName,
  CommerceApprovalBinding,
  CommerceApprovalCapability,
  CommerceApprovalPrincipal,
  CommerceApprovalReceipt,
  ToolCallRequest,
  VerifiedCollectionSnapshot,
  VerifiedGuestApprovalResumeAuthority,
} from './types.js';

export interface AgentApprovalExecutionContext {
  principal: CommerceApprovalPrincipal;
  receipt?: CommerceApprovalReceipt;
  signingSecret?: string | Uint8Array;
  /**
   * Exact durable operation lease already claimed by the confirmation
   * coordinator. It is server-only and never accepted from request JSON.
   */
  preclaimedExecution?: CommerceApprovalExecutionFence;
  verifiedGuestAuthority?: VerifiedGuestApprovalResumeAuthority;
  confirmationRequestId?: string;
}

export interface AgentToolExecutorContext extends ExecutorContext {
  approval?: AgentApprovalExecutionContext;
  guestCheckoutAuthority?: GuestCheckoutAuthority;
  runFence?: RunCommitFence;
  externalMessageId?: string | null;
  confirmationResume?: boolean;
  /** Turn-local private order authority, valid only for status reads. */
  currentTurnStatusOrder?: Order;
}

function getCart(context: AgentToolExecutorContext): Cart | undefined {
  return context.cart ?? context.state?.cart;
}

function getOrderPreview(context: AgentToolExecutorContext): Order | undefined {
  return context.orderPreview ?? context.state?.orderPreview;
}

function getSessionId(context: AgentToolExecutorContext): string | undefined {
  return context.sessionId ?? context.state?.sessionId;
}

function isCommerceApprovalCapability(
  toolName: ToolCallRequest['toolName'],
): toolName is CommerceApprovalCapability {
  switch (toolName) {
    case 'placeOrder':
    case 'createPaymentLink':
    case 'acquireVoucher':
    case 'redeemReward':
    case 'handoff':
    case 'resolveHandoff':
      return true;
    default:
      return false;
  }
}

function scopeFromQuery(query: string | null): CollectionScope {
  return query === null ? { scope: 'all' } : { scope: 'filtered', query };
}

function exactStringSet(left: string[], right: string[]): boolean {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return leftSet.size === rightSet.size && [...leftSet].every((value) => rightSet.has(value));
}

function exactCartItemCodes(context: AgentToolExecutorContext): string[] | undefined {
  const cart = getCart(context);
  if (!cart || cart.items.length === 0) return undefined;
  return [...new Set(cart.items.map((item) => item.itemCode))];
}

function activeCollectionSnapshot<Item>(
  state: AgentGraphState | undefined,
  toolName: CollectionToolName,
): VerifiedCollectionSnapshot<Item> | undefined {
  const key = state?.activeCollectionKeys?.[toolName];
  if (!key) return undefined;
  const snapshots = state?.verifiedCollections?.[toolName] as
    Record<string, VerifiedCollectionSnapshot<Item>> | undefined;
  return snapshots?.[key];
}

/**
 * Build the exact server-owned approval binding without claiming a receipt or
 * dispatching the irreversible provider call. Public pause/resume paths use
 * this same boundary so a model-authored raw ToolCallRequest is never treated
 * as the signed commerce authority.
 */
export async function buildCurrentAgentApprovalBinding(
  clients: ExternalClients,
  request: ToolCallRequest,
  context: AgentToolExecutorContext,
): Promise<CommerceApprovalBinding | AgentToolCallFailure> {
  if (!isCommerceApprovalCapability(request.toolName)) {
    return agentFailure(
      request,
      'Tool does not support authenticated approval',
      'approval_capability_required',
    );
  }
  const disposition = agentToolCallDisposition(
    request.toolName,
    request.arguments,
  );
  if (!disposition.success) {
    return agentFailure(
      request,
      disposition.error.message,
      'invalid_tool_arguments',
    );
  }
  if (disposition.data.effect !== 'irreversible_mutation') {
    return agentFailure(
      request,
      'Tool call does not require authenticated approval',
      'approval_capability_required',
    );
  }
  const canonicalRequest: ToolCallRequest = {
    toolName: request.toolName,
    arguments: disposition.data.arguments,
  };
  const capability = request.toolName;
  const approval = context.approval;
  const state = context.state;
  const sessionId = getSessionId(context);
  const customerId = state?.customerId;
  const channel = state?.channel;
  if (!approval || !sessionId || !customerId || !channel) {
    return agentFailure(request, 'Trusted approval context is required', 'approval_context_required');
  }
  const principalFailure = await authorizeCommerceApprovalPrincipal({
    request,
    capability,
    principal: approval.principal,
    accessContext: context.accessContext,
    guestCheckoutAuthority: context.guestCheckoutAuthority,
    runFence: context.runFence,
    externalMessageId: context.externalMessageId,
    confirmationResume: context.confirmationResume,
    confirmationRequestId:
      approval.confirmationRequestId,
    verifiedGuestAuthority:
      approval.verifiedGuestAuthority,
    sessionId,
    customerId,
    channel,
  });
  if (principalFailure) return principalFailure;
  if (capability === 'placeOrder') {
    const availabilityFailure = await authorizeProtectedCartAvailability({
      clients,
      request: canonicalRequest,
      context,
      action: 'placeOrder',
    });
    if (availabilityFailure) return availabilityFailure;
  }

  let paymentAuthority: CapturedPaymentApprovalAuthority | undefined;
  if (capability === 'createPaymentLink') {
    const methodId =
      agentToolArgumentSchemas.createPaymentLink.parse(
        canonicalRequest.arguments,
      )
        .methodId;
    if (!state) {
      return agentFailure(
        request,
        'Payment method must match verified state',
        'unverified_payment_method',
      );
    }
    const captured = capturePaymentApprovalAuthority({
      state,
      contextOrder: context.order,
      methodId,
    });
    if (!captured.ok) {
      return agentFailure(
        request,
        captured.message,
        captured.errorCode,
      );
    }
    paymentAuthority = captured;
  }

  const revisions = await currentAuthorityRevisions(
    clients,
    canonicalRequest,
    context,
  );
  if (isAgentCallFailure(revisions)) return revisions;

  const approvalAction = buildVerifiedApprovalAction({
    request,
    canonicalRequest,
    capability,
    state,
    sessionId,
    orderPreview: getOrderPreview(context),
    contextOrder: context.order,
    paymentAuthority,
    revisions,
  });
  if (!approvalAction.success) return approvalAction.failure;
  return buildCommerceApprovalBinding({
    capability,
    principal: approval.principal,
    revisions,
    action: approvalAction.action,
    ...await commerceApprovalPrincipalBindingExtension({
      principal: approval.principal,
      state,
    }),
  });
}

async function requireApprovedCall(
  clients: ExternalClients,
  request: ToolCallRequest,
  context: AgentToolExecutorContext,
): Promise<
  | {
      receipt: CommerceApprovalReceipt;
      providerMutationIdentity: NonNullable<
        ExecutorContext['providerMutationIdentity']
      >;
    }
  | AgentToolCallFailure
> {
  const binding = await buildCurrentAgentApprovalBinding(
    clients,
    request,
    context,
  );
  if ('ok' in binding) {
    const approval = context.approval;
    if (
      context.confirmationResume &&
      approval?.receipt &&
      approval.signingSecret &&
      approval.preclaimedExecution &&
      binding.errorCode !== externalCallCancelledErrorCode
    ) {
      throw new Error('agent_approval_receipt_binding_mismatch');
    }
    return binding;
  }
  const approval = context.approval!;
  if (!approval.receipt) {
    return agentFailure(request, 'Authenticated customer approval is required', 'approval_required', binding);
  }
  if (!approval.signingSecret) {
    return agentFailure(request, 'Approval signature verification is unavailable', 'approval_authority_unavailable');
  }
  const verified = await verifyCommerceApprovalReceipt({
    receipt: approval.receipt,
    expectedBinding: binding,
    secret: approval.signingSecret,
  });
  if (!verified.ok) {
    return agentFailure(request, 'Approval receipt is not valid for the current action', verified.errorCode);
  }
  if (verified.receipt.decision === 'reject') {
    return agentFailure(request, 'The authenticated customer rejected this exact action', 'approval_rejected');
  }
  if (!approval.preclaimedExecution) {
    return agentFailure(
      request,
      'A coordinator-attested durable execution lease is required',
      'approval_claim_unavailable',
    );
  }
  const fence = await verifyCommerceApprovalExecutionFence({
    fence: approval.preclaimedExecution,
    receipt: verified.receipt,
    binding,
    secret: approval.signingSecret,
  });
  if (!fence) {
    return agentFailure(
      request,
      'Preclaimed approval execution does not match the current action',
      'approval_receipt_conflict',
    );
  }
  const providerMutationIdentity = {
    idempotencyKey: fence.providerIdempotencyKey,
    bindingFingerprint: fence.bindingFingerprint,
  };
  if (
    context.providerMutationIdentity &&
    (
      context.providerMutationIdentity.idempotencyKey !==
        providerMutationIdentity.idempotencyKey ||
      context.providerMutationIdentity.bindingFingerprint !==
        providerMutationIdentity.bindingFingerprint
    )
  ) {
    return agentFailure(
      request,
      'Provider mutation identity does not match the durable approval lease',
      'approval_receipt_conflict',
    );
  }
  if (request.toolName === 'placeOrder') {
    const availabilityFailure = await authorizeProtectedCartAvailability(
      { clients, request, context, action: 'placeOrder' },
    );
    if (availabilityFailure) return availabilityFailure;
  }
  return {
    receipt: verified.receipt,
    providerMutationIdentity,
  };
}

function isAgentFailure(
  value:
    | { receipt: CommerceApprovalReceipt }
    | AgentToolCallFailure,
): value is AgentToolCallFailure {
  return 'ok' in value && value.ok === false;
}

/**
 * The sole model-facing commerce execution seam for the maintained agent.
 * It reparses strict schemas, binds server-owned values, and delegates provider
 * calls to the existing executor.
 */
export async function executeAgentToolCall(
  clients: ExternalClients,
  request: ToolCallRequest,
  context: AgentToolExecutorContext,
): Promise<AgentToolCallResult> {
  if (externalCallIsCancelled(context.externalCallContext)) {
    return agentFailure(
      request,
      'External tool execution was cancelled before dispatch',
      externalCallCancelledErrorCode,
    );
  }
  const disposition = agentToolCallDisposition(
    request.toolName,
    request.arguments,
  );
  if (!disposition.success) {
    return agentFailure(
      request,
      disposition.error.message,
      'invalid_tool_arguments',
    );
  }
  const canonicalRequest: ToolCallRequest = {
    toolName: request.toolName,
    arguments: disposition.data.arguments,
  };
  const state = context.state;
  let trustedRequest: ToolCallRequest = canonicalRequest;
  let scope: CollectionScope | undefined;
  let approvedCall:
    | {
        receipt: CommerceApprovalReceipt;
        providerMutationIdentity: NonNullable<
          ExecutorContext['providerMutationIdentity']
        >;
      }
    | undefined;
  let statusReadOrder: Order | undefined;

  switch (canonicalRequest.toolName) {
    case 'searchMenu': {
      const args = agentToolArgumentSchemas.searchMenu.parse(
        canonicalRequest.arguments,
      );
      scope = args.scope === 'all' ? { scope: 'all' } : { scope: 'filtered', query: args.query! };
      trustedRequest = {
        toolName: canonicalRequest.toolName,
        arguments: { query: scope.scope === 'all' ? '' : scope.query },
      };
      break;
    }
    case 'getItemDetails':
    case 'getModifierOptions': {
      const args =
        canonicalRequest.toolName === 'getItemDetails'
          ? agentToolArgumentSchemas.getItemDetails.parse(
              canonicalRequest.arguments,
            )
          : agentToolArgumentSchemas.getModifierOptions.parse(
              canonicalRequest.arguments,
            );
      const revisions = await currentAuthorityRevisions(
        clients,
        canonicalRequest,
        context,
      );
      if (isAgentCallFailure(revisions)) return revisions;
      const menu = activeMenuSnapshotContaining(state, args.code);
      if (!currentCollectionMatchesProvider(menu, revisions)) {
        return agentFailure(
          request,
          'Menu item must be present in the current verified result',
          'unverified_item_code',
        );
      }
      break;
    }
    case 'updateCart': {
      const args = agentToolArgumentSchemas.updateCart.parse(
        canonicalRequest.arguments,
      );
      const revisions = await currentAuthorityRevisions(
        clients,
        canonicalRequest,
        context,
      );
      if (isAgentCallFailure(revisions)) return revisions;
      const changes = [];
      for (const change of args.changes) {
        if (!itemCodeIsVerified(state, change.itemCode)) {
          return agentFailure(request, 'Cart item code is not present in verified state', 'unverified_item_code');
        }
        const alreadyInCart = state?.cart?.items.some((item) => item.itemCode === change.itemCode) === true;
        const menu = activeMenuSnapshotContaining(state, change.itemCode);
        if (!alreadyInCart && !currentCollectionMatchesProvider(menu, revisions)) {
          return agentFailure(request, 'Menu collection provider authority changed', 'provider_authority_stale');
        }
        const modifiers = authoritativeModifiers(state, change.itemCode, change.modifiers);
        if (modifiers === undefined) {
          return agentFailure(request, 'Modifier identifiers are not present in verified state', 'unverified_modifier');
        }
        changes.push({
          itemCode: change.itemCode,
          quantity: change.quantity,
          modifiers,
        });
      }
      trustedRequest = {
        toolName: canonicalRequest.toolName,
        arguments: { changes },
      };
      break;
    }
    case 'explainPromotion': {
      const args = agentToolArgumentSchemas.explainPromotion.parse(
        canonicalRequest.arguments,
      );
      const revisions = await currentAuthorityRevisions(
        clients,
        canonicalRequest,
        context,
      );
      if (isAgentCallFailure(revisions)) return revisions;
      const promotions = activeCollectionSnapshot<{ offerId: string }>(state, 'searchPromotions');
      if (
        !currentCollectionMatchesProvider(promotions, revisions) ||
        !promotions?.result.items.some((offer) => offer.offerId === args.offerId)
      ) {
        return agentFailure(
          request,
          'Promotion must be present in the current verified result',
          'unverified_promotion',
        );
      }
      break;
    }
    case 'findStores': {
      const args = agentToolArgumentSchemas.findStores.parse(
        canonicalRequest.arguments,
      );
      const filters = {
        ...(args.query ? { query: args.query } : {}),
        ...(args.city ? { city: args.city } : {}),
        ...(args.district ? { district: args.district } : {}),
      };
      scope =
        Object.keys(filters).length === 0 ? { scope: 'all' } : { scope: 'filtered', query: JSON.stringify(filters) };
      trustedRequest = {
        toolName: canonicalRequest.toolName,
        arguments: filters,
      };
      break;
    }
    case 'checkStoreAvailability': {
      const bound = bindExactCartAvailabilityCheck({
        request: canonicalRequest,
        context,
      });
      if ('ok' in bound) return bound;
      trustedRequest = bound;
      break;
    }
    case 'previewOrder': {
      const availabilityFailure = await authorizeProtectedCartAvailability({
        clients,
        request: canonicalRequest,
        context,
        action: 'previewOrder',
      });
      if (availabilityFailure) return availabilityFailure;
      break;
    }
    case 'quoteFulfillment': {
      const bound = bindAgentFulfillmentQuote({
        request: canonicalRequest,
        itemCodes: exactCartItemCodes(context),
      });
      if ('ok' in bound) return bound;
      trustedRequest = bound;
      break;
    }
    case 'searchPromotions': {
      const args = agentToolArgumentSchemas.searchPromotions.parse(
        canonicalRequest.arguments,
      );
      scope = scopeFromQuery(args.query);
      trustedRequest = {
        toolName: canonicalRequest.toolName,
        arguments: { query: args.query ?? '' },
      };
      break;
    }
    case 'validateVoucher': {
      const args = agentToolArgumentSchemas.validateVoucher.parse(
        canonicalRequest.arguments,
      );
      const cart = getCart(context);
      if (!cart) return agentFailure(request, 'Cart is required before voucher validation', 'cart_required');
      trustedRequest = {
        toolName: canonicalRequest.toolName,
        arguments: {
          voucherText: args.voucherText,
          subtotalVnd: cart.subtotalVnd,
        },
      };
      break;
    }
    case 'listMembershipRewards': {
      const args = agentToolArgumentSchemas.listMembershipRewards.parse(
        canonicalRequest.arguments,
      );
      scope = scopeFromQuery(args.query);
      trustedRequest = {
        toolName: canonicalRequest.toolName,
        arguments: { ...(args.query ? { query: args.query } : {}) },
      };
      break;
    }
    case 'listMembershipWallet': {
      const args = agentToolArgumentSchemas.listMembershipWallet.parse(
        canonicalRequest.arguments,
      );
      scope = args.status ? { scope: 'filtered', query: args.status } : { scope: 'all' };
      trustedRequest = {
        toolName: canonicalRequest.toolName,
        arguments: { ...(args.status ? { status: args.status } : {}) },
      };
      break;
    }
    case 'getMembershipPointHistory': {
      const args = agentToolArgumentSchemas.getMembershipPointHistory.parse(
        canonicalRequest.arguments,
      );
      trustedRequest = {
        toolName: canonicalRequest.toolName,
        arguments: { ...(args.days ? { days: args.days } : {}) },
      };
      break;
    }
    case 'listMembershipTools': {
      const args = agentToolArgumentSchemas.listMembershipTools.parse(
        canonicalRequest.arguments,
      );
      scope = args.sideEffect ? { scope: 'filtered', query: args.sideEffect } : { scope: 'all' };
      trustedRequest = {
        toolName: canonicalRequest.toolName,
        arguments: {
          ...(args.sideEffect ? { sideEffect: args.sideEffect } : {}),
        },
      };
      break;
    }
    case 'listPaymentMethods': {
      const args = agentToolArgumentSchemas.listPaymentMethods.parse(
        canonicalRequest.arguments,
      );
      const filters = {
        ...(args.query ? { query: args.query } : {}),
        ...(args.paymentSurface ? { paymentSurface: args.paymentSurface } : {}),
      };
      scope =
        Object.keys(filters).length === 0 ? { scope: 'all' } : { scope: 'filtered', query: JSON.stringify(filters) };
      trustedRequest = {
        toolName: canonicalRequest.toolName,
        arguments: filters,
      };
      break;
    }
    case 'acquireVoucher':
    case 'redeemReward': {
      const approval = await requireApprovedCall(
        clients,
        canonicalRequest,
        context,
      );
      if (isAgentFailure(approval)) return approval;
      approvedCall = approval;
      trustedRequest = {
        toolName: canonicalRequest.toolName,
        arguments: {
          ...canonicalRequest.arguments,
          confirmed: true,
        },
      };
      break;
    }
    case 'placeOrder':
    case 'createPaymentLink':
    case 'handoff':
    case 'resolveHandoff': {
      const approval = await requireApprovedCall(
        clients,
        canonicalRequest,
        context,
      );
      if (isAgentFailure(approval)) return approval;
      approvedCall = approval;
      if (canonicalRequest.toolName === 'resolveHandoff') {
        const activeHandoff = state?.handoff;
        if (!activeHandoff) {
          return agentFailure(
            request,
            'An active verified handoff is required before resolution',
            'active_handoff_required',
          );
        }
        trustedRequest = {
          toolName: canonicalRequest.toolName,
          arguments: {
            escalationId: activeHandoff.escalationId,
          },
        };
      } else {
        trustedRequest = canonicalRequest;
      }
      break;
    }
    case 'getOrderStatus':
    case 'checkPaymentStatus': {
      const order =
        state?.order ??
        context.currentTurnStatusOrder ??
        context.order;
      if (!order) return agentFailure(request, 'Current verified order is required', 'order_required');
      statusReadOrder = order;
      trustedRequest = {
        toolName: canonicalRequest.toolName,
        arguments: { orderId: order.id },
      };
      break;
    }
    case 'searchContentPolicy': {
      const args = agentToolArgumentSchemas.searchContentPolicy.parse(
        canonicalRequest.arguments,
      );
      scope = args.scope === 'all' ? { scope: 'all' } : { scope: 'filtered', query: args.query! };
      trustedRequest = {
        toolName: canonicalRequest.toolName,
        arguments: { kind: args.kind, query: args.query ?? '' },
      };
      break;
    }
    case 'answerAllergenQuestion': {
      const args = agentToolArgumentSchemas.answerAllergenQuestion.parse(
        canonicalRequest.arguments,
      );
      scope = { scope: 'filtered', query: args.query };
      break;
    }
    case 'collectInvoice': {
      const args = agentToolArgumentSchemas.collectInvoice.parse(
        canonicalRequest.arguments,
      );
      trustedRequest = {
        toolName: canonicalRequest.toolName,
        arguments: {
          ...(args.companyName ? { companyName: args.companyName } : {}),
          ...(args.taxCode ? { taxCode: args.taxCode } : {}),
          ...(args.email ? { email: args.email } : {}),
        },
      };
      break;
    }
    case 'recommendAddOns':
      scope = { scope: 'all' };
      break;
    default:
      break;
  }

  const baseExecutionContext: ExecutorContext = approvedCall
    ? {
        ...context,
        providerMutationIdentity: approvedCall.providerMutationIdentity,
        ...(canonicalRequest.toolName === 'placeOrder'
          ? {
              state: context.state ? { ...context.state, userConfirmedOrder: true } : context.state,
            }
          : {}),
      }
    : context;
  const executionContext: ExecutorContext = statusReadOrder
    ? { ...baseExecutionContext, order: statusReadOrder }
    : baseExecutionContext;
  const legacy = await executeToolCall(clients, trustedRequest, executionContext);
  if (legacy.ok && legacy.toolName === 'resolveHandoff') {
    const expected =
      toolArgumentSchemas.resolveHandoff.parse(
        trustedRequest.arguments,
      ).escalationId;
    const resolved = providerHandoffResolutionSchema.safeParse(
      legacy.value,
    );
    if (
      !resolved.success ||
      resolved.data.escalationId !== expected ||
      legacy.provenance.length === 0
    ) {
      return agentFailure(
        request,
        'Handoff provider response does not match the active escalation',
        'handoff_resolution_provider_response_invalid',
      );
    }
  }
  if (legacy.ok && legacy.toolName === 'checkStoreAvailability') {
    const expected = exactCartItemCodes(context)!;
    if (!exactStringSet(expected, Object.keys(legacy.value))) {
      return agentFailure(
        request,
        'Availability result does not cover the exact current cart',
        'incomplete_cart_availability',
      );
    }
  }
  if (legacy.ok && legacy.toolName === 'quoteFulfillment') {
    const invalidQuote = validateAgentFulfillmentQuote({
      request: trustedRequest,
      result: legacy,
      expectedItemCodes: exactCartItemCodes(context)!,
    });
    if (invalidQuote) return invalidQuote;
  }
  if (legacy.ok && approvedCall && context.state) {
    context.state.commerceApprovalReceipts = [
      ...(context.state.commerceApprovalReceipts ?? []),
      approvedCall.receipt,
    ];
  }
  const adapted = await adaptAgentToolResult({
    clients,
    request: canonicalRequest,
    context,
    legacy,
    ...(scope ? { scope } : {}),
  });
  if (
    adapted.ok &&
    adapted.toolName === 'checkStoreAvailability'
  ) {
    const observation = await captureExactCartAvailabilityObservation({
      request: canonicalRequest,
      context,
      availability: adapted.value,
      authority: adapted.inventoryAvailabilityAuthority,
    });
    if ('ok' in observation) return observation;
    return {
      ...adapted,
      verifiedAvailabilityObservation: observation,
    };
  }
  return adapted;
}
