import { describe, expect, it } from "vitest";
import {
  commerceCommandSchema,
  commerceResultSchema,
  commerceContractVersion,
  sandboxCommerceProofProviderProvenance,
} from "../../src/commerceProof/contracts.js";
describe("commerce proof contracts", () => {
  it("accepts a correlated placement command and combined result", () => {
    const command = commerceCommandSchema.parse({
      contractVersion: commerceContractVersion,
      traceId: "trace-demo-001",
      scenarioId: "successful-placement",
      sessionId: "kfc:anon_customer_123",
      clientMessageId: "message-12",
      idempotencyKey:
        "kfc:anon_customer_123:message-12:placeOrder",
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
    });

    const result = commerceResultSchema.parse({
      contractVersion: commerceContractVersion,
      traceId: command.traceId,
      scenarioId: command.scenarioId,
      outcome: "accepted",
      commerceOrderId: "COM-DEMO-1001",
      omsOrderId: "OMS-DEMO-1001",
      posTicketId: "POS-DEMO-1001",
      omsStatus: "created",
      posStatus: "accepted",
      customerStatus: "accepted",
      deduplicated: false,
      commerceEnvironment: "sandbox",
      providerProvenance: sandboxCommerceProofProviderProvenance,
    });

    expect(result).toMatchObject({
      traceId: command.traceId,
      commerceOrderId: "COM-DEMO-1001",
      omsOrderId: "OMS-DEMO-1001",
      posTicketId: "POS-DEMO-1001",
      customerStatus: "accepted",
    });
    expect(Object.keys(result.providerProvenance)).toEqual([
      "catalog", "cart", "inventory", "store", "fulfillment", "gateway", "oms", "pos",
    ]);
    expect(result.providerProvenance.cart).toEqual({
      implementation: "in-process-fixture-provider",
      source: "bundled-generated-fixtures",
    });
    const { catalog: _catalog, ...incompleteProvenance } = sandboxCommerceProofProviderProvenance;
    expect(commerceResultSchema.safeParse({ ...result, providerProvenance: incompleteProvenance }).success).toBe(false);
  });

  it("rejects missing trace IDs and unknown source statuses", () => {
    expect(() =>
      commerceResultSchema.parse({
        contractVersion: commerceContractVersion,
        outcome: "accepted",
        omsStatus: "teleported",
        customerStatus: "accepted",
        commerceEnvironment: "sandbox",
        providerProvenance: sandboxCommerceProofProviderProvenance,
      }),
    ).toThrow();
  });

  it.each([
    { idempotencyKey: " bound-key" },
    { idempotencyKey: "bound-key " },
    { sessionId: " kfc:anon_customer_123" },
    { clientMessageId: "message-12 " },
  ])("rejects rather than normalizes opaque command identity %#", (change) => {
    expect(commerceCommandSchema.safeParse({
      contractVersion: commerceContractVersion,
      traceId: "trace-demo-001",
      scenarioId: "successful-placement",
      sessionId: "kfc:anon_customer_123",
      clientMessageId: "message-12",
      idempotencyKey: "bound-key",
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
      ...change,
    }).success).toBe(false);
  });

  it.each([".", ".."])(
    "rejects a dot-only commerce order identifier %j",
    (commerceOrderId) => {
      expect(commerceResultSchema.safeParse({
        contractVersion: commerceContractVersion,
        traceId: "trace-dot-order",
        scenarioId: "dot-order",
        outcome: "accepted",
        commerceOrderId,
        customerStatus: "accepted",
        commerceEnvironment: "sandbox",
        providerProvenance: sandboxCommerceProofProviderProvenance,
      }).success).toBe(false);
    },
  );

});
