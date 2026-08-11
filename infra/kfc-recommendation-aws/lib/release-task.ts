import { Duration, Stack, Validations } from "aws-cdk-lib";
import {
  ContainerDependencyCondition,
  ContainerImage,
  CpuArchitecture,
  FargateTaskDefinition,
  LogDrivers,
  OperatingSystemFamily,
  Protocol,
  Secret as EcsSecret,
} from "aws-cdk-lib/aws-ecs";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";

import type { DataPlaneResources } from "./data-plane.js";
import type { ImageRepositories } from "./image-repositories.js";
import type { PlatformComputeResources } from "./platform-compute.js";
import type { ReleaseParameters } from "./release-parameters.js";

const digestImage = (repositoryUri: string, digest: string): ContainerImage =>
  ContainerImage.fromRegistry(`${repositoryUri}@${digest}`);

export const createReleaseTask = (
  scope: Construct,
  platform: PlatformComputeResources,
  data: DataPlaneResources,
  repositories: ImageRepositories,
  release: ReleaseParameters,
): FargateTaskDefinition => {
  const applicationLogs = new LogGroup(scope, "ApplicationLogs", {
    logGroupName: `/kfc/recommendations/sandbox/${Stack.of(scope).stackName}/application`,
    retention: RetentionDays.ONE_MONTH,
  });
  const runtimeSecret = Secret.fromSecretCompleteArn(
    scope,
    "ImportedRuntimeSecret",
    data.runtimeSecret.secretArn,
  );
  const task = new FargateTaskDefinition(scope, "ReleaseTask", {
    cpu: 1024,
    memoryLimitMiB: 3072,
    runtimePlatform: {
      cpuArchitecture: CpuArchitecture.ARM64,
      operatingSystemFamily: OperatingSystemFamily.LINUX,
    },
  });
  task.addToTaskRolePolicy(new PolicyStatement({
    actions: ["s3:ListBucket", "s3:ListBucketVersions"],
    resources: [data.evidenceBucket.bucketArn],
    conditions: { StringLike: { "s3:prefix": ["automatic-recommendations/*", "readiness-probes/*"] } },
  }));
  task.addToTaskRolePolicy(new PolicyStatement({
    actions: ["s3:GetObject", "s3:GetObjectVersion", "s3:PutObject", "s3:AbortMultipartUpload"],
    resources: [
      data.evidenceBucket.arnForObjects("automatic-recommendations/*"),
      data.evidenceBucket.arnForObjects("readiness-probes/*"),
    ],
  }));
  task.addToTaskRolePolicy(new PolicyStatement({
    actions: [
      "dynamodb:DescribeTable", "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem",
      "dynamodb:DeleteItem", "dynamodb:Query", "dynamodb:TransactWriteItems",
    ],
    resources: [data.stateTable.tableArn, `${data.stateTable.tableArn}/index/*`],
  }));
  task.addToTaskRolePolicy(new PolicyStatement({
    actions: ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"],
    resources: [data.runtimeSecret.secretArn],
  }));
  task.addToTaskRolePolicy(new PolicyStatement({
    actions: ["kms:Decrypt", "kms:Encrypt", "kms:GenerateDataKey"],
    resources: [data.key.keyArn],
  }));
  task.addToTaskRolePolicy(new PolicyStatement({
    actions: ["xray:PutTraceSegments", "xray:PutTelemetryRecords"], resources: ["*"],
  }));
  task.addToTaskRolePolicy(new PolicyStatement({
    actions: ["cloudwatch:PutMetricData"], resources: ["*"],
    conditions: { StringEquals: { "cloudwatch:namespace": "KFC/Recommendations" } },
  }));
  const commonEnvironment = {
    AWS_REGION: Stack.of(scope).region,
    ENVIRONMENT: "synthetic-sandbox",
    RELEASE_DIGEST: release.releaseDigest.valueAsString,
    QUALIFIED_BUNDLE_DIGEST: release.qualifiedBundleDigest.valueAsString,
    TRUSTED_CATALOG_DIGEST: release.trustedCatalogDigest.valueAsString,
    AUTOMATIC_CONTRACT_DIGEST: release.automaticContractDigest.valueAsString,
    AUTOMATIC_FEATURE_DIGEST: release.automaticFeatureDigest.valueAsString,
    AUTOMATIC_COMPOSER_DIGEST: release.automaticComposerDigest.valueAsString,
    LOG_FORMAT: "json",
    OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:4318",
    OTEL_RESOURCE_ATTRIBUTES: "service.namespace=kfc-recommendations,deployment.environment=synthetic-sandbox",
  };
  const scorer = task.addContainer("Scorer", {
    containerName: "scorer",
    image: digestImage(repositories.scorerRepository.repositoryUri, release.scorerImageDigest.valueAsString),
    essential: true, cpu: 384, memoryLimitMiB: 1024,
    environment: { ...commonEnvironment, HOST: "127.0.0.1", PORT: "8081", MODEL_THREADS: "1", QUALIFIED_BUNDLE_PATH: "/opt/kfc/bundle" },
    logging: LogDrivers.awsLogs({ logGroup: applicationLogs, streamPrefix: "scorer", mode: "non-blocking" as never }),
    healthCheck: {
      command: ["CMD-SHELL", "python -c \"import urllib.request; urllib.request.urlopen('http://127.0.0.1:8081/ready', timeout=2)\""],
      interval: Duration.seconds(15), timeout: Duration.seconds(5), retries: 3, startPeriod: Duration.seconds(60),
    },
  });
  scorer.addPortMappings({ containerPort: 8081, protocol: Protocol.TCP });
  const adot = task.addContainer("Adot", {
    containerName: "adot",
    image: digestImage(repositories.adotRepository.repositoryUri, release.adotImageDigest.valueAsString),
    essential: true, cpu: 128, memoryLimitMiB: 256,
    command: ["--config=/etc/ecs/ecs-default-config.yaml"],
    environment: { AWS_REGION: Stack.of(scope).region },
    logging: LogDrivers.awsLogs({ logGroup: applicationLogs, streamPrefix: "adot", mode: "non-blocking" as never }),
    healthCheck: {
      command: ["CMD", "/healthcheck"], interval: Duration.seconds(15), timeout: Duration.seconds(5), retries: 3,
      startPeriod: Duration.seconds(30),
    },
  });
  adot.addPortMappings(
    { containerPort: 4317, protocol: Protocol.TCP },
    { containerPort: 4318, protocol: Protocol.TCP },
    { containerPort: 13133, protocol: Protocol.TCP },
  );
  const main = task.addContainer("Main", {
    containerName: "main",
    image: digestImage(repositories.mainRepository.repositoryUri, release.mainImageDigest.valueAsString),
    essential: true, cpu: 512, memoryLimitMiB: 1536,
    command: ["node", "dist/src/recommendations/serving/aws-main.js"],
    environment: {
      ...commonEnvironment, NODE_MAJOR: "24", PORT: "8080", SCORER_URL: "http://127.0.0.1:8081", MAX_IN_FLIGHT: "16",
      EVIDENCE_BUCKET: data.evidenceBucket.bucketName, STATE_TABLE: data.stateTable.tableName,
      QUALIFIED_BUNDLE_PATH: "/opt/kfc/bundle", TRUSTED_CATALOG_PATH: "/opt/kfc/catalog/catalog.json",
    },
    secrets: {
      RUNTIME_TOKEN: EcsSecret.fromSecretsManager(runtimeSecret, "token"),
      KFC_DEMO_ADMIN_TOKEN: EcsSecret.fromSecretsManager(runtimeSecret, "token"),
    },
    logging: LogDrivers.awsLogs({ logGroup: applicationLogs, streamPrefix: "main", mode: "non-blocking" as never }),
    healthCheck: {
      command: ["CMD-SHELL", "node -e \"fetch('http://127.0.0.1:8080/ready').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))\""],
      interval: Duration.seconds(15), timeout: Duration.seconds(5), retries: 3, startPeriod: Duration.seconds(75),
    },
  });
  main.addPortMappings({ containerPort: 8080, protocol: Protocol.TCP });
  main.addContainerDependencies(
    { container: scorer, condition: ContainerDependencyCondition.HEALTHY },
    { container: adot, condition: ContainerDependencyCondition.HEALTHY },
  );
  task.obtainExecutionRole().addToPrincipalPolicy(new PolicyStatement({
    actions: ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:BatchCheckLayerAvailability"],
    resources: [
      repositories.mainRepository.repositoryArn,
      repositories.scorerRepository.repositoryArn,
      repositories.adotRepository.repositoryArn,
    ],
  }));
  task.obtainExecutionRole().addToPrincipalPolicy(new PolicyStatement({
    actions: ["ecr:GetAuthorizationToken"],
    resources: ["*"],
  }));
  const platformStack = Stack.of(data.evidenceBucket).stackName;
  const importedWildcardAcknowledgements = [
    `AwsSolutions-IAM5[Resource::${platformStack}:ExportsOutputFnGetAttEvidenceBucketFBA44255ArnB9DEB114/automatic-recommendations/*]`,
    `AwsSolutions-IAM5[Resource::${platformStack}:ExportsOutputFnGetAttEvidenceBucketFBA44255ArnB9DEB114/readiness-probes/*]`,
    `AwsSolutions-IAM5[Resource::${platformStack}:ExportsOutputFnGetAttStateTable9728C7E5ArnC7425759/index/*]`,
    "AwsSolutions-IAM5[Resource::<ApplicationLogsAF17AEF2.Arn>:*]",
  ];
  for (const construct of [
    ...task.taskRole.node.findAll(),
    ...task.obtainExecutionRole().node.findAll(),
  ]) Validations.of(construct).acknowledge({
    id: "AwsSolutions-IAM5",
    reason: "Wildcards are limited to two immutable S3 prefixes, one table index namespace, one log-group stream suffix, or ECR authorization without resource ARNs.",
  });
  for (const construct of [
    ...task.taskRole.node.findAll(),
    ...task.obtainExecutionRole().node.findAll(),
  ]) for (const id of importedWildcardAcknowledgements) {
    Validations.of(construct).acknowledge({
      id,
      reason: "The imported wildcard remains scoped to one retained platform resource and its required object, index, or stream namespace.",
    });
  }
  return task;
};
