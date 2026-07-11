import type {
  DashboardEvent,
  MonitorSessionIntelligence,
} from "../domain/types.js";
import type { AgentGraphState } from "../graph/state.js";
import type {
  MonitorSessionIntelligenceJudge,
  MonitorSessionIntelligenceJudgeInput,
} from "../monitor/sessionIntelligence.js";
import { parseMonitorSessionIntelligence } from "../monitor/sessionIntelligence.js";

export interface OpenAIMonitorJudgeOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

interface ResponsesApiBody {
  output_text?: unknown;
  output?: Array<{
    content?: Array<{
      text?: unknown;
    }>;
  }>;
  error?: {
    message?: unknown;
  };
}

const openAiResponsesApiBaseUrl = "https://api.openai.com/v1";
const monitorJudgePromptVersion = "monitor-judge-v1";

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function extractOutputText(body: ResponsesApiBody): string | undefined {
  if (
    typeof body.output_text === "string" &&
    body.output_text.trim().length > 0
  ) {
    return body.output_text.trim();
  }

  for (const output of body.output ?? []) {
    for (const content of output.content ?? []) {
      if (typeof content.text === "string" && content.text.trim().length > 0) {
        return content.text.trim();
      }
    }
  }

  return undefined;
}

function buildPrompt(input: MonitorSessionIntelligenceJudgeInput): string {
  return JSON.stringify(
    {
      locale: "vi-VN",
      role: "KFC Vietnam monitor automation judge",
      promptVersion: monitorJudgePromptVersion,
      task: "Score whether AI automation can continue handling this session without human intervention. Return only strict JSON matching outputSchema.",
      guardrails: [
        "Use only state, dashboardEvents, and deterministicFallback evidence in this payload.",
        "Do not invent tool names, event types, escalation reasons, safety reasons, order ids, payment facts, delivery facts, or customer profile facts.",
        "Write contextSummary as a concise Vietnamese or customer-language summary of the current chat context for an operations monitor card.",
        "Use recentTurns to summarize what the customer is trying to do and what the assistant has already said; do not quote private IDs.",
        "When deterministicFallback includes ai_resumed, describe AI as the current owner; do not say a human agent is currently participating or handling the session.",
        "contextSummary must not be a raw event type such as conversation_turn_created or customer_message_received.",
        "Confidence is the automation readiness of the AI agent for the next step, not customer sentiment.",
        "If safetyGateReasons is non-empty, do not exceed deterministicFallback.aiAutomationConfidencePercent.",
        "If evidence is incomplete or ambiguous, lower confidence instead of inventing certainty.",
      ],
      state: stateForPrompt(input.state),
      dashboardEvents: dashboardEventsForPrompt(input.dashboardEvents),
      deterministicFallback: input.deterministicFallback,
      allowedValues: {
        orderStage: [
          "collecting_info",
          "cart_ready",
          "fulfillment_pending",
          "payment_issue",
          "confirmed",
        ],
        riskLevel: ["low", "medium", "high", "critical"],
        reasons: [
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
        ],
        evidence: {
          dashboardEventTypes: input.dashboardEvents.map((event) => event.type),
          toolNames: [
            ...new Set(
              input.state.toolTrace?.map((entry) => entry.toolName) ?? [],
            ),
          ],
          escalationReasons: input.state.escalationReasons,
          safetyGateReasons:
            input.deterministicFallback.evidence.safetyGateReasons,
        },
      },
      outputSchema: {
        schemaVersion: 1,
        orderStage:
          "collecting_info|cart_ready|fulfillment_pending|payment_issue|confirmed",
        aiAutomationConfidencePercent: "integer 0..100",
        riskLevel: "low|medium|high|critical",
        priorityRank: "integer, lower is more urgent",
        contextSummary:
          "short monitor-card summary, 6..140 chars, no raw event names or user ids",
        evaluatedCustomerTurnCount:
          "integer, copy deterministicFallback.evaluatedCustomerTurnCount",
        reasons: ["allowed reason strings only"],
        evidence: {
          dashboardEventTypes: [
            "subset of allowed evidence.dashboardEventTypes",
          ],
          toolNames: ["subset of allowed evidence.toolNames"],
          escalationReasons: ["subset of allowed evidence.escalationReasons"],
          safetyGateReasons: ["subset of allowed evidence.safetyGateReasons"],
        },
        source: "ai_monitor_judge",
        model: "<model name>",
        promptVersion: monitorJudgePromptVersion,
        updatedAt: "<ISO timestamp>",
      },
    },
    null,
    2,
  );
}

function stateForPrompt(state: AgentGraphState): Record<string, unknown> {
  return {
    sessionId: state.sessionId,
    channel: state.channel,
    latestUserMessage: state.latestUserMessage,
    recentTurns: state.recentTurns?.slice(-6).map((turn) => ({
      role: turn.role,
      text: turn.text,
      deliveryStatus: turn.deliveryStatus,
      createdAt: turn.createdAt,
    })),
    intent: state.intent,
    cart: state.cart,
    address: state.address,
    orderPreview: state.orderPreview,
    order: state.order,
    userConfirmedOrder: state.userConfirmedOrder,
    escalationReasons: state.escalationReasons,
    fulfillment: state.fulfillment,
    paymentAttempt: state.paymentAttempt,
    invoiceRequest: state.invoiceRequest,
    handoff: state.handoff,
    toolTrace: state.toolTrace,
  };
}

function dashboardEventsForPrompt(
  events: DashboardEvent[],
): Array<Record<string, unknown>> {
  return events.slice(-20).map((event) => ({
    type: event.type,
    createdAt: event.createdAt,
  }));
}

export class OpenAIMonitorJudge implements MonitorSessionIntelligenceJudge {
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: OpenAIMonitorJudgeOptions) {
    this.model = options.model;
    this.baseUrl = trimTrailingSlash(
      options.baseUrl ?? openAiResponsesApiBaseUrl,
    );
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  async judge(
    input: MonitorSessionIntelligenceJudgeInput,
  ): Promise<MonitorSessionIntelligence> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.options.timeoutMs ?? 20_000,
    );

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/responses`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0,
          instructions:
            "You are a monitor judge for KFC Vietnam AI ordering automation. Return only valid JSON. Use only supplied runtime evidence; do not invent evidence.",
          input: buildPrompt(input),
        }),
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(
          `OpenAI monitor judge timed out after ${this.options.timeoutMs ?? 20_000}ms`,
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    const body = (await response.json().catch(() => ({}))) as ResponsesApiBody;
    if (!response.ok) {
      const message =
        typeof body.error?.message === "string"
          ? body.error.message
          : response.statusText;
      throw new Error(`OpenAI monitor judge failed: ${message}`);
    }

    const outputText = extractOutputText(body);
    if (!outputText) {
      throw new Error("OpenAI monitor judge returned no text");
    }

    const parsed = parseMonitorSessionIntelligence(JSON.parse(outputText));
    if (!parsed || parsed.source !== "ai_monitor_judge") {
      throw new Error(
        "OpenAI monitor judge returned invalid session intelligence",
      );
    }

    return {
      ...parsed,
      model: parsed.model ?? this.model,
      promptVersion: parsed.promptVersion ?? monitorJudgePromptVersion,
    };
  }
}
