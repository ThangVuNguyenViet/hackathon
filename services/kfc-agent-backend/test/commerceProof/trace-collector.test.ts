import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildCommerceProofTraceCollector } from "../../src/commerceProof/traceCollector.js";

const servers: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

function buildCollector() {
  const server = buildCommerceProofTraceCollector({
    token: "collector-token",
    runId: "proof-run-1",
  });
  servers.push(server);
  return server;
}

function event(eventType: "gateway_request" | "mock_oms_request") {
  return {
    timestamp: "2026-07-11T00:00:00.000Z",
    runId: "proof-run-1",
    scenarioId: "successful-placement",
    traceId: "trace-1",
    service: "demo-commerce-gateway",
    eventType,
    status: "ok",
    durationMs: 4,
    simulated: true,
    identifiers: { commerceOrderId: "COM-0001" },
    statuses: {},
    inputSummary: { itemCodes: ["20751"] },
    outputSummary: {},
  };
}

describe("commerce proof trace collector", () => {
  it("assigns a monotonic sequence and returns events by trace", async () => {
    const collector = buildCollector();
    const headers = { authorization: "Bearer collector-token" };
    const first = await collector.inject({
      method: "POST",
      url: "/__proof/events",
      headers,
      payload: event("gateway_request"),
    });
    const second = await collector.inject({
      method: "POST",
      url: "/__proof/events",
      headers,
      payload: event("mock_oms_request"),
    });
    const trace = await collector.inject({
      method: "GET",
      url: "/__proof/traces/trace-1",
      headers,
    });

    expect(first.statusCode).toBe(202);
    expect(first.json()).toMatchObject({ accepted: true, sequence: 1 });
    expect(second.json()).toMatchObject({ accepted: true, sequence: 2 });
    expect(trace.json().events).toMatchObject([
      { sequence: 1, eventType: "gateway_request" },
      { sequence: 2, eventType: "mock_oms_request" },
    ]);
  });

  it("rejects invalid tokens, run IDs, and unsafe fields", async () => {
    const collector = buildCollector();
    const unauthorized = await collector.inject({
      method: "POST",
      url: "/__proof/events",
      payload: event("gateway_request"),
    });
    const wrongRun = await collector.inject({
      method: "POST",
      url: "/__proof/events",
      headers: { authorization: "Bearer collector-token" },
      payload: { ...event("gateway_request"), runId: "another-run" },
    });
    const unsafe = await collector.inject({
      method: "POST",
      url: "/__proof/events",
      headers: { authorization: "Bearer collector-token" },
      payload: {
        ...event("gateway_request"),
        inputSummary: { authorization: "Bearer leaked-token" },
      },
    });

    expect(unauthorized.statusCode).toBe(401);
    expect(wrongRun.statusCode).toBe(409);
    expect(unsafe.statusCode).toBe(400);
    expect(unsafe.json().message).toMatch(/unsafe trace field/i);
  });
});
