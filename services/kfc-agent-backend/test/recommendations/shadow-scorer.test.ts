import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HttpRecommendationShadowScorer,
  parseRecommendationShadowScoreResponse,
} from '../../src/recommendations/shadow/http-shadow-scorer.js';
import type { RecommendationShadowFeatureRow } from '../../src/recommendations/shadow/contracts.js';

const smartRow = (
  actionId: string,
  priceDeltaVnd: number,
): RecommendationShadowFeatureRow => ({
  placement: 'smart_cross_sell',
  feature_schema: 'smart-cross-sell-feature-schema-v1',
  eligible: true,
  action_id: actionId,
  candidate_id: actionId,
  category: 'side',
  product_code: actionId.replace('product:', ''),
  feature_cart_anchor: '20751',
  feature_store_id: 'KFCVN0002',
  feature_mission: '__missing__',
  feature_time_window: '2026-07',
  feature_price_delta_vnd: priceDeltaVnd,
  feature_discount_vnd: 0,
  feature_discount_ratio: 0,
  feature_basket_association_score: 0,
  feature_party_size: 0,
  feature_budget_vnd: 99_000,
  feature_cart_subtotal_vnd: 99_000,
  feature_customer_order_count: 0,
  feature_customer_item_order_count: 0,
  feature_customer_category_order_count: 0,
  feature_store_item_order_count: 12,
  feature_global_item_order_count: 45,
  feature_store_local_hour: 16,
  feature_store_local_day_of_week: 0,
});

describe('HTTP recommendation shadow scorer', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends only the MLflow signature rows and parses exact artifact provenance', async () => {
    const rows = [
      smartRow('product:41127', 50_000),
      smartRow('product:41172', 35_000),
    ];
    let invocation: { url: string; init?: RequestInit } | undefined;
    const scorer = new HttpRecommendationShadowScorer({
      baseUrl: 'https://shadow.example/models/kfc/',
      modelRevision: 'hf-revision-0123456789abcdef',
      fetchImpl: async (input, init) => {
        invocation = { url: String(input), init };
        return new Response(
          JSON.stringify({
            predictions: rows.map((row, index) => ({
              action_id: row.action_id,
              model_revision: 'hf-revision-0123456789abcdef',
              calibrated_probability: index === 0 ? 0.2 : 0.8,
              expected_value_score: index === 0 ? 10_000 : 28_000,
              model_artifact_id: 'smart_cross_sell-lightgbm-873cafdc6a6a0a9f',
              calibration_id:
                'smart_cross_sell-isotonic-calibration-9c9c55e026c5a193',
              feature_schema: 'smart-cross-sell-feature-schema-v1',
              feature_contributions: JSON.stringify([
                {
                  feature: 'feature_store_item_order_count',
                  reason_code: 'popular_at_store',
                  contribution: 0.125,
                },
              ]),
            })),
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
    });

    const result = await scorer.score({
      placement: 'smart_cross_sell',
      featureSchema: 'smart-cross-sell-feature-schema-v1',
      rows,
    });

    expect(invocation?.url).toBe(
      'https://shadow.example/models/kfc/invocations',
    );
    expect(invocation?.init).toMatchObject({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    expect(JSON.parse(String(invocation?.init?.body))).toEqual({
      dataframe_records: rows,
    });
    expect(result).toEqual({
      modelRevision: 'hf-revision-0123456789abcdef',
      scores: [
        expect.objectContaining({
          actionId: 'product:41127',
          calibratedProbability: 0.2,
          expectedValueScore: 10_000,
          modelArtifactId: 'smart_cross_sell-lightgbm-873cafdc6a6a0a9f',
          calibrationId:
            'smart_cross_sell-isotonic-calibration-9c9c55e026c5a193',
          featureSchema: 'smart-cross-sell-feature-schema-v1',
          featureContributions: [
            {
              feature: 'feature_store_item_order_count',
              reasonCode: 'popular_at_store',
              contribution: 0.125,
            },
          ],
        }),
        expect.objectContaining({
          actionId: 'product:41172',
          calibratedProbability: 0.8,
          expectedValueScore: 28_000,
        }),
      ],
    });
  });

  it('rejects malformed, duplicate, missing, and foreign prediction rows', () => {
    const valid = {
      predictions: [
        {
          action_id: 'product:41127',
          model_revision: 'hf-revision-0123456789abcdef',
          calibrated_probability: 0.2,
          expected_value_score: 10_000,
          model_artifact_id: 'smart_cross_sell-lightgbm-873cafdc6a6a0a9f',
          calibration_id:
            'smart_cross_sell-isotonic-calibration-9c9c55e026c5a193',
          feature_schema: 'smart-cross-sell-feature-schema-v1',
          feature_contributions: '[]',
        },
        {
          action_id: 'product:41172',
          model_revision: 'hf-revision-0123456789abcdef',
          calibrated_probability: 0.8,
          expected_value_score: 28_000,
          model_artifact_id: 'smart_cross_sell-lightgbm-873cafdc6a6a0a9f',
          calibration_id:
            'smart_cross_sell-isotonic-calibration-9c9c55e026c5a193',
          feature_schema: 'smart-cross-sell-feature-schema-v1',
          feature_contributions: '[]',
        },
      ],
    };
    const expectedActionIds = ['product:41127', 'product:41172'];

    expect(() =>
      parseRecommendationShadowScoreResponse(
        {
          predictions: [
            valid.predictions[0],
            { ...valid.predictions[1], action_id: 'product:41127' },
          ],
        },
        expectedActionIds,
        'smart-cross-sell-feature-schema-v1',
        'hf-revision-0123456789abcdef',
      ),
    ).toThrow('shadow_response_action_ids_mismatch');
    expect(() =>
      parseRecommendationShadowScoreResponse(
        { predictions: [valid.predictions[0]] },
        expectedActionIds,
        'smart-cross-sell-feature-schema-v1',
        'hf-revision-0123456789abcdef',
      ),
    ).toThrow('shadow_response_action_ids_mismatch');
    expect(() =>
      parseRecommendationShadowScoreResponse(
        {
          predictions: [
            valid.predictions[0],
            { ...valid.predictions[1], action_id: 'product:foreign' },
          ],
        },
        expectedActionIds,
        'smart-cross-sell-feature-schema-v1',
        'hf-revision-0123456789abcdef',
      ),
    ).toThrow('shadow_response_action_ids_mismatch');
    expect(() =>
      parseRecommendationShadowScoreResponse(
        {
          predictions: [
            {
              ...valid.predictions[0],
              calibrated_probability: 1.5,
            },
            valid.predictions[1],
          ],
        },
        expectedActionIds,
        'smart-cross-sell-feature-schema-v1',
        'hf-revision-0123456789abcdef',
      ),
    ).toThrow('shadow_response_invalid');
  });

  it('rejects a served model attestation that differs from configured provenance', async () => {
    const scorer = new HttpRecommendationShadowScorer({
      baseUrl: 'https://shadow.example',
      modelRevision: 'expected-immutable-manifest-digest',
      fetchImpl: async () =>
        Response.json({
          predictions: [
            {
              action_id: 'product:41127',
              model_revision: 'stale-served-manifest-digest',
              calibrated_probability: 0.2,
              expected_value_score: 10_000,
              model_artifact_id:
                'smart_cross_sell-lightgbm-873cafdc6a6a0a9f',
              calibration_id:
                'smart_cross_sell-isotonic-calibration-9c9c55e026c5a193',
              feature_schema: 'smart-cross-sell-feature-schema-v1',
              feature_contributions: '[]',
            },
          ],
        }),
    });

    await expect(
      scorer.score({
        placement: 'smart_cross_sell',
        featureSchema: 'smart-cross-sell-feature-schema-v1',
        rows: [smartRow('product:41127', 50_000)],
      }),
    ).rejects.toMatchObject({
      code: 'shadow_response_invalid',
      message: 'shadow_model_revision_mismatch',
    });
  });

  it('terminates a never-resolving fetch at the fixed shadow deadline', async () => {
    vi.useFakeTimers();
    const scorer = new HttpRecommendationShadowScorer({
      baseUrl: 'https://shadow.example',
      modelRevision: 'expected-immutable-manifest-digest',
      deadlineMs: 25,
      fetchImpl: () => new Promise<Response>(() => {}),
    });
    const scoring = scorer.score({
      placement: 'smart_cross_sell',
      featureSchema: 'smart-cross-sell-feature-schema-v1',
      rows: [smartRow('product:41127', 50_000)],
    });
    const rejection = expect(scoring).rejects.toMatchObject({
      code: 'shadow_deadline_exceeded',
      message: 'shadow_deadline_exceeded',
    });

    await vi.advanceTimersByTimeAsync(25);

    await rejection;
  });

  it('bounds transport failures without exposing the response body', async () => {
    const scorer = new HttpRecommendationShadowScorer({
      baseUrl: 'https://shadow.example',
      modelRevision: 'hf-revision-0123456789abcdef',
      fetchImpl: async () =>
        new Response('Authorization: Bearer private-shadow-token', {
          status: 503,
        }),
    });

    await expect(
      scorer.score({
        placement: 'smart_cross_sell',
        featureSchema: 'smart-cross-sell-feature-schema-v1',
        rows: [smartRow('product:41127', 50_000)],
      }),
    ).rejects.toThrow('shadow_http_error');
    await expect(
      scorer.score({
        placement: 'smart_cross_sell',
        featureSchema: 'smart-cross-sell-feature-schema-v1',
        rows: [smartRow('product:41127', 50_000)],
      }),
    ).rejects.not.toThrow('private-shadow-token');
  });
});
