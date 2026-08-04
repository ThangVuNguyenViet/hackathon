import { describe, expect, it } from "vitest";

import { evaluateDeploymentGate, requiredEndpointNames } from "../lib/deployment-gate.js";

const account = "111122223333";
const complete = () => ({
  expectedAccount: account,
  callerAccount: account,
  callerArn: `arn:aws:iam::${account}:user/deployer`,
  configuredRegion: "ap-southeast-1",
  endpointNames: requiredEndpointNames("ap-southeast-1"),
  deployedEndpointsAvailable: true,
  bundlePresentAndVerified: true,
  releaseManifestPresentAndVerified: true,
  mainImagePresentAndArm64: true,
  scorerImagePresentAndArm64: true,
  adotImagePresentAndArm64: true,
  certificateIssuedAndMatchesServerName: true,
  previousReleaseCompletedAndCompatible: true,
  alarmLinkedCanaryRollback: true,
  activationProofVerified: true,
  executableRuntimeProbeVerified: true,
  allowRollbackToPaused: false,
});

describe("deployment gate", () => {
  it("allows a fully verified immutable release", () => {
    expect(evaluateDeploymentGate(complete())).toEqual([]);
  });

  it("reports every independent fail-closed blocker", () => {
    expect(
      evaluateDeploymentGate({
        ...complete(),
        callerAccount: undefined,
        callerArn: undefined,
        configuredRegion: "us-west-2",
        endpointNames: [],
        deployedEndpointsAvailable: false,
        bundlePresentAndVerified: false,
        releaseManifestPresentAndVerified: false,
        mainImagePresentAndArm64: false,
        scorerImagePresentAndArm64: false,
        adotImagePresentAndArm64: false,
        certificateIssuedAndMatchesServerName: false,
        previousReleaseCompletedAndCompatible: false,
        alarmLinkedCanaryRollback: false,
        activationProofVerified: false,
        executableRuntimeProbeVerified: false,
      }),
    ).toEqual([
      "AWS caller identity is unavailable",
      "configured AWS region must be ap-southeast-1",
      "required VPC endpoint services are not verified in ap-southeast-1",
      "all eight deployed VPC endpoints must be in available state",
      "Qualified Model Bundle is absent or does not match its digest",
      "release manifest is absent or does not match its digest",
      "Main image digest is absent from ECR or is not linux/arm64",
      "scorer image digest is absent from ECR or is not linux/arm64",
      "ADOT image digest is absent from ECR or is not linux/arm64",
      "internal ALB certificate is not ISSUED or does not cover its TLS server name",
      "previous release is absent, incomplete, or contract-incompatible; first release must explicitly rollback to paused",
      "synthesized ECS canary is not linked to alarm rollback and circuit-breaker rollback",
      "runtime activation proof does not verify trusted ports, mounted QMB, digests, telemetry, ADOT health, and cross-runtime warmup",
      "executable runtime probe did not prove deep readiness plus release-bound structured logs and X-Ray telemetry",
    ]);
  });

  it("rejects an unexpected AWS account even with valid credentials", () => {
    expect(evaluateDeploymentGate({ ...complete(), callerAccount: "999900001111" })).toEqual([
      "AWS caller account does not match EXPECTED_AWS_ACCOUNT",
    ]);
  });

  it("permits a first release only when rollback-to-paused is explicit", () => {
    expect(
      evaluateDeploymentGate({
        ...complete(),
        previousReleaseCompletedAndCompatible: false,
        allowRollbackToPaused: true,
      }),
    ).toEqual([]);
  });
});
