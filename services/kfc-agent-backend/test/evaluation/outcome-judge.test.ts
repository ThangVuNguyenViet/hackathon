import { describe, expect, it, vi } from "vitest";
import {
  buildOutcomeJudgePrompt,
  judgeOutcome,
  parseOutcomeJudgment,
  type OutcomeEvidenceBundle,
  type OutcomeJudgment,
} from "../../src/evaluation/outcomeJudge.js";

const validJudgment: OutcomeJudgment = {
  passed: true,
  score: 87,
  achievedOutcome: "Cart is ready for customer confirmation",
  missedExpectations: [],
  safetyIssues: [],
  rationale: "The transcript shows menu selection and cart updates.",
};

const evidence: OutcomeEvidenceBundle = {
  scenarioId: "02-tu-van-combo-va-upsell",
  finalState: "cart_ready",
  useCases: ["combo recommendation"],
  expectations: ["Cart contains the requested items"],
  turns: [
    { role: "user", text: "Gợi ý combo" },
    { role: "assistant", text: "Bạn muốn thêm combo nào?" },
  ],
  toolTrace: [
    {
      toolName: "searchMenu",
      status: "completed",
      resultSummary: "Found the requested combo",
    },
  ],
  genUiAttachments: [
    { widgetKind: "smartMenuPicker", actionIds: ["add_item"] },
  ],
  monitorEvents: [
    { type: "assistant_reply_sent", payloadSummary: "Reply delivered" },
  ],
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

describe("buildOutcomeJudgePrompt", () => {
  it("includes all supplied evidence categories", () => {
    const prompt = buildOutcomeJudgePrompt(evidence);

    expect(prompt).toContain("02-tu-van-combo-va-upsell");
    expect(prompt).toContain("cart_ready");
    expect(prompt).toContain("Cart contains the requested items");
    expect(prompt).toContain("Gợi ý combo");
    expect(prompt).toContain("searchMenu");
    expect(prompt).toContain("smartMenuPicker");
    expect(prompt).toContain("assistant_reply_sent");
  });

  it("omits customer identifiers and authorization-like values", () => {
    const evidenceWithSecrets = {
      ...evidence,
      customerId: "anon_customer_secret",
      authorization: "Bearer customer-token",
    } as OutcomeEvidenceBundle & {
      customerId: string;
      authorization: string;
    };

    const prompt = buildOutcomeJudgePrompt(evidenceWithSecrets);

    expect(prompt).not.toContain("anon_customer_secret");
    expect(prompt).not.toContain("Bearer customer-token");
  });
});

describe("judgeOutcome", () => {
  it("calls the injected client with the requested model and parses JSON", async () => {
    const client = { complete: vi.fn().mockResolvedValue(JSON.stringify(validJudgment)) };

    await expect(
      judgeOutcome(evidence, { client, model: "judge-model" }),
    ).resolves.toEqual(validJudgment);
    expect(client.complete).toHaveBeenCalledTimes(1);
    expect(client.complete).toHaveBeenCalledWith({
      model: "judge-model",
      prompt: expect.any(String),
    });
  });

  it("propagates client errors without synthesizing a judgment", async () => {
    const error = new Error("model unavailable");
    const client = { complete: vi.fn().mockRejectedValue(error) };

    await expect(judgeOutcome(evidence, { client, model: "judge-model" })).rejects.toBe(error);
  });

  it("propagates parser errors from malformed model JSON", async () => {
    const client = { complete: vi.fn().mockResolvedValue("not-json") };

    await expect(judgeOutcome(evidence, { client, model: "judge-model" })).rejects.toThrow(
      "Outcome judgment was not valid JSON",
    );
  });
});
