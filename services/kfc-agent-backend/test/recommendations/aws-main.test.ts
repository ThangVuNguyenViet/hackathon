import { describe, expect, it, vi } from 'vitest';
import type { AutomaticRecommendationHttpRuntime } from '../../src/recommendations/serving/http-runtime.js';
import { createAwsRecommendationMainServer } from '../../src/recommendations/serving/aws-main-server.js';
import type {
  AutomaticQualifiedRecommendationBundle,
  AutomaticRecommendationContextPorts,
} from '../../src/recommendations/automatic-core/index.js';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

function runtime(ok = true): AutomaticRecommendationHttpRuntime {
  return {
    decide: vi.fn(),
    recordImpression: vi.fn(),
    recordOutcome: vi.fn(),
    inspect: vi.fn(),
    readiness: vi.fn(async () => ({ ok })),
    close: vi.fn(async () => undefined),
  };
}

const completeEnv = {
  AWS_REGION: 'ap-southeast-1',
  EVIDENCE_BUCKET: 'evidence',
  STATE_TABLE: 'state',
  SCORER_URL: 'http://127.0.0.1:8081',
  QUALIFIED_BUNDLE_PATH: '/opt/kfc/bundle',
  TRUSTED_CATALOG_PATH: '/opt/kfc/catalog/catalog.json',
  TRUSTED_CATALOG_DIGEST: 'a'.repeat(64),
  QUALIFIED_BUNDLE_DIGEST: 'b'.repeat(64),
  AUTOMATIC_CONTRACT_DIGEST: 'c'.repeat(64),
  AUTOMATIC_FEATURE_DIGEST: 'd'.repeat(64),
  AUTOMATIC_COMPOSER_DIGEST: 'e'.repeat(64),
  RELEASE_DIGEST: 'f'.repeat(64),
  RUNTIME_TOKEN: 'trusted-admin-token-that-is-at-least-32-characters',
};

const bundle: AutomaticQualifiedRecommendationBundle = {
  schemaVersion: 'kfc-qualified-automatic-bundle-v1',
  bundleId: 'bundle:test',
  bundleDigest: 'b'.repeat(64),
  composerContractDigest: 'e'.repeat(64),
  qualificationRunId: 'qualification:test',
  qualificationEvidenceDigest: '1'.repeat(64),
  models: {
    local_favorite: {
      modelRevision: 'model',
      calibratorRevision: 'calibrator',
      featureSchemaDigest: 'd'.repeat(64),
      thresholdRevision: 'threshold',
      minimumJointProbability: 0.5,
    },
    for_you: {
      modelRevision: 'model',
      calibratorRevision: 'calibrator',
      featureSchemaDigest: 'd'.repeat(64),
      thresholdRevision: 'threshold',
      minimumJointProbability: 0.5,
    },
    modifier_upsell: {
      modelRevision: 'model',
      calibratorRevision: 'calibrator',
      featureSchemaDigest: 'd'.repeat(64),
      thresholdRevision: 'threshold',
      minimumJointProbability: 0.5,
    },
    smart_cross_sell: {
      modelRevision: 'model',
      calibratorRevision: 'calibrator',
      featureSchemaDigest: 'd'.repeat(64),
      thresholdRevision: 'threshold',
      minimumJointProbability: 0.5,
    },
  },
};
const contextPorts: AutomaticRecommendationContextPorts = {
  orderContext: { readSnapshot: async () => null },
  catalog: {
    readSnapshot: async () => {
      throw new Error('unused');
    },
  },
  history: { readCompletedHistory: async () => null },
  exposure: { readState: async () => 'paused' },
  clock: { now: () => new Date() },
};
const prepareTrustedComposition = () => ({
  bundle,
  contextPorts,
  documents: DynamoDBDocumentClient.from(
    new DynamoDBClient({ region: 'ap-southeast-1' }),
  ),
});

describe('AWS recommendation-only Main', () => {
  it('starts without Postgres and composes the AWS runtime from server-owned ports', async () => {
    const automatic = runtime();
    const createRuntime = vi.fn(() => automatic);
    const server = createAwsRecommendationMainServer(completeEnv, {
      createRuntime,
      prepareTrustedComposition,
    });
    expect(createRuntime).toHaveBeenCalledOnce();
    expect((createRuntime.mock.calls as unknown[][])[0]?.[0]).toMatchObject({
      region: 'ap-southeast-1',
      evidenceBucket: 'evidence',
      ledgerTable: 'state',
      scorerBaseUrl: 'http://127.0.0.1:8081',
    });
    const ready = await server.inject({ method: 'GET', url: '/ready' });
    const readiness = ready.json() as {
      checks: Record<string, { ok: boolean }>;
    };
    expect(
      Object.fromEntries(
        Object.entries(readiness.checks).filter(([, check]) => !check.ok),
      ),
    ).toEqual({});
    await server.close();
  });

  it('fails closed instead of constructing a partially trusted runtime', async () => {
    const createRuntime = vi.fn(() => runtime());
    const server = createAwsRecommendationMainServer(
      { ...completeEnv, TRUSTED_CATALOG_DIGEST: '' },
      { createRuntime },
    );
    expect(createRuntime).not.toHaveBeenCalled();
    const ready = await server.inject({ method: 'GET', url: '/ready' });
    expect(ready.statusCode).toBe(503);
    expect(ready.json()).toMatchObject({
      checks: { automaticRecommendations: { ok: false } },
    });
    await server.close();
  });

  it('uses the injected runtime secret for protected inspection', async () => {
    const automatic = runtime();
    vi.mocked(automatic.inspect).mockResolvedValue({
      recommendationId: 'rec-1',
    });
    const server = createAwsRecommendationMainServer(completeEnv, {
      createRuntime: () => automatic,
      prepareTrustedComposition,
    });
    expect(
      (
        await server.inject({
          url: '/v1/admin/recommendations/rec-1/inspection',
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await server.inject({
          url: '/v1/admin/recommendations/rec-1/inspection',
          headers: { 'x-kfc-demo-admin-token': completeEnv.RUNTIME_TOKEN },
        })
      ).statusCode,
    ).toBe(200);
    await server.close();
  });
});
