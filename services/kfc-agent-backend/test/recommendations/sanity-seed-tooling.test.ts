import { describe, expect, it } from 'vitest';
import policySnapshot from '../../fixtures/recommendations/sanity-policy-snapshot-v1.json' with { type: 'json' };
import {
  recommendationPolicyDocumentId,
  seedSanityRecommendationPolicies,
} from '../../scripts/seed-sanity-recommendation-policies.js';

describe('Sanity recommendation policy seed tooling', () => {
  it('atomically replaces all five fixture policies and removes obsolete policy documents', async () => {
    const operations: Array<
      | { kind: 'replace'; document: Record<string, unknown> }
      | { kind: 'delete'; documentId: string }
      | { kind: 'commit' }
    > = [];
    const transaction = {
      createOrReplace(document: Record<string, unknown>) {
        operations.push({ kind: 'replace', document });
        return this;
      },
      delete(documentId: string) {
        operations.push({ kind: 'delete', documentId });
        return this;
      },
      async commit() {
        operations.push({ kind: 'commit' });
      },
    };
    const result = await seedSanityRecommendationPolicies({
      fetch: async <T>() =>
        [
          'recommendationPolicy.obsolete',
          `recommendationPolicy.${policySnapshot.policies[0]!.policyId}`,
          'recommendationPolicy-for-you-replace-20751',
        ] as T,
      transaction: () => transaction,
    });

    expect(result).toEqual({ replaced: 5, deleted: 2 });
    expect(
      operations.filter((operation) => operation.kind === 'delete'),
    ).toEqual([
      {
        kind: 'delete',
        documentId: 'recommendationPolicy.local-favorite-boost-20732',
      },
      {
        kind: 'delete',
        documentId: 'recommendationPolicy.obsolete',
      },
    ]);
    expect(
      operations.filter((operation) => operation.kind === 'replace'),
    ).toHaveLength(5);
    expect(operations.at(-1)).toEqual({ kind: 'commit' });
    expect(
      operations
        .filter(
          (
            operation,
          ): operation is {
            kind: 'replace';
            document: Record<string, unknown>;
          } => operation.kind === 'replace',
        )
        .map((operation) => operation.document._id),
    ).toEqual([
      'recommendationPolicy-local-favorite-boost-20732',
      'recommendationPolicy-for-you-replace-20751',
      'recommendationPolicy-smart-cross-sell-exclude-20712',
      'recommendationPolicy-smart-cross-sell-suppress-kfcvn0036',
      'recommendationPolicy-modifier-pin-41091',
    ]);
    expect(
      recommendationPolicyDocumentId('local-favorite-boost-20732'),
    ).not.toContain('.');
  });
});
