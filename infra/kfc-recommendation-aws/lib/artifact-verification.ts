import { createHash, timingSafeEqual } from "node:crypto";

const DIGEST = /^sha256:[a-f0-9]{64}$/;
const CONTENT_DIGEST = /^[a-f0-9]{64}$/;

export const manifestDigestMatches = (content: Buffer, expected: string): boolean => {
  if (!DIGEST.test(expected) && !CONTENT_DIGEST.test(expected)) return false;
  const computed = createHash("sha256").update(content).digest("hex");
  const actual = expected.startsWith("sha256:") ? `sha256:${computed}` : computed;
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
};

export const deriveReleaseSourceBindings = (
  gitHead: string,
  synthesizedAssembly: Buffer,
): { sourceRevision: string; cdkRevision: string } => {
  if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(gitHead)) {
    throw new Error("source revision must be the exact git HEAD object ID");
  }
  return {
    sourceRevision: gitHead,
    cdkRevision: createHash("sha256").update(synthesizedAssembly).digest("hex"),
  };
};

export interface CertificateDescription {
  readonly Status?: string;
  readonly DomainName?: string;
  readonly SubjectAlternativeNames?: readonly string[];
}

export const certificateIsIssuedFor = (
  certificate: CertificateDescription | undefined,
  serverName: string,
): boolean => {
  if (certificate?.Status !== "ISSUED") return false;
  const names = new Set([certificate.DomainName, ...(certificate.SubjectAlternativeNames ?? [])]);
  return names.has(serverName);
};

interface OciIndex {
  readonly schemaVersion?: number;
  readonly manifests?: ReadonlyArray<{
    readonly digest?: string;
    readonly platform?: { readonly os?: string; readonly architecture?: string };
  }>;
}

export const ociManifestSupports = (
  manifest: string | undefined,
  imageDigest: string,
  os: string,
  architecture: string,
): boolean => {
  if (manifest === undefined || !DIGEST.test(imageDigest)) return false;
  try {
    const index = JSON.parse(manifest) as OciIndex;
    return (
      index.schemaVersion === 2 &&
      manifestDigestMatches(Buffer.from(manifest), imageDigest) &&
      (index.manifests ?? []).some(
        (entry) =>
          entry.platform?.os === os &&
          entry.platform.architecture === architecture,
      )
    );
  } catch {
    return false;
  }
};

export interface PreviousReleaseRecord {
  readonly schemaVersion?: string;
  readonly releaseDigest?: string;
  readonly state?: string;
  readonly contractDigest?: string;
  readonly accountId?: string;
  readonly region?: string;
  readonly completedAt?: string;
  readonly taskDefinitionArn?: string;
  readonly serviceArn?: string;
  readonly serviceDeploymentArn?: string;
  readonly serviceRevisionArn?: string;
  readonly images?: Readonly<Record<string, string>>;
  readonly alarms?: ReadonlyArray<{ readonly name?: string; readonly stateUpdatedTimestamp?: string }>;
}

export const previousReleaseIsCompletedAndCompatible = (
  record: PreviousReleaseRecord | undefined,
  expectedReleaseDigest: string,
  currentContractDigest: string,
  provenance?: { readonly accountId: string; readonly region: string },
): boolean =>
  record?.state === "completed" &&
  record.releaseDigest === expectedReleaseDigest &&
  record.contractDigest === currentContractDigest &&
  (provenance === undefined || (
    record.accountId === provenance.accountId &&
    record.region === provenance.region &&
    typeof record.completedAt === "string" &&
    !Number.isNaN(Date.parse(record.completedAt)) &&
    record.taskDefinitionArn?.startsWith(
      `arn:aws:ecs:${provenance.region}:${provenance.accountId}:task-definition/`,
    ) === true
  )) &&
  (DIGEST.test(expectedReleaseDigest) || CONTENT_DIGEST.test(expectedReleaseDigest)) &&
  (DIGEST.test(currentContractDigest) || CONTENT_DIGEST.test(currentContractDigest));

export interface CompletedReleaseLiveEvidence {
  readonly deployment?: {
    readonly serviceDeploymentArn?: string;
    readonly serviceArn?: string;
    readonly status?: string;
    readonly targetServiceRevision?: {
      readonly arn?: string;
      readonly requestedTaskCount?: number;
      readonly runningTaskCount?: number;
      readonly pendingTaskCount?: number;
    };
  };
  readonly serviceRevision?: {
    readonly serviceRevisionArn?: string;
    readonly serviceArn?: string;
    readonly taskDefinition?: string;
  };
  readonly taskDefinition?: {
    readonly taskDefinitionArn?: string;
    readonly runtimePlatform?: {
      readonly operatingSystemFamily?: string;
      readonly cpuArchitecture?: string;
    };
    readonly containerDefinitions?: ReadonlyArray<{
      readonly name?: string;
      readonly image?: string;
      readonly environment?: ReadonlyArray<{ readonly name?: string; readonly value?: string }>;
    }>;
  };
  readonly alarms?: ReadonlyArray<{
    readonly AlarmName?: string;
    readonly StateValue?: string;
    readonly StateUpdatedTimestamp?: string;
  }>;
}

export const completedReleaseMatchesLive = (
  record: PreviousReleaseRecord | undefined,
  live: CompletedReleaseLiveEvidence,
): boolean => {
  if (
    record?.schemaVersion !== "kfc-recommendation-completed-release-v1" ||
    record.state !== "completed" ||
    record.serviceArn === undefined ||
    record.serviceDeploymentArn === undefined ||
    record.serviceRevisionArn === undefined ||
    record.taskDefinitionArn === undefined ||
    record.releaseDigest === undefined ||
    record.images === undefined ||
    record.alarms === undefined ||
    live.deployment?.status !== "SUCCESSFUL" ||
    live.deployment.serviceDeploymentArn !== record.serviceDeploymentArn ||
    live.deployment.serviceArn !== record.serviceArn ||
    live.deployment.targetServiceRevision?.arn !== record.serviceRevisionArn ||
    live.deployment.targetServiceRevision.requestedTaskCount === undefined ||
    live.deployment.targetServiceRevision.requestedTaskCount < 1 ||
    live.deployment.targetServiceRevision.runningTaskCount !==
      live.deployment.targetServiceRevision.requestedTaskCount ||
    live.deployment.targetServiceRevision.pendingTaskCount !== 0 ||
    live.serviceRevision?.serviceRevisionArn !== record.serviceRevisionArn ||
    live.serviceRevision.serviceArn !== record.serviceArn ||
    live.serviceRevision.taskDefinition !== record.taskDefinitionArn ||
    live.taskDefinition?.taskDefinitionArn !== record.taskDefinitionArn ||
    live.taskDefinition.runtimePlatform?.operatingSystemFamily !== "LINUX" ||
    live.taskDefinition.runtimePlatform.cpuArchitecture !== "ARM64"
  ) return false;
  const containers = live.taskDefinition.containerDefinitions ?? [];
  if (!exactSet(containers.flatMap(({ name }) => name === undefined ? [] : [name]), ["main", "scorer", "adot"])) return false;
  for (const name of ["main", "scorer", "adot"]) {
    const container = containers.find((candidate) => candidate.name === name);
    if (container?.image !== record.images[name]) return false;
    if (name !== "adot" && !(container.environment ?? []).some(
      (entry) => entry.name === "RELEASE_DIGEST" && entry.value === record.releaseDigest,
    )) return false;
  }
  if (!exactSet(
    (live.alarms ?? []).flatMap(({ AlarmName }) => AlarmName === undefined ? [] : [AlarmName]),
    record.alarms.flatMap(({ name }) => name === undefined ? [] : [name]),
  )) return false;
  return record.alarms.every((expected) => {
    const alarm = live.alarms?.find(({ AlarmName }) => AlarmName === expected.name);
    return alarm?.StateValue === "OK" &&
      alarm.StateUpdatedTimestamp === expected.stateUpdatedTimestamp;
  });
};

interface CloudFormationTemplate {
  readonly Resources?: Record<string, {
    readonly Type?: string;
    readonly Properties?: Record<string, unknown>;
  }>;
}

const logicalId = (value: unknown): string | undefined => {
  if (typeof value !== "object" || value === null) return undefined;
  const intrinsic = value as { Ref?: unknown; "Fn::GetAtt"?: unknown };
  if (typeof intrinsic.Ref === "string") return intrinsic.Ref;
  return Array.isArray(intrinsic["Fn::GetAtt"]) && typeof intrinsic["Fn::GetAtt"]?.[0] === "string"
    ? intrinsic["Fn::GetAtt"][0]
    : undefined;
};

const importName = (value: unknown): string | undefined => {
  if (typeof value !== "object" || value === null) return undefined;
  const imported = (value as { "Fn::ImportValue"?: unknown })["Fn::ImportValue"];
  return typeof imported === "string" ? imported : undefined;
};

const conditionBranch = (value: unknown): { condition?: string; whenTrue: unknown; whenFalse: unknown } => {
  if (typeof value !== "object" || value === null) return { whenTrue: value, whenFalse: value };
  const branch = (value as { "Fn::If"?: unknown })["Fn::If"];
  return Array.isArray(branch) && branch.length === 3 && typeof branch[0] === "string"
    ? { condition: branch[0], whenTrue: branch[1], whenFalse: branch[2] }
    : { whenTrue: value, whenFalse: value };
};

export const templateHasAlarmLinkedCanaryRollback = (
  template: CloudFormationTemplate,
): boolean =>
  Object.values(template.Resources ?? {}).some((resource) => {
    if (resource.Type !== "AWS::ECS::Service") return false;
    const configuration = resource.Properties?.DeploymentConfiguration as
      | {
          Strategy?: unknown;
          CanaryConfiguration?: unknown;
          Alarms?: { Enable?: boolean; Rollback?: boolean; AlarmNames?: unknown[] };
        }
      | undefined;
    const loadBalancers = resource.Properties?.LoadBalancers as Array<{
      TargetGroupArn?: unknown;
      AdvancedConfiguration?: {
        AlternateTargetGroupArn?: unknown;
        ProductionListenerRule?: unknown;
        TestListenerRule?: unknown;
        RoleArn?: unknown;
      };
    }> | undefined;
    const loadBalancer = loadBalancers?.[0];
    const strategy = conditionBranch(configuration?.Strategy);
    const canary = conditionBranch(configuration?.CanaryConfiguration);
    const advancedBranch = conditionBranch(loadBalancer?.AdvancedConfiguration);
    const canaryConfiguration = canary.whenTrue as { CanaryPercent?: number; CanaryBakeTimeInMinutes?: number } | undefined;
    const advanced = advancedBranch.whenTrue as {
      AlternateTargetGroupArn?: unknown;
      ProductionListenerRule?: unknown;
      TestListenerRule?: unknown;
      RoleArn?: unknown;
    } | undefined;
    const staticCanary = strategy.whenTrue === "CANARY" && strategy.condition === undefined;
    const conditionalCanary = strategy.whenTrue === "CANARY" && strategy.whenFalse === "ROLLING" &&
      strategy.condition !== undefined && strategy.condition === canary.condition && strategy.condition === advancedBranch.condition;
    const primaryId = logicalId(loadBalancer?.TargetGroupArn);
    const alternateId = logicalId(advanced?.AlternateTargetGroupArn);
    const productionRuleId = logicalId(advanced?.ProductionListenerRule);
    const testRuleId = logicalId(advanced?.TestListenerRule);
    const roleId = logicalId(advanced?.RoleArn);
    const importedTopology = [
      loadBalancer?.TargetGroupArn,
      advanced?.AlternateTargetGroupArn,
      advanced?.ProductionListenerRule,
      advanced?.TestListenerRule,
      advanced?.RoleArn,
    ].map(importName);
    const resources = template.Resources ?? {};
    const productionRuleTargetsPrimary = JSON.stringify(resources[productionRuleId ?? ""]?.Properties?.Actions ?? []).includes(primaryId ?? "missing");
    const testRuleTargetsAlternate = JSON.stringify(resources[testRuleId ?? ""]?.Properties?.Actions ?? []).includes(alternateId ?? "missing");
    const rolePolicyActions = JSON.stringify(Object.values(resources).filter((candidate) =>
      candidate.Type === "AWS::IAM::Policy" &&
      JSON.stringify(candidate.Properties?.Roles ?? []).includes(roleId ?? "missing"),
    ).map((candidate) => candidate.Properties?.PolicyDocument));
    return (
      (staticCanary || conditionalCanary) &&
      (canaryConfiguration?.CanaryPercent ?? 0) > 0 &&
      (canaryConfiguration?.CanaryBakeTimeInMinutes ?? 0) > 0 &&
      configuration?.Alarms?.Enable === true &&
      configuration.Alarms.Rollback === true &&
      (configuration.Alarms.AlarmNames?.length ?? 0) > 0 &&
      ((primaryId !== undefined && alternateId !== undefined && primaryId !== alternateId &&
        resources[primaryId]?.Type === "AWS::ElasticLoadBalancingV2::TargetGroup" &&
        resources[alternateId]?.Type === "AWS::ElasticLoadBalancingV2::TargetGroup" &&
        resources[productionRuleId ?? ""]?.Type === "AWS::ElasticLoadBalancingV2::ListenerRule" &&
        resources[testRuleId ?? ""]?.Type === "AWS::ElasticLoadBalancingV2::ListenerRule" &&
        productionRuleTargetsPrimary && testRuleTargetsAlternate &&
        resources[roleId ?? ""]?.Type === "AWS::IAM::Role" &&
        ["DescribeTargetHealth", "RegisterTargets", "DeregisterTargets", "ModifyListener", "ModifyRule"]
          .every((action) => rolePolicyActions.includes(action))) ||
        (importedTopology.every((name) => name?.startsWith("KfcRecommendationPlatform:") === true) &&
          new Set(importedTopology).size === importedTopology.length))
    );
  });

const recommendationRouteScopes = new Map([
  ["POST /v1/recommendations/local-favorites", "recommendations/decision.write"],
  ["POST /v1/recommendations/for-you", "recommendations/decision.write"],
  ["POST /v1/recommendations/modifier-upsells", "recommendations/decision.write"],
  ["POST /v1/recommendations/smart-cross-sells", "recommendations/decision.write"],
  ["POST /v1/recommendations/{recommendationId}/impressions", "recommendations/event.write"],
  ["POST /v1/recommendations/{recommendationId}/outcomes", "recommendations/event.write"],
  ["GET /v1/admin/recommendations/{recommendationId}/inspection", "recommendations/inspection.read"],
]);

export const templateHasExactRecommendationRoutes = (template: CloudFormationTemplate): boolean => {
  const routes = Object.values(template.Resources ?? {}).filter((resource) => resource.Type === "AWS::ApiGatewayV2::Route");
  if (routes.length !== recommendationRouteScopes.size) return false;
  return routes.every((route) => {
    const routeKey = route.Properties?.RouteKey;
    const scope = typeof routeKey === "string" ? recommendationRouteScopes.get(routeKey) : undefined;
    return scope !== undefined && route.Properties?.AuthorizationType === "JWT" &&
      JSON.stringify(route.Properties?.AuthorizationScopes) === JSON.stringify([scope]);
  });
};

export interface ActivationBindings {
  readonly releaseDigest: string;
  readonly bundleDigest: string;
  readonly catalogDigest: string;
  readonly contractDigest: string;
  readonly featureDigest: string;
  readonly composerDigest: string;
}

export const activationAlarmIsCurrent = (
  alarm: { readonly StateValue?: string; readonly StateUpdatedTimestamp?: string } | undefined,
  validationStartedAt: string,
  evidenceTimestamp?: string,
): boolean => {
  const started = Date.parse(validationStartedAt);
  const evidence = Date.parse(evidenceTimestamp ?? "");
  return alarm?.StateValue === "OK" && !Number.isNaN(started) && !Number.isNaN(evidence) && evidence >= started;
};

export interface ReleaseImages {
  readonly main: string;
  readonly scorer: string;
  readonly adot: string;
}

export interface ReleaseTopology {
  readonly certificateArn: string;
  readonly internalAlbServerName: string;
  readonly maximumTasks: number;
  readonly sourceRevision: string;
  readonly cdkRevision: string;
  readonly previousReleaseDigest: string;
  readonly allowRollbackToPaused: boolean;
}

export const releaseManifestMatches = (
  value: unknown,
  bindings: ActivationBindings,
  images: ReleaseImages,
  topology: ReleaseTopology,
): boolean => {
  if (typeof value !== "object" || value === null) return false;
  const manifest = value as Record<string, unknown>;
  const manifestImages = manifest.images as Record<string, unknown> | undefined;
  const infrastructure = manifest.infrastructure as Record<string, unknown> | undefined;
  const task = manifest.task as Record<string, unknown> | undefined;
  const rollback = manifest.rollback as Record<string, unknown> | undefined;
  return manifest.schemaVersion === "kfc-recommendation-release-v1" &&
    manifest.region === "ap-southeast-1" &&
    manifest.releaseDigest === bindings.releaseDigest &&
    manifest.bundleDigest === bindings.bundleDigest &&
    manifest.catalogDigest === bindings.catalogDigest &&
    manifest.contractDigest === bindings.contractDigest &&
    manifest.featureDigest === bindings.featureDigest &&
    manifest.composerDigest === bindings.composerDigest &&
    manifestImages?.main === images.main &&
    manifestImages?.scorer === images.scorer &&
    manifestImages?.adot === images.adot &&
    infrastructure?.certificateArn === topology.certificateArn &&
    infrastructure.internalAlbServerName === topology.internalAlbServerName &&
    infrastructure.maximumTasks === topology.maximumTasks &&
    task?.cpu === 1024 && task.memoryMiB === 3072 && task.architecture === "arm64" &&
    task.mainPort === 8080 && task.scorerPort === 8081 &&
    manifest.sourceRevision === topology.sourceRevision &&
    manifest.cdkRevision === topology.cdkRevision &&
    rollback?.previousReleaseDigest === topology.previousReleaseDigest &&
    rollback.allowRollbackToPaused === topology.allowRollbackToPaused;
};

export const activationProofMatches = (
  value: unknown,
  bindings: ActivationBindings,
): boolean => {
  if (typeof value !== "object" || value === null) return false;
  const proof = value as Record<string, unknown>;
  return (
    proof.schemaVersion === "kfc-recommendation-activation-proof-v1" &&
    proof.releaseDigest === bindings.releaseDigest &&
    proof.bundleDigest === bindings.bundleDigest &&
    proof.catalogDigest === bindings.catalogDigest &&
    proof.contractDigest === bindings.contractDigest &&
    proof.featureDigest === bindings.featureDigest &&
    proof.composerDigest === bindings.composerDigest &&
    proof.mainPort === 8080 &&
    proof.scorerPort === 8081 &&
    proof.trustedPortsAvailable === true &&
    proof.bundleMounted === true &&
    proof.crossRuntimeWarmupPassed === true &&
    proof.telemetryContractVerified === true &&
    proof.structuredLogsVerified === true &&
    proof.adotHealthy === true
  );
};

export interface VpcEndpointState {
  readonly VpcEndpointId?: string;
  readonly State?: string;
  readonly VpcId?: string;
  readonly ServiceName?: string;
  readonly PolicyDocument?: unknown;
  readonly VpcEndpointType?: string;
  readonly RouteTableIds?: readonly string[];
  readonly SubnetIds?: readonly string[];
  readonly PrivateDnsEnabled?: boolean;
  readonly Groups?: ReadonlyArray<{ GroupId?: string }>;
}

export const endpointsAreAvailable = (
  endpoints: readonly VpcEndpointState[],
  expectedIds: readonly string[],
): boolean => {
  if (expectedIds.length !== 8 || new Set(expectedIds).size !== 8) return false;
  const states = new Map(endpoints.map((endpoint) => [endpoint.VpcEndpointId, endpoint.State]));
  return expectedIds.every((id) => states.get(id) === "available");
};

const endpointActions: Readonly<Record<string, readonly string[]>> = {
  s3: ["s3:ListBucket", "s3:ListBucketVersions", "s3:GetObject", "s3:GetObjectVersion", "s3:PutObject", "s3:AbortMultipartUpload"],
  dynamodb: ["dynamodb:DescribeTable", "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:Query", "dynamodb:TransactWriteItems"],
  "ecr.api": ["ecr:GetAuthorizationToken", "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:BatchCheckLayerAvailability"],
  "ecr.dkr": ["ecr:GetAuthorizationToken", "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:BatchCheckLayerAvailability"],
  logs: ["logs:CreateLogStream", "logs:PutLogEvents"],
  secretsmanager: ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"],
  monitoring: ["cloudwatch:PutMetricData"],
  xray: ["xray:PutTraceSegments", "xray:PutTelemetryRecords"],
};

const policyStatements = (value: unknown): ReadonlyArray<Record<string, unknown>> => {
  try {
    const policy = typeof value === "string" ? JSON.parse(value) as unknown : value;
    if (typeof policy !== "object" || policy === null) return [];
    const statement = (policy as { Statement?: unknown }).Statement;
    return Array.isArray(statement) ? statement as Array<Record<string, unknown>> : [];
  } catch {
    return [];
  }
};

const values = (value: unknown): readonly string[] =>
  typeof value === "string" ? [value] : Array.isArray(value) && value.every((entry) => typeof entry === "string")
    ? value
    : [];

const exactSet = (actual: Iterable<string>, expected: readonly string[]): boolean => {
  const left = [...new Set(actual)].sort();
  const right = [...new Set(expected)].sort();
  return JSON.stringify(left) === JSON.stringify(right);
};

export const endpointsMatchDeployment = (
  endpoints: readonly VpcEndpointState[],
  expected: {
    readonly region: string;
    readonly vpcId: string;
    readonly evidenceBucketArn: string;
    readonly stateTableArn: string;
    readonly routeTableIds: readonly string[];
    readonly subnetIds: readonly string[];
    readonly endpointSecurityGroupId: string;
  },
): boolean => {
  if (endpoints.length !== 8) return false;
  const byService = new Map(endpoints.map((endpoint) => [endpoint.ServiceName, endpoint]));
  if (byService.size !== 8) return false;
  return Object.entries(endpointActions).every(([suffix, requiredActions]) => {
    const endpoint = byService.get(`com.amazonaws.${expected.region}.${suffix}`);
    if (endpoint?.State !== "available" || endpoint.VpcId !== expected.vpcId) return false;
    const gateway = suffix === "s3" || suffix === "dynamodb";
    if (gateway) {
      if (endpoint.VpcEndpointType !== "Gateway" ||
          JSON.stringify([...(endpoint.RouteTableIds ?? [])].sort()) !== JSON.stringify([...expected.routeTableIds].sort())) return false;
    } else if (
      endpoint.VpcEndpointType !== "Interface" || endpoint.PrivateDnsEnabled !== true ||
      JSON.stringify([...(endpoint.SubnetIds ?? [])].sort()) !== JSON.stringify([...expected.subnetIds].sort()) ||
      !exactSet((endpoint.Groups ?? []).flatMap(({ GroupId }) => GroupId === undefined ? [] : [GroupId]), [expected.endpointSecurityGroupId])
    ) return false;
    const statements = policyStatements(endpoint.PolicyDocument);
    if (statements.length === 0 || statements.some((statement) => statement.Effect !== "Allow")) return false;
    const presentActions = statements.flatMap((statement) => values(statement.Action));
    if (!exactSet(presentActions, requiredActions)) return false;
    const resources = statements.flatMap((statement) => values(statement.Resource));
    if (suffix === "s3") {
      return exactSet(resources, [
        expected.evidenceBucketArn,
        `${expected.evidenceBucketArn}/automatic-recommendations/*`,
        `${expected.evidenceBucketArn}/readiness-probes/*`,
        `arn:aws:s3:::prod-${expected.region}-starport-layer-bucket/*`,
      ]);
    }
    return suffix === "dynamodb"
      ? exactSet(resources, [expected.stateTableArn, `${expected.stateTableArn}/index/*`])
      : exactSet(resources, ["*"]);
  });
};

export const qualifiedBundleManifestMatches = (
  value: unknown,
  bindings: Pick<ActivationBindings, "bundleDigest" | "contractDigest" | "featureDigest" | "composerDigest">,
): boolean => {
  if (typeof value !== "object" || value === null) return false;
  const manifest = value as Record<string, unknown>;
  const champions = manifest.champions;
  const payloads = manifest.payloadDigests;
  return (
    manifest.schemaVersion === "kfc-qualified-model-bundle-v1" &&
    manifest.bundleDigest === bindings.bundleDigest &&
    manifest.contractDigest === bindings.contractDigest &&
    manifest.featureContractDigest === bindings.featureDigest &&
    manifest.composerContractDigest === bindings.composerDigest &&
    typeof champions === "object" &&
    champions !== null &&
    Object.keys(champions).sort().join(",") ===
      "for_you,local_favorite,modifier_upsell,smart_cross_sell" &&
    typeof payloads === "object" &&
    payloads !== null &&
    Object.keys(payloads).length > 0
  );
};
