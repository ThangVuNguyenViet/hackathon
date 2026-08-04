#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import {
  activationProofMatches,
  certificateIsIssuedFor,
  endpointsAreAvailable,
  manifestDigestMatches,
  ociManifestSupports,
  previousReleaseIsCompletedAndCompatible,
  qualifiedBundleManifestMatches,
  templateHasAlarmLinkedCanaryRollback,
  type ActivationBindings,
} from "../lib/artifact-verification.js";
import { evaluateDeploymentGate, type DeploymentFacts } from "../lib/deployment-gate.js";

interface CallerIdentity { readonly Account: string; readonly Arn: string }
interface EndpointServices { readonly ServiceNames?: string[] }
interface EndpointStates { readonly VpcEndpoints?: Array<{ VpcEndpointId?: string; State?: string }> }
interface BatchImage { readonly images?: Array<{ imageManifest?: string }> }
interface CertificateResponse { readonly Certificate?: { Status?: string; DomainName?: string; SubjectAlternativeNames?: string[] } }
interface LogEvents { readonly events?: unknown[] }
interface XrayTraces { readonly Traces?: Array<{ Segments?: Array<{ Document?: string }> }> }
interface MetricPoints { readonly Datapoints?: unknown[] }

const awsJson = <T>(args: readonly string[]): T | undefined => {
  try {
    return JSON.parse(execFileSync("aws", [...args, "--output", "json"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    })) as T;
  } catch { return undefined; }
};

const awsText = (args: readonly string[]): string | undefined => {
  try {
    return execFileSync("aws", [...args, "--output", "text"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch { return undefined; }
};

const jsonFile = (path: string | undefined): unknown => {
  if (path === undefined || !existsSync(path)) return undefined;
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return undefined; }
};

const exactFileDigest = (path: string | undefined, digest: string | undefined): boolean =>
  path !== undefined && digest !== undefined && existsSync(path) &&
  manifestDigestMatches(readFileSync(path), digest);

const imageIsArm64 = (repository: string, digest: string | undefined): boolean => {
  if (digest === undefined) return false;
  const response = awsJson<BatchImage>([
    "ecr", "batch-get-image", "--region", "ap-southeast-1",
    "--repository-name", repository, "--image-ids", `imageDigest=${digest}`,
    "--accepted-media-types", "application/vnd.oci.image.index.v1+json",
    "application/vnd.docker.distribution.manifest.list.v2+json",
  ]);
  return ociManifestSupports(response?.images?.[0]?.imageManifest, digest, "linux", "arm64");
};

const executableRuntimeProbe = async (releaseDigest: string): Promise<boolean> => {
  const baseUrl = process.env.MAIN_PROBE_URL;
  const token = process.env.MAIN_PROBE_BEARER_TOKEN;
  const traceId = process.env.RUNTIME_PROBE_TRACE_ID;
  const loadBalancer = process.env.ALB_FULL_NAME;
  if (baseUrl === undefined || token === undefined || traceId === undefined || loadBalancer === undefined) return false;
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/ready?deep=1`, {
      headers: { authorization: `Bearer ${token}`, "x-kfc-runtime-probe": releaseDigest },
      signal: AbortSignal.timeout(5_000),
    });
    const body = await response.json() as { checks?: { automaticRecommendations?: { ok?: boolean } } };
    if (response.status !== 200 || body.checks?.automaticRecommendations?.ok !== true) return false;
  } catch { return false; }
  const logs = awsJson<LogEvents>([
    "logs", "filter-log-events", "--region", "ap-southeast-1",
    "--log-group-name", "/kfc/recommendations/sandbox/application",
    "--filter-pattern", `{ $.event = \"recommendation_runtime_probe\" && $.releaseDigest = \"${releaseDigest}\" }`,
    "--limit", "1",
  ]);
  const traces = awsJson<XrayTraces>([
    "xray", "batch-get-traces", "--region", "ap-southeast-1", "--trace-ids", traceId,
  ]);
  const end = new Date();
  const start = new Date(end.getTime() - 15 * 60_000);
  const metrics = awsJson<MetricPoints>([
    "cloudwatch", "get-metric-statistics", "--region", "ap-southeast-1",
    "--namespace", "AWS/ApplicationELB", "--metric-name", "RequestCount",
    "--dimensions", `Name=LoadBalancer,Value=${loadBalancer}`,
    "--start-time", start.toISOString(), "--end-time", end.toISOString(),
    "--period", "60", "--statistics", "Sum",
  ]);
  const traceBound = (traces?.Traces ?? []).some((trace) =>
    (trace.Segments ?? []).some((segment) => segment.Document?.includes(releaseDigest)));
  return (logs?.events?.length ?? 0) > 0 && traceBound && (metrics?.Datapoints?.length ?? 0) > 0;
};

const bindings: ActivationBindings = {
  releaseDigest: process.env.RELEASE_DIGEST ?? "",
  bundleDigest: process.env.QUALIFIED_BUNDLE_DIGEST ?? "",
  contractDigest: process.env.AUTOMATIC_CONTRACT_DIGEST ?? "",
  featureDigest: process.env.AUTOMATIC_FEATURE_DIGEST ?? "",
  composerDigest: process.env.AUTOMATIC_COMPOSER_DIGEST ?? "",
};
const bundleRoot = process.env.QUALIFIED_BUNDLE_ROOT;
const bundleManifest = jsonFile(bundleRoot === undefined ? undefined : join(bundleRoot, "bundle-manifest.json"));
const bundlePayloadsMatch = (() => {
  if (bundleRoot === undefined || typeof bundleManifest !== "object" || bundleManifest === null) return false;
  const payloads = (bundleManifest as { payloadDigests?: unknown }).payloadDigests;
  if (typeof payloads !== "object" || payloads === null) return false;
  return Object.entries(payloads).every(([relative, expected]) =>
    typeof expected === "string" && exactFileDigest(join(bundleRoot, relative), expected));
})();
const identity = awsJson<CallerIdentity>(["sts", "get-caller-identity", "--region", "ap-southeast-1"]);
const endpointNames = awsJson<EndpointServices>([
  "ec2", "describe-vpc-endpoint-services", "--region", "ap-southeast-1",
])?.ServiceNames ?? [];
const endpointIds = (process.env.VPC_ENDPOINT_IDS ?? "").split(",").filter(Boolean);
const endpointStates = endpointIds.length === 0 ? undefined : awsJson<EndpointStates>([
  "ec2", "describe-vpc-endpoints", "--region", "ap-southeast-1",
  "--vpc-endpoint-ids", ...endpointIds,
]);
const serverName = process.env.INTERNAL_ALB_SERVER_NAME ?? "";
const certificate = process.env.INTERNAL_ALB_CERTIFICATE_ARN === undefined ? undefined :
  awsJson<CertificateResponse>([
    "acm", "describe-certificate", "--region", "ap-southeast-1",
    "--certificate-arn", process.env.INTERNAL_ALB_CERTIFICATE_ARN,
  ])?.Certificate;
const previous = jsonFile(process.env.PREVIOUS_RELEASE_MANIFEST_PATH);
const template = jsonFile(
  process.env.SYNTHESIZED_SERVICE_TEMPLATE_PATH ??
    "cdk.out/KfcRecommendationSyntheticSandbox.template.json",
);
const facts: DeploymentFacts = {
  expectedAccount: process.env.EXPECTED_AWS_ACCOUNT ?? "",
  callerAccount: identity?.Account,
  callerArn: identity?.Arn,
  configuredRegion: awsText(["configure", "get", "region"]),
  endpointNames,
  deployedEndpointsAvailable: endpointsAreAvailable(endpointStates?.VpcEndpoints ?? [], endpointIds),
  bundlePresentAndVerified:
    qualifiedBundleManifestMatches(bundleManifest, bindings) && bundlePayloadsMatch,
  releaseManifestPresentAndVerified: exactFileDigest(process.env.RELEASE_MANIFEST_PATH, bindings.releaseDigest),
  mainImagePresentAndArm64: imageIsArm64(process.env.MAIN_REPOSITORY_NAME ?? "kfc-recommendation-main", process.env.MAIN_IMAGE_DIGEST),
  scorerImagePresentAndArm64: imageIsArm64(process.env.SCORER_REPOSITORY_NAME ?? "kfc-recommendation-scorer", process.env.SCORER_IMAGE_DIGEST),
  adotImagePresentAndArm64: imageIsArm64(process.env.ADOT_REPOSITORY_NAME ?? "kfc-recommendation-adot", process.env.ADOT_IMAGE_DIGEST),
  certificateIssuedAndMatchesServerName: certificateIsIssuedFor(certificate, serverName),
  previousReleaseCompletedAndCompatible: previousReleaseIsCompletedAndCompatible(
    previous as never, process.env.PREVIOUS_RELEASE_DIGEST ?? "", bindings.contractDigest,
  ),
  allowRollbackToPaused: process.env.ALLOW_ROLLBACK_TO_PAUSED === "true",
  alarmLinkedCanaryRollback: templateHasAlarmLinkedCanaryRollback((template ?? {}) as never),
  activationProofVerified: activationProofMatches(jsonFile(process.env.ACTIVATION_PROOF_PATH), bindings),
  executableRuntimeProbeVerified: await executableRuntimeProbe(bindings.releaseDigest),
};
const blockers = evaluateDeploymentGate(facts);
process.stdout.write(`${JSON.stringify({
  deployable: blockers.length === 0,
  verifiedCaller: identity === undefined ? null : { account: identity.Account, arn: identity.Arn },
  configuredRegion: facts.configuredRegion ?? null,
  verifiedEndpointCount: endpointIds.length,
  blockers,
}, null, 2)}\n`);
if (blockers.length > 0) process.exitCode = 2;
