import { describe, expect, it } from "vitest";
import {
  commerceCommandSchema,
  commerceResultSchema,
  commerceContractVersion,
} from "../../src/commerceProof/contracts.js";
import {
  commerceTraceEventTypes,
  safeTraceEventSchema,
} from "../../src/commerceProof/traceEvents.js";

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
      simulated: { gateway: true, oms: true, pos: true },
    });

    expect(result).toMatchObject({
      traceId: command.traceId,
      commerceOrderId: "COM-DEMO-1001",
      omsOrderId: "OMS-DEMO-1001",
      posTicketId: "POS-DEMO-1001",
      customerStatus: "accepted",
    });
  });

  it("rejects missing trace IDs and unknown source statuses", () => {
    expect(() =>
      commerceResultSchema.parse({
        contractVersion: commerceContractVersion,
        outcome: "accepted",
        omsStatus: "teleported",
        customerStatus: "accepted",
        simulated: { gateway: true, oms: true, pos: true },
      }),
    ).toThrow();
  });

  it("defines the required ordered event vocabulary", () => {
    expect(commerceTraceEventTypes).toEqual([
      "user_message",
      "planner_decision",
      "tool_call",
      "gateway_request",
      "mock_oms_request",
      "mock_oms_response",
      "mock_pos_request",
      "mock_pos_response",
      "tool_result",
      "assistant_response",
      "genui_rendered",
    ]);
  });

  it("accepts safe summaries and rejects secrets or customer PII", () => {
    const baseEvent = {
      sequence: 7,
      timestamp: "2026-07-11T00:00:00.000Z",
      runId: "commerce-proof-1",
      scenarioId: "successful-placement",
      traceId: "trace-demo-001",
      service: "mock-pos",
      eventType: "mock_pos_response",
      status: "ok",
      durationMs: 18,
      simulated: true,
      identifiers: { posTicketId: "POS-DEMO-1001" },
      statuses: { posStatus: "accepted" },
      inputSummary: { itemCodes: ["20751"], storeId: "KFCVN0001" },
      outputSummary: { accepted: true },
    } as const;

    expect(safeTraceEventSchema.parse(baseEvent)).toMatchObject({
      sequence: 7,
      eventType: "mock_pos_response",
    });
    expect(() =>
      safeTraceEventSchema.parse({
        ...baseEvent,
        inputSummary: { authorization: "Bearer secret-token" },
      }),
    ).toThrow(/unsafe trace field/i);
    expect(() =>
      safeTraceEventSchema.parse({
        ...baseEvent,
        outputSummary: { phone: "+84901234567" },
      }),
    ).toThrow(/unsafe trace field/i);
  });
});
