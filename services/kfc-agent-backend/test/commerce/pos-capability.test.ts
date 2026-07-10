import { afterEach, describe, expect, it, vi } from "vitest";
import type { OmsClient } from "../../src/clients/interfaces.js";
import { createHttpPosClient } from "../../src/commerce/httpPosClient.js";
import { createOmsWithPos } from "../../src/commerce/omsWithPos.js";
import { buildMockPosServer } from "../../src/commerce/mockPosServer.js";
import type { Order } from "../../src/domain/types.js";

const openServers: Array<{ close(): Promise<void> }> = [];
afterEach(async () => {
  await Promise.all(openServers.splice(0).map((server) => server.close()));
});

function order(id = "OMS-1001", itemCode = "20751"): Order {
  return {
    id,
    status: "created",
    paymentStatus: "pending",
    assignedStoreId: "KFCVN0001",
    createdAt: "2026-07-11T00:00:00.000Z",
    cart: {
      id: "cart-1",
      items: [{ itemCode, name: "Combo", quantity: 1, unitPriceVnd: 99000 }],
      subtotalVnd: 99000,
      discountVnd: 0,
      deliveryFeeVnd: 18000,
      totalVnd: 117000,
      voucherCode: null,
    },
  };
}

async function mockPos(input: { rejectItemCodes?: string[] } = {}) {
  const server = buildMockPosServer({ token: "pos-token", ...input });
  openServers.push(server);
  await server.listen({ host: "127.0.0.1", port: 0 });
  const address = server.server.address();
  if (!address || typeof address === "string")
    throw new Error("Mock POS did not bind");
  return {
    server,
    client: createHttpPosClient({
      baseUrl: `http://127.0.0.1:${address.port}`,
      token: "pos-token",
    }),
  };
}

function oms(createdOrder = order()) {
  const client: OmsClient = {
    previewOrder: vi.fn(async (input) => ({
      ok: true,
      value: {
        ...createdOrder,
        ...input,
        id: "preview-1",
        status: "previewed",
      },
      message: "previewed",
    })),
    placeOrder: vi.fn(async () => ({
      ok: true,
      value: createdOrder,
      message: "order_created",
    })),
    getOrderStatus: vi.fn(async () => ({
      ok: true,
      value: createdOrder,
      message: "found",
    })),
    cancelOrder: vi.fn(async () => ({
      ok: true,
      value: { ...createdOrder, status: "cancelled" as const },
      message: "cancelled",
    })),
  };
  return client;
}

describe("OMS and POS capability proof", () => {
  it("creates one correlated POS ticket for an idempotently placed OMS order", async () => {
    const { client: pos } = await mockPos();
    const omsClient = oms();
    const coordinated = createOmsWithPos({ oms: omsClient, pos });
    const preview = order("preview-1");

    const first = await coordinated.placeOrder({
      preview,
      userConfirmed: true,
    });
    const duplicate = await coordinated.placeOrder({
      preview,
      userConfirmed: true,
    });

    expect(first.ok).toBe(true);
    expect(first.value).toMatchObject({
      id: "OMS-1001",
      posTicketId: expect.stringMatching(/^POS-/),
      posStatus: "accepted",
    });
    expect(duplicate).toEqual(first);
    expect(omsClient.placeOrder).toHaveBeenCalledTimes(1);
  });

  it("cancels the OMS order when the POS rejects an item", async () => {
    const { client: pos } = await mockPos({ rejectItemCodes: ["REJECT-ME"] });
    const omsClient = oms(order("OMS-REJECTED", "REJECT-ME"));
    const coordinated = createOmsWithPos({ oms: omsClient, pos });

    const result = await coordinated.placeOrder({
      preview: order("preview-rejected", "REJECT-ME"),
      userConfirmed: true,
    });

    expect(result).toMatchObject({
      ok: false,
      errorCode: "pos_order_rejected",
    });
    expect(omsClient.cancelOrder).toHaveBeenCalledWith("OMS-REJECTED");
  });

  it("projects mock POS preparation status onto the correlated order", async () => {
    const { server, client: pos } = await mockPos();
    const coordinated = createOmsWithPos({ oms: oms(), pos });
    const placed = await coordinated.placeOrder({
      preview: order("preview-1"),
      userConfirmed: true,
    });
    const ticketId = placed.value?.posTicketId;
    expect(ticketId).toBeTruthy();

    await server.inject({
      method: "POST",
      url: `/__admin/tickets/${ticketId}/status`,
      headers: { authorization: "Bearer pos-token" },
      payload: { status: "preparing" },
    });
    const current = await coordinated.getOrderStatus("OMS-1001");

    expect(current.value).toMatchObject({
      posTicketId: ticketId,
      posStatus: "preparing",
      status: "preparing",
    });
  });
});
