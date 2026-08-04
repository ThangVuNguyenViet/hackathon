import { describe, expect, it } from "vitest";

import { evaluateDeploymentGate, requiredEndpointNames } from "../lib/deployment-gate.js";

const account = "111122223333";
const complete = () => ({
  expectedAccount: account,
  callerAccount: account,
  callerArn: `arn:aws:iam::${account}:user/deployer`,
  configuredRegion: "ap-southeast-1",
  endpointNames: requiredEndpointNames("ap-southeast-1"),
  bundlePresentAndVerified: true,
  mainImagePresent: true,
  scorerImagePresent: true,
  adotImagePresent: true,
  certificatePresent: true,
  previousReleasePresent: true,
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
        bundlePresentAndVerified: false,
        mainImagePresent: false,
        scorerImagePresent: false,
        adotImagePresent: false,
        certificatePresent: false,
        previousReleasePresent: false,
      }),
    ).toEqual([
      "AWS caller identity is unavailable",
      "configured AWS region must be ap-southeast-1",
      "required VPC endpoint services are not verified in ap-southeast-1",
      "Qualified Model Bundle is absent or does not match its digest",
      "Main image digest is absent from ECR",
      "scorer image digest is absent from ECR",
      "ADOT image digest is absent from ECR",
      "internal ALB certificate is absent",
      "previous compatible release is absent; first release must explicitly rollback to paused",
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
        previousReleasePresent: false,
        allowRollbackToPaused: true,
      }),
    ).toEqual([]);
  });
});
