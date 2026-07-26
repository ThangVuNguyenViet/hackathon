import { LocalMerchandisingPolicyRepository } from '../merchandising/local-policy-repository.js';
import { RankerRepository } from '../ranking/ranker-repository.js';
import {
  BundledCommerceFactsRepository,
  BundledPromotionFactsRepository,
  BundledRankingStatisticsRepository,
} from '../snapshots/bundled-repositories.js';
import { PureRecommendationDecisionEngine } from './decision-engine.js';
import type {
  RecommendationDecisionEngine,
  RecommendationDecisionEngineDependencies,
} from './types.js';

export function createRecommendationDecisionEngine(
  dependencies: RecommendationDecisionEngineDependencies,
): RecommendationDecisionEngine {
  return new PureRecommendationDecisionEngine(dependencies);
}

export function createBundledRecommendationDecisionEngine(): RecommendationDecisionEngine {
  return createRecommendationDecisionEngine({
    commerceFactsRepository: new BundledCommerceFactsRepository(),
    rankingStatisticsRepository: new BundledRankingStatisticsRepository(),
    promotionFactsRepository: new BundledPromotionFactsRepository(),
    rankerRepository: new RankerRepository(),
    merchandisingPolicyRepository: new LocalMerchandisingPolicyRepository(),
  });
}
