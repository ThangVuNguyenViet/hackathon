import type { SanityClient } from '@sanity/client';
import { digestCommerceAction } from '../../ordering/commerceDigest.js';
import {
  merchandisingPolicySnapshotSchema,
  recommendationPolicySchema,
} from './policy.js';
import type { MerchandisingPolicyRepository } from './repository.js';

const publishedPoliciesQuery = `*[_type == "recommendationPolicy"]{
  schemaVersion, policyId, name, description, campaignId, authoredReason,
  enabled, priority, placement, action, targetIds, environment,
  includedStoreIds, excludedStoreIds, fulfilmentModes,
  minimumBasketSubtotalVnd, maximumBasketSubtotalVnd,
  requiredCartProductIds, excludedCartProductIds,
  requiredCartCategoryIds, excludedCartCategoryIds, verifiedCohorts,
  startsAt, endsAt, reasonCode, approvedText, boostWeight, pinPosition,
  _id, _rev
}`;

export class SanityMerchandisingPolicyRepository implements MerchandisingPolicyRepository {
  constructor(
    private readonly client: SanityClient,
    private readonly snapshotId: string,
    private readonly sourceRevision: string,
    private readonly publishedAt: string,
  ) {}

  async loadPublishedSnapshot() {
    const documents = await this.client.fetch<unknown[]>(
      publishedPoliciesQuery,
      {},
      { perspective: 'published' },
    );
    const parsed = documents.map((document) => {
      if (
        typeof document !== 'object' ||
        document === null ||
        Array.isArray(document)
      ) {
        throw new Error('Sanity policy document must be an object');
      }
      const { _id, _rev, ...policy } = document as Record<string, unknown>;
      if (typeof _id !== 'string' || typeof _rev !== 'string') {
        throw new Error('Sanity policy document must include _id and _rev');
      }
      return {
        policy: recommendationPolicySchema.parse(policy),
        revision: _rev,
      };
    });
    const policies = [...parsed].sort((left, right) =>
      left.policy.policyId.localeCompare(right.policy.policyId),
    );
    const commerceEnvironment = policies[0]?.policy.environment;
    if (!commerceEnvironment) {
      throw new Error('A published policy snapshot requires an environment');
    }
    const snapshot = merchandisingPolicySnapshotSchema.parse({
      schemaVersion: 'kfc-recommendation-policy-snapshot-v1',
      snapshotId: this.snapshotId,
      sourceRevision: this.sourceRevision,
      publishedAt: this.publishedAt,
      complete: true,
      commerceEnvironment,
      policies: policies.map((entry) => entry.policy),
    });
    return {
      snapshot,
      binding: {
        snapshotId: snapshot.snapshotId,
        digest: await digestCommerceAction(snapshot),
        contributingRevisions: policies.map((entry) => entry.revision),
      },
    };
  }
}
