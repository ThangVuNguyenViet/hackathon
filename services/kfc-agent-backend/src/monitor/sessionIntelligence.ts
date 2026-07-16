import type {
  ConversationTurn,
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
  customerTurnCount?: number;
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

export const monitorContextReevaluationCustomerTurnThreshold = 5;

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
    const aiContextClause = safeConversationalContextClause(
      validJudgment.contextSummary,
    );
    if (deterministicFallback.contextSummary && !aiContextClause) {
      return {
        ...deterministicFallback,
        fallbackReason: "AI monitor summary contained commerce claims",
      };
    }
    return {
      ...validJudgment,
      contextSummary: [deterministicFallback.contextSummary, aiContextClause]
        .filter(Boolean)
        .join(" "),
      evaluatedCustomerTurnCount:
        deterministicFallback.evaluatedCustomerTurnCount,
      commerce: validJudgment.commerce ?? deterministicFallback.commerce,
    };
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
  const evaluatedCustomerTurnCount =
    input.customerTurnCount ?? countCustomerTurns(input.state.recentTurns);
  const eventTypes = input.dashboardEvents.map((event) => event.type);
  const eventTypeSet = new Set(eventTypes);
  const toolNames = [
    ...new Set(input.state.toolTrace?.map((entry) => entry.toolName) ?? []),
  ];
  const reasons = new Set<MonitorIntelligenceReason>();
  const stateSafetyReasons = input.state.escalationReasons.filter((reason) =>
    safetyGateReasons.has(reason),
  );
  const latestSessionControl = latestSessionControlUpdate(input.dashboardEvents);
  const humanJoined =
    input.humanJoined ??
    (latestSessionControl?.updateType === "human_joined" ||
      latestSessionControl?.updateType === "human_message_sent");
  const aiResumed =
    input.aiResumed ?? latestSessionControl?.updateType === "ai_resumed";
  const latestResumeIndex = latestAiResumeEventIndex(input.dashboardEvents);
  const latestHandoffIndex = latestHandoffEventIndex(input.dashboardEvents);
  const activeHandoff =
    latestHandoffIndex > latestResumeIndex ||
    (latestResumeIndex === -1 &&
      input.aiResumed !== true &&
      Boolean(input.state.handoff));

  if (humanJoined) reasons.add("human_joined");
  if (aiResumed) reasons.add("ai_resumed");
  if (activeHandoff)
    reasons.add("handoff_required");
  const verifiedPaymentStatus =
    input.state.paymentAttempt?.status ?? input.state.order?.paymentStatus;
  if (
    verifiedPaymentStatus === "failed" ||
    (!verifiedPaymentStatus && eventTypeSet.has("payment_failed"))
  )
    reasons.add("payment_failed");
  if (
    verifiedPaymentStatus === "paid" ||
    (!verifiedPaymentStatus && eventTypeSet.has("payment_paid"))
  )
    reasons.add("payment_paid");
  if (verifiedPaymentStatus === "pending") reasons.add("payment_link_pending");
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
  if (humanJoined) confidenceCandidates.push(0);
  if (reasons.has("handoff_required")) confidenceCandidates.push(20);
  if (reasons.has("payment_failed")) confidenceCandidates.push(20);
  if (reasons.has("payment_link_pending")) confidenceCandidates.push(60);
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
    contextSummary: deterministicCommerceSummary(input.state),
    evaluatedCustomerTurnCount,
    reasons: [...reasons],
    evidence: {
      dashboardEventTypes: eventTypes,
      toolNames,
      escalationReasons: input.state.escalationReasons,
      safetyGateReasons: stateSafetyReasons,
    },
    source: "runtime_rule_fallback",
    updatedAt: input.updatedAt ?? new Date().toISOString(),
    commerce: commerceFromOrder(input.state.order),
  };
}

function commerceFromOrder(
  order: AgentGraphState["order"],
): MonitorSessionIntelligence["commerce"] {
  if (!order?.commerceEnvironment || !order.commerceProviderProvenance) return undefined;
  return {
    commerceOrderId: order.commerceOrderId,
    omsOrderId: order.omsOrderId,
    posTicketId: order.posTicketId,
    outcome: order.commerceOutcome,
    customerStatus: order.commerceCustomerStatus,
    environment: order.commerceEnvironment,
    providerProvenance: order.commerceProviderProvenance,
  };
}

export function preserveMonitorContext(
  current: MonitorSessionIntelligence,
  existing: MonitorSessionIntelligence | null,
): MonitorSessionIntelligence {
  if (current.contextSummary.trim().length > 0) return current;
  if (
    current.source === "ai_monitor_judge" &&
    current.contextSummary.trim().length > 0
  ) {
    return current;
  }
  if (
    existing?.source !== "ai_monitor_judge" ||
    existing.contextSummary.trim().length === 0
  ) {
    return current;
  }
  return {
    ...current,
    contextSummary: existing.contextSummary,
    evaluatedCustomerTurnCount: existing.evaluatedCustomerTurnCount,
    source: "ai_monitor_judge",
    model: existing.model,
    promptVersion: existing.promptVersion,
  };
}

function deterministicCommerceSummary(state: AgentGraphState): string {
  const paymentStatus = state.paymentAttempt?.status ?? state.order?.paymentStatus;
  const paymentFact = (() => {
    if (paymentStatus === "paid") return "Thanh toán đã được xác minh là thành công.";
    if (paymentStatus === "failed") return "Thanh toán đã được xác minh là thất bại.";
    if (paymentStatus === "pending") return "Thanh toán vẫn đang chờ xác minh.";
    return "";
  })();
  if (state.order) {
    return [`Đơn ${state.order.id} đã được tạo.`, paymentFact].filter(Boolean).join(" ");
  }
  if (state.orderPreview) {
    return ["Đơn đang ở bước xem trước và chưa được tạo.", paymentFact].filter(Boolean).join(" ");
  }
  if (!state.cart) return paymentFact;
  const itemCount = state.cart.items.reduce((total, item) => total + item.quantity, 0);
  const addressFact = !state.address
    ? "Chưa có địa chỉ giao hàng được xác nhận."
    : !hasValidFulfillment(state)
      ? "Đã có địa chỉ nhưng chưa có báo giá giao hàng hợp lệ."
      : "Địa chỉ và phương án giao hàng đã được xác minh.";
  return [`Giỏ hàng có ${itemCount} món đã xác minh.`, addressFact, paymentFact]
    .filter(Boolean)
    .join(" ");
}

function safeConversationalContextClause(summary: string): string {
  const trimmed = summary.trim();
  if (!trimmed) return "";
  const commerceTerms = /\b(?:paid|payment|address|order|cart|delivery|fulfillment|total|store)\b|thanh\s*to[aá]n|địa\s*chỉ|đơn\s*hàng|giỏ\s*hàng|giao\s*hàng|tổng\s*tiền|cửa\s*hàng/iu;
  if (commerceTerms.test(trimmed)) return "";
  return trimmed;
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
  if (typeof value.contextSummary !== "string") return null;
  if (
    typeof value.evaluatedCustomerTurnCount !== "number" ||
    !Number.isInteger(value.evaluatedCustomerTurnCount) ||
    value.evaluatedCustomerTurnCount < 0
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
  let commerce: MonitorSessionIntelligence["commerce"];
  if (value.commerce !== undefined) {
    if (!isRecord(value.commerce)) return null;
    if (value.commerce.environment !== "sandbox" && value.commerce.environment !== "production") return null;
    if (!isProviderProvenance(value.commerce.providerProvenance)) return null;
    for (const key of ["commerceOrderId", "omsOrderId", "posTicketId", "outcome", "customerStatus"]) {
      if (value.commerce[key] !== undefined && typeof value.commerce[key] !== "string") return null;
    }
    commerce = {
      commerceOrderId: value.commerce.commerceOrderId as string | undefined,
      omsOrderId: value.commerce.omsOrderId as string | undefined,
      posTicketId: value.commerce.posTicketId as string | undefined,
      outcome: value.commerce.outcome as string | undefined,
      customerStatus: value.commerce.customerStatus as string | undefined,
      environment: value.commerce.environment,
      providerProvenance: value.commerce.providerProvenance,
    };
  }
  return {
    ...(value as unknown as Omit<MonitorSessionIntelligence, "source">),
    source,
    commerce,
  };
}

function isProviderProvenance(value: unknown): value is NonNullable<MonitorSessionIntelligence["commerce"]>["providerProvenance"] {
  return isRecord(value) && Object.keys(value).length > 0 && Object.values(value).every((entry) =>
    isRecord(entry) &&
    typeof entry.implementation === "string" && entry.implementation.length > 0 &&
    typeof entry.source === "string" && entry.source.length > 0
  );
}

export function parseMonitorSessionIntelligencePayload(
  payload: Record<string, unknown>,
): MonitorSessionIntelligence | null {
  return parseMonitorSessionIntelligence(payload.sessionIntelligence);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function latestSessionControlUpdate(
  events: DashboardEvent[],
): { updateType: "human_joined" | "human_message_sent" | "ai_resumed"; index: number } | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type !== "session_updated") continue;
    const updateType = event.payload.updateType;
    if (
      updateType === "human_joined" ||
      updateType === "human_message_sent" ||
      updateType === "ai_resumed"
    ) {
      return { updateType, index };
    }
  }
  return undefined;
}

function latestAiResumeEventIndex(events: DashboardEvent[]): number {
  let latestResumeIndex = -1;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event?.type === "session_updated" && event.payload.updateType === "ai_resumed") {
      latestResumeIndex = index;
    }
  }
  return latestResumeIndex;
}

function latestHandoffEventIndex(events: DashboardEvent[]): number {
  let latestHandoffIndex = -1;
  for (let index = 0; index < events.length; index += 1) {
    if (events[index]?.type === "handoff_required") latestHandoffIndex = index;
  }
  return latestHandoffIndex;
}

function validateAiMonitorJudgment(
  value: unknown,
  input: CalculateMonitorSessionIntelligenceInput,
  deterministicFallback: MonitorSessionIntelligence,
): MonitorSessionIntelligence | null {
  const parsed = parseMonitorSessionIntelligence(value);
  if (!parsed || parsed.source !== "ai_monitor_judge") return null;
  if (parsed.contextSummary.trim().length === 0) return null;
  if (!evidenceIsSupportedByRuntime(parsed, input, deterministicFallback)) {
    return null;
  }
  const deterministicReasons = new Set(deterministicFallback.reasons);
  if (parsed.reasons.some((reason) => !deterministicReasons.has(reason))) {
    return null;
  }
  const protectedReasons = [
    "handoff_required",
    "payment_failed",
    "human_joined",
    "safety_gate_blocked",
    "tool_execution_failed",
  ] as const;
  if (
    protectedReasons.some(
      (reason) =>
        deterministicReasons.has(reason) && !parsed.reasons.includes(reason),
    )
  ) {
    return null;
  }
  if (
    deterministicFallback.reasons.includes("safety_gate_blocked") &&
    parsed.aiAutomationConfidencePercent >
      deterministicFallback.aiAutomationConfidencePercent
  ) {
    return null;
  }
  if (
    deterministicFallback.reasons.includes("human_joined") &&
    parsed.aiAutomationConfidencePercent >
      deterministicFallback.aiAutomationConfidencePercent
  ) {
    return null;
  }
  return parsed;
}

export function countCustomerTurns(
  turns: Pick<ConversationTurn, "role">[] | undefined,
): number {
  return turns?.filter((turn) => turn.role === "user").length ?? 0;
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
