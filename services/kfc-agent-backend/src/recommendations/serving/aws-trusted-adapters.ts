import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GetCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { z } from 'zod';
import type {
  AutomaticCatalogSnapshot,
  AutomaticQualifiedRecommendationBundle,
  AutomaticRecommendationContextPorts,
  AutomaticRecommendationType,
} from '../automatic-core/index.js';
import {
  catalogSnapshotSchema,
  completedHistorySnapshotSchema,
  trustedOrderContextSnapshotSchema,
} from '../automatic-core/snapshots.js';

type JsonRecord = Record<string, unknown>;
const jsonRecordSchema = z.record(z.unknown());

function record(value: unknown, label: string): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} is invalid`);
  }
  return jsonRecordSchema.parse(value);
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0)
    throw new Error(`${label} is invalid`);
  return value;
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(record(value, 'canonical JSON object'))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function verifiedJson(
  path: string,
  expectedDigest: string,
  label: string,
): unknown {
  const bytes = readFileSync(path);
  if (sha256(bytes) !== expectedDigest)
    throw new Error(`${label} digest mismatch`);
  return JSON.parse(bytes.toString('utf8')) as unknown;
}

export function loadQualifiedAutomaticBundle({
  root,
  expectedBundleDigest,
  expectedContractDigest,
  expectedFeatureDigest,
  expectedComposerDigest,
}: {
  root: string;
  expectedBundleDigest: string;
  expectedContractDigest: string;
  expectedFeatureDigest: string;
  expectedComposerDigest: string;
}): AutomaticQualifiedRecommendationBundle {
  const manifestPath = resolve(root, 'bundle-manifest.json');
  const manifest = record(
    JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown,
    'bundle manifest',
  );
  const declaredDigest = text(manifest.bundleDigest, 'bundle digest');
  const binding = { ...manifest };
  delete binding.bundleDigest;
  if (
    sha256(canonical(binding)) !== declaredDigest ||
    declaredDigest !== expectedBundleDigest
  ) {
    throw new Error('qualified bundle digest mismatch');
  }
  if (manifest.schemaVersion !== 'kfc-qualified-model-bundle-v1')
    throw new Error('qualified bundle schema mismatch');
  if (
    manifest.contractDigest !== expectedContractDigest ||
    manifest.featureContractDigest !== expectedFeatureDigest ||
    manifest.composerContractDigest !== expectedComposerDigest
  ) {
    throw new Error('qualified bundle contract mismatch');
  }
  const payloads = record(manifest.payloadDigests, 'bundle payload digests');
  const champions = record(manifest.champions, 'bundle champions');
  for (const [relative, expected] of Object.entries(payloads)) {
    if (typeof expected !== 'string' || relative.includes('..'))
      throw new Error('bundle payload binding is invalid');
    const path = resolve(root, relative);
    if (
      !path.startsWith(`${resolve(root)}/`) ||
      sha256(readFileSync(path)) !== expected
    ) {
      throw new Error('bundle payload digest mismatch');
    }
  }
  const evidenceDigest = text(
    manifest.qualificationEvidenceDigest,
    'qualification evidence digest',
  );
  const qualificationEvidence = record(
    verifiedJson(
      resolve(root, 'evidence/qualification-evidence.json'),
      evidenceDigest,
      'qualification evidence',
    ),
    'qualification evidence',
  );
  if (
    qualificationEvidence.status !== 'qualified' ||
    qualificationEvidence.servingBundleEmitted !== true
  ) {
    throw new Error('qualification evidence is not deployable');
  }
  const model = (type: AutomaticRecommendationType) => {
    const prefix = `models/${type}`;
    const suffix = champions[type] === 'lightgbm' ? 'model.txt' : 'model.json';
    const selection = text(
      payloads[`${prefix}/selection/${suffix}`],
      'selection model',
    );
    const joint = text(payloads[`${prefix}/joint/${suffix}`], 'joint model');
    const selectionCalibrator = text(
      payloads[`${prefix}/selection-calibrator.json`],
      'selection calibrator',
    );
    const jointCalibrator = text(
      payloads[`${prefix}/joint-calibrator.json`],
      'joint calibrator',
    );
    const thresholdPath = `${prefix}/abstention-threshold.json`;
    const threshold = record(
      verifiedJson(
        resolve(root, thresholdPath),
        text(payloads[thresholdPath], 'threshold revision'),
        'threshold',
      ),
      'threshold',
    );
    if (typeof threshold.threshold !== 'number')
      throw new Error('qualified threshold is invalid');
    return {
      modelRevision: sha256(canonical([selection, joint])),
      calibratorRevision: sha256(
        canonical([selectionCalibrator, jointCalibrator]),
      ),
      featureSchemaDigest: expectedFeatureDigest,
      thresholdRevision: text(payloads[thresholdPath], 'threshold revision'),
      minimumJointProbability: threshold.threshold,
    };
  };
  const models: AutomaticQualifiedRecommendationBundle['models'] = {
    local_favorite: model('local_favorite'),
    for_you: model('for_you'),
    modifier_upsell: model('modifier_upsell'),
    smart_cross_sell: model('smart_cross_sell'),
  };
  return {
    schemaVersion: 'kfc-qualified-automatic-bundle-v1',
    bundleId: `bundle:${declaredDigest}`,
    bundleDigest: declaredDigest,
    composerContractDigest: expectedComposerDigest,
    qualificationRunId: `qualification:${text(manifest.configurationDigest, 'configuration digest')}`,
    qualificationEvidenceDigest: evidenceDigest,
    models,
  };
}

export function createAwsTrustedContextPorts({
  tableName,
  documentClient,
  catalog,
  releaseDigest,
}: {
  tableName: string;
  documentClient: DynamoDBDocumentClient;
  catalog: AutomaticCatalogSnapshot;
  releaseDigest: string;
}): AutomaticRecommendationContextPorts {
  const read = async (pk: string, sk: string): Promise<unknown> => {
    const result = await documentClient.send(
      new GetCommand({
        TableName: tableName,
        Key: { pk, sk },
        ConsistentRead: true,
      }),
    );
    return result.Item?.snapshot ?? null;
  };
  return {
    orderContext: {
      readSnapshot: async ({ orderingJourneyRef, opportunityRef }) => {
        const value = await read(
          `JOURNEY#${orderingJourneyRef}`,
          `OPPORTUNITY#${opportunityRef}`,
        );
        return value === null
          ? null
          : trustedOrderContextSnapshotSchema.parse(value);
      },
    },
    catalog: { readSnapshot: async () => catalog },
    history: {
      readCompletedHistory: async (verifiedCustomerRef) => {
        const value = await read(
          `CUSTOMER#${verifiedCustomerRef}`,
          'COMPLETED_HISTORY',
        );
        return value === null
          ? null
          : completedHistorySnapshotSchema.parse(value);
      },
    },
    exposure: {
      async readState(type) {
        const state = await read(
          `RELEASE#${releaseDigest}`,
          `EXPOSURE#${type}`,
        );
        if (state !== 'enabled' && state !== 'paused')
          throw new Error('trusted exposure state is unavailable');
        return state;
      },
    },
    clock: { now: () => new Date() },
  };
}

export async function verifyAwsTrustedSentinels({
  tableName,
  documentClient,
  releaseDigest,
  catalogDigest,
}: {
  tableName: string;
  documentClient: DynamoDBDocumentClient;
  releaseDigest: string;
  catalogDigest: string;
}): Promise<boolean> {
  const get = async (pk: string, sk: string) =>
    documentClient.send(
      new GetCommand({
        TableName: tableName,
        Key: { pk, sk },
        ConsistentRead: true,
      }),
    );
  const releaseKey = `RELEASE#${releaseDigest}`;
  const types = [
    'local_favorite',
    'for_you',
    'modifier_upsell',
    'smart_cross_sell',
  ] as const;
  const [order, journey, catalog, ...exposures] = await Promise.all([
    get(releaseKey, 'ORDER'),
    get(releaseKey, 'JOURNEY'),
    get(releaseKey, 'CATALOG'),
    ...types.map((type) => get(releaseKey, `EXPOSURE#${type}`)),
  ]);
  return (
    order.Item?.releaseDigest === releaseDigest &&
    journey.Item?.releaseDigest === releaseDigest &&
    catalog.Item?.releaseDigest === releaseDigest &&
    catalog.Item.catalogDigest === catalogDigest &&
    exposures.every(
      ({ Item }) =>
        Item?.releaseDigest === releaseDigest && Item.snapshot === 'enabled',
    )
  );
}

export function loadTrustedCatalog(
  path: string,
  expectedDigest: string,
): AutomaticCatalogSnapshot {
  return catalogSnapshotSchema.parse(
    verifiedJson(path, expectedDigest, 'trusted catalog'),
  );
}
