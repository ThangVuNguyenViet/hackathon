import type { RecommendationOutputMode } from '../recommendations/shadow/contracts.js';

export interface RecommendationShadowConfigurationInput {
  shadowUrl: string;
  modelRevision: string;
  runtimeProfile: 'local_docker_cloudflare_tunnel';
  outputMode: RecommendationOutputMode;
}

export type RecommendationShadowReadiness = {
  ok: true;
  required: false;
  configured: boolean;
  runtimeProfile: 'local_docker_cloudflare_tunnel';
  outputMode: RecommendationOutputMode;
  message?: string;
};

const normalized = (value: string): string => value.trim();

export function recommendationShadowReadiness(
  input: RecommendationShadowConfigurationInput,
): RecommendationShadowReadiness {
  const shadowUrl = normalized(input.shadowUrl);
  const modelRevision = normalized(input.modelRevision);
  if (Boolean(shadowUrl) !== Boolean(modelRevision)) {
    return {
      ok: true,
      required: false,
      configured: false,
      runtimeProfile: input.runtimeProfile,
      outputMode: input.outputMode,
      message:
        'KFC_RECOMMENDATION_SHADOW_URL and KFC_RECOMMENDATION_SHADOW_MODEL_REVISION must be configured together',
    };
  }
  if (!shadowUrl) {
    return {
      ok: true,
      required: false,
      configured: false,
      runtimeProfile: input.runtimeProfile,
      outputMode: input.outputMode,
      message: 'Recommendation shadow scoring is not configured',
    };
  }
  return {
    ok: true,
    required: false,
    configured: true,
    runtimeProfile: input.runtimeProfile,
    outputMode: input.outputMode,
  };
}
