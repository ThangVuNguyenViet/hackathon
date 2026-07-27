import type { SanityClient } from '@sanity/client';
import { digestCommerceAction } from '../../ordering/commerceDigest.js';
import { compareCanonicalUtcInstants } from '../domain/canonical-instant.js';
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
  _id, _rev, _updatedAt
}`;

export class SanityMerchandisingPolicyRepository implements MerchandisingPolicyRepository {
  constructor(private readonly client: SanityClient) {}

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
      const { _id, _rev, _updatedAt, ...policy } = document as Record<
        string,
        unknown
      >;
      if (
        typeof _id !== 'string' ||
        typeof _rev !== 'string' ||
        typeof _updatedAt !== 'string'
      ) {
        throw new Error(
          'Sanity policy document must include _id, _rev, and _updatedAt',
        );
      }
      if (_id !== `recommendationPolicy.${String(policy.policyId ?? '')}`) {
        throw new Error('Sanity policy document ID must match policyId');
      }
      return {
        policy: recommendationPolicySchema.parse(policy),
        revision: _rev,
        updatedAt: _updatedAt,
      };
    });
    const policies = [...parsed].sort((left, right) =>
      left.policy.policyId.localeCompare(right.policy.policyId),
    );
    const commerceEnvironment = policies[0]?.policy.environment;
    if (!commerceEnvironment) {
      throw new Error('A published policy snapshot requires an environment');
    }
    const revisionDigest = await digestCommerceAction(
      policies.map(({ policy, revision }) => ({
        policyId: policy.policyId,
        revision,
      })),
    );
    const publishedAt = policies.reduce((latest, entry) => {
      const comparison = compareCanonicalUtcInstants(entry.updatedAt, latest);
      if (comparison === null) {
        throw new Error('Sanity policy _updatedAt must be canonical UTC');
      }
      return comparison > 0 ? entry.updatedAt : latest;
    }, policies[0]!.updatedAt);
    const snapshot = merchandisingPolicySnapshotSchema.parse({
      schemaVersion: 'kfc-recommendation-policy-snapshot-v1',
      snapshotId: `sanity-policy-snapshot:${revisionDigest.slice(0, 24)}`,
      sourceRevision: `sanity-revisions:${revisionDigest}`,
      publishedAt,
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
