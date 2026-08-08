#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  completedReleaseMatchesLive,
  manifestDigestMatches,
  type CompletedReleaseLiveEvidence,
  type PreviousReleaseRecord,
} from "../lib/artifact-verification.js";

const required = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`${name} is required`);
  return value;
};
const awsJson = <T>(args: readonly string[]): T =>
  JSON.parse(execFileSync("aws", [...args, "--output", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  })) as T;

const manifestPath = required("RELEASE_MANIFEST_PATH");
const manifestBytes = readFileSync(manifestPath);
if (!manifestDigestMatches(manifestBytes, required("RELEASE_MANIFEST_SHA256"))) {
  throw new Error("release manifest bytes do not match the approved digest");
}
const manifest = JSON.parse(manifestBytes.toString("utf8")) as {
  releaseDigest?: string;
  contractDigest?: string;
  region?: string;
  images?: Record<string, string>;
};
if (
  manifest.region !== "ap-southeast-1" ||
  !/^[a-f0-9]{64}$/.test(manifest.releaseDigest ?? "") ||
  !/^[a-f0-9]{64}$/.test(manifest.contractDigest ?? "")
) throw new Error("release manifest identity is invalid");

const identity = awsJson<{ Account?: string }>([
  "sts", "get-caller-identity", "--region", "ap-southeast-1",
]);
if (!/^[0-9]{12}$/.test(identity.Account ?? "")) throw new Error("AWS account identity is unavailable");
const serviceDeploymentArn = required("SERVICE_DEPLOYMENT_ARN");
const deployment = awsJson<{ serviceDeployments?: CompletedReleaseLiveEvidence["deployment"][] }>([
  "ecs", "describe-service-deployments", "--region", "ap-southeast-1",
  "--service-deployment-arns", serviceDeploymentArn,
]).serviceDeployments?.[0];
const serviceRevisionArn = deployment?.targetServiceRevision?.arn;
if (serviceRevisionArn === undefined) throw new Error("completed ECS deployment has no target service revision");
const serviceRevision = awsJson<{ serviceRevisions?: CompletedReleaseLiveEvidence["serviceRevision"][] }>([
  "ecs", "describe-service-revisions", "--region", "ap-southeast-1",
  "--service-revision-arns", serviceRevisionArn,
]).serviceRevisions?.[0];
const taskDefinitionArn = serviceRevision?.taskDefinition;
if (taskDefinitionArn === undefined) throw new Error("completed ECS deployment has no target task definition");
const taskDefinition = awsJson<{ taskDefinition?: CompletedReleaseLiveEvidence["taskDefinition"] }>([
  "ecs", "describe-task-definition", "--region", "ap-southeast-1",
  "--task-definition", taskDefinitionArn,
]).taskDefinition;
const alarmNames = required("COMPLETION_ALARM_NAMES").split(",").filter(Boolean);
if (alarmNames.length < 2 || new Set(alarmNames).size !== alarmNames.length) {
  throw new Error("at least two unique completion alarms are required");
}
const alarms = awsJson<{ MetricAlarms?: CompletedReleaseLiveEvidence["alarms"] }>([
  "cloudwatch", "describe-alarms", "--region", "ap-southeast-1",
  "--alarm-names", ...alarmNames,
]).MetricAlarms;
const containers = taskDefinition?.containerDefinitions ?? [];
const images = Object.fromEntries(containers.flatMap(({ name, image }) =>
  name !== undefined && image !== undefined ? [[name, image]] : []));
for (const name of ["main", "scorer", "adot"]) {
  const expectedDigest = manifest.images?.[name];
  if (expectedDigest === undefined || !images[name]?.endsWith(`@${expectedDigest}`)) {
    throw new Error(`${name} task image does not match the approved release manifest`);
  }
}
const completedAt = new Date().toISOString();
const record: PreviousReleaseRecord = {
  schemaVersion: "kfc-recommendation-completed-release-v1",
  state: "completed",
  releaseDigest: manifest.releaseDigest,
  contractDigest: manifest.contractDigest,
  accountId: identity.Account,
  region: "ap-southeast-1",
  completedAt,
  serviceArn: deployment?.serviceArn,
  serviceDeploymentArn,
  serviceRevisionArn,
  taskDefinitionArn,
  images,
  alarms: (alarms ?? []).map(({ AlarmName, StateUpdatedTimestamp }) => ({
    name: AlarmName,
    stateUpdatedTimestamp: StateUpdatedTimestamp,
  })),
};
const live = { deployment, serviceRevision, taskDefinition, alarms };
if (!completedReleaseMatchesLive(record, live)) {
  throw new Error("live ECS deployment, task images, release binding, or alarms are not completed and exact");
}
const body = JSON.stringify(record);
const digest = createHash("sha256").update(body).digest("hex");
const key = `completed-releases/${manifest.releaseDigest}/${digest}.json`;
const temporary = mkdtempSync(join(tmpdir(), "kfc-release-finalization-"));
const recordPath = join(temporary, "record.json");
let result: { VersionId?: string } | undefined;
try {
  writeFileSync(recordPath, body, { flag: "wx" });
  result = awsJson<{ VersionId?: string }>([
    "s3api", "put-object", "--region", "ap-southeast-1",
    "--bucket", required("EVIDENCE_BUCKET_NAME"), "--key", key,
    "--body", recordPath, "--if-none-match", "*",
    "--content-type", "application/json",
    "--metadata", `sha256=${digest},sizebytes=${Buffer.byteLength(body)}`,
  ]);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
if (result?.VersionId === undefined) throw new Error("versioned completion write returned no version ID");
process.stdout.write(`${JSON.stringify({ key, versionId: result.VersionId, digest }, null, 2)}\n`);
