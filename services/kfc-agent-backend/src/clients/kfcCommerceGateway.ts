import type { OmsClient, PaymentClient } from "./interfaces.js";
import type { ToolResult } from "../domain/types.js";

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
      placeOrder(input) {
        if (!input.userConfirmed) {
          return Promise.resolve({
            ok: false,
            errorCode: "confirmation_required",
            message: "User confirmation is required before order placement",
          });
        }
        return request("/v1/orders", {
          method: "POST",
          body: JSON.stringify(input),
        });
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
