import { CfnCondition, CfnOutput, Duration, Fn } from "aws-cdk-lib";
import { Alarm, ComparisonOperator, Metric, TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import { PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { CfnRule, Rule, Schedule } from "aws-cdk-lib/aws-events";
import { LambdaFunction as LambdaTarget } from "aws-cdk-lib/aws-events-targets";
import { CfnPermission, Code, Function as LambdaFunction, Runtime } from "aws-cdk-lib/aws-lambda";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";

import type { ComputeResources } from "./compute.js";
import type { NetworkResources } from "./network.js";
import type { ReleaseParameters } from "./release-parameters.js";

export interface CandidateValidationResources {
  readonly runner: LambdaFunction;
  readonly activationAlarm: Alarm;
}

const handler = `
const { CloudWatchClient, PutMetricDataCommand } = require("@aws-sdk/client-cloudwatch");
const cloudwatch = new CloudWatchClient({});
exports.handler = async () => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  let response;
  try {
    response = await fetch(process.env.CANDIDATE_PROBE_URL + "/ready?deep=1", {
      headers: { "x-kfc-runtime-probe": process.env.RELEASE_DIGEST },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  const body = await response.json();
  const traceId = body && body.proof && body.proof.runtimeProbe && body.proof.runtimeProbe.traceId;
  if (response.status !== 200 || body.ok !== true || !/^[a-f0-9]{32}$/.test(traceId || "")) {
    throw new Error("candidate deep readiness or application telemetry probe failed");
  }
  await cloudwatch.send(new PutMetricDataCommand({
    Namespace: "KFC/RecommendationsActivation",
    MetricData: [{
      MetricName: "CandidateProbePassed",
      Dimensions: [{ Name: "ReleaseDigest", Value: process.env.RELEASE_DIGEST }],
      Timestamp: new Date(),
      Value: 1,
      Unit: "Count",
    }],
  }));
  console.log(JSON.stringify({ event: "candidate_validation_passed", releaseDigest: process.env.RELEASE_DIGEST, traceId }));
  return { ok: true, releaseDigest: process.env.RELEASE_DIGEST, traceId };
};`;

export const createCandidateValidation = (
  scope: Construct,
  network: NetworkResources,
  compute: ComputeResources,
  release: ReleaseParameters,
  validateCandidate: CfnCondition,
): CandidateValidationResources => {
  const logGroup = new LogGroup(scope, "CandidateValidationLogs", {
    logGroupName: "/kfc/recommendations/sandbox/candidate-validation",
    retention: RetentionDays.ONE_MONTH,
  });
  const role = new Role(scope, "CandidateValidationRole", {
    assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
  });
  role.addToPolicy(new PolicyStatement({
    actions: ["logs:CreateLogStream", "logs:PutLogEvents"],
    resources: [`${logGroup.logGroupArn}:*`],
  }));
  role.addToPolicy(new PolicyStatement({
    actions: [
      "ec2:DescribeSubnets",
      "ec2:DescribeSecurityGroups",
      "ec2:DescribeNetworkInterfaces",
      "ec2:CreateNetworkInterface",
      "ec2:DeleteNetworkInterface",
      "ec2:AssignPrivateIpAddresses",
      "ec2:UnassignPrivateIpAddresses",
    ],
    resources: ["*"],
  }));
  const runner = new LambdaFunction(scope, "CandidateValidationRunner", {
    runtime: Runtime.NODEJS_24_X,
    handler: "index.handler",
    code: Code.fromInline(handler),
    timeout: Duration.seconds(15),
    memorySize: 256,
    vpc: network.vpc,
    vpcSubnets: { subnets: network.vpc.isolatedSubnets },
    securityGroups: [network.validationProbeSecurityGroup],
    role,
    environment: {
      CANDIDATE_PROBE_URL: `http://${compute.loadBalancer.loadBalancerDnsName}:8082`,
      RELEASE_DIGEST: release.releaseDigest.valueAsString,
    },
    logGroup,
  });
  runner.addToRolePolicy(new PolicyStatement({
    actions: ["cloudwatch:PutMetricData"],
    resources: ["*"],
    conditions: { StringEquals: { "cloudwatch:namespace": "KFC/RecommendationsActivation" } },
  }));
  const schedule = new Rule(scope, "CandidateValidationSchedule", {
    schedule: Schedule.rate(Duration.minutes(1)),
    targets: [new LambdaTarget(runner, { retryAttempts: 0 })],
  });
  (schedule.node.defaultChild as CfnRule).cfnOptions.condition = validateCandidate;
  for (const child of schedule.node.findAll()) {
    if (child instanceof CfnPermission) child.cfnOptions.condition = validateCandidate;
  }
  const activationMetric = new Metric({
    namespace: "KFC/RecommendationsActivation",
    metricName: "CandidateProbePassed",
    dimensionsMap: { ReleaseDigest: release.releaseDigest.valueAsString },
    statistic: "Minimum",
    period: Duration.minutes(1),
  });
  const activationAlarm = new Alarm(scope, "CandidateActivationAlarm", {
    alarmName: Fn.join("", ["kfc-recommendation-activation-", release.releaseDigest.valueAsString]),
    metric: activationMetric,
    threshold: 1,
    comparisonOperator: ComparisonOperator.LESS_THAN_THRESHOLD,
    evaluationPeriods: 1,
    datapointsToAlarm: 1,
    treatMissingData: TreatMissingData.BREACHING,
  });
  new CfnOutput(scope, "CandidateValidationRunnerName", { value: runner.functionName });
  new CfnOutput(scope, "CandidateActivationAlarmName", { value: activationAlarm.alarmName });
  return { runner, activationAlarm };
};
