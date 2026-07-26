import type {
  GeneratedMenuItem,
  GeneratedMenuModifier,
  GeneratedStore,
  GeneratedStoreAvailability,
} from '../../fixtures/schema.js';
import type { z } from 'zod';
import type {
  promotionFactsSnapshotSchema,
  rankingStatisticsSnapshotSchema,
} from './schemas.js';

export interface CommerceFactsSnapshot {
  readonly menuItems: readonly GeneratedMenuItem[];
  readonly menuModifiers: readonly GeneratedMenuModifier[];
  readonly stores: readonly GeneratedStore[];
  readonly storeAvailability: readonly GeneratedStoreAvailability[];
}

export type RankingStatisticsSnapshot = z.infer<
  typeof rankingStatisticsSnapshotSchema
>;
export type PromotionFactsSnapshot = z.infer<
  typeof promotionFactsSnapshotSchema
>;
