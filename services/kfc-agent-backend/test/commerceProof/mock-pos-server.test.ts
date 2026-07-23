import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
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

function providerHeaders(idempotencyKey: string, marker: string) {
  return {
    authorization: "Bearer pos-token",
    "idempotency-key": idempotencyKey,
    "x-provider-binding-fingerprint": marker.repeat(64),
  };
}

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
    const submitHeaders = providerHeaders(
      "session:message:pos-submit-ticket",
      "a",
    );
    const first = await server.inject({
      method: "POST",
      url: "/v1/tickets",
      headers: submitHeaders,
      payload: ticketInput,
    });
    const duplicate = await server.inject({
      method: "POST",
      url: "/v1/tickets",
      headers: submitHeaders,
      payload: ticketInput,
    });
    const { posTicketId } = z.object({
      posTicketId: z.string(),
    }).parse(first.json());
    const found = await server.inject({
      method: "GET",
      url: `/v1/tickets/${posTicketId}`,
      headers: { authorization: "Bearer pos-token" },
    });
    const cancelled = await server.inject({
      method: "POST",
      url: `/v1/tickets/${posTicketId}/cancel`,
      headers: providerHeaders("session:message:pos-cancel-ticket", "b"),
      payload: {
        traceId: ticketInput.traceId,
        scenarioId: ticketInput.scenarioId,
        commerceOrderId: ticketInput.commerceOrderId,
        omsOrderId: ticketInput.omsOrderId,
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
    expect(duplicate.statusCode).toBe(201);
    expect(duplicate.json()).toEqual(first.json());
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
        ...providerHeaders("rejected-ticket", "c"),
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
        ...providerHeaders("delayed-ticket", "d"),
      },
      payload: { ...ticketInput, scenarioId: "pos-timeout" },
    });
    const normal = await server.inject({
      method: "POST",
      url: "/v1/tickets",
      headers: {
        ...providerHeaders("normal-ticket", "e"),
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
        ...providerHeaders("partial-cancellation:create", "f"),
      },
      payload: { ...ticketInput, scenarioId: "partial-cancellation-failure" },
    });
    const cancellation = await server.inject({
      method: "POST",
      url: `/v1/tickets/${placed.json().posTicketId}/cancel`,
      headers: providerHeaders("partial-cancellation:cancel", "1"),
      payload: {
        traceId: ticketInput.traceId,
        scenarioId: "partial-cancellation-failure",
        commerceOrderId: ticketInput.commerceOrderId,
        omsOrderId: ticketInput.omsOrderId,
      },
    });

    expect(unauthorized.statusCode).toBe(401);
    expect(cancellation.statusCode).toBe(409);
    expect(cancellation.json()).toMatchObject({
      errorCode: "pos_cancellation_failed",
      posStatus: "cancellation_failed",
    });
  });

  it("binds one key to the exact POS operation, payload, and fingerprint", async () => {
    const server = buildServer();
    const exactHeaders = providerHeaders("provider-fence:pos", "2");
    const first = await server.inject({
      method: "POST",
      url: "/v1/tickets",
      headers: exactHeaders,
      payload: ticketInput,
    });
    const replay = await server.inject({
      method: "POST",
      url: "/v1/tickets",
      headers: exactHeaders,
      payload: ticketInput,
    });
    const rebound = await server.inject({
      method: "POST",
      url: "/v1/tickets",
      headers: {
        ...exactHeaders,
        "x-provider-binding-fingerprint": "3".repeat(64),
      },
      payload: ticketInput,
    });
    const changedPayload = await server.inject({
      method: "POST",
      url: "/v1/tickets",
      headers: exactHeaders,
      payload: { ...ticketInput, totalVnd: ticketInput.totalVnd + 1 },
    });
    const changedOperation = await server.inject({
      method: "POST",
      url: `/v1/tickets/${first.json().posTicketId}/cancel`,
      headers: exactHeaders,
      payload: {
        traceId: ticketInput.traceId,
        scenarioId: ticketInput.scenarioId,
        commerceOrderId: ticketInput.commerceOrderId,
        omsOrderId: ticketInput.omsOrderId,
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
      url: "/v1/tickets",
      headers: {
        authorization: "Bearer pos-token",
        "idempotency-key": "provider-fence:unbound ",
        "x-provider-binding-fingerprint": "4".repeat(64),
      },
      payload: ticketInput,
    });
    const valid = await server.inject({
      method: "POST",
      url: "/v1/tickets",
      headers: providerHeaders("provider-fence:unbound", "4"),
      payload: ticketInput,
    });

    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().errorCode).toBe(
      "provider_mutation_identity_required",
    );
    expect(valid.statusCode).toBe(201);
    expect(valid.json().posTicketId).toBe("POS-0001");
  });

  it("returns unknown for an exact in-flight retry and later replays once", async () => {
    const server = buildServer();
    await server.inject({
      method: "PUT",
      url: "/__admin/scenarios/delayed-pos-submit",
      headers: { authorization: "Bearer pos-admin-token" },
      payload: {
        operation: "submit_pos_ticket",
        behavior: "delay",
        delayMs: 40,
      },
    });
    const payload = {
      ...ticketInput,
      scenarioId: "delayed-pos-submit",
    };
    const headers = providerHeaders("provider-fence:delayed-pos", "5");
    const firstPromise = server.inject({
      method: "POST",
      url: "/v1/tickets",
      headers,
      payload,
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const pending = await server.inject({
      method: "POST",
      url: "/v1/tickets",
      headers,
      payload,
    });
    const first = await firstPromise;
    const replay = await server.inject({
      method: "POST",
      url: "/v1/tickets",
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
