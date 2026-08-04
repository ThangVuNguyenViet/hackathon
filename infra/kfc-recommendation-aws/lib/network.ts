import { Stack } from "aws-cdk-lib";
import {
  FlowLogDestination,
  FlowLogTrafficType,
  GatewayVpcEndpointAwsService,
  InterfaceVpcEndpointAwsService,
  IpAddresses,
  Peer,
  Port,
  SecurityGroup,
  SubnetType,
  Vpc,
} from "aws-cdk-lib/aws-ec2";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";

export interface NetworkResources {
  readonly vpc: Vpc;
  readonly albSecurityGroup: SecurityGroup;
  readonly taskSecurityGroup: SecurityGroup;
  readonly vpcLinkSecurityGroup: SecurityGroup;
  readonly endpointSecurityGroup: SecurityGroup;
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

  vpc.addGatewayEndpoint("S3Endpoint", { service: GatewayVpcEndpointAwsService.S3 });
  vpc.addGatewayEndpoint("DynamoEndpoint", { service: GatewayVpcEndpointAwsService.DYNAMODB });

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

  const endpointServices: ReadonlyArray<[string, InterfaceVpcEndpointAwsService]> = [
    ["EcrApiEndpoint", InterfaceVpcEndpointAwsService.ECR],
    ["EcrDockerEndpoint", InterfaceVpcEndpointAwsService.ECR_DOCKER],
    ["LogsEndpoint", InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS],
    ["SecretsEndpoint", InterfaceVpcEndpointAwsService.SECRETS_MANAGER],
    ["MetricsEndpoint", InterfaceVpcEndpointAwsService.CLOUDWATCH_MONITORING],
    ["XrayEndpoint", InterfaceVpcEndpointAwsService.XRAY],
  ];
  for (const [id, service] of endpointServices) {
    vpc.addInterfaceEndpoint(id, {
      service,
      privateDnsEnabled: true,
      securityGroups: [endpointSecurityGroup],
      subnets: { subnetType: SubnetType.PRIVATE_ISOLATED },
    });
  }

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

  return { vpc, albSecurityGroup, taskSecurityGroup, vpcLinkSecurityGroup, endpointSecurityGroup };
};
