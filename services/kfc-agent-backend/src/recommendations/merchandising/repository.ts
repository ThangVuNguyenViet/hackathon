import type { MerchandisingPolicySnapshot } from './policy.js';

export interface MerchandisingPolicyRepository {
  loadPublishedSnapshot(): Promise<{
    snapshot: MerchandisingPolicySnapshot;
    binding: {
      snapshotId: string;
      digest: string;
      contributingRevisions: string[];
    };
  }>;
}
