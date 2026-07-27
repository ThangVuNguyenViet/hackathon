import type { RecommendationDecisionResponse } from '../domain/contracts.js';
import type {
  EligibilityDecision,
  PotentialRecommendationCandidate,
  RecommendationDecisionContext,
} from '../eligibility/types.js';
import type { MerchandisingResolution } from '../merchandising/resolve-policies.js';
import type { MerchandisingPolicyRepository } from '../merchandising/repository.js';
import type {
  PlacementRankerRepository,
  RankedCandidate,
} from '../ranking/types.js';
import type {
  CommerceFactsRepository,
  PromotionFactsRepository,
  RankingStatisticsRepository,
} from '../snapshots/repositories.js';
import type {
  RecommendationOutputMode,
  RecommendationShadowComparison,
  RecommendationShadowScorer,
} from '../shadow/contracts.js';

export type RecommendationDecisionEmptyReason =
  | null
  | 'no_eligible_candidates'
  | 'placement_already_attempted'
  | 'placement_not_yet_eligible'
  | 'verified_history_required'
  | 'parent_cart_line_required'
  | 'no_positive_price_modifier'
  | 'merchandising_suppressed'
  | 'invalid_context';

export interface RecommendationDecisionTechnicalEvidence {
  potentialCandidates: PotentialRecommendationCandidate[];
  eligibilityDecisions: EligibilityDecision[];
  eligiblePrePolicyRanking: RankedCandidate[];
  merchandisingResolution: MerchandisingResolution;
  emptyReason: RecommendationDecisionEmptyReason;
  shadowComparison: RecommendationShadowComparison;
}

export interface RecommendationDecisionResult {
  response: RecommendationDecisionResponse;
  technical: RecommendationDecisionTechnicalEvidence;
}

export interface RecommendationDecisionEngine {
  decide(
    context: RecommendationDecisionContext,
  ): Promise<RecommendationDecisionResult>;
}

export interface RecommendationDecisionEngineDependencies {
  commerceFactsRepository: CommerceFactsRepository;
  rankingStatisticsRepository: RankingStatisticsRepository;
  promotionFactsRepository: PromotionFactsRepository;
  rankerRepository: PlacementRankerRepository;
  merchandisingPolicyRepository: MerchandisingPolicyRepository;
  shadowScorer?: RecommendationShadowScorer;
  shadowOutputMode?: RecommendationOutputMode;
}
