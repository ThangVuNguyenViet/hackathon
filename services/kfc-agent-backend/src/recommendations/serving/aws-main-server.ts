import { randomUUID } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { z } from 'zod';
import { buildServer } from '../../api/server.js';
import { createOtelRuntimeProbe } from '../../observability/runtimeProbe.js';
import {
  AUTOMATIC_COMPOSER_CONTRACT_DIGEST,
  AUTOMATIC_FEATURE_SCHEMA_DIGEST,
  createAutomaticRecommendationEngine,
} from '../automatic-core/index.js';
import type {
  AutomaticQualifiedRecommendationBundle,
  AutomaticRecommendationContextPorts,
} from '../automatic-core/index.js';
import { AUTOMATIC_RECOMMENDATION_CONTRACT_DIGEST } from '../contracts/automatic-recommendation.js';
import { createAwsAutomaticRecommendationRuntime } from './aws-runtime.js';
import { createUnavailableAutomaticRecommendationHttpRuntime } from './http-runtime.js';
import {
  createAwsTrustedContextPorts,
  loadQualifiedAutomaticBundle,
  loadTrustedCatalog,
  verifyAwsTrustedSentinels,
} from './aws-trusted-adapters.js';

const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const envSchema = z.object({
  AWS_REGION: z.string().min(1),
  EVIDENCE_BUCKET: z.string().min(1),
  STATE_TABLE: z.string().min(1),
  SCORER_URL: z.string().url(),
  QUALIFIED_BUNDLE_PATH: z.string().min(1),
  TRUSTED_CATALOG_PATH: z.string().min(1),
  TRUSTED_CATALOG_DIGEST: digest,
  QUALIFIED_BUNDLE_DIGEST: digest,
  AUTOMATIC_CONTRACT_DIGEST: digest,
  AUTOMATIC_FEATURE_DIGEST: digest,
  AUTOMATIC_COMPOSER_DIGEST: digest,
  RELEASE_DIGEST: digest,
  RUNTIME_TOKEN: z.string().min(32),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  MAX_IN_FLIGHT: z.coerce.number().int().positive().max(128).default(16),
  SCORER_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .max(10_000)
    .default(750),
  PORT: z.coerce.number().int().positive().default(8080),
});

type RuntimeFactory = typeof createAwsAutomaticRecommendationRuntime;
type TrustedComposition = {
  documents: DynamoDBDocumentClient;
  bundle: AutomaticQualifiedRecommendationBundle;
  contextPorts: AutomaticRecommendationContextPorts;
};

export function createAwsRecommendationMainServer(
  input: Record<string, string | undefined>,
  dependencies: {
    createRuntime?: RuntimeFactory;
    prepareTrustedComposition?: () => TrustedComposition;
  } = {},
) {
  const parsed = envSchema.safeParse(input);
  if (!parsed.success) {
    return buildServer({
      automaticRecommendations:
        createUnavailableAutomaticRecommendationHttpRuntime(
          'AWS recommendation runtime activation is incomplete',
        ),
    });
  }
  const env = parsed.data;
  try {
    if (
      env.AUTOMATIC_CONTRACT_DIGEST !==
        AUTOMATIC_RECOMMENDATION_CONTRACT_DIGEST ||
      env.AUTOMATIC_FEATURE_DIGEST !== AUTOMATIC_FEATURE_SCHEMA_DIGEST ||
      env.AUTOMATIC_COMPOSER_DIGEST !== AUTOMATIC_COMPOSER_CONTRACT_DIGEST
    ) {
      throw new Error(
        'release digests do not match the compiled automatic runtime',
      );
    }
    const trusted =
      dependencies.prepareTrustedComposition?.() ??
      (() => {
        const dynamo = new DynamoDBClient({ region: env.AWS_REGION });
        const documents = DynamoDBDocumentClient.from(dynamo, {
          marshallOptions: { removeUndefinedValues: true },
        });
        const bundle = loadQualifiedAutomaticBundle({
          root: env.QUALIFIED_BUNDLE_PATH,
          expectedBundleDigest: env.QUALIFIED_BUNDLE_DIGEST,
          expectedContractDigest: env.AUTOMATIC_CONTRACT_DIGEST,
          expectedFeatureDigest: env.AUTOMATIC_FEATURE_DIGEST,
          expectedComposerDigest: env.AUTOMATIC_COMPOSER_DIGEST,
        });
        return {
          documents,
          bundle,
          contextPorts: createAwsTrustedContextPorts({
            tableName: env.STATE_TABLE,
            documentClient: documents,
            catalog: loadTrustedCatalog(
              env.TRUSTED_CATALOG_PATH,
              env.TRUSTED_CATALOG_DIGEST,
            ),
          }),
        };
      })();
    const { documents, bundle, contextPorts } = trusted;
    const createRuntime =
      dependencies.createRuntime ?? createAwsAutomaticRecommendationRuntime;
    const automaticRecommendations = createRuntime({
      region: env.AWS_REGION,
      evidenceBucket: env.EVIDENCE_BUCKET,
      ledgerTable: env.STATE_TABLE,
      scorerBaseUrl: env.SCORER_URL,
      scorerMaxConcurrency: env.MAX_IN_FLIGHT,
      scorerTimeoutMs: env.SCORER_TIMEOUT_MS,
      releaseDigest: env.RELEASE_DIGEST,
      trustedReadiness: () =>
        verifyAwsTrustedSentinels({
          tableName: env.STATE_TABLE,
          documentClient: documents,
          releaseDigest: env.RELEASE_DIGEST,
          catalogDigest: env.TRUSTED_CATALOG_DIGEST,
        }),
      documentClient: documents,
      readinessWarmup: {
        schemaVersion: 'kfc-automatic-scorer-v1',
        requestId: `warmup:${env.RELEASE_DIGEST}`,
        recommendationType: 'local_favorite',
        model: {
          bundleId: bundle.bundleId,
          bundleDigest: bundle.bundleDigest,
          ...bundle.models.local_favorite,
          composerContractDigest: bundle.composerContractDigest,
          qualificationRunId: bundle.qualificationRunId,
          qualificationEvidenceDigest: bundle.qualificationEvidenceDigest,
        },
        candidates: [],
      },
      createDecisionEngine: (scorer) =>
        createAutomaticRecommendationEngine({
          contextPorts,
          qualifiedBundlePort: { readQualifiedBundle: async () => bundle },
          scorer,
          ids: { nextRecommendationId: () => `recommendation:${randomUUID()}` },
          recommendationTtlMs: 300_000,
        }),
      technicalEvidence: () => ({
        contextBindings: {
          order: 'dynamodb',
          catalog: 'digest-bound-file',
          history: 'dynamodb',
          exposure: 'dynamodb',
        },
        potentialCandidates: [],
        eligibilityDecisions: [],
        featureReconciliation: { authority: 'deterministic-core' },
        scoresCalibration: null,
        composition: { authority: 'deterministic-core' },
        modelReleaseProvenance: { bundleDigest: bundle.bundleDigest },
        traceLocator: null,
      }),
    });
    return buildServer({
      automaticRecommendations,
      demoAdminToken: env.RUNTIME_TOKEN,
      readiness: {
        agentGatesReadiness: false,
        messengerRequired: false,
        zaloRequired: false,
        commerce: { mode: 'fixture' },
      },
      ...(env.OTEL_EXPORTER_OTLP_ENDPOINT
        ? {
            runtimeProbe: createOtelRuntimeProbe({
              endpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
              releaseDigest: env.RELEASE_DIGEST,
            }),
          }
        : {}),
    });
  } catch {
    return buildServer({
      automaticRecommendations:
        createUnavailableAutomaticRecommendationHttpRuntime(
          'AWS recommendation runtime trusted artifacts are unavailable',
        ),
    });
  }
}

export function awsRecommendationMainPort(
  input: Record<string, string | undefined>,
): number {
  return envSchema.safeParse(input).success ? Number(input.PORT ?? 8080) : 8080;
}
