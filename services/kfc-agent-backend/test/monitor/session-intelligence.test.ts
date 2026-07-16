import { describe, expect, it } from "vitest";
import type {
  Cart,
  DashboardEvent,
  MonitorSessionIntelligence,
  Order,
} from "../../src/domain/types.js";
import type { AgentGraphState } from "../../src/graph/state.js";
import {
  calculateMonitorSessionIntelligence,
  parseMonitorSessionIntelligence,
  preserveMonitorContext,
  resolveMonitorSessionIntelligence,
} from "../../src/monitor/sessionIntelligence.js";

const baseCart: Cart = {
  id: "cart_1",
  items: [
    {
      itemCode: "20751",
      name: "Combo Hop Gu 99K",
      quantity: 1,
      unitPriceVnd: 99000,
    },
  ],
  subtotalVnd: 99000,
  discountVnd: 0,
  deliveryFeeVnd: 0,
  totalVnd: 99000,
  voucherCode: null,
};

const confirmedOrder: Order = {
  id: "order_1",
  cart: baseCart,
  status: "created",
  paymentStatus: "pending",
  assignedStoreId: "KFCVN0002",
  createdAt: "2026-07-09T00:00:00.000Z",
};

function state(overrides: Partial<AgentGraphState> = {}): AgentGraphState {
  return {
    sessionId: "session_monitor_1",
    customerId: "customer_1",
    channel: "kfc",
    latestUserMessage: "Cho minh dat mon",
    intent: "ordering",
    userConfirmedOrder: false,
    escalationReasons: [],
    retrievedEvidence: [],
    ...overrides,
  };
}

function event(type: DashboardEvent["type"]): DashboardEvent {
  return {
    id: `dash_${type}`,
    sessionId: "session_monitor_1",
    type,
    payload: {},
    createdAt: "2026-07-09T00:00:00.000Z",
  };
}

function sessionUpdate(updateType: "human_joined" | "human_message_sent" | "ai_resumed"): DashboardEvent {
  return {
    ...event("session_updated"),
    payload: { updateType, agentMode: updateType === "ai_resumed" ? "ai_active" : "human_paused" },
  };
}

describe("monitor session intelligence", () => {
  it("preserves the last judged summary while control-state metrics change", () => {
    const existing = {
      ...calculateMonitorSessionIntelligence({
        state: state(),
        dashboardEvents: [event("customer_message_received")],
        customerTurnCount: 3,
      }),
      source: "ai_monitor_judge" as const,
      contextSummary: "Khách đang hỏi trạng thái và tổng tiền đơn hàng.",
      model: "gpt-test",
      promptVersion: "monitor-judge-v1",
    };
    const controlUpdate = calculateMonitorSessionIntelligence({
      state: state(),
      dashboardEvents: [sessionUpdate("human_joined")],
      customerTurnCount: 3,
      humanJoined: true,
    });

    expect(preserveMonitorContext(controlUpdate, existing)).toMatchObject({
      source: "ai_monitor_judge",
      contextSummary: "Khách đang hỏi trạng thái và tổng tiền đơn hàng.",
      aiAutomationConfidencePercent: 0,
      riskLevel: "high",
      reasons: expect.arrayContaining(["human_joined"]),
      model: "gpt-test",
      promptVersion: "monitor-judge-v1",
    });
  });

  it("does not replace a newer judged summary with an older judged summary", () => {
    const current = {
      ...calculateMonitorSessionIntelligence({
        state: state(),
        dashboardEvents: [sessionUpdate("ai_resumed")],
      }),
      source: "ai_monitor_judge" as const,
      contextSummary: "AI đã tiếp quản lại phiên hỗ trợ.",
      model: "gpt-test",
      promptVersion: "monitor-judge-v1",
    };
    const older = {
      ...current,
      contextSummary: "Nhân viên đang tham gia hỗ trợ.",
      updatedAt: "2026-07-10T00:00:00.000Z",
    };

    expect(preserveMonitorContext(current, older).contextSummary).toBe(
      "AI đã tiếp quản lại phiên hỗ trợ.",
    );
  });
  it("uses verified state to produce distinct cart-pending and confirmed-order intelligence", () => {
    const cartPending = calculateMonitorSessionIntelligence({
      state: state({
        cart: baseCart,
        toolTrace: [
          {
            toolName: "updateCart",
            arguments: {},
            ok: true,
            resultSummary: "cart_updated",
            provenance: [],
          },
        ],
      }),
      dashboardEvents: [event("cart_changed")],
    });
    const confirmed = calculateMonitorSessionIntelligence({
      state: state({
        cart: baseCart,
        order: confirmedOrder,
        toolTrace: [
          {
            toolName: "updateCart",
            arguments: {},
            ok: true,
            resultSummary: "cart_updated",
            provenance: [],
          },
          {
            toolName: "placeOrder",
            arguments: {},
            ok: true,
            resultSummary: "order_created",
            provenance: [],
          },
        ],
      }),
      dashboardEvents: [event("cart_changed"), event("order_created")],
    });

    expect(cartPending).toMatchObject({
      schemaVersion: 1,
      orderStage: "fulfillment_pending",
      aiAutomationConfidencePercent: 65,
      riskLevel: "medium",
      reasons: expect.arrayContaining(["missing_fulfillment"]),
      source: "runtime_rule_fallback",
    });
    expect(confirmed).toMatchObject({
      schemaVersion: 1,
      orderStage: "confirmed",
      aiAutomationConfidencePercent: 60,
      riskLevel: "medium",
      reasons: expect.arrayContaining(["order_created", "payment_link_pending"]),
      source: "runtime_rule_fallback",
    });
    expect(confirmed.aiAutomationConfidencePercent).toBeLessThan(
      cartPending.aiAutomationConfidencePercent,
    );
    expect(confirmed.priorityRank).toBeGreaterThan(cartPending.priorityRank);
    expect(confirmed.evidence.dashboardEventTypes).toContain("order_created");
    expect(confirmed.evidence.toolNames).toContain("placeOrder");
  });

  it("exposes commerce environment and provider provenance for confirmed orders", () => {
    const intelligence = calculateMonitorSessionIntelligence({
      state: state({
        order: {
          ...confirmedOrder,
          commerceOrderId: "COM-0001",
          omsOrderId: "OMS-0001",
          posTicketId: "POS-0001",
          commerceOutcome: "accepted",
          commerceCustomerStatus: "accepted",
          commerceEnvironment: "sandbox",
          commerceProviderProvenance: {
            gateway: { implementation: "http-adapter", source: "sandbox-commerce-gateway" },
          },
        },
      }),
      dashboardEvents: [event("order_created")],
    });

    expect(intelligence.commerce).toEqual({
      commerceOrderId: "COM-0001",
      omsOrderId: "OMS-0001",
      posTicketId: "POS-0001",
      outcome: "accepted",
      customerStatus: "accepted",
      environment: "sandbox",
      providerProvenance: {
        gateway: { implementation: "http-adapter", source: "sandbox-commerce-gateway" },
      },
    });
    expect(parseMonitorSessionIntelligence(JSON.parse(JSON.stringify(intelligence)))).toEqual(intelligence);
  });

  it("gives handoff and payment failures lower automation confidence than active cart sessions", () => {
    const cartReady = calculateMonitorSessionIntelligence({
      state: state({
        cart: baseCart,
        fulfillment: {
          method: "delivery",
          disposition: "delivery",
          storeId: "KFCVN0002",
          storeName: "KFC Test Store",
          feeVnd: 18000,
          etaMinutes: 25,
          availability: {
            ok: true,
            checkedItemIds: ["20751"],
            unavailableItemIds: [],
            blockedTimeslotItemIds: [],
            source: { fixtureMode: "test_only", sourceFile: "test" },
          },
        },
        toolTrace: [
          {
            toolName: "quoteFulfillment",
            arguments: {},
            ok: true,
            resultSummary: "quoted",
            provenance: [],
          },
        ],
      }),
      dashboardEvents: [event("cart_changed")],
    });
    const handoff = calculateMonitorSessionIntelligence({
      state: state({
        cart: baseCart,
        handoff: { escalationId: "handoff_1", reasons: ["angry_customer"] },
        toolTrace: [
          {
            toolName: "handoff",
            arguments: {},
            ok: true,
            resultSummary: "handoff_created",
            provenance: [],
          },
        ],
      }),
      dashboardEvents: [event("cart_changed"), event("handoff_required")],
    });
    const paymentFailed = calculateMonitorSessionIntelligence({
      state: state({
        order: confirmedOrder,
        paymentAttempt: { method: "momo", status: "failed" },
        toolTrace: [
          {
            toolName: "checkPaymentStatus",
            arguments: {},
            ok: false,
            resultSummary: "payment_failed",
            provenance: [],
          },
        ],
      }),
      dashboardEvents: [event("payment_failed")],
    });

    expect(cartReady).toMatchObject({
      orderStage: "cart_ready",
      aiAutomationConfidencePercent: 85,
      riskLevel: "low",
    });
    expect(handoff).toMatchObject({
      aiAutomationConfidencePercent: 20,
      riskLevel: "high",
      reasons: expect.arrayContaining(["handoff_required"]),
    });
    expect(paymentFailed).toMatchObject({
      orderStage: "payment_issue",
      aiAutomationConfidencePercent: 20,
      riskLevel: "critical",
      reasons: expect.arrayContaining(["payment_failed"]),
    });
    expect(handoff.aiAutomationConfidencePercent).toBeLessThan(
      cartReady.aiAutomationConfidencePercent,
    );
    expect(paymentFailed.priorityRank).toBeLessThan(cartReady.priorityRank);
  });

  it("clears a historical handoff from active risk after AI resumes", () => {
    const intelligence = calculateMonitorSessionIntelligence({
      state: state({
        handoff: { escalationId: "handoff_1", reasons: ["angry_customer"] },
      }),
      dashboardEvents: [
        event("handoff_required"),
        sessionUpdate("human_joined"),
        sessionUpdate("ai_resumed"),
      ],
    });

    expect(intelligence).toMatchObject({
      aiAutomationConfidencePercent: 75,
      riskLevel: "low",
      reasons: expect.arrayContaining(["ai_resumed"]),
    });
    expect(intelligence.reasons).not.toContain("handoff_required");
    expect(intelligence.evidence.dashboardEventTypes).toContain("handoff_required");
  });

  it("derives human attention from the latest control event when no transient flag is provided", () => {
    const intelligence = calculateMonitorSessionIntelligence({
      state: state(),
      dashboardEvents: [sessionUpdate("human_joined")],
    });

    expect(intelligence).toMatchObject({
      aiAutomationConfidencePercent: 0,
      riskLevel: "high",
      reasons: expect.arrayContaining(["human_joined"]),
    });
  });

  it("uses AI context summary while stamping the current customer turn count", async () => {
    const judged = await resolveMonitorSessionIntelligence({
      state: state({
        recentTurns: [
          {
            id: "turn_customer_1",
            sessionId: "session_1",
            channel: "kfc",
            role: "user",
            text: "Cho mình 1 combo",
            externalMessageId: null,
            externalUserId: null,
            deliveryStatus: "received",
            metadata: null,
            createdAt: "2026-07-09T00:00:00.000Z",
          },
          {
            id: "turn_assistant_1",
            sessionId: "session_1",
            channel: "kfc",
            role: "assistant",
            text: "Dạ mình đã thêm món.",
            externalMessageId: null,
            externalUserId: null,
            deliveryStatus: "sent",
            metadata: null,
            createdAt: "2026-07-09T00:00:01.000Z",
          },
        ],
      }),
      dashboardEvents: [event("customer_message_received")],
      customerTurnCount: 6,
      judge: {
        async judge(input) {
          return {
            ...input.deterministicFallback,
            contextSummary: "  Khách đang đặt combo và chờ tư vấn.  ",
            evaluatedCustomerTurnCount: 999,
            source: "ai_monitor_judge",
            model: "gpt-test",
            promptVersion: "monitor-judge-v1",
          } satisfies MonitorSessionIntelligence;
        },
      },
    });

    expect(judged).toMatchObject({
      source: "ai_monitor_judge",
      contextSummary: "Khách đang đặt combo và chờ tư vấn.",
      evaluatedCustomerTurnCount: 6,
    });
  });

  it("keeps pending payment and address facts state-backed when AI claims paid", async () => {
    const judged = await resolveMonitorSessionIntelligence({
      state: state({
        cart: baseCart,
        order: confirmedOrder,
        paymentAttempt: {
          method: "zalopay",
          status: "pending",
          paymentUrl: "https://pay.mock/pending",
        },
      }),
      dashboardEvents: [event("order_created"), event("payment_paid")],
      judge: {
        async judge(input) {
          return {
            ...input.deterministicFallback,
            contextSummary: "Khách đã thanh toán và địa chỉ giao hàng đã được xác nhận.",
            source: "ai_monitor_judge",
            model: "gpt-test",
            promptVersion: "monitor-judge-v1",
          } satisfies MonitorSessionIntelligence;
        },
      },
    });

    expect(judged.contextSummary).toContain("Thanh toán vẫn đang chờ xác minh");
    expect(judged.contextSummary).not.toContain("đã thanh toán");
    expect(judged.contextSummary).not.toContain("địa chỉ giao hàng đã được xác nhận");
    expect(judged.reasons).toContain("payment_link_pending");
    expect(judged.reasons).not.toContain("payment_paid");
    expect(judged.aiAutomationConfidencePercent).toBe(60);
    expect(judged.riskLevel).toBe("medium");
    expect(judged.source).toBe("runtime_rule_fallback");
  });

  it("rejects an AI judge that downgrades human attention or invents a cleared handoff", async () => {
    const resumed = await resolveMonitorSessionIntelligence({
      state: state(),
      dashboardEvents: [event("handoff_required"), sessionUpdate("ai_resumed")],
      judge: {
        async judge(input) {
          return {
            ...input.deterministicFallback,
            aiAutomationConfidencePercent: 99,
            riskLevel: "low",
            reasons: ["handoff_required"],
            contextSummary: "AI can continue.",
            source: "ai_monitor_judge",
            model: "gpt-test",
            promptVersion: "monitor-judge-v1",
          };
        },
      },
    });

    expect(resumed.source).toBe("runtime_rule_fallback");
    expect(resumed.reasons).not.toContain("handoff_required");
    expect(resumed.riskLevel).toBe("low");

    const paused = await resolveMonitorSessionIntelligence({
      state: state(),
      dashboardEvents: [sessionUpdate("human_joined")],
      judge: {
        async judge(input) {
          return {
            ...input.deterministicFallback,
            aiAutomationConfidencePercent: 99,
            riskLevel: "low",
            reasons: ["awaiting_customer_info"],
            contextSummary: "AI can continue.",
            source: "ai_monitor_judge",
            model: "gpt-test",
            promptVersion: "monitor-judge-v1",
          };
        },
      },
    });

    expect(paused.source).toBe("runtime_rule_fallback");
    expect(paused.aiAutomationConfidencePercent).toBe(0);
    expect(paused.riskLevel).toBe("high");
  });

  it("falls back without renderable AI context when the AI judge omits a summary", async () => {
    const judged = await resolveMonitorSessionIntelligence({
      state: state(),
      dashboardEvents: [event("customer_message_received")],
      customerTurnCount: 1,
      judge: {
        async judge(input) {
          return {
            ...input.deterministicFallback,
            contextSummary: "",
            source: "ai_monitor_judge",
            model: "gpt-test",
            promptVersion: "monitor-judge-v1",
          } satisfies MonitorSessionIntelligence;
        },
      },
    });

    expect(judged).toMatchObject({
      source: "runtime_rule_fallback",
      contextSummary: "",
      evaluatedCustomerTurnCount: 1,
    });
  });
});
