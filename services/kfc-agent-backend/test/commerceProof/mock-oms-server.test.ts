import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
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

function providerHeaders(idempotencyKey: string, marker: string) {
  return {
    authorization: "Bearer oms-token",
    "idempotency-key": idempotencyKey,
    "x-provider-binding-fingerprint": marker.repeat(64),
  };
}

describe("commerce proof Mock OMS", () => {
  it("reports sandbox provider provenance and authenticated readiness", async () => {
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
      commerceEnvironment: "sandbox",
      providerImplementation: "http-adapter",
    });
    expect(unauthorizedReady.statusCode).toBe(401);
    expect(ready.json()).toMatchObject({
      ok: true,
      status: "ready",
      authenticated: true,
      commerceEnvironment: "sandbox",
      providerImplementation: "http-adapter",
    });
  });

  it("previews, creates, reuses, reads, and cancels an OMS order", async () => {
    const server = buildServer();
    const createHeaders = providerHeaders(
      "session:message:oms-create-order",
      "a",
    );

    const preview = await server.inject({
      method: "POST",
      url: "/v1/orders/preview",
      headers: { authorization: "Bearer oms-token" },
      payload: orderInput,
    });
    const first = await server.inject({
      method: "POST",
      url: "/v1/orders",
      headers: createHeaders,
      payload: orderInput,
    });
    const duplicate = await server.inject({
      method: "POST",
      url: "/v1/orders",
      headers: createHeaders,
      payload: orderInput,
    });
    const { omsOrderId } = z.object({
      omsOrderId: z.string(),
    }).parse(first.json());
    const found = await server.inject({
      method: "GET",
      url: `/v1/orders/${omsOrderId}`,
      headers: { authorization: "Bearer oms-token" },
    });
    const cancelled = await server.inject({
      method: "POST",
      url: `/v1/orders/${omsOrderId}/cancel`,
      headers: providerHeaders("session:message:oms-cancel-order", "b"),
      payload: {
        traceId: orderInput.traceId,
        scenarioId: orderInput.scenarioId,
        commerceOrderId: orderInput.commerceOrderId,
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
      commerceEnvironment: "sandbox",
      providerImplementation: "http-adapter",
      deduplicated: false,
    });
    expect(duplicate.statusCode).toBe(201);
    expect(duplicate.json()).toEqual(first.json());
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
        ...providerHeaders("compensation-failure:create", "c"),
      },
      payload: {
        ...orderInput,
        scenarioId: "rejection-compensation-fails",
      },
    });
    const cancellation = await server.inject({
      method: "POST",
      url: `/v1/orders/${placed.json().omsOrderId}/cancel`,
      headers: providerHeaders("compensation-failure:cancel", "d"),
      payload: {
        traceId: orderInput.traceId,
        scenarioId: "rejection-compensation-fails",
        commerceOrderId: orderInput.commerceOrderId,
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

  it("binds one key to the exact OMS operation, payload, and fingerprint", async () => {
    const server = buildServer();
    const exactHeaders = providerHeaders("provider-fence:oms", "e");
    const first = await server.inject({
      method: "POST",
      url: "/v1/orders",
      headers: exactHeaders,
      payload: orderInput,
    });
    const replay = await server.inject({
      method: "POST",
      url: "/v1/orders",
      headers: exactHeaders,
      payload: orderInput,
    });
    const rebound = await server.inject({
      method: "POST",
      url: "/v1/orders",
      headers: {
        ...exactHeaders,
        "x-provider-binding-fingerprint": "f".repeat(64),
      },
      payload: orderInput,
    });
    const changedPayload = await server.inject({
      method: "POST",
      url: "/v1/orders",
      headers: exactHeaders,
      payload: { ...orderInput, totalVnd: orderInput.totalVnd + 1 },
    });
    const changedOperation = await server.inject({
      method: "POST",
      url: `/v1/orders/${first.json().omsOrderId}/cancel`,
      headers: exactHeaders,
      payload: {
        traceId: orderInput.traceId,
        scenarioId: orderInput.scenarioId,
        commerceOrderId: orderInput.commerceOrderId,
      },
    });

    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(first.json());
    for (const conflict of [rebound, changedPayload, changedOperation]) {
      expect(conflict.statusCode).toBe(409);
      expect(conflict.json().errorCode).toBe(
        "provider_idempotency_conflict",
      );
    }
  });

  it("rejects invalid identity without retroactively binding the key", async () => {
    const server = buildServer();
    const invalid = await server.inject({
      method: "POST",
      url: "/v1/orders",
      headers: {
        authorization: "Bearer oms-token",
        "idempotency-key": " provider-fence:unbound",
        "x-provider-binding-fingerprint": "a".repeat(64),
      },
      payload: orderInput,
    });
    const valid = await server.inject({
      method: "POST",
      url: "/v1/orders",
      headers: providerHeaders("provider-fence:unbound", "a"),
      payload: orderInput,
    });

    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().errorCode).toBe(
      "provider_mutation_identity_required",
    );
    expect(valid.statusCode).toBe(201);
    expect(valid.json().omsOrderId).toBe("OMS-0001");
  });

  it("returns unknown for an exact in-flight retry and later replays once", async () => {
    const server = buildServer();
    await server.inject({
      method: "PUT",
      url: "/__admin/scenarios/delayed-oms-create",
      headers: { authorization: "Bearer oms-admin-token" },
      payload: {
        operation: "create_order",
        behavior: "delay",
        delayMs: 40,
      },
    });
    const payload = {
      ...orderInput,
      scenarioId: "delayed-oms-create",
    };
    const headers = providerHeaders("provider-fence:delayed-oms", "9");
    const firstPromise = server.inject({
      method: "POST",
      url: "/v1/orders",
      headers,
      payload,
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const pending = await server.inject({
      method: "POST",
      url: "/v1/orders",
      headers,
      payload,
    });
    const first = await firstPromise;
    const replay = await server.inject({
      method: "POST",
      url: "/v1/orders",
      headers,
      payload,
    });

    expect(pending.statusCode).toBe(503);
    expect(pending.json().errorCode).toBe(
      "provider_idempotency_outcome_unknown",
    );
    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(first.json());
  });
});
