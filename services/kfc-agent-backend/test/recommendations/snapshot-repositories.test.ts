import { describe, expect, it } from 'vitest';
import {
  BundledCommerceFactsRepository,
  BundledPromotionFactsRepository,
  BundledRankingStatisticsRepository,
} from '../../src/recommendations/snapshots/bundled-repositories.js';
import {
  promotionFactsSnapshotSchema,
  rankingStatisticsSnapshotSchema,
} from '../../src/recommendations/snapshots/schemas.js';

describe('bundled recommendation fact repositories', () => {
  it('loads the parsed generated commerce facts', () => {
    const snapshot = new BundledCommerceFactsRepository().load();

    expect(snapshot.menuItems).toHaveLength(120);
    expect(snapshot.menuModifiers).toHaveLength(58);
    expect(snapshot.stores).toHaveLength(265);
    expect(snapshot.storeAvailability).toHaveLength(265);
  });

  it('loads the versioned ranking facts with their POC provenance', () => {
    const snapshot = new BundledRankingStatisticsRepository().load();

    expect(snapshot).toMatchObject({
      schemaVersion: 'recommendation-ranking-statistics-v1',
      snapshotId: 'ranking-statistics-poc-001',
      sourceRevision: 'simulator-fixture-statistics-001',
      observedAt: '2026-07-26T00:00:00Z',
      effectiveAt: '2026-01-01T00:00:00Z',
      expiresAt: '2027-01-01T00:00:00Z',
      complete: true,
      commerceEnvironment: 'kfc-vietnam-demo',
      priorStrength: 20,
      normalization: {
        exactItemAffinity: { min: 0, max: 5 },
        categoryAffinity: { min: 0, max: 12 },
        smartPopularityLog: { mean: 4.5, standardDeviation: 1.2 },
        discountRatio: { mean: 0.05, standardDeviation: 0.1 },
      },
      provenance: {
        source: 'synthetic-simulator-fixture',
        reference: 'ranking-statistics-poc-001',
      },
    });
    expect(snapshot.productStatistics).toHaveLength(9);
    expect(snapshot.productStatistics.find((row) => row.sellableItemId === '20751'))
      .toEqual({
        sellableItemId: '20751',
        globalOrderCount: 120,
        storeOrderCounts: { KFCVN0002: 50 },
        storeDaypartOrderCounts: { 'KFCVN0002:lunch': 24 },
        storeCalendarDayTypeDaypartOrderCounts: {
          'KFCVN0002:weekday:lunch': 18,
        },
      });
  });

  it('loads the normalized promotion facts including expired POC data', () => {
    const snapshot = new BundledPromotionFactsRepository().load();

    expect(snapshot).toMatchObject({
      schemaVersion: 'recommendation-promotion-facts-v1',
      snapshotId: 'promotion-facts-poc-001',
      sourceRevision: 'normalized-promotion-fixture-001',
      observedAt: '2026-07-26T00:00:00Z',
      effectiveAt: '2026-01-01T00:00:00Z',
      expiresAt: '2027-01-01T00:00:00Z',
      complete: true,
      commerceEnvironment: 'kfc-vietnam-demo',
      provenance: {
        source: 'checked-in-normalized-poc-fixture',
        reference: 'promotion-facts-poc-001',
      },
    });
    expect(snapshot.promotions).toEqual([
      expect.objectContaining({
        promotionId: 'poc-discount-20732',
        sellableItemId: '20732',
        originalPriceVnd: 239000,
        promotionalPriceVnd: 189000,
        includedStoreIds: [],
        excludedStoreIds: [],
        fulfilmentModes: ['pickup', 'delivery'],
      }),
      expect.objectContaining({
        promotionId: 'poc-discount-20748',
        sellableItemId: '20748',
        originalPriceVnd: 404000,
        promotionalPriceVnd: 269000,
      }),
      expect.objectContaining({
        promotionId: 'poc-expired-discount-41172',
        sellableItemId: '41172',
        startsAt: '2026-01-01T00:00:00Z',
        endsAt: '2026-06-01T00:00:00Z',
        originalPriceVnd: 179000,
        promotionalPriceVnd: 159000,
      }),
    ]);
  });

  it('parses fresh snapshot values on each load', () => {
    const repository = new BundledPromotionFactsRepository();
    const first = repository.load();
    const second = repository.load();

    expect(second).not.toBe(first);
    expect(second.promotions).not.toBe(first.promotions);
  });

  it('rejects invalid snapshot periods and conflicting promotion store scopes', () => {
    const invalidRanking = structuredClone(
      new BundledRankingStatisticsRepository().load(),
    );
    invalidRanking.effectiveAt = '2027-01-01T00:00:00Z';
    invalidRanking.expiresAt = '2026-01-01T00:00:00Z';

    const invalidPromotion = structuredClone(
      new BundledPromotionFactsRepository().load(),
    ) as {
      promotions: Array<{
        excludedStoreIds: string[];
        includedStoreIds: string[];
      }>;
    };
    invalidPromotion.promotions[0].includedStoreIds = ['KFCVN0002'];
    invalidPromotion.promotions[0].excludedStoreIds = ['KFCVN0002'];

    expect(rankingStatisticsSnapshotSchema.safeParse(invalidRanking).success).toBe(
      false,
    );
    expect(promotionFactsSnapshotSchema.safeParse(invalidPromotion).success).toBe(
      false,
    );
  });
});
