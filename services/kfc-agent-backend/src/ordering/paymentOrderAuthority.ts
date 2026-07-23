import type { Order, ToolResult } from '../domain/types.js';
import type { PaymentAttempt } from './types.js';

export function paymentAttemptMatchesOrder(
  paymentAttempt: PaymentAttempt | undefined,
  order: Pick<Order, 'id'> | undefined,
): boolean {
  return Boolean(
    paymentAttempt?.orderId &&
    order?.id &&
    paymentAttempt.orderId === order.id,
  );
}

export function paymentAttemptForVerifiedOrder(
  paymentAttempt: PaymentAttempt | undefined,
  order: Pick<Order, 'id'> | undefined,
): PaymentAttempt | undefined {
  return paymentAttemptMatchesOrder(paymentAttempt, order)
    ? paymentAttempt
    : undefined;
}

export function paymentOrderIdentifierMatches(
  order: Order | undefined,
  orderId: string,
): order is Order {
  return Boolean(
    order &&
    [order.id, order.commerceOrderId, order.omsOrderId].includes(orderId),
  );
}

export function paymentOrderIsCreated(
  order: Order | undefined,
): order is Order {
  return order?.status === 'created';
}

export function bindProviderPaymentResultToOrder<Value extends object>(
  response: ToolResult<Value>,
  orderId: string,
): ToolResult<Value & { orderId: string }> {
  if (!response.ok || response.value === undefined) {
    return {
      ok: false,
      errorCode: response.errorCode,
      message: response.message,
      provenance: response.provenance,
    };
  }
  return {
    ...response,
    value: {
      ...response.value,
      orderId,
    },
  };
}
