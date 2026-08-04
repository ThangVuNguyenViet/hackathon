import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";

import { RecommendationFoundationStack } from "../lib/recommendation-foundation-stack.js";
import { RecommendationSandboxStack } from "../lib/recommendation-sandbox-stack.js";

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

  it("keeps the service inactive until immutable artifacts are explicitly activated", () => {
    const app = new App({ context: { githubRepository: "KFC/recommendations" } });
    const service = new RecommendationSandboxStack(app, "Service", { env: environment });
    const template = Template.fromStack(service);
    template.resourceCountIs("AWS::ECR::Repository", 0);
    template.resourceCountIs("AWS::IAM::OIDCProvider", 0);
    expect(template.toJSON().Parameters).toEqual(
      expect.objectContaining({
        ActivateService: expect.objectContaining({ Default: "false" }),
        MainRepositoryName: expect.any(Object),
        ScorerRepositoryName: expect.any(Object),
        AdotRepositoryName: expect.any(Object),
      }),
    );
    template.hasResourceProperties("AWS::ECS::Service", {
      DesiredCount: {
        "Fn::If": ["ActivateServiceCondition", 1, 0],
      },
    });
    for (const resource of Object.values(template.findResources("AWS::ApplicationAutoScaling::ScalableTarget"))) {
      expect(resource.Condition).toBe("ActivateServiceCondition");
    }
    for (const resource of Object.values(template.findResources("AWS::ApplicationAutoScaling::ScalingPolicy"))) {
      expect(resource.Condition).toBe("ActivateServiceCondition");
    }
    template.hasResourceProperties("AWS::ECS::TaskDefinition", {
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          Name: "main",
          Image: Match.objectLike({ "Fn::Join": Match.anyValue() }),
        }),
      ]),
    });
  });
});
