import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import {
  commerceCommandSchema,
  commerceContractVersion,
  commerceResultSchema,
  type CommerceResult,
} from "./contracts.js";
import {
  createCommerceProofOmsClient,
  createCommerceProofPosClient,
} from "./httpClients.js";

export interface CommerceProofGatewayServerOptions {
  token: string;
  oms: { baseUrl: string; token: string };
  pos: { baseUrl: string; token: string };
  timeoutMs?: number | undefined;
  onResult?: ((result: CommerceResult) => void) | undefined;
}

const cancellationSchema = z.object({
  traceId: z.string().min(1),
  scenarioId: z.string().min(1),
});

const previewSchema = z.object({
  cart: z.object({
    id: z.string().min(1),
    items: z.array(
      z.object({
        itemCode: z.string().min(1),
        name: z.string(),
        quantity: z.number().int().positive(),
        unitPriceVnd: z.number().int().nonnegative(),
      }).passthrough(),
    ),
    subtotalVnd: z.number().int().nonnegative(),
    discountVnd: z.number().int().nonnegative(),
    deliveryFeeVnd: z.number().int().nonnegative(),
    totalVnd: z.number().int().nonnegative(),
    voucherCode: z.string().nullable(),
  }).passthrough(),
  address: z.record(z.unknown()),
  storeId: z.string().min(1),
});

export function buildCommerceProofGatewayServer(
  options: CommerceProofGatewayServerOptions,
): FastifyInstance {
  const server = Fastify({ logger: false });
  const timeoutMs = options.timeoutMs ?? 3000;
  const oms = createCommerceProofOmsClient({ ...options.oms, timeoutMs });
  const pos = createCommerceProofPosClient({ ...options.pos, timeoutMs });
  const resultByIdempotencyKey = new Map<string, CommerceResult>();
  const resultByCommerceOrderId = new Map<string, CommerceResult>();
  let commerceSequence = 0;
  let previewSequence = 0;

  server.addHook("onRequest", async (request, reply) => {
    if (request.url === "/health") return;
    if (request.headers.authorization !== `Bearer ${options.token}`) {
      return reply.code(401).send({
        ok: false,
        errorCode: "gateway_unauthorized",
        message: "Invalid Demo Commerce Gateway token",
      });
    }
  });

  server.get("/health", async () => ({
    ok: true,
    service: "demo-commerce-gateway",
    version: "1",
    contractVersion: commerceContractVersion,
    dependencyClass: "simulated",
    timestamp: new Date().toISOString(),
  }));

  server.get("/ready", async (_request, reply) => {
    const [omsCheck, posCheck] = await Promise.all([
      checkReadiness(options.oms, timeoutMs),
      checkReadiness(options.pos, timeoutMs),
    ]);
    const ok = omsCheck.status === "ready" && posCheck.status === "ready";
    return reply.code(ok ? 200 : 503).send({
      ok,
      service: "demo-commerce-gateway",
      status: ok ? "ready" : "unavailable",
      configured: true,
      reachable: true,
      authenticated: true,
      dependencyClass: "simulated",
      checks: { oms: omsCheck, pos: posCheck },
      timestamp: new Date().toISOString(),
    });
  });

  server.post("/v1/orders/preview", async (request, reply) => {
    const parsed = previewSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        errorCode: "invalid_order_preview",
        message: parsed.error.message,
      });
    }
    return {
      ok: true,
      value: {
        id: `PREVIEW-${String(++previewSequence).padStart(4, "0")}`,
        status: "previewed",
        paymentStatus: "pending",
        assignedStoreId: parsed.data.storeId,
        createdAt: new Date().toISOString(),
        cart: parsed.data.cart,
      },
      message: "order_previewed",
    };
  });

  server.post("/v1/orders", async (request, reply) => {
    const parsed = commerceCommandSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        errorCode: "invalid_commerce_command",
        message: parsed.error.message,
      });
    }
    const command = parsed.data;
    const existing = resultByIdempotencyKey.get(command.idempotencyKey);
    if (existing) {
      const duplicate = commerceResultSchema.parse({
        ...existing,
        traceId: command.traceId,
        scenarioId: command.scenarioId,
        outcome: "deduplicated",
        deduplicated: true,
        originalTraceId: existing.traceId,
      });
      report(duplicate);
      return duplicate;
    }

    const commerceOrderId = `COM-${String(++commerceSequence).padStart(4, "0")}`;
    const downstreamOrder = {
      contractVersion: commerceContractVersion,
      traceId: command.traceId,
      scenarioId: command.scenarioId,
      commerceOrderId,
      storeId: command.order.storeId,
      items: command.order.items,
      totalVnd: command.order.totalVnd,
    };
    const omsResult = await oms.createOrder(
      downstreamOrder,
      `${command.idempotencyKey}:oms`,
    );
    if (!omsResult.ok) {
      return reply.code(502).send(
        result({
          command,
          commerceOrderId,
          outcome: "failed",
          customerStatus: "failed",
        }),
      );
    }

    const posResult = await pos.submitTicket(
      { ...downstreamOrder, omsOrderId: omsResult.value.omsOrderId },
      `${command.idempotencyKey}:pos`,
    );
    if (!posResult.ok) {
      if (posResult.timedOut) {
        const timeoutResult = result({
          command,
          commerceOrderId,
          omsOrderId: omsResult.value.omsOrderId,
          omsStatus: omsResult.value.omsStatus,
          outcome: "ambiguous_pos_submission",
          customerStatus: "failed",
          compensationStatus: "not_required",
        });
        storeResult(command.idempotencyKey, timeoutResult);
        report(timeoutResult);
        return reply.code(504).send(timeoutResult);
      }

      const compensation = await oms.cancelOrder(omsResult.value.omsOrderId, {
        traceId: command.traceId,
        scenarioId: command.scenarioId,
      });
      const rejectedResult = result({
        command,
        commerceOrderId,
        omsOrderId: omsResult.value.omsOrderId,
        omsStatus: compensation.ok
          ? compensation.value.omsStatus
          : (compensation.omsStatus ?? "cancellation_failed"),
        posStatus: posResult.posStatus ?? "rejected",
        outcome: "pos_rejected",
        customerStatus: "failed",
        compensationStatus: compensation.ok ? "succeeded" : "failed",
      });
      storeResult(command.idempotencyKey, rejectedResult);
      report(rejectedResult);
      return reply.code(409).send(rejectedResult);
    }

    const accepted = result({
      command,
      commerceOrderId,
      omsOrderId: omsResult.value.omsOrderId,
      posTicketId: posResult.value.posTicketId,
      omsStatus: omsResult.value.omsStatus,
      posStatus: posResult.value.posStatus,
      outcome: "accepted",
      customerStatus: "accepted",
    });
    storeResult(command.idempotencyKey, accepted);
    report(accepted);
    return reply.code(201).send(accepted);
  });

  server.get("/v1/orders/:commerceOrderId", async (request, reply) => {
    const { commerceOrderId } = request.params as { commerceOrderId: string };
    const { traceId = crypto.randomUUID() } = request.query as { traceId?: string | undefined };
    const current = resultByCommerceOrderId.get(commerceOrderId);
    if (!current?.omsOrderId || !current.posTicketId) {
      return reply.code(404).send({
        ok: false,
        errorCode: "commerce_order_not_found",
        message: "Commerce order was not found",
      });
    }
    const [omsStatus, posStatus] = await Promise.all([
      oms.getOrder(current.omsOrderId, traceId),
      pos.getTicket(current.posTicketId, traceId),
    ]);
    if (!omsStatus.ok || !posStatus.ok) {
      return reply.code(502).send({
        ...current,
        traceId,
        outcome: "failed",
        customerStatus: "failed",
      });
    }
    const conflict =
      omsStatus.value.omsStatus === "created" &&
      posStatus.value.posStatus === "cancelled";
    const projected = commerceResultSchema.parse({
      ...current,
      traceId,
      omsStatus: omsStatus.value.omsStatus,
      posStatus: posStatus.value.posStatus,
      outcome: conflict ? "status_conflict" : current.outcome,
      customerStatus: conflict ? "failed" : customerStatusForPos(posStatus.value.posStatus),
      ...(conflict ? { conflictType: "oms_created_pos_cancelled" } : {}),
    });
    resultByCommerceOrderId.set(commerceOrderId, projected);
    report(projected);
    return reply.code(conflict ? 409 : 200).send(projected);
  });

  server.post("/v1/orders/:commerceOrderId/cancel", async (request, reply) => {
    const parsed = cancellationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        errorCode: "invalid_cancellation_command",
        message: parsed.error.message,
      });
    }
    const { commerceOrderId } = request.params as { commerceOrderId: string };
    const current = resultByCommerceOrderId.get(commerceOrderId);
    if (!current?.omsOrderId || !current.posTicketId) {
      return reply.code(404).send({
        ok: false,
        errorCode: "commerce_order_not_found",
        message: "Commerce order was not found",
      });
    }

    const posCancellation = await pos.cancelTicket(current.posTicketId, parsed.data);
    if (!posCancellation.ok) {
      const partial = commerceResultSchema.parse({
          ...current,
          traceId: parsed.data.traceId,
          scenarioId: parsed.data.scenarioId,
          outcome: "partial_cancellation",
          posStatus: posCancellation.posStatus ?? "cancellation_failed",
          customerStatus: "failed",
          conflictType: "pos_cancellation_failed",
        });
      report(partial);
      return reply.code(409).send(partial);
    }

    const omsCancellation = await oms.cancelOrder(current.omsOrderId, parsed.data);
    const cancelled = commerceResultSchema.parse({
      ...current,
      traceId: parsed.data.traceId,
      scenarioId: parsed.data.scenarioId,
      outcome: omsCancellation.ok ? "cancelled" : "partial_cancellation",
      omsStatus: omsCancellation.ok
        ? omsCancellation.value.omsStatus
        : (omsCancellation.omsStatus ?? "cancellation_failed"),
      posStatus: posCancellation.value.posStatus,
      customerStatus: omsCancellation.ok ? "cancelled" : "failed",
      ...(omsCancellation.ok ? {} : { conflictType: "oms_cancellation_failed" }),
    });
    resultByCommerceOrderId.set(commerceOrderId, cancelled);
    report(cancelled);
    return reply.code(omsCancellation.ok ? 200 : 409).send(cancelled);
  });

  function storeResult(idempotencyKey: string, value: CommerceResult): void {
    resultByIdempotencyKey.set(idempotencyKey, value);
    if (value.commerceOrderId) resultByCommerceOrderId.set(value.commerceOrderId, value);
  }

  function report(value: CommerceResult): void {
    options.onResult?.(value);
  }

  return server;
}

function result(input: {
  command: z.infer<typeof commerceCommandSchema>;
  commerceOrderId: string;
  outcome: CommerceResult["outcome"];
  customerStatus: CommerceResult["customerStatus"];
  omsOrderId?: string | undefined;
  posTicketId?: string | undefined;
  omsStatus?: CommerceResult["omsStatus"] | undefined;
  posStatus?: CommerceResult["posStatus"] | undefined;
  compensationStatus?: CommerceResult["compensationStatus"] | undefined;
}): CommerceResult {
  return commerceResultSchema.parse({
    contractVersion: commerceContractVersion,
    traceId: input.command.traceId,
    scenarioId: input.command.scenarioId,
    outcome: input.outcome,
    commerceOrderId: input.commerceOrderId,
    omsOrderId: input.omsOrderId,
    posTicketId: input.posTicketId,
    omsStatus: input.omsStatus,
    posStatus: input.posStatus,
    customerStatus: input.customerStatus,
    compensationStatus: input.compensationStatus,
    deduplicated: false,
    simulated: { gateway: true, oms: true, pos: true },
  });
}

function customerStatusForPos(
  status: CommerceResult["posStatus"],
): CommerceResult["customerStatus"] {
  if (status === "preparing") return "preparing";
  if (status === "ready") return "ready";
  if (status === "cancelled") return "cancelled";
  return status === "accepted" ? "accepted" : "failed";
}

async function checkReadiness(
  dependency: { baseUrl: string; token: string },
  timeoutMs: number,
) {
  const startedAt = performance.now();
  try {
    const response = await fetch(`${dependency.baseUrl.replace(/\/$/, "")}/ready`, {
      headers: { authorization: `Bearer ${dependency.token}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const payload = (await response.json()) as Record<string, unknown>;
    const authenticated = response.status !== 401 && response.status !== 403;
    const ready = response["ok"] && payload["ok"] === true && authenticated;
    return {
      status: ready ? "ready" : "unavailable",
      required: true,
      configured: true,
      reachable: true,
      authenticated,
      dependencyClass:
        payload["dependencyClass"] === "simulated"
          ? "simulated"
          : "unavailable",
      latencyMs: Math.round(performance.now() - startedAt),
      ...(ready ? {} : { message: `Dependency readiness returned HTTP ${response.status}` }),
    };
  } catch (error) {
    return {
      status: "unavailable",
      required: true,
      configured: true,
      reachable: false,
      authenticated: false,
      dependencyClass: "unavailable",
      latencyMs: Math.round(performance.now() - startedAt),
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
