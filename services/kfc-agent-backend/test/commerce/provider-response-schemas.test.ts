import { describe, expect, it } from "vitest";
import {
  providerHandoffResolutionSchema,
  providerOrderSchema,
  providerPaymentLinkSchema,
} from "../../src/commerce/providerResponseSchemas.js";

describe("provider payment-link response schema", () => {
  it.each([
    "https://payments.example.test/session/opaque",
    "https://payments.example.test/session/%2E%2E?token=opaque",
    "cod://pay-on-delivery",
  ])("accepts the governed safe payment target %s", (url) => {
    expect(providerPaymentLinkSchema.safeParse({
      url,
      status: "pending",
    }).success).toBe(true);
  });

  it.each([
    "",
    " ",
    " https://payments.example.test/session",
    "https://payments.example.test/session ",
    "https://payments.example.test/pay ment",
    "/relative/payment",
    "not a url",
    "http://payments.example.test/session",
    "javascript:alert(1)",
    "data:text/html,payment",
    "https://user:secret@payments.example.test/session",
    "cod://different-marker",
  ])("rejects the unsafe provider payment target %j", (url) => {
    expect(providerPaymentLinkSchema.safeParse({
      url,
      status: "pending",
    }).success).toBe(false);
  });
});

describe("provider order response schema", () => {
  it.each([".", ".."])(
    "rejects the URL dot-segment order identifier %j",
    (id) => {
      expect(providerOrderSchema.safeParse({
        id,
        cart: {
          id: "cart-safe",
          items: [],
          subtotalVnd: 0,
          discountVnd: 0,
          deliveryFeeVnd: 0,
          totalVnd: 0,
          voucherCode: null,
        },
        status: "created",
        paymentStatus: "not_started",
        assignedStoreId: "store-safe",
        createdAt: "2026-07-20T00:00:00.000Z",
      }).success).toBe(false);
    },
  );
});

describe("provider handoff-resolution response schema", () => {
  it("accepts only a typed resolved result with an opaque escalation id", () => {
    expect(providerHandoffResolutionSchema.safeParse({
      escalationId: "provider/escalation?opaque=1",
      status: "resolved",
    }).success).toBe(true);
    for (const invalid of [
      { escalationId: "", status: "resolved" },
      { escalationId: "provider-escalation", status: "active" },
      { escalationId: "provider-escalation" },
      {
        escalationId: "provider-escalation",
        status: "resolved",
        extra: true,
      },
    ]) {
      expect(
        providerHandoffResolutionSchema.safeParse(invalid).success,
      ).toBe(false);
    }
  });
});
