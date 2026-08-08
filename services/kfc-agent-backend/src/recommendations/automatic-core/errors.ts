export class AutomaticRecommendationInfrastructureError extends Error {
  readonly status = 503;
  readonly code = 'recommendation_infrastructure_unavailable';
  readonly retryable = true;
  readonly stage: 'context' | 'bundle' | 'features' | 'scorer';

  constructor(
    stage: 'context' | 'bundle' | 'features' | 'scorer',
    cause?: unknown,
  ) {
    super(`Automatic recommendation ${stage} infrastructure unavailable`, {
      cause,
    });
    this.name = 'AutomaticRecommendationInfrastructureError';
    this.stage = stage;
  }
}

export class AutomaticRecommendationBindingError extends Error {
  readonly status = 409;
  readonly code = 'identity_conflict';
  readonly retryable = false;

  constructor(binding: string) {
    super(`Automatic recommendation ${binding} binding does not match`);
    this.name = 'AutomaticRecommendationBindingError';
  }
}
