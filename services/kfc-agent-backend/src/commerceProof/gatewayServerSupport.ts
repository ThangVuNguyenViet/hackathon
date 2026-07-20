import type { FastifyReply } from "fastify";
import { z } from "zod";
import type { Order } from "../domain/types.js";
import {
  commerceResultSchema,
  type CommerceCommand,
  type CommerceResult,
} from "./contracts.js";
import type { StoredCancellationMutation } from "./gatewayMutationContracts.js";

export const sandboxGatewayProvenance = [{
  fixtureMode: "provider_runtime" as const,
  sourceFile: "src/commerceProof/gatewayServer.ts" as const,
  sourceApi: "sandbox-commerce-gateway" as const,
}];

export function idempotencyConflict(reply: FastifyReply) {
  return reply.code(409).send({
    ok: false,
    errorCode: "provider_idempotency_conflict",
    message: "Provider idempotency key conflicts with another bound action",
    provenance: sandboxGatewayProvenance,
  });
}

export function cancellationCommerceResult(
  response: NonNullable<StoredCancellationMutation["result"]>,
): CommerceResult {
  const candidate: Record<string, unknown> = { ...response };
  delete candidate.ok;
  delete candidate.value;
  delete candidate.errorCode;
  delete candidate.message;
  delete candidate.provenance;
  return commerceResultSchema.parse(candidate);
}

export function fallbackAgentOrder(
  command: CommerceCommand,
  accepted: CommerceResult,
): Order {
  if (!accepted.commerceOrderId) {
    throw new Error("gateway_commerce_order_id_missing");
  }
  return {
    id: accepted.commerceOrderId,
    status: "created",
    paymentStatus: "pending",
    assignedStoreId: command.order.storeId,
    createdAt: new Date().toISOString(),
    cart: {
      id: command.order.previewId,
      items: command.order.items.map((item) => ({
        itemCode: item.itemCode,
        name: item.itemCode,
        quantity: item.quantity,
        unitPriceVnd: 0,
      })),
      subtotalVnd: command.order.totalVnd,
      discountVnd: 0,
      deliveryFeeVnd: 0,
      totalVnd: command.order.totalVnd,
      voucherCode: null,
    },
    commerceOrderId: accepted.commerceOrderId,
    omsOrderId: accepted.omsOrderId,
    posTicketId: accepted.posTicketId,
    posStatus: "accepted",
    commerceOutcome: accepted.outcome,
    commerceCustomerStatus: accepted.customerStatus,
    commerceEnvironment: "sandbox",
    commerceProviderProvenance: accepted.providerProvenance,
  };
}

export function customerOrderStatus(
  status: CommerceResult["customerStatus"],
): Order["status"] {
  return status === "preparing" || status === "ready"
    ? "preparing"
    : status === "cancelled" || status === "failed"
      ? "cancelled"
      : "created";
}

export function orderPosStatus(
  status: CommerceResult["posStatus"],
): Order["posStatus"] {
  return status === "accepted" ||
      status === "preparing" ||
      status === "ready" ||
      status === "cancelled" ||
      status === "rejected"
    ? status
    : undefined;
}

export function customerStatusForPos(
  status: CommerceResult["posStatus"],
): CommerceResult["customerStatus"] {
  if (status === "preparing") return "preparing";
  if (status === "ready") return "ready";
  if (status === "cancelled") return "cancelled";
  return status === "accepted" ? "accepted" : "failed";
}

export function providerStatusMatchesOutcome(
  outcome: CommerceResult["outcome"],
  omsStatus: CommerceResult["omsStatus"],
  posStatus: CommerceResult["posStatus"],
): boolean {
  if (outcome === "cancelled") {
    return omsStatus === "cancelled" && posStatus === "cancelled";
  }
  return (
    outcome === "accepted" &&
    omsStatus === "created" &&
    (
      posStatus === "accepted" ||
      posStatus === "preparing" ||
      posStatus === "ready"
    )
  );
}

export async function checkReadiness(
  dependency: { baseUrl: string; token: string },
  timeoutMs: number,
) {
  const startedAt = performance.now();
  try {
    const response = await fetch(
      `${dependency.baseUrl.replace(/\/$/, "")}/ready`,
      {
        headers: { authorization: `Bearer ${dependency.token}` },
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
    const payload = z.record(z.unknown()).parse(await response.json());
    const authenticated = response.status !== 401 && response.status !== 403;
    const ready = response.ok && payload.ok === true && authenticated;
    return {
      status: ready ? "ready" : "unavailable",
      required: true,
      configured: true,
      reachable: true,
      authenticated,
      commerceEnvironment: payload.commerceEnvironment === "sandbox"
        ? "sandbox"
        : "unavailable",
      providerImplementation:
        typeof payload.providerImplementation === "string"
          ? payload.providerImplementation
          : "unavailable",
      latencyMs: Math.round(performance.now() - startedAt),
      ...(ready
        ? {}
        : {
            message:
              `Dependency readiness returned HTTP ${response.status}`,
          }),
    };
  } catch (error) {
    return {
      status: "unavailable",
      required: true,
      configured: true,
      reachable: false,
      authenticated: false,
      commerceEnvironment: "unavailable",
      providerImplementation: "unavailable",
      latencyMs: Math.round(performance.now() - startedAt),
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
