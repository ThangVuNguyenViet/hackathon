import rawMenuItems from '../../../fixtures/generated/menu-items.json' with { type: 'json' };
import rawMenuModifiers from '../../../fixtures/generated/menu-modifiers.json' with { type: 'json' };
import rawStoreAvailability from '../../../fixtures/generated/store-availability.json' with { type: 'json' };
import rawStores from '../../../fixtures/generated/stores.json' with { type: 'json' };
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

const hasOwn = (value: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

export function assertNoUnknownCommerceProperties(
  raw: unknown,
  parsed: unknown,
  path = '$',
): void {
  if (Array.isArray(raw)) {
    if (!Array.isArray(parsed)) {
      throw new Error(`Parsed commerce fixture array missing at ${path}`);
    }
    raw.forEach((entry, index) => {
      assertNoUnknownCommerceProperties(
        entry,
        parsed[index],
        `${path}[${index}]`,
      );
    });
    return;
  }

  if (typeof raw !== 'object' || raw === null) return;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Parsed commerce fixture object missing at ${path}`);
  }

  for (const [key, value] of Object.entries(raw)) {
    if (!hasOwn(parsed, key)) {
      throw new Error(`Unknown commerce fixture property at ${path}.${key}`);
    }
    assertNoUnknownCommerceProperties(
      value,
      (parsed as Record<string, unknown>)[key],
      `${path}.${key}`,
    );
  }
}

export class BundledCommerceFactsRepository implements CommerceFactsRepository {
  load(): CommerceFactsSnapshot {
    const fixtures = loadBundledGeneratedFixtures();
    assertNoUnknownCommerceProperties(rawMenuItems, fixtures.menuItems);
    assertNoUnknownCommerceProperties(rawMenuModifiers, fixtures.menuModifiers);
    assertNoUnknownCommerceProperties(rawStores, fixtures.stores);
    assertNoUnknownCommerceProperties(
      rawStoreAvailability,
      fixtures.storeAvailability,
    );
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
