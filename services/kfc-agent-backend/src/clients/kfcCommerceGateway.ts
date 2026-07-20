import { z } from "zod";
import type {
  ExternalCallContext,
  OmsClient,
  PaymentClient,
  ProviderMutationIdentity,
} from "./interfaces.js";
import type { ToolResult } from "../domain/types.js";
import { opaqueProviderIdSchema } from "../domain/opaqueProviderId.js";
import {
  orderWithCurrentDeliveryEstimate,
} from "../domain/orderStatusEvidence.js";
import { commerceContractVersion, commerceResultSchema } from "../commerceProof/contracts.js";
import {
  providerOrderResultSchema,
  providerOrderStatusResultSchema,
  providerPaymentLinkResultSchema,
  providerPaymentMethodsResultSchema,
  providerPaymentStatusResultSchema,
  providerToolFailureSchema,
} from "../commerce/providerResponseSchemas.js";

export interface KfcCommerceGatewayOptions {
  baseUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
}

export interface KfcCommerceGatewayClients {
  oms: OmsClient;
  payment: PaymentClient;
}

function externalCallIsCancelled(context: ExternalCallContext): boolean {
  return context.signal.aborted || Date.now() >= context.deadlineAt;
}

function failureDetail(error: unknown): string {
  return error instanceof Error
    ? error.message
    : error === undefined
      ? "caller signal or deadline"
      : String(error);
}

function requestCancellationFailure<T>(error: unknown): ToolResult<T> {
  return {
    ok: false,
    errorCode: "commerce_gateway_request_cancelled",
    message: `KFC commerce gateway request was cancelled: ${failureDetail(error)}`,
  };
}

function mutationAmbiguityFailure<T>(error: unknown): ToolResult<T> {
  return {
    ok: false,
    errorCode: "commerce_gateway_mutation_ambiguous",
    message: `KFC commerce gateway mutation outcome is ambiguous after dispatch: ${failureDetail(error)}`,
  };
}

function invalidProviderResponseFailure<T>(error: unknown): ToolResult<T> {
  return {
    ok: false,
    errorCode: "commerce_gateway_invalid_provider_response",
    message: `KFC commerce gateway returned an invalid response: ${failureDetail(error)}`,
  };
}

function invalidOrderIdentifierFailure<T>(orderId: string): ToolResult<T> {
  return {
    ok: false,
    errorCode: "commerce_gateway_invalid_order_id",
    message:
      `KFC commerce gateway rejected unsafe order identifier ${JSON.stringify(orderId)}`,
  };
}

function providerMutationIdentityRequiredFailure<T>(): ToolResult<T> {
  return {
    ok: false,
    errorCode: "provider_mutation_identity_required",
    message: "A provider mutation identity is required",
  };
}

function providerMutationIdentityIsValid(
  identity: ProviderMutationIdentity | null | undefined,
): identity is ProviderMutationIdentity {
  return Boolean(
    identity &&
    typeof identity.idempotencyKey === "string" &&
    typeof identity.bindingFingerprint === "string" &&
    identity.idempotencyKey.length <= 512 &&
    opaqueProviderIdSchema.safeParse(identity.idempotencyKey).success &&
    /^[a-f0-9]{64}$/u.test(identity.bindingFingerprint),
  );
}

function orderIdentifierIsPathSafe(orderId: string): boolean {
  return orderId !== "." && orderId !== "..";
}

type ValidatedPayload<T> =
  | {
      ok: true;
      response: Response;
      payload: T;
    }
  | {
      ok: false;
      failure: ToolResult<never>;
    };

const versionedPlaceOrderResponseSchema = z.union([
  commerceResultSchema,
  providerToolFailureSchema,
]);

const cancellationResponseSchema = z.union([
  providerOrderResultSchema,
  commerceResultSchema,
]);

const orderStatusResponseSchema = z.union([
  providerOrderStatusResultSchema,
  commerceResultSchema,
]);

export function createKfcCommerceGatewayClients(
  options: KfcCommerceGatewayOptions,
): KfcCommerceGatewayClients {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl.replace(/\/$/, "");

  async function fetchValidated<T>(
    path: string,
    externalCallContext: ExternalCallContext,
    schema: z.ZodType<T>,
    init: RequestInit = {},
    mutation = false,
  ): Promise<ValidatedPayload<T>> {
    if (externalCallIsCancelled(externalCallContext)) {
      return {
        ok: false,
        failure: requestCancellationFailure(
          externalCallContext.signal.reason,
        ),
      };
    }
    try {
      const response = await fetchImpl(`${baseUrl}${path}`, {
        ...init,
        signal: externalCallContext.signal,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${options.token}`,
          ...(init.body ? { "content-type": "application/json" } : {}),
          ...init.headers,
        },
      });
      const payload: unknown = await response.json();
      const parsed = schema.safeParse(payload);
      if (!parsed.success) {
        return {
          ok: false,
          failure: mutation
            ? mutationAmbiguityFailure(parsed.error)
            : invalidProviderResponseFailure(parsed.error),
        };
      }
      return { ok: true, response, payload: parsed.data };
    } catch (error) {
      if (mutation) {
        return {
          ok: false,
          failure: mutationAmbiguityFailure(error),
        };
      }
      if (
        externalCallIsCancelled(externalCallContext) ||
        (error instanceof Error && error.name === "AbortError")
      ) {
        return {
          ok: false,
          failure: requestCancellationFailure(error),
        };
      }
      return {
        ok: false,
        failure: {
          ok: false,
          errorCode: "commerce_gateway_unavailable",
          message: `KFC commerce gateway request failed: ${error instanceof Error ? error.message : String(error)}`,
        },
      };
    }
  }

  async function request<T>(
    path: string,
    externalCallContext: ExternalCallContext,
    schema: z.ZodType<ToolResult<T>>,
    init: RequestInit = {},
    mutation = false,
  ): Promise<ToolResult<T>> {
    const validated = await fetchValidated(
      path,
      externalCallContext,
      schema,
      init,
      mutation,
    );
    if (!validated.ok) return validated.failure;
    if (!validated.response.ok && validated.payload.ok) {
      return mutation
        ? mutationAmbiguityFailure(
            new Error(
              `Gateway returned HTTP ${validated.response.status} with a success body`,
            ),
          )
        : {
            ok: false,
            errorCode: "commerce_gateway_http_error",
            message: `KFC commerce gateway returned HTTP ${validated.response.status}`,
          };
    }
    return validated.payload;
  }

  return {
    oms: {
      previewOrder: (input, externalCallContext) =>
        request(
          "/v1/orders/preview",
          externalCallContext,
          providerOrderResultSchema,
          {
            method: "POST",
            body: JSON.stringify(input),
          },
        ),
      async placeOrder(input, externalCallContext, mutationIdentity) {
        if (!input.userConfirmed) {
          return {
            ok: false,
            errorCode: "confirmation_required",
            message: "User confirmation is required before order placement",
          };
        }
        if (!providerMutationIdentityIsValid(mutationIdentity)) {
          return providerMutationIdentityRequiredFailure();
        }
        if (!input.context) {
          return {
            ok: false,
            errorCode:
              "commerce_gateway_mutation_identity_context_missing",
            message:
              "Provider mutation identity requires the bound commerce request context",
          };
        }
        const validated = await fetchValidated(
          "/v1/orders",
          externalCallContext,
          versionedPlaceOrderResponseSchema,
          {
            method: "POST",
            body: JSON.stringify({
              contractVersion: commerceContractVersion,
              traceId: input.context.traceId,
              scenarioId: input.context.scenarioId,
              sessionId: input.context.sessionId,
              clientMessageId: input.context.clientMessageId,
              idempotencyKey: mutationIdentity.idempotencyKey,
              bindingFingerprint: mutationIdentity.bindingFingerprint,
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
          },
          true,
        );
        if (!validated.ok) return validated.failure;
        const response = validated.payload;
        if ("ok" in response) {
          return {
            ok: false,
            errorCode: response.errorCode,
            message: response.message,
          };
        }
        const commerce = response;
        if (
          !validated.response.ok &&
          commerce.customerStatus !== "failed"
        ) {
          return mutationAmbiguityFailure(
            new Error(
              `Gateway returned HTTP ${validated.response.status} with an accepted commerce result`,
            ),
          );
        }
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
            commerceEnvironment: commerce.commerceEnvironment,
            commerceProviderProvenance: commerce.providerProvenance,
          },
          message: `commerce_order_${commerce.customerStatus}`,
        };
      },
      async getOrderStatus(orderId, externalCallContext) {
        if (!orderIdentifierIsPathSafe(orderId)) {
          return invalidOrderIdentifierFailure(orderId);
        }
        const validated = await fetchValidated(
          `/v1/orders/${encodeURIComponent(orderId)}`,
          externalCallContext,
          orderStatusResponseSchema,
        );
        if (!validated.ok) return validated.failure;
        if ("ok" in validated.payload) {
          if (
            !validated.response.ok &&
            validated.payload.ok
          ) {
            return {
              ok: false,
              errorCode: "commerce_gateway_http_error",
              message: `KFC commerce gateway returned HTTP ${validated.response.status}`,
            };
          }
          if (!validated.payload.ok || !validated.payload.value) {
            return validated.payload;
          }
          const order = orderWithCurrentDeliveryEstimate(
            validated.payload.value,
          );
          if (!order) {
            return invalidProviderResponseFailure(
              new Error("Order status response did not contain an order"),
            );
          }
          return {
            ...validated.payload,
            value: order,
          };
        }
        return {
          ok: false,
          errorCode: validated.payload.outcome,
          message: `Commerce status read failed: ${validated.payload.outcome}`,
        };
      },
      async cancelOrder(
        orderId,
        externalCallContext,
        mutationIdentity,
      ) {
        if (!providerMutationIdentityIsValid(mutationIdentity)) {
          return providerMutationIdentityRequiredFailure();
        }
        if (!orderIdentifierIsPathSafe(orderId)) {
          return invalidOrderIdentifierFailure(orderId);
        }
        const validated = await fetchValidated(
          `/v1/orders/${encodeURIComponent(orderId)}/cancel`,
          externalCallContext,
          cancellationResponseSchema,
          {
            method: "POST",
            body: JSON.stringify({
              idempotencyKey: mutationIdentity.idempotencyKey,
              bindingFingerprint: mutationIdentity.bindingFingerprint,
            }),
          },
          true,
        );
        if (!validated.ok) return validated.failure;
        if ("ok" in validated.payload) {
          if (
            !validated.response.ok &&
            validated.payload.ok
          ) {
            return mutationAmbiguityFailure(
              new Error(
                `Gateway returned HTTP ${validated.response.status} with a successful cancellation body`,
              ),
            );
          }
          return validated.payload;
        }
        if (
          validated.payload.outcome === "partial_cancellation" ||
          validated.payload.customerStatus === "failed"
        ) {
          return {
            ok: false,
            errorCode: validated.payload.outcome,
            message: `Commerce cancellation failed: ${validated.payload.outcome}`,
          };
        }
        return mutationAmbiguityFailure(
          new Error("Cancellation response omitted the cancelled order"),
        );
      },
    },
    payment: {
      listMethods: (input, externalCallContext) => {
        const query = new URLSearchParams();
        if (input.query) query.set("query", input.query);
        if (input.paymentSurface)
          query.set("paymentSurface", input.paymentSurface);
        return request(
          `/v1/payment-methods${query.size > 0 ? `?${query}` : ""}`,
          externalCallContext,
          providerPaymentMethodsResultSchema,
        );
      },
      createPaymentLink: (
        order,
        methodId,
        externalCallContext,
        mutationIdentity,
      ) => {
        if (!mutationIdentity) {
          return Promise.resolve(
            providerMutationIdentityRequiredFailure(),
          );
        }
        if (!orderIdentifierIsPathSafe(order.id)) {
          return Promise.resolve(invalidOrderIdentifierFailure(order.id));
        }
        return request(
          `/v1/orders/${encodeURIComponent(order.id)}/payment-links`,
          externalCallContext,
          providerPaymentLinkResultSchema,
          {
            method: "POST",
            body: JSON.stringify({
              methodId,
              idempotencyKey: mutationIdentity.idempotencyKey,
              bindingFingerprint: mutationIdentity.bindingFingerprint,
            }),
          },
          true,
        );
      },
      checkPaymentStatus: (orderId, externalCallContext) => {
        if (!orderIdentifierIsPathSafe(orderId)) {
          return Promise.resolve(invalidOrderIdentifierFailure(orderId));
        }
        return request(
          `/v1/orders/${encodeURIComponent(orderId)}/payment-status`,
          externalCallContext,
          providerPaymentStatusResultSchema,
        );
      },
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
