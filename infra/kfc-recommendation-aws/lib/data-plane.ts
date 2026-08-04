import { Duration, RemovalPolicy } from "aws-cdk-lib";
import { AttributeType, BillingMode, Table, TableEncryption } from "aws-cdk-lib/aws-dynamodb";
import { Repository, RepositoryEncryption, TagMutability } from "aws-cdk-lib/aws-ecr";
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
  readonly mainRepository: Repository;
  readonly scorerRepository: Repository;
  readonly adotRepository: Repository;
}

const repository = (scope: Construct, id: string, name: string): Repository =>
  new Repository(scope, id, {
    repositoryName: name,
    imageScanOnPush: true,
    imageTagMutability: TagMutability.IMMUTABLE,
    encryption: RepositoryEncryption.AES_256,
    removalPolicy: RemovalPolicy.RETAIN,
    emptyOnDelete: false,
  });

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
      resources: [evidenceBucket.arnForObjects("evidence/*")],
    }),
  );
  const stateTable = new Table(scope, "StateTable", {
    partitionKey: { name: "PK", type: AttributeType.STRING },
    sortKey: { name: "SK", type: AttributeType.STRING },
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
  return {
    key,
    evidenceBucket,
    accessLogBucket,
    stateTable,
    runtimeSecret,
    mainRepository: repository(scope, "MainRepository", "kfc-recommendation-main"),
    scorerRepository: repository(scope, "ScorerRepository", "kfc-recommendation-scorer"),
    adotRepository: repository(scope, "AdotRepository", "kfc-recommendation-adot"),
  };
};
