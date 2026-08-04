import { CfnOutput } from "aws-cdk-lib";
import { CfnApi, CfnAuthorizer, CfnIntegration, CfnRoute, CfnStage, CfnVpcLink } from "aws-cdk-lib/aws-apigatewayv2";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";

import type { AuthResources } from "./auth.js";
import type { ComputeResources } from "./compute.js";
import type { NetworkResources } from "./network.js";

export const createHttpApi = (
  scope: Construct,
  network: NetworkResources,
  compute: ComputeResources,
  auth: AuthResources,
): CfnApi => {
  const api = new CfnApi(scope, "HttpApi", {
    name: "kfc-recommendation-synthetic-sandbox",
    protocolType: "HTTP",
    disableExecuteApiEndpoint: false,
  });
  const vpcLink = new CfnVpcLink(scope, "VpcLink", {
    name: "kfc-recommendation-sandbox",
    subnetIds: network.vpc.isolatedSubnets.map((subnet) => subnet.subnetId),
    securityGroupIds: [network.vpcLinkSecurityGroup.securityGroupId],
  });
  const integration = new CfnIntegration(scope, "AlbIntegration", {
    apiId: api.ref,
    connectionId: vpcLink.ref,
    connectionType: "VPC_LINK",
    integrationMethod: "ANY",
    integrationType: "HTTP_PROXY",
    integrationUri: compute.listenerArn,
    payloadFormatVersion: "1.0",
    timeoutInMillis: 30_000,
  });
  const authorizer = new CfnAuthorizer(scope, "JwtAuthorizer", {
    apiId: api.ref,
    authorizerType: "JWT",
    identitySource: ["$request.header.Authorization"],
    name: "cognito-m2m",
    jwtConfiguration: {
      audience: [auth.client.userPoolClientId],
      issuer: auth.issuer,
    },
  });
  const route = new CfnRoute(scope, "DefaultRoute", {
    apiId: api.ref,
    routeKey: "$default",
    target: `integrations/${integration.ref}`,
    authorizationType: "JWT",
    authorizerId: authorizer.ref,
    authorizationScopes: [...auth.scopes],
  });
  const accessLogs = new LogGroup(scope, "ApiAccessLogs", {
    logGroupName: "/kfc/recommendations/sandbox/api-access",
    retention: RetentionDays.ONE_MONTH,
  });
  const stage = new CfnStage(scope, "DefaultStage", {
    apiId: api.ref,
    stageName: "$default",
    autoDeploy: true,
    accessLogSettings: {
      destinationArn: accessLogs.logGroupArn,
      format: JSON.stringify({
        requestId: "$context.requestId",
        routeKey: "$context.routeKey",
        status: "$context.status",
        responseLatencyMs: "$context.responseLatency",
        integrationError: "$context.integrationErrorMessage",
      }),
    },
    defaultRouteSettings: {
      detailedMetricsEnabled: true,
      throttlingBurstLimit: 200,
      throttlingRateLimit: 100,
    },
  });
  stage.addResourceDependency(route);
  new CfnOutput(scope, "RecommendationApiEndpoint", {
    value: api.attrApiEndpoint,
    description: "JWT-protected synthetic sandbox endpoint",
  });
  new CfnOutput(scope, "MachineClientId", {
    value: auth.client.userPoolClientId,
    description: "Cognito M2M client ID; the generated secret is intentionally not output",
  });
  return api;
};
