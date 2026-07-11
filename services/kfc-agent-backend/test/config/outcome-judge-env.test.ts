import { describe, expect, it } from "vitest";
import {
  applySupportedOutcomeJudgeEnv,
  SUPPORTED_OUTCOME_JUDGE_ENV_KEYS,
} from "../../src/config/outcomeJudgeEnv.js";

describe("applySupportedOutcomeJudgeEnv", () => {
  it("loads only supported outcome judge keys without evaluating shell syntax", () => {
    const environment: NodeJS.ProcessEnv = {};

    applySupportedOutcomeJudgeEnv([
      "OPENAI_API_KEY='file-key'",
      "OPENAI_BASE_URL=https://openai.example/v1",
      "OUTCOME_JUDGE_MODEL=judge-model",
      "OUTCOME_JUDGE_TIMEOUT_MS=45000",
      "UNSUPPORTED_KEY=must-not-load",
      "DANGEROUS=$(touch /tmp/must-not-execute)",
    ].join("\n"), environment);

    expect(environment).toMatchObject({
      OPENAI_API_KEY: "file-key",
      OPENAI_BASE_URL: "https://openai.example/v1",
      OUTCOME_JUDGE_MODEL: "judge-model",
      OUTCOME_JUDGE_TIMEOUT_MS: "45000",
    });
    expect(environment.UNSUPPORTED_KEY).toBeUndefined();
    expect(environment.DANGEROUS).toBeUndefined();
    expect(Object.keys(environment).sort()).toEqual([...SUPPORTED_OUTCOME_JUDGE_ENV_KEYS].sort());
  });

  it("preserves explicit caller values for every supported key, including empty values", () => {
    const environment: NodeJS.ProcessEnv = {
      OPENAI_API_KEY: "caller-key",
      OPENAI_BASE_URL: "https://caller.example/v1",
      OUTCOME_JUDGE_MODEL: "caller-model",
      OUTCOME_JUDGE_TIMEOUT_MS: "90000",
    };
    const original = { ...environment };
    const file = SUPPORTED_OUTCOME_JUDGE_ENV_KEYS
      .map((key) => `${key}=file-value`)
      .join("\n");

    applySupportedOutcomeJudgeEnv(file, environment);

    expect(environment).toEqual(original);

    const explicitlyEmpty: NodeJS.ProcessEnv = { OPENAI_API_KEY: "" };
    applySupportedOutcomeJudgeEnv("OPENAI_API_KEY=file-key", explicitlyEmpty);
    expect(explicitlyEmpty.OPENAI_API_KEY).toBe("");
  });

  it("rejects malformed supported assignments instead of guessing", () => {
    expect(() => applySupportedOutcomeJudgeEnv("OPENAI_API_KEY='unterminated", {})).toThrow();
  });
});
