import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";

import { RecommendationFoundationStack } from "../lib/recommendation-foundation-stack.js";
import { RecommendationCandidateStack } from "../lib/recommendation-candidate-stack.js";
import { RecommendationPlatformStack } from "../lib/recommendation-platform-stack.js";
import { RecommendationProductionStack } from "../lib/recommendation-production-stack.js";

const environment = { account: "111122223333", region: "ap-southeast-1" };

describe("two-phase deployment foundation", () => {
  it("bootstraps immutable repositories and GitHub OIDC without release artifacts", () => {
    const app = new App({ context: { githubRepository: "KFC/recommendations" } });
    const foundation = new RecommendationFoundationStack(app, "Foundation", { env: environment });
    const template = Template.fromStack(foundation);
    template.resourceCountIs("AWS::ECR::Repository", 3);
    template.hasResourceProperties("AWS::ECR::Repository", {
      ImageTagMutability: "IMMUTABLE",
      ImageScanningConfiguration: { ScanOnPush: true },
    });
    template.hasResourceProperties("AWS::IAM::OIDCProvider", {
      Url: "https://token.actions.githubusercontent.com",
    });
    expect(template.toJSON().Parameters).not.toHaveProperty("MainImageDigest");
  });

  it("keeps platform, candidate validation, and explicit production promotion independently deployable", () => {
    const app = new App({ context: { githubRepository: "KFC/recommendations" } });
    const platform = new RecommendationPlatformStack(app, "Platform", { env: environment });
    const candidate = new RecommendationCandidateStack(app, "Candidate", { env: environment, platform });
    const production = new RecommendationProductionStack(app, "Production", { env: environment, platform, candidate });
    const platformTemplate = Template.fromStack(platform);
    const candidateTemplate = Template.fromStack(candidate);
    const productionTemplate = Template.fromStack(production);
    platformTemplate.resourceCountIs("AWS::ECS::Service", 0);
    platformTemplate.resourceCountIs("AWS::ECS::TaskDefinition", 0);
    candidateTemplate.resourceCountIs("AWS::ECS::Service", 1);
    candidateTemplate.hasResourceProperties("AWS::ECS::Service", { DesiredCount: 1 });
    productionTemplate.resourceCountIs("AWS::ECS::Service", 1);
    productionTemplate.hasResourceProperties("AWS::ECS::Service", { DesiredCount: 1 });
    expect(JSON.stringify(candidateTemplate.toJSON())).not.toContain("ProductionService");
    expect(JSON.stringify(productionTemplate.toJSON())).not.toContain("CandidateValidationService");
    expect(JSON.stringify(candidateTemplate.toJSON())).not.toContain("ActivateProduction");
    expect(JSON.stringify(productionTemplate.toJSON())).not.toContain("ActivateProduction");
  });
});
