import type { OmsClient, PaymentClient } from "./interfaces.js";
import type { ToolResult } from "../domain/types.js";
import { commerceContractVersion, commerceResultSchema } from "../commerceProof/contracts.js";

export interface KfcCommerceGatewayOptions {
  baseUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
}

export interface KfcCommerceGatewayClients {
  oms: OmsClient;
  payment: PaymentClient;
}

export function createKfcCommerceGatewayClients(
  options: KfcCommerceGatewayOptions,
): KfcCommerceGatewayClients {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl.replace(/\/$/, "");

  async function request<T>(
    path: string,
    init: RequestInit = {},
  ): Promise<ToolResult<T>> {
    try {
      const response = await fetchImpl(`${baseUrl}${path}`, {
        ...init,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${options.token}`,
          ...(init.body ? { "content-type": "application/json" } : {}),
          ...init.headers,
        },
      });
      const payload = (await response.json()) as ToolResult<T>;
      if (!response.ok && payload.ok) {
        return {
          ok: false,
          errorCode: "commerce_gateway_http_error",
          message: `KFC commerce gateway returned HTTP ${response.status}`,
        };
      }
      return payload;
    } catch (error) {
      return {
        ok: false,
        errorCode: "commerce_gateway_unavailable",
        message: `KFC commerce gateway request failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  return {
    oms: {
      previewOrder: (input) =>
        request("/v1/orders/preview", {
          method: "POST",
          body: JSON.stringify(input),
        }),
      async placeOrder(input) {
        if (!input.userConfirmed) {
          return {
            ok: false,
            errorCode: "confirmation_required",
            message: "User confirmation is required before order placement",
          };
        }
        if (!input.context) {
          return request("/v1/orders", {
            method: "POST",
            body: JSON.stringify(input),
          });
        }
        const response = await request<unknown>("/v1/orders", {
          method: "POST",
          body: JSON.stringify({
            contractVersion: commerceContractVersion,
            traceId: input.context.traceId,
            scenarioId: input.context.scenarioId,
            sessionId: input.context.sessionId,
            clientMessageId: input.context.clientMessageId,
            idempotencyKey: `${input.context.sessionId}:${input.context.clientMessageId}:placeOrder`,
            toolName: "placeOrder",
            order: {
              previewId: input.preview.id,
              storeId: input.preview.assignedStoreId,
              items: input.preview.cart.items.map((item) => ({
                itemCode: item.itemCode,
                quantity: item.quantity,
              })),
              totalVnd: input.preview.cart.totalVnd,
              paymentMethod: "cash",
              userConfirmed: true,
            },
          }),
        });
        const parsed = commerceResultSchema.safeParse(response);
        if (!parsed.success) {
          return {
            ok: false,
            errorCode: "invalid_commerce_gateway_response",
            message: parsed.error.message,
          };
        }
        const commerce = parsed.data;
        if (commerce.customerStatus === "failed" || !commerce.commerceOrderId) {
          return {
            ok: false,
            errorCode: commerce.outcome,
            message: `Commerce order failed: ${commerce.outcome}`,
          };
        }
        return {
          ok: true,
          value: {
            ...input.preview,
            id: commerce.commerceOrderId,
            status:
              commerce.customerStatus === "cancelled"
                ? "cancelled"
                : commerce.customerStatus === "preparing" || commerce.customerStatus === "ready"
                  ? "preparing"
                  : "created",
            posTicketId: commerce.posTicketId,
            posStatus: orderPosStatus(commerce.posStatus),
            commerceOrderId: commerce.commerceOrderId,
            omsOrderId: commerce.omsOrderId,
            commerceOutcome: commerce.outcome,
            commerceCustomerStatus: commerce.customerStatus,
            commerceSimulated: commerce.simulated.gateway && commerce.simulated.oms && commerce.simulated.pos,
          },
          message: `commerce_order_${commerce.customerStatus}`,
        };
      },
      getOrderStatus: (orderId) =>
        request(`/v1/orders/${encodeURIComponent(orderId)}`),
      cancelOrder: (orderId) =>
        request(`/v1/orders/${encodeURIComponent(orderId)}/cancel`, {
          method: "POST",
        }),
    },
    payment: {
      listMethods: (input) => {
        const query = new URLSearchParams();
        if (input.query) query.set("query", input.query);
        if (input.paymentSurface)
          query.set("paymentSurface", input.paymentSurface);
        return request(
          `/v1/payment-methods${query.size > 0 ? `?${query}` : ""}`,
        );
      },
      createPaymentLink: (order, method) =>
        request(`/v1/orders/${encodeURIComponent(order.id)}/payment-links`, {
          method: "POST",
          body: JSON.stringify({ method }),
        }),
      checkPaymentStatus: (orderId) =>
        request(`/v1/orders/${encodeURIComponent(orderId)}/payment-status`),
    },
  };
}

function orderPosStatus(
  status: string | undefined,
): "accepted" | "preparing" | "ready" | "cancelled" | "rejected" | undefined {
  return status === "accepted" ||
    status === "preparing" ||
    status === "ready" ||
    status === "cancelled" ||
    status === "rejected"
    ? status
    : undefined;
}
