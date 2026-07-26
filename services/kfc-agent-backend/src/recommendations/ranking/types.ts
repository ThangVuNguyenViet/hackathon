import type { CustomerReasonCode, Placement } from '../domain/contracts.js';
import type {
  EligibilityDecision,
  PotentialRecommendationCandidate,
  RecommendationDecisionContext,
} from '../eligibility/types.js';
import type { RankingStatisticsSnapshot } from '../snapshots/types.js';

export interface RankerInput {
  context: RecommendationDecisionContext;
  candidates: readonly PotentialRecommendationCandidate[];
  eligibilityDecisions: readonly EligibilityDecision[];
  rankingStatistics: RankingStatisticsSnapshot;
}

export interface RankedCandidate {
  candidate: PotentialRecommendationCandidate;
  score: number;
  reasonCodes: CustomerReasonCode[];
  featureSummary: Record<string, number | string | boolean | null>;
}

export interface PlacementRanker {
  version: string;
  rank(input: RankerInput): RankedCandidate[];
}

export interface PlacementRankerRepository {
  forPlacement(placement: Placement): PlacementRanker;
}
