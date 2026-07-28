import type { SanityClient } from '@sanity/client';
import policySnapshot from '../../fixtures/recommendations/sanity-policy-snapshot-v1.json' with { type: 'json' };
import { buildServerOptionsFromEnv } from '../../src/api/serverOptions.js';
import { loadEnv } from '../../src/config/env.js';

export const deterministicSanityEnv = {
  SANITY_PROJECT_ID: 'deterministic-test-project',
  SANITY_DATASET: 'deterministic-test-dataset',
  SANITY_API_VERSION: '2025-02-19',
} as const;

export const deterministicSanityClient = {
  fetch: async () =>
    policySnapshot.policies.map((policy, index) => ({
      ...policy,
      _id: `recommendationPolicy-${policy.policyId}`,
      _rev: `deterministic-revision-${index + 1}`,
      _updatedAt: `2026-07-26T09:00:0${index}Z`,
    })),
} as unknown as SanityClient;

export function buildDeterministicRecommendationServerOptions(
  input: NodeJS.ProcessEnv = {},
) {
  return buildServerOptionsFromEnv(
    loadEnv({ ...deterministicSanityEnv, ...input }),
    { sanityClientFactory: () => deterministicSanityClient },
  );
}
