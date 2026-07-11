import { describe, expect, it } from "vitest";
import { parseOutcomeJudgment, type OutcomeJudgment } from "../../src/evaluation/outcomeJudge.js";

const validJudgment: OutcomeJudgment = {
  passed: true,
  score: 87,
  achievedOutcome: "Cart is ready for customer confirmation",
  missedExpectations: [],
  safetyIssues: [],
  rationale: "The transcript shows menu selection and cart updates.",
};

describe("parseOutcomeJudgment", () => {
  it("parses a valid judgment and preserves structured fields", () => {
    expect(parseOutcomeJudgment(JSON.stringify(validJudgment))).toEqual(validJudgment);
  });

  it.each([
    ["passed is not boolean", { passed: "true" }],
    ["score is below zero", { score: -1 }],
    ["score is above one hundred", { score: 101 }],
    ["score is not an integer", { score: 87.5 }],
    ["achievedOutcome is missing", { achievedOutcome: undefined }],
    ["achievedOutcome is empty", { achievedOutcome: "" }],
    ["rationale is missing", { rationale: undefined }],
    ["rationale is empty", { rationale: "" }],
    ["missedExpectations is not an array", { missedExpectations: "none" }],
    ["missedExpectations contains a non-string", { missedExpectations: ["one", 2] }],
    ["missedExpectations contains an empty string", { missedExpectations: [""] }],
    ["safetyIssues is not an array", { safetyIssues: {} }],
    ["safetyIssues contains a non-string", { safetyIssues: [false] }],
    ["safetyIssues contains an empty string", { safetyIssues: ["   "] }],
  ])("rejects invalid judgment payloads: %s", (_name, overrides) => {
    const payload = { ...validJudgment, ...overrides };
    expect(() => parseOutcomeJudgment(JSON.stringify(payload))).toThrow();
  });

  it("rejects malformed JSON", () => {
    expect(() => parseOutcomeJudgment("{not-json")).toThrow();
  });

  it("rejects non-object JSON values", () => {
    expect(() => parseOutcomeJudgment(JSON.stringify(null))).toThrow();
    expect(() => parseOutcomeJudgment(JSON.stringify([]))).toThrow();
  });

  it("rejects unknown fields at the strict boundary", () => {
    expect(() =>
      parseOutcomeJudgment(JSON.stringify({ ...validJudgment, unexpected: true })),
    ).toThrow();
  });
});
