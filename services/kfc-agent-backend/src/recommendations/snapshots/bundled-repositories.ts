import promotionSnapshot from '../../../fixtures/recommendations/promotion-snapshot-v1.json' with { type: 'json' };
import rankingStatistics from '../../../fixtures/recommendations/ranking-statistics-v1.json' with { type: 'json' };
import { loadBundledGeneratedFixtures } from '../../fixtures/bundledFixtures.js';
import {
  promotionFactsSnapshotSchema,
  rankingStatisticsSnapshotSchema,
} from './schemas.js';
import type {
  CommerceFactsRepository,
  PromotionFactsRepository,
  RankingStatisticsRepository,
} from './repositories.js';
import type {
  CommerceFactsSnapshot,
  PromotionFactsSnapshot,
  RankingStatisticsSnapshot,
} from './types.js';

export class BundledCommerceFactsRepository implements CommerceFactsRepository {
  load(): CommerceFactsSnapshot {
    const fixtures = loadBundledGeneratedFixtures();
    return {
      menuItems: fixtures.menuItems,
      menuModifiers: fixtures.menuModifiers,
      stores: fixtures.stores,
      storeAvailability: fixtures.storeAvailability,
    };
  }
}

export class BundledRankingStatisticsRepository implements RankingStatisticsRepository {
  load(): RankingStatisticsSnapshot {
    return rankingStatisticsSnapshotSchema.parse(rankingStatistics);
  }
}

export class BundledPromotionFactsRepository implements PromotionFactsRepository {
  load(): PromotionFactsSnapshot {
    return promotionFactsSnapshotSchema.parse(promotionSnapshot);
  }
}
