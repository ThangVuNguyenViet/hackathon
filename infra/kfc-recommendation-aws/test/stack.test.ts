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
    template.hasResourceProperties("AWS::ElasticLoadBalancingV2::TargetGroup", {
      HealthCheckPath: "/ready",
      Matcher: { HttpCode: "200" },
      TargetType: "ip",
    });
    template.hasResourceProperties("AWS::ECS::Service", {
      DeploymentConfiguration: Match.objectLike({
        Strategy: { "Fn::If": ["HasLivePrimaryCondition", "CANARY", "ROLLING"] },
        CanaryConfiguration: { "Fn::If": [
          "HasLivePrimaryCondition",
          { CanaryPercent: 10, CanaryBakeTimeInMinutes: 5 },
          { Ref: "AWS::NoValue" },
        ] },
        Alarms: Match.objectLike({ Enable: true, Rollback: true }),
      }),
      DesiredCount: { "Fn::If": ["ActivateProductionCondition", 1, 0] },
      HealthCheckGracePeriodSeconds: 90,
      LoadBalancers: Match.arrayWith([
        Match.objectLike({
          ContainerName: "main",
          ContainerPort: 8080,
          AdvancedConfiguration: Match.objectLike({ "Fn::If": Match.arrayWith([
            "HasLivePrimaryCondition",
            Match.objectLike({
              AlternateTargetGroupArn: Match.anyValue(),
              ProductionListenerRule: Match.anyValue(),
              TestListenerRule: Match.anyValue(),
              RoleArn: Match.anyValue(),
            }),
          ]) }),
        }),
      ]),
    });
    template.resourceCountIs("AWS::ElasticLoadBalancingV2::TargetGroup", 3);
    template.hasResourceProperties("AWS::IAM::Role", {
      AssumeRolePolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([Match.objectLike({ Principal: { Service: "ecs.amazonaws.com" } })]),
      }),
    });
    const policies = JSON.stringify(template.findResources("AWS::IAM::Policy"));
    for (const action of [
      "elasticloadbalancing:DescribeTargetHealth",
      "elasticloadbalancing:RegisterTargets",
      "elasticloadbalancing:DeregisterTargets",
      "elasticloadbalancing:ModifyListener",
      "elasticloadbalancing:ModifyRule",
    ]) expect(policies).toContain(action);
  });

  it("runs an isolated exact-candidate validation service before production activation", () => {
    const template = synthesize();
    const services = Object.values(template.findResources("AWS::ECS::Service"));
    expect(services).toHaveLength(2);
    expect(services).toEqual(expect.arrayContaining([
      expect.objectContaining({ Properties: expect.objectContaining({
        DesiredCount: { "Fn::If": ["ValidateCandidateCondition", 1, 0] },
      }) }),
      expect.objectContaining({ Properties: expect.objectContaining({
        DesiredCount: { "Fn::If": ["ActivateProductionCondition", 1, 0] },
      }) }),
    ]));
    const taskDefinitions = services.map((service) => service.Properties.TaskDefinition);
    expect(taskDefinitions[0]).toEqual(taskDefinitions[1]);
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

  it("has no internet route and attaches policies to every private endpoint", () => {
    const template = synthesize();
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
    expect(endpointPolicies).toContain("StateTable");
  });

  it("grants the candidate VPC Lambda the complete AWS ENI lifecycle contract", () => {
    const policies = JSON.stringify(synthesize().findResources("AWS::IAM::Policy"));
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
    const alarms = JSON.stringify(synthesize().findResources("AWS::CloudWatch::Alarm"));
    expect(alarms).toContain("ProductionTargetGroup");
    expect(alarms).toContain("AlternateTargetGroup");
    expect(alarms).toContain("ValidationTargetGroup");
  });

  it("creates scoped Cognito M2M identities", () => {
    const template = synthesize();
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
