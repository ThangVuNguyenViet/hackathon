import policySnapshot from '../../../fixtures/recommendations/sanity-policy-snapshot-v1.json' with { type: 'json' };
import { digestCommerceAction } from '../../ordering/commerceDigest.js';
import { merchandisingPolicySnapshotSchema } from './policy.js';
import type { MerchandisingPolicyRepository } from './repository.js';

function sortedSnapshot(value: unknown) {
  const snapshot = merchandisingPolicySnapshotSchema.parse(value);
  return {
    ...snapshot,
    policies: [...snapshot.policies].sort((left, right) =>
      left.policyId.localeCompare(right.policyId),
    ),
  };
}

export class LocalMerchandisingPolicyRepository implements MerchandisingPolicyRepository {
  async loadPublishedSnapshot() {
    const snapshot = sortedSnapshot(policySnapshot);
    return {
      snapshot: { ...snapshot, complete: true },
      binding: {
        snapshotId: snapshot.snapshotId,
        digest: await digestCommerceAction(snapshot),
        contributingRevisions: [snapshot.sourceRevision],
      },
    };
  }
}

export { sortedSnapshot };
