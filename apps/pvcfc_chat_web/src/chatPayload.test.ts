import { describe, expect, it } from "vitest";
import { createPvcfcChatPayload } from "./chatPayload.js";

describe("PVCFC chat payload", () => {
  it("binds the session namespace to the customer identity", () => {
    expect(
      createPvcfcChatPayload({
        customerId: "farmer-1",
        clientMessageId: "message-1",
        text: "Tư vấn phân bón cho lúa",
      }),
    ).toEqual({
      sessionId: "pvcfc:farmer-1",
      customerId: "farmer-1",
      clientMessageId: "message-1",
      text: "Tư vấn phân bón cho lúa",
    });
  });

  it("keeps demo customer turns on the same validated route contract", () => {
    const payload = createPvcfcChatPayload({
      customerId: "demo-cust-exact-product",
      clientMessageId: "demo-message-1",
      text: "NPK Cà Mau 15-5-20 có thông tin gì?",
    });

    expect(payload.sessionId).toBe(`pvcfc:${payload.customerId}`);
  });
});
