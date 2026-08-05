import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  certificateIsIssuedFor,
  activationProofMatches,
  activationAlarmIsCurrent,
  endpointsAreAvailable,
  endpointsMatchDeployment,
  qualifiedBundleManifestMatches,
  releaseManifestMatches,
  manifestDigestMatches,
  ociManifestSupports,
  previousReleaseIsCompletedAndCompatible,
  templateHasAlarmLinkedCanaryRollback,
  templateHasExactRecommendationRoutes,
} from "../lib/artifact-verification.js";

const digest = (value: string): string =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

describe("immutable deployment artifact verification", () => {
  it("matches complete file content to a sha256 digest", () => {
    expect(manifestDigestMatches(Buffer.from("release"), digest("release"))).toBe(true);
    expect(manifestDigestMatches(Buffer.from("release"), digest("release").slice(7))).toBe(true);
    expect(manifestDigestMatches(Buffer.from("tampered"), digest("release"))).toBe(false);
  });

  it("requires an ISSUED certificate covering the exact private server name", () => {
    const certificate = {
      Status: "ISSUED",
      DomainName: "recommendations.internal.example.com",
      SubjectAlternativeNames: ["recommendations.internal.example.com"],
    };
    expect(certificateIsIssuedFor(certificate, "recommendations.internal.example.com")).toBe(true);
    expect(certificateIsIssuedFor({ ...certificate, Status: "PENDING_VALIDATION" }, "recommendations.internal.example.com")).toBe(false);
    expect(certificateIsIssuedFor(certificate, "other.internal.example.com")).toBe(false);
  });

  it("requires an OCI index containing the exact linux/arm64 digest", () => {
    const index = JSON.stringify({
      schemaVersion: 2,
      mediaType: "application/vnd.oci.image.index.v1+json",
      manifests: [
        { digest: `sha256:${"a".repeat(64)}`, platform: { os: "linux", architecture: "arm64" } },
      ],
    });
    const imageDigest = digest(index);
    expect(ociManifestSupports(index, imageDigest, "linux", "arm64")).toBe(true);
    expect(ociManifestSupports(index, imageDigest, "linux", "amd64")).toBe(false);
  });

  it("requires the rollback release to be completed and contract-compatible", () => {
    const previous = {
      releaseDigest: `sha256:${"b".repeat(64)}`,
      state: "completed",
      contractDigest: `sha256:${"c".repeat(64)}`,
      accountId: "111122223333",
      region: "ap-southeast-1",
      completedAt: "2026-08-05T00:00:00.000Z",
      taskDefinitionArn: "arn:aws:ecs:ap-southeast-1:111122223333:task-definition/kfc:42",
    };
    expect(
      previousReleaseIsCompletedAndCompatible(
        previous,
        previous.releaseDigest,
        previous.contractDigest,
        { accountId: previous.accountId, region: previous.region },
      ),
    ).toBe(true);
    expect(
      previousReleaseIsCompletedAndCompatible(
        { ...previous, state: "failed" },
        previous.releaseDigest,
        previous.contractDigest,
      ),
    ).toBe(false);
  });

  it("requires canary traffic, alarms, and both automatic rollback mechanisms", () => {
    const valid = {
      Resources: {
        Blue: { Type: "AWS::ElasticLoadBalancingV2::TargetGroup" },
        Green: { Type: "AWS::ElasticLoadBalancingV2::TargetGroup" },
        ProdRule: { Type: "AWS::ElasticLoadBalancingV2::ListenerRule", Properties: { Actions: [{ Type: "forward", TargetGroupArn: { Ref: "Blue" } }] } },
        TestRule: { Type: "AWS::ElasticLoadBalancingV2::ListenerRule", Properties: { Actions: [{ Type: "forward", TargetGroupArn: { Ref: "Green" } }] } },
        InfrastructureRole: { Type: "AWS::IAM::Role", Properties: {} },
        InfrastructurePolicy: { Type: "AWS::IAM::Policy", Properties: { Roles: [{ Ref: "InfrastructureRole" }], PolicyDocument: { Statement: [{ Action: ["elasticloadbalancing:DescribeTargetHealth", "elasticloadbalancing:RegisterTargets", "elasticloadbalancing:DeregisterTargets", "elasticloadbalancing:ModifyListener", "elasticloadbalancing:ModifyRule"] }] } } },
        Service: {
          Type: "AWS::ECS::Service",
          Properties: {
            DeploymentConfiguration: {
              Strategy: "CANARY",
              CanaryConfiguration: { CanaryPercent: 10, CanaryBakeTimeInMinutes: 5 },
              Alarms: { Enable: true, Rollback: true, AlarmNames: [{ Ref: "ActivationAlarm" }] },
            },
            LoadBalancers: [{
              TargetGroupArn: { Ref: "Blue" },
              AdvancedConfiguration: {
                AlternateTargetGroupArn: { Ref: "Green" },
                ProductionListenerRule: { Ref: "ProdRule" },
                TestListenerRule: { Ref: "TestRule" },
                RoleArn: { "Fn::GetAtt": ["InfrastructureRole", "Arn"] },
              },
            }],
          },
        },
      },
    };
    expect(templateHasAlarmLinkedCanaryRollback(valid)).toBe(true);
    expect(
      templateHasAlarmLinkedCanaryRollback({
        Resources: {
          Service: {
            ...valid.Resources.Service,
            Properties: { DeploymentConfiguration: { Strategy: "ROLLING" } },
          },
        },
      }),
    ).toBe(false);
  });

  it("requires trusted ports, mounted QMB, telemetry, and cross-runtime warmup before activation", () => {
    const bindings = {
      releaseDigest: "a".repeat(64),
      bundleDigest: "b".repeat(64),
      catalogDigest: "f".repeat(64),
      contractDigest: "c".repeat(64),
      featureDigest: "d".repeat(64),
      composerDigest: "e".repeat(64),
    };
    const proof = {
      schemaVersion: "kfc-recommendation-activation-proof-v1",
      ...bindings,
      mainPort: 8080,
      scorerPort: 8081,
      trustedPortsAvailable: true,
      bundleMounted: true,
      crossRuntimeWarmupPassed: true,
      telemetryContractVerified: true,
      structuredLogsVerified: true,
      adotHealthy: true,
    };
    expect(activationProofMatches(proof, bindings)).toBe(true);
    expect(activationProofMatches({ ...proof, bundleMounted: false }, bindings)).toBe(false);
  });

  it("rejects stale or non-OK activation alarms even when older evidence exists", () => {
    const started = "2026-08-05T00:00:00.000Z";
    expect(activationAlarmIsCurrent({ StateValue: "OK" }, started, "2026-08-05T00:01:00.000Z")).toBe(true);
    expect(activationAlarmIsCurrent({ StateValue: "ALARM" }, started, "2026-08-05T00:01:00.000Z")).toBe(false);
    expect(activationAlarmIsCurrent({ StateValue: "OK" }, started, "2026-08-04T23:59:00.000Z")).toBe(false);
  });

  it("requires all eight deployed endpoint IDs to be available", () => {
    const endpoints = Array.from({ length: 8 }, (_, index) => ({
      VpcEndpointId: `vpce-${index}`,
      State: "available",
    }));
    expect(endpointsAreAvailable(endpoints, endpoints.map(({ VpcEndpointId }) => VpcEndpointId))).toBe(true);
    expect(endpointsAreAvailable([{ ...endpoints[0], State: "pending" }, ...endpoints.slice(1)], endpoints.map(({ VpcEndpointId }) => VpcEndpointId))).toBe(false);
  });

  it("binds every live endpoint to the exact VPC, service, and required policy", () => {
    const region = "ap-southeast-1";
    const services = ["s3", "dynamodb", "ecr.api", "ecr.dkr", "logs", "secretsmanager", "monitoring", "xray"];
    const actions: Record<string, string[]> = {
      s3: ["s3:ListBucket", "s3:ListBucketVersions", "s3:GetObject", "s3:GetObjectVersion", "s3:PutObject", "s3:AbortMultipartUpload"],
      dynamodb: ["dynamodb:DescribeTable", "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:Query", "dynamodb:TransactWriteItems"],
      "ecr.api": ["ecr:GetAuthorizationToken", "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:BatchCheckLayerAvailability"],
      "ecr.dkr": ["ecr:GetAuthorizationToken", "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:BatchCheckLayerAvailability"],
      logs: ["logs:CreateLogStream", "logs:PutLogEvents"],
      secretsmanager: ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"],
      monitoring: ["cloudwatch:PutMetricData"],
      xray: ["xray:PutTraceSegments", "xray:PutTelemetryRecords"],
    };
    const endpoints = services.map((service, index) => ({
      VpcEndpointId: `vpce-${index}`,
      State: "available",
      VpcId: "vpc-exact",
      ServiceName: `com.amazonaws.${region}.${service}`,
      PolicyDocument: { Version: "2012-10-17", Statement: [{ Effect: "Allow", Action: actions[service], Resource: service === "s3" ? ["arn:aws:s3:::evidence", "arn:aws:s3:::evidence/evidence/*", `arn:aws:s3:::prod-${region}-starport-layer-bucket/*`] : service === "dynamodb" ? ["arn:aws:dynamodb:ap-southeast-1:111122223333:table/state"] : "*" }] },
    }));
    expect(endpointsMatchDeployment(endpoints, {
      region,
      vpcId: "vpc-exact",
      evidenceBucketArn: "arn:aws:s3:::evidence",
      stateTableArn: "arn:aws:dynamodb:ap-southeast-1:111122223333:table/state",
    })).toBe(true);
    expect(endpointsMatchDeployment([{ ...endpoints[0], VpcId: "vpc-wrong" }, ...endpoints.slice(1)], {
      region, vpcId: "vpc-exact", evidenceBucketArn: "arn:aws:s3:::evidence", stateTableArn: "arn:aws:dynamodb:ap-southeast-1:111122223333:table/state",
    })).toBe(false);
  });

  it("requires semantic image, bundle, and contract bindings in the release manifest", () => {
    const bindings = {
      releaseDigest: "a".repeat(64), bundleDigest: "b".repeat(64), catalogDigest: "f".repeat(64), contractDigest: "c".repeat(64),
      featureDigest: "d".repeat(64), composerDigest: "e".repeat(64),
    };
    const images = { main: `sha256:${"1".repeat(64)}`, scorer: `sha256:${"2".repeat(64)}`, adot: `sha256:${"3".repeat(64)}` };
    const manifest = { schemaVersion: "kfc-recommendation-release-v1", ...bindings, images, region: "ap-southeast-1" };
    expect(releaseManifestMatches(manifest, bindings, images)).toBe(true);
    expect(releaseManifestMatches({ ...manifest, region: "us-west-2" }, bindings, images)).toBe(false);
  });

  it("requires the exact seven protected recommendation routes and no default route", () => {
    const resources: Record<string, unknown> = {};
    for (const [index, [routeKey, scope]] of [
      ["POST /v1/recommendations/local-favorites", "recommendations/decision.write"],
      ["POST /v1/recommendations/for-you", "recommendations/decision.write"],
      ["POST /v1/recommendations/modifier-upsells", "recommendations/decision.write"],
      ["POST /v1/recommendations/smart-cross-sells", "recommendations/decision.write"],
      ["POST /v1/recommendations/{recommendationId}/impressions", "recommendations/event.write"],
      ["POST /v1/recommendations/{recommendationId}/outcomes", "recommendations/event.write"],
      ["GET /v1/admin/recommendations/{recommendationId}/inspection", "recommendations/inspection.read"],
    ].entries()) {
      resources[`Route${index}`] = { Type: "AWS::ApiGatewayV2::Route", Properties: { RouteKey: routeKey, AuthorizationType: "JWT", AuthorizationScopes: [scope] } };
    }
    expect(templateHasExactRecommendationRoutes({ Resources: resources as never })).toBe(true);
    resources.Default = { Type: "AWS::ApiGatewayV2::Route", Properties: { RouteKey: "$default" } };
    expect(templateHasExactRecommendationRoutes({ Resources: resources as never })).toBe(false);
  });

  it("requires an atomic four-ranker bundle bound to every runtime contract digest", () => {
    const bindings = {
      bundleDigest: "b".repeat(64),
      contractDigest: "c".repeat(64),
      featureDigest: "d".repeat(64),
      composerDigest: "e".repeat(64),
    };
    const manifest = {
      schemaVersion: "kfc-qualified-model-bundle-v1",
      ...bindings,
      featureContractDigest: bindings.featureDigest,
      composerContractDigest: bindings.composerDigest,
      champions: {
        local_favorite: "lightgbm",
        for_you: "xgboost",
        modifier_upsell: "logistic",
        smart_cross_sell: "lightgbm",
      },
      payloadDigests: { "models/example": "f".repeat(64) },
    };
    expect(qualifiedBundleManifestMatches(manifest, bindings)).toBe(true);
    expect(qualifiedBundleManifestMatches({ ...manifest, champions: {} }, bindings)).toBe(false);
  });
});
