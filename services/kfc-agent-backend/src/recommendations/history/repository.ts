import type { RecommendationDemoCustomerHistoryRecord } from '../persistence/types.js';

/**
 * Application-facing history port. The current POC adapter exposes only
 * explicitly mock/synthetic fixture records, never production identity data.
 */
export interface CustomerHistoryRepository {
  load(
    verifiedCustomerRef: string,
  ): Promise<RecommendationDemoCustomerHistoryRecord | null>;
}
