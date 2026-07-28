import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const provenancePath = resolve(
  repoRoot,
  'docs/wayfinder/kfc-product-recommendation-poc/implementation-provenance.json',
);

describe('recommendation implementation provenance', () => {
  it('binds the implementation to the accepted fixtures and qualification results', async () => {
    const provenance = JSON.parse(await readFile(provenancePath, 'utf8'));

    expect(provenance.schemaVersion).toBe(
      'kfc-recommendation-provenance-v1',
    );
    expect(provenance.specificationCommit).toBe(
      'b9b193549a29374bb258f543a0661d2626c82bd9',
    );
    expect(provenance.implementationBaseCommit).toBe(
      '4246c6b2635a8f03931a7f275407ecc4a4d2ef1b',
    );
    expect(provenance.simulatorSourceCommit).toBe(
      '58cef2d1e9cece6075e1035158eb2674e530f9b7',
    );
    expect(provenance.fixtures).toEqual({
      'services/kfc-agent-backend/fixtures/generated/menu-items.json':
        'e4fac7cc554d0cc06fa3d2efa8130f3f459d6b0883452f6418077202af81fcee',
      'services/kfc-agent-backend/fixtures/generated/menu-modifiers.json':
        '171d267b2d15a765274c2e4ebbe167c1e6d1e69d0dffce1c265f2d3f8b7041a6',
      'services/kfc-agent-backend/fixtures/generated/stores.json':
        '5f0d28bc5421e2662d447239273dda99213e4969862a55faaf090e975654fecc',
      'services/kfc-agent-backend/fixtures/generated/store-availability.json':
        '66e63a9bccc3362541f7397497beb3e4fcb4a71d466f60b77508de8dccf9df96',
      'services/kfc-agent-backend/fixtures/generated/promotions.json':
        'ee6785b626ccb6a6e64144a4c6c3b25dede01aa90f9adc4dfb7e76c23b272335',
      'services/kfc-recommendation-simulator/worlds/sanity-policies.json':
        '6a255b23ee012d9a2fdc25c3c90c819d2a6357373b5393082551feccba8e5489',
    });
    expect(provenance.qualifications.smartCrossSell).toEqual({
      contentDigest:
        'e76c7641d48a9f47f0da084ca77f30ceb8df6c31c2ebee65eef15d52c80cda80',
      featureSchema: 'smart-cross-sell-feature-schema-v1',
      selectedRanker: 'blend',
      promotionDecision: 'retain_baseline',
    });
    expect(provenance.qualifications.modifierUpsell).toEqual({
      contentDigest:
        '75f1d02a4e230e901eb222b26268b255f46842483ad77f04e2192ea74d81de26',
      featureSchema: 'modifier-upsell-feature-schema-v1',
      selectedRanker: 'incremental_value',
      promotionDecision: 'retain_baseline',
    });
    expect(provenance.runtime).toEqual({
      profile: 'local_docker_cloudflare_tunnel',
      availability: 'operator_managed_demo',
      requiresLocalProcesses: true,
      servedModelRevision:
        '10da1b47f6d744e0b1f118950a77de9811c90ab44a2b876f6a62e7cce56e537a',
      artifactAuthority: {
        repositoryId:
          'thangvu132/kfc-vietnam-recommendation-shadow-20260727',
        revision: '129754a17b513b93efb3071ca4af9f42bb2a2f9c',
        publicationDigest:
          '605d6ac494154e9d316985aa72c56de51f10679826f5878ba5115fe1fbd5dfc6',
      },
      sanity: {
        projectId: '09hoxft9',
        dataset: 'production',
        snapshotDigest:
          '87c4f52022e3090119d7261eff13c5afd3cd763a7366428bb74eb4479514fcb2',
      },
    });

    for (const [relativePath, expectedDigest] of Object.entries(
      provenance.fixtures as Record<string, string>,
    )) {
      const bytes = await readFile(resolve(repoRoot, relativePath));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(
        expectedDigest,
      );
    }
  });
});
