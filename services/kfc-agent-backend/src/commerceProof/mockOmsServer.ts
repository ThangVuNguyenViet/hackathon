import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import type { omsStatusSchema } from "./contracts.js";
import { commerceContractVersion } from "./contracts.js";
import { mockBehaviorSchema, type MockBehavior } from "./scenarios.js";

export interface CommerceProofMockOmsServerOptions {
  token: string;
  adminToken: string;
}

const orderInputSchema = z.object({
  contractVersion: z.literal(commerceContractVersion),
  traceId: z.string().min(1),
  scenarioId: z.string().min(1),
  commerceOrderId: z.string().min(1),
  storeId: z.string().min(1),
  items: z.array(
    z.object({
      itemCode: z.string().min(1),
      quantity: z.number().int().positive(),
    }),
  ),
  totalVnd: z.number().int().nonnegative(),
});

const cancellationInputSchema = z.object({
  traceId: z.string().min(1),
  scenarioId: z.string().min(1),
});

interface MockOmsOrder {
  contractVersion: typeof commerceContractVersion;
  traceId: string;
  scenarioId: string;
  commerceOrderId: string;
  omsOrderId: string;
  omsStatus: z.infer<typeof omsStatusSchema>;
  simulated: true;
  deduplicated: boolean;
  originalTraceId?: string | undefined;
}

export function buildCommerceProofMockOmsServer(
  options: CommerceProofMockOmsServerOptions,
): FastifyInstance {
  const server = Fastify({ logger: false });
  const orders = new Map<string, MockOmsOrder>();
  const orderByIdempotencyKey = new Map<string, string>();
  const behaviorByScenario = new Map<string, Map<string, MockBehavior>>();
  let orderSequence = 0;

  server.addHook("onRequest", async (request, reply) => {
    if (request.url === "/health") return;
    const expectedToken = request.url.startsWith("/__admin/")
      ? options.adminToken
      : options.token;
    if (request.headers.authorization !== `Bearer ${expectedToken}`) {
      return reply.code(401).send({
        ok: false,
        errorCode: "oms_unauthorized",
        message: "Invalid Mock OMS token",
      });
    }
  });

  server.get("/health", async () => ({
    ok: true,
    service: "mock-oms",
    version: "1",
    contractVersion: commerceContractVersion,
    dependencyClass: "simulated",
    timestamp: new Date().toISOString(),
  }));

  server.get("/ready", async () => ({
    ok: true,
    service: "mock-oms",
    status: "ready",
    configured: true,
    reachable: true,
    authenticated: true,
    dependencyClass: "simulated",
  }));

  server.put("/__admin/scenarios/:scenarioId", async (request, reply) => {
    const parsed = mockBehaviorSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        errorCode: "invalid_mock_behavior",
        message: "Invalid Mock OMS behavior",
      });
    }
    const { scenarioId } = request.params as { scenarioId: string };
    const scenario = behaviorByScenario.get(scenarioId) ?? new Map();
    scenario.set(parsed.data.operation, parsed.data);
    behaviorByScenario.set(scenarioId, scenario);
    return reply.code(204).send();
  });

  server.post("/v1/orders/preview", async (request, reply) => {
    const parsed = orderInputSchema.safeParse(request.body);
    if (!parsed.success) return invalidOrder(reply);
    return {
      ...baseOrder(parsed.data),
      omsOrderId: `PREVIEW-${parsed.data.commerceOrderId}`,
      omsStatus: "previewed",
    };
  });

  server.post("/v1/orders", async (request, reply) => {
    const parsed = orderInputSchema.safeParse(request.body);
    if (!parsed.success) return invalidOrder(reply);
    const idempotencyKey = request.headers["idempotency-key"];
    if (typeof idempotencyKey !== "string" || idempotencyKey.length === 0) {
      return reply.code(400).send({
        ok: false,
        errorCode: "idempotency_key_required",
        message: "Idempotency-Key is required",
      });
    }
    const existingId = orderByIdempotencyKey.get(idempotencyKey);
    if (existingId) {
      const existing = orders.get(existingId)!;
      return {
        ...existing,
        traceId: parsed.data.traceId,
        deduplicated: true,
        originalTraceId: existing.traceId,
      };
    }

    const omsOrderId = `OMS-${String(++orderSequence).padStart(4, "0")}`;
    const order: MockOmsOrder = {
      ...baseOrder(parsed.data),
      omsOrderId,
      omsStatus: "created",
      deduplicated: false,
    };
    orders.set(omsOrderId, order);
    orderByIdempotencyKey.set(idempotencyKey, omsOrderId);
    return reply.code(201).send(order);
  });

  server.get("/v1/orders/:omsOrderId", async (request, reply) => {
    const { omsOrderId } = request.params as { omsOrderId: string };
    const order = orders.get(omsOrderId);
    return order ?? reply.code(404).send({
      ok: false,
      errorCode: "oms_order_not_found",
      message: "OMS order was not found",
    });
  });

  server.post("/v1/orders/:omsOrderId/cancel", async (request, reply) => {
    const parsed = cancellationInputSchema.safeParse(request.body);
    if (!parsed.success) return invalidOrder(reply);
    const { omsOrderId } = request.params as { omsOrderId: string };
    const order = orders.get(omsOrderId);
    if (!order) {
      return reply.code(404).send({
        ok: false,
        errorCode: "oms_order_not_found",
        message: "OMS order was not found",
      });
    }
    const behavior = behaviorByScenario
      .get(parsed.data.scenarioId)
      ?.get("cancel_order");
    if (behavior?.behavior === "fail") {
      return reply.code(409).send({
        ok: false,
        errorCode: "oms_cancellation_failed",
        message: "Mock OMS cancellation failed",
        traceId: parsed.data.traceId,
        scenarioId: parsed.data.scenarioId,
        commerceOrderId: order.commerceOrderId,
        omsOrderId,
        omsStatus: "cancellation_failed",
        simulated: true,
      });
    }
    const cancelled: MockOmsOrder = {
      ...order,
      traceId: parsed.data.traceId,
      scenarioId: parsed.data.scenarioId,
      omsStatus: "cancelled",
    };
    orders.set(omsOrderId, cancelled);
    return cancelled;
  });

  return server;
}

function baseOrder(
  input: z.infer<typeof orderInputSchema>,
): Omit<MockOmsOrder, "omsOrderId" | "omsStatus" | "deduplicated"> {
  return {
    contractVersion: commerceContractVersion,
    traceId: input.traceId,
    scenarioId: input.scenarioId,
    commerceOrderId: input.commerceOrderId,
    simulated: true,
  };
}

function invalidOrder(reply: { code(statusCode: number): { send(payload: unknown): unknown } }) {
  return reply.code(400).send({
    ok: false,
    errorCode: "invalid_oms_order",
    message: "A valid Mock OMS order payload is required",
  });
}
