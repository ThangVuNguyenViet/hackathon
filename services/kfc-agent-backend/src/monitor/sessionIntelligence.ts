import type {
  DashboardEvent,
  MonitorIntelligenceReason,
  MonitorOrderStage,
  MonitorRiskLevel,
  MonitorSessionIntelligence,
} from "../domain/types.js";
import type { AgentGraphState } from "../graph/state.js";

export interface CalculateMonitorSessionIntelligenceInput {
  state: AgentGraphState;
  dashboardEvents: DashboardEvent[];
  updatedAt?: string;
  humanJoined?: boolean;
  aiResumed?: boolean;
}

export interface MonitorSessionIntelligenceJudgeInput extends CalculateMonitorSessionIntelligenceInput {
  deterministicFallback: MonitorSessionIntelligence;
}

export interface MonitorSessionIntelligenceJudge {
  judge(
    input: MonitorSessionIntelligenceJudgeInput,
  ): Promise<MonitorSessionIntelligence>;
}

const safetyGateReasons = new Set([
  "order_confirmation_required",
  "valid_fulfillment_required",
  "payment_tool_success_required",
  "promotion_evidence_required",
  "allergen_certainty_not_allowed",
  "unverified_item_code",
]);

const monitorOrderStages = new Set<MonitorOrderStage>([
  "collecting_info",
  "cart_ready",
  "fulfillment_pending",
  "payment_issue",
  "confirmed",
]);

const monitorRiskLevels = new Set<MonitorRiskLevel>([
  "low",
  "medium",
  "high",
  "critical",
]);

const monitorIntelligenceReasons = new Set<MonitorIntelligenceReason>([
  "awaiting_customer_info",
  "cart_verified",
  "missing_address",
  "missing_fulfillment",
  "order_previewed",
  "order_created",
  "payment_link_pending",
  "payment_failed",
  "payment_paid",
  "handoff_required",
  "human_joined",
  "ai_resumed",
  "failed_delivery",
  "tool_execution_failed",
  "safety_gate_blocked",
]);

export async function resolveMonitorSessionIntelligence(
  input: CalculateMonitorSessionIntelligenceInput & {
    judge?: MonitorSessionIntelligenceJudge;
  },
): Promise<MonitorSessionIntelligence> {
  const deterministicFallback = calculateMonitorSessionIntelligence(input);
  if (!input.judge) return deterministicFallback;

  try {
    const judged = await input.judge.judge({
      ...input,
      deterministicFallback,
    });
    const validJudgment = validateAiMonitorJudgment(
      judged,
      input,
      deterministicFallback,
    );
    if (!validJudgment) {
      throw new Error(
        "AI monitor judge returned invalid or unsupported evidence",
      );
    }
    return validJudgment;
  } catch (error) {
    return {
      ...deterministicFallback,
      fallbackReason:
        error instanceof Error ? error.message : "AI monitor judge failed",
    };
  }
}

export function calculateMonitorSessionIntelligence(
  input: CalculateMonitorSessionIntelligenceInput,
): MonitorSessionIntelligence {
  const eventTypes = input.dashboardEvents.map((event) => event.type);
  const eventTypeSet = new Set(eventTypes);
  const toolNames = [
    ...new Set(input.state.toolTrace?.map((entry) => entry.toolName) ?? []),
  ];
  const reasons = new Set<MonitorIntelligenceReason>();
  const stateSafetyReasons = input.state.escalationReasons.filter((reason) =>
    safetyGateReasons.has(reason),
  );

  if (input.humanJoined) reasons.add("human_joined");
  if (input.aiResumed) reasons.add("ai_resumed");
  if (input.state.handoff || eventTypeSet.has("handoff_required"))
    reasons.add("handoff_required");
  if (
    input.state.paymentAttempt?.status === "failed" ||
    eventTypeSet.has("payment_failed")
  )
    reasons.add("payment_failed");
  if (
    input.state.paymentAttempt?.status === "paid" ||
    eventTypeSet.has("payment_paid")
  )
    reasons.add("payment_paid");
  if (stateSafetyReasons.length > 0) reasons.add("safety_gate_blocked");
  if (input.state.escalationReasons.includes("tool_execution_failed"))
    reasons.add("tool_execution_failed");

  const orderStage = (() => {
    if (reasons.has("payment_failed")) return "payment_issue" as const;
    if (input.state.order || eventTypeSet.has("order_created")) {
      reasons.add("order_created");
      return "confirmed" as const;
    }
    if (input.state.orderPreview || eventTypeSet.has("order_previewed")) {
      reasons.add("order_previewed");
      if (!hasValidFulfillment(input.state)) {
        addMissingFulfillmentReasons(input.state, reasons);
        return "fulfillment_pending" as const;
      }
      return "cart_ready" as const;
    }
    if (input.state.cart || eventTypeSet.has("cart_changed")) {
      reasons.add("cart_verified");
      if (!hasValidFulfillment(input.state)) {
        addMissingFulfillmentReasons(input.state, reasons);
        return "fulfillment_pending" as const;
      }
      return "cart_ready" as const;
    }
    reasons.add("awaiting_customer_info");
    return "collecting_info" as const;
  })();

  const confidenceCandidates = [confidenceForStage(orderStage)];
  if (input.humanJoined) confidenceCandidates.push(0);
  if (reasons.has("handoff_required")) confidenceCandidates.push(20);
  if (reasons.has("payment_failed")) confidenceCandidates.push(20);
  if (reasons.has("safety_gate_blocked")) confidenceCandidates.push(35);
  if (reasons.has("tool_execution_failed")) confidenceCandidates.push(50);
  const aiAutomationConfidencePercent = clampPercent(
    Math.min(...confidenceCandidates),
  );
  const riskLevel = riskFor({
    reasons,
    confidence: aiAutomationConfidencePercent,
    orderStage,
  });
  const priorityRank = priorityFor({
    riskLevel,
    confidence: aiAutomationConfidencePercent,
    orderStage,
  });

  return {
    schemaVersion: 1,
    orderStage,
    aiAutomationConfidencePercent,
    riskLevel,
    priorityRank,
    reasons: [...reasons],
    evidence: {
      dashboardEventTypes: eventTypes,
      toolNames,
      escalationReasons: input.state.escalationReasons,
      safetyGateReasons: stateSafetyReasons,
    },
    source: "runtime_rule_fallback",
    updatedAt: input.updatedAt ?? new Date().toISOString(),
  };
}

export function parseMonitorSessionIntelligence(
  value: unknown,
): MonitorSessionIntelligence | null {
  if (!isRecord(value)) return null;
  if (value.schemaVersion !== 1) return null;
  if (!monitorOrderStages.has(value.orderStage as MonitorOrderStage))
    return null;
  if (!monitorRiskLevels.has(value.riskLevel as MonitorRiskLevel)) return null;
  if (typeof value.aiAutomationConfidencePercent !== "number") return null;
  if (!Number.isInteger(value.aiAutomationConfidencePercent)) return null;
  if (
    value.aiAutomationConfidencePercent < 0 ||
    value.aiAutomationConfidencePercent > 100
  )
    return null;
  if (
    typeof value.priorityRank !== "number" ||
    !Number.isInteger(value.priorityRank)
  )
    return null;
  if (
    !Array.isArray(value.reasons) ||
    !value.reasons.every((reason) =>
      monitorIntelligenceReasons.has(reason as MonitorIntelligenceReason),
    )
  )
    return null;
  if (!isRecord(value.evidence)) return null;
  const evidence = value.evidence;
  if (
    !Array.isArray(evidence.dashboardEventTypes) ||
    !evidence.dashboardEventTypes.every((type) => typeof type === "string")
  ) {
    return null;
  }
  if (
    !Array.isArray(evidence.toolNames) ||
    !evidence.toolNames.every((name) => typeof name === "string")
  )
    return null;
  if (
    !Array.isArray(evidence.escalationReasons) ||
    !evidence.escalationReasons.every((reason) => typeof reason === "string")
  ) {
    return null;
  }
  if (
    !Array.isArray(evidence.safetyGateReasons) ||
    !evidence.safetyGateReasons.every((reason) => typeof reason === "string")
  ) {
    return null;
  }
  const source =
    value.source === "backend_deterministic"
      ? "runtime_rule_fallback"
      : value.source;
  if (source !== "ai_monitor_judge" && source !== "runtime_rule_fallback")
    return null;
  if (value.model !== undefined && typeof value.model !== "string") return null;
  if (
    value.promptVersion !== undefined &&
    typeof value.promptVersion !== "string"
  )
    return null;
  if (
    value.fallbackReason !== undefined &&
    typeof value.fallbackReason !== "string"
  )
    return null;
  if (typeof value.updatedAt !== "string") return null;
  return {
    ...(value as unknown as Omit<MonitorSessionIntelligence, "source">),
    source,
  };
}

export function parseMonitorSessionIntelligencePayload(
  payload: Record<string, unknown>,
): MonitorSessionIntelligence | null {
  return parseMonitorSessionIntelligence(payload.sessionIntelligence);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function validateAiMonitorJudgment(
  value: unknown,
  input: CalculateMonitorSessionIntelligenceInput,
  deterministicFallback: MonitorSessionIntelligence,
): MonitorSessionIntelligence | null {
  const parsed = parseMonitorSessionIntelligence(value);
  if (!parsed || parsed.source !== "ai_monitor_judge") return null;
  if (!evidenceIsSupportedByRuntime(parsed, input, deterministicFallback)) {
    return null;
  }
  if (
    deterministicFallback.reasons.includes("safety_gate_blocked") &&
    parsed.aiAutomationConfidencePercent >
      deterministicFallback.aiAutomationConfidencePercent
  ) {
    return null;
  }
  return parsed;
}

function evidenceIsSupportedByRuntime(
  intelligence: MonitorSessionIntelligence,
  input: CalculateMonitorSessionIntelligenceInput,
  deterministicFallback: MonitorSessionIntelligence,
): boolean {
  const dashboardEventTypes = new Set(
    input.dashboardEvents.map((event) => event.type),
  );
  const toolNames = new Set<string>(
    input.state.toolTrace?.map((entry) => entry.toolName) ?? [],
  );
  const escalationReasons = new Set(input.state.escalationReasons);
  const safetyReasons = new Set(
    deterministicFallback.evidence.safetyGateReasons,
  );

  return (
    intelligence.evidence.dashboardEventTypes.every((type) =>
      dashboardEventTypes.has(type),
    ) &&
    intelligence.evidence.toolNames.every((toolName) =>
      toolNames.has(toolName),
    ) &&
    intelligence.evidence.escalationReasons.every((reason) =>
      escalationReasons.has(reason),
    ) &&
    intelligence.evidence.safetyGateReasons.every((reason) =>
      safetyReasons.has(reason),
    )
  );
}

function hasValidFulfillment(state: AgentGraphState): boolean {
  return state.fulfillment?.availability.ok === true;
}

function addMissingFulfillmentReasons(
  state: AgentGraphState,
  reasons: Set<MonitorIntelligenceReason>,
): void {
  if (!state.address) reasons.add("missing_address");
  if (!hasValidFulfillment(state)) reasons.add("missing_fulfillment");
}

function confidenceForStage(
  orderStage: MonitorSessionIntelligence["orderStage"],
): number {
  switch (orderStage) {
    case "confirmed":
      return 92;
    case "cart_ready":
      return 85;
    case "fulfillment_pending":
      return 65;
    case "collecting_info":
      return 75;
    case "payment_issue":
      return 20;
  }
}

function riskFor(input: {
  reasons: Set<MonitorIntelligenceReason>;
  confidence: number;
  orderStage: MonitorSessionIntelligence["orderStage"];
}): MonitorRiskLevel {
  if (
    input.reasons.has("payment_failed") ||
    input.reasons.has("safety_gate_blocked")
  )
    return "critical";
  if (
    input.reasons.has("handoff_required") ||
    input.reasons.has("human_joined") ||
    input.confidence < 40
  )
    return "high";
  if (input.confidence < 70 || input.orderStage === "fulfillment_pending")
    return "medium";
  return "low";
}

function priorityFor(input: {
  riskLevel: MonitorRiskLevel;
  confidence: number;
  orderStage: MonitorSessionIntelligence["orderStage"];
}): number {
  const confidenceOffset = Math.max(
    0,
    Math.min(9, Math.floor((100 - input.confidence) / 10)),
  );
  switch (input.riskLevel) {
    case "critical":
      return confidenceOffset;
    case "high":
      return 10 + confidenceOffset;
    case "medium":
      return 30 + confidenceOffset;
    case "low":
      return input.orderStage === "confirmed"
        ? 80 + confidenceOffset
        : 50 + confidenceOffset;
  }
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}
