import { describe, expect, it, vi } from "vitest";
import { createKfcCommerceGatewayClients } from "../../src/clients/kfcCommerceGateway.js";
import type { ExternalCallContext } from "../../src/clients/interfaces.js";
import { sandboxCommerceProofProviderProvenance } from "../../src/commerceProof/contracts.js";
import type { Order } from "../../src/domain/types.js";

const order: Order = {
  id: "KFC-REAL-42",
  status: "created",
  paymentStatus: "pending",
  assignedStoreId: "store-1",
  createdAt: "2026-07-11T00:00:00.000Z",
  cart: {
    id: "cart-1",
    items: [],
    subtotalVnd: 0,
    discountVnd: 0,
    deliveryFeeVnd: 0,
    totalVnd: 0,
    voucherCode: null,
  },
};

function externalCallContext(
  signal = new AbortController().signal,
): ExternalCallContext {
  return { signal, deadlineAt: Date.now() + 10_000 };
}

function mutationIdentity(suffix: string) {
  return {
    idempotencyKey: `gateway-test:${suffix}`,
    bindingFingerprint: "a".repeat(64),
  };
}

function orderContext(suffix: string) {
  return {
    sessionId: "session-1",
    clientMessageId: `message-${suffix}`,
    traceId: `trace-${suffix}`,
    scenarioId: `scenario-${suffix}`,
  };
}

describe("KFC commerce gateway clients", () => {
  it.each([".", ".."])(
    "rejects unsafe dot-only order ID %j before any gateway route dispatch",
    async (orderId) => {
      const fetchImpl = vi.fn<typeof fetch>();
      const clients = createKfcCommerceGatewayClients({
        baseUrl: "https://commerce.internal.example",
        token: "secret-token",
        fetchImpl,
      });

      await expect(clients.payment.createPaymentLink(
        { ...order, id: orderId },
        "opaque-method",
        externalCallContext(),
        mutationIdentity(`dot-order-${orderId.length}`),
      )).resolves.toMatchObject({
        ok: false,
        errorCode: "commerce_gateway_invalid_order_id",
      });
      await expect(clients.payment.checkPaymentStatus(
        orderId,
        externalCallContext(),
      )).resolves.toMatchObject({
        ok: false,
        errorCode: "commerce_gateway_invalid_order_id",
      });
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  it("preserves a validated provider delivery estimate on an order-status read", async () => {
    const estimateObservedAt = Date.now();
    const deliveryEstimate = {
      kind: "remaining_delivery_window" as const,
      minMinutes: 25,
      maxMinutes: 30,
      observedAt: new Date(estimateObservedAt).toISOString(),
      expiresAt: new Date(estimateObservedAt + 5 * 60_000).toISOString(),
      providerRevision: "oms:KFC-REAL-42:status-revision-7",
    };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          value: { ...order, deliveryEstimate },
          message: "order_status_found",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    const clients = createKfcCommerceGatewayClients({
      baseUrl: "https://commerce.internal.example",
      token: "secret-token",
      fetchImpl,
    });

    await expect(
      clients.oms.getOrderStatus(order.id, externalCallContext()),
    ).resolves.toMatchObject({
      ok: true,
      value: { deliveryEstimate },
    });
  });

  it("preserves current order status but removes expired delivery evidence", async () => {
    const now = Date.now();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          value: {
            ...order,
            deliveryEstimate: {
              kind: "remaining_delivery_window",
              minMinutes: 25,
              maxMinutes: 30,
              observedAt: new Date(now - 10 * 60_000).toISOString(),
              expiresAt: new Date(now - 5 * 60_000).toISOString(),
              providerRevision: "oms:KFC-REAL-42:expired-revision",
            },
          },
          message: "order_status_found",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    const clients = createKfcCommerceGatewayClients({
      baseUrl: "https://commerce.internal.example",
      token: "secret-token",
      fetchImpl,
    });

    const result = await clients.oms.getOrderStatus(
      order.id,
      externalCallContext(),
    );

    expect(result).toMatchObject({
      ok: true,
      value: { id: order.id, status: order.status },
    });
    expect(result.value?.deliveryEstimate).toBeUndefined();
  });

  it.each([
    { minMinutes: 0 },
    { maxMinutes: 1_441 },
    { minMinutes: 31, maxMinutes: 30 },
    { observedAt: "tomorrow" },
    { expiresAt: "tomorrow" },
    {
      observedAt: "2026-07-20T02:00:00.000Z",
      expiresAt: "2026-07-20T02:00:00.000Z",
    },
    { providerRevision: " " },
  ])("fails closed for a malformed provider delivery estimate ($#)", async (patch) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          value: {
            ...order,
            deliveryEstimate: {
              kind: "remaining_delivery_window",
              minMinutes: 25,
              maxMinutes: 30,
              observedAt: "2026-07-20T02:00:00.000Z",
              expiresAt: "2026-07-20T02:05:00.000Z",
              providerRevision: "oms:KFC-REAL-42:status-revision-7",
              ...patch,
            },
          },
          message: "order_status_found",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    const clients = createKfcCommerceGatewayClients({
      baseUrl: "https://commerce.internal.example",
      token: "secret-token",
      fetchImpl,
    });

    await expect(
      clients.oms.getOrderStatus(order.id, externalCallContext()),
    ).resolves.toMatchObject({
      ok: false,
      errorCode: "commerce_gateway_invalid_provider_response",
    });
  });

  it("rejects confirmed order placement without a provider identity", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const clients = createKfcCommerceGatewayClients({
      baseUrl: "https://commerce.internal.example/",
      token: "secret-token",
      fetchImpl,
    });

    const context = externalCallContext();
    // @ts-expect-error Provider mutation identity is mandatory.
    const result = await clients.oms.placeOrder(
      {
        preview: order,
        userConfirmed: true,
        context: orderContext("missing-identity"),
      },
      context,
    );

    expect(result).toMatchObject({
      ok: false,
      errorCode: "provider_mutation_identity_required",
    });
    await expect(
      clients.oms.placeOrder(
        {
          preview: order,
          userConfirmed: true,
          context: orderContext("non-canonical-identity"),
        },
        context,
        {
          idempotencyKey: " place-order-leading-space",
          bindingFingerprint: "a".repeat(64),
        },
      ),
    ).resolves.toMatchObject({
      ok: false,
      errorCode: "provider_mutation_identity_required",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not drop a durable provider identity from an unbound order request", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const clients = createKfcCommerceGatewayClients({
      baseUrl: "https://commerce.internal.example",
      token: "secret-token",
      fetchImpl,
    });

    await expect(
      clients.oms.placeOrder(
        { preview: order, userConfirmed: true },
        externalCallContext(),
        {
          idempotencyKey: "confirmation:request-1:placeOrder:digest",
          bindingFingerprint: "a".repeat(64),
        },
      ),
    ).resolves.toMatchObject({
      ok: false,
      errorCode:
        "commerce_gateway_mutation_identity_context_missing",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns a typed tool failure when the gateway is unavailable", async () => {
    const clients = createKfcCommerceGatewayClients({
      baseUrl: "https://commerce.internal.example",
      token: "secret-token",
      fetchImpl: vi
        .fn<typeof fetch>()
        .mockRejectedValue(new Error("connection refused")),
    });

    await expect(
      clients.payment.checkPaymentStatus(
        "KFC-REAL-42",
        externalCallContext(),
      ),
    ).resolves.toEqual({
      ok: false,
      errorCode: "commerce_gateway_unavailable",
      message: "KFC commerce gateway request failed: connection refused",
    });
  });

  it("maps the normal agent order call to the versioned proof command", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          contractVersion: "kfc-commerce-proof-v2",
          traceId: "trace-agent-1",
          scenarioId: "successful-placement",
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
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      ),
    );
    const clients = createKfcCommerceGatewayClients({
      baseUrl: "https://commerce.internal.example",
      token: "secret-token",
      fetchImpl,
    });

    const result = await clients.oms.placeOrder(
      {
        preview: order,
        userConfirmed: true,
        context: {
          sessionId: "kfc:anon_customer_123",
          clientMessageId: "message-12",
          traceId: "trace-agent-1",
          scenarioId: "successful-placement",
        },
      },
      externalCallContext(),
      {
        idempotencyKey: "confirmation:request-1:placeOrder:digest",
        bindingFingerprint: "a".repeat(64),
      },
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        id: "COM-0001",
        posTicketId: "POS-0001",
        posStatus: "accepted",
      },
      message: "commerce_order_accepted",
    });
    const [, init] = fetchImpl.mock.calls[0]!;
    expect(JSON.parse(String(init?.body))).toMatchObject({
      contractVersion: "kfc-commerce-proof-v2",
      traceId: "trace-agent-1",
      scenarioId: "successful-placement",
      sessionId: "kfc:anon_customer_123",
      clientMessageId: "message-12",
      idempotencyKey: "confirmation:request-1:placeOrder:digest",
      bindingFingerprint: "a".repeat(64),
      toolName: "placeOrder",
      order: {
        previewId: "KFC-REAL-42",
        storeId: "store-1",
        items: [],
        totalVnd: 0,
        userConfirmed: true,
      },
    });
  });

  it("requires and forwards the exact durable cancellation identity", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({
        ok: true,
        value: { ...order, status: "cancelled" },
        message: "order_cancelled",
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const clients = createKfcCommerceGatewayClients({
      baseUrl: "https://commerce.internal.example",
      token: "secret-token",
      fetchImpl,
    });
    const context = externalCallContext();

    // @ts-expect-error Provider mutation identity is mandatory.
    await expect(clients.oms.cancelOrder(order.id, context))
      .resolves.toMatchObject({
        ok: false,
        errorCode: "provider_mutation_identity_required",
      });
    await expect(
      clients.oms.cancelOrder(
        order.id,
        context,
        {
          idempotencyKey: " cancellation-leading-space",
          bindingFingerprint: "a".repeat(64),
        },
      ),
    ).resolves.toMatchObject({
      ok: false,
      errorCode: "provider_mutation_identity_required",
    });
    expect(fetchImpl).not.toHaveBeenCalled();

    const identity = mutationIdentity("cancel-order");
    await expect(
      clients.oms.cancelOrder(order.id, context, identity),
    ).resolves.toMatchObject({
      ok: true,
      value: { id: order.id, status: "cancelled" },
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe(
      `https://commerce.internal.example/v1/orders/${order.id}/cancel`,
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      idempotencyKey: identity.idempotencyKey,
      bindingFingerprint: identity.bindingFingerprint,
    });
  });

  it("forwards the exact durable provider identity for payment mutation", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          value: {
            url: "https://payments.example.test/session-1",
            status: "pending",
          },
          message: "payment_link_created",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const clients = createKfcCommerceGatewayClients({
      baseUrl: "https://commerce.internal.example",
      token: "secret-token",
      fetchImpl,
    });
    const identity = {
      idempotencyKey: "confirmation:request-2:createPaymentLink:digest",
      bindingFingerprint: "b".repeat(64),
    };

    await expect(
      clients.payment.createPaymentLink(
        order,
        "opaque-method",
        externalCallContext(),
        identity,
      ),
    ).resolves.toMatchObject({ ok: true });

    const [, init] = fetchImpl.mock.calls[0]!;
    expect(JSON.parse(String(init?.body))).toEqual({
      methodId: "opaque-method",
      idempotencyKey: identity.idempotencyKey,
      bindingFingerprint: identity.bindingFingerprint,
    });
  });

  it("passes the exact caller signal and classifies an aborted mutation as ambiguous", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      expect(init?.signal).toBe(controller.signal);
      return new Promise<Response>((_resolve, reject) => {
        const rejectAbort = () => reject(
          controller.signal.reason ??
            new DOMException("aborted", "AbortError"),
        );
        controller.signal.addEventListener("abort", rejectAbort, {
          once: true,
        });
      });
    });
    const clients = createKfcCommerceGatewayClients({
      baseUrl: "https://commerce.internal.example",
      token: "secret-token",
      fetchImpl,
    });

    const pending = clients.oms.placeOrder(
      {
        preview: order,
        userConfirmed: true,
        context: orderContext("abort"),
      },
      externalCallContext(controller.signal),
      mutationIdentity("abort"),
    );
    controller.abort(new DOMException("customer run cancelled", "AbortError"));

    await expect(pending).resolves.toMatchObject({
      ok: false,
      errorCode: "commerce_gateway_mutation_ambiguous",
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("returns request cancellation without dispatch for a pre-aborted signal or expired deadline", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("cancelled before dispatch", "AbortError"));
    const fetchImpl = vi.fn<typeof fetch>();
    const clients = createKfcCommerceGatewayClients({
      baseUrl: "https://commerce.internal.example",
      token: "secret-token",
      fetchImpl,
    });

    await expect(
      clients.oms.cancelOrder(
        order.id,
        externalCallContext(controller.signal),
        mutationIdentity("pre-aborted-cancel"),
      ),
    ).resolves.toMatchObject({
      ok: false,
      errorCode: "commerce_gateway_request_cancelled",
    });
    await expect(
      clients.oms.cancelOrder(
        order.id,
        {
          signal: new AbortController().signal,
          deadlineAt: Date.now() - 1,
        },
        mutationIdentity("expired-cancel"),
      ),
    ).resolves.toMatchObject({
      ok: false,
      errorCode: "commerce_gateway_request_cancelled",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fences a post-dispatch mutation transport error as ambiguous", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("connection reset after write"));
    const clients = createKfcCommerceGatewayClients({
      baseUrl: "https://commerce.internal.example",
      token: "secret-token",
      fetchImpl,
    });

    await expect(
      clients.oms.cancelOrder(
        order.id,
        externalCallContext(),
        mutationIdentity("transport-cancel"),
      ),
    ).resolves.toMatchObject({
      ok: false,
      errorCode: "commerce_gateway_mutation_ambiguous",
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("fences a post-dispatch mutation body-decode failure as ambiguous", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("{", {
        status: 502,
        headers: { "content-type": "application/json" },
      }),
    );
    const clients = createKfcCommerceGatewayClients({
      baseUrl: "https://commerce.internal.example",
      token: "secret-token",
      fetchImpl,
    });

    await expect(
      clients.oms.cancelOrder(
        order.id,
        externalCallContext(),
        mutationIdentity("decode-cancel"),
      ),
    ).resolves.toMatchObject({
      ok: false,
      errorCode: "commerce_gateway_mutation_ambiguous",
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it.each([
    "versioned placement",
    "cancellation",
    "payment link",
  ] as const)(
    "rejects a structurally invalid successful %s response as mutation ambiguity",
    async (operation) => {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
      const clients = createKfcCommerceGatewayClients({
        baseUrl: "https://commerce.internal.example",
        token: "secret-token",
        fetchImpl,
      });
      const context = externalCallContext();

      const result =
        operation === "versioned placement"
            ? await clients.oms.placeOrder(
                {
                  preview: order,
                  userConfirmed: true,
                  context: {
                    sessionId: "session-1",
                    clientMessageId: "message-1",
                    traceId: "trace-1",
                    scenarioId: "scenario-1",
                  },
                },
                context,
                mutationIdentity("invalid-versioned-placement"),
              )
            : operation === "cancellation"
              ? await clients.oms.cancelOrder(
                  order.id,
                  context,
                  mutationIdentity("invalid-cancellation"),
                )
              : await clients.payment.createPaymentLink(
                  order,
                  "visa_master_card",
                  context,
                  mutationIdentity("invalid-payment-link"),
                );

      expect(result).toMatchObject({
        ok: false,
        errorCode: "commerce_gateway_mutation_ambiguous",
      });
      expect(fetchImpl).toHaveBeenCalledOnce();
    },
  );

  it.each([
    " ",
    "not a url",
    "/relative/payment",
    "http://payments.example.test/session",
    "javascript:alert(1)",
    "data:text/html,payment",
  ])(
    "fails the payment mutation closed for unsafe provider URL %j",
    async (url) => {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({
          ok: true,
          value: { url, status: "pending" },
          message: "payment_link_created",
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
      const clients = createKfcCommerceGatewayClients({
        baseUrl: "https://commerce.internal.example",
        token: "secret-token",
        fetchImpl,
      });

      await expect(
        clients.payment.createPaymentLink(
          order,
          "opaque-method",
          externalCallContext(),
          mutationIdentity(`unsafe-url-${url.length}`),
        ),
      ).resolves.toMatchObject({
        ok: false,
        errorCode: "commerce_gateway_mutation_ambiguous",
      });
      expect(fetchImpl).toHaveBeenCalledOnce();
    },
  );

  it("returns a typed invalid-provider failure for a structurally invalid read", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const clients = createKfcCommerceGatewayClients({
      baseUrl: "https://commerce.internal.example",
      token: "secret-token",
      fetchImpl,
    });

    await expect(
      clients.payment.checkPaymentStatus(
        order.id,
        externalCallContext(),
      ),
    ).resolves.toMatchObject({
      ok: false,
      errorCode: "commerce_gateway_invalid_provider_response",
    });
  });

  it("normalizes a validated bare commerce status failure from the gateway", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          contractVersion: "kfc-commerce-proof-v2",
          traceId: "trace-status-failure",
          scenarioId: "status-failure",
          outcome: "failed",
          commerceOrderId: order.id,
          omsOrderId: "OMS-1",
          posTicketId: "POS-1",
          omsStatus: "created",
          posStatus: "unknown",
          customerStatus: "failed",
          deduplicated: false,
          commerceEnvironment: "sandbox",
          providerProvenance: sandboxCommerceProofProviderProvenance,
        }),
        {
          status: 502,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    const clients = createKfcCommerceGatewayClients({
      baseUrl: "https://commerce.internal.example",
      token: "secret-token",
      fetchImpl,
    });

    await expect(
      clients.oms.getOrderStatus(order.id, externalCallContext()),
    ).resolves.toMatchObject({
      ok: false,
      errorCode: "failed",
    });
  });
});
