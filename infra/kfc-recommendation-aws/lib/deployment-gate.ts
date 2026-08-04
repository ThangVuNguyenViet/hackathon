export interface DeploymentFacts {
  readonly expectedAccount: string;
  readonly callerAccount?: string;
  readonly callerArn?: string;
  readonly configuredRegion?: string;
  readonly endpointNames: readonly string[];
  readonly deployedEndpointsAvailable: boolean;
  readonly bundlePresentAndVerified: boolean;
  readonly releaseManifestPresentAndVerified: boolean;
  readonly mainImagePresentAndArm64: boolean;
  readonly scorerImagePresentAndArm64: boolean;
  readonly adotImagePresentAndArm64: boolean;
  readonly certificateIssuedAndMatchesServerName: boolean;
  readonly previousReleaseCompletedAndCompatible: boolean;
  readonly allowRollbackToPaused: boolean;
  readonly alarmLinkedCanaryRollback: boolean;
  readonly activationProofVerified: boolean;
  readonly executableRuntimeProbeVerified: boolean;
}

export const requiredEndpointNames = (region: string): readonly string[] => [
  `com.amazonaws.${region}.ecr.api`,
  `com.amazonaws.${region}.ecr.dkr`,
  `com.amazonaws.${region}.logs`,
  `com.amazonaws.${region}.secretsmanager`,
  `com.amazonaws.${region}.monitoring`,
  `com.amazonaws.${region}.xray`,
  `com.amazonaws.${region}.s3`,
  `com.amazonaws.${region}.dynamodb`,
];

export const evaluateDeploymentGate = (facts: DeploymentFacts): readonly string[] => {
  const blockers: string[] = [];
  if (facts.callerAccount === undefined || facts.callerArn === undefined) {
    blockers.push("AWS caller identity is unavailable");
  } else if (facts.callerAccount !== facts.expectedAccount) {
    blockers.push("AWS caller account does not match EXPECTED_AWS_ACCOUNT");
  }
  if (facts.configuredRegion !== "ap-southeast-1") {
    blockers.push("configured AWS region must be ap-southeast-1");
  }
  const found = new Set(facts.endpointNames);
  if (!requiredEndpointNames("ap-southeast-1").every((name) => found.has(name))) {
    blockers.push("required VPC endpoint services are not verified in ap-southeast-1");
  }
  if (!facts.deployedEndpointsAvailable) {
    blockers.push("all eight deployed VPC endpoints must be in available state");
  }
  if (!facts.bundlePresentAndVerified) {
    blockers.push("Qualified Model Bundle is absent or does not match its digest");
  }
  if (!facts.releaseManifestPresentAndVerified) {
    blockers.push("release manifest is absent or does not match its digest");
  }
  if (!facts.mainImagePresentAndArm64) blockers.push("Main image digest is absent from ECR or is not linux/arm64");
  if (!facts.scorerImagePresentAndArm64) blockers.push("scorer image digest is absent from ECR or is not linux/arm64");
  if (!facts.adotImagePresentAndArm64) blockers.push("ADOT image digest is absent from ECR or is not linux/arm64");
  if (!facts.certificateIssuedAndMatchesServerName) {
    blockers.push("internal ALB certificate is not ISSUED or does not cover its TLS server name");
  }
  if (!facts.previousReleaseCompletedAndCompatible && !facts.allowRollbackToPaused) {
    blockers.push("previous release is absent, incomplete, or contract-incompatible; first release must explicitly rollback to paused");
  }
  if (!facts.alarmLinkedCanaryRollback) {
    blockers.push("synthesized ECS canary is not linked to alarm rollback and circuit-breaker rollback");
  }
  if (!facts.activationProofVerified) {
    blockers.push("runtime activation proof does not verify trusted ports, mounted QMB, digests, telemetry, ADOT health, and cross-runtime warmup");
  }
  if (!facts.executableRuntimeProbeVerified) {
    blockers.push("executable runtime probe did not prove deep readiness plus release-bound structured logs and X-Ray telemetry");
  }
  return blockers;
};
