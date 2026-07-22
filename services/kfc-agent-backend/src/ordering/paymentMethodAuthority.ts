import type { GeneratedPaymentMethod } from '../fixtures/schema.js';
import type { AgentState } from '../agent/agentState.js';
import {
  opaqueProviderIdSchema,
  paymentMethodCollectionAuthoritySchema,
  type PaymentMethodCollectionAuthority,
  type SelectedPaymentMethodAuthority,
} from '../domain/opaqueProviderId.js';
import type { VerifiedCollectionSnapshot } from './types.js';

export interface VerifiedPaymentMethodAuthority extends SelectedPaymentMethodAuthority {
  method: GeneratedPaymentMethod;
}

type PaymentCollectionState = Pick<
  AgentState,
  'activeCollectionKeys' | 'verifiedCollections'
>;

function activePaymentMethodCollection(
  state: PaymentCollectionState,
): VerifiedCollectionSnapshot<GeneratedPaymentMethod> | undefined {
  const collectionKey = state.activeCollectionKeys?.listPaymentMethods;
  if (!collectionKey) return undefined;
  const collection =
    state.verifiedCollections?.listPaymentMethods?.[collectionKey];
  if (!collection || collection.key !== collectionKey) return undefined;
  if (
    !paymentMethodCollectionAuthoritySchema.safeParse({
      collectionKey: collection.key,
      collectionRevision: collection.revision,
      providerRevision: collection.providerRevision,
    }).success
  ) {
    return undefined;
  }
  if (
    collection.result.complete !== true ||
    collection.result.returned !== collection.result.items.length ||
    collection.result.total !== collection.result.items.length
  ) {
    return undefined;
  }
  const inventoryIds = new Set<string>();
  for (const method of collection.result.items) {
    if (
      !opaqueProviderIdSchema.safeParse(method.methodId).success ||
      inventoryIds.has(method.methodId)
    ) {
      return undefined;
    }
    inventoryIds.add(method.methodId);
  }
  return collection;
}

export function activePaymentMethodCollectionAuthority(
  state: PaymentCollectionState,
): PaymentMethodCollectionAuthority | undefined {
  const collection = activePaymentMethodCollection(state);
  return collection
    ? {
        collectionKey: collection.key,
        collectionRevision: collection.revision,
        providerRevision: collection.providerRevision,
      }
    : undefined;
}

/**
 * Resolve an opaque provider method id only from the currently active,
 * revision-bound payment collection. Display names, model aliases, and
 * hard-coded method tables are never selection authority.
 */
export function activeSupportedPaymentMethod(
  state: PaymentCollectionState,
  methodId: string,
): VerifiedPaymentMethodAuthority | undefined {
  const collection = activePaymentMethodCollection(state);
  if (!collection || !opaqueProviderIdSchema.safeParse(methodId).success) {
    return undefined;
  }
  const matching = collection.result.items.filter(
    (method) => method.methodId === methodId,
  );
  if (
    matching.length !== 1 ||
    matching[0]?.supported !== true ||
    matching[0].supportStatus !== 'listed_supported'
  ) {
    return undefined;
  }
  return {
    method: matching[0],
    methodId,
    collectionKey: collection.key,
    collectionRevision: collection.revision,
    providerRevision: collection.providerRevision,
  };
}

export function selectedPaymentMethodAuthority(
  authority: VerifiedPaymentMethodAuthority,
): SelectedPaymentMethodAuthority {
  return {
    methodId: authority.methodId,
    collectionKey: authority.collectionKey,
    collectionRevision: authority.collectionRevision,
    providerRevision: authority.providerRevision,
  };
}

export function selectedPaymentMethodAuthorityMatchesActiveCollection(
  state: PaymentCollectionState,
  authority: SelectedPaymentMethodAuthority,
): boolean {
  const current = activeSupportedPaymentMethod(state, authority.methodId);
  return (
    current?.collectionKey === authority.collectionKey &&
    current.collectionRevision === authority.collectionRevision &&
    current.providerRevision === authority.providerRevision
  );
}

/**
 * A typed model tool call is the semantic payment choice for text mode.
 * Deterministic code only resolves its exact opaque id against verified state
 * and snapshots that authority for the payment call.
 */
export function prepareModelAuthoredPaymentSelection(
  state: AgentState,
  call:
    | {
        toolName: string;
        arguments: Record<string, unknown>;
      }
    | undefined,
): AgentState | undefined {
  if (call?.toolName !== 'createPaymentLink') return state;
  const methodId = opaqueProviderIdSchema.safeParse(call.arguments.methodId);
  if (!methodId.success) return undefined;
  const authority = activeSupportedPaymentMethod(state, methodId.data);
  return authority
    ? {
        ...state,
        selectedPaymentMethod: selectedPaymentMethodAuthority(authority),
      }
    : undefined;
}
