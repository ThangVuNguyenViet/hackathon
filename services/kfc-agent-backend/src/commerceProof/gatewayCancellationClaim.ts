import {
  claimGatewayMutationAuthority,
  sameProviderMutationBinding,
  type CommerceProofGatewayMutationState,
  type StoredCancellationMutation,
} from './gatewayMutationContracts.js';
import type { GatewayMutationDurability } from './gatewayMutationDurability.js';
import {
  deriveGatewayProviderMutationIdentity,
  gatewayPosCancellationAction,
} from './gatewayMutationIdentity.js';

type CancellationClaim =
  | { kind: 'claimed'; stored: StoredCancellationMutation }
  | { kind: 'conflict' };

export function claimStoredCancellation(input: {
  state: CommerceProofGatewayMutationState;
  durability: GatewayMutationDurability;
  idempotencyKey: string;
  bindingFingerprint: string;
  canonicalPayload: string;
  commerceOrderId: string;
  scenarioId: string;
  omsOrderId: string;
  posTicketId: string;
}): Promise<CancellationClaim> {
  return input.durability.commitStateUpdate((candidateState) => {
    const existingForKey = candidateState.cancellationsByIdempotencyKey.get(
      input.idempotencyKey,
    );
    if (existingForKey) {
      const exactBinding = sameProviderMutationBinding(
        existingForKey.bindingFingerprint,
        existingForKey.canonicalPayload,
        input.bindingFingerprint,
        input.canonicalPayload,
      );
      const exactAuthority = claimGatewayMutationAuthority(candidateState, {
        kind: 'cancelOrder',
        idempotencyKey: input.idempotencyKey,
        bindingFingerprint: input.bindingFingerprint,
        canonicalPayload: input.canonicalPayload,
      });
      return {
        output:
          exactBinding && exactAuthority
            ? { kind: 'claimed' as const, stored: existingForKey }
            : { kind: 'conflict' as const },
        publish() {},
      };
    }

    const existingForOrder = [
      ...candidateState.cancellationsByIdempotencyKey.values(),
    ].some(
      (cancellation) =>
        cancellation.context.commerceOrderId === input.commerceOrderId,
    );
    if (existingForOrder) {
      return {
        output: { kind: 'conflict' as const },
        publish() {},
      };
    }

    const context = {
      traceId: crypto.randomUUID(),
      scenarioId: input.scenarioId,
      commerceOrderId: input.commerceOrderId,
      omsOrderId: input.omsOrderId,
      posTicketId: input.posTicketId,
    };
    const candidateStored: StoredCancellationMutation = {
      bindingFingerprint: input.bindingFingerprint,
      canonicalPayload: input.canonicalPayload,
      state: 'pos_cancel_pending',
      context,
      posCancelIdentity: deriveGatewayProviderMutationIdentity(
        {
          idempotencyKey: input.idempotencyKey,
          bindingFingerprint: input.bindingFingerprint,
        },
        'pos_cancel',
        gatewayPosCancellationAction(context),
      ),
    };
    if (
      !claimGatewayMutationAuthority(candidateState, {
        kind: 'cancelOrder',
        idempotencyKey: input.idempotencyKey,
        bindingFingerprint: input.bindingFingerprint,
        canonicalPayload: input.canonicalPayload,
      })
    ) {
      return {
        output: { kind: 'conflict' as const },
        publish() {},
      };
    }
    candidateState.cancellationsByIdempotencyKey.set(
      input.idempotencyKey,
      candidateStored,
    );
    return {
      output: { kind: 'claimed' as const, stored: candidateStored },
      publish() {
        input.state.authorityByIdempotencyKey.set(
          input.idempotencyKey,
          candidateState.authorityByIdempotencyKey.get(input.idempotencyKey)!,
        );
        input.state.cancellationsByIdempotencyKey.set(
          input.idempotencyKey,
          candidateStored,
        );
      },
    };
  });
}
