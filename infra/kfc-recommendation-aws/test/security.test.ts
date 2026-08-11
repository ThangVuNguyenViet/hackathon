import { App } from "aws-cdk-lib";
import { AwsSolutionsChecks } from "cdk-nag";
import { describe, expect, it } from "vitest";

import { RecommendationCandidateStack } from "../lib/recommendation-candidate-stack.js";
import { RecommendationFoundationStack } from "../lib/recommendation-foundation-stack.js";
import { RecommendationPlatformStack } from "../lib/recommendation-platform-stack.js";
import { RecommendationProductionStack } from "../lib/recommendation-production-stack.js";

describe("AWS Solutions security checks", () => {
  it("has no unsuppressed high-confidence findings", () => {
    const app = new App({ context: { githubRepository: "KFC/recommendations" } });
    const environment = { account: "111122223333", region: "ap-southeast-1" };
    const platform = new RecommendationPlatformStack(app, "PlatformSecurity", {
      env: environment,
    });
    const candidate = new RecommendationCandidateStack(app, "CandidateSecurity", {
      env: environment,
      platform,
    });
    const production = new RecommendationProductionStack(app, "ProductionSecurity", {
      env: environment,
      platform,
      candidate,
    });
    app.synth();
    const checks = new AwsSolutionsChecks(app, { verbose: true });
    for (const stack of [platform, candidate, production]) {
      expect(checks.validateScope(stack).violations).toEqual([]);
    }
  });

  it("has no unsuppressed foundation findings", () => {
    const app = new App({ context: { githubRepository: "KFC/recommendations" } });
    const stack = new RecommendationFoundationStack(app, "FoundationSecurity", {
      env: { account: "111122223333", region: "ap-southeast-1" },
    });
    app.synth();
    const report = new AwsSolutionsChecks(app, { verbose: true }).validateScope(stack);
    expect(report.violations).toEqual([]);
  });
});
