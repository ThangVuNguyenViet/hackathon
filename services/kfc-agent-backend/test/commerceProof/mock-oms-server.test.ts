import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildCommerceProofMockOmsServer } from "../../src/commerceProof/mockOmsServer.js";
import { commerceContractVersion } from "../../src/commerceProof/contracts.js";

const servers: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

function buildServer() {
  const server = buildCommerceProofMockOmsServer({
    token: "oms-token",
    adminToken: "oms-admin-token",
  });
  servers.push(server);
  return server;
}

const orderInput = {
  contractVersion: commerceContractVersion,
  traceId: "trace-oms-1",
  scenarioId: "successful-placement",
  commerceOrderId: "COM-0001",
  storeId: "KFCVN0001",
  items: [{ itemCode: "20751", quantity: 1 }],
  totalVnd: 117000,
};

describe("commerce proof Mock OMS", () => {
  it("reports simulated health and authenticated readiness", async () => {
    const server = buildServer();

    const health = await server.inject({ method: "GET", url: "/health" });
    const unauthorizedReady = await server.inject({
      method: "GET",
      url: "/ready",
    });
    const ready = await server.inject({
      method: "GET",
      url: "/ready",
      headers: { authorization: "Bearer oms-token" },
    });

    expect(health.json()).toMatchObject({
      ok: true,
      service: "mock-oms",
      contractVersion: commerceContractVersion,
      dependencyClass: "simulated",
    });
    expect(unauthorizedReady.statusCode).toBe(401);
    expect(ready.json()).toMatchObject({
      ok: true,
      status: "ready",
      authenticated: true,
      dependencyClass: "simulated",
    });
  });

  it("previews, creates, reuses, reads, and cancels an OMS order", async () => {
    const server = buildServer();
    const headers = {
      authorization: "Bearer oms-token",
      "idempotency-key": "session:message:placeOrder",
    };

    const preview = await server.inject({
      method: "POST",
      url: "/v1/orders/preview",
      headers,
      payload: orderInput,
    });
    const first = await server.inject({
      method: "POST",
      url: "/v1/orders",
      headers,
      payload: orderInput,
    });
    const duplicate = await server.inject({
      method: "POST",
      url: "/v1/orders",
      headers,
      payload: { ...orderInput, traceId: "trace-oms-duplicate" },
    });
    const omsOrderId = first.json().omsOrderId as string;
    const found = await server.inject({
      method: "GET",
      url: `/v1/orders/${omsOrderId}`,
      headers,
    });
    const cancelled = await server.inject({
      method: "POST",
      url: `/v1/orders/${omsOrderId}/cancel`,
      headers,
      payload: {
        traceId: orderInput.traceId,
        scenarioId: orderInput.scenarioId,
      },
    });

    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({ omsStatus: "previewed" });
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({
      commerceOrderId: "COM-0001",
      omsOrderId: "OMS-0001",
      omsStatus: "created",
      traceId: "trace-oms-1",
      simulated: true,
      deduplicated: false,
    });
    expect(duplicate.json()).toMatchObject({
      omsOrderId,
      deduplicated: true,
      originalTraceId: "trace-oms-1",
    });
    expect(found.json()).toMatchObject({ omsOrderId, omsStatus: "created" });
    expect(cancelled.json()).toMatchObject({
      omsOrderId,
      omsStatus: "cancelled",
    });
  });

  it("requires the admin token and isolates cancellation failure by scenario", async () => {
    const server = buildServer();
    const unauthorized = await server.inject({
      method: "PUT",
      url: "/__admin/scenarios/rejection-compensation-fails",
      headers: { authorization: "Bearer oms-token" },
      payload: { operation: "cancel_order", behavior: "fail" },
    });
    const configured = await server.inject({
      method: "PUT",
      url: "/__admin/scenarios/rejection-compensation-fails",
      headers: { authorization: "Bearer oms-admin-token" },
      payload: { operation: "cancel_order", behavior: "fail" },
    });
    const placed = await server.inject({
      method: "POST",
      url: "/v1/orders",
      headers: {
        authorization: "Bearer oms-token",
        "idempotency-key": "compensation-failure",
      },
      payload: {
        ...orderInput,
        scenarioId: "rejection-compensation-fails",
      },
    });
    const cancellation = await server.inject({
      method: "POST",
      url: `/v1/orders/${placed.json().omsOrderId}/cancel`,
      headers: { authorization: "Bearer oms-token" },
      payload: {
        traceId: orderInput.traceId,
        scenarioId: "rejection-compensation-fails",
      },
    });

    expect(unauthorized.statusCode).toBe(401);
    expect(configured.statusCode).toBe(204);
    expect(cancellation.statusCode).toBe(409);
    expect(cancellation.json()).toMatchObject({
      ok: false,
      errorCode: "oms_cancellation_failed",
      omsStatus: "cancellation_failed",
    });
  });
});
