import { Duration, Stack, Validations } from "aws-cdk-lib";
import { Certificate } from "aws-cdk-lib/aws-certificatemanager";
import { SubnetType } from "aws-cdk-lib/aws-ec2";
import {
  Cluster,
  ContainerDependencyCondition,
  ContainerInsights,
  ContainerImage,
  CpuArchitecture,
  DeploymentStrategy,
  FargateService,
  FargateTaskDefinition,
  LogDrivers,
  OperatingSystemFamily,
  Protocol,
  Secret as EcsSecret,
} from "aws-cdk-lib/aws-ecs";
import {
  ApplicationListenerRule,
  ApplicationLoadBalancer,
  ApplicationProtocol,
  ApplicationTargetGroup,
  ListenerAction,
  ListenerCondition,
  TargetType,
} from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";

import type { DataPlaneResources } from "./data-plane.js";
import type { NetworkResources } from "./network.js";
import type { ReleaseParameters } from "./release-parameters.js";
import type { ImageRepositories } from "./image-repositories.js";

export interface ComputeResources {
  readonly cluster: Cluster;
  readonly service: FargateService;
  readonly validationService: FargateService;
  readonly taskDefinition: FargateTaskDefinition;
  readonly loadBalancer: ApplicationLoadBalancer;
  readonly listenerArn: string;
  readonly targetGroupFullName: string;
  readonly alternateTargetGroupFullName: string;
  readonly validationTargetGroupFullName: string;
  readonly infrastructureRole: Role;
  readonly logGroup: LogGroup;
}

const digestImage = (repositoryUri: string, digest: string): ContainerImage =>
  ContainerImage.fromRegistry(`${repositoryUri}@${digest}`);

export const createCompute = (
  scope: Construct,
  network: NetworkResources,
  data: DataPlaneResources,
  repositories: ImageRepositories,
  release: ReleaseParameters,
): ComputeResources => {
  const cluster = new Cluster(scope, "Cluster", {
    vpc: network.vpc,
    containerInsightsV2: ContainerInsights.ENHANCED,
  });
  const logGroup = new LogGroup(scope, "ApplicationLogs", {
    logGroupName: "/kfc/recommendations/sandbox/application",
    retention: RetentionDays.ONE_MONTH,
  });
  const task = new FargateTaskDefinition(scope, "Task", {
    cpu: 1024,
    memoryLimitMiB: 3072,
    runtimePlatform: {
      cpuArchitecture: CpuArchitecture.ARM64,
      operatingSystemFamily: OperatingSystemFamily.LINUX,
    },
  });
  data.evidenceBucket.grantReadWrite(task.taskRole, "evidence/*");
  data.stateTable.grantReadWriteData(task.taskRole);
  data.runtimeSecret.grantRead(task.taskRole);
  task.addToTaskRolePolicy(
    new PolicyStatement({
      actions: ["xray:PutTraceSegments", "xray:PutTelemetryRecords"],
      resources: ["*"],
    }),
  );
  task.addToTaskRolePolicy(
    new PolicyStatement({
      actions: ["cloudwatch:PutMetricData"],
      resources: ["*"],
      conditions: { StringEquals: { "cloudwatch:namespace": "KFC/Recommendations" } },
    }),
  );

  const commonEnvironment = {
    AWS_REGION: Stack.of(scope).region,
    ENVIRONMENT: "synthetic-sandbox",
    RELEASE_DIGEST: release.releaseDigest.valueAsString,
    QUALIFIED_BUNDLE_DIGEST: release.qualifiedBundleDigest.valueAsString,
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
    essential: true,
    cpu: 384,
    memoryLimitMiB: 1024,
    environment: {
      ...commonEnvironment,
      HOST: "127.0.0.1",
      PORT: "8081",
      MODEL_THREADS: "1",
      QUALIFIED_BUNDLE_PATH: "/opt/kfc/bundle",
    },
    logging: LogDrivers.awsLogs({ logGroup, streamPrefix: "scorer", mode: "non-blocking" as never }),
    healthCheck: {
      command: ["CMD-SHELL", "python -c \"import urllib.request; urllib.request.urlopen('http://127.0.0.1:8081/ready', timeout=2)\""],
      interval: Duration.seconds(15),
      timeout: Duration.seconds(5),
      retries: 3,
      startPeriod: Duration.seconds(60),
    },
  });
  scorer.addPortMappings({ containerPort: 8081, protocol: Protocol.TCP });

  const adot = task.addContainer("Adot", {
    containerName: "adot",
    image: digestImage(repositories.adotRepository.repositoryUri, release.adotImageDigest.valueAsString),
    essential: true,
    cpu: 128,
    memoryLimitMiB: 256,
    command: ["--config=/etc/ecs/ecs-default-config.yaml"],
    environment: { AWS_REGION: Stack.of(scope).region },
    logging: LogDrivers.awsLogs({ logGroup, streamPrefix: "adot", mode: "non-blocking" as never }),
    healthCheck: {
      command: ["CMD", "/healthcheck"],
      interval: Duration.seconds(15),
      timeout: Duration.seconds(5),
      retries: 3,
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
    essential: true,
    cpu: 512,
    memoryLimitMiB: 1536,
    environment: {
      ...commonEnvironment,
      NODE_MAJOR: "24",
      PORT: "8080",
      SCORER_URL: "http://127.0.0.1:8081",
      MAX_IN_FLIGHT: "16",
      EVIDENCE_BUCKET: data.evidenceBucket.bucketName,
      STATE_TABLE: data.stateTable.tableName,
    },
    secrets: { RUNTIME_TOKEN: EcsSecret.fromSecretsManager(data.runtimeSecret, "token") },
    logging: LogDrivers.awsLogs({ logGroup, streamPrefix: "main", mode: "non-blocking" as never }),
    healthCheck: {
      command: ["CMD-SHELL", "node -e \"fetch('http://127.0.0.1:8080/ready').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))\""],
      interval: Duration.seconds(15),
      timeout: Duration.seconds(5),
      retries: 3,
      startPeriod: Duration.seconds(75),
    },
  });
  main.addPortMappings({ containerPort: 8080, protocol: Protocol.TCP });
  main.addContainerDependencies(
    { container: scorer, condition: ContainerDependencyCondition.HEALTHY },
    { container: adot, condition: ContainerDependencyCondition.HEALTHY },
  );
  for (const repo of [repositories.mainRepository, repositories.scorerRepository, repositories.adotRepository]) {
    repo.grantPull(task.obtainExecutionRole());
  }

  const service = new FargateService(scope, "Service", {
    cluster,
    taskDefinition: task,
    desiredCount: 1,
    assignPublicIp: false,
    vpcSubnets: { subnetType: SubnetType.PRIVATE_ISOLATED },
    securityGroups: [network.taskSecurityGroup],
    deploymentStrategy: DeploymentStrategy.CANARY,
    canaryConfiguration: { stepPercent: 10, stepBakeTime: Duration.minutes(5) },
    minHealthyPercent: 100,
    maxHealthyPercent: 200,
    healthCheckGracePeriod: Duration.seconds(90),
    enableExecuteCommand: false,
  });
  Validations.of(service).acknowledge({
    id: "Annotation::@aws-cdk/aws-ecs:shouldUseCircuitBreaker",
    reason: "The ECS deployment circuit breaker is valid only for rolling deployments; native CANARY uses deployment alarms with rollback.",
  });
  const loadBalancer = new ApplicationLoadBalancer(scope, "LoadBalancer", {
    vpc: network.vpc,
    internetFacing: false,
    securityGroup: network.albSecurityGroup,
    vpcSubnets: { subnetType: SubnetType.PRIVATE_ISOLATED },
    deletionProtection: true,
  });
  loadBalancer.logAccessLogs(data.accessLogBucket, "alb-access");
  const certificate = Certificate.fromCertificateArn(
    scope,
    "AlbCertificate",
    release.certificateArn.valueAsString,
  );
  const listener = loadBalancer.addListener("HttpsListener", {
    port: 443,
    protocol: ApplicationProtocol.HTTPS,
    certificates: [certificate],
    open: false,
    defaultAction: ListenerAction.fixedResponse(404),
  });
  const targetGroup = new ApplicationTargetGroup(scope, "ProductionTargetGroup", {
    vpc: network.vpc,
    port: 8080,
    protocol: ApplicationProtocol.HTTP,
    targetType: TargetType.IP,
    deregistrationDelay: Duration.seconds(60),
    healthCheck: {
      path: "/ready",
      healthyHttpCodes: "200",
      healthyThresholdCount: 2,
      unhealthyThresholdCount: 2,
      interval: Duration.seconds(15),
      timeout: Duration.seconds(5),
    },
  });
  targetGroup.addTarget(service.loadBalancerTarget({ containerName: "main", containerPort: 8080 }));
  const alternateTargetGroup = new ApplicationTargetGroup(scope, "AlternateTargetGroup", {
    vpc: network.vpc,
    port: 8080,
    protocol: ApplicationProtocol.HTTP,
    targetType: TargetType.IP,
    deregistrationDelay: Duration.seconds(60),
    healthCheck: {
      path: "/ready",
      healthyHttpCodes: "200",
      healthyThresholdCount: 2,
      unhealthyThresholdCount: 2,
      interval: Duration.seconds(15),
      timeout: Duration.seconds(5),
    },
  });
  const productionRule = new ApplicationListenerRule(scope, "ProductionListenerRule", {
    listener,
    priority: 10,
    conditions: [ListenerCondition.pathPatterns(["/v1/*"])],
    action: ListenerAction.forward([targetGroup]),
  });
  const testListener = loadBalancer.addListener("TestHttpsListener", {
    port: 8443,
    protocol: ApplicationProtocol.HTTPS,
    certificates: [certificate],
    open: false,
    defaultAction: ListenerAction.fixedResponse(404),
  });
  const testRule = new ApplicationListenerRule(scope, "TestListenerRule", {
    listener: testListener,
    priority: 10,
    conditions: [ListenerCondition.pathPatterns(["/*"])],
    action: ListenerAction.forward([alternateTargetGroup]),
  });
  const validationTargetGroup = new ApplicationTargetGroup(scope, "ValidationTargetGroup", {
    vpc: network.vpc,
    port: 8080,
    protocol: ApplicationProtocol.HTTP,
    targetType: TargetType.IP,
    healthCheck: { path: "/ready", healthyHttpCodes: "200" },
  });
  const validationService = new FargateService(scope, "ValidationService", {
    cluster,
    taskDefinition: task,
    desiredCount: 1,
    assignPublicIp: false,
    vpcSubnets: { subnetType: SubnetType.PRIVATE_ISOLATED },
    securityGroups: [network.taskSecurityGroup],
    healthCheckGracePeriod: Duration.seconds(90),
    enableExecuteCommand: false,
    circuitBreaker: { rollback: true },
    minHealthyPercent: 100,
    maxHealthyPercent: 200,
  });
  validationTargetGroup.addTarget(
    validationService.loadBalancerTarget({ containerName: "main", containerPort: 8080 }),
  );
  const validationListener = loadBalancer.addListener("ValidationListener", {
    port: 8082,
    protocol: ApplicationProtocol.HTTP,
    open: false,
    defaultAction: ListenerAction.fixedResponse(404),
  });
  new ApplicationListenerRule(scope, "ValidationListenerRule", {
    listener: validationListener,
    priority: 10,
    conditions: [ListenerCondition.pathPatterns(["/ready"])],
    action: ListenerAction.forward([validationTargetGroup]),
  });
  const infrastructureRole = new Role(scope, "EcsLoadBalancerInfrastructureRole", {
    assumedBy: new ServicePrincipal("ecs.amazonaws.com"),
  });
  infrastructureRole.addToPolicy(new PolicyStatement({
    actions: [
      "elasticloadbalancing:DescribeListeners",
      "elasticloadbalancing:DescribeRules",
      "elasticloadbalancing:DescribeTargetGroups",
      "elasticloadbalancing:DescribeTargetHealth",
    ],
    resources: ["*"],
  }));
  infrastructureRole.addToPolicy(new PolicyStatement({
    actions: ["elasticloadbalancing:RegisterTargets", "elasticloadbalancing:DeregisterTargets"],
    resources: [targetGroup.targetGroupArn, alternateTargetGroup.targetGroupArn],
  }));
  infrastructureRole.addToPolicy(new PolicyStatement({
    actions: ["elasticloadbalancing:ModifyListener"],
    resources: [listener.listenerArn, testListener.listenerArn],
  }));
  infrastructureRole.addToPolicy(new PolicyStatement({
    actions: ["elasticloadbalancing:ModifyRule"],
    resources: [productionRule.listenerRuleArn, testRule.listenerRuleArn],
  }));
  const cfnService = service.node.defaultChild as import("aws-cdk-lib/aws-ecs").CfnService;
  cfnService.addPropertyOverride("LoadBalancers.0.AdvancedConfiguration", {
    AlternateTargetGroupArn: alternateTargetGroup.targetGroupArn,
    ProductionListenerRule: productionRule.listenerRuleArn,
    TestListenerRule: testRule.listenerRuleArn,
    RoleArn: infrastructureRole.roleArn,
  });
  return {
    cluster,
    service,
    validationService,
    taskDefinition: task,
    loadBalancer,
    listenerArn: listener.listenerArn,
    targetGroupFullName: targetGroup.targetGroupFullName,
    alternateTargetGroupFullName: alternateTargetGroup.targetGroupFullName,
    validationTargetGroupFullName: validationTargetGroup.targetGroupFullName,
    infrastructureRole,
    logGroup,
  };
};
