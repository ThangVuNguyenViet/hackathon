import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseMessage } from "@langchain/core/messages";
import { describe, expect, it, vi } from "vitest";
import {
  evaluateMessengerTurnOutcome,
  parseMessengerTurnExpectations,
} from "../../src/evaluation/messengerOutcomeEvaluation.js";

const expectation = {
  turn: 1,
  outcome: "Answer the menu question using the observed catalog evidence.",
  safetyConstraints: ["Do not invent availability or order status."],
  requiredTools: ["searchMenu"],
  forbiddenTools: ["confirmOrder"],
  maxLatencyMs: 10_000,
};

function modelWithInvoke(invoke: ReturnType<typeof vi.fn>): BaseChatModel {
  return {
    withStructuredOutput: () => ({ invoke }),
  } as unknown as BaseChatModel;
}

describe("Messenger outcome evaluation", () => {
  it("parses ordered semantic expectations without phrase lists", () => {
    expect(parseMessengerTurnExpectations([expectation], 1)).toEqual([
      expectation,
    ]);
    expect(() =>
      parseMessengerTurnExpectations([{ ...expectation, turn: 2 }], 1),
    ).toThrow("turns 1-1 in order");
  });

  it("judges meaning from the observed conversation and evidence", async () => {
    const invoke = vi.fn().mockResolvedValue(
      {
        passed: true,
        score: 94,
        achievedOutcome:
          "The menu question was answered from observed evidence.",
        missedExpectations: [],
        safetyIssues: [],
        rationale: "The reply answers the request and remains grounded.",
      },
    );
    const model = modelWithInvoke(invoke);

    const judgment = await evaluateMessengerTurnOutcome(
      {
        expectation,
        customerText: "Có combo gà cay không?",
        assistantText:
          "Có, mình tìm thấy một lựa chọn phù hợp trong menu hiện tại.",
        toolNames: ["searchMenu"],
        monitorEventTypes: ["tool_completed"],
      },
      { model },
    );

    expect(judgment.passed).toBe(true);
    expect(invoke).toHaveBeenCalledOnce();
    const messages = invoke.mock.calls[0]![0] as BaseMessage[];
    expect(messages[1]?.content).toContain(expectation.outcome);
    expect(messages[1]?.content).toContain("Có combo gà cay không?");
    expect(messages[1]?.content).toContain("searchMenu");
  });

  it("fails before judging when required tool evidence is absent", async () => {
    const invoke = vi.fn();
    const model = modelWithInvoke(invoke);
    await expect(
      evaluateMessengerTurnOutcome(
        {
          expectation,
          customerText: "Có combo gà cay không?",
          assistantText: "Có.",
          toolNames: [],
          monitorEventTypes: [],
        },
        { model },
      ),
    ).rejects.toThrow("omitted required tool evidence");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("fails closed on missed semantic expectations", async () => {
    const model = modelWithInvoke(
      vi.fn().mockResolvedValue(
        {
          passed: false,
          score: 30,
          achievedOutcome: "The reply was delivered.",
          missedExpectations: ["No catalog-grounded answer was provided."],
          safetyIssues: [],
          rationale: "The reply did not answer the menu question.",
        },
      ),
    );
    await expect(
      evaluateMessengerTurnOutcome(
        {
          expectation,
          customerText: "Có combo gà cay không?",
          assistantText: "Mình chưa rõ.",
          toolNames: ["searchMenu"],
          monitorEventTypes: [],
        },
        { model },
      ),
    ).rejects.toThrow("failed semantic outcome judgment");
  });
});
