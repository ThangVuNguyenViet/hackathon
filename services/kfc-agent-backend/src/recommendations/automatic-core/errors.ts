export class AutomaticRecommendationInfrastructureError extends Error {
  readonly status = 503;
  readonly code = 'recommendation_infrastructure_unavailable';
  readonly retryable = true;

  constructor(stage: 'context' | 'bundle' | 'scorer', cause?: unknown) {
    super(`Automatic recommendation ${stage} infrastructure unavailable`, {
      cause,
    });
    this.name = 'AutomaticRecommendationInfrastructureError';
  }
}
