import type { ToolResult } from "../domain/types.js";
import type { PosClient } from "./posTypes.js";

export interface HttpPosClientOptions {
  baseUrl: string;
  token: string;
  fetchImpl?: typeof fetch | undefined;
}

export function createHttpPosClient(options: HttpPosClientOptions): PosClient {
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;

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
      return (await response.json()) as ToolResult<T>;
    } catch (error) {
      return {
        ok: false,
        errorCode: "pos_unavailable",
        message: `POS request failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  return {
    submitOrder: ({ order, idempotencyKey }) =>
      request("/v1/tickets", {
        method: "POST",
        headers: { "idempotency-key": idempotencyKey },
        body: JSON.stringify({ order }),
      }),
    getTicket: (ticketId) =>
      request(`/v1/tickets/${encodeURIComponent(ticketId)}`),
    cancelTicket: (ticketId) =>
      request(`/v1/tickets/${encodeURIComponent(ticketId)}/cancel`, {
        method: "POST",
      }),
  };
}
