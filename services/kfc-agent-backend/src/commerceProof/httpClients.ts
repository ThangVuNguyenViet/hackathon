import { z } from "zod";
import { commerceContractVersion, omsStatusSchema, posStatusSchema } from "./contracts.js";

const omsResponseSchema = z.object({
  contractVersion: z.literal(commerceContractVersion),
  traceId: z.string(),
  scenarioId: z.string(),
  commerceOrderId: z.string(),
  omsOrderId: z.string(),
  omsStatus: omsStatusSchema,
  simulated: z.literal(true),
});

const posResponseSchema = z.object({
  contractVersion: z.literal(commerceContractVersion),
  traceId: z.string(),
  scenarioId: z.string(),
  commerceOrderId: z.string(),
  omsOrderId: z.string(),
  posTicketId: z.string(),
  posStatus: posStatusSchema,
  simulated: z.literal(true),
});

const failureSchema = z.object({
  errorCode: z.string(),
  message: z.string(),
  omsStatus: omsStatusSchema.optional(),
  posStatus: posStatusSchema.optional(),
});

export type OmsResponse = z.infer<typeof omsResponseSchema>;
export type PosResponse = z.infer<typeof posResponseSchema>;

export type HttpClientResult<T> =
  | { ok: true; value: T; status: number }
  | {
      ok: false;
      status: number;
      errorCode: string;
      message: string;
      timedOut: boolean;
      omsStatus?: z.infer<typeof omsStatusSchema> | undefined;
      posStatus?: z.infer<typeof posStatusSchema> | undefined;
    };

interface ClientOptions {
  baseUrl: string;
  token: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch | undefined;
}

export function createCommerceProofOmsClient(options: ClientOptions) {
  const request = createRequest(options);
  return {
    createOrder: (input: Record<string, unknown>, idempotencyKey: string) =>
      request("/v1/orders", omsResponseSchema, {
        method: "POST",
        headers: downstreamHeaders(input, idempotencyKey),
        body: JSON.stringify(input),
      }),
    getOrder: (omsOrderId: string, traceId: string) =>
      request(`/v1/orders/${encodeURIComponent(omsOrderId)}`, omsResponseSchema, {
        headers: { "x-trace-id": traceId },
      }),
    cancelOrder: (
      omsOrderId: string,
      input: { traceId: string; scenarioId: string },
    ) =>
      request(`/v1/orders/${encodeURIComponent(omsOrderId)}/cancel`, omsResponseSchema, {
        method: "POST",
        headers: { "x-trace-id": input.traceId },
        body: JSON.stringify(input),
      }),
  };
}

export function createCommerceProofPosClient(options: ClientOptions) {
  const request = createRequest(options);
  return {
    submitTicket: (input: Record<string, unknown>, idempotencyKey: string) =>
      request("/v1/tickets", posResponseSchema, {
        method: "POST",
        headers: downstreamHeaders(input, idempotencyKey),
        body: JSON.stringify(input),
      }),
    getTicket: (posTicketId: string, traceId: string) =>
      request(`/v1/tickets/${encodeURIComponent(posTicketId)}`, posResponseSchema, {
        headers: { "x-trace-id": traceId },
      }),
    cancelTicket: (
      posTicketId: string,
      input: { traceId: string; scenarioId: string },
    ) =>
      request(`/v1/tickets/${encodeURIComponent(posTicketId)}/cancel`, posResponseSchema, {
        method: "POST",
        headers: { "x-trace-id": input.traceId },
        body: JSON.stringify(input),
      }),
  };
}

function createRequest(options: ClientOptions) {
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;

  return async function request<T>(
    path: string,
    schema: z.ZodType<T>,
    init: RequestInit = {},
  ): Promise<HttpClientResult<T>> {
    try {
      const response = await fetchImpl(`${baseUrl}${path}`, {
        ...init,
        signal: AbortSignal.timeout(options.timeoutMs),
        headers: {
          accept: "application/json",
          authorization: `Bearer ${options.token}`,
          ...(init.body ? { "content-type": "application/json" } : {}),
          ...init.headers,
        },
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const failure = failureSchema.safeParse(payload);
        return {
          ok: false,
          status: response.status,
          errorCode: failure.success ? failure.data.errorCode : "invalid_downstream_error",
          message: failure.success ? failure.data.message : "Downstream returned an invalid error payload",
          timedOut: false,
          ...(failure.success ? failure.data : {}),
        };
      }
      const parsed = schema.safeParse(payload);
      if (!parsed.success) {
        return {
          ok: false,
          status: 502,
          errorCode: "invalid_downstream_response",
          message: parsed.error.message,
          timedOut: false,
        };
      }
      return { ok: true, value: parsed.data, status: response.status };
    } catch (error) {
      const timedOut =
        error instanceof Error &&
        (error.name === "TimeoutError" || error.name === "AbortError");
      return {
        ok: false,
        status: timedOut ? 504 : 503,
        errorCode: timedOut ? "downstream_timeout" : "downstream_unavailable",
        message: error instanceof Error ? error.message : String(error),
        timedOut,
      };
    }
  };
}

function downstreamHeaders(input: Record<string, unknown>, idempotencyKey: string) {
  return {
    "idempotency-key": idempotencyKey,
    "x-trace-id": String(input["traceId"] ?? ""),
  };
}
