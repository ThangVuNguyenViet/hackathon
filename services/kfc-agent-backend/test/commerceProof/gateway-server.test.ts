import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { createKfcCommerceGatewayClients } from "../../src/clients/kfcCommerceGateway.js";
import { buildCommerceProofGatewayServer } from "../../src/commerceProof/gatewayServer.js";
import { buildCommerceProofMockOmsServer } from "../../src/commerceProof/mockOmsServer.js";
import { buildCommerceProofMockPosServer } from "../../src/commerceProof/mockPosServer.js";
import {
  commerceContractVersion,
  sandboxCommerceProofProviderProvenance,
} from "../../src/commerceProof/contracts.js";
import {
  createCommerceProofGatewayMutationState,
  type CommerceProofGatewayMutationState,
} from "../../src/commerceProof/gatewayMutationContracts.js";
import type { Order } from "../../src/domain/types.js";
import { OrderingDataService } from "../../src/ordering/orderingDataService.js";
import { createTestFixtures } from "../fixtures/testFixtures.js";

const servers: FastifyInstance[] = [];

function must<Value>(
  value: Value | null | undefined,
  message: string,
): Value {
  if (value === null || value === undefined) throw new Error(message);
  return value;
}

function deferred() {
  let resolver: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolver = resolve;
  });
  return {
    promise,
    resolve() {
      if (!resolver) throw new Error("deferred_resolver_missing");
      resolver();
    },
  };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).reverse().map((server) => server.close()));
  vi.restoreAllMocks();
});

async function listen(server: FastifyInstance): Promise<string> {
  servers.push(server);
  return server.listen({ host: "127.0.0.1", port: 0 });
}

interface HarnessObservers {
  onPosTicketResponse?: () => void;
  onPosCancellationResponse?: () => void;
  onOmsCancellationResponse?: () => void;
}

async function harness(
  timeoutMs = 3000,
  mutationState: CommerceProofGatewayMutationState =
    createCommerceProofGatewayMutationState(),
  observers: HarnessObservers = {},
) {
  const downstreamCalls: string[] = [];
  const oms = buildCommerceProofMockOmsServer({
    token: "oms-token",
    adminToken: "oms-admin-token",
  });
  const pos = buildCommerceProofMockPosServer({
    token: "pos-token",
    adminToken: "pos-admin-token",
  });
  oms.addHook("onRequest", async (request) => {
    if (request.method !== "POST") return;
    if (request.url === "/v1/orders") downstreamCalls.push("oms:create");
    if (request.url.endsWith("/cancel")) downstreamCalls.push("oms:cancel");
  });
  oms.addHook("onSend", async (request, reply, payload) => {
    if (
      observers.onOmsCancellationResponse &&
      request.method === "POST" &&
      request.url.endsWith("/cancel") &&
      reply.statusCode === 200
    ) {
      observers.onOmsCancellationResponse();
    }
    return payload;
  });
  pos.addHook("onRequest", async (request) => {
    if (request.method !== "POST") return;
    if (request.url === "/v1/tickets") downstreamCalls.push("pos:create");
    if (request.url.endsWith("/cancel")) downstreamCalls.push("pos:cancel");
  });
  pos.addHook("onSend", async (request, reply, payload) => {
    if (
      observers.onPosTicketResponse &&
      request.method === "POST" &&
      request.url === "/v1/tickets" &&
      reply.statusCode === 201
    ) {
      observers.onPosTicketResponse();
    }
    if (
      observers.onPosCancellationResponse &&
      request.method === "POST" &&
      request.url.endsWith("/cancel") &&
      reply.statusCode === 200
    ) {
      observers.onPosCancellationResponse();
    }
    return payload;
  });
  const [omsBaseUrl, posBaseUrl] = await Promise.all([listen(oms), listen(pos)]);
  const gateway = buildCommerceProofGatewayServer({
    token: "gateway-token",
    oms: { baseUrl: omsBaseUrl, token: "oms-token" },
    pos: { baseUrl: posBaseUrl, token: "pos-token" },
    timeoutMs,
    readinessTimeoutMs: 3000,
    mutationState,
    persistMutationSnapshot: async () => {},
  });
  servers.push(gateway);
  return { downstreamCalls, gateway, mutationState, oms, pos };
}

function command(scenarioId = "successful-placement", traceId = "trace-gateway-1") {
  return {
    contractVersion: commerceContractVersion,
    traceId,
    scenarioId,
    sessionId: "kfc:anon_customer_123",
    clientMessageId: "message-12",
    idempotencyKey: "kfc:anon_customer_123:message-12:placeOrder",
    bindingFingerprint: "a".repeat(64),
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

function mutationIdentity(idempotencyKey: string, marker = "a") {
  return {
    idempotencyKey,
    bindingFingerprint: marker.repeat(64),
  };
}

function paymentOrder(id: string): Order {
  return {
    id,
    cart: {
      id: "cart-payment",
      items: [],
      subtotalVnd: 0,
      discountVnd: 0,
      deliveryFeeVnd: 0,
      totalVnd: 0,
      voucherCode: null,
    },
    status: "created",
    paymentStatus: "not_started",
    assignedStoreId: "KFCVN0001",
    createdAt: "2026-07-20T00:00:00.000Z",
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
      commerceEnvironment: "sandbox",
      providerImplementation: "http-adapter",
      checks: {
        oms: {
          status: "ready",
          configured: true,
          reachable: true,
          authenticated: true,
          commerceEnvironment: "sandbox",
          providerImplementation: "http-adapter",
        },
        pos: {
          status: "ready",
          configured: true,
          reachable: true,
          authenticated: true,
          commerceEnvironment: "sandbox",
          providerImplementation: "http-adapter",
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
      mutationState: createCommerceProofGatewayMutationState(),
      persistMutationSnapshot: async () => {},
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

  it("serves the complete sandbox order and payment client contract", async () => {
    const { gateway } = await harness();
    const baseUrl = await gateway.listen({ host: "127.0.0.1", port: 0 });
    const clients = createKfcCommerceGatewayClients({
      baseUrl,
      token: "gateway-token",
    });
    const externalCallContext = {
      signal: new AbortController().signal,
      deadlineAt: Date.now() + 10_000,
    };
    const preview = await clients.oms.previewOrder({
      cart: {
        id: "cart-sandbox",
        items: [{ itemCode: "20702", name: "Combo", quantity: 1, unitPriceVnd: 129000 }],
        subtotalVnd: 129000,
        discountVnd: 0,
        deliveryFeeVnd: 18000,
        totalVnd: 147000,
        voucherCode: null,
      },
      address: {
        label: "Delivery",
        line1: "23 Nguyễn Hữu Thọ",
        district: "Quận 7",
        city: "Hồ Chí Minh",
      },
      storeId: "KFCVN0001",
    }, externalCallContext);
    expect(preview.ok).toBe(true);
    const previewValue = must(preview.value, "preview result missing");

    const placed = await clients.oms.placeOrder({
      preview: previewValue,
      userConfirmed: true,
      context: {
        sessionId: "kfc:sandbox-client-contract",
        clientMessageId: "message-1",
        traceId: "trace-sandbox-client-contract",
        scenarioId: "sandbox-client-contract",
      },
    }, externalCallContext, mutationIdentity("client-contract:placeOrder"));
    expect(placed).toMatchObject({ ok: true, value: { status: "created" } });
    const placedValue = must(placed.value, "placed order result missing");

    const methods = await clients.payment.listMethods(
      { query: "ZaloPay" },
      externalCallContext,
    );
    expect(methods.ok).toBe(true);
    expect(methods.value).toContainEqual(expect.objectContaining({
      methodId: "zalopay_wallet",
      supported: true,
    }));
    await expect(clients.payment.createPaymentLink(
      placedValue,
      "zalopay_wallet",
      externalCallContext,
      mutationIdentity("client-contract:createPaymentLink", "b"),
    )).resolves.toMatchObject({
      ok: true,
      value: { status: "pending" },
    });
    await expect(clients.payment.checkPaymentStatus(
      placedValue.id,
      externalCallContext,
    )).resolves.toMatchObject({
      ok: true,
      value: { status: "pending" },
    });
    await expect(clients.oms.getOrderStatus(
      placedValue.id,
      externalCallContext,
    )).resolves.toMatchObject({
      ok: true,
      value: { id: placedValue.id, status: "created" },
    });
    await expect(clients.oms.cancelOrder(
      placedValue.id,
      externalCallContext,
      mutationIdentity("client-contract:cancelOrder", "c"),
    )).resolves.toMatchObject({
      ok: true,
      value: { id: placedValue.id, status: "cancelled" },
    });
  });

  it("preserves an opaque payment method ID across sandbox HTTP dispatch and encodes it in the returned URL", async () => {
    const methodId =
      "sandbox/支付?method=ví điện tử#%" + "🧾".repeat(300);
    const listed = createTestFixtures().paymentMethods.find(
      (method) => method.methodId === "zalopay_wallet",
    );
    if (!listed) throw new Error("listed payment fixture missing");
    const lookup = vi
      .spyOn(OrderingDataService.prototype, "getPaymentMethodForLink")
      .mockImplementation((receivedMethodId) =>
        receivedMethodId === methodId
          ? { ...listed, methodId: receivedMethodId }
          : undefined,
      );
    const { gateway } = await harness();
    const placed = await gateway.inject({
      method: "POST",
      url: "/v1/orders",
      headers: { authorization: "Bearer gateway-token" },
      payload: command("opaque-payment-dispatch"),
    });
    expect(placed.statusCode).toBe(201);
    const commerceOrderId =
      placed.json<{ commerceOrderId: string }>().commerceOrderId;
    const baseUrl = await gateway.listen({ host: "127.0.0.1", port: 0 });
    const clients = createKfcCommerceGatewayClients({
      baseUrl,
      token: "gateway-token",
    });

    const result = await clients.payment.createPaymentLink(
      paymentOrder(commerceOrderId),
      methodId,
      {
        signal: new AbortController().signal,
        deadlineAt: Date.now() + 10_000,
      },
      mutationIdentity("opaque-payment:createPaymentLink", "d"),
    );

    expect(lookup).toHaveBeenCalledOnce();
    expect(lookup).toHaveBeenCalledWith(methodId);
    expect(result).toMatchObject({
      ok: true,
      value: {
        url:
          `https://pay.sandbox.invalid/method-${encodeURIComponent(methodId)}/` +
          `order-${encodeURIComponent(commerceOrderId)}`,
        status: "pending",
      },
    });
  });

  it.each([".", ".."])(
    "keeps the exact %s opaque ID as a distinct sandbox payment URL segment",
    async (methodId) => {
      const listed = createTestFixtures().paymentMethods.find(
        (method) => method.methodId === "zalopay_wallet",
      );
      if (!listed) throw new Error("listed payment fixture missing");
      const lookup = vi
        .spyOn(OrderingDataService.prototype, "getPaymentMethodForLink")
        .mockImplementation((receivedMethodId) =>
          receivedMethodId === methodId
            ? { ...listed, methodId: receivedMethodId }
            : undefined,
        );
      const { gateway } = await harness();
      const placed = await gateway.inject({
        method: "POST",
        url: "/v1/orders",
        headers: { authorization: "Bearer gateway-token" },
        payload: command(`dot-payment-dispatch-${methodId.length}`),
      });
      expect(placed.statusCode).toBe(201);
      const commerceOrderId =
        placed.json<{ commerceOrderId: string }>().commerceOrderId;
      const baseUrl = await gateway.listen({ host: "127.0.0.1", port: 0 });
      const clients = createKfcCommerceGatewayClients({
        baseUrl,
        token: "gateway-token",
      });

      const result = await clients.payment.createPaymentLink(
        paymentOrder(commerceOrderId),
        methodId,
        {
          signal: new AbortController().signal,
          deadlineAt: Date.now() + 10_000,
        },
        mutationIdentity(
          `dot-payment-${methodId.length}:createPaymentLink`,
          "e",
        ),
      );

      expect(lookup).toHaveBeenCalledOnce();
      expect(lookup).toHaveBeenCalledWith(methodId);
      expect(result.value?.url).toBe(
        `https://pay.sandbox.invalid/method-${methodId}/order-${encodeURIComponent(commerceOrderId)}`,
      );
      expect(
        new URL(must(result.value, "payment link result missing").url).pathname,
      ).toBe(`/method-${methodId}/order-${encodeURIComponent(commerceOrderId)}`);
    },
  );

  it("rejects a lone-surrogate payment ID from a direct Fastify JSON body before provider lookup", async () => {
    const lookup = vi.spyOn(
      OrderingDataService.prototype,
      "getPaymentMethodForLink",
    );
    const { gateway } = await harness();

    const response = await gateway.inject({
      method: "POST",
      url: "/v1/orders/not-created/payment-links",
      headers: { authorization: "Bearer gateway-token" },
      payload: {
        methodId: "\ud800",
        ...mutationIdentity("surrogate-payment:createPaymentLink", "f"),
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      ok: false,
      errorCode: "invalid_payment_link_request",
    });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("rejects sandbox payment methods that are flagged supported without listed support authority", async () => {
    const methodId = "sandbox-supported-but-not-listed";
    const listed = createTestFixtures().paymentMethods.find(
      (method) => method.methodId === "zalopay_wallet",
    );
    if (!listed) throw new Error("listed payment fixture missing");
    const lookup = vi
      .spyOn(OrderingDataService.prototype, "getPaymentMethodForLink")
      .mockImplementation((receivedMethodId) =>
        receivedMethodId === methodId
          ? {
              ...listed,
              methodId: receivedMethodId,
              supported: true,
              supportStatus: "not_listed_in_policy",
            }
          : undefined,
      );
    const { gateway } = await harness();
    const placed = await gateway.inject({
      method: "POST",
      url: "/v1/orders",
      headers: { authorization: "Bearer gateway-token" },
      payload: command("unlisted-payment-dispatch"),
    });
    expect(placed.statusCode).toBe(201);
    const commerceOrderId =
      placed.json<{ commerceOrderId: string }>().commerceOrderId;
    const baseUrl = await gateway.listen({ host: "127.0.0.1", port: 0 });
    const clients = createKfcCommerceGatewayClients({
      baseUrl,
      token: "gateway-token",
    });

    const result = await clients.payment.createPaymentLink(
      paymentOrder(commerceOrderId),
      methodId,
      {
        signal: new AbortController().signal,
        deadlineAt: Date.now() + 10_000,
      },
      mutationIdentity("unsupported-payment:createPaymentLink", "1"),
    );

    expect(lookup).toHaveBeenCalledOnce();
    expect(lookup).toHaveBeenCalledWith(methodId);
    expect(result).toMatchObject({
      ok: false,
      errorCode: "payment_method_unsupported",
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
      commerceEnvironment: "sandbox",
      providerProvenance: sandboxCommerceProofProviderProvenance,
    });
  });

  it("replays the exact gateway result without another OMS or POS submission", async () => {
    const { downstreamCalls, gateway } = await harness();
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
      payload: command("successful-placement", "trace-gateway-duplicate"),
    });

    expect(first.statusCode).toBe(201);
    expect(duplicate.statusCode).toBe(201);
    expect(duplicate.json()).toEqual(first.json());
    expect(downstreamCalls).toEqual(["oms:create", "pos:create"]);
  });

  it("shares one in-flight order mutation across exact concurrent retries", async () => {
    const { downstreamCalls, gateway, pos } = await harness();
    await configure(pos, "pos-admin-token", "concurrent-idempotency", {
      operation: "submit_pos_ticket",
      behavior: "delay",
      delayMs: 40,
    });
    const request = {
      method: "POST" as const,
      url: "/v1/orders",
      headers: { authorization: "Bearer gateway-token" },
      payload: command("concurrent-idempotency"),
    };

    const [left, right] = await Promise.all([
      gateway.inject(request),
      gateway.inject(request),
    ]);

    expect([left.statusCode, right.statusCode]).toEqual([201, 201]);
    expect(right.json()).toEqual(left.json());
    expect(downstreamCalls).toEqual(["oms:create", "pos:create"]);
  });

  it("rejects reuse of an order idempotency key for a different binding", async () => {
    const { downstreamCalls, gateway } = await harness();
    const first = await gateway.inject({
      method: "POST",
      url: "/v1/orders",
      headers: { authorization: "Bearer gateway-token" },
      payload: command(),
    });
    const conflict = await gateway.inject({
      method: "POST",
      url: "/v1/orders",
      headers: { authorization: "Bearer gateway-token" },
      payload: {
        ...command(),
        bindingFingerprint: "b".repeat(64),
      },
    });

    expect(first.statusCode).toBe(201);
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({
      ok: false,
      errorCode: "provider_idempotency_conflict",
    });
    expect(downstreamCalls).toEqual(["oms:create", "pos:create"]);
  });

  it("replays one exact payment mutation and conflicts on rebinding", async () => {
    const lookup = vi.spyOn(
      OrderingDataService.prototype,
      "getPaymentMethodForLink",
    );
    const { gateway } = await harness();
    const placed = await gateway.inject({
      method: "POST",
      url: "/v1/orders",
      headers: { authorization: "Bearer gateway-token" },
      payload: command("payment-idempotency"),
    });
    const commerceOrderId =
      placed.json<{ commerceOrderId: string }>().commerceOrderId;
    const request = {
      method: "POST" as const,
      url: `/v1/orders/${commerceOrderId}/payment-links`,
      headers: { authorization: "Bearer gateway-token" },
      payload: {
        methodId: "zalopay_wallet",
        idempotencyKey: "confirmation:request-2:createPaymentLink:digest",
        bindingFingerprint: "c".repeat(64),
      },
    };

    const first = await gateway.inject(request);
    const replay = await gateway.inject(request);
    const conflict = await gateway.inject({
      ...request,
      payload: {
        ...request.payload,
        bindingFingerprint: "d".repeat(64),
      },
    });

    expect(first.statusCode).toBe(200);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(first.json());
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({
      ok: false,
      errorCode: "provider_idempotency_conflict",
    });
    expect(lookup).toHaveBeenCalledOnce();
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

  it("retains a POS timeout as unknown and resumes the exact POS phase", async () => {
    const providerCompleted = deferred();
    const { downstreamCalls, gateway, mutationState, pos } = await harness(
      100,
      createCommerceProofGatewayMutationState(),
      { onPosTicketResponse: providerCompleted.resolve },
    );
    await configure(pos, "pos-admin-token", "pos-timeout", {
      operation: "submit_pos_ticket",
      behavior: "delay",
      delayMs: 300,
    });
    const response = await gateway.inject({
      method: "POST",
      url: "/v1/orders",
      headers: { authorization: "Bearer gateway-token" },
      payload: command("pos-timeout"),
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      commerceOrderId: "COM-0001",
      errorCode: "provider_idempotency_outcome_unknown",
    });
    expect(response.json()).not.toHaveProperty("posTicketId");
    expect(
      mutationState.ordersByIdempotencyKey.get(
        command("pos-timeout").idempotencyKey,
      ),
    ).toMatchObject({
      state: "pos_submit_unknown",
      commerceOrderId: "COM-0001",
      omsOrderId: "OMS-0001",
    });

    await providerCompleted.promise;
    const resumed = await gateway.inject({
      method: "POST",
      url: "/v1/orders",
      headers: { authorization: "Bearer gateway-token" },
      payload: command("pos-timeout"),
    });

    expect(resumed.statusCode).toBe(201);
    expect(resumed.json()).toMatchObject({
      outcome: "accepted",
      commerceOrderId: "COM-0001",
      omsOrderId: "OMS-0001",
      posTicketId: "POS-0001",
    });
    expect(downstreamCalls).toEqual([
      "oms:create",
      "pos:create",
      "pos:create",
    ]);
  });

  it("cancels POS before OMS and reports partial cancellation truthfully", async () => {
    const { downstreamCalls, gateway, pos } = await harness();
    const placed = await gateway.inject({
      method: "POST",
      url: "/v1/orders",
      headers: { authorization: "Bearer gateway-token" },
      payload: command("partial-cancellation-failure"),
    });
    downstreamCalls.length = 0;
    await configure(pos, "pos-admin-token", "partial-cancellation-failure", {
      operation: "cancel_pos_ticket",
      behavior: "fail",
    });
    const cancelled = await gateway.inject({
      method: "POST",
      url: `/v1/orders/${placed.json().commerceOrderId}/cancel`,
      headers: { authorization: "Bearer gateway-token" },
      payload: {
        ...mutationIdentity("partial-cancellation:cancelOrder", "2"),
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
    expect(downstreamCalls).toEqual(["pos:cancel"]);
  });

  it("reports cancellation only after both POS and OMS confirm", async () => {
    const { downstreamCalls, gateway } = await harness();
    const placed = await gateway.inject({
      method: "POST",
      url: "/v1/orders",
      headers: { authorization: "Bearer gateway-token" },
      payload: command("successful-cancellation"),
    });
    downstreamCalls.length = 0;
    const cancelled = await gateway.inject({
      method: "POST",
      url: `/v1/orders/${placed.json().commerceOrderId}/cancel`,
      headers: { authorization: "Bearer gateway-token" },
      payload: {
        ...mutationIdentity("successful-cancellation:cancelOrder", "3"),
      },
    });

    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json()).toMatchObject({
      outcome: "cancelled",
      omsStatus: "cancelled",
      posStatus: "cancelled",
      customerStatus: "cancelled",
    });
    expect(downstreamCalls).toEqual(["pos:cancel", "oms:cancel"]);
  });

  it("resumes an unknown POS cancellation with the same phase identity", async () => {
    const providerCompleted = deferred();
    const { downstreamCalls, gateway, mutationState, pos } =
      await harness(
        100,
        createCommerceProofGatewayMutationState(),
        { onPosCancellationResponse: providerCompleted.resolve },
      );
    const placed = await gateway.inject({
      method: "POST",
      url: "/v1/orders",
      headers: { authorization: "Bearer gateway-token" },
      payload: command("pos-cancellation-timeout"),
    });
    downstreamCalls.length = 0;
    await configure(pos, "pos-admin-token", "pos-cancellation-timeout", {
      operation: "cancel_pos_ticket",
      behavior: "delay",
      delayMs: 300,
    });
    const payload = mutationIdentity(
      "pos-cancellation-timeout:cancelOrder",
      "4",
    );
    const url = `/v1/orders/${placed.json().commerceOrderId}/cancel`;
    const first = await gateway.inject({
      method: "POST",
      url,
      headers: { authorization: "Bearer gateway-token" },
      payload,
    });
    const pending = must(
      mutationState.cancellationsByIdempotencyKey.get(
        payload.idempotencyKey,
      ),
      "pending POS cancellation missing",
    );
    const originalContext = structuredClone(pending.context);
    const originalIdentity = structuredClone(pending.posCancelIdentity);

    expect(first.statusCode).toBe(503);
    expect(first.json().errorCode).toBe(
      "provider_idempotency_outcome_unknown",
    );
    expect(pending.state).toBe("pos_cancel_unknown");

    await providerCompleted.promise;
    const resumed = await gateway.inject({
      method: "POST",
      url,
      headers: { authorization: "Bearer gateway-token" },
      payload,
    });

    expect(resumed.statusCode).toBe(200);
    expect(pending.state).toBe("completed");
    expect(pending.context).toEqual(originalContext);
    expect(pending.posCancelIdentity).toEqual(originalIdentity);
    expect(downstreamCalls).toEqual([
      "pos:cancel",
      "pos:cancel",
      "oms:cancel",
    ]);
  });

  it("resumes an unknown OMS cancellation without repeating POS", async () => {
    const providerCompleted = deferred();
    const { downstreamCalls, gateway, mutationState, oms } =
      await harness(
        100,
        createCommerceProofGatewayMutationState(),
        { onOmsCancellationResponse: providerCompleted.resolve },
      );
    const placed = await gateway.inject({
      method: "POST",
      url: "/v1/orders",
      headers: { authorization: "Bearer gateway-token" },
      payload: command("oms-cancellation-timeout"),
    });
    downstreamCalls.length = 0;
    await configure(oms, "oms-admin-token", "oms-cancellation-timeout", {
      operation: "cancel_order",
      behavior: "delay",
      delayMs: 300,
    });
    const payload = mutationIdentity(
      "oms-cancellation-timeout:cancelOrder",
      "5",
    );
    const url = `/v1/orders/${placed.json().commerceOrderId}/cancel`;
    const first = await gateway.inject({
      method: "POST",
      url,
      headers: { authorization: "Bearer gateway-token" },
      payload,
    });
    const pending = must(
      mutationState.cancellationsByIdempotencyKey.get(
        payload.idempotencyKey,
      ),
      "pending OMS cancellation missing",
    );
    const originalContext = structuredClone(pending.context);
    const originalOmsIdentity = structuredClone(pending.omsCancelIdentity);

    expect(first.statusCode).toBe(503);
    expect(pending.state).toBe("oms_cancel_unknown");

    await providerCompleted.promise;
    const resumed = await gateway.inject({
      method: "POST",
      url,
      headers: { authorization: "Bearer gateway-token" },
      payload,
    });

    expect(resumed.statusCode).toBe(200);
    expect(pending.state).toBe("completed");
    expect(pending.context).toEqual(originalContext);
    expect(pending.omsCancelIdentity).toEqual(originalOmsIdentity);
    expect(downstreamCalls).toEqual([
      "pos:cancel",
      "oms:cancel",
      "oms:cancel",
    ]);
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
