import { describe, expect, it, vi } from "vitest";
import { createKfcCommerceGatewayClients } from "../../src/clients/kfcCommerceGateway.js";
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

describe("KFC commerce gateway clients", () => {
  it("places an order through the authenticated gateway contract", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({ ok: true, value: order, message: "order_created" }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    const clients = createKfcCommerceGatewayClients({
      baseUrl: "https://commerce.internal.example/",
      token: "secret-token",
      fetchImpl,
    });

    const result = await clients.oms.placeOrder({
      preview: order,
      userConfirmed: true,
    });

    expect(result).toEqual({
      ok: true,
      value: order,
      message: "order_created",
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://commerce.internal.example/v1/orders",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer secret-token",
        }),
      }),
    );
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
      clients.payment.checkPaymentStatus("KFC-REAL-42"),
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

    const result = await clients.oms.placeOrder({
      preview: order,
      userConfirmed: true,
      context: {
        sessionId: "kfc:anon_customer_123",
        clientMessageId: "message-12",
        traceId: "trace-agent-1",
        scenarioId: "successful-placement",
      },
    });

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
      idempotencyKey: "kfc:anon_customer_123:message-12:placeOrder",
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
});
