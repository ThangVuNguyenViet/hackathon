import {
  createClient,
  type ClientConfig,
  type SanityClient,
} from '@sanity/client';
import type { MerchandisingPolicyRepository } from '../recommendations/merchandising/repository.js';
import { SanityMerchandisingPolicyRepository } from '../recommendations/merchandising/sanity-policy-repository.js';

export interface RecommendationSanityConfig {
  projectId: string;
  dataset: string;
  apiVersion: string;
  readToken?: string;
}

export interface RecommendationSanityReadiness {
  ok: boolean;
  required: true;
  configured: boolean;
  authority: 'sanity';
  reachable?: boolean;
  policyCount?: number;
  snapshotDigest?: string;
  message?: string;
}

export type SanityClientFactory = (config: ClientConfig) => SanityClient;

function optionalValue(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

export function recommendationSanityConfig(input: {
  projectId?: string;
  dataset?: string;
  apiVersion?: string;
  readToken?: string;
}): RecommendationSanityConfig | undefined {
  const projectId = optionalValue(input.projectId);
  const dataset = optionalValue(input.dataset);
  const apiVersion = optionalValue(input.apiVersion);
  const configured = [projectId, dataset, apiVersion].filter(Boolean).length;
  if (configured === 0) return undefined;
  if (configured !== 3) {
    throw new Error(
      'SANITY_PROJECT_ID, SANITY_DATASET, and SANITY_API_VERSION must be configured together',
    );
  }
  return {
    projectId: projectId!,
    dataset: dataset!,
    apiVersion: apiVersion!,
    readToken: optionalValue(input.readToken),
  };
}

export function createSanityMerchandisingPolicyRepository(
  config: RecommendationSanityConfig,
  clientFactory: SanityClientFactory = createClient,
): MerchandisingPolicyRepository {
  const client = clientFactory({
    projectId: config.projectId,
    dataset: config.dataset,
    apiVersion: config.apiVersion,
    token: config.readToken,
    useCdn: config.readToken === undefined,
    perspective: 'published',
    maxRetries: 0,
  });
  return new SanityMerchandisingPolicyRepository(client);
}

export function unconfiguredRecommendationSanityReadiness(
  configurationError = false,
): RecommendationSanityReadiness {
  return {
    ok: false,
    required: true,
    configured: false,
    authority: 'sanity',
    message: configurationError
      ? 'Sanity merchandising configuration is incomplete'
      : 'Sanity merchandising authority is not configured',
  };
}

export async function checkRecommendationSanityReadiness(
  repository: MerchandisingPolicyRepository,
): Promise<RecommendationSanityReadiness> {
  try {
    const published = await repository.loadPublishedSnapshot();
    return {
      ok: true,
      required: true,
      configured: true,
      authority: 'sanity',
      reachable: true,
      policyCount: published.snapshot.policies.length,
      snapshotDigest: published.binding.digest,
    };
  } catch {
    return {
      ok: false,
      required: true,
      configured: true,
      authority: 'sanity',
      reachable: false,
      message: 'Sanity merchandising authority is unreachable or invalid',
    };
  }
}
