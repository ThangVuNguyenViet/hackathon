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
  const releaseKey = `RELEASE#${releaseDigest}`;
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
      parameters: {
        TableName: data.stateTable.tableName,
        Item: item,
        ConditionExpression: "attribute_not_exists(pk)",
      },
      physicalResourceId: PhysicalResourceId.of(`${id}-${releaseDigest}`),
    },
    policy,
    role,
  });
  put("ReleaseOrderSentinel", {
    pk: { S: releaseKey }, sk: { S: "ORDER" }, releaseDigest: { S: releaseDigest },
    snapshot: { S: "available" },
  });
  put("ReleaseJourneySentinel", {
    pk: { S: releaseKey }, sk: { S: "JOURNEY" }, releaseDigest: { S: releaseDigest },
    snapshot: { S: "available" },
  });
  for (const type of ["local_favorite", "for_you", "modifier_upsell", "smart_cross_sell"]) {
    put(`ReleaseExposure${type.replaceAll("_", "")}Sentinel`, {
      pk: { S: releaseKey }, sk: { S: `EXPOSURE#${type}` },
      releaseDigest: { S: releaseDigest }, snapshot: { S: "enabled" },
    });
  }
  put("ReleaseCatalogSentinel", {
    pk: { S: releaseKey }, sk: { S: "CATALOG" },
    releaseDigest: { S: releaseDigest }, catalogDigest: { S: catalogDigest },
  });
};
