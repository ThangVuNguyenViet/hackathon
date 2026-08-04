import { Duration } from "aws-cdk-lib";
import {
  Alarm,
  AlarmRule,
  ComparisonOperator,
  CompositeAlarm,
  Dashboard,
  GraphWidget,
  Metric,
  TreatMissingData,
} from "aws-cdk-lib/aws-cloudwatch";
import { CfnRule } from "aws-cdk-lib/aws-events";
import { CfnResourcePolicy, LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";

import type { ComputeResources } from "./compute.js";
import type { ReleaseParameters } from "./release-parameters.js";

export const createObservability = (
  scope: Construct,
  compute: ComputeResources,
  release: ReleaseParameters,
): CompositeAlarm => {
  const latency = new Metric({
    namespace: "AWS/ApplicationELB",
    metricName: "TargetResponseTime",
    dimensionsMap: { LoadBalancer: compute.loadBalancer.loadBalancerFullName },
    statistic: "p99",
    period: Duration.minutes(1),
  });
  const target5xx = new Metric({
    namespace: "AWS/ApplicationELB",
    metricName: "HTTPCode_Target_5XX_Count",
    dimensionsMap: {
      LoadBalancer: compute.loadBalancer.loadBalancerFullName,
      TargetGroup: compute.targetGroupFullName,
    },
    statistic: "Sum",
    period: Duration.minutes(1),
  });
  const p99Alarm = new Alarm(scope, "P99LatencyAlarm", {
    metric: latency,
    threshold: 0.5,
    comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
    evaluationPeriods: 3,
    datapointsToAlarm: 2,
    evaluateLowSampleCountPercentile: "ignore",
    treatMissingData: TreatMissingData.NOT_BREACHING,
  });
  const target5xxAlarm = new Alarm(scope, "Target5xxAlarm", {
    metric: target5xx,
    threshold: 1,
    comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    evaluationPeriods: 2,
    treatMissingData: TreatMissingData.NOT_BREACHING,
  });
  const unhealthy = new Alarm(scope, "UnhealthyTargetsAlarm", {
    metric: new Metric({
      namespace: "AWS/ApplicationELB",
      metricName: "UnHealthyHostCount",
      dimensionsMap: {
        LoadBalancer: compute.loadBalancer.loadBalancerFullName,
        TargetGroup: compute.targetGroupFullName,
      },
      statistic: "Maximum",
      period: Duration.minutes(1),
    }),
    threshold: 1,
    comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    evaluationPeriods: 2,
    treatMissingData: TreatMissingData.BREACHING,
  });
  const releaseSafety = new CompositeAlarm(scope, "ReleaseSafetyComposite", {
    compositeAlarmName: "kfc-recommendation-sandbox-release-safety",
    alarmRule: AlarmRule.anyOf(p99Alarm, target5xxAlarm, unhealthy),
    alarmDescription: "Pause/rollback signal for sustained latency, target failures, or readiness failure",
  });

  const dashboard = new Dashboard(scope, "Dashboard", {
    dashboardName: "kfc-recommendation-synthetic-sandbox",
  });
  dashboard.addWidgets(
    new GraphWidget({
      title: "ALB latency p95 / p99",
      left: [latency.with({ statistic: "p95", label: "p95" }), latency.with({ statistic: "p99", label: "p99" })],
      leftAnnotations: [{ value: 0.25, label: "p95 gate" }, { value: 0.5, label: "p99 gate" }],
    }),
    new GraphWidget({
      title: "ECS CPU / memory",
      left: [compute.service.metricCpuUtilization(), compute.service.metricMemoryUtilization()],
      leftAnnotations: [{ value: 65, label: "CPU scale" }, { value: 70, label: "memory scale" }],
    }),
    new GraphWidget({
      title: "Target failures",
      left: [target5xx],
    }),
  );

  const deploymentEvents = new LogGroup(scope, "DeploymentEvents", {
    logGroupName: "/kfc/recommendations/sandbox/deployments",
    retention: RetentionDays.ONE_MONTH,
  });
  new CfnResourcePolicy(scope, "DeploymentEventLogPolicy", {
    policyName: "kfc-recommendation-eventbridge-logs",
    policyDocument: JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Principal: { Service: "events.amazonaws.com" },
          Action: ["logs:CreateLogStream", "logs:PutLogEvents"],
          Resource: deploymentEvents.logGroupArn,
        },
      ],
    }),
  });
  new CfnRule(scope, "DeploymentEventRule", {
    eventPattern: {
      source: ["aws.ecs"],
      "detail-type": ["ECS Deployment State Change"],
      detail: { clusterArn: [compute.cluster.clusterArn] },
    },
    targets: [{ arn: deploymentEvents.logGroupArn, id: "DeploymentEvents" }],
  });
  return releaseSafety;
};
