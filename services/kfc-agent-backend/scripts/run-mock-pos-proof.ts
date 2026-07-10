import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { OmsClient } from "../src/clients/interfaces.js";
import { createHttpPosClient } from "../src/commerce/httpPosClient.js";
import { buildMockPosServer } from "../src/commerce/mockPosServer.js";
import { createOmsWithPos } from "../src/commerce/omsWithPos.js";
import type { Order } from "../src/domain/types.js";

const token = "proof-pos-token";
const server = buildMockPosServer({ token, rejectItemCodes: ["REJECT-ME"] });
await server.listen({ host: "127.0.0.1", port: 0 });

try {
  const address = server.server.address();
  if (!address || typeof address === "string")
    throw new Error("Mock POS did not bind");
  const pos = createHttpPosClient({
    baseUrl: `http://127.0.0.1:${address.port}`,
    token,
  });
  const omsEvidence = { placeCalls: 0, cancelCalls: [] as string[] };
  const oms = proofOms(omsEvidence);
  const commerce = createOmsWithPos({ oms, pos });

  const preview = proofOrder("PREVIEW-1001");
  const first = await commerce.placeOrder({ preview, userConfirmed: true });
  const duplicate = await commerce.placeOrder({ preview, userConfirmed: true });
  const placeCallsAfterDuplicate = omsEvidence.placeCalls;
  if (!first.ok || !first.value?.posTicketId) throw new Error(first.message);
  const posTicketId = first.value.posTicketId;

  await server.inject({
    method: "POST",
    url: `/__admin/tickets/${posTicketId}/status`,
    headers: { authorization: `Bearer ${token}` },
    payload: { status: "preparing" },
  });
  const preparing = await commerce.getOrderStatus(first.value.id);

  const rejected = await commerce.placeOrder({
    preview: proofOrder("PREVIEW-REJECTED", "REJECT-ME"),
    userConfirmed: true,
  });

  const report = {
    generatedAt: new Date().toISOString(),
    simulated: true,
    claim:
      "Adapter architecture and OMS/POS orchestration capability; not vendor API compatibility",
    checks: {
      omsOrderCreated: first.ok,
      posTicketCreated: Boolean(posTicketId),
      correlation: { omsOrderId: first.value.id, posTicketId },
      idempotentReplay:
        duplicate.value?.posTicketId === posTicketId &&
        placeCallsAfterDuplicate === 1,
      posStatusProjected:
        preparing.value?.posStatus === "preparing" &&
        preparing.value?.status === "preparing",
      posRejectionSurfaced:
        !rejected.ok && rejected.errorCode === "pos_order_rejected",
      omsCompensatedAfterRejection: omsEvidence.cancelCalls.includes(
        "OMS-PREVIEW-REJECTED",
      ),
    },
    evidence: { first, duplicate, preparing, rejected, omsEvidence },
  };
  const passed = Object.values(report.checks).every((value) =>
    typeof value === "object" ? true : value === true,
  );
  const artifactRoot = resolve(
    process.cwd(),
    "../../artifacts/mock-pos-proof",
    report.generatedAt.replace(/[:.]/g, "-"),
  );
  mkdirSync(artifactRoot, { recursive: true });
  const finalReport = { ...report, passed, artifactRoot };
  writeFileSync(
    resolve(artifactRoot, "report.json"),
    `${JSON.stringify(finalReport, null, 2)}\n`,
  );
  console.log(JSON.stringify(finalReport, null, 2));
  if (!passed) process.exitCode = 1;
} finally {
  await server.close();
}

function proofOms(evidence: {
  placeCalls: number;
  cancelCalls: string[];
}): OmsClient {
  const orders = new Map<string, Order>();
  return {
    async previewOrder(input) {
      return {
        ok: true,
        value: { ...proofOrder("PREVIEW"), ...input },
        message: "mock_oms_previewed",
      };
    },
    async placeOrder(input) {
      evidence.placeCalls += 1;
      const order = {
        ...input.preview,
        id: `OMS-${input.preview.id}`,
        status: "created" as const,
      };
      orders.set(order.id, order);
      return { ok: true, value: order, message: "mock_oms_created" };
    },
    async getOrderStatus(orderId) {
      const order = orders.get(orderId);
      return order
        ? { ok: true, value: order, message: "mock_oms_found" }
        : {
            ok: false,
            errorCode: "order_not_found",
            message: "Mock OMS order was not found",
          };
    },
    async cancelOrder(orderId) {
      evidence.cancelCalls.push(orderId);
      const order = orders.get(orderId);
      if (!order)
        return {
          ok: false,
          errorCode: "order_not_found",
          message: "Mock OMS order was not found",
        };
      const cancelled = { ...order, status: "cancelled" as const };
      orders.set(orderId, cancelled);
      return { ok: true, value: cancelled, message: "mock_oms_cancelled" };
    },
  };
}

function proofOrder(id: string, itemCode = "20751"): Order {
  return {
    id,
    status: "previewed",
    paymentStatus: "pending",
    assignedStoreId: "KFCVN0001",
    createdAt: "2026-07-11T00:00:00.000Z",
    cart: {
      id: `cart-${id}`,
      items: [
        { itemCode, name: "Combo proof", quantity: 1, unitPriceVnd: 99000 },
      ],
      subtotalVnd: 99000,
      discountVnd: 0,
      deliveryFeeVnd: 18000,
      totalVnd: 117000,
      voucherCode: null,
    },
  };
}
