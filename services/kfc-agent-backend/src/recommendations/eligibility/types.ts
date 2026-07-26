import type {
  Placement,
  RecommendationAction,
  RecommendationDecisionRequest,
} from '../domain/contracts.js';
import type {
  CommerceFactsSnapshot,
  PromotionFactsSnapshot,
} from '../snapshots/types.js';

export interface RecommendationDecisionContext {
  request: RecommendationDecisionRequest;
  storeTimezone: string;
  verifiedCohorts: string[];
  flow: {
    stage:
      | 'starter_ready'
      | 'modifier_ready'
      | 'smart_cross_sell_ready'
      | 'complete';
    attemptedPlacements: Placement[];
    previouslyShownActionIds: string[];
    rejectedActionIds: string[];
  };
  parentCartLineId: string | null;
  remainingBudgetVnd: number | null;
  verifiedDietaryEvidence: {
    evidenceId: string;
    excludedSellableItemIds: string[];
  } | null;
  customerHistory: {
    verifiedCustomerRef: string;
    completedOrders: Array<{
      orderId: string;
      completedAt: string;
      lines: Array<{
        sellableItemId: string;
        categoryId: string;
        quantity: number;
      }>;
    }>;
  } | null;
}

export interface PotentialRecommendationCandidate {
  action: RecommendationAction;
  targetId: string;
  sellableItemId: string;
  categoryId: string;
  name: string;
  imageUrl: string | null;
  basePriceVnd: number;
  activeDiscountRatio: number;
  promotionId: string | null;
  parentCartLineId: string | null;
  modifierGroupPath: string[];
}

export type EligibilityReasonCode =
  | 'eligible'
  | 'placement_already_attempted'
  | 'placement_not_yet_eligible'
  | 'verified_history_required'
  | 'zero_history_required'
  | 'parent_cart_line_required'
  | 'catalog_unavailable'
  | 'store_unavailable'
  | 'non_sellable_product'
  | 'already_in_cart'
  | 'previously_shown'
  | 'previously_rejected'
  | 'verified_dietary_exclusion'
  | 'modifier_parent_mismatch'
  | 'modifier_group_at_capacity'
  | 'no_positive_price_modifier';

export interface EligibilityDecision {
  policyVersion: 'kfc-recommendation-policy-v1';
  actionId: string;
  eligible: boolean;
  reasonCodes: EligibilityReasonCode[];
  evidenceBindings: string[];
  digest: string;
}

export interface CandidateEnumerationInput {
  context: RecommendationDecisionContext;
  commerceFacts: CommerceFactsSnapshot;
  promotionFacts: PromotionFactsSnapshot;
}

export interface EligibilityEvaluationInput {
  context: RecommendationDecisionContext;
  candidates: readonly PotentialRecommendationCandidate[];
  commerceFacts: CommerceFactsSnapshot;
}
