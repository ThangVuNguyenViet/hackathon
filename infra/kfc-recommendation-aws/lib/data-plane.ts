import { CfnOutput, Duration, RemovalPolicy } from "aws-cdk-lib";
import { AttributeType, BillingMode, ProjectionType, Table, TableEncryption } from "aws-cdk-lib/aws-dynamodb";
import { AnyPrincipal, Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Key } from "aws-cdk-lib/aws-kms";
import { BlockPublicAccess, Bucket, BucketEncryption } from "aws-cdk-lib/aws-s3";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";

export interface DataPlaneResources {
  readonly key: Key;
  readonly evidenceBucket: Bucket;
  readonly accessLogBucket: Bucket;
  readonly stateTable: Table;
  readonly runtimeSecret: Secret;
}

export const createDataPlane = (scope: Construct): DataPlaneResources => {
  const key = new Key(scope, "DataKey", {
    alias: "alias/kfc-recommendation-sandbox",
    enableKeyRotation: true,
    removalPolicy: RemovalPolicy.RETAIN,
  });
  const accessLogBucket = new Bucket(scope, "AccessLogBucket", {
    encryption: BucketEncryption.S3_MANAGED,
    enforceSSL: true,
    blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
    lifecycleRules: [{ id: "expire-sandbox-access-logs", expiration: Duration.days(30) }],
    removalPolicy: RemovalPolicy.RETAIN,
  });
  const evidenceBucket = new Bucket(scope, "EvidenceBucket", {
    encryption: BucketEncryption.KMS,
    encryptionKey: key,
    bucketKeyEnabled: true,
    versioned: true,
    enforceSSL: true,
    blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
    removalPolicy: RemovalPolicy.RETAIN,
    autoDeleteObjects: false,
    serverAccessLogsBucket: accessLogBucket,
    serverAccessLogsPrefix: "evidence-access/",
  });
  evidenceBucket.addToResourcePolicy(
    new PolicyStatement({
      sid: "DenyEvidenceMutation",
      effect: Effect.DENY,
      principals: [new AnyPrincipal()],
      actions: ["s3:DeleteObject", "s3:DeleteObjectVersion"],
      resources: [evidenceBucket.arnForObjects("automatic-recommendations/*")],
    }),
  );
  evidenceBucket.addToResourcePolicy(
    new PolicyStatement({
      sid: "DenyReadinessProbeDeletion",
      effect: Effect.DENY,
      principals: [new AnyPrincipal()],
      actions: ["s3:DeleteObject", "s3:DeleteObjectVersion"],
      resources: [evidenceBucket.arnForObjects("readiness-probes/*")],
    }),
  );
  evidenceBucket.addToResourcePolicy(
    new PolicyStatement({
      sid: "DenyCompletedReleaseMutation",
      effect: Effect.DENY,
      principals: [new AnyPrincipal()],
      actions: ["s3:DeleteObject", "s3:DeleteObjectVersion"],
      resources: [evidenceBucket.arnForObjects("completed-releases/*")],
    }),
  );
  const stateTable = new Table(scope, "StateTable", {
    partitionKey: { name: "pk", type: AttributeType.STRING },
    sortKey: { name: "sk", type: AttributeType.STRING },
    billingMode: BillingMode.PAY_PER_REQUEST,
    encryption: TableEncryption.CUSTOMER_MANAGED,
    encryptionKey: key,
    pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
    deletionProtection: true,
    removalPolicy: RemovalPolicy.RETAIN,
  });
  const runtimeSecret = new Secret(scope, "RuntimeSecret", {
    description: "Recommendation sandbox runtime secret material; values are never emitted by CDK",
    encryptionKey: key,
    generateSecretString: {
      secretStringTemplate: JSON.stringify({ purpose: "recommendation-runtime" }),
      generateStringKey: "token",
      excludePunctuation: true,
      passwordLength: 48,
    },
  });
  stateTable.addGlobalSecondaryIndex({
    indexName: "evidenceDigest-index",
    partitionKey: { name: "evidenceDigest", type: AttributeType.STRING },
    projectionType: ProjectionType.KEYS_ONLY,
  });
  new CfnOutput(scope, "RecommendationEvidenceBucketArn", { value: evidenceBucket.bucketArn });
  new CfnOutput(scope, "RecommendationStateTableArn", { value: stateTable.tableArn });
  return {
    key,
    evidenceBucket,
    accessLogBucket,
    stateTable,
    runtimeSecret,
  };
};
