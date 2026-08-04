import { CfnParameter, CfnRule, Fn } from "aws-cdk-lib";
import { Construct } from "constructs";

import { contentDigestPattern, immutableDigestPattern } from "./release-contract.js";

export interface ReleaseParameters {
  readonly mainImageDigest: CfnParameter;
  readonly scorerImageDigest: CfnParameter;
  readonly adotImageDigest: CfnParameter;
  readonly qualifiedBundleDigest: CfnParameter;
  readonly automaticContractDigest: CfnParameter;
  readonly automaticFeatureDigest: CfnParameter;
  readonly automaticComposerDigest: CfnParameter;
  readonly releaseDigest: CfnParameter;
  readonly previousReleaseDigest: CfnParameter;
  readonly allowRollbackToPaused: CfnParameter;
  readonly certificateArn: CfnParameter;
  readonly internalAlbServerName: CfnParameter;
  readonly maximumTasks: CfnParameter;
  readonly activateService: CfnParameter;
}

const digestParameter = (scope: Construct, id: string, description: string): CfnParameter =>
  new CfnParameter(scope, id, {
    type: "String",
    allowedPattern: immutableDigestPattern,
    constraintDescription: "must be a lowercase sha256 digest",
    description,
  });

const contentParameter = (scope: Construct, id: string, description: string): CfnParameter =>
  new CfnParameter(scope, id, {
    type: "String",
    allowedPattern: contentDigestPattern,
    constraintDescription: "must be a lowercase 64-character sha256 content digest",
    description,
  });

export const createReleaseParameters = (scope: Construct): ReleaseParameters => {
  const mainImageDigest = digestParameter(scope, "MainImageDigest", "Qualified Node 24 Main image digest");
  const scorerImageDigest = digestParameter(scope, "ScorerImageDigest", "Qualified Python scorer image digest");
  const adotImageDigest = digestParameter(scope, "AdotImageDigest", "Pinned ADOT collector image digest");
  const qualifiedBundleDigest = contentParameter(
    scope,
    "QualifiedBundleDigest",
    "Atomic four-ranker Qualified Model Bundle digest",
  );
  const automaticContractDigest = contentParameter(
    scope,
    "AutomaticContractDigest",
    "Canonical cross-runtime recommendation contract digest",
  );
  const automaticFeatureDigest = contentParameter(
    scope,
    "AutomaticFeatureDigest",
    "Canonical fixed feature schema digest",
  );
  const automaticComposerDigest = contentParameter(
    scope,
    "AutomaticComposerDigest",
    "Canonical deterministic composer contract digest",
  );
  const releaseDigest = contentParameter(scope, "ReleaseDigest", "Immutable recommendation release digest");
  const previousReleaseDigest = new CfnParameter(scope, "PreviousReleaseDigest", {
    type: "String",
    default: "",
    allowedPattern: `^$|${contentDigestPattern.slice(1)}`,
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
  const internalAlbServerName = new CfnParameter(scope, "InternalAlbServerName", {
    type: "String",
    allowedPattern:
      "^(?=.{1,253}$)([A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\\.)+[A-Za-z]{2,63}$",
    description: "Private DNS name covered by the ACM certificate and used for API Gateway TLS SNI verification",
  });
  const activateService = new CfnParameter(scope, "ActivateService", {
    type: "String",
    default: "false",
    allowedValues: ["false", "true"],
    description: "Fail-closed activation after deployment preflight verifies every immutable runtime artifact",
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
    automaticContractDigest,
    automaticFeatureDigest,
    automaticComposerDigest,
    releaseDigest,
    previousReleaseDigest,
    allowRollbackToPaused,
    certificateArn,
    internalAlbServerName,
    maximumTasks,
    activateService,
  };
};
