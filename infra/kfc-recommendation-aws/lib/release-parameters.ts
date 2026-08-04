import { CfnParameter, CfnRule, Fn } from "aws-cdk-lib";
import { Construct } from "constructs";

import { immutableDigestPattern } from "./release-contract.js";

export interface ReleaseParameters {
  readonly mainImageDigest: CfnParameter;
  readonly scorerImageDigest: CfnParameter;
  readonly adotImageDigest: CfnParameter;
  readonly qualifiedBundleDigest: CfnParameter;
  readonly releaseDigest: CfnParameter;
  readonly previousReleaseDigest: CfnParameter;
  readonly allowRollbackToPaused: CfnParameter;
  readonly certificateArn: CfnParameter;
  readonly cdkDeploymentRoleArn: CfnParameter;
  readonly maximumTasks: CfnParameter;
}

const digestParameter = (scope: Construct, id: string, description: string): CfnParameter =>
  new CfnParameter(scope, id, {
    type: "String",
    allowedPattern: immutableDigestPattern,
    constraintDescription: "must be a lowercase sha256 digest",
    description,
  });

export const createReleaseParameters = (scope: Construct): ReleaseParameters => {
  const mainImageDigest = digestParameter(scope, "MainImageDigest", "Qualified Node 24 Main image digest");
  const scorerImageDigest = digestParameter(scope, "ScorerImageDigest", "Qualified Python scorer image digest");
  const adotImageDigest = digestParameter(scope, "AdotImageDigest", "Pinned ADOT collector image digest");
  const qualifiedBundleDigest = digestParameter(
    scope,
    "QualifiedBundleDigest",
    "Atomic four-ranker Qualified Model Bundle digest",
  );
  const releaseDigest = digestParameter(scope, "ReleaseDigest", "Immutable recommendation release digest");
  const previousReleaseDigest = new CfnParameter(scope, "PreviousReleaseDigest", {
    type: "String",
    default: "",
    allowedPattern: `^$|${immutableDigestPattern.slice(1)}`,
    description: "Previous compatible completed release; empty only for rollback-to-paused first release",
  });
  const allowRollbackToPaused = new CfnParameter(scope, "AllowRollbackToPaused", {
    type: "String",
    default: "false",
    allowedValues: ["false", "true"],
  });
  new CfnRule(scope, "FirstReleaseRollbackRule", {
    assertions: [
      {
        assert: Fn.conditionOr(
          Fn.conditionNot(Fn.conditionEquals(previousReleaseDigest.valueAsString, "")),
          Fn.conditionEquals(allowRollbackToPaused.valueAsString, "true"),
        ),
        assertDescription:
          "PreviousReleaseDigest is required unless the first release explicitly rolls back to paused",
      },
    ],
  });
  const certificateArn = new CfnParameter(scope, "InternalAlbCertificateArn", {
    type: "String",
    allowedPattern: "^arn:aws:acm:ap-southeast-1:[0-9]{12}:certificate/[a-f0-9-]+$",
    description: "Existing ACM certificate for the private ALB HTTPS listener",
  });
  const cdkDeploymentRoleArn = new CfnParameter(scope, "CdkDeploymentRoleArn", {
    type: "String",
    allowedPattern: "^arn:aws:iam::[0-9]{12}:role/[A-Za-z0-9+=,.@_/-]+$",
    description: "Existing least-privilege CDK bootstrap deployment role assumed by GitHub OIDC",
  });
  const maximumTasks = new CfnParameter(scope, "MaximumTasks", {
    type: "Number",
    default: 4,
    minValue: 3,
    maxValue: 30,
    description: "Temporary safety ceiling; replace with the measured Peak Serving Envelope calculation",
  });
  return {
    mainImageDigest,
    scorerImageDigest,
    adotImageDigest,
    qualifiedBundleDigest,
    releaseDigest,
    previousReleaseDigest,
    allowRollbackToPaused,
    certificateArn,
    cdkDeploymentRoleArn,
    maximumTasks,
  };
};
