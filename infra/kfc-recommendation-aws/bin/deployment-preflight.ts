#!/usr/bin/env node
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import {
  activationAlarmIsCurrent,
  certificateIsIssuedFor,
  completedReleaseMatchesLive,
  deriveReleaseSourceBindings,
  endpointsMatchDeployment,
  manifestDigestMatches,
  ociManifestSupports,
  previousReleaseIsCompletedAndCompatible,
  qualifiedBundleManifestMatches,
  releaseManifestMatches,
  templateHasAlarmLinkedCanaryRollback,
  templateHasExactRecommendationRoutes,
  type ActivationBindings,
  type CompletedReleaseLiveEvidence,
  type PreviousReleaseRecord,
} from "../lib/artifact-verification.js";
import { evaluateDeploymentGate, type DeploymentFacts } from "../lib/deployment-gate.js";

interface CallerIdentity { readonly Account: string; readonly Arn: string }
interface EndpointServices { readonly ServiceNames?: string[] }
interface EndpointStates { readonly VpcEndpoints?: Array<{ VpcEndpointId?: string; State?: string; VpcId?: string; ServiceName?: string; PolicyDocument?: unknown }> }
interface BatchImage { readonly images?: Array<{ imageManifest?: string }> }
interface CertificateResponse { readonly Certificate?: { Status?: string; DomainName?: string; SubjectAlternativeNames?: string[] } }
interface LogEvents { readonly events?: unknown[] }
interface XrayTraces { readonly Traces?: Array<{ Segments?: Array<{ Document?: string }> }> }
interface MetricPoints { readonly Datapoints?: Array<{ Timestamp?: string; Sum?: number }> }
interface AlarmResponse { readonly MetricAlarms?: Array<{ AlarmName?: string; StateValue?: string; StateUpdatedTimestamp?: string }> }

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

const gitHead = (): string | undefined => {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch { return undefined; }
};

const immutableAwsJson = (bucket: string | undefined, key: string | undefined, versionId: string | undefined): unknown => {
  if (bucket === undefined || key === undefined || versionId === undefined) return undefined;
  const root = mkdtempSync(join(tmpdir(), "kfc-release-record-"));
  const path = join(root, "record.json");
  try {
    execFileSync("aws", ["s3api", "get-object", "--region", "ap-southeast-1", "--bucket", bucket,
      "--key", key, "--version-id", versionId, path], { stdio: ["ignore", "ignore", "ignore"] });
    return jsonFile(path);
  } catch { return undefined; } finally { rmSync(root, { recursive: true, force: true }); }
};

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

const executableRuntimeProbe = (releaseDigest: string): boolean => {
  const runnerName = process.env.CANDIDATE_VALIDATION_RUNNER_NAME;
  const loadBalancer = process.env.ALB_FULL_NAME;
  const applicationLogGroup = process.env.CANDIDATE_APPLICATION_LOG_GROUP_NAME;
  if (runnerName === undefined || loadBalancer === undefined || applicationLogGroup === undefined) return false;
  const invocationRoot = mkdtempSync(join(tmpdir(), "kfc-candidate-validation-"));
  const payloadPath = join(invocationRoot, "payload.json");
  let traceId: string | undefined;
  try {
    const invocation = awsJson<{ StatusCode?: number; FunctionError?: string }>([
      "lambda", "invoke", "--region", "ap-southeast-1", "--function-name", runnerName,
      "--cli-binary-format", "raw-in-base64-out", "--payload", "{}", payloadPath,
    ]);
    if (invocation?.StatusCode !== 200 || invocation.FunctionError !== undefined) return false;
    const payload = jsonFile(payloadPath) as { ok?: boolean; releaseDigest?: string; traceId?: string } | undefined;
    if (payload?.ok !== true || payload.releaseDigest !== releaseDigest || !/^[a-f0-9]{32}$/.test(payload.traceId ?? "")) return false;
    traceId = payload.traceId;
  } finally {
    rmSync(invocationRoot, { recursive: true, force: true });
  }
  if (traceId === undefined) return false;
  const logs = awsJson<LogEvents>([
    "logs", "filter-log-events", "--region", "ap-southeast-1",
    "--log-group-name", applicationLogGroup,
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
  catalogDigest: process.env.TRUSTED_CATALOG_DIGEST ?? "",
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
const previous = immutableAwsJson(
  process.env.EVIDENCE_BUCKET_NAME,
  process.env.PREVIOUS_RELEASE_EVIDENCE_KEY,
  process.env.PREVIOUS_RELEASE_EVIDENCE_VERSION_ID,
);
const previousRecord = previous as PreviousReleaseRecord | undefined;
const previousLive: CompletedReleaseLiveEvidence = (() => {
  if (
    previousRecord?.serviceDeploymentArn === undefined ||
    previousRecord.serviceRevisionArn === undefined ||
    previousRecord.taskDefinitionArn === undefined ||
    previousRecord.alarms === undefined
  ) return {};
  const deployment = awsJson<{ serviceDeployments?: CompletedReleaseLiveEvidence["deployment"][] }>([
    "ecs", "describe-service-deployments", "--region", "ap-southeast-1",
    "--service-deployment-arns", previousRecord.serviceDeploymentArn,
  ])?.serviceDeployments?.[0];
  const serviceRevision = awsJson<{ serviceRevisions?: CompletedReleaseLiveEvidence["serviceRevision"][] }>([
    "ecs", "describe-service-revisions", "--region", "ap-southeast-1",
    "--service-revision-arns", previousRecord.serviceRevisionArn,
  ])?.serviceRevisions?.[0];
  const taskDefinition = awsJson<{ taskDefinition?: CompletedReleaseLiveEvidence["taskDefinition"] }>([
    "ecs", "describe-task-definition", "--region", "ap-southeast-1",
    "--task-definition", previousRecord.taskDefinitionArn,
  ])?.taskDefinition;
  const alarmNames = previousRecord.alarms.flatMap(({ name }) => name === undefined ? [] : [name]);
  const alarms = alarmNames.length === 0 ? undefined : awsJson<AlarmResponse>([
    "cloudwatch", "describe-alarms", "--region", "ap-southeast-1",
    "--alarm-names", ...alarmNames,
  ])?.MetricAlarms;
  return { deployment, serviceRevision, taskDefinition, alarms };
})();
const releaseManifest = jsonFile(process.env.RELEASE_MANIFEST_PATH);
const templatePath = process.env.SYNTHESIZED_SERVICE_TEMPLATE_PATH ??
  "cdk.out/KfcRecommendationProduction.template.json";
const template = jsonFile(templatePath);
const platformTemplatePath = process.env.SYNTHESIZED_PLATFORM_TEMPLATE_PATH ??
  "cdk.out/KfcRecommendationPlatform.template.json";
const platformTemplate = jsonFile(platformTemplatePath);
const sourceBindings = (() => {
  const revision = gitHead();
  if (revision === undefined || !existsSync(templatePath)) return undefined;
  try { return deriveReleaseSourceBindings(revision, readFileSync(templatePath)); }
  catch { return undefined; }
})();
const runtimeProbeVerified = executableRuntimeProbe(bindings.releaseDigest);
const activationAlarm = process.env.CANDIDATE_ACTIVATION_ALARM_NAME === undefined ? undefined : awsJson<AlarmResponse>([
  "cloudwatch", "describe-alarms", "--region", "ap-southeast-1", "--alarm-names",
  process.env.CANDIDATE_ACTIVATION_ALARM_NAME,
])?.MetricAlarms?.[0];
const operationalAlarm = process.env.RELEASE_SAFETY_ALARM_NAME === undefined ? undefined : awsJson<{
  CompositeAlarms?: Array<{ StateValue?: string }>;
}>([
  "cloudwatch", "describe-alarms", "--region", "ap-southeast-1", "--alarm-names",
  process.env.RELEASE_SAFETY_ALARM_NAME,
])?.CompositeAlarms?.[0];
const validationStartedAt = process.env.CANDIDATE_VALIDATION_STARTED_AT ?? "";
const activationMetric = Number.isNaN(Date.parse(validationStartedAt)) ? undefined : awsJson<MetricPoints>([
  "cloudwatch", "get-metric-statistics", "--region", "ap-southeast-1",
  "--namespace", "KFC/RecommendationsActivation", "--metric-name", "CandidateProbePassed",
  "--dimensions", `Name=ReleaseDigest,Value=${bindings.releaseDigest}`,
  "--start-time", validationStartedAt, "--end-time", new Date().toISOString(),
  "--period", "60", "--statistics", "Sum",
]);
const activationEvidenceTimestamp = (activationMetric?.Datapoints ?? [])
  .filter((point) => (point.Sum ?? 0) >= 1 && point.Timestamp !== undefined)
  .sort((left, right) => Date.parse(right.Timestamp ?? "") - Date.parse(left.Timestamp ?? ""))[0]?.Timestamp;
const facts: DeploymentFacts = {
  expectedAccount: process.env.EXPECTED_AWS_ACCOUNT ?? "",
  callerAccount: identity?.Account,
  callerArn: identity?.Arn,
  configuredRegion: awsText(["configure", "get", "region"]),
  endpointNames,
  deployedEndpointsAvailable: endpointsMatchDeployment(endpointStates?.VpcEndpoints ?? [], {
    region: "ap-southeast-1",
    vpcId: process.env.RECOMMENDATION_VPC_ID ?? "",
    evidenceBucketArn: process.env.EVIDENCE_BUCKET_ARN ?? "",
    stateTableArn: process.env.STATE_TABLE_ARN ?? "",
    routeTableIds: (process.env.PRIVATE_ROUTE_TABLE_IDS ?? "").split(",").filter(Boolean),
    subnetIds: (process.env.PRIVATE_SUBNET_IDS ?? "").split(",").filter(Boolean),
    endpointSecurityGroupId: process.env.ENDPOINT_SECURITY_GROUP_ID ?? "",
  }),
  bundlePresentAndVerified:
    qualifiedBundleManifestMatches(bundleManifest, bindings) && bundlePayloadsMatch,
  releaseManifestPresentAndVerified:
    exactFileDigest(process.env.RELEASE_MANIFEST_PATH, process.env.RELEASE_MANIFEST_SHA256) &&
    releaseManifestMatches(releaseManifest, bindings, {
      main: process.env.MAIN_IMAGE_DIGEST ?? "",
      scorer: process.env.SCORER_IMAGE_DIGEST ?? "",
      adot: process.env.ADOT_IMAGE_DIGEST ?? "",
    }, {
      certificateArn: process.env.INTERNAL_ALB_CERTIFICATE_ARN ?? "",
      internalAlbServerName: process.env.INTERNAL_ALB_SERVER_NAME ?? "",
      maximumTasks: Number(process.env.MAXIMUM_TASKS ?? "NaN"),
      sourceRevision: sourceBindings?.sourceRevision ?? "",
      cdkRevision: sourceBindings?.cdkRevision ?? "",
      previousReleaseDigest: process.env.PREVIOUS_RELEASE_DIGEST ?? "",
      allowRollbackToPaused: process.env.ALLOW_ROLLBACK_TO_PAUSED === "true",
    }),
  mainImagePresentAndArm64: imageIsArm64(process.env.MAIN_REPOSITORY_NAME ?? "kfc-recommendation-main", process.env.MAIN_IMAGE_DIGEST),
  scorerImagePresentAndArm64: imageIsArm64(process.env.SCORER_REPOSITORY_NAME ?? "kfc-recommendation-scorer", process.env.SCORER_IMAGE_DIGEST),
  adotImagePresentAndArm64: imageIsArm64(process.env.ADOT_REPOSITORY_NAME ?? "kfc-recommendation-adot", process.env.ADOT_IMAGE_DIGEST),
  certificateIssuedAndMatchesServerName: certificateIsIssuedFor(certificate, serverName),
  previousReleaseCompletedAndCompatible: previousReleaseIsCompletedAndCompatible(
    previousRecord, process.env.PREVIOUS_RELEASE_DIGEST ?? "", bindings.contractDigest,
    { accountId: identity?.Account ?? "", region: "ap-southeast-1" },
  ) && completedReleaseMatchesLive(previousRecord, previousLive),
  allowRollbackToPaused: process.env.ALLOW_ROLLBACK_TO_PAUSED === "true",
  alarmLinkedCanaryRollback: templateHasAlarmLinkedCanaryRollback((template ?? {}) as never),
  exactRoutesVerified: templateHasExactRecommendationRoutes((platformTemplate ?? {}) as never),
  activationAlarmCurrent:
    activationAlarmIsCurrent(activationAlarm, validationStartedAt, activationEvidenceTimestamp) &&
    operationalAlarm?.StateValue === "OK",
  executableRuntimeProbeVerified: runtimeProbeVerified,
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
