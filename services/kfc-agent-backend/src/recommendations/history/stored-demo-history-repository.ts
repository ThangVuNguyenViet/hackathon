import type { RecommendationPersistence } from '../persistence/repository.js';
import type { RecommendationDemoCustomerHistoryRecord } from '../persistence/types.js';
import type { CustomerHistoryRepository } from './repository.js';

/**
 * Mock/synthetic POC adapter only. Unknown and deliberately unlinked fixture
 * references do not become customer history.
 */
export class StoredDemoCustomerHistoryRepository implements CustomerHistoryRepository {
  constructor(private readonly persistence: RecommendationPersistence) {}

  async load(
    verifiedCustomerRef: string,
  ): Promise<RecommendationDemoCustomerHistoryRecord | null> {
    const record =
      await this.persistence.getRecommendationDemoCustomerHistory(
        verifiedCustomerRef,
      );
    return record?.linked ? record : null;
  }
}
