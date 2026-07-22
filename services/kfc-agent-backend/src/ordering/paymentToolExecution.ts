import type {
  ExternalCallContext,
  ExternalClients,
  ProviderMutationIdentity,
} from '../clients/interfaces.js';
import type { Order } from '../domain/types.js';
import {
  bindProviderPaymentResultToOrder,
  paymentOrderIdentifierMatches,
  paymentOrderIsCreated,
} from './paymentOrderAuthority.js';
import { toolArgumentSchemas } from './toolCatalog.js';
import { result, resultFromToolResult } from './toolExecutionResult.js';
import type { ToolCallRequest, ToolCallResult } from './types.js';

interface PaymentToolExecutionContext {
  externalCallContext: ExternalCallContext;
  providerMutationIdentity?: ProviderMutationIdentity;
}

export async function executePaymentToolCall(
  clients: ExternalClients,
  request: ToolCallRequest,
  context: PaymentToolExecutionContext,
  order: Order | undefined,
): Promise<ToolCallResult> {
  switch (request.toolName) {
    case 'createPaymentLink': {
      const args = toolArgumentSchemas.createPaymentLink.parse(
        request.arguments,
      );
      if (!order) {
        return result(
          request,
          false,
          undefined,
          'Order is required before createPaymentLink',
          'order_required',
        );
      }
      if (!paymentOrderIsCreated(order)) {
        return result(
          request,
          false,
          undefined,
          'Created order is required before createPaymentLink',
          'created_order_required',
        );
      }
      return resultFromToolResult(
        request.toolName,
        bindProviderPaymentResultToOrder(
          await clients.payment.createPaymentLink(
            order,
            args.methodId,
            context.externalCallContext,
            context.providerMutationIdentity!,
          ),
          order.id,
        ),
      );
    }
    case 'checkPaymentStatus': {
      const args = toolArgumentSchemas.checkPaymentStatus.parse(
        request.arguments,
      );
      if (!paymentOrderIdentifierMatches(order, args.orderId)) {
        return result(
          request,
          false,
          undefined,
          'Order ownership could not be verified',
          'order_access_unverified',
        );
      }
      return resultFromToolResult(
        request.toolName,
        bindProviderPaymentResultToOrder(
          await clients.payment.checkPaymentStatus(
            args.orderId,
            context.externalCallContext,
          ),
          order.id,
        ),
      );
    }
    default:
      throw new Error('payment_tool_execution_name_invalid');
  }
}
