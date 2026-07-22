import { createHash } from 'node:crypto';
import { commerceContractVersion, type CommerceCommand } from './contracts.js';

export interface GatewayProviderMutationIdentity {
  idempotencyKey: string;
  bindingFingerprint: string;
}

export interface GatewayCancellationContext {
  traceId: string;
  scenarioId: string;
  commerceOrderId: string;
  omsOrderId: string;
  posTicketId: string;
}

export function gatewayOmsCreateInput(
  command: CommerceCommand,
  commerceOrderId: string,
) {
  return {
    contractVersion: commerceContractVersion,
    traceId: command.traceId,
    scenarioId: command.scenarioId,
    commerceOrderId,
    storeId: command.order.storeId,
    items: command.order.items,
    totalVnd: command.order.totalVnd,
  };
}

export function gatewayPosSubmitInput(
  command: CommerceCommand,
  commerceOrderId: string,
  omsOrderId: string,
) {
  return {
    ...gatewayOmsCreateInput(command, commerceOrderId),
    omsOrderId,
  };
}

export function gatewayOmsCompensationAction(
  omsOrderId: string,
  context: Omit<GatewayCancellationContext, 'omsOrderId' | 'posTicketId'>,
) {
  return { omsOrderId, ...context };
}

export function gatewayPosCancellationAction(
  context: GatewayCancellationContext,
) {
  return { ...context };
}

export function gatewayOmsCancellationAction(
  context: GatewayCancellationContext,
) {
  return { ...context };
}

export function deriveGatewayProviderMutationIdentity(
  parent: GatewayProviderMutationIdentity,
  operation:
    | 'oms_create'
    | 'pos_submit'
    | 'oms_compensate'
    | 'pos_cancel'
    | 'oms_cancel',
  canonicalChildAction: unknown,
): GatewayProviderMutationIdentity {
  return {
    idempotencyKey: `kfc:${operation}:${sha256(parent.idempotencyKey)}`,
    bindingFingerprint: sha256(
      JSON.stringify({
        parentBindingFingerprint: parent.bindingFingerprint,
        operation,
        canonicalChildAction,
      }),
    ),
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
