import { describe, expect, it, vi } from "vitest";
import {
  evaluateMessengerTurnOutcome,
  parseMessengerTurnExpectations,
} from "../../src/evaluation/messengerOutcomeEvaluation.js";
import type { OutcomeJudgeClient } from "../../src/evaluation/outcomeJudge.js";

const expectation = {
  turn: 1,
  outcome: "Answer the menu question using the observed catalog evidence.",
  safetyConstraints: ["Do not invent availability or order status."],
  requiredTools: ["searchMenu"],
  forbiddenTools: ["confirmOrder"],
  maxLatencyMs: 10_000,
};

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
    const complete = vi.fn().mockResolvedValue(
      JSON.stringify({
        passed: true,
        score: 94,
        achievedOutcome:
          "The menu question was answered from observed evidence.",
        missedExpectations: [],
        safetyIssues: [],
        rationale: "The reply answers the request and remains grounded.",
      }),
    );
    const client: OutcomeJudgeClient = { complete };

    const judgment = await evaluateMessengerTurnOutcome(
      {
        expectation,
        customerText: "Có combo gà cay không?",
        assistantText:
          "Có, mình tìm thấy một lựa chọn phù hợp trong menu hiện tại.",
        toolNames: ["searchMenu"],
        monitorEventTypes: ["tool_completed"],
      },
      { client, model: "judge-model" },
    );

    expect(judgment.passed).toBe(true);
    expect(complete).toHaveBeenCalledOnce();
    const request = complete.mock.calls[0]![0];
    expect(request.user).toContain(expectation.outcome);
    expect(request.user).toContain("Có combo gà cay không?");
    expect(request.user).toContain("searchMenu");
  });

  it("fails before judging when required tool evidence is absent", async () => {
    const client: OutcomeJudgeClient = { complete: vi.fn() };
    await expect(
      evaluateMessengerTurnOutcome(
        {
          expectation,
          customerText: "Có combo gà cay không?",
          assistantText: "Có.",
          toolNames: [],
          monitorEventTypes: [],
        },
        { client, model: "judge-model" },
      ),
    ).rejects.toThrow("omitted required tool evidence");
    expect(client.complete).not.toHaveBeenCalled();
  });

  it("fails closed on missed semantic expectations", async () => {
    const client: OutcomeJudgeClient = {
      complete: vi.fn().mockResolvedValue(
        JSON.stringify({
          passed: false,
          score: 30,
          achievedOutcome: "The reply was delivered.",
          missedExpectations: ["No catalog-grounded answer was provided."],
          safetyIssues: [],
          rationale: "The reply did not answer the menu question.",
        }),
      ),
    };
    await expect(
      evaluateMessengerTurnOutcome(
        {
          expectation,
          customerText: "Có combo gà cay không?",
          assistantText: "Mình chưa rõ.",
          toolNames: ["searchMenu"],
          monitorEventTypes: [],
        },
        { client, model: "judge-model" },
      ),
    ).rejects.toThrow("failed semantic outcome judgment");
  });
});
