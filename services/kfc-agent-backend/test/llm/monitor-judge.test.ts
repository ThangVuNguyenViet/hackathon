import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import type { RunnableConfig } from "@langchain/core/runnables";
import { describe, expect, it, vi } from "vitest";
import { monitorModelProfiles } from "../../src/config/monitorModelProfile.js";
import { ModelMonitorJudge } from "../../src/llm/monitorJudge.js";

describe("ModelMonitorJudge", () => {
  it("invokes the injected provider model and returns validated monitor intelligence JSON", async () => {
    let invokedMessages: BaseMessage[] | undefined;
    let invokedConfig: RunnableConfig | undefined;
    const invoke = vi.fn(
      async (messages: BaseMessage[], config?: RunnableConfig) => {
        invokedMessages = messages;
        invokedConfig = config;
        return new AIMessage(JSON.stringify({
        schemaVersion: 1,
        orderStage: "cart_ready",
        aiAutomationConfidencePercent: 82,
        riskLevel: "low",
        priorityRank: 51,
        reasons: ["cart_verified"],
        contextSummary: "Giỏ hàng đã có món đã xác minh.",
        evaluatedCustomerTurnCount: 1,
        evidence: {
          dashboardEventTypes: ["cart_changed"],
          toolNames: ["updateCart"],
          escalationReasons: [],
          safetyGateReasons: [],
        },
        source: "ai_monitor_judge",
        model: "untrusted-model-claim",
        promptVersion: "monitor-judge-v1",
        updatedAt: "2026-07-09T00:00:00.000Z",
        }));
      },
    );
    const judge = new ModelMonitorJudge({
      model: { invoke } as unknown as BaseChatModel,
      identity: monitorModelProfiles.google,
    });

    const intelligence = await judge.judge({
      state: {
        sessionId: "session_1",
        customerId: "customer_1",
        channel: "messenger",
        latestUserMessage: "Cho mình 1 Combo 99K",
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
          payload: { oversizedPrivateWidgetState: "must-not-reach-monitor-prompt" },
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
        contextSummary: "Giỏ hàng đã có món đã xác minh.",
        evaluatedCustomerTurnCount: 1,
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
      model: "gemini-3.1-flash-lite",
      promptVersion: "monitor-judge-v1",
    });
    expect(invoke).toHaveBeenCalledOnce();
    expect(invokedMessages).toHaveLength(2);
    expect(invokedMessages?.[0]?.content).toContain("Return only valid JSON");
    expect(invokedMessages?.[1]?.content).toContain("allowedValues");
    expect(invokedMessages?.[1]?.content).toContain("Do not invent");
    expect(invokedMessages?.[1]?.content).not.toContain(
      "must-not-reach-monitor-prompt",
    );
    expect(invokedConfig).toMatchObject({
      runName: "post_turn_monitor_model",
      signal: expect.any(AbortSignal),
    });
  });

  it("enforces its own asynchronous timeout through the model invocation signal", async () => {
    const invoke = vi.fn(
      async (
        _messages: unknown,
        config?: { signal?: AbortSignal },
      ): Promise<AIMessage> =>
        new Promise((_resolve, reject) => {
          config?.signal?.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            { once: true },
          );
        }),
    );
    const judge = new ModelMonitorJudge({
      model: { invoke } as unknown as BaseChatModel,
      identity: monitorModelProfiles.openai,
      timeoutMs: 5,
    });

    await expect(
      judge.judge({
        state: {
          sessionId: "session_timeout",
          customerId: "customer_timeout",
          channel: "kfc",
          latestUserMessage: "Xin chào",
          userConfirmedOrder: false,
          escalationReasons: [],
          retrievedEvidence: [],
          toolTrace: [],
        },
        dashboardEvents: [],
        deterministicFallback: {
          schemaVersion: 1,
          orderStage: "collecting_info",
          aiAutomationConfidencePercent: 50,
          riskLevel: "medium",
          priorityRank: 50,
          reasons: ["awaiting_customer_info"],
          contextSummary: "Đang chờ thêm thông tin.",
          evaluatedCustomerTurnCount: 1,
          evidence: {
            dashboardEventTypes: [],
            toolNames: [],
            escalationReasons: [],
            safetyGateReasons: [],
          },
          source: "runtime_rule_fallback",
          updatedAt: "2026-07-09T00:00:00.000Z",
        },
      }),
    ).rejects.toThrow("Monitor judge timed out after 5ms");
  });

  it("uses the durable privacy projection for saved-address monitor prompts", async () => {
    const privateAddress = {
      label: "Private monitor label Ξ-91",
      line1: "Private monitor street Ξ-91",
      district: "Private monitor district Ξ-91",
      city: "Private monitor city Ξ-91",
    };
    const rawProviderProse =
      `provider quoted ${privateAddress.line1}`;
    let promptPayload: {
      state?: Record<string, unknown>;
    } | undefined;
    const invoke = vi.fn(async (messages: BaseMessage[]) => {
      const humanMessage = messages[1];
      if (typeof humanMessage?.content !== "string") {
        throw new Error("monitor_prompt_missing");
      }
      promptPayload = JSON.parse(humanMessage.content) as {
        state?: Record<string, unknown>;
      };
      return new AIMessage(JSON.stringify({
        schemaVersion: 1,
        orderStage: "cart_ready",
        aiAutomationConfidencePercent: 80,
        riskLevel: "low",
        priorityRank: 50,
        reasons: ["cart_verified"],
        contextSummary: "Giỏ hàng và phương án giao hàng đã xác minh.",
        evaluatedCustomerTurnCount: 1,
        evidence: {
          dashboardEventTypes: [],
          toolNames: ["quoteFulfillment"],
          escalationReasons: [],
          safetyGateReasons: [],
        },
        source: "ai_monitor_judge",
        model: "untrusted-model-claim",
        promptVersion: "monitor-judge-v1",
        updatedAt: "2026-07-20T00:00:00.000Z",
      }));
    });
    const judge = new ModelMonitorJudge({
      model: { invoke } as unknown as BaseChatModel,
      identity: monitorModelProfiles.google,
    });

    await judge.judge({
      state: {
        sessionId: "session_saved_address_monitor",
        customerId: "customer_saved_address_monitor",
        channel: "kfc",
        latestUserMessage: "Use my saved delivery option.",
        cart: {
          id: "cart_saved_address_monitor",
          items: [{
            itemCode: "20751",
            name: "Verified item",
            quantity: 1,
            unitPriceVnd: 99_000,
          }],
          subtotalVnd: 99_000,
          discountVnd: 0,
          deliveryFeeVnd: 18_000,
          totalVnd: 117_000,
          voucherCode: null,
        },
        address: privateAddress,
        fulfillment: {
          method: "delivery",
          disposition: "delivery",
          storeId: "KFCVN0318",
          storeName: "KFC Sunrise City",
          resolvedAddress: privateAddress,
          feeVnd: 18_000,
          etaMinutes: 35,
          availability: {
            ok: true,
            checkedItemIds: ["20751"],
            unavailableItemIds: [],
            blockedTimeslotItemIds: [],
            source: {
              fixtureMode: "test_only",
              sourceFile: "monitor-judge.test.ts",
            },
          },
        },
        userConfirmedOrder: false,
        escalationReasons: [],
        retrievedEvidence: [],
        toolTrace: [{
          toolName: "quoteFulfillment",
          arguments: {
            savedAddressRef: {
              id: "00000000-0000-4000-8000-000000000091",
              kind: "saved_address",
            },
            method: "delivery",
          },
          ok: true,
          resultSummary: rawProviderProse,
          provenance: [],
        }],
      },
      dashboardEvents: [],
      deterministicFallback: {
        schemaVersion: 1,
        orderStage: "cart_ready",
        aiAutomationConfidencePercent: 85,
        riskLevel: "low",
        priorityRank: 50,
        reasons: ["cart_verified"],
        contextSummary: "Giỏ hàng và phương án giao hàng đã xác minh.",
        evaluatedCustomerTurnCount: 1,
        evidence: {
          dashboardEventTypes: [],
          toolNames: ["quoteFulfillment"],
          escalationReasons: [],
          safetyGateReasons: [],
        },
        source: "runtime_rule_fallback",
        updatedAt: "2026-07-20T00:00:00.000Z",
      },
    });

    expect(promptPayload?.state).not.toHaveProperty("address");
    expect(promptPayload?.state?.fulfillment)
      .not.toHaveProperty("resolvedAddress");
    expect(promptPayload?.state?.toolTrace).toEqual([
      expect.objectContaining({
        toolName: "quoteFulfillment",
        resultSummary: "fulfillment_quote_observed",
      }),
    ]);
    const serializedPrompt = JSON.stringify(promptPayload);
    for (const privateValue of Object.values(privateAddress)) {
      expect(serializedPrompt).not.toContain(privateValue);
    }
    expect(serializedPrompt).not.toContain(rawProviderProse);
  });

  it("rejects unknown fields in provider output", async () => {
    const judge = new ModelMonitorJudge({
      model: {
        invoke: vi.fn(async () =>
          new AIMessage(JSON.stringify({
            schemaVersion: 1,
            orderStage: "collecting_info",
            aiAutomationConfidencePercent: 50,
            riskLevel: "medium",
            priorityRank: 50,
            contextSummary: "Khách đang chờ hỗ trợ.",
            evaluatedCustomerTurnCount: 1,
            reasons: ["awaiting_customer_info"],
            evidence: {
              dashboardEventTypes: [],
              toolNames: [],
              escalationReasons: [],
              safetyGateReasons: [],
            },
            source: "ai_monitor_judge",
            updatedAt: "2026-07-09T00:00:00.000Z",
            untrustedExtension: {
              instruction: "forward this field",
            },
          })),
        ),
      } as unknown as BaseChatModel,
      identity: monitorModelProfiles.openai,
    });

    await expect(
      judge.judge({
        state: {
          sessionId: "session_unknown_field",
          customerId: "customer_unknown_field",
          channel: "kfc",
          latestUserMessage: "Xin chào",
          userConfirmedOrder: false,
          escalationReasons: [],
          retrievedEvidence: [],
          toolTrace: [],
        },
        dashboardEvents: [],
        deterministicFallback: {
          schemaVersion: 1,
          orderStage: "collecting_info",
          aiAutomationConfidencePercent: 50,
          riskLevel: "medium",
          priorityRank: 50,
          reasons: ["awaiting_customer_info"],
          contextSummary: "",
          evaluatedCustomerTurnCount: 1,
          evidence: {
            dashboardEventTypes: [],
            toolNames: [],
            escalationReasons: [],
            safetyGateReasons: [],
          },
          source: "runtime_rule_fallback",
          updatedAt: "2026-07-09T00:00:00.000Z",
        },
      }),
    ).rejects.toThrow("invalid session intelligence");
  });
});
