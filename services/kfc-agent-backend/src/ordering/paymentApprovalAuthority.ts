import type { Order } from '../domain/types.js';
import type {
  SelectedPaymentMethodAuthority,
} from '../domain/opaqueProviderId.js';
import type { AgentState } from '../agent/agentState.js';
import { canonicalJson } from '../agent/turnSupport.js';
import {
  activeSupportedPaymentMethod,
  paymentMethodAuthorityMatchesCurrentProvider,
  selectedPaymentMethodAuthorityMatchesActiveCollection,
  selectedPaymentMethodAuthorityMatchesCurrentProvider,
  type VerifiedPaymentMethodAuthority,
} from './paymentMethodAuthority.js';
import type {
  CommerceAuthorityRevisions,
} from './types.js';

export type PaymentApprovalAuthorityFailure = {
  ok: false;
  errorCode: 'order_required' | 'unverified_payment_method';
  message: string;
};

export interface CapturedPaymentApprovalAuthority {
  ok: true;
  order: Order;
  method: VerifiedPaymentMethodAuthority;
  selection: SelectedPaymentMethodAuthority;
  orderSnapshot: string;
  selectionSnapshot: string;
}

export function capturePaymentApprovalAuthority(input: {
  state: AgentState;
  contextOrder: Order | undefined;
  methodId: string;
}): CapturedPaymentApprovalAuthority | PaymentApprovalAuthorityFailure {
  const order = input.contextOrder ?? input.state.order;
  if (!order) {
    return {
      ok: false,
      errorCode: 'order_required',
      message: 'Created order is required before approval',
    };
  }
  const method = activeSupportedPaymentMethod(input.state, input.methodId);
  const selection = input.state.selectedPaymentMethod;
  if (
    !method ||
    !selection ||
    selection.methodId !== input.methodId ||
    !selectedPaymentMethodAuthorityMatchesActiveCollection(
      input.state,
      selection,
    )
  ) {
    return {
      ok: false,
      errorCode: 'unverified_payment_method',
      message:
        'Payment method must match the current customer-selected collection authority',
    };
  }
  return {
    ok: true,
    order,
    method,
    selection,
    orderSnapshot: canonicalJson(order),
    selectionSnapshot: canonicalJson(selection),
  };
}

export function paymentApprovalAuthorityRemainsCurrent(input: {
  state: AgentState;
  contextOrder: Order | undefined;
  captured: CapturedPaymentApprovalAuthority;
  revisions: CommerceAuthorityRevisions;
}): boolean {
  const currentOrder = input.contextOrder ?? input.state.order;
  return (
    canonicalJson(currentOrder ?? null) === input.captured.orderSnapshot &&
    canonicalJson(input.state.selectedPaymentMethod ?? null) ===
      input.captured.selectionSnapshot &&
    paymentMethodAuthorityMatchesCurrentProvider(
      input.state,
      input.captured.method,
      input.revisions,
    ) &&
    selectedPaymentMethodAuthorityMatchesCurrentProvider(
      input.state,
      input.captured.selection,
      input.revisions,
    )
  );
}

export function paymentApprovalAction(input: {
  captured: CapturedPaymentApprovalAuthority;
  methodId: string;
}) {
  return {
    toolName: 'createPaymentLink' as const,
    order: input.captured.order,
    methodId: input.methodId,
    paymentMethodCollection: {
      key: input.captured.selection.collectionKey,
      revision: input.captured.selection.collectionRevision,
      providerRevision: input.captured.selection.providerRevision,
    },
  };
}
