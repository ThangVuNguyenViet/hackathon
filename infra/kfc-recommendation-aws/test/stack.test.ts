import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";

import { RecommendationCandidateStack } from "../lib/recommendation-candidate-stack.js";
import { RecommendationPlatformStack } from "../lib/recommendation-platform-stack.js";
import { RecommendationProductionStack } from "../lib/recommendation-production-stack.js";

const synthesize = (): { platform: Template; candidate: Template; production: Template } => {
  const app = new App({ context: { githubRepository: "KFC/recommendations" } });
  const environment = { account: "111122223333", region: "ap-southeast-1" };
  const platform = new RecommendationPlatformStack(app, "RecommendationPlatform", {
    env: environment,
  });
  const candidate = new RecommendationCandidateStack(app, "RecommendationCandidate", {
    env: environment,
    platform,
  });
  const production = new RecommendationProductionStack(app, "RecommendationProduction", {
    env: environment,
    platform,
    candidate,
  });
  return {
    platform: Template.fromStack(platform),
    candidate: Template.fromStack(candidate),
    production: Template.fromStack(production),
  };
};

const platformTemplate = (): Template => synthesize().platform;
const candidateTemplate = (): Template => synthesize().candidate;
const productionTemplate = (): Template => synthesize().production;

describe("independent recommendation stacks", () => {
  it("rejects deployment outside AWS Singapore", () => {
    const app = new App();
    expect(() => new RecommendationPlatformStack(app, "WrongRegion", {
      env: { account: "111122223333", region: "ap-southeast-1" },
    })).not.toThrow();
    expect(() => new RecommendationPlatformStack(app, "WrongRegion2", {
      env: { account: "111122223333", region: "us-west-2" },
    })).toThrow("ap-southeast-1");
  });

  it("uses a private no-NAT VPC with only approved endpoints", () => {
    const template = platformTemplate();
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
    const template = platformTemplate();
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
      TlsConfig: { ServerNameToVerify: { Ref: "InternalAlbServerName" } },
    });
    const routes = template.findResources("AWS::ApiGatewayV2::Route");
    expect(Object.keys(routes)).toHaveLength(7);
    const routeContracts = Object.values(routes).map((resource) => resource.Properties);
    for (const routeKey of [
      "POST /v1/recommendations/local-favorites",
      "POST /v1/recommendations/for-you",
      "POST /v1/recommendations/modifier-upsells",
      "POST /v1/recommendations/smart-cross-sells",
    ]) {
      expect(routeContracts).toContainEqual(
        expect.objectContaining({
          RouteKey: routeKey,
          AuthorizationScopes: ["recommendations/decision.write"],
        }),
      );
    }
    for (const routeKey of [
      "POST /v1/recommendations/{recommendationId}/impressions",
      "POST /v1/recommendations/{recommendationId}/outcomes",
    ]) {
      expect(routeContracts).toContainEqual(
        expect.objectContaining({
          RouteKey: routeKey,
          AuthorizationScopes: ["recommendations/event.write"],
        }),
      );
    }
    expect(routeContracts).toContainEqual(
      expect.objectContaining({
        RouteKey: "GET /v1/admin/recommendations/{recommendationId}/inspection",
        AuthorizationScopes: ["recommendations/inspection.read"],
      }),
    );
    template.hasResourceProperties("AWS::ApiGatewayV2::Stage", {
      StageName: "$default",
      AutoDeploy: true,
    });
  });

  it("runs digest-pinned Main, scorer, and ADOT containers behind guarded readiness", () => {
    const template = productionTemplate();
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
    const taskDefinitions = template.findResources("AWS::ECS::TaskDefinition");
    const task = Object.values(taskDefinitions)[0].Properties;
    const containers = task.ContainerDefinitions as Array<Record<string, unknown>>;
    const main = containers.find((container) => container.Name === "main")!;
    const scorer = containers.find((container) => container.Name === "scorer")!;
    const adot = containers.find((container) => container.Name === "adot")!;
    expect(main.HealthCheck).toEqual(
      expect.objectContaining({ Command: expect.arrayContaining([expect.stringContaining("/ready")]) }),
    );
    expect(main.Command).toEqual(["node", "dist/src/recommendations/serving/aws-main.js"]);
    const mainEnvironment = Object.fromEntries(
      (main.Environment as Array<{ Name: string; Value: unknown }>).map(({ Name, Value }) => [Name, Value]),
    );
    expect(mainEnvironment).toEqual(expect.objectContaining({
      QUALIFIED_BUNDLE_PATH: "/opt/kfc/bundle",
      TRUSTED_CATALOG_PATH: "/opt/kfc/catalog/catalog.json",
      TRUSTED_CATALOG_DIGEST: { Ref: "TrustedCatalogDigest" },
    }));
    expect(main.Secrets).toEqual(expect.arrayContaining([
      expect.objectContaining({ Name: "RUNTIME_TOKEN" }),
      expect.objectContaining({ Name: "KFC_DEMO_ADMIN_TOKEN" }),
    ]));
    expect(main.DependsOn).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ContainerName: "scorer", Condition: "HEALTHY" }),
        expect.objectContaining({ ContainerName: "adot", Condition: "HEALTHY" }),
      ]),
    );
    expect(adot.HealthCheck).toEqual(expect.objectContaining({ Command: expect.any(Array) }));
    expect(adot.HealthCheck).toEqual(expect.objectContaining({ Command: ["CMD", "/healthcheck"] }));
    const scorerEnvironment = Object.fromEntries(
      (scorer.Environment as Array<{ Name: string; Value: unknown }>).map(({ Name, Value }) => [Name, Value]),
    );
    expect(scorerEnvironment).toEqual(
      expect.objectContaining({
        QUALIFIED_BUNDLE_PATH: "/opt/kfc/bundle",
        QUALIFIED_BUNDLE_DIGEST: { Ref: "QualifiedBundleDigest" },
        AUTOMATIC_CONTRACT_DIGEST: { Ref: "AutomaticContractDigest" },
        AUTOMATIC_FEATURE_DIGEST: { Ref: "AutomaticFeatureDigest" },
        AUTOMATIC_COMPOSER_DIGEST: { Ref: "AutomaticComposerDigest" },
      }),
    );
    template.hasResourceProperties("AWS::ECS::Service", {
      DeploymentConfiguration: Match.objectLike({
        Strategy: "CANARY",
        CanaryConfiguration: { CanaryPercent: 10, CanaryBakeTimeInMinutes: 5 },
        Alarms: Match.objectLike({ Enable: true, Rollback: true }),
      }),
      DesiredCount: 1,
      HealthCheckGracePeriodSeconds: 90,
      LoadBalancers: Match.arrayWith([
        Match.objectLike({
          ContainerName: "main",
          ContainerPort: 8080,
          AdvancedConfiguration: Match.objectLike({
            AlternateTargetGroupArn: Match.anyValue(),
            ProductionListenerRule: Match.anyValue(),
            TestListenerRule: Match.anyValue(),
            RoleArn: Match.anyValue(),
          }),
        }),
      ]),
    });
    expect(JSON.stringify(template.toJSON())).not.toContain("ActivateProduction");
  });

  it("keeps candidate and production task definitions in independently deployable stacks", () => {
    const candidate = candidateTemplate();
    const production = productionTemplate();
    candidate.resourceCountIs("AWS::ECS::Service", 1);
    candidate.resourceCountIs("AWS::ECS::TaskDefinition", 1);
    production.resourceCountIs("AWS::ECS::Service", 1);
    production.resourceCountIs("AWS::ECS::TaskDefinition", 1);
    candidate.hasResourceProperties("AWS::ECS::Service", { DesiredCount: 1 });
    production.hasResourceProperties("AWS::ECS::Service", { DesiredCount: 1 });
    expect(JSON.stringify(candidate.toJSON())).not.toContain("ProductionService");
    expect(JSON.stringify(production.toJSON())).not.toContain("CandidateValidationService");
    expect(JSON.stringify(candidate.toJSON())).not.toContain("ActivateProduction");
    expect(JSON.stringify(production.toJSON())).not.toContain("ActivateProduction");
    const template = candidate;
    template.hasResourceProperties("AWS::Lambda::Function", Match.objectLike({
      Runtime: "nodejs24.x",
      VpcConfig: Match.objectLike({}),
      Environment: { Variables: Match.objectLike({ RELEASE_DIGEST: { Ref: "ReleaseDigest" } }) },
    }));
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      Namespace: "KFC/RecommendationsActivation",
      MetricName: "CandidateProbePassed",
      TreatMissingData: "breaching",
      Dimensions: [{ Name: "ReleaseDigest", Value: { Ref: "ReleaseDigest" } }],
    });
  });

  it("encrypts and retains immutable evidence and transactional state", () => {
    const template = platformTemplate();
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
  });

  it("prewarms rush capacity in Ho Chi Minh time and keeps reactive guardrails", () => {
    const template = productionTemplate();
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
    const template = productionTemplate();
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

  it("has no internet route and attaches policies to every private endpoint", () => {
    const template = platformTemplate();
    template.resourceCountIs("AWS::EC2::InternetGateway", 0);
    template.resourceCountIs("AWS::EC2::NatGateway", 0);
    for (const endpoint of Object.values(template.findResources("AWS::EC2::VPCEndpoint"))) {
      expect(endpoint.Properties.PolicyDocument).toEqual(expect.any(Object));
    }
    const egressRules = Object.values(template.findResources("AWS::EC2::SecurityGroupEgress"));
    expect(egressRules.every((rule) => rule.Properties.FromPort !== 80)).toBe(true);
    expect(egressRules.every((rule) => rule.Properties.IpProtocol !== "-1")).toBe(true);
    const endpointPolicies = JSON.stringify(template.findResources("AWS::EC2::VPCEndpoint"));
    for (const action of ["s3:ListBucketVersions", "s3:GetObjectVersion", "dynamodb:DeleteItem"]) {
      expect(endpointPolicies).toContain(action);
    }
    expect(endpointPolicies).toContain("starport-layer-bucket/*");
    expect(endpointPolicies).toContain("prod-");
    expect(endpointPolicies).toContain("EvidenceBucket");
    expect(endpointPolicies).toContain("automatic-recommendations/*");
    expect(endpointPolicies).not.toContain("/evidence/*");
    expect(endpointPolicies).toContain("StateTable");
  });

  it("seeds non-overwriting release-scoped readiness sentinels for every authority", () => {
    const customResources = JSON.stringify(candidateTemplate().findResources("Custom::AWS"));
    expect(customResources).toContain("RELEASE#");
    for (const sortKey of [
      "ORDER",
      "JOURNEY",
      "CATALOG",
      "EXPOSURE#local_favorite",
      "EXPOSURE#for_you",
      "EXPOSURE#modifier_upsell",
      "EXPOSURE#smart_cross_sell",
    ]) expect(customResources).toContain(sortKey);
    expect(customResources).not.toContain('"S":"EXPOSURE"');
    expect(customResources).toContain("TrustedCatalogDigest");
  });

  it("grants the candidate VPC Lambda the complete AWS ENI lifecycle contract", () => {
    const policies = JSON.stringify(candidateTemplate().findResources("AWS::IAM::Policy"));
    for (const action of [
      "ec2:DescribeSubnets",
      "ec2:DescribeSecurityGroups",
      "ec2:DescribeNetworkInterfaces",
      "ec2:CreateNetworkInterface",
      "ec2:DeleteNetworkInterface",
      "ec2:AssignPrivateIpAddresses",
      "ec2:UnassignPrivateIpAddresses",
    ]) expect(policies).toContain(action);
  });

  it("alarms on failures across primary, alternate, and validation target groups", () => {
    const alarms = JSON.stringify(productionTemplate().findResources("AWS::CloudWatch::Alarm"));
    expect(alarms).toContain("ProductionTargetGroup");
    expect(alarms).toContain("AlternateTargetGroup");
    expect(alarms).toContain("ValidationTargetGroup");
  });

  it("creates scoped Cognito M2M identities", () => {
    const template = platformTemplate();
    template.hasResourceProperties("AWS::Cognito::UserPoolResourceServer", {
      Identifier: "recommendations",
      Scopes: Match.arrayWith([
        { ScopeName: "decision.write", ScopeDescription: Match.anyValue() },
        { ScopeName: "event.write", ScopeDescription: Match.anyValue() },
        { ScopeName: "inspection.read", ScopeDescription: Match.anyValue() },
      ]),
    });
    template.hasResourceProperties("AWS::Cognito::UserPoolClient", {
      AllowedOAuthFlows: ["client_credentials"],
      GenerateSecret: true,
    });
    template.hasResourceProperties("AWS::Cognito::UserPoolDomain", Match.objectLike({}));
  });
});
