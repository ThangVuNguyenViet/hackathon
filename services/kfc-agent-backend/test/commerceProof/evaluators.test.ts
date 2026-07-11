import { describe, expect, it } from "vitest";
import { commerceContractVersion, type CommerceResult } from "../../src/commerceProof/contracts.js";
import { evaluateCommerceProofScenario } from "../../src/commerceProof/evaluators.js";
import type { SafeTraceEvent } from "../../src/commerceProof/traceEvents.js";

const requiredEvents = [
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
] as const;

function events(traceId = "trace-eval-1"): SafeTraceEvent[] {
  return requiredEvents.map((eventType, index) => ({
    sequence: index + 1,
    timestamp: "2026-07-11T00:00:00.000Z",
    runId: "proof-run-1",
    scenarioId: "successful-placement",
    traceId,
    service:
      eventType.startsWith("mock_oms")
        ? "mock-oms"
        : eventType.startsWith("mock_pos")
          ? "mock-pos"
          : eventType === "gateway_request"
            ? "demo-commerce-gateway"
            : "kfc-agent-backend",
    eventType,
    status: "ok",
    durationMs: 1,
    simulated: true,
    identifiers: {
      commerceOrderId: "COM-0001",
      omsOrderId: "OMS-0001",
      posTicketId: "POS-0001",
    },
    statuses: {},
    inputSummary: {},
    outputSummary: {},
  }));
}

const result: CommerceResult = {
  contractVersion: commerceContractVersion,
  traceId: "trace-eval-1",
  scenarioId: "successful-placement",
  outcome: "accepted",
  commerceOrderId: "COM-0001",
  omsOrderId: "OMS-0001",
  posTicketId: "POS-0001",
  omsStatus: "created",
  posStatus: "accepted",
  customerStatus: "accepted",
  deduplicated: false,
  simulated: { gateway: true, oms: true, pos: true },
};

describe("commerce proof evaluators", () => {
  it("passes a fully correlated and grounded success trace", () => {
    const evaluation = evaluateCommerceProofScenario({
      scenarioId: "successful-placement",
      expectedOutcome: "accepted",
      expectedGenUiKind: "paymentOrderStatus",
      expectedToolName: "placeOrder",
      observedToolName: "placeOrder",
      toolArgumentsMatch: true,
      responseGrounded: true,
      observedGenUiKind: "paymentOrderStatus",
      humanControlsEnabled: false,
      events: events(),
      result,
    });

    expect(evaluation.passed).toBe(true);
    expect(evaluation.failures).toEqual([]);
    expect(Object.values(evaluation.scores).every((score) => score === 1)).toBe(true);
  });

  it("reports ordering, trace, correlation, provenance, outcome, UI, and control failures", () => {
    const brokenEvents = events("another-trace");
    [brokenEvents[3], brokenEvents[5]] = [brokenEvents[5]!, brokenEvents[3]!];
    brokenEvents[0] = {
      ...brokenEvents[0]!,
      sequence: 99,
      simulated: false,
      identifiers: { commerceOrderId: "COM-WRONG" },
    };
    const evaluation = evaluateCommerceProofScenario({
      scenarioId: "successful-placement",
      expectedOutcome: "accepted",
      expectedGenUiKind: "paymentOrderStatus",
      expectedToolName: "placeOrder",
      observedToolName: "searchMenu",
      toolArgumentsMatch: false,
      responseGrounded: false,
      observedGenUiKind: "supportHandoff",
      humanControlsEnabled: true,
      events: brokenEvents,
      result: { ...result, outcome: "failed" },
    });

    expect(evaluation.passed).toBe(false);
    expect(evaluation.scores).toMatchObject({
      toolSelection: 0,
      toolArguments: 0,
      hopOrder: 0,
      traceContinuity: 0,
      identifierCorrelation: 0,
      simulationLabels: 0,
      expectedOutcome: 0,
      responseGrounding: 0,
      genUi: 0,
      humanControlsDisabled: 0,
    });
    expect(evaluation.failures.length).toBeGreaterThanOrEqual(10);
  });

  it("passes duplicate suppression without downstream events", () => {
    const duplicateEvents = events().filter(
      (entry) =>
        !entry.eventType.startsWith("mock_oms") &&
        !entry.eventType.startsWith("mock_pos") &&
        entry.eventType !== "gateway_request",
    );
    const evaluation = evaluateCommerceProofScenario({
      scenarioId: "duplicate-command",
      expectedOutcome: "deduplicated",
      expectedGenUiKind: "paymentOrderStatus",
      expectedToolName: "placeOrder",
      observedToolName: "placeOrder",
      toolArgumentsMatch: true,
      responseGrounded: true,
      observedGenUiKind: "paymentOrderStatus",
      humanControlsEnabled: false,
      events: duplicateEvents.map((entry, index) => ({
        ...entry,
        sequence: index + 1,
        scenarioId: "duplicate-command",
      })),
      result: {
        ...result,
        scenarioId: "duplicate-command",
        outcome: "deduplicated",
        deduplicated: true,
        originalTraceId: "trace-original",
      },
    });

    expect(evaluation.passed).toBe(true);
    expect(evaluation.scores.duplicateSuppression).toBe(1);
  });
});
