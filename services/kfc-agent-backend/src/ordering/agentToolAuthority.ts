import type { ExternalClients, IrreversibleConfirmationBinding } from '../clients/interfaces.js';
import { digestCommerceAction } from './approvalReceipt.js';
import { externalCallCancelledErrorCode, externalCallIsCancelled, type ExecutorContext } from './toolExecutor.js';
import type {
  AgentToolCallFailure,
  CollectionToolName,
  CommerceApprovalBinding,
  CommerceAuthorityRevisions,
  ToolCallRequest,
  VerifiedCollectionSnapshot,
} from './types.js';

type AgentAuthorityContext = Pick<ExecutorContext, 'cart' | 'externalCallContext' | 'state'>;

const collectionToolNames = [
  'answerAllergenQuestion',
  'findStores',
  'listMembershipRewards',
  'listMembershipTools',
  'listMembershipWallet',
  'listPaymentMethods',
  'recommendAddOns',
  'searchContentPolicy',
  'searchMenu',
  'searchPromotions',
] as const satisfies readonly CollectionToolName[];

export function agentFailure(
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

export async function currentAuthorityRevisions(
  clients: ExternalClients,
  request: ToolCallRequest,
  context: AgentAuthorityContext,
): Promise<CommerceAuthorityRevisions | AgentToolCallFailure> {
  if (externalCallIsCancelled(context.externalCallContext)) {
    return agentFailure(
      request,
      'External tool execution was cancelled before authority revalidation',
      externalCallCancelledErrorCode,
    );
  }
  const authority = clients.confirmationAuthority;
  if (!authority) {
    return agentFailure(request, 'Trusted provider authority is required', 'provider_authority_unavailable');
  }
  const activeCollections = collectionToolNames.flatMap((toolName) => {
    const key = context.state?.activeCollectionKeys?.[toolName];
    if (!key) return [];
    const snapshots: Record<string, VerifiedCollectionSnapshot<unknown>> | undefined =
      context.state?.verifiedCollections?.[toolName];
    const snapshot = snapshots?.[key];
    return [[toolName, key, snapshot?.revision ?? null, snapshot?.providerRevision ?? null]];
  });
  const revisions: CommerceAuthorityRevisions = {
    cartRevision: await digestCommerceAction(context.cart ?? context.state?.cart ?? null),
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
  if (externalCallIsCancelled(context.externalCallContext)) {
    return agentFailure(
      request,
      'External tool execution was cancelled before authority revalidation',
      externalCallCancelledErrorCode,
    );
  }
  let revalidated: { ok: boolean; reason?: string };
  try {
    revalidated = await authority.revalidate(providerBinding, context.externalCallContext);
  } catch (error) {
    if (externalCallIsCancelled(context.externalCallContext)) {
      return agentFailure(
        request,
        'External tool execution was cancelled during authority revalidation',
        externalCallCancelledErrorCode,
      );
    }
    return agentFailure(
      request,
      `Provider authority revalidation failed: ${error instanceof Error ? error.message : String(error)}`,
      'provider_authority_stale',
    );
  }
  if (externalCallIsCancelled(context.externalCallContext)) {
    return agentFailure(
      request,
      'External tool execution was cancelled during authority revalidation',
      externalCallCancelledErrorCode,
    );
  }
  if (!revalidated.ok) {
    return agentFailure(request, revalidated.reason ?? 'Provider authority changed', 'provider_authority_stale');
  }
  return revisions;
}

export function isAgentCallFailure(
  value: CommerceAuthorityRevisions | AgentToolCallFailure,
): value is AgentToolCallFailure {
  return 'ok' in value && value.ok === false;
}

export function currentCollectionMatchesProvider(
  snapshot: VerifiedCollectionSnapshot<unknown> | undefined,
  revisions: CommerceAuthorityRevisions,
): boolean {
  return snapshot?.providerRevision === revisions.providerRevision;
}
