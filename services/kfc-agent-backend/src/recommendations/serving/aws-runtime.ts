import { DynamoDBClient, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type {
  AutomaticRecommendationScorerPort,
  AutomaticScorerRequest,
} from '../automatic-core/index.js';
import type { AutomaticRecommendationType } from '../contracts/automatic-recommendation.js';
import { AUTOMATIC_RECOMMENDATION_CONTRACT_DIGEST } from '../contracts/automatic-recommendation.js';
import {
  DynamoDbAutomaticRecommendationLedger,
  S3AutomaticEvidenceObjectStore,
} from './aws-evidence-adapters.js';
import {
  createAutomaticEvidenceSaga,
  createAutomaticRecommendationServingRuntime,
  type AutomaticDecisionEvidence,
} from './evidence-saga.js';
import {
  createAutomaticRecommendationHttpRuntime,
  type AutomaticRecommendationHttpRuntime,
} from './http-runtime.js';
import { createPersistentAutomaticScorerClient } from './scorer-client.js';

export function createAwsAutomaticRecommendationRuntime({
  region,
  evidenceBucket,
  ledgerTable,
  scorerBaseUrl,
  scorerMaxConcurrency,
  scorerTimeoutMs,
  readinessWarmup,
  createDecisionEngine,
  technicalEvidence,
  s3Client = new S3Client({ region }),
  dynamoClient = new DynamoDBClient({ region }),
  documentClient,
}: {
  region: string;
  evidenceBucket: string;
  ledgerTable: string;
  scorerBaseUrl: string;
  scorerMaxConcurrency: number;
  scorerTimeoutMs: number;
  readinessWarmup: AutomaticScorerRequest;
  createDecisionEngine(scorer: AutomaticRecommendationScorerPort): {
    decide(
      type: AutomaticRecommendationType,
      request: unknown,
    ): Promise<unknown>;
  };
  technicalEvidence(input: {
    request: Parameters<ReturnType<typeof createDecisionEngine>['decide']>[1];
    response: unknown;
  }): AutomaticDecisionEvidence['technical'];
  s3Client?: S3Client;
  dynamoClient?: DynamoDBClient;
  documentClient?: DynamoDBDocumentClient;
}): AutomaticRecommendationHttpRuntime {
  const scorer = createPersistentAutomaticScorerClient({
    baseUrl: scorerBaseUrl,
    maxConcurrency: scorerMaxConcurrency,
    timeoutMs: scorerTimeoutMs,
  });
  const documents =
    documentClient ??
    DynamoDBDocumentClient.from(dynamoClient, {
      marshallOptions: { removeUndefinedValues: true },
    });
  const saga = createAutomaticEvidenceSaga({
    objects: new S3AutomaticEvidenceObjectStore({
      bucket: evidenceBucket,
      client: s3Client,
    }),
    ledger: new DynamoDbAutomaticRecommendationLedger({
      tableName: ledgerTable,
      client: documents,
    }),
    clock: () => new Date(),
  });
  const decisions = createAutomaticRecommendationServingRuntime({
    engine: createDecisionEngine(scorer),
    evidence: saga,
    contractDigest: AUTOMATIC_RECOMMENDATION_CONTRACT_DIGEST,
    technicalEvidence,
  });
  return createAutomaticRecommendationHttpRuntime({
    decisions,
    evidence: saga,
    async readiness() {
      const [scorerReady, storageReady, ledgerReady] = await Promise.all([
        scorer.warmup(readinessWarmup),
        s3Client.send(new HeadBucketCommand({ Bucket: evidenceBucket })).then(
          () => true,
          () => false,
        ),
        dynamoClient
          .send(new DescribeTableCommand({ TableName: ledgerTable }))
          .then(
            () => true,
            () => false,
          ),
      ]);
      return {
        ok: scorerReady && storageReady && ledgerReady,
        ...(!scorerReady || !storageReady || !ledgerReady
          ? {
              message:
                'scorer, versioned evidence storage, or ledger is unavailable',
            }
          : {}),
      };
    },
    async close() {
      scorer.close();
      documents.destroy?.();
      if (documents !== dynamoClient) dynamoClient.destroy?.();
      s3Client.destroy?.();
    },
  });
}
