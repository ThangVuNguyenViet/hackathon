import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createClient } from '@sanity/client';
import {
  checkRecommendationSanityReadiness,
  createSanityMerchandisingPolicyRepository,
  recommendationSanityConfig,
} from '../src/config/recommendationSanity.js';
import {
  probeShadowService,
  validateBackendQualificationEnvironment,
} from '../src/qualification/externalQualification.js';
import { verifySanityRecommendationPolicies } from './seed-sanity-recommendation-policies.js';

const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const backendUrl = required('KFC_AGENT_BACKEND_URL').replace(/\/+$/u, '');
const sourceCommit = required('RELEASE_GIT_SHA');
const probeRequestPath = resolve(required('KFC_SHADOW_PROBE_REQUEST'));
const outputPath = resolve(required('KFC_QUALIFICATION_PROBE_OUTPUT'));
const sanityConfig = recommendationSanityConfig({
  projectId: required('SANITY_PROJECT_ID'),
  dataset: required('SANITY_DATASET'),
  apiVersion: required('SANITY_API_VERSION'),
});
if (!sanityConfig) throw new Error('Sanity configuration is required');

const probeRequest = JSON.parse(await readFile(probeRequestPath, 'utf8')) as
  Record<string, unknown> | undefined;
if (!probeRequest) throw new Error('KFC shadow probe request is empty');

const shadow = await probeShadowService({
  baseUrl: required('KFC_RECOMMENDATION_SHADOW_URL'),
  modelRevision: required('KFC_RECOMMENDATION_SHADOW_MODEL_REVISION'),
  probeRequest,
});
const publicSanityClient = createClient({
  projectId: sanityConfig.projectId,
  dataset: sanityConfig.dataset,
  apiVersion: sanityConfig.apiVersion,
  useCdn: false,
  perspective: 'published',
  maxRetries: 0,
});
await verifySanityRecommendationPolicies(publicSanityClient);
const sanity = await checkRecommendationSanityReadiness(
  createSanityMerchandisingPolicyRepository(sanityConfig),
);
if (!sanity.ok || !sanity.snapshotDigest) {
  throw new Error('Public Sanity snapshot is not ready');
}
const readinessResponse = await fetch(`${backendUrl}/ready?deep=1`);
if (!readinessResponse.ok) {
  throw new Error(
    `Backend deep readiness failed with HTTP ${readinessResponse.status}`,
  );
}
const backend = validateBackendQualificationEnvironment(
  await readinessResponse.json(),
  { expectedSourceCommit: sourceCommit },
);
if (backend.sanitySnapshotDigest !== sanity.snapshotDigest) {
  throw new Error('Backend and direct Sanity snapshot digests differ');
}

const result = {
  schemaVersion: 'kfc-recommendation-external-probe-v1',
  sourceCommit,
  shadow,
  sanity: {
    ok: true,
    authority: 'sanity',
    dataset: sanityConfig.dataset,
    policyCount: sanity.policyCount,
    snapshotDigest: sanity.snapshotDigest,
    publishedSnapshotVerified: true,
  },
  backend,
};
await writeFile(outputPath, JSON.stringify(result, null, 2) + '\n', 'utf8');
console.log(JSON.stringify(result, null, 2));
