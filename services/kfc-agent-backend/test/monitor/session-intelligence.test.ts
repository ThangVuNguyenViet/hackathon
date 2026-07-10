import { describe, expect, it } from "vitest";
import type { Cart, DashboardEvent, Order } from "../../src/domain/types.js";
import type { AgentGraphState } from "../../src/graph/state.js";
import { calculateMonitorSessionIntelligence } from "../../src/monitor/sessionIntelligence.js";

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
    channel: "web_mock",
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

describe("monitor session intelligence", () => {
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
      aiAutomationConfidencePercent: 92,
      riskLevel: "low",
      reasons: expect.arrayContaining(["order_created"]),
      source: "runtime_rule_fallback",
    });
    expect(confirmed.aiAutomationConfidencePercent).toBeGreaterThan(
      cartPending.aiAutomationConfidencePercent,
    );
    expect(confirmed.priorityRank).toBeGreaterThan(cartPending.priorityRank);
    expect(confirmed.evidence.dashboardEventTypes).toContain("order_created");
    expect(confirmed.evidence.toolNames).toContain("placeOrder");
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
});
