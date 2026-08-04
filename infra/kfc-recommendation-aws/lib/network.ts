import { CfnOutput } from "aws-cdk-lib";
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

export interface NetworkResources {
  readonly vpc: Vpc;
  readonly albSecurityGroup: SecurityGroup;
  readonly taskSecurityGroup: SecurityGroup;
  readonly vpcLinkSecurityGroup: SecurityGroup;
  readonly endpointSecurityGroup: SecurityGroup;
  readonly endpoints: readonly (GatewayVpcEndpoint | InterfaceVpcEndpoint)[];
}

export const createNetwork = (scope: Construct): NetworkResources => {
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
  s3Endpoint.addToPolicy(endpointPolicy(["s3:GetObject", "s3:PutObject", "s3:AbortMultipartUpload", "s3:ListBucket"]));
  const dynamoEndpoint = vpc.addGatewayEndpoint("DynamoEndpoint", { service: GatewayVpcEndpointAwsService.DYNAMODB });
  dynamoEndpoint.addToPolicy(endpointPolicy([
    "dynamodb:DescribeTable",
    "dynamodb:GetItem",
    "dynamodb:PutItem",
    "dynamodb:UpdateItem",
    "dynamodb:Query",
    "dynamodb:TransactWriteItems",
  ]));

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
  albSecurityGroup.addIngressRule(vpcLinkSecurityGroup, Port.tcp(443), "API Gateway VPC Link HTTPS");
  vpcLinkSecurityGroup.addEgressRule(albSecurityGroup, Port.tcp(443), "internal ALB HTTPS");
  taskSecurityGroup.addIngressRule(albSecurityGroup, Port.tcp(8080), "ALB to ready Main container");
  albSecurityGroup.addEgressRule(taskSecurityGroup, Port.tcp(8080), "ready Main target");

  const endpoints = [s3Endpoint, dynamoEndpoint, ...interfaceEndpoints];
  new CfnOutput(scope, "RecommendationVpcId", { value: vpc.vpcId });
  new CfnOutput(scope, "RecommendationVpcEndpointIds", {
    value: endpoints.map((endpoint) => endpoint.vpcEndpointId).join(","),
  });
  return { vpc, albSecurityGroup, taskSecurityGroup, vpcLinkSecurityGroup, endpointSecurityGroup, endpoints };
};

const endpointPolicy = (actions: readonly string[]): PolicyStatement =>
  new PolicyStatement({ principals: [new AnyPrincipal()], actions: [...actions], resources: ["*"] });
