import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildCommerceProofMockPosServer } from "../../src/commerceProof/mockPosServer.js";
import { commerceContractVersion } from "../../src/commerceProof/contracts.js";

const servers: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

function buildServer() {
  const server = buildCommerceProofMockPosServer({
    token: "pos-token",
    adminToken: "pos-admin-token",
  });
  servers.push(server);
  return server;
}

const ticketInput = {
  contractVersion: commerceContractVersion,
  traceId: "trace-pos-1",
  scenarioId: "successful-placement",
  commerceOrderId: "COM-0001",
  omsOrderId: "OMS-0001",
  storeId: "KFCVN0001",
  items: [{ itemCode: "20751", quantity: 1 }],
  totalVnd: 117000,
};

describe("commerce proof Mock POS", () => {
  it("reports sandbox provider provenance and authenticated readiness", async () => {
    const server = buildServer();
    const health = await server.inject({ method: "GET", url: "/health" });
    const unauthorized = await server.inject({ method: "GET", url: "/ready" });
    const ready = await server.inject({
      method: "GET",
      url: "/ready",
      headers: { authorization: "Bearer pos-token" },
    });

    expect(health.json()).toMatchObject({
      ok: true,
      service: "mock-pos",
      contractVersion: commerceContractVersion,
      commerceEnvironment: "sandbox",
      providerImplementation: "http-adapter",
    });
    expect(unauthorized.statusCode).toBe(401);
    expect(ready.json()).toMatchObject({
      ok: true,
      status: "ready",
      authenticated: true,
      commerceEnvironment: "sandbox",
      providerImplementation: "http-adapter",
    });
  });

  it("creates, reuses, reads, and cancels a correlated POS ticket", async () => {
    const server = buildServer();
    const headers = {
      authorization: "Bearer pos-token",
      "idempotency-key": "session:message:placeOrder",
    };
    const first = await server.inject({
      method: "POST",
      url: "/v1/tickets",
      headers,
      payload: ticketInput,
    });
    const duplicate = await server.inject({
      method: "POST",
      url: "/v1/tickets",
      headers,
      payload: { ...ticketInput, traceId: "trace-pos-duplicate" },
    });
    const posTicketId = first.json().posTicketId as string;
    const found = await server.inject({
      method: "GET",
      url: `/v1/tickets/${posTicketId}`,
      headers,
    });
    const cancelled = await server.inject({
      method: "POST",
      url: `/v1/tickets/${posTicketId}/cancel`,
      headers,
      payload: {
        traceId: ticketInput.traceId,
        scenarioId: ticketInput.scenarioId,
      },
    });

    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({
      commerceOrderId: "COM-0001",
      omsOrderId: "OMS-0001",
      posTicketId: "POS-0001",
      posStatus: "accepted",
      commerceEnvironment: "sandbox",
      providerImplementation: "http-adapter",
      deduplicated: false,
    });
    expect(duplicate.json()).toMatchObject({
      posTicketId,
      deduplicated: true,
      originalTraceId: "trace-pos-1",
    });
    expect(found.json()).toMatchObject({ posTicketId, posStatus: "accepted" });
    expect(cancelled.json()).toMatchObject({
      posTicketId,
      posStatus: "cancelled",
    });
  });

  it("applies rejection and delay only to the configured scenario", async () => {
    const server = buildServer();
    const adminHeaders = { authorization: "Bearer pos-admin-token" };
    await server.inject({
      method: "PUT",
      url: "/__admin/scenarios/rejection-compensation-succeeds",
      headers: adminHeaders,
      payload: { operation: "submit_pos_ticket", behavior: "reject" },
    });
    await server.inject({
      method: "PUT",
      url: "/__admin/scenarios/pos-timeout",
      headers: adminHeaders,
      payload: {
        operation: "submit_pos_ticket",
        behavior: "delay",
        delayMs: 25,
      },
    });

    const rejected = await server.inject({
      method: "POST",
      url: "/v1/tickets",
      headers: {
        authorization: "Bearer pos-token",
        "idempotency-key": "rejected-ticket",
      },
      payload: {
        ...ticketInput,
        scenarioId: "rejection-compensation-succeeds",
      },
    });
    const startedAt = Date.now();
    const delayed = await server.inject({
      method: "POST",
      url: "/v1/tickets",
      headers: {
        authorization: "Bearer pos-token",
        "idempotency-key": "delayed-ticket",
      },
      payload: { ...ticketInput, scenarioId: "pos-timeout" },
    });
    const normal = await server.inject({
      method: "POST",
      url: "/v1/tickets",
      headers: {
        authorization: "Bearer pos-token",
        "idempotency-key": "normal-ticket",
      },
      payload: ticketInput,
    });

    expect(rejected.statusCode).toBe(409);
    expect(rejected.json()).toMatchObject({
      errorCode: "pos_order_rejected",
      posStatus: "rejected",
    });
    expect(delayed.statusCode).toBe(201);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(20);
    expect(normal.statusCode).toBe(201);
  });

  it("requires the admin token and supports cancellation failure", async () => {
    const server = buildServer();
    const unauthorized = await server.inject({
      method: "PUT",
      url: "/__admin/scenarios/partial-cancellation-failure",
      headers: { authorization: "Bearer pos-token" },
      payload: { operation: "cancel_pos_ticket", behavior: "fail" },
    });
    await server.inject({
      method: "PUT",
      url: "/__admin/scenarios/partial-cancellation-failure",
      headers: { authorization: "Bearer pos-admin-token" },
      payload: { operation: "cancel_pos_ticket", behavior: "fail" },
    });
    const placed = await server.inject({
      method: "POST",
      url: "/v1/tickets",
      headers: {
        authorization: "Bearer pos-token",
        "idempotency-key": "partial-cancellation",
      },
      payload: { ...ticketInput, scenarioId: "partial-cancellation-failure" },
    });
    const cancellation = await server.inject({
      method: "POST",
      url: `/v1/tickets/${placed.json().posTicketId}/cancel`,
      headers: { authorization: "Bearer pos-token" },
      payload: {
        traceId: ticketInput.traceId,
        scenarioId: "partial-cancellation-failure",
      },
    });

    expect(unauthorized.statusCode).toBe(401);
    expect(cancellation.statusCode).toBe(409);
    expect(cancellation.json()).toMatchObject({
      errorCode: "pos_cancellation_failed",
      posStatus: "cancellation_failed",
    });
  });
});
