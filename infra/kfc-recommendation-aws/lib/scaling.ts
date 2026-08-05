import { Duration } from "aws-cdk-lib";
import { CfnScalableTarget } from "aws-cdk-lib/aws-applicationautoscaling";
import { ComparisonOperator, Metric, TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import { Construct } from "constructs";

import type { PlatformComputeResources } from "./platform-compute.js";
import type { ProductionServingResources } from "./production-serving.js";
import type { ReleaseParameters } from "./release-parameters.js";

export const createScaling = (
  scope: Construct,
  platform: PlatformComputeResources,
  production: ProductionServingResources,
  release: ReleaseParameters,
): void => {
  if (release.maximumTasks === undefined) throw new Error("production maximum task capacity is required");
  const target = production.service.autoScaleTaskCount({
    minCapacity: 1,
    maxCapacity: release.maximumTasks.valueAsNumber,
  });
  target.scaleOnCpuUtilization("CpuGuardrail", {
    targetUtilizationPercent: 65,
    scaleOutCooldown: Duration.seconds(30),
    scaleInCooldown: Duration.minutes(15),
  });
  target.scaleOnMemoryUtilization("MemoryGuardrail", {
    targetUtilizationPercent: 70,
    scaleOutCooldown: Duration.seconds(30),
    scaleInCooldown: Duration.minutes(15),
  });
  const resource = target.node.findAll().find((child) => child instanceof CfnScalableTarget);
  if (!(resource instanceof CfnScalableTarget)) {
    throw new Error("ECS scalable target synthesis did not produce a CloudFormation scalable target");
  }
  resource.scheduledActions = [
    scheduled("LunchPrewarm", "cron(0 10 * * ? *)", 2, release.maximumTasks.valueAsNumber),
    scheduled("LunchDrain", "cron(30 14 * * ? *)", 1, release.maximumTasks.valueAsNumber),
    scheduled("DinnerPrewarm", "cron(30 16 * * ? *)", 2, release.maximumTasks.valueAsNumber),
    scheduled("DinnerDrain", "cron(0 22 * * ? *)", 1, release.maximumTasks.valueAsNumber),
  ];

  const capacityDiscovery = new Metric({
    namespace: "AWS/ApplicationELB",
    metricName: "RequestCountPerTarget",
    dimensionsMap: { TargetGroup: platform.targetGroup.targetGroupFullName },
    statistic: "Sum",
    period: Duration.minutes(1),
  }).createAlarm(scope, "CapacityDiscoveryRequired", {
    threshold: 1,
    evaluationPeriods: 1,
    comparisonOperator: ComparisonOperator.LESS_THAN_THRESHOLD,
    treatMissingData: TreatMissingData.BREACHING,
    alarmDescription: "Fail-closed reminder: replace temporary max tasks with measured 70% safe-RPS target in Task 9",
  });
};

const scheduled = (
  name: string,
  schedule: string,
  minimum: number,
  maximum: number,
): CfnScalableTarget.ScheduledActionProperty => ({
  scheduledActionName: name,
  schedule,
  timezone: "Asia/Ho_Chi_Minh",
  scalableTargetAction: { minCapacity: minimum, maxCapacity: maximum },
});
