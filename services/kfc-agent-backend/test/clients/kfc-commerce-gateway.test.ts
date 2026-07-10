import { describe, expect, it, vi } from "vitest";
import { createKfcCommerceGatewayClients } from "../../src/clients/kfcCommerceGateway.js";
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
});
