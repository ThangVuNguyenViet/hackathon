import { Duration } from "aws-cdk-lib";
import { Certificate } from "aws-cdk-lib/aws-certificatemanager";
import { SubnetType } from "aws-cdk-lib/aws-ec2";
import { Cluster, ContainerInsights } from "aws-cdk-lib/aws-ecs";
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
import { Construct } from "constructs";

import type { DataPlaneResources } from "./data-plane.js";
import type { NetworkResources } from "./network.js";
import type { PlatformParameters } from "./platform-parameters.js";

export interface PlatformComputeResources {
  readonly cluster: Cluster;
  readonly loadBalancer: ApplicationLoadBalancer;
  readonly listenerArn: string;
  readonly targetGroup: ApplicationTargetGroup;
  readonly alternateTargetGroup: ApplicationTargetGroup;
  readonly productionListenerRuleArn: string;
  readonly testListenerRuleArn: string;
  readonly infrastructureRole: Role;
}

export const createPlatformCompute = (
  scope: Construct,
  network: NetworkResources,
  data: DataPlaneResources,
  parameters: PlatformParameters,
): PlatformComputeResources => {
  const cluster = new Cluster(scope, "Cluster", {
    vpc: network.vpc,
    containerInsightsV2: ContainerInsights.ENHANCED,
  });
  const loadBalancer = new ApplicationLoadBalancer(scope, "LoadBalancer", {
    vpc: network.vpc,
    internetFacing: false,
    securityGroup: network.albSecurityGroup,
    vpcSubnets: { subnetType: SubnetType.PRIVATE_ISOLATED },
    deletionProtection: true,
  });
  loadBalancer.logAccessLogs(data.accessLogBucket, "alb-access");
  const certificate = Certificate.fromCertificateArn(scope, "AlbCertificate", parameters.certificateArn.valueAsString);
  const listener = loadBalancer.addListener("HttpsListener", {
    port: 443,
    protocol: ApplicationProtocol.HTTPS,
    certificates: [certificate],
    open: false,
    defaultAction: ListenerAction.fixedResponse(404),
  });
  const target = (id: string) => new ApplicationTargetGroup(scope, id, {
    vpc: network.vpc,
    port: 8080,
    protocol: ApplicationProtocol.HTTP,
    targetType: TargetType.IP,
    deregistrationDelay: Duration.seconds(60),
    healthCheck: {
      path: "/ready", healthyHttpCodes: "200", healthyThresholdCount: 2,
      unhealthyThresholdCount: 2, interval: Duration.seconds(15), timeout: Duration.seconds(5),
    },
  });
  const targetGroup = target("ProductionTargetGroup");
  const alternateTargetGroup = target("AlternateTargetGroup");
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
  const infrastructureRole = new Role(scope, "EcsLoadBalancerInfrastructureRole", {
    assumedBy: new ServicePrincipal("ecs.amazonaws.com"),
  });
  infrastructureRole.addToPolicy(new PolicyStatement({
    actions: [
      "elasticloadbalancing:DescribeListeners", "elasticloadbalancing:DescribeRules",
      "elasticloadbalancing:DescribeTargetGroups", "elasticloadbalancing:DescribeTargetHealth",
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
  return {
    cluster, loadBalancer, listenerArn: listener.listenerArn,
    targetGroup, alternateTargetGroup,
    productionListenerRuleArn: productionRule.listenerRuleArn,
    testListenerRuleArn: testRule.listenerRuleArn,
    infrastructureRole,
  };
};
