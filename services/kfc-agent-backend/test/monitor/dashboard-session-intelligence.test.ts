import { describe, expect, it } from "vitest";
import { DashboardEventBus } from "../../src/dashboard/eventBus.js";
import type {
  DashboardEvent,
  MonitorSessionIntelligence,
} from "../../src/domain/types.js";

const intelligence: MonitorSessionIntelligence = {
  schemaVersion: 1,
  orderStage: "cart_ready",
  aiAutomationConfidencePercent: 85,
  riskLevel: "low",
  priorityRank: 51,
  reasons: ["cart_verified"],
  evidence: {
    dashboardEventTypes: ["cart_changed"],
    toolNames: ["updateCart"],
    escalationReasons: [],
    safetyGateReasons: [],
  },
  source: "runtime_rule_fallback",
  updatedAt: "2026-07-09T00:00:02.000Z",
};

function event(
  id: string,
  sessionId: string,
  type: DashboardEvent["type"],
  createdAt: string,
  payload: Record<string, unknown> = {},
): DashboardEvent {
  return { id, sessionId, type, payload, createdAt };
}

describe("dashboard session intelligence summaries", () => {
  it("tracks latest valid intelligence separately from latest business event", () => {
    const dashboard = new DashboardEventBus({
      initialEvents: [
        event(
          "dash_1",
          "session_1",
          "cart_changed",
          "2026-07-09T00:00:01.000Z",
        ),
        event(
          "dash_bad",
          "session_1",
          "session_intelligence_updated",
          "2026-07-09T00:00:02.000Z",
          {
            sessionIntelligence: { schemaVersion: 1, orderStage: "unknown" },
          },
        ),
        event(
          "dash_2",
          "session_1",
          "session_intelligence_updated",
          "2026-07-09T00:00:03.000Z",
          {
            sessionIntelligence: intelligence,
          },
        ),
        event(
          "dash_3",
          "session_2",
          "customer_message_received",
          "2026-07-09T00:00:04.000Z",
        ),
      ],
    });

    expect(dashboard.listSessionSummaries()).toEqual([
      {
        sessionId: "session_2",
        latestEventType: "customer_message_received",
        updatedAt: "2026-07-09T00:00:04.000Z",
        sessionIntelligence: null,
      },
      {
        sessionId: "session_1",
        latestEventType: "cart_changed",
        updatedAt: "2026-07-09T00:00:03.000Z",
        sessionIntelligence: intelligence,
      },
    ]);
  });
});
