export interface DeploymentFacts {
  readonly expectedAccount: string;
  readonly callerAccount?: string;
  readonly callerArn?: string;
  readonly configuredRegion?: string;
  readonly endpointNames: readonly string[];
  readonly bundlePresentAndVerified: boolean;
  readonly mainImagePresent: boolean;
  readonly scorerImagePresent: boolean;
  readonly adotImagePresent: boolean;
  readonly certificatePresent: boolean;
  readonly previousReleasePresent: boolean;
  readonly allowRollbackToPaused: boolean;
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
  if (!facts.bundlePresentAndVerified) {
    blockers.push("Qualified Model Bundle is absent or does not match its digest");
  }
  if (!facts.mainImagePresent) blockers.push("Main image digest is absent from ECR");
  if (!facts.scorerImagePresent) blockers.push("scorer image digest is absent from ECR");
  if (!facts.adotImagePresent) blockers.push("ADOT image digest is absent from ECR");
  if (!facts.certificatePresent) blockers.push("internal ALB certificate is absent");
  if (!facts.previousReleasePresent && !facts.allowRollbackToPaused) {
    blockers.push("previous compatible release is absent; first release must explicitly rollback to paused");
  }
  return blockers;
};
