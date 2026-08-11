import { Duration, Validations } from "aws-cdk-lib";
import { SubnetType } from "aws-cdk-lib/aws-ec2";
import { CfnService, DeploymentStrategy, FargateService, type FargateTaskDefinition } from "aws-cdk-lib/aws-ecs";
import { Construct } from "constructs";

import type { NetworkResources } from "./network.js";
import type { PlatformComputeResources } from "./platform-compute.js";

export interface ProductionServingResources {
  readonly service: FargateService;
  readonly taskDefinition: FargateTaskDefinition;
}

export const createProductionServing = (
  scope: Construct,
  platform: PlatformComputeResources,
  network: NetworkResources,
  taskDefinition: FargateTaskDefinition,
): ProductionServingResources => {
  const service = new FargateService(scope, "ProductionService", {
    cluster: platform.cluster,
    taskDefinition,
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
    reason: "Native CANARY uses deployment alarms with rollback; ECS circuit breaker applies only to rolling deployments.",
  });
  platform.targetGroup.addTarget(service.loadBalancerTarget({ containerName: "main", containerPort: 8080 }));
  const cfnService = service.node.defaultChild as CfnService;
  cfnService.addPropertyOverride("LoadBalancers.0.AdvancedConfiguration", {
    AlternateTargetGroupArn: platform.alternateTargetGroup.targetGroupArn,
    ProductionListenerRule: platform.productionListenerRuleArn,
    TestListenerRule: platform.testListenerRuleArn,
    RoleArn: platform.infrastructureRole.roleArn,
  });
  return { service, taskDefinition };
};
