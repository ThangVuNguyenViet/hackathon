import { describe, expect, it } from "vitest";
import { DashboardEventBus } from "../../src/dashboard/eventBus.js";
import { runAgentTurn } from "../../src/graph/buildGraph.js";
import { StaticToolPlanner } from "../../src/llm/toolPlanner.js";
import { createMockClients } from "../../src/mock/createMockClients.js";
import { MemoryStore } from "../../src/persistence/memoryStore.js";
import { createTestFixtures } from "../fixtures/testFixtures.js";

describe("monitor intelligence graph events", () => {
  it("emits session intelligence after business dashboard events for an agent turn", async () => {
    const dashboard = new DashboardEventBus();

    await runAgentTurn({
      sessionId: "session_monitor_graph",
      customerId: "customer_1",
      channel: "web_mock",
      text: "Cho minh Combo Hop Gu 99K",
      clients: createMockClients(createTestFixtures()),
      store: new MemoryStore(),
      dashboard,
      toolPlanner: new StaticToolPlanner([
        {
          intent: "ordering",
          entities: { itemText: "Combo Hop Gu 99K" },
          toolCalls: [
            {
              toolName: "updateCart",
              arguments: { itemCode: "20751", quantity: 1 },
            },
          ],
          responseClaims: [],
        },
      ]),
    });

    const events = dashboard.getEvents("session_monitor_graph");
    const eventTypes = events.map((event) => event.type);
    const cartChangedIndex = eventTypes.indexOf("cart_changed");
    const intelligenceIndex = eventTypes.indexOf(
      "session_intelligence_updated",
    );

    expect(cartChangedIndex).toBeGreaterThanOrEqual(0);
    expect(intelligenceIndex).toBeGreaterThan(cartChangedIndex);
    expect(events[intelligenceIndex]?.payload).toMatchObject({
      sessionIntelligence: {
        schemaVersion: 1,
        orderStage: "fulfillment_pending",
        aiAutomationConfidencePercent: 65,
        riskLevel: "medium",
        reasons: expect.arrayContaining([
          "cart_verified",
          "missing_fulfillment",
        ]),
        evidence: {
          dashboardEventTypes: expect.arrayContaining(["cart_changed"]),
          toolNames: expect.arrayContaining(["updateCart"]),
        },
        source: "runtime_rule_fallback",
      },
    });
  });

  it("emits AI judged session intelligence when a monitor judge is configured", async () => {
    const dashboard = new DashboardEventBus();

    await runAgentTurn({
      sessionId: "session_monitor_ai_judge",
      customerId: "customer_1",
      channel: "web_mock",
      text: "Cho minh Combo Hop Gu 99K",
      clients: createMockClients(createTestFixtures()),
      store: new MemoryStore(),
      dashboard,
      toolPlanner: new StaticToolPlanner([
        {
          intent: "ordering",
          entities: { itemText: "Combo Hop Gu 99K" },
          toolCalls: [
            {
              toolName: "updateCart",
              arguments: { itemCode: "20751", quantity: 1 },
            },
          ],
          responseClaims: [],
        },
      ]),
      monitorJudge: {
        async judge(input) {
          return {
            schemaVersion: 1,
            orderStage: "fulfillment_pending",
            aiAutomationConfidencePercent: 61,
            riskLevel: "medium",
            priorityRank: 33,
            reasons: ["cart_verified", "missing_fulfillment"],
            contextSummary: "Khách đã có giỏ hàng và cần xác minh giao hàng.",
            evaluatedCustomerTurnCount:
              input.deterministicFallback.evaluatedCustomerTurnCount,
            evidence: {
              dashboardEventTypes:
                input.deterministicFallback.evidence.dashboardEventTypes,
              toolNames: input.deterministicFallback.evidence.toolNames,
              escalationReasons: [],
              safetyGateReasons: [],
            },
            source: "ai_monitor_judge",
            model: "gpt-test",
            promptVersion: "monitor-judge-v1",
            updatedAt: "2026-07-09T00:00:00.000Z",
          };
        },
      },
    });

    const event = dashboard
      .getEvents("session_monitor_ai_judge")
      .find((item) => item.type === "session_intelligence_updated");

    expect(event?.payload).toMatchObject({
      sessionIntelligence: {
        source: "ai_monitor_judge",
        model: "gpt-test",
        promptVersion: "monitor-judge-v1",
        aiAutomationConfidencePercent: 61,
      },
    });
  });
});
