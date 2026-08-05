import { AwsCustomResource, AwsCustomResourcePolicy, PhysicalResourceId } from "aws-cdk-lib/custom-resources";
import { PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import type { DataPlaneResources } from "./data-plane.js";
import type { ReleaseParameters } from "./release-parameters.js";

export const createSyntheticSentinels = (
  scope: Construct,
  data: DataPlaneResources,
  release: ReleaseParameters,
): void => {
  const releaseDigest = release.releaseDigest.valueAsString;
  const catalogDigest = release.trustedCatalogDigest.valueAsString;
  const policy = AwsCustomResourcePolicy.fromStatements([
    new PolicyStatement({ actions: ["dynamodb:PutItem"], resources: [data.stateTable.tableArn] }),
  ]);
  const role = new Role(scope, "SyntheticSentinelWriterRole", {
    assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
  });
  role.addToPolicy(new PolicyStatement({
    actions: ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"],
    resources: ["*"],
  }));
  role.addToPolicy(new PolicyStatement({ actions: ["dynamodb:PutItem"], resources: [data.stateTable.tableArn] }));
  const put = (id: string, item: Record<string, unknown>) => new AwsCustomResource(scope, id, {
    onCreate: {
      service: "DynamoDB",
      action: "putItem",
      parameters: { TableName: data.stateTable.tableName, Item: item },
      physicalResourceId: PhysicalResourceId.of(`${id}-${releaseDigest}`),
    },
    onUpdate: {
      service: "DynamoDB",
      action: "putItem",
      parameters: { TableName: data.stateTable.tableName, Item: item },
      physicalResourceId: PhysicalResourceId.of(`${id}-${releaseDigest}`),
    },
    policy,
    role,
  });
  put("ReleaseOrderSentinel", {
    pk: { S: `JOURNEY#sentinel:${releaseDigest}` },
    sk: { S: `OPPORTUNITY#sentinel:${releaseDigest}` },
    releaseDigest: { S: releaseDigest },
    snapshot: { M: {
      orderingJourneyRef: { S: `sentinel:${releaseDigest}` },
      opportunityRef: { S: `sentinel:${releaseDigest}` },
      storeId: { S: "synthetic-sentinel-store" },
      fulfilmentMode: { S: "pickup" },
      locale: { S: "vi-VN" },
      cart: { M: {
        cartId: { S: `sentinel:${releaseDigest}` }, revision: { S: releaseDigest },
        subtotal: { M: { amount: { N: "0" }, currency: { S: "VND" } } },
        lines: { L: [] },
      } },
      remainingBudgetVnd: { NULL: true }, parentCartLineId: { NULL: true }, verifiedCustomerRef: { NULL: true },
    } },
  });
  put("ReleaseExposureSentinel", {
    pk: { S: "EXPOSURE" }, sk: { S: "local_favorite" },
    releaseDigest: { S: releaseDigest }, snapshot: { S: "enabled" },
  });
  put("ReleaseCatalogSentinel", {
    pk: { S: `RELEASE#${releaseDigest}` }, sk: { S: "CATALOG" },
    releaseDigest: { S: releaseDigest }, catalogDigest: { S: catalogDigest },
  });
};
