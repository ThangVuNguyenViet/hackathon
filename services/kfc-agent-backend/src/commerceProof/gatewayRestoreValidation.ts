import type { CommerceResult } from './contracts.js';
import type {
  CommerceProofGatewayMutationState,
  GatewayProviderRuntimeBinding,
  StoredCancellationMutation,
  StoredCommerceOrderMutation,
} from './gatewayMutationContracts.js';
import type {
  createCommerceProofOmsClient,
  createCommerceProofPosClient,
  OmsResponse,
  PosResponse,
} from './httpClients.js';

type OmsClient = ReturnType<typeof createCommerceProofOmsClient>;
type PosClient = ReturnType<typeof createCommerceProofPosClient>;

interface ExpectedProviderState {
  omsStatuses: ReadonlySet<OmsResponse['omsStatus']>;
  posStatuses: ReadonlySet<PosResponse['posStatus']>;
}

const createdOmsStatuses = new Set<OmsResponse['omsStatus']>(['created']);
const cancelledOmsStatuses = new Set<OmsResponse['omsStatus']>(['cancelled']);
const uncertainOmsCancellationStatuses = new Set<OmsResponse['omsStatus']>([
  'created',
  'cancelled',
]);
const acceptedPosStatuses = new Set<PosResponse['posStatus']>(['accepted']);
const cancelledPosStatuses = new Set<PosResponse['posStatus']>(['cancelled']);
const uncertainPosCancellationStatuses = new Set<PosResponse['posStatus']>([
  'accepted',
  'cancelled',
]);

export async function validateRestoredGatewayProviderState(input: {
  state: CommerceProofGatewayMutationState;
  oms: OmsClient;
  pos: PosClient;
}): Promise<void> {
  if (!input.state.providerRuntimeBinding) return;
  const live = await readGatewayProviderRuntimeBinding(input);
  if (
    input.state.providerRuntimeBinding.omsInstanceId !== live.omsInstanceId ||
    input.state.providerRuntimeBinding.posInstanceId !== live.posInstanceId
  ) {
    throw new Error('gateway_provider_runtime_binding_mismatch');
  }
  const cancellationByOrderId = new Map(
    [...input.state.cancellationsByIdempotencyKey.values()].map(
      (stored) => [stored.context.commerceOrderId, stored] as const,
    ),
  );

  await Promise.all(
    [...input.state.ordersByIdempotencyKey.values()].map(async (stored) => {
      const providerState = expectedProviderState(
        stored,
        cancellationByOrderId.get(stored.commerceOrderId),
      );
      await Promise.all([
        validateOmsPredecessor(input.oms, stored, providerState),
        validatePosPredecessor(input.pos, stored, providerState),
      ]);
    }),
  );
}

export async function readGatewayProviderRuntimeBinding(input: {
  oms: OmsClient;
  pos: PosClient;
}): Promise<GatewayProviderRuntimeBinding> {
  const [omsRuntime, posRuntime] = await Promise.all([
    input.oms.getRuntimeIdentity(),
    input.pos.getRuntimeIdentity(),
  ]);
  if (!omsRuntime.ok || !posRuntime.ok) {
    throw new Error('gateway_provider_runtime_identity_unavailable');
  }
  return {
    omsInstanceId: omsRuntime.value.instanceId,
    posInstanceId: posRuntime.value.instanceId,
  };
}

export function bindGatewayProviderRuntime(
  state: CommerceProofGatewayMutationState,
  live: GatewayProviderRuntimeBinding,
): boolean {
  const stored = state.providerRuntimeBinding;
  if (!stored) {
    state.providerRuntimeBinding = live;
    return true;
  }
  return (
    stored.omsInstanceId === live.omsInstanceId &&
    stored.posInstanceId === live.posInstanceId
  );
}

async function validateOmsPredecessor(
  oms: OmsClient,
  stored: StoredCommerceOrderMutation,
  expected: ExpectedProviderState,
): Promise<void> {
  if (!stored.omsCreateEvidence || !stored.omsOrderId) return;
  const response = await oms.getOrder(
    stored.omsOrderId,
    `restore-${stored.command.traceId}`,
  );
  if (
    !response.ok ||
    response.value.contractVersion !== stored.command.contractVersion ||
    response.value.scenarioId !== stored.command.scenarioId ||
    response.value.commerceOrderId !== stored.commerceOrderId ||
    response.value.omsOrderId !== stored.omsOrderId ||
    !expected.omsStatuses.has(response.value.omsStatus)
  ) {
    throw new Error('gateway_restored_oms_predecessor_unverified');
  }
}

async function validatePosPredecessor(
  pos: PosClient,
  stored: StoredCommerceOrderMutation,
  expected: ExpectedProviderState,
): Promise<void> {
  const posTicketId = stored.posSubmitEvidence?.posTicketId;
  if (!posTicketId || !stored.omsOrderId) return;
  const response = await pos.getTicket(
    posTicketId,
    `restore-${stored.command.traceId}`,
  );
  if (
    !response.ok ||
    response.value.contractVersion !== stored.command.contractVersion ||
    response.value.scenarioId !== stored.command.scenarioId ||
    response.value.commerceOrderId !== stored.commerceOrderId ||
    response.value.omsOrderId !== stored.omsOrderId ||
    response.value.posTicketId !== posTicketId ||
    !expected.posStatuses.has(response.value.posStatus)
  ) {
    throw new Error('gateway_restored_pos_predecessor_unverified');
  }
}

function expectedProviderState(
  order: StoredCommerceOrderMutation,
  cancellation: StoredCancellationMutation | undefined,
): ExpectedProviderState {
  if (cancellation) return cancellationProviderState(cancellation);
  const outcome = completedOutcome(order);
  if (outcome === 'pos_rejected') {
    return {
      omsStatuses: order.omsCompensationEvidence
        ? cancelledOmsStatuses
        : order.state === 'oms_compensation_unknown'
          ? uncertainOmsCancellationStatuses
          : createdOmsStatuses,
      posStatuses: acceptedPosStatuses,
    };
  }
  return {
    omsStatuses: createdOmsStatuses,
    posStatuses: acceptedPosStatuses,
  };
}

function cancellationProviderState(
  cancellation: StoredCancellationMutation,
): ExpectedProviderState {
  if (
    cancellation.state === 'pos_cancel_pending' ||
    cancellation.state === 'pos_cancel_unknown'
  ) {
    return {
      omsStatuses: createdOmsStatuses,
      posStatuses:
        cancellation.state === 'pos_cancel_unknown'
          ? uncertainPosCancellationStatuses
          : acceptedPosStatuses,
    };
  }
  if (
    cancellation.state === 'pos_cancel_failed' ||
    cancellation.completionKind === 'pos_cancellation_failed'
  ) {
    return {
      omsStatuses: createdOmsStatuses,
      posStatuses: acceptedPosStatuses,
    };
  }
  if (
    cancellation.state === 'oms_cancel_pending' ||
    cancellation.state === 'oms_cancel_unknown'
  ) {
    return {
      omsStatuses:
        cancellation.state === 'oms_cancel_unknown'
          ? uncertainOmsCancellationStatuses
          : createdOmsStatuses,
      posStatuses: cancelledPosStatuses,
    };
  }
  if (
    cancellation.state === 'oms_cancel_failed' ||
    cancellation.completionKind === 'oms_cancellation_failed'
  ) {
    return {
      omsStatuses: createdOmsStatuses,
      posStatuses: cancelledPosStatuses,
    };
  }
  return {
    omsStatuses: cancelledOmsStatuses,
    posStatuses: cancelledPosStatuses,
  };
}

function completedOutcome(
  order: StoredCommerceOrderMutation,
): CommerceResult['outcome'] | undefined {
  return order.state === 'completed' ? order.response?.outcome : undefined;
}
