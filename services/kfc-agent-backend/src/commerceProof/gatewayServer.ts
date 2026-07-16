import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import type { Order } from "../domain/types.js";
import { loadBundledGeneratedFixtures } from "../fixtures/bundledFixtures.js";
import { OrderingDataService } from "../ordering/orderingDataService.js";
import {
  commerceCommandSchema,
  commerceContractVersion,
  commerceResultSchema,
  sandboxCommerceProofProviderProvenance,
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
  timeoutMs: number;
  readinessTimeoutMs: number;
  onResult?: (result: CommerceResult) => void;
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

const paymentLinkSchema = z.object({
  method: z.enum(["momo", "zalopay", "card", "cod"]),
}).strict();

const sandboxGatewayProvenance = [{
  fixtureMode: "provider_runtime" as const,
  sourceFile: "src/commerceProof/gatewayServer.ts",
  sourceApi: "sandbox-commerce-gateway",
}];

export function buildCommerceProofGatewayServer(
  options: CommerceProofGatewayServerOptions,
): FastifyInstance {
  const server = Fastify({ logger: false });
  const timeoutMs = options.timeoutMs;
  const oms = createCommerceProofOmsClient({ ...options.oms, timeoutMs });
  const pos = createCommerceProofPosClient({ ...options.pos, timeoutMs });
  const resultByIdempotencyKey = new Map<string, CommerceResult>();
  const resultByCommerceOrderId = new Map<string, CommerceResult>();
  const previewById = new Map<string, Order>();
  const orderByCommerceOrderId = new Map<string, Order>();
  const paymentData = new OrderingDataService(loadBundledGeneratedFixtures());
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
    commerceEnvironment: "sandbox",
    providerImplementation: "http-adapter",
    timestamp: new Date().toISOString(),
  }));

  server.get("/ready", async (_request, reply) => {
    const [omsCheck, posCheck] = await Promise.all([
      checkReadiness(options.oms, options.readinessTimeoutMs),
      checkReadiness(options.pos, options.readinessTimeoutMs),
    ]);
    const ok = omsCheck.status === "ready" && posCheck.status === "ready";
    return reply.code(ok ? 200 : 503).send({
      ok,
      service: "demo-commerce-gateway",
      status: ok ? "ready" : "unavailable",
      configured: true,
      reachable: true,
      authenticated: true,
      commerceEnvironment: "sandbox",
      providerImplementation: "http-adapter",
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
    const preview: Order = {
      id: `PREVIEW-${String(++previewSequence).padStart(4, "0")}`,
      status: "previewed",
      paymentStatus: "pending",
      assignedStoreId: parsed.data.storeId,
      createdAt: new Date().toISOString(),
      cart: parsed.data.cart,
    };
    previewById.set(preview.id, preview);
    return {
      ok: true,
      value: preview,
      message: "order_previewed",
      provenance: sandboxGatewayProvenance,
    };
  });

  server.get("/v1/payment-methods", async (request) => {
    const { query, paymentSurface } = request.query as {
      query?: string;
      paymentSurface?: string;
    };
    return {
      ok: true,
      value: paymentData.listPaymentMethods({ query, paymentSurface }),
      message: "payment_methods_listed",
      provenance: sandboxGatewayProvenance,
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
    const preview = previewById.get(command.order.previewId);
    orderByCommerceOrderId.set(commerceOrderId, preview
      ? {
          ...preview,
          id: commerceOrderId,
          status: "created",
          commerceOrderId,
          omsOrderId: accepted.omsOrderId,
          posTicketId: accepted.posTicketId,
          posStatus: "accepted",
          commerceOutcome: accepted.outcome,
          commerceCustomerStatus: accepted.customerStatus,
          commerceEnvironment: "sandbox",
          commerceProviderProvenance: accepted.providerProvenance,
        }
      : fallbackAgentOrder(command, accepted));
    report(accepted);
    return reply.code(201).send(accepted);
  });

  server.post("/v1/orders/:commerceOrderId/payment-links", async (request, reply) => {
    const parsed = paymentLinkSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        errorCode: "invalid_payment_link_request",
        message: parsed.error.message,
      });
    }
    const { commerceOrderId } = request.params as { commerceOrderId: string };
    if (!orderByCommerceOrderId.has(commerceOrderId)) {
      return reply.code(404).send({
        ok: false,
        errorCode: "commerce_order_not_found",
        message: "Commerce order was not found",
      });
    }
    const method = paymentData.getPaymentMethodForLink(parsed.data.method);
    if (!method?.supported) {
      return reply.code(422).send({
        ok: false,
        errorCode: "payment_method_unsupported",
        message: `${method?.displayName ?? parsed.data.method} is not supported by this sandbox provider`,
      });
    }
    return {
      ok: true,
      value: {
        url: `https://pay.sandbox.invalid/${parsed.data.method}/${encodeURIComponent(commerceOrderId)}`,
        status: "pending",
      },
      message: "payment_link_created",
      provenance: sandboxGatewayProvenance,
    };
  });

  server.get("/v1/orders/:commerceOrderId/payment-status", async (request, reply) => {
    const { commerceOrderId } = request.params as { commerceOrderId: string };
    if (!orderByCommerceOrderId.has(commerceOrderId)) {
      return reply.code(404).send({
        ok: false,
        errorCode: "commerce_order_not_found",
        message: "Commerce order was not found",
      });
    }
    return {
      ok: true,
      value: { status: "pending" },
      message: "payment_status_read",
      provenance: sandboxGatewayProvenance,
    };
  });

  server.get("/v1/orders/:commerceOrderId", async (request, reply) => {
    const { commerceOrderId } = request.params as { commerceOrderId: string };
    const { traceId = crypto.randomUUID() } = request.query as { traceId?: string };
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
    const order = orderByCommerceOrderId.get(commerceOrderId);
    if (!order) {
      return reply.code(500).send({
        ...projected,
        ok: false,
        errorCode: "agent_order_projection_missing",
        message: "Agent order projection was not found",
      });
    }
    const value: Order = {
      ...order,
      status: customerOrderStatus(projected.customerStatus),
      posStatus: orderPosStatus(projected.posStatus),
      commerceOutcome: projected.outcome,
      commerceCustomerStatus: projected.customerStatus,
    };
    orderByCommerceOrderId.set(commerceOrderId, value);
    return reply.code(conflict ? 409 : 200).send({
      ...projected,
      ok: !conflict,
      ...(conflict ? { errorCode: "commerce_status_conflict" } : { value }),
      message: conflict ? "Commerce status is conflicting" : "order_status_read",
      provenance: sandboxGatewayProvenance,
    });
  });

  server.post("/v1/orders/:commerceOrderId/cancel", async (request, reply) => {
    const { commerceOrderId } = request.params as { commerceOrderId: string };
    const current = resultByCommerceOrderId.get(commerceOrderId);
    const parsed = cancellationSchema.safeParse(request.body ?? {
      traceId: crypto.randomUUID(),
      scenarioId: current?.scenarioId ?? "sandbox-agent-cancellation",
    });
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        errorCode: "invalid_cancellation_command",
        message: parsed.error.message,
      });
    }
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
    const order = orderByCommerceOrderId.get(commerceOrderId);
    if (order && omsCancellation.ok) {
      orderByCommerceOrderId.set(commerceOrderId, { ...order, status: "cancelled" });
    }
    return reply.code(omsCancellation.ok ? 200 : 409).send({
      ...cancelled,
      ok: omsCancellation.ok,
      ...(order && omsCancellation.ok ? { value: { ...order, status: "cancelled" } } : {
        errorCode: "commerce_cancellation_incomplete",
      }),
      message: omsCancellation.ok ? "order_cancelled" : "Order cancellation was incomplete",
      provenance: sandboxGatewayProvenance,
    });
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

function fallbackAgentOrder(
  command: z.infer<typeof commerceCommandSchema>,
  accepted: CommerceResult,
): Order {
  return {
    id: accepted.commerceOrderId!,
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

function customerOrderStatus(
  status: CommerceResult["customerStatus"],
): Order["status"] {
  return status === "preparing" || status === "ready"
    ? "preparing"
    : status === "cancelled" || status === "failed"
      ? "cancelled"
      : "created";
}

function orderPosStatus(
  status: CommerceResult["posStatus"],
): Order["posStatus"] {
  return status === "accepted" || status === "preparing" || status === "ready" ||
    status === "cancelled" || status === "rejected"
    ? status
    : undefined;
}

function result(input: {
  command: z.infer<typeof commerceCommandSchema>;
  commerceOrderId: string;
  outcome: CommerceResult["outcome"];
  customerStatus: CommerceResult["customerStatus"];
  omsOrderId?: string;
  posTicketId?: string;
  omsStatus?: CommerceResult["omsStatus"];
  posStatus?: CommerceResult["posStatus"];
  compensationStatus?: CommerceResult["compensationStatus"];
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
    commerceEnvironment: "sandbox",
    providerProvenance: sandboxCommerceProofProviderProvenance,
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
    const ready = response.ok && payload.ok === true && authenticated;
    return {
      status: ready ? "ready" : "unavailable",
      required: true,
      configured: true,
      reachable: true,
      authenticated,
      commerceEnvironment: payload.commerceEnvironment === "sandbox" ? "sandbox" : "unavailable",
      providerImplementation:
        typeof payload.providerImplementation === "string"
          ? payload.providerImplementation
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
      commerceEnvironment: "unavailable",
      providerImplementation: "unavailable",
      latencyMs: Math.round(performance.now() - startedAt),
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
