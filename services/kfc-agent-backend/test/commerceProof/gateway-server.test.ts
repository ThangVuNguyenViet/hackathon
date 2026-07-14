import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildCommerceProofGatewayServer } from "../../src/commerceProof/gatewayServer.js";
import { buildCommerceProofMockOmsServer } from "../../src/commerceProof/mockOmsServer.js";
import { buildCommerceProofMockPosServer } from "../../src/commerceProof/mockPosServer.js";
import { commerceContractVersion } from "../../src/commerceProof/contracts.js";

const servers: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).reverse().map((server) => server.close()));
});

async function listen(server: FastifyInstance): Promise<string> {
  servers.push(server);
  return server.listen({ host: "127.0.0.1", port: 0 });
}

async function harness(timeoutMs = 3000) {
  const oms = buildCommerceProofMockOmsServer({
    token: "oms-token",
    adminToken: "oms-admin-token",
  });
  const pos = buildCommerceProofMockPosServer({
    token: "pos-token",
    adminToken: "pos-admin-token",
  });
  const [omsBaseUrl, posBaseUrl] = await Promise.all([listen(oms), listen(pos)]);
  const gateway = buildCommerceProofGatewayServer({
    token: "gateway-token",
    oms: { baseUrl: omsBaseUrl, token: "oms-token" },
    pos: { baseUrl: posBaseUrl, token: "pos-token" },
    timeoutMs,
    readinessTimeoutMs: 3000,
  });
  servers.push(gateway);
  return { gateway, oms, pos };
}

function command(scenarioId = "successful-placement", traceId = "trace-gateway-1") {
  return {
    contractVersion: commerceContractVersion,
    traceId,
    scenarioId,
    sessionId: "kfc:anon_customer_123",
    clientMessageId: "message-12",
    idempotencyKey: "kfc:anon_customer_123:message-12:placeOrder",
    toolName: "placeOrder",
    order: {
      previewId: "preview-1",
      storeId: "KFCVN0001",
      items: [{ itemCode: "20751", quantity: 1 }],
      totalVnd: 117000,
      paymentMethod: "cash",
      userConfirmed: true,
    },
  };
}

async function configure(
  server: FastifyInstance,
  token: string,
  scenarioId: string,
  payload: Record<string, unknown>,
) {
  const response = await server.inject({
    method: "PUT",
    url: `/__admin/scenarios/${scenarioId}`,
    headers: { authorization: `Bearer ${token}` },
    payload,
  });
  expect(response.statusCode).toBe(204);
}

describe("Demo Commerce Gateway", () => {
  it("reports deep readiness for authenticated Mock OMS and Mock POS", async () => {
    const { gateway } = await harness();
    const response = await gateway.inject({
      method: "GET",
      url: "/ready",
      headers: { authorization: "Bearer gateway-token" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      service: "demo-commerce-gateway",
      status: "ready",
      dependencyClass: "simulated",
      checks: {
        oms: {
          status: "ready",
          configured: true,
          reachable: true,
          authenticated: true,
          dependencyClass: "simulated",
        },
        pos: {
          status: "ready",
          configured: true,
          reachable: true,
          authenticated: true,
          dependencyClass: "simulated",
        },
      },
    });
  });

  it("reports unavailable when a configured downstream token is rejected", async () => {
    const oms = buildCommerceProofMockOmsServer({
      token: "oms-token",
      adminToken: "oms-admin-token",
    });
    const pos = buildCommerceProofMockPosServer({
      token: "pos-token",
      adminToken: "pos-admin-token",
    });
    const [omsBaseUrl, posBaseUrl] = await Promise.all([listen(oms), listen(pos)]);
    const gateway = buildCommerceProofGatewayServer({
      token: "gateway-token",
      oms: { baseUrl: omsBaseUrl, token: "oms-token" },
      pos: { baseUrl: posBaseUrl, token: "wrong-pos-token" },
      timeoutMs: 3000,
      readinessTimeoutMs: 3000,
    });
    servers.push(gateway);

    const response = await gateway.inject({
      method: "GET",
      url: "/ready",
      headers: { authorization: "Bearer gateway-token" },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      ok: false,
      status: "unavailable",
      checks: {
        oms: { status: "ready", authenticated: true },
        pos: { status: "unavailable", authenticated: false },
      },
    });
  });

  it("returns the existing agent-facing order preview contract", async () => {
    const { gateway } = await harness();
    const response = await gateway.inject({
      method: "POST",
      url: "/v1/orders/preview",
      headers: { authorization: "Bearer gateway-token" },
      payload: {
        cart: {
          id: "cart-1",
          items: [
            {
              itemCode: "20751",
              name: "Combo",
              quantity: 1,
              unitPriceVnd: 99000,
            },
          ],
          subtotalVnd: 99000,
          discountVnd: 0,
          deliveryFeeVnd: 18000,
          totalVnd: 117000,
          voucherCode: null,
        },
        address: {
          line1: "Redacted before trace collection",
          ward: "Ward 1",
          district: "District 1",
          city: "Ho Chi Minh City",
        },
        storeId: "KFCVN0001",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      value: {
        id: "PREVIEW-0001",
        status: "previewed",
        assignedStoreId: "KFCVN0001",
        cart: { id: "cart-1", totalVnd: 117000 },
      },
      message: "order_previewed",
    });
  });

  it("creates and correlates an OMS order and POS ticket", async () => {
    const { gateway } = await harness();
    const response = await gateway.inject({
      method: "POST",
      url: "/v1/orders",
      headers: { authorization: "Bearer gateway-token" },
      payload: command(),
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      contractVersion: commerceContractVersion,
      traceId: "trace-gateway-1",
      outcome: "accepted",
      commerceOrderId: "COM-0001",
      omsOrderId: "OMS-0001",
      posTicketId: "POS-0001",
      omsStatus: "created",
      posStatus: "accepted",
      customerStatus: "accepted",
      deduplicated: false,
      simulated: { gateway: true, oms: true, pos: true },
    });
  });

  it("deduplicates at the gateway without another OMS or POS submission", async () => {
    const { gateway } = await harness();
    const first = await gateway.inject({
      method: "POST",
      url: "/v1/orders",
      headers: { authorization: "Bearer gateway-token" },
      payload: command(),
    });
    const duplicate = await gateway.inject({
      method: "POST",
      url: "/v1/orders",
      headers: { authorization: "Bearer gateway-token" },
      payload: command("duplicate-command", "trace-gateway-duplicate"),
    });

    expect(first.statusCode).toBe(201);
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json()).toMatchObject({
      outcome: "deduplicated",
      commerceOrderId: "COM-0001",
      omsOrderId: "OMS-0001",
      posTicketId: "POS-0001",
      traceId: "trace-gateway-duplicate",
      originalTraceId: "trace-gateway-1",
      deduplicated: true,
    });
  });

  it("reports POS rejection and only claims compensation after OMS confirms", async () => {
    const { gateway, oms, pos } = await harness();
    await configure(pos, "pos-admin-token", "rejection-compensation-succeeds", {
      operation: "submit_pos_ticket",
      behavior: "reject",
    });
    const compensated = await gateway.inject({
      method: "POST",
      url: "/v1/orders",
      headers: { authorization: "Bearer gateway-token" },
      payload: command("rejection-compensation-succeeds"),
    });

    await configure(pos, "pos-admin-token", "rejection-compensation-fails", {
      operation: "submit_pos_ticket",
      behavior: "reject",
    });
    await configure(oms, "oms-admin-token", "rejection-compensation-fails", {
      operation: "cancel_order",
      behavior: "fail",
    });
    const uncompensated = await gateway.inject({
      method: "POST",
      url: "/v1/orders",
      headers: { authorization: "Bearer gateway-token" },
      payload: {
        ...command("rejection-compensation-fails", "trace-compensation-fails"),
        clientMessageId: "message-13",
        idempotencyKey: "kfc:anon_customer_123:message-13:placeOrder",
      },
    });

    expect(compensated.json()).toMatchObject({
      outcome: "pos_rejected",
      omsStatus: "cancelled",
      posStatus: "rejected",
      customerStatus: "failed",
      compensationStatus: "succeeded",
    });
    expect(uncompensated.json()).toMatchObject({
      outcome: "pos_rejected",
      omsStatus: "cancellation_failed",
      posStatus: "rejected",
      customerStatus: "failed",
      compensationStatus: "failed",
    });
  });

  it("classifies a POS timeout after OMS creation as ambiguous", async () => {
    const { gateway, pos } = await harness(20);
    await configure(pos, "pos-admin-token", "pos-timeout", {
      operation: "submit_pos_ticket",
      behavior: "delay",
      delayMs: 60,
    });
    const response = await gateway.inject({
      method: "POST",
      url: "/v1/orders",
      headers: { authorization: "Bearer gateway-token" },
      payload: command("pos-timeout"),
    });

    expect(response.statusCode).toBe(504);
    expect(response.json()).toMatchObject({
      outcome: "ambiguous_pos_submission",
      commerceOrderId: "COM-0001",
      omsOrderId: "OMS-0001",
      omsStatus: "created",
      customerStatus: "failed",
      compensationStatus: "not_required",
    });
    expect(response.json()).not.toHaveProperty("posTicketId");
  });

  it("cancels POS before OMS and reports partial cancellation truthfully", async () => {
    const { gateway, pos } = await harness();
    const placed = await gateway.inject({
      method: "POST",
      url: "/v1/orders",
      headers: { authorization: "Bearer gateway-token" },
      payload: command("partial-cancellation-failure"),
    });
    await configure(pos, "pos-admin-token", "partial-cancellation-failure", {
      operation: "cancel_pos_ticket",
      behavior: "fail",
    });
    const cancelled = await gateway.inject({
      method: "POST",
      url: `/v1/orders/${placed.json().commerceOrderId}/cancel`,
      headers: { authorization: "Bearer gateway-token" },
      payload: {
        traceId: "trace-cancel-partial",
        scenarioId: "partial-cancellation-failure",
      },
    });

    expect(cancelled.statusCode).toBe(409);
    expect(cancelled.json()).toMatchObject({
      outcome: "partial_cancellation",
      omsStatus: "created",
      posStatus: "cancellation_failed",
      customerStatus: "failed",
      conflictType: "pos_cancellation_failed",
    });
  });

  it("reports cancellation only after both POS and OMS confirm", async () => {
    const { gateway } = await harness();
    const placed = await gateway.inject({
      method: "POST",
      url: "/v1/orders",
      headers: { authorization: "Bearer gateway-token" },
      payload: command("successful-cancellation"),
    });
    const cancelled = await gateway.inject({
      method: "POST",
      url: `/v1/orders/${placed.json().commerceOrderId}/cancel`,
      headers: { authorization: "Bearer gateway-token" },
      payload: {
        traceId: "trace-cancel-success",
        scenarioId: "successful-cancellation",
      },
    });

    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json()).toMatchObject({
      outcome: "cancelled",
      omsStatus: "cancelled",
      posStatus: "cancelled",
      customerStatus: "cancelled",
    });
  });

  it("preserves conflicting raw OMS and POS status", async () => {
    const { gateway, pos } = await harness();
    await configure(pos, "pos-admin-token", "conflicting-status", {
      operation: "get_pos_ticket",
      behavior: "conflict",
    });
    const placed = await gateway.inject({
      method: "POST",
      url: "/v1/orders",
      headers: { authorization: "Bearer gateway-token" },
      payload: command("conflicting-status"),
    });
    const status = await gateway.inject({
      method: "GET",
      url: `/v1/orders/${placed.json().commerceOrderId}?traceId=trace-status-conflict`,
      headers: { authorization: "Bearer gateway-token" },
    });

    expect(status.statusCode).toBe(409);
    expect(status.json()).toMatchObject({
      outcome: "status_conflict",
      omsStatus: "created",
      posStatus: "cancelled",
      customerStatus: "failed",
      conflictType: "oms_created_pos_cancelled",
    });
  });
});
