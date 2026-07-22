import {
  orderWithCurrentDeliveryEstimate,
  orderWithoutDeliveryEstimate,
} from '../domain/orderStatusEvidence.js';
import type { Order } from '../domain/types.js';
import type {
  AgentToolCallResult,
  CustomerContext,
} from '../ordering/types.js';
import type { AgentGraphState } from './state.js';

export type ModelFacingOrderStatusObservation = Pick<
  Order,
  'status' | 'paymentStatus' | 'posStatus'
>;

export interface ModelFacingOrderStatusSuccess {
  toolName: 'getOrderStatus';
  ok: true;
  value: ModelFacingOrderStatusObservation;
  message: 'order_status_observed';
  provenance: [];
}

type ServerBoundPaymentToolName =
  | 'createPaymentLink'
  | 'checkPaymentStatus';

type ModelFacingPaymentToolSuccess = {
  [Name in ServerBoundPaymentToolName]: Omit<
    Extract<AgentToolCallResult, { toolName: Name; ok: true }>,
    'value'
  > & {
    value: Omit<
      Extract<
        AgentToolCallResult,
        { toolName: Name; ok: true }
      >['value'],
      'orderId'
    >;
  };
}[ServerBoundPaymentToolName];

export type AgentToolResultForModel =
  | Exclude<
      AgentToolCallResult,
      | { toolName: 'getOrderStatus'; ok: true }
      | {
          toolName: ServerBoundPaymentToolName;
          ok: true;
        }
    >
  | ModelFacingOrderStatusSuccess
  | ModelFacingPaymentToolSuccess;

export function customerContextWithoutStatusOnlyDeliveryEstimates(
  context: CustomerContext | undefined,
): CustomerContext | undefined {
  if (!context) return undefined;
  return {
    ...context,
    recentOrders: context.recentOrders.map(orderWithoutDeliveryEstimate),
  };
}

export function agentStateWithCurrentOrderStatusEvidence(
  state: AgentGraphState,
  nowMs = Date.now(),
): AgentGraphState {
  return {
    ...state,
    orderPreview: state.orderPreview
      ? orderWithoutDeliveryEstimate(state.orderPreview)
      : undefined,
    order:
      orderWithCurrentDeliveryEstimate(state.order, nowMs) ?? undefined,
    customerContext: customerContextWithoutStatusOnlyDeliveryEstimates(
      state.customerContext,
    ),
  };
}

export function agentToolResultForModel(
  result: AgentToolCallResult,
): AgentToolResultForModel {
  if (result.toolName === 'checkStoreAvailability' && result.ok) {
    const {
      inventoryAvailabilityAuthority: _providerAuthority,
      verifiedAvailabilityObservation: _serverAuthority,
      ...modelResult
    } = result;
    return modelResult;
  }
  if (result.ok && result.toolName === 'createPaymentLink') {
    const {
      orderId: _serverOrderBinding,
      ...modelValue
    } = result.value;
    return {
      ...result,
      value: modelValue,
    };
  }
  if (result.ok && result.toolName === 'checkPaymentStatus') {
    const {
      orderId: _serverOrderBinding,
      ...modelValue
    } = result.value;
    return {
      ...result,
      value: modelValue,
    };
  }
  if (result.toolName !== 'getOrderStatus') return result;
  if (!result.ok) {
    return {
      toolName: 'getOrderStatus',
      ok: false,
      errorCode: 'order_status_lookup_failed',
      message: 'order_status_lookup_failed',
      provenance: [],
    };
  }
  return {
    toolName: 'getOrderStatus',
    ok: true,
    value: {
      status: result.value.status,
      paymentStatus: result.value.paymentStatus,
      ...(result.value.posStatus
        ? { posStatus: result.value.posStatus }
        : {}),
    },
    message: 'order_status_observed',
    provenance: [],
  };
}
