import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";

import { RecommendationSandboxStack } from "../lib/recommendation-sandbox-stack.js";

const synthesize = (): Template => {
  const app = new App({ context: { githubRepository: "KFC/recommendations" } });
  const stack = new RecommendationSandboxStack(app, "RecommendationSandbox", {
    env: { account: "111122223333", region: "ap-southeast-1" },
  });
  return Template.fromStack(stack);
};

describe("RecommendationSandboxStack", () => {
  it("rejects deployment outside AWS Singapore", () => {
    const app = new App();
    expect(
      () =>
        new RecommendationSandboxStack(app, "WrongRegion", {
          env: { account: "111122223333", region: "us-west-2" },
        }),
    ).toThrow("ap-southeast-1");
  });

  it("uses a private no-NAT VPC with only approved endpoints", () => {
    const template = synthesize();
    template.resourceCountIs("AWS::EC2::NatGateway", 0);
    template.resourceCountIs("AWS::EC2::VPCEndpoint", 8);
    const endpoints = JSON.stringify(template.findResources("AWS::EC2::VPCEndpoint"));
    expect(endpoints).toContain('"VpcEndpointType":"Gateway"');
    expect(endpoints).toContain("s3");
    expect(endpoints).toContain("dynamodb");
    for (const endpoint of [
      "ecr.api",
      "ecr.dkr",
      "logs",
      "secretsmanager",
      "monitoring",
      "xray",
    ]) {
      template.hasResourceProperties("AWS::EC2::VPCEndpoint", {
        VpcEndpointType: "Interface",
        PrivateDnsEnabled: true,
        ServiceName: Match.stringLikeRegexp(`${endpoint.replace(".", "\\.")}$`),
      });
    }
  });

  it("routes the default HTTP API through VPC Link V2 to an internal HTTPS ALB", () => {
    const template = synthesize();
    template.hasResourceProperties("AWS::ElasticLoadBalancingV2::LoadBalancer", {
      Scheme: "internal",
      Type: "application",
    });
    template.hasResourceProperties("AWS::ElasticLoadBalancingV2::Listener", {
      Port: 443,
      Protocol: "HTTPS",
    });
    template.hasResourceProperties("AWS::ApiGatewayV2::VpcLink", Match.objectLike({}));
    template.hasResourceProperties("AWS::ApiGatewayV2::Integration", {
      ConnectionType: "VPC_LINK",
      IntegrationMethod: "ANY",
      IntegrationType: "HTTP_PROXY",
      PayloadFormatVersion: "1.0",
    });
    template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "$default",
      AuthorizationType: "JWT",
      AuthorizationScopes: ["recommendations/decide", "recommendations/events"],
    });
    template.hasResourceProperties("AWS::ApiGatewayV2::Stage", {
      StageName: "$default",
      AutoDeploy: true,
    });
  });

  it("runs digest-pinned Main, scorer, and ADOT containers behind guarded readiness", () => {
    const template = synthesize();
    template.hasResourceProperties("AWS::ECS::TaskDefinition", {
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({ Name: "scorer", Essential: true }),
        Match.objectLike({ Name: "adot", Essential: true }),
        Match.objectLike({ Name: "main", Essential: true }),
      ]),
      Cpu: "1024",
      Memory: "3072",
      NetworkMode: "awsvpc",
      RequiresCompatibilities: ["FARGATE"],
    });
    template.hasResourceProperties("AWS::ElasticLoadBalancingV2::TargetGroup", {
      HealthCheckPath: "/recommendations/ready",
      Matcher: { HttpCode: "200" },
      TargetType: "ip",
    });
    template.hasResourceProperties("AWS::ECS::Service", {
      DeploymentConfiguration: Match.objectLike({
        DeploymentCircuitBreaker: { Enable: true, Rollback: true },
      }),
      DesiredCount: 1,
      HealthCheckGracePeriodSeconds: 90,
    });
  });

  it("encrypts and retains immutable evidence and transactional state", () => {
    const template = synthesize();
    template.hasResourceProperties("AWS::S3::Bucket", {
      BucketEncryption: Match.objectLike({}),
      VersioningConfiguration: { Status: "Enabled" },
      LoggingConfiguration: Match.objectLike({ LogFilePrefix: "evidence-access/" }),
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      BillingMode: "PAY_PER_REQUEST",
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
      SSESpecification: { SSEEnabled: true, SSEType: "KMS" },
    });
    template.hasResourceProperties("AWS::ECR::Repository", {
      ImageTagMutability: "IMMUTABLE",
      ImageScanningConfiguration: { ScanOnPush: true },
    });
  });

  it("prewarms rush capacity in Ho Chi Minh time and keeps reactive guardrails", () => {
    const template = synthesize();
    const scalableTargets = template.findResources("AWS::ApplicationAutoScaling::ScalableTarget");
    const serialized = JSON.stringify(scalableTargets);
    for (const schedule of ["cron(0 10 * * ? *)", "cron(30 14 * * ? *)", "cron(30 16 * * ? *)", "cron(0 22 * * ? *)"]) {
      expect(serialized).toContain(schedule);
    }
    expect(serialized).toContain("Asia/Ho_Chi_Minh");
    expect(serialized).toContain('"MinCapacity":2');
    template.hasResourceProperties("AWS::ApplicationAutoScaling::ScalingPolicy", {
      PolicyType: "TargetTrackingScaling",
      TargetTrackingScalingPolicyConfiguration: Match.objectLike({
        TargetValue: 65,
      }),
    });
  });

  it("retains structured telemetry and creates bounded alarms and a composite", () => {
    const template = synthesize();
    template.hasResourceProperties("AWS::Logs::LogGroup", { RetentionInDays: 30 });
    template.hasResourceProperties("AWS::CloudWatch::Dashboard", Match.objectLike({}));
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      EvaluateLowSampleCountPercentile: "ignore",
    });
    template.resourceCountIs("AWS::CloudWatch::CompositeAlarm", 1);
    const metrics = JSON.stringify(template.findResources("AWS::CloudWatch::Alarm"));
    expect(metrics).not.toContain("DecisionId");
    expect(metrics).not.toContain("CustomerId");
    expect(metrics).not.toContain("StoreId");
  });

  it("creates scoped Cognito M2M and GitHub OIDC deployment identities", () => {
    const template = synthesize();
    template.hasResourceProperties("AWS::Cognito::UserPoolResourceServer", {
      Identifier: "recommendations",
      Scopes: Match.arrayWith([
        { ScopeName: "decide", ScopeDescription: Match.anyValue() },
        { ScopeName: "events", ScopeDescription: Match.anyValue() },
      ]),
    });
    template.hasResourceProperties("AWS::Cognito::UserPoolClient", {
      AllowedOAuthFlows: ["client_credentials"],
      GenerateSecret: true,
    });
    template.hasResourceProperties("AWS::Cognito::UserPoolDomain", Match.objectLike({}));
    template.hasResourceProperties("AWS::IAM::OIDCProvider", {
      Url: "https://token.actions.githubusercontent.com",
    });
    template.hasResourceProperties("AWS::IAM::Role", {
      AssumeRolePolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({ Action: "sts:AssumeRoleWithWebIdentity" }),
        ]),
      }),
    });
  });
});
