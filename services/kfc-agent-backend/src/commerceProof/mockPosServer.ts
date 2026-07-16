import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import { commerceContractVersion, posStatusSchema } from "./contracts.js";
import { mockBehaviorSchema, type MockBehavior } from "./scenarios.js";

export interface CommerceProofMockPosServerOptions {
  token: string;
  adminToken: string;
}

const ticketInputSchema = z.object({
  contractVersion: z.literal(commerceContractVersion),
  traceId: z.string().min(1),
  scenarioId: z.string().min(1),
  commerceOrderId: z.string().min(1),
  omsOrderId: z.string().min(1),
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

interface MockPosTicket {
  contractVersion: typeof commerceContractVersion;
  traceId: string;
  scenarioId: string;
  commerceOrderId: string;
  omsOrderId: string;
  posTicketId: string;
  posStatus: z.infer<typeof posStatusSchema>;
  commerceEnvironment: "sandbox";
  providerImplementation: "http-adapter";
  deduplicated: boolean;
  originalTraceId?: string;
}

export function buildCommerceProofMockPosServer(
  options: CommerceProofMockPosServerOptions,
): FastifyInstance {
  const server = Fastify({ logger: false });
  const tickets = new Map<string, MockPosTicket>();
  const ticketByIdempotencyKey = new Map<string, string>();
  const behaviorByScenario = new Map<string, Map<string, MockBehavior>>();
  let ticketSequence = 0;

  server.addHook("onRequest", async (request, reply) => {
    if (request.url === "/health") return;
    const expectedToken = request.url.startsWith("/__admin/")
      ? options.adminToken
      : options.token;
    if (request.headers.authorization !== `Bearer ${expectedToken}`) {
      return reply.code(401).send({
        ok: false,
        errorCode: "pos_unauthorized",
        message: "Invalid Mock POS token",
      });
    }
  });

  server.get("/health", async () => ({
    ok: true,
    service: "mock-pos",
    version: "1",
    contractVersion: commerceContractVersion,
    commerceEnvironment: "sandbox",
    providerImplementation: "http-adapter",
    timestamp: new Date().toISOString(),
  }));

  server.get("/ready", async () => ({
    ok: true,
    service: "mock-pos",
    status: "ready",
    configured: true,
    reachable: true,
    authenticated: true,
    commerceEnvironment: "sandbox",
    providerImplementation: "http-adapter",
  }));

  server.put("/__admin/scenarios/:scenarioId", async (request, reply) => {
    const parsed = mockBehaviorSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        errorCode: "invalid_mock_behavior",
        message: "Invalid Mock POS behavior",
      });
    }
    const { scenarioId } = request.params as { scenarioId: string };
    const scenario = behaviorByScenario.get(scenarioId) ?? new Map();
    scenario.set(parsed.data.operation, parsed.data);
    behaviorByScenario.set(scenarioId, scenario);
    return reply.code(204).send();
  });

  server.post("/v1/tickets", async (request, reply) => {
    const parsed = ticketInputSchema.safeParse(request.body);
    if (!parsed.success) return invalidTicket(reply);
    const idempotencyKey = request.headers["idempotency-key"];
    if (typeof idempotencyKey !== "string" || idempotencyKey.length === 0) {
      return reply.code(400).send({
        ok: false,
        errorCode: "idempotency_key_required",
        message: "Idempotency-Key is required",
      });
    }
    const existingId = ticketByIdempotencyKey.get(idempotencyKey);
    if (existingId) {
      const existing = tickets.get(existingId)!;
      return {
        ...existing,
        traceId: parsed.data.traceId,
        deduplicated: true,
        originalTraceId: existing.traceId,
      };
    }

    const behavior = behaviorByScenario
      .get(parsed.data.scenarioId)
      ?.get("submit_pos_ticket");
    if (behavior?.behavior === "delay") {
      await delay(behavior.delayMs ?? 5000);
    }
    if (behavior?.behavior === "reject") {
      return reply.code(409).send({
        ok: false,
        errorCode: "pos_order_rejected",
        message: "Mock POS rejected the ticket",
        traceId: parsed.data.traceId,
        scenarioId: parsed.data.scenarioId,
        commerceOrderId: parsed.data.commerceOrderId,
        omsOrderId: parsed.data.omsOrderId,
        posStatus: "rejected",
        commerceEnvironment: "sandbox",
        providerImplementation: "http-adapter",
      });
    }

    const posTicketId = `POS-${String(++ticketSequence).padStart(4, "0")}`;
    const ticket: MockPosTicket = {
      contractVersion: commerceContractVersion,
      traceId: parsed.data.traceId,
      scenarioId: parsed.data.scenarioId,
      commerceOrderId: parsed.data.commerceOrderId,
      omsOrderId: parsed.data.omsOrderId,
      posTicketId,
      posStatus: "accepted",
      commerceEnvironment: "sandbox",
      providerImplementation: "http-adapter",
      deduplicated: false,
    };
    tickets.set(posTicketId, ticket);
    ticketByIdempotencyKey.set(idempotencyKey, posTicketId);
    return reply.code(201).send(ticket);
  });

  server.get("/v1/tickets/:posTicketId", async (request, reply) => {
    const { posTicketId } = request.params as { posTicketId: string };
    const ticket = tickets.get(posTicketId);
    if (!ticket) {
      return reply.code(404).send({
        ok: false,
        errorCode: "pos_ticket_not_found",
        message: "POS ticket was not found",
      });
    }
    const behavior = behaviorByScenario
      .get(ticket.scenarioId)
      ?.get("get_pos_ticket");
    return behavior?.behavior === "conflict"
      ? { ...ticket, posStatus: "cancelled" }
      : ticket;
  });

  server.post("/v1/tickets/:posTicketId/cancel", async (request, reply) => {
    const parsed = cancellationInputSchema.safeParse(request.body);
    if (!parsed.success) return invalidTicket(reply);
    const { posTicketId } = request.params as { posTicketId: string };
    const ticket = tickets.get(posTicketId);
    if (!ticket) {
      return reply.code(404).send({
        ok: false,
        errorCode: "pos_ticket_not_found",
        message: "POS ticket was not found",
      });
    }
    const behavior = behaviorByScenario
      .get(parsed.data.scenarioId)
      ?.get("cancel_pos_ticket");
    if (behavior?.behavior === "fail") {
      return reply.code(409).send({
        ok: false,
        errorCode: "pos_cancellation_failed",
        message: "Mock POS cancellation failed",
        traceId: parsed.data.traceId,
        scenarioId: parsed.data.scenarioId,
        commerceOrderId: ticket.commerceOrderId,
        omsOrderId: ticket.omsOrderId,
        posTicketId,
        posStatus: "cancellation_failed",
        commerceEnvironment: "sandbox",
        providerImplementation: "http-adapter",
      });
    }
    const cancelled: MockPosTicket = {
      ...ticket,
      traceId: parsed.data.traceId,
      scenarioId: parsed.data.scenarioId,
      posStatus: "cancelled",
    };
    tickets.set(posTicketId, cancelled);
    return cancelled;
  });

  return server;
}

function invalidTicket(reply: { code(statusCode: number): { send(payload: unknown): unknown } }) {
  return reply.code(400).send({
    ok: false,
    errorCode: "invalid_pos_ticket",
    message: "A valid Mock POS ticket payload is required",
  });
}

function delay(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}
