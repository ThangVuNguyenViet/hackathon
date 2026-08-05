import { Duration } from "aws-cdk-lib";
import { SubnetType } from "aws-cdk-lib/aws-ec2";
import { FargateService, type FargateTaskDefinition } from "aws-cdk-lib/aws-ecs";
import {
  ApplicationListenerRule,
  ApplicationProtocol,
  ApplicationTargetGroup,
  ListenerAction,
  ListenerCondition,
  TargetType,
} from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { Construct } from "constructs";

import type { NetworkResources } from "./network.js";
import type { PlatformComputeResources } from "./platform-compute.js";

export interface CandidateServingResources {
  readonly service: FargateService;
  readonly taskDefinition: FargateTaskDefinition;
  readonly validationTargetGroup: ApplicationTargetGroup;
  readonly probeUrl: string;
}

export const createCandidateServing = (
  scope: Construct,
  platform: PlatformComputeResources,
  network: NetworkResources,
  taskDefinition: FargateTaskDefinition,
): CandidateServingResources => {
  const validationTargetGroup = new ApplicationTargetGroup(scope, "ValidationTargetGroup", {
    vpc: network.vpc,
    port: 8080,
    protocol: ApplicationProtocol.HTTP,
    targetType: TargetType.IP,
    healthCheck: { path: "/ready", healthyHttpCodes: "200" },
  });
  const service = new FargateService(scope, "CandidateValidationService", {
    cluster: platform.cluster,
    taskDefinition,
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
  validationTargetGroup.addTarget(service.loadBalancerTarget({ containerName: "main", containerPort: 8080 }));
  const listener = platform.loadBalancer.addListener("CandidateValidationListener", {
    port: 8082,
    protocol: ApplicationProtocol.HTTP,
    open: false,
    defaultAction: ListenerAction.fixedResponse(404),
  });
  new ApplicationListenerRule(scope, "CandidateValidationListenerRule", {
    listener,
    priority: 10,
    conditions: [ListenerCondition.pathPatterns(["/ready"])],
    action: ListenerAction.forward([validationTargetGroup]),
  });
  return {
    service,
    taskDefinition,
    validationTargetGroup,
    probeUrl: `http://${platform.loadBalancer.loadBalancerDnsName}:8082`,
  };
};
