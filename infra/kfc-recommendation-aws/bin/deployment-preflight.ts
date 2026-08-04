#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

import { evaluateDeploymentGate, type DeploymentFacts } from "../lib/deployment-gate.js";

interface CallerIdentity {
  readonly Account: string;
  readonly Arn: string;
}

const awsJson = <T>(args: readonly string[]): T | undefined => {
  try {
    return JSON.parse(
      execFileSync("aws", [...args, "--output", "json"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }),
    ) as T;
  } catch {
    return undefined;
  }
};

const awsText = (args: readonly string[]): string | undefined => {
  try {
    return execFileSync("aws", [...args, "--output", "text"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
};

const imageExists = (repository: string, digest: string | undefined): boolean =>
  digest !== undefined &&
  awsJson([
    "ecr",
    "describe-images",
    "--region",
    "ap-southeast-1",
    "--repository-name",
    repository,
    "--image-ids",
    `imageDigest=${digest}`,
  ]) !== undefined;

const bundleMatches = (path: string | undefined, digest: string | undefined): boolean => {
  if (path === undefined || digest === undefined || !existsSync(path)) return false;
  const actual = `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
  return actual === digest;
};

const identity = awsJson<CallerIdentity>(["sts", "get-caller-identity", "--region", "ap-southeast-1"]);
const endpointNames =
  awsJson<{ ServiceNames?: string[] }>([
    "ec2",
    "describe-vpc-endpoint-services",
    "--region",
    "ap-southeast-1",
  ])?.ServiceNames ?? [];
const certificateArn = process.env.INTERNAL_ALB_CERTIFICATE_ARN;
const certificatePresent =
  certificateArn !== undefined &&
  awsJson([
    "acm",
    "describe-certificate",
    "--region",
    "ap-southeast-1",
    "--certificate-arn",
    certificateArn,
  ]) !== undefined;

const facts: DeploymentFacts = {
  expectedAccount: process.env.EXPECTED_AWS_ACCOUNT ?? "",
  callerAccount: identity?.Account,
  callerArn: identity?.Arn,
  configuredRegion: awsText(["configure", "get", "region"]),
  endpointNames,
  bundlePresentAndVerified: bundleMatches(
    process.env.QUALIFIED_BUNDLE_PATH,
    process.env.QUALIFIED_BUNDLE_DIGEST,
  ),
  mainImagePresent: imageExists("kfc-recommendation-main", process.env.MAIN_IMAGE_DIGEST),
  scorerImagePresent: imageExists("kfc-recommendation-scorer", process.env.SCORER_IMAGE_DIGEST),
  adotImagePresent: imageExists("kfc-recommendation-adot", process.env.ADOT_IMAGE_DIGEST),
  certificatePresent,
  previousReleasePresent: process.env.PREVIOUS_RELEASE_DIGEST !== undefined,
  allowRollbackToPaused: process.env.ALLOW_ROLLBACK_TO_PAUSED === "true",
};
const blockers = evaluateDeploymentGate(facts);
const report = {
  deployable: blockers.length === 0,
  verifiedCaller: identity === undefined ? null : { account: identity.Account, arn: identity.Arn },
  configuredRegion: facts.configuredRegion ?? null,
  verifiedEndpointCount: endpointNames.length,
  blockers,
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (blockers.length > 0) process.exitCode = 2;
