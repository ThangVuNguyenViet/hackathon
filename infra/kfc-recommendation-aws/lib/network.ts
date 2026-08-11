import { Aws, CfnOutput, Fn } from "aws-cdk-lib";
import {
  FlowLogDestination,
  FlowLogTrafficType,
  GatewayVpcEndpointAwsService,
  GatewayVpcEndpoint,
  InterfaceVpcEndpointAwsService,
  InterfaceVpcEndpoint,
  IpAddresses,
  Peer,
  Port,
  SecurityGroup,
  SubnetType,
  Vpc,
} from "aws-cdk-lib/aws-ec2";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { AnyPrincipal, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import type { DataPlaneResources } from "./data-plane.js";

export interface NetworkResources {
  readonly vpc: Vpc;
  readonly albSecurityGroup: SecurityGroup;
  readonly taskSecurityGroup: SecurityGroup;
  readonly vpcLinkSecurityGroup: SecurityGroup;
  readonly endpointSecurityGroup: SecurityGroup;
  readonly validationProbeSecurityGroup: SecurityGroup;
  readonly endpoints: readonly (GatewayVpcEndpoint | InterfaceVpcEndpoint)[];
}

export const createNetwork = (scope: Construct, data: DataPlaneResources): NetworkResources => {
  const flowLogs = new LogGroup(scope, "VpcFlowLogs", {
    logGroupName: "/kfc/recommendations/sandbox/vpc-flow",
    retention: RetentionDays.ONE_MONTH,
  });
  const vpc = new Vpc(scope, "Vpc", {
    ipAddresses: IpAddresses.cidr("10.42.0.0/20"),
    maxAzs: 2,
    natGateways: 0,
    subnetConfiguration: [
      { name: "private", subnetType: SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
    ],
    flowLogs: {
      all: {
        destination: FlowLogDestination.toCloudWatchLogs(flowLogs),
        trafficType: FlowLogTrafficType.ALL,
      },
    },
  });

  const s3Endpoint = vpc.addGatewayEndpoint("S3Endpoint", { service: GatewayVpcEndpointAwsService.S3 });
  s3Endpoint.addToPolicy(endpointPolicy(
    ["s3:ListBucket", "s3:ListBucketVersions"],
    [data.evidenceBucket.bucketArn],
  ));
  s3Endpoint.addToPolicy(endpointPolicy(
    ["s3:GetObject", "s3:GetObjectVersion", "s3:PutObject", "s3:AbortMultipartUpload"],
    [data.evidenceBucket.arnForObjects("automatic-recommendations/*")],
  ));
  s3Endpoint.addToPolicy(endpointPolicy(
    ["s3:GetObject", "s3:GetObjectVersion", "s3:PutObject", "s3:AbortMultipartUpload"],
    [data.evidenceBucket.arnForObjects("readiness-probes/*")],
  ));
  // Fargate downloads ECR image layers from this regional S3 bucket. Without
  // it, tasks in the isolated subnets can authenticate to ECR but cannot pull.
  s3Endpoint.addToPolicy(endpointPolicy(
    ["s3:GetObject"],
    [Fn.join("", ["arn:", Aws.PARTITION, ":s3:::prod-", Aws.REGION, "-starport-layer-bucket/*"])],
  ));
  const dynamoEndpoint = vpc.addGatewayEndpoint("DynamoEndpoint", { service: GatewayVpcEndpointAwsService.DYNAMODB });
  dynamoEndpoint.addToPolicy(endpointPolicy([
    "dynamodb:DescribeTable",
    "dynamodb:GetItem",
    "dynamodb:PutItem",
    "dynamodb:UpdateItem",
    "dynamodb:DeleteItem",
    "dynamodb:Query",
    "dynamodb:TransactWriteItems",
  ], [data.stateTable.tableArn, `${data.stateTable.tableArn}/index/*`]));

  const endpointSecurityGroup = new SecurityGroup(scope, "EndpointSecurityGroup", {
    vpc,
    allowAllOutbound: false,
    description: "TLS from recommendation tasks to explicitly approved AWS PrivateLink services",
  });
  const taskSecurityGroup = new SecurityGroup(scope, "TaskSecurityGroup", {
    vpc,
    allowAllOutbound: false,
    description: "Recommendation task egress is limited to localhost and approved VPC endpoints",
  });
  endpointSecurityGroup.addIngressRule(taskSecurityGroup, Port.tcp(443), "task TLS to AWS endpoints");
  taskSecurityGroup.addEgressRule(endpointSecurityGroup, Port.tcp(443), "approved AWS PrivateLink endpoints");
  taskSecurityGroup.addEgressRule(
    Peer.anyIpv4(),
    Port.tcp(443),
    "TLS is route-constrained to gateway and interface endpoints; there is no internet route",
  );
  taskSecurityGroup.addEgressRule(Peer.ipv4(vpc.vpcCidrBlock), Port.udp(53), "VPC DNS resolver");
  taskSecurityGroup.addEgressRule(Peer.ipv4(vpc.vpcCidrBlock), Port.tcp(53), "VPC DNS resolver");

  const endpointServices: ReadonlyArray<[string, InterfaceVpcEndpointAwsService, readonly string[]]> = [
    ["EcrApiEndpoint", InterfaceVpcEndpointAwsService.ECR, ["ecr:GetAuthorizationToken", "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:BatchCheckLayerAvailability"]],
    ["EcrDockerEndpoint", InterfaceVpcEndpointAwsService.ECR_DOCKER, ["ecr:GetAuthorizationToken", "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:BatchCheckLayerAvailability"]],
    ["LogsEndpoint", InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS, ["logs:CreateLogStream", "logs:PutLogEvents"]],
    ["SecretsEndpoint", InterfaceVpcEndpointAwsService.SECRETS_MANAGER, ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"]],
    ["MetricsEndpoint", InterfaceVpcEndpointAwsService.CLOUDWATCH_MONITORING, ["cloudwatch:PutMetricData"]],
    ["XrayEndpoint", InterfaceVpcEndpointAwsService.XRAY, ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]],
  ];
  const interfaceEndpoints = endpointServices.map(([id, service, actions]) => {
    const endpoint = vpc.addInterfaceEndpoint(id, {
      service,
      privateDnsEnabled: true,
      securityGroups: [endpointSecurityGroup],
      subnets: { subnetType: SubnetType.PRIVATE_ISOLATED },
    });
    endpoint.addToPolicy(endpointPolicy(actions));
    return endpoint;
  });

  const vpcLinkSecurityGroup = new SecurityGroup(scope, "VpcLinkSecurityGroup", {
    vpc,
    allowAllOutbound: false,
    description: "API Gateway VPC Link to the internal ALB only",
  });
  const albSecurityGroup = new SecurityGroup(scope, "AlbSecurityGroup", {
    vpc,
    allowAllOutbound: false,
    description: "Internal ALB accepts HTTPS only from API Gateway VPC Link",
  });
  const validationProbeSecurityGroup = new SecurityGroup(scope, "ValidationProbeSecurityGroup", {
    vpc,
    allowAllOutbound: false,
    description: "Candidate validation Lambda can reach only the internal validation listener and AWS endpoints",
  });
  albSecurityGroup.addIngressRule(vpcLinkSecurityGroup, Port.tcp(443), "API Gateway VPC Link HTTPS");
  vpcLinkSecurityGroup.addEgressRule(albSecurityGroup, Port.tcp(443), "internal ALB HTTPS");
  taskSecurityGroup.addIngressRule(albSecurityGroup, Port.tcp(8080), "ALB to ready Main container");
  albSecurityGroup.addEgressRule(taskSecurityGroup, Port.tcp(8080), "ready Main target");
  albSecurityGroup.addIngressRule(validationProbeSecurityGroup, Port.tcp(8082), "candidate validation probe");
  validationProbeSecurityGroup.addEgressRule(albSecurityGroup, Port.tcp(8082), "candidate validation listener");
  validationProbeSecurityGroup.addEgressRule(endpointSecurityGroup, Port.tcp(443), "validation evidence through endpoints");
  endpointSecurityGroup.addIngressRule(validationProbeSecurityGroup, Port.tcp(443), "validation evidence through endpoints");
  validationProbeSecurityGroup.addEgressRule(Peer.ipv4(vpc.vpcCidrBlock), Port.udp(53), "VPC DNS resolver");
  validationProbeSecurityGroup.addEgressRule(Peer.ipv4(vpc.vpcCidrBlock), Port.tcp(53), "VPC DNS resolver");

  const endpoints = [s3Endpoint, dynamoEndpoint, ...interfaceEndpoints];
  new CfnOutput(scope, "RecommendationVpcId", { value: vpc.vpcId });
  new CfnOutput(scope, "RecommendationVpcEndpointIds", {
    value: endpoints.map((endpoint) => endpoint.vpcEndpointId).join(","),
  });
  new CfnOutput(scope, "RecommendationPrivateSubnetIds", {
    value: vpc.isolatedSubnets.map(({ subnetId }) => subnetId).join(","),
  });
  new CfnOutput(scope, "RecommendationPrivateRouteTableIds", {
    value: vpc.isolatedSubnets.map(({ routeTable }) => routeTable.routeTableId).join(","),
  });
  new CfnOutput(scope, "RecommendationEndpointSecurityGroupId", {
    value: endpointSecurityGroup.securityGroupId,
  });
  return { vpc, albSecurityGroup, taskSecurityGroup, vpcLinkSecurityGroup, endpointSecurityGroup, validationProbeSecurityGroup, endpoints };
};

const endpointPolicy = (actions: readonly string[], resources: readonly string[] = ["*"]): PolicyStatement =>
  new PolicyStatement({ principals: [new AnyPrincipal()], actions: [...actions], resources: [...resources] });
