import { sandboxCommerceProofProviderProvenance, type CommerceResult } from "./contracts.js";
import type { SafeTraceEvent } from "./traceEvents.js";

export interface CommerceProofEvaluationInput {
  scenarioId: string;
  expectedOutcome: CommerceResult["outcome"];
  expectedGenUiKind: string;
  expectedToolName: string;
  observedToolName: string;
  toolArgumentsMatch: boolean;
  responseGrounded: boolean;
  observedGenUiKind: string;
  humanControlsEnabled: boolean;
  events: SafeTraceEvent[];
  result: CommerceResult;
}

export interface CommerceProofEvaluation {
  scenarioId: string;
  passed: boolean;
  scores: Record<
    | "toolSelection"
    | "toolArguments"
    | "hopOrder"
    | "traceContinuity"
    | "identifierCorrelation"
    | "providerProvenance"
    | "expectedOutcome"
    | "duplicateSuppression"
    | "compensationTruthfulness"
    | "failureClassification"
    | "responseGrounding"
    | "genUi"
    | "humanControlsDisabled",
    0 | 1
  >;
  failures: string[];
}

const fullHopOrder = [
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

const duplicateHopOrder = [
  "user_message",
  "planner_decision",
  "tool_call",
  "tool_result",
  "assistant_response",
  "genui_rendered",
] as const;

export function evaluateCommerceProofScenario(
  input: CommerceProofEvaluationInput,
): CommerceProofEvaluation {
  const expectedHops =
    input.scenarioId === "duplicate-command" ? duplicateHopOrder : fullHopOrder;
  const hopOrder =
    input.events.length === expectedHops.length &&
    input.events.every(
      (event, index) =>
        (index === 0 || event.sequence > input.events[index - 1]!.sequence) &&
        event.eventType === expectedHops[index],
    );
  const traceContinuity =
    input.result.traceId.length > 0 &&
    input.events.every((event) => event.traceId === input.result.traceId);
  const identifierCorrelation = correlatedIdentifiers(input.events, input.result);
  const providerProvenance =
    input.result.commerceEnvironment === "sandbox" &&
    Object.entries(sandboxCommerceProofProviderProvenance).every(([dependency, expected]) => {
      const observed = input.result.providerProvenance[
        dependency as keyof CommerceResult["providerProvenance"]
      ];
      return observed.implementation === expected.implementation && observed.source === expected.source;
    }) &&
    input.events.every(
      (event) => event.commerceEnvironment === "sandbox" && event.providerImplementation.length > 0,
    );
  const duplicateSuppression =
    input.scenarioId !== "duplicate-command" ||
    (input.result.deduplicated &&
      Boolean(input.result.originalTraceId) &&
      input.events.every(
        (event) =>
          event.eventType !== "gateway_request" &&
          !event.eventType.startsWith("mock_oms") &&
          !event.eventType.startsWith("mock_pos"),
      ));
  const compensationTruthfulness = compensationIsTruthful(input.result);
  const failureClassification = failureIsClassified(input.result);

  const checks = {
    toolSelection: input.observedToolName === input.expectedToolName,
    toolArguments: input.toolArgumentsMatch,
    hopOrder,
    traceContinuity,
    identifierCorrelation,
    providerProvenance,
    expectedOutcome: input.result.outcome === input.expectedOutcome,
    duplicateSuppression,
    compensationTruthfulness,
    failureClassification,
    responseGrounding: input.responseGrounded,
    genUi: input.observedGenUiKind === input.expectedGenUiKind,
    humanControlsDisabled: !input.humanControlsEnabled,
  };
  const failures = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => `${name} failed`);
  const scores = Object.fromEntries(
    Object.entries(checks).map(([name, passed]) => [name, passed ? 1 : 0]),
  ) as CommerceProofEvaluation["scores"];

  return {
    scenarioId: input.scenarioId,
    passed: failures.length === 0,
    scores,
    failures,
  };
}

function correlatedIdentifiers(
  events: SafeTraceEvent[],
  result: CommerceResult,
): boolean {
  const identifiers = {
    commerceOrderId: result.commerceOrderId,
    omsOrderId: result.omsOrderId,
    posTicketId: result.posTicketId,
  };
  return events.every((event) =>
    Object.entries(event.identifiers).every(([key, value]) => {
      const expected = identifiers[key as keyof typeof identifiers];
      return expected === undefined || value === expected;
    }),
  );
}

function compensationIsTruthful(result: CommerceResult): boolean {
  if (result.compensationStatus === "succeeded") {
    return result.omsStatus === "cancelled";
  }
  if (result.compensationStatus === "failed") {
    return result.omsStatus === "cancellation_failed";
  }
  return true;
}

function failureIsClassified(result: CommerceResult): boolean {
  if (result.outcome === "ambiguous_pos_submission") {
    return (
      result.customerStatus === "failed" &&
      result.omsStatus === "created" &&
      result.posTicketId === undefined
    );
  }
  if (result.outcome === "status_conflict" || result.outcome === "partial_cancellation") {
    return result.customerStatus === "failed" && Boolean(result.conflictType);
  }
  return true;
}
