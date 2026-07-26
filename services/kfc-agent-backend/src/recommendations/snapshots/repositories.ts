import type {
  CommerceFactsSnapshot,
  PromotionFactsSnapshot,
  RankingStatisticsSnapshot,
} from './types.js';

export interface CommerceFactsRepository {
  load(): CommerceFactsSnapshot;
}

export interface RankingStatisticsRepository {
  load(): RankingStatisticsSnapshot;
}

export interface PromotionFactsRepository {
  load(): PromotionFactsSnapshot;
}
