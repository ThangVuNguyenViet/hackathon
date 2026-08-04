import { App } from "aws-cdk-lib";
import { AwsSolutionsChecks } from "cdk-nag";
import { describe, expect, it } from "vitest";

import { RecommendationSandboxStack } from "../lib/recommendation-sandbox-stack.js";
import { RecommendationFoundationStack } from "../lib/recommendation-foundation-stack.js";

describe("AWS Solutions security checks", () => {
  it("has no unsuppressed high-confidence findings", () => {
    const app = new App({ context: { githubRepository: "KFC/recommendations" } });
    const stack = new RecommendationSandboxStack(app, "SecurityStack", {
      env: { account: "111122223333", region: "ap-southeast-1" },
    });
    app.synth();
    const report = new AwsSolutionsChecks(app, { verbose: true }).validateScope(stack);
    expect(report.violations).toEqual([]);
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
