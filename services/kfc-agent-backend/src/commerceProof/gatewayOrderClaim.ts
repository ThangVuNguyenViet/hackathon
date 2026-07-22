import type { CommerceCommand } from './contracts.js';
import {
  claimGatewayMutationAuthority,
  sameProviderMutationBinding,
  type CommerceProofGatewayMutationState,
  type GatewayProviderRuntimeBinding,
  type StoredCommerceOrderMutation,
} from './gatewayMutationContracts.js';
import type { GatewayMutationDurability } from './gatewayMutationDurability.js';
import {
  deriveGatewayProviderMutationIdentity,
  gatewayOmsCreateInput,
} from './gatewayMutationIdentity.js';
import { bindGatewayProviderRuntime } from './gatewayRestoreValidation.js';

type OrderClaim =
  | { kind: 'claimed'; stored: StoredCommerceOrderMutation }
  | { kind: 'conflict' };

export function claimStoredCommerceOrder(input: {
  state: CommerceProofGatewayMutationState;
  durability: GatewayMutationDurability;
  command: CommerceCommand;
  canonicalPayload: string;
  providerRuntimeBinding: GatewayProviderRuntimeBinding;
}): Promise<OrderClaim> {
  return input.durability.commitStateUpdate((candidateState) => {
    if (
      !bindGatewayProviderRuntime(candidateState, input.providerRuntimeBinding)
    ) {
      throw new Error('gateway_provider_runtime_binding_mismatch');
    }
    const existing = candidateState.ordersByIdempotencyKey.get(
      input.command.idempotencyKey,
    );
    if (existing) {
      const exactBinding = sameProviderMutationBinding(
        existing.command.bindingFingerprint,
        existing.canonicalPayload,
        input.command.bindingFingerprint,
        input.canonicalPayload,
      );
      const exactAuthority = claimGatewayMutationAuthority(candidateState, {
        kind: 'placeOrder',
        idempotencyKey: input.command.idempotencyKey,
        bindingFingerprint: input.command.bindingFingerprint,
        canonicalPayload: input.canonicalPayload,
      });
      return {
        output:
          exactBinding && exactAuthority
            ? { kind: 'claimed' as const, stored: existing }
            : { kind: 'conflict' as const },
        publish() {},
      };
    }
    if (candidateState.nextCommerceSequence >= Number.MAX_SAFE_INTEGER) {
      throw new Error('gateway_commerce_sequence_exhausted');
    }
    const nextCommerceSequence = candidateState.nextCommerceSequence + 1;
    const commerceOrderId = `COM-${String(nextCommerceSequence).padStart(4, '0')}`;
    const candidateStored: StoredCommerceOrderMutation = {
      command: input.command,
      canonicalPayload: input.canonicalPayload,
      commerceOrderId,
      state: 'oms_create_pending',
      omsCreateIdentity: deriveGatewayProviderMutationIdentity(
        {
          idempotencyKey: input.command.idempotencyKey,
          bindingFingerprint: input.command.bindingFingerprint,
        },
        'oms_create',
        gatewayOmsCreateInput(input.command, commerceOrderId),
      ),
    };
    if (
      !claimGatewayMutationAuthority(candidateState, {
        kind: 'placeOrder',
        idempotencyKey: input.command.idempotencyKey,
        bindingFingerprint: input.command.bindingFingerprint,
        canonicalPayload: input.canonicalPayload,
      })
    ) {
      return {
        output: { kind: 'conflict' as const },
        publish() {},
      };
    }
    candidateState.nextCommerceSequence = nextCommerceSequence;
    candidateState.ordersByIdempotencyKey.set(
      input.command.idempotencyKey,
      candidateStored,
    );
    candidateState.orderKeyByCommerceOrderId.set(
      commerceOrderId,
      input.command.idempotencyKey,
    );
    return {
      output: { kind: 'claimed' as const, stored: candidateStored },
      publish() {
        input.state.providerRuntimeBinding = input.providerRuntimeBinding;
        input.state.nextCommerceSequence = nextCommerceSequence;
        input.state.authorityByIdempotencyKey.set(
          input.command.idempotencyKey,
          candidateState.authorityByIdempotencyKey.get(
            input.command.idempotencyKey,
          )!,
        );
        input.state.ordersByIdempotencyKey.set(
          input.command.idempotencyKey,
          candidateStored,
        );
        input.state.orderKeyByCommerceOrderId.set(
          commerceOrderId,
          input.command.idempotencyKey,
        );
      },
    };
  });
}
