import { describe, expect, it } from "vitest";
import { OpenAIMonitorJudge } from "../../src/llm/monitorJudge.js";

describe("OpenAIMonitorJudge", () => {
  it("calls the Responses API and returns validated monitor intelligence JSON", async () => {
    let requestBody: unknown;
    const judge = new OpenAIMonitorJudge({
      apiKey: "test_key",
      model: "gpt-test",
      baseUrl: "https://openai.local/v1/",
      fetchImpl: (async (_url, init) => {
        requestBody = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              schemaVersion: 1,
              orderStage: "cart_ready",
              aiAutomationConfidencePercent: 82,
              riskLevel: "low",
              priorityRank: 51,
              reasons: ["cart_verified"],
              evidence: {
                dashboardEventTypes: ["cart_changed"],
                toolNames: ["updateCart"],
                escalationReasons: [],
                safetyGateReasons: [],
              },
              source: "ai_monitor_judge",
              model: "gpt-test",
              promptVersion: "monitor-judge-v1",
              updatedAt: "2026-07-09T00:00:00.000Z",
            }),
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }) as typeof fetch,
    });

    const intelligence = await judge.judge({
      state: {
        sessionId: "session_1",
        customerId: "customer_1",
        channel: "messenger",
        latestUserMessage: "Cho mình 1 Combo 99K",
        intent: "ordering",
        cart: {
          id: "cart_1",
          items: [
            {
              itemCode: "20751",
              name: "Combo 99K",
              quantity: 1,
              unitPriceVnd: 99000,
            },
          ],
          subtotalVnd: 99000,
          discountVnd: 0,
          deliveryFeeVnd: 0,
          totalVnd: 99000,
          voucherCode: null,
        },
        userConfirmedOrder: false,
        escalationReasons: [],
        retrievedEvidence: [],
        toolTrace: [
          {
            toolName: "updateCart",
            arguments: {},
            ok: true,
            resultSummary: "ok",
            provenance: [],
          },
        ],
      },
      dashboardEvents: [
        {
          id: "dash_cart",
          sessionId: "session_1",
          type: "cart_changed",
          payload: {},
          createdAt: "2026-07-09T00:00:00.000Z",
        },
      ],
      deterministicFallback: {
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
        updatedAt: "2026-07-09T00:00:00.000Z",
      },
    });

    expect(intelligence).toMatchObject({
      source: "ai_monitor_judge",
      aiAutomationConfidencePercent: 82,
      model: "gpt-test",
      promptVersion: "monitor-judge-v1",
    });
    expect(requestBody).toMatchObject({
      model: "gpt-test",
      temperature: 0,
    });
    expect(JSON.stringify(requestBody)).toContain("allowedValues");
    expect(JSON.stringify(requestBody)).toContain("Do not invent");
  });
});
