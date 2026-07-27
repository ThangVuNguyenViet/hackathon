import type { Placement } from '../domain/contracts.js';

export type RecommendationShadowPlacement =
  'modifier_upsell' | 'smart_cross_sell';

interface RecommendationShadowControlColumns {
  placement: RecommendationShadowPlacement;
  feature_schema:
    'modifier-upsell-feature-schema-v1' | 'smart-cross-sell-feature-schema-v1';
  eligible: true;
  action_id: string;
}

interface RecommendationShadowCommonFeatures {
  candidate_id: string;
  product_code: string;
  feature_cart_anchor: string;
  feature_store_id: string;
  feature_mission: string;
  feature_time_window: string;
  feature_price_delta_vnd: number;
  feature_discount_vnd: number;
  feature_discount_ratio: number;
  feature_basket_association_score: number;
  feature_party_size: number;
  feature_budget_vnd: number;
  feature_cart_subtotal_vnd: number;
  feature_customer_order_count: number;
  feature_customer_item_order_count: number;
  feature_customer_category_order_count: number;
  feature_store_item_order_count: number;
  feature_global_item_order_count: number;
  feature_store_local_hour: number;
  feature_store_local_day_of_week: number;
}

export type SmartCrossSellShadowFeatureRow =
  RecommendationShadowControlColumns &
    RecommendationShadowCommonFeatures & {
      placement: 'smart_cross_sell';
      feature_schema: 'smart-cross-sell-feature-schema-v1';
      category: string;
    };

export type ModifierUpsellShadowFeatureRow =
  RecommendationShadowControlColumns &
    RecommendationShadowCommonFeatures & {
      placement: 'modifier_upsell';
      feature_schema: 'modifier-upsell-feature-schema-v1';
      modifier_path: string;
      feature_remaining_budget_vnd: number;
      feature_price_to_remaining_budget_ratio: number;
    };

export type RecommendationShadowFeatureRow =
  SmartCrossSellShadowFeatureRow | ModifierUpsellShadowFeatureRow;

export interface RecommendationShadowFeatureContribution {
  feature: string;
  reasonCode: string;
  contribution: number;
}

export interface RecommendationShadowScore {
  actionId: string;
  calibratedProbability: number;
  expectedValueScore: number;
  modelArtifactId: string;
  calibrationId: string;
  featureSchema: string;
  featureContributions: RecommendationShadowFeatureContribution[];
}

export interface RecommendationShadowScoreRequest {
  placement: RecommendationShadowPlacement;
  featureSchema:
    'modifier-upsell-feature-schema-v1' | 'smart-cross-sell-feature-schema-v1';
  rows: readonly RecommendationShadowFeatureRow[];
}

export interface RecommendationShadowScoreResult {
  modelRevision: string;
  scores: RecommendationShadowScore[];
}

export interface RecommendationShadowScorer {
  readonly modelRevision: string;
  score(
    request: RecommendationShadowScoreRequest,
  ): Promise<RecommendationShadowScoreResult>;
}

export type RecommendationOutputMode = 'baseline' | 'learned_technical';

export type RecommendationShadowFailureCode =
  'shadow_unavailable' | 'shadow_response_invalid';

interface RecommendationShadowComparisonBase {
  outputMode: RecommendationOutputMode;
  eligibleActionIds: string[];
  baselineOrderingActionIds: string[];
}

export type RecommendationShadowComparison =
  | (RecommendationShadowComparisonBase & {
      status: 'not_applicable' | 'not_configured';
      modelRevision: null;
      activeTechnicalOrdering: 'baseline';
    })
  | (RecommendationShadowComparisonBase & {
      status: 'failed';
      modelRevision: string;
      activeTechnicalOrdering: 'baseline';
      failureCode: RecommendationShadowFailureCode;
    })
  | (RecommendationShadowComparisonBase & {
      status: 'succeeded';
      modelRevision: string;
      activeTechnicalOrdering: 'baseline' | 'learned';
      learnedOrdering: RecommendationShadowScore[];
      provenance: {
        modelRevision: string;
        modelArtifactIds: string[];
        calibrationIds: string[];
        featureSchema: string;
      };
    });

export function isRecommendationShadowPlacement(
  placement: Placement,
): placement is RecommendationShadowPlacement {
  return placement === 'modifier_upsell' || placement === 'smart_cross_sell';
}
