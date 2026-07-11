import { describe, expect, it } from "vitest";
import {
  EXPECTED_OUTCOME_SCENARIO_IDS,
  validateOutcomeJudgmentArtifact,
} from "../../src/evaluation/outcomeJudgmentArtifact.js";

const release = {
  gitSha: "abc123",
  releaseBuiltAt: "2026-07-11T08:30:00Z",
  dirty: false,
};

const judgment = {
  passed: true,
  score: 100,
  achievedOutcome: "The order is ready for confirmation",
  missedExpectations: [],
  safetyIssues: [],
  rationale: "The evidence shows the requested order is ready for confirmation.",
};

function artifact(
  scenarioIds: readonly string[] = EXPECTED_OUTCOME_SCENARIO_IDS,
  overrides: Record<string, unknown> = {},
) {
  return {
    ...release,
    model: "test-outcome-model",
    judgedAt: "2026-07-11T09:00:00Z",
    scenarios: scenarioIds.map((scenarioId) => ({ scenarioId, judgment })),
    ...overrides,
  };
}

describe("validateOutcomeJudgmentArtifact", () => {
  it("accepts a valid artifact with all canonical scenarios passing", () => {
    expect(validateOutcomeJudgmentArtifact(artifact(), release)).toEqual(artifact());
  });

  it.each([
    ["malformed judgment schema", () => artifact(EXPECTED_OUTCOME_SCENARIO_IDS, { scenarios: [{ scenarioId: EXPECTED_OUTCOME_SCENARIO_IDS[0], judgment: { ...judgment, score: "100" } }] })],
    ["duplicate scenario IDs", () => artifact([...EXPECTED_OUTCOME_SCENARIO_IDS.slice(0, -1), EXPECTED_OUTCOME_SCENARIO_IDS[0]])],
    ["missing scenario ID", () => artifact(EXPECTED_OUTCOME_SCENARIO_IDS.slice(0, -1))],
    ["failed judgment", () => artifact(EXPECTED_OUTCOME_SCENARIO_IDS, { scenarios: EXPECTED_OUTCOME_SCENARIO_IDS.map((scenarioId, index) => ({ scenarioId, judgment: index === 0 ? { ...judgment, passed: false } : judgment })) })],
    ["release mismatch", () => artifact(EXPECTED_OUTCOME_SCENARIO_IDS, { gitSha: "different-sha" })],
  ])("fails closed for %s", (_label, makeArtifact) => {
    expect(() => validateOutcomeJudgmentArtifact(makeArtifact(), release)).toThrow();
  });

  it("rejects extra artifact fields at the exact schema boundary", () => {
    expect(() => validateOutcomeJudgmentArtifact(artifact(EXPECTED_OUTCOME_SCENARIO_IDS, { unexpected: true }), release)).toThrow();
  });
});
