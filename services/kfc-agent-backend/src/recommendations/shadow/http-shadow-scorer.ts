import { z } from 'zod';
import type {
  RecommendationShadowFeatureContribution,
  RecommendationShadowScore,
  RecommendationShadowScoreRequest,
  RecommendationShadowScoreResult,
  RecommendationShadowScorer,
} from './contracts.js';

const nonBlankStringSchema = z.string().trim().min(1);
const finiteNumberSchema = z.number().finite();
const featureContributionSchema = z
  .object({
    feature: nonBlankStringSchema,
    reason_code: nonBlankStringSchema,
    contribution: finiteNumberSchema.min(-1).max(1),
  })
  .strict();
const predictionSchema = z
  .object({
    action_id: nonBlankStringSchema,
    calibrated_probability: finiteNumberSchema.min(0).max(1),
    expected_value_score: finiteNumberSchema,
    model_artifact_id: nonBlankStringSchema,
    calibration_id: nonBlankStringSchema,
    feature_schema: nonBlankStringSchema,
    feature_contributions: z.string(),
  })
  .strict();
const responseSchema = z
  .object({
    predictions: z.array(predictionSchema),
  })
  .strict();

export class RecommendationShadowScorerError extends Error {
  constructor(
    readonly code: 'shadow_http_error' | 'shadow_response_invalid',
    message: string = code,
  ) {
    super(message);
    this.name = 'RecommendationShadowScorerError';
  }
}

function parseContributions(
  encoded: string,
): RecommendationShadowFeatureContribution[] {
  try {
    const parsed = z
      .array(featureContributionSchema)
      .max(5)
      .parse(JSON.parse(encoded) as unknown);
    return parsed.map((entry) => ({
      feature: entry.feature,
      reasonCode: entry.reason_code,
      contribution: entry.contribution,
    }));
  } catch {
    throw new RecommendationShadowScorerError('shadow_response_invalid');
  }
}

export function parseRecommendationShadowScoreResponse(
  value: unknown,
  expectedActionIds: readonly string[],
  expectedFeatureSchema: string,
): RecommendationShadowScore[] {
  let parsed: z.infer<typeof responseSchema>;
  try {
    parsed = responseSchema.parse(value);
  } catch {
    throw new RecommendationShadowScorerError('shadow_response_invalid');
  }
  const actualActionIds = parsed.predictions
    .map((prediction) => prediction.action_id)
    .sort();
  const requiredActionIds = [...expectedActionIds].sort();
  if (
    new Set(actualActionIds).size !== actualActionIds.length ||
    actualActionIds.length !== requiredActionIds.length ||
    actualActionIds.some(
      (actionId, index) => actionId !== requiredActionIds[index],
    )
  ) {
    throw new RecommendationShadowScorerError(
      'shadow_response_invalid',
      'shadow_response_action_ids_mismatch',
    );
  }
  if (
    parsed.predictions.some(
      (prediction) => prediction.feature_schema !== expectedFeatureSchema,
    ) ||
    new Set(
      parsed.predictions.map((prediction) => prediction.model_artifact_id),
    ).size !== 1 ||
    new Set(parsed.predictions.map((prediction) => prediction.calibration_id))
      .size !== 1
  ) {
    throw new RecommendationShadowScorerError('shadow_response_invalid');
  }
  return parsed.predictions.map((prediction): RecommendationShadowScore => ({
    actionId: prediction.action_id,
    calibratedProbability: prediction.calibrated_probability,
    expectedValueScore: prediction.expected_value_score,
    modelArtifactId: prediction.model_artifact_id,
    calibrationId: prediction.calibration_id,
    featureSchema: prediction.feature_schema,
    featureContributions: parseContributions(prediction.feature_contributions),
  }));
}

export class HttpRecommendationShadowScorer implements RecommendationShadowScorer {
  readonly modelRevision: string;
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;

  constructor(input: {
    baseUrl: string;
    modelRevision: string;
    fetchImpl?: typeof fetch;
  }) {
    const baseUrl = new URL(input.baseUrl);
    baseUrl.pathname = `${baseUrl.pathname.replace(/\/+$/u, '')}/invocations`;
    this.endpoint = baseUrl.toString();
    this.modelRevision = nonBlankStringSchema.parse(input.modelRevision);
    this.fetchImpl = input.fetchImpl ?? fetch;
  }

  async score(
    request: RecommendationShadowScoreRequest,
  ): Promise<RecommendationShadowScoreResult> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dataframe_records: request.rows }),
      });
    } catch {
      throw new RecommendationShadowScorerError('shadow_http_error');
    }
    if (!response.ok) {
      throw new RecommendationShadowScorerError('shadow_http_error');
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new RecommendationShadowScorerError('shadow_response_invalid');
    }
    return {
      modelRevision: this.modelRevision,
      scores: parseRecommendationShadowScoreResponse(
        payload,
        request.rows.map((row) => row.action_id),
        request.featureSchema,
      ),
    };
  }
}
