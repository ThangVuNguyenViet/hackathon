import type {
  ExternalClients,
  IrreversibleConfirmationBinding,
} from '../clients/interfaces.js';
import type { Cart, CustomerAccessContext, Order } from '../domain/types.js';
import type { AgentGraphState } from '../graph/state.js';
import { authorizeCustomerAccess } from '../security/customerAccessContext.js';
import {
  buildCommerceApprovalBinding,
  digestCommerceAction,
  verifyCommerceApprovalReceipt,
} from './approvalReceipt.js';
import { approvalCapabilityScopes } from './toolBoundaries.js';
import {
  agentToolArgumentSchemas,
  parseAgentToolArguments,
} from './toolCatalog.js';
import { executeToolCall, type ExecutorContext } from './toolExecutor.js';
import type {
  AgentToolCallFailure,
  AgentToolCallResult,
  CollectionScope,
  CollectionToolName,
  CommerceApprovalBinding,
  CommerceApprovalCapability,
  CommerceApprovalPrincipal,
  CommerceApprovalReceipt,
  CommerceAuthorityRevisions,
  ModifierSelectionInput,
  ToolCallRequest,
  ToolCallResult,
  VerifiedCollectionSnapshot,
} from './types.js';
import { buildVerifiedCollectionSnapshot } from './verifiedCollections.js';

export interface AgentApprovalExecutionContext {
  principal: CommerceApprovalPrincipal;
  receipt?: CommerceApprovalReceipt;
  signingSecret?: string | Uint8Array;
  /**
   * The #49 runtime must claim the receipt, current run ownership, and
   * irreversible boundary in one durable transaction. A successful claim is
   * the execution fence; the delegated provider call must not re-check and
   * consume that same boundary a second time.
   */
  claimExecution?: (input: {
    receipt: CommerceApprovalReceipt;
    binding: CommerceApprovalBinding;
    toolName: CommerceApprovalCapability;
    runGuard: NonNullable<ExecutorContext['runGuard']>;
  }) => Promise<
    | { ok: true }
    | {
        ok: false;
        errorCode:
          | 'approval_receipt_consumed'
          | 'approval_receipt_conflict'
          | 'stale_agent_run';
      }
  >;
}

export interface AgentToolExecutorContext extends ExecutorContext {
  approval?: AgentApprovalExecutionContext;
}

function agentFailure(
  request: ToolCallRequest,
  message: string,
  errorCode: string,
  approvalBinding?: CommerceApprovalBinding,
): AgentToolCallFailure {
  return {
    toolName: request.toolName,
    ok: false,
    message,
    errorCode,
    provenance: [],
    ...(approvalBinding ? { approvalBinding } : {}),
  };
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
    | Record<string, VerifiedCollectionSnapshot<Item>>
    | undefined;
  return snapshots?.[key];
}

function itemCodeIsVerified(state: AgentGraphState | undefined, itemCode: string): boolean {
  if (!state) return false;
  if (state.cart?.items.some((item) => item.itemCode === itemCode)) return true;
  const current = activeCollectionSnapshot<{ code: string }>(state, 'searchMenu');
  return current?.result.items.some((item) => item.code === itemCode) === true;
}

function currentMembershipTargetSnapshot(
  state: AgentGraphState | undefined,
  capability: Extract<CommerceApprovalCapability, 'acquireVoucher' | 'redeemReward'>,
  targetId: string,
): VerifiedCollectionSnapshot<unknown> | undefined {
  if (capability === 'acquireVoucher') {
    const snapshot = activeCollectionSnapshot<{ rewardId: string }>(
      state,
      'listMembershipRewards',
    );
    return snapshot?.result.items.some((item) => item.rewardId === targetId)
      ? snapshot
      : undefined;
  }
  const snapshot = activeCollectionSnapshot<{ voucherId: string }>(
    state,
    'listMembershipWallet',
  );
  return snapshot?.result.items.some((item) => item.voucherId === targetId)
    ? snapshot
    : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  const number = typeof value === 'string' ? Number(value) : value;
  return typeof number === 'number' && Number.isInteger(number) && number > 0
    ? number
    : undefined;
}

function authoritativeModifiers(
  state: AgentGraphState | undefined,
  itemCode: string,
  selections: Array<{ groupId: string; modifierId: string; quantity: number | null }>,
): ModifierSelectionInput[] | undefined {
  if (selections.length === 0) return [];
  const tree = state?.menuModifierOptions;
  if (!tree || tree.itemCode !== itemCode) return undefined;

  type ModifierGroup = (typeof tree.modifierGroups)[number];
  const groups = new Map<string, ModifierGroup>();
  const visit = (nested: ModifierGroup[]): void => {
    for (const group of nested) {
      groups.set(group.groupId, group);
      for (const option of group.options) visit(option.modifierGroups);
    }
  };
  visit(tree.modifierGroups);

  const resolved: ModifierSelectionInput[] = [];
  for (const selection of selections) {
    const group = groups.get(selection.groupId);
    const option = group?.options.find((candidate) => candidate.modifierId === selection.modifierId);
    if (!group || !option) return undefined;
    const optionQuantity = positiveInteger(option.quantity);
    const groupMin = positiveInteger(group.min);
    const groupMax = positiveInteger(group.max);
    const quantity =
      selection.quantity ??
      optionQuantity ??
      (groupMin !== undefined && groupMin === groupMax ? groupMin : undefined);
    if (quantity === undefined) return undefined;
    resolved.push({
      groupId: group.groupId,
      groupName: group.name,
      modifierId: option.modifierId,
      modifierName: option.name,
      priceDeltaVnd: option.priceDeltaVnd,
      quantity,
    });
  }
  return resolved;
}

async function currentAuthorityRevisions(
  clients: ExternalClients,
  request: ToolCallRequest,
  context: AgentToolExecutorContext,
): Promise<CommerceAuthorityRevisions | AgentToolCallFailure> {
  const authority = clients.confirmationAuthority;
  if (!authority) {
    return agentFailure(
      request,
      'Trusted provider authority is required',
      'provider_authority_unavailable',
    );
  }
  const activeCollections = Object.entries(context.state?.activeCollectionKeys ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([toolName, key]) => {
      const snapshots = context.state?.verifiedCollections?.[toolName as CollectionToolName] as
        | Record<string, VerifiedCollectionSnapshot<unknown>>
        | undefined;
      const snapshot = snapshots?.[key];
      return [
        toolName,
        key,
        snapshot?.revision ?? null,
        snapshot?.providerRevision ?? null,
      ];
    });
  const revisions: CommerceAuthorityRevisions = {
    cartRevision: await digestCommerceAction(getCart(context) ?? null),
    fulfillmentRevision: await digestCommerceAction(context.state?.fulfillment ?? null),
    paymentRevision: await digestCommerceAction({
      paymentAttempt: context.state?.paymentAttempt ?? null,
      selectedPaymentMethod: context.state?.selectedPaymentMethod ?? null,
    }),
    collectionRevision: await digestCommerceAction(activeCollections),
    providerRevision: authority.providerRevision,
  };
  const providerBinding: IrreversibleConfirmationBinding = {
    kind: 'confirm_order',
    requestId: `agent-commerce:${request.toolName}`,
    environment: authority.environment,
    scenarioId: authority.scenarioId,
    catalogObservationId: authority.catalogObservationId,
    catalogObservationHash: authority.catalogObservationHash,
    cartRevision: revisions.cartRevision,
    fulfillmentRevision: revisions.fulfillmentRevision,
    paymentRevision: revisions.paymentRevision,
    providerRevision: revisions.providerRevision,
  };
  let revalidated: { ok: boolean; reason?: string };
  try {
    revalidated = await authority.revalidate(providerBinding);
  } catch (error) {
    return agentFailure(
      request,
      `Provider authority revalidation failed: ${error instanceof Error ? error.message : String(error)}`,
      'provider_authority_stale',
    );
  }
  if (!revalidated.ok) {
    return agentFailure(
      request,
      revalidated.reason ?? 'Provider authority changed',
      'provider_authority_stale',
    );
  }
  return revisions;
}

function isAgentCallFailure(
  value: CommerceAuthorityRevisions | AgentToolCallFailure,
): value is AgentToolCallFailure {
  return 'ok' in value && value.ok === false;
}

function currentCollectionMatchesProvider(
  snapshot: VerifiedCollectionSnapshot<unknown> | undefined,
  revisions: CommerceAuthorityRevisions,
): boolean {
  return snapshot?.providerRevision === revisions.providerRevision;
}

async function approvalBindingForCall(
  clients: ExternalClients,
  request: ToolCallRequest,
  context: AgentToolExecutorContext,
): Promise<CommerceApprovalBinding | AgentToolCallFailure> {
  const capability = request.toolName as CommerceApprovalCapability;
  const approval = context.approval;
  const state = context.state;
  const sessionId = getSessionId(context);
  const customerId = state?.customerId;
  const channel = state?.channel;
  if (!approval || !sessionId || !customerId || !channel) {
    return agentFailure(request, 'Trusted approval context is required', 'approval_context_required');
  }
  if (
    approval.principal.sessionId !== sessionId ||
    approval.principal.customerId !== customerId ||
    approval.principal.channel !== channel
  ) {
    return agentFailure(request, 'Approval principal does not match the current turn', 'approval_principal_mismatch');
  }

  const access = authorizeCustomerAccess(context.accessContext, {
    channel,
    sessionId,
    customerId,
    scope: approvalCapabilityScopes[capability],
  });
  if (!access.allowed) return agentFailure(request, access.message, access.errorCode);
  const evidence = context.accessContext?.authenticationEvidence;
  if (
    context.accessContext?.authenticationState !== 'authenticated' ||
    evidence?.state !== 'verified' ||
    context.accessContext.kfcSubjectRef !== approval.principal.authenticatedSubject ||
    evidence.evidenceRef !== approval.principal.authenticationEvidenceRef
  ) {
    return agentFailure(request, 'Authenticated approval evidence does not match the principal', 'approval_principal_mismatch');
  }

  const revisions = await currentAuthorityRevisions(clients, request, context);
  if (isAgentCallFailure(revisions)) return revisions;

  let action: unknown;
  if (capability === 'placeOrder') {
    const orderPreview = getOrderPreview(context);
    if (!orderPreview) return agentFailure(request, 'Order preview is required before approval', 'order_preview_required');
    action = { toolName: capability, orderPreview };
  } else if (capability === 'createPaymentLink') {
    const order = context.order ?? state?.order;
    const method = agentToolArgumentSchemas.createPaymentLink.parse(request.arguments).method;
    if (!order) {
      return agentFailure(request, 'Created order is required before approval', 'order_required');
    }
    if (state?.selectedPaymentMethod !== method) {
      return agentFailure(
        request,
        'Payment method must match the current verified selection',
        'unverified_payment_method',
      );
    }
    action = { toolName: capability, order, method };
  } else if (capability === 'handoff') {
    const reasons = agentToolArgumentSchemas.handoff.parse(request.arguments).reasons;
    action = { toolName: capability, sessionId, reasons };
  } else {
    const targetId = capability === 'acquireVoucher'
      ? agentToolArgumentSchemas.acquireVoucher.parse(request.arguments).rewardId
      : agentToolArgumentSchemas.redeemReward.parse(request.arguments).voucherId;
    const targetSnapshot = currentMembershipTargetSnapshot(state, capability, targetId);
    if (!currentCollectionMatchesProvider(targetSnapshot, revisions)) {
      return agentFailure(request, 'Membership target must be present in current verified state', 'unverified_membership_target');
    }
    action = { toolName: capability, targetId };
  }
  return buildCommerceApprovalBinding({
    capability,
    principal: approval.principal,
    revisions,
    action,
  });
}

async function requireApprovedCall(
  clients: ExternalClients,
  request: ToolCallRequest,
  context: AgentToolExecutorContext,
): Promise<CommerceApprovalReceipt | AgentToolCallFailure> {
  const binding = await approvalBindingForCall(clients, request, context);
  if ('ok' in binding) return binding;
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
    return agentFailure(
      request,
      'The authenticated customer rejected this exact action',
      'approval_rejected',
    );
  }
  if (!approval.claimExecution || !context.runGuard) {
    return agentFailure(
      request,
      'Atomic approval and run-fence claim is unavailable',
      'approval_claim_unavailable',
    );
  }
  const claimed = await approval.claimExecution({
    receipt: verified.receipt,
    binding,
    toolName: binding.capability,
    runGuard: context.runGuard,
  });
  if (!claimed.ok) {
    return agentFailure(
      request,
      claimed.errorCode === 'stale_agent_run'
        ? 'Agent run is no longer current; approval receipt was not consumed'
        : 'Approval receipt has already been consumed or conflicts',
      claimed.errorCode,
    );
  }
  return verified.receipt;
}

function isAgentFailure(value: CommerceApprovalReceipt | AgentToolCallFailure): value is AgentToolCallFailure {
  return 'ok' in value && value.ok === false;
}

async function agentCollectionResult<Item>(
  legacy: ToolCallResult,
  items: Item[],
  scope: CollectionScope,
  providerRevision: string,
): Promise<AgentToolCallResult> {
  const snapshot = await buildVerifiedCollectionSnapshot({
    items,
    scope,
    providerRevision,
  });
  return {
    toolName: legacy.toolName,
    ok: true,
    value: snapshot.result,
    message: legacy.message,
    provenance: legacy.provenance,
    verifiedCollection: snapshot as typeof snapshot & { result: { items: unknown[] } },
  } as AgentToolCallResult;
}

async function adaptAgentResult(
  clients: ExternalClients,
  request: ToolCallRequest,
  context: AgentToolExecutorContext,
  legacy: ToolCallResult,
  scope?: CollectionScope,
): Promise<AgentToolCallResult> {
  if (!legacy.ok) return legacy;
  switch (legacy.toolName) {
    case 'searchMenu':
    case 'recommendAddOns':
    case 'findStores':
    case 'searchPromotions':
    case 'listMembershipRewards':
    case 'listMembershipWallet':
    case 'listMembershipTools':
    case 'listPaymentMethods':
    case 'searchContentPolicy':
    case 'answerAllergenQuestion': {
      const revisions = await currentAuthorityRevisions(clients, request, context);
      if (isAgentCallFailure(revisions)) return revisions;
      return agentCollectionResult(
        legacy,
        legacy.value as unknown[],
        scope ?? { scope: 'all' },
        revisions.providerRevision,
      );
    }
    default:
      return {
        toolName: legacy.toolName,
        ok: true,
        value: legacy.value,
        message: legacy.message,
        provenance: legacy.provenance,
      } as AgentToolCallResult;
  }
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
  const parsed = parseAgentToolArguments(request.toolName, request.arguments);
  if (!parsed.success) {
    return agentFailure(request, parsed.error.message, 'invalid_tool_arguments');
  }
  const state = context.state;
  let trustedRequest: ToolCallRequest = request;
  let scope: CollectionScope | undefined;
  let approvedReceipt: CommerceApprovalReceipt | undefined;

  switch (request.toolName) {
    case 'searchMenu': {
      const args = agentToolArgumentSchemas.searchMenu.parse(request.arguments);
      scope = args.scope === 'all'
        ? { scope: 'all' }
        : { scope: 'filtered', query: args.query! };
      trustedRequest = {
        toolName: request.toolName,
        arguments: { query: scope.scope === 'all' ? '' : scope.query },
      };
      break;
    }
    case 'getItemDetails':
    case 'getModifierOptions': {
      const args = request.toolName === 'getItemDetails'
        ? agentToolArgumentSchemas.getItemDetails.parse(request.arguments)
        : agentToolArgumentSchemas.getModifierOptions.parse(request.arguments);
      const revisions = await currentAuthorityRevisions(clients, request, context);
      if (isAgentCallFailure(revisions)) return revisions;
      const menu = activeCollectionSnapshot<{ code: string }>(state, 'searchMenu');
      if (
        !currentCollectionMatchesProvider(menu, revisions) ||
        !menu?.result.items.some((item) => item.code === args.code)
      ) {
        return agentFailure(
          request,
          'Menu item must be present in the current verified result',
          'unverified_item_code',
        );
      }
      break;
    }
    case 'updateCart': {
      const args = agentToolArgumentSchemas.updateCart.parse(request.arguments);
      const revisions = await currentAuthorityRevisions(clients, request, context);
      if (isAgentCallFailure(revisions)) return revisions;
      const menu = activeCollectionSnapshot<{ code: string }>(state, 'searchMenu');
      const changes = [];
      for (const change of args.changes) {
        if (!itemCodeIsVerified(state, change.itemCode)) {
          return agentFailure(request, 'Cart item code is not present in verified state', 'unverified_item_code');
        }
        const alreadyInCart = state?.cart?.items.some(
          (item) => item.itemCode === change.itemCode,
        ) === true;
        if (!alreadyInCart && !currentCollectionMatchesProvider(menu, revisions)) {
          return agentFailure(
            request,
            'Menu collection provider authority changed',
            'provider_authority_stale',
          );
        }
        const modifiers = authoritativeModifiers(state, change.itemCode, change.modifiers);
        if (modifiers === undefined) {
          return agentFailure(request, 'Modifier identifiers are not present in verified state', 'unverified_modifier');
        }
        changes.push({ itemCode: change.itemCode, quantity: change.quantity, modifiers });
      }
      trustedRequest = { toolName: request.toolName, arguments: { changes } };
      break;
    }
    case 'explainPromotion': {
      const args = agentToolArgumentSchemas.explainPromotion.parse(request.arguments);
      const revisions = await currentAuthorityRevisions(clients, request, context);
      if (isAgentCallFailure(revisions)) return revisions;
      const promotions = activeCollectionSnapshot<{ offerId: string }>(
        state,
        'searchPromotions',
      );
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
      const args = agentToolArgumentSchemas.findStores.parse(request.arguments);
      const filters = {
        ...(args.query ? { query: args.query } : {}),
        ...(args.city ? { city: args.city } : {}),
        ...(args.district ? { district: args.district } : {}),
      };
      scope = Object.keys(filters).length === 0
        ? { scope: 'all' }
        : { scope: 'filtered', query: JSON.stringify(filters) };
      trustedRequest = { toolName: request.toolName, arguments: filters };
      break;
    }
    case 'checkStoreAvailability': {
      const args = agentToolArgumentSchemas.checkStoreAvailability.parse(request.arguments);
      const itemCodes = exactCartItemCodes(context);
      if (!itemCodes) return agentFailure(request, 'A non-empty verified cart is required', 'cart_required');
      trustedRequest = {
        toolName: request.toolName,
        arguments: {
          storeId: args.storeId,
          itemCodes,
          ...(args.disposition ? { disposition: args.disposition } : {}),
        },
      };
      break;
    }
    case 'quoteFulfillment': {
      const args = agentToolArgumentSchemas.quoteFulfillment.parse(request.arguments);
      const itemCodes = exactCartItemCodes(context);
      if (!itemCodes) return agentFailure(request, 'A non-empty verified cart is required', 'cart_required');
      trustedRequest = {
        toolName: request.toolName,
        arguments: {
          address: { ...args.address, label: args.address.label ?? args.address.line1 },
          method: args.method,
          itemCodes,
        },
      };
      break;
    }
    case 'searchPromotions': {
      const args = agentToolArgumentSchemas.searchPromotions.parse(request.arguments);
      scope = scopeFromQuery(args.query);
      trustedRequest = {
        toolName: request.toolName,
        arguments: { query: args.query ?? '' },
      };
      break;
    }
    case 'validateVoucher': {
      const args = agentToolArgumentSchemas.validateVoucher.parse(request.arguments);
      const cart = getCart(context);
      if (!cart) return agentFailure(request, 'Cart is required before voucher validation', 'cart_required');
      trustedRequest = {
        toolName: request.toolName,
        arguments: { voucherText: args.voucherText, subtotalVnd: cart.subtotalVnd },
      };
      break;
    }
    case 'listMembershipRewards': {
      const args = agentToolArgumentSchemas.listMembershipRewards.parse(request.arguments);
      scope = scopeFromQuery(args.query);
      trustedRequest = {
        toolName: request.toolName,
        arguments: { ...(args.query ? { query: args.query } : {}) },
      };
      break;
    }
    case 'listMembershipWallet': {
      const args = agentToolArgumentSchemas.listMembershipWallet.parse(request.arguments);
      scope = args.status ? { scope: 'filtered', query: args.status } : { scope: 'all' };
      trustedRequest = {
        toolName: request.toolName,
        arguments: { ...(args.status ? { status: args.status } : {}) },
      };
      break;
    }
    case 'getMembershipPointHistory': {
      const args = agentToolArgumentSchemas.getMembershipPointHistory.parse(request.arguments);
      trustedRequest = {
        toolName: request.toolName,
        arguments: { ...(args.days ? { days: args.days } : {}) },
      };
      break;
    }
    case 'listMembershipTools': {
      const args = agentToolArgumentSchemas.listMembershipTools.parse(request.arguments);
      scope = args.sideEffect ? { scope: 'filtered', query: args.sideEffect } : { scope: 'all' };
      trustedRequest = {
        toolName: request.toolName,
        arguments: { ...(args.sideEffect ? { sideEffect: args.sideEffect } : {}) },
      };
      break;
    }
    case 'listPaymentMethods': {
      const args = agentToolArgumentSchemas.listPaymentMethods.parse(request.arguments);
      const filters = {
        ...(args.query ? { query: args.query } : {}),
        ...(args.paymentSurface ? { paymentSurface: args.paymentSurface } : {}),
      };
      scope = Object.keys(filters).length === 0
        ? { scope: 'all' }
        : { scope: 'filtered', query: JSON.stringify(filters) };
      trustedRequest = { toolName: request.toolName, arguments: filters };
      break;
    }
    case 'acquireVoucher':
    case 'redeemReward':
    case 'placeOrder':
    case 'createPaymentLink':
    case 'handoff': {
      const approval = await requireApprovedCall(clients, request, context);
      if (isAgentFailure(approval)) return approval;
      approvedReceipt = approval;
      if (request.toolName === 'acquireVoucher') {
        const args = agentToolArgumentSchemas.acquireVoucher.parse(request.arguments);
        trustedRequest = {
          toolName: request.toolName,
          arguments: { rewardId: args.rewardId, confirmed: true },
        };
      } else if (request.toolName === 'redeemReward') {
        const args = agentToolArgumentSchemas.redeemReward.parse(request.arguments);
        trustedRequest = {
          toolName: request.toolName,
          arguments: { voucherId: args.voucherId, channel: state?.channel, confirmed: true },
        };
      }
      break;
    }
    case 'getOrderStatus':
    case 'checkPaymentStatus': {
      const order = context.order ?? state?.order;
      if (!order) return agentFailure(request, 'Current verified order is required', 'order_required');
      trustedRequest = {
        toolName: request.toolName,
        arguments: { orderId: order.id },
      };
      break;
    }
    case 'searchContentPolicy': {
      const args = agentToolArgumentSchemas.searchContentPolicy.parse(request.arguments);
      scope = args.scope === 'all' ? { scope: 'all' } : { scope: 'filtered', query: args.query! };
      trustedRequest = {
        toolName: request.toolName,
        arguments: { kind: args.kind, query: args.query ?? '' },
      };
      break;
    }
    case 'answerAllergenQuestion': {
      const args = agentToolArgumentSchemas.answerAllergenQuestion.parse(request.arguments);
      scope = { scope: 'filtered', query: args.query };
      break;
    }
    case 'collectInvoice': {
      const args = agentToolArgumentSchemas.collectInvoice.parse(request.arguments);
      trustedRequest = {
        toolName: request.toolName,
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

  const executionContext: ExecutorContext = approvedReceipt
    ? {
        ...context,
        runGuard: undefined,
        ...(request.toolName === 'placeOrder'
          ? {
              state: context.state
                ? { ...context.state, userConfirmedOrder: true }
                : context.state,
            }
          : {}),
      }
    : context;
  const legacy = await executeToolCall(clients, trustedRequest, executionContext);
  if (legacy.ok && legacy.toolName === 'checkStoreAvailability') {
    const expected = exactCartItemCodes(context)!;
    if (!exactStringSet(expected, Object.keys(legacy.value))) {
      return agentFailure(request, 'Availability result does not cover the exact current cart', 'incomplete_cart_availability');
    }
  }
  if (legacy.ok && legacy.toolName === 'quoteFulfillment') {
    const expected = exactCartItemCodes(context)!;
    if (!exactStringSet(expected, legacy.value.availability.checkedItemIds)) {
      return agentFailure(request, 'Fulfillment quote does not cover the exact current cart', 'incomplete_cart_availability');
    }
  }
  if (legacy.ok && approvedReceipt && context.state) {
    context.state.commerceApprovalReceipts = [
      ...(context.state.commerceApprovalReceipts ?? []),
      approvedReceipt,
    ];
  }
  return adaptAgentResult(clients, request, context, legacy, scope);
}
