import { z } from "zod";
import type { ProviderMutationIdentity } from "../clients/interfaces.js";
import { opaqueProviderIdSchema } from "../domain/opaqueProviderId.js";
import { commerceContractVersion, omsStatusSchema, posStatusSchema } from "./contracts.js";

const omsResponseSchema = z.object({
  contractVersion: z.literal(commerceContractVersion),
  traceId: z.string(),
  scenarioId: z.string(),
  commerceOrderId: z.string(),
  omsOrderId: z.string(),
  omsStatus: omsStatusSchema,
  commerceEnvironment: z.literal("sandbox"),
  providerImplementation: z.literal("http-adapter"),
});

const posResponseSchema = z.object({
  contractVersion: z.literal(commerceContractVersion),
  traceId: z.string(),
  scenarioId: z.string(),
  commerceOrderId: z.string(),
  omsOrderId: z.string(),
  posTicketId: z.string(),
  posStatus: posStatusSchema,
  commerceEnvironment: z.literal("sandbox"),
  providerImplementation: z.literal("http-adapter"),
});

const failureSchema = z.object({
  errorCode: z.string(),
  message: z.string(),
  traceId: z.string().optional(),
  scenarioId: z.string().optional(),
  commerceOrderId: z.string().optional(),
  omsOrderId: z.string().optional(),
  posTicketId: z.string().optional(),
  omsStatus: omsStatusSchema.optional(),
  posStatus: posStatusSchema.optional(),
});

const providerMutationIdentitySchema = z.object({
  idempotencyKey: opaqueProviderIdSchema.refine(
    (value) => value.length <= 512,
    { message: "Provider mutation key exceeds the protocol limit" },
  ),
  bindingFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();
const providerRuntimeIdentityBase = {
  ok: z.literal(true),
  status: z.literal("ready"),
  configured: z.literal(true),
  reachable: z.literal(true),
  authenticated: z.literal(true),
  commerceEnvironment: z.literal("sandbox"),
  providerImplementation: z.literal("http-adapter"),
  instanceId: opaqueProviderIdSchema,
};
const omsRuntimeIdentitySchema = z.object({
  ...providerRuntimeIdentityBase,
  service: z.literal("mock-oms"),
}).strict();
const posRuntimeIdentitySchema = z.object({
  ...providerRuntimeIdentityBase,
  service: z.literal("mock-pos"),
}).strict();

export type OmsResponse = z.infer<typeof omsResponseSchema>;
export type PosResponse = z.infer<typeof posResponseSchema>;
type ProviderFailure = z.infer<typeof failureSchema>;

export type HttpClientResult<T> =
  | { ok: true; value: T; status: number }
  | {
      ok: false;
      status: number;
      errorCode: string;
      message: string;
      timedOut: boolean;
      omsStatus?: z.infer<typeof omsStatusSchema>;
      posStatus?: z.infer<typeof posStatusSchema>;
    };

interface ClientOptions {
  baseUrl: string;
  token: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

interface OmsCancellationContext {
  traceId: string;
  scenarioId: string;
  commerceOrderId: string;
}

interface PosCancellationContext extends OmsCancellationContext {
  omsOrderId: string;
}

export function createCommerceProofOmsClient(options: ClientOptions) {
  const request = createRequest(options);
  return {
    getRuntimeIdentity: () =>
      request("/ready", omsRuntimeIdentitySchema),
    createOrder: (
      input: Record<string, unknown>,
      identity: ProviderMutationIdentity,
    ) =>
      mutationRequest(request, identity, "/v1/orders", omsResponseSchema, () => ({
        method: "POST",
        headers: downstreamHeaders(input, identity),
        body: JSON.stringify(input),
      }), {
        success: (response) =>
          response.traceId === input.traceId &&
          response.scenarioId === input.scenarioId &&
          response.commerceOrderId === input.commerceOrderId &&
          response.omsStatus === "created",
      }),
    getOrder: (omsOrderId: string, traceId: string) =>
      request(`/v1/orders/${encodeURIComponent(omsOrderId)}`, omsResponseSchema, {
        headers: { "x-trace-id": traceId },
      }),
    cancelOrder: (
      omsOrderId: string,
      input: OmsCancellationContext,
      identity: ProviderMutationIdentity,
    ) =>
      mutationRequest(
        request,
        identity,
        `/v1/orders/${encodeURIComponent(omsOrderId)}/cancel`,
        omsResponseSchema,
        () => ({
          method: "POST",
          headers: downstreamHeaders(input, identity),
          body: JSON.stringify(input),
        }),
        {
          success: (response) =>
            response.traceId === input.traceId &&
            response.scenarioId === input.scenarioId &&
            response.commerceOrderId === input.commerceOrderId &&
            response.omsOrderId === omsOrderId &&
            response.omsStatus === "cancelled",
          failure: (failure) =>
            correlatedOmsCancellationFailure(
              failure,
              input,
              omsOrderId,
            ),
        },
      ),
  };
}

export function createCommerceProofPosClient(options: ClientOptions) {
  const request = createRequest(options);
  return {
    getRuntimeIdentity: () =>
      request("/ready", posRuntimeIdentitySchema),
    submitTicket: (
      input: Record<string, unknown>,
      identity: ProviderMutationIdentity,
    ) =>
      mutationRequest(request, identity, "/v1/tickets", posResponseSchema, () => ({
        method: "POST",
        headers: downstreamHeaders(input, identity),
        body: JSON.stringify(input),
      }), {
        success: (response) =>
          response.traceId === input.traceId &&
          response.scenarioId === input.scenarioId &&
          response.commerceOrderId === input.commerceOrderId &&
          response.omsOrderId === input.omsOrderId &&
          response.posStatus === "accepted",
        failure: (failure) =>
          correlatedPosSubmissionFailure(failure, input),
      }),
    getTicket: (posTicketId: string, traceId: string) =>
      request(`/v1/tickets/${encodeURIComponent(posTicketId)}`, posResponseSchema, {
        headers: { "x-trace-id": traceId },
      }),
    cancelTicket: (
      posTicketId: string,
      input: PosCancellationContext,
      identity: ProviderMutationIdentity,
    ) =>
      mutationRequest(
        request,
        identity,
        `/v1/tickets/${encodeURIComponent(posTicketId)}/cancel`,
        posResponseSchema,
        () => ({
          method: "POST",
          headers: downstreamHeaders(input, identity),
          body: JSON.stringify(input),
        }),
        {
          success: (response) =>
            response.traceId === input.traceId &&
            response.scenarioId === input.scenarioId &&
            response.commerceOrderId === input.commerceOrderId &&
            response.omsOrderId === input.omsOrderId &&
            response.posTicketId === posTicketId &&
            response.posStatus === "cancelled",
          failure: (failure) =>
            correlatedPosCancellationFailure(
              failure,
              input,
              posTicketId,
            ),
        },
      ),
  };
}

interface ResponseBinding<T> {
  success(value: T): boolean;
  failure?(failure: ProviderFailure): boolean;
}

type Request = ReturnType<typeof createRequest>;

function mutationRequest<T>(
  request: Request,
  identity: ProviderMutationIdentity,
  path: string,
  schema: z.ZodType<T>,
  createInit: () => RequestInit,
  binding: ResponseBinding<T>,
): Promise<HttpClientResult<T>> {
  if (!providerMutationIdentitySchema.safeParse(identity).success) {
    return Promise.resolve({
      ok: false,
      status: 400,
      errorCode: "provider_mutation_identity_required",
      message: "An exact provider mutation identity is required",
      timedOut: false,
    });
  }
  return request(path, schema, createInit(), binding);
}

function createRequest(options: ClientOptions) {
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;

  return async function request<T>(
    path: string,
    schema: z.ZodType<T>,
    init: RequestInit = {},
    binding?: ResponseBinding<T>,
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
      if (response.status === 408) {
        const failure = failureSchema.safeParse(payload);
        return {
          ok: false,
          status: 504,
          errorCode: "downstream_timeout",
          message: failure.success
            ? failure.data.message
            : "Downstream mutation timed out",
          timedOut: true,
        };
      }
      if (!response.ok) {
        const failure = failureSchema.safeParse(payload);
        if (
          response.status < 500 &&
          binding &&
          (
            !failure.success ||
            (binding.failure && !binding.failure(failure.data))
          )
        ) {
          return responseBindingMismatch();
        }
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
      if (binding && !binding.success(parsed.data)) {
        return responseBindingMismatch();
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

function downstreamHeaders(
  input: { traceId?: unknown },
  identity: ProviderMutationIdentity,
) {
  return {
    "idempotency-key": identity.idempotencyKey,
    "x-provider-binding-fingerprint": identity.bindingFingerprint,
    "x-trace-id": String(input.traceId ?? ""),
  };
}

function responseBindingMismatch<T>(): HttpClientResult<T> {
  return {
    ok: false,
    status: 502,
    errorCode: "downstream_response_binding_mismatch",
    message: "Downstream response did not match the exact requested mutation",
    timedOut: false,
  };
}

function correlatedOmsFailure(
  failure: ProviderFailure,
  expected: OmsCancellationContext,
  omsOrderId: string,
): boolean {
  return (
    failure.traceId === expected.traceId &&
    failure.scenarioId === expected.scenarioId &&
    failure.commerceOrderId === expected.commerceOrderId &&
    failure.omsOrderId === omsOrderId
  );
}

function correlatedOmsCancellationFailure(
  failure: ProviderFailure,
  expected: OmsCancellationContext,
  omsOrderId: string,
): boolean {
  if (failure.errorCode === "oms_cancellation_failed") {
    return (
      failure.omsStatus === "cancellation_failed" &&
      correlatedOmsFailure(failure, expected, omsOrderId)
    );
  }
  return failure.omsStatus === undefined;
}

function correlatedPosFailure(
  failure: ProviderFailure,
  expected: {
    traceId?: unknown;
    scenarioId?: unknown;
    commerceOrderId?: unknown;
    omsOrderId?: unknown;
  },
  posTicketId?: string,
): boolean {
  return (
    failure.traceId === expected.traceId &&
    failure.scenarioId === expected.scenarioId &&
    failure.commerceOrderId === expected.commerceOrderId &&
    failure.omsOrderId === expected.omsOrderId &&
    (posTicketId === undefined || failure.posTicketId === posTicketId)
  );
}

function correlatedPosSubmissionFailure(
  failure: ProviderFailure,
  expected: {
    traceId?: unknown;
    scenarioId?: unknown;
    commerceOrderId?: unknown;
    omsOrderId?: unknown;
  },
): boolean {
  if (failure.errorCode === "pos_order_rejected") {
    return (
      failure.posStatus === "rejected" &&
      correlatedPosFailure(failure, expected)
    );
  }
  return failure.posStatus === undefined;
}

function correlatedPosCancellationFailure(
  failure: ProviderFailure,
  expected: PosCancellationContext,
  posTicketId: string,
): boolean {
  if (failure.errorCode === "pos_cancellation_failed") {
    return (
      failure.posStatus === "cancellation_failed" &&
      correlatedPosFailure(failure, expected, posTicketId)
    );
  }
  return failure.posStatus === undefined;
}
