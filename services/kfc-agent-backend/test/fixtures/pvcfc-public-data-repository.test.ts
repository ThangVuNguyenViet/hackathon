import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  createPvcfcPublicDataProvider,
  loadBundledPvcfcPublicDataProvider,
} from '../../src/businesses/pvcfc/public-data/bundledPvcfcPublicDataProvider.js';
import { parsePvcfcPublicDataBundle } from '../../src/businesses/pvcfc/public-data/pvcfcPublicDataBundle.js';

const mutableBundleSchema = z.object({ revision: z.string() }).passthrough();

async function readBundledData(): Promise<z.infer<typeof mutableBundleSchema>> {
  return mutableBundleSchema.parse(
    JSON.parse(
      await readFile(
        join(process.cwd(), 'fixtures/generated/pvcfc-public-data.json'),
        'utf8',
      ),
    ),
  );
}

describe('PVCFC public-data provider contract', () => {
  it('lists fixture-declared collections and their metadata without code-owned enums', async () => {
    const provider = loadBundledPvcfcPublicDataProvider();
    const result = await provider.listCollections({ limit: 20 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.capturedAt).toBe('2026-08-11');
    expect(result.value.organization.name).toBe(
      'Petrovietnam Ca Mau Fertilizer Corporation (PVCFC)',
    );
    expect(
      Object.fromEntries(
        result.value.collections.map((collection) => [
          collection.name,
          { access: collection.access, count: collection.count },
        ]),
      ),
    ).toEqual({
      agronomy_guidance: { access: 'searchable', count: 20 },
      certificates_documents: { access: 'searchable', count: 249 },
      corporate_facilities: { access: 'searchable', count: 7 },
      dealers_contacts: { access: 'searchable', count: 18 },
      news_media: { access: 'searchable', count: 14 },
      prices: { access: 'searchable', count: 8 },
      products: { access: 'searchable', count: 67 },
      promotions: { access: 'searchable', count: 11 },
      public_reports: { access: 'searchable', count: 3 },
      services: { access: 'searchable', count: 6 },
      source_inventory: { access: 'discovery_only', count: 79 },
      urban_agriculture: { access: 'searchable', count: 15 },
    });
  });

  it('enumerates and exactly retrieves every record, including discovery-only records, through bounded pages', async () => {
    const provider = loadBundledPvcfcPublicDataProvider();
    const fixture = parsePvcfcPublicDataBundle(await readBundledData());
    const fixtureRecords = new Map<string, unknown>(
      fixture.collections.flatMap((collection) =>
        collection.records.map(
          (record) => [`${collection.name}\0${record.id}`, record] as const,
        ),
      ),
    );
    const listedCollections = await provider.listCollections({ limit: 20 });
    expect(listedCollections.ok).toBe(true);
    if (!listedCollections.ok) return;

    const locators = new Set<string>();
    const counts = new Map<string, number>();
    for (const collection of listedCollections.value.collections) {
      let cursor: string | undefined;
      do {
        const page = await provider.listRecords({
          collection: collection.name,
          limit: 7,
          cursor,
        });
        expect(page.ok, collection.name).toBe(true);
        if (!page.ok) break;
        expect(page.value.records.length).toBeGreaterThan(0);
        expect(page.value.records.length).toBeLessThanOrEqual(7);
        for (const locator of page.value.records) {
          expect(locator.collection).toBe(collection.name);
          expect(locator.id.length).toBeGreaterThan(0);
          expect(locator.title.length).toBeGreaterThan(0);
          const key = `${locator.collection}\0${locator.id}`;
          locators.add(key);
          counts.set(
            locator.collection,
            (counts.get(locator.collection) ?? 0) + 1,
          );
          const detail = await provider.getRecord({
            collection: locator.collection,
            id: locator.id,
          });
          expect(detail.ok, key).toBe(true);
          if (!detail.ok) continue;
          expect(detail.value.collection).toBe(locator.collection);
          expect(detail.value.record, key).toEqual(fixtureRecords.get(key));
        }
        cursor = page.value.nextCursor;
      } while (cursor !== undefined);

      expect(counts.get(collection.name)).toBe(collection.count);
    }

    expect(locators).toHaveLength(497);
    expect(locators).toEqual(new Set(fixtureRecords.keys()));
    expect(counts.get('source_inventory')).toBe(79);
  });

  it('binds record-listing cursors to collection requests and data revisions', async () => {
    const data = await readBundledData();
    const provider = createPvcfcPublicDataProvider(() => data);
    const request = {
      collection: 'source_inventory',
      limit: 2,
    } as const;
    const [first, repeated] = await Promise.all([
      provider.listRecords(request),
      provider.listRecords(request),
    ]);
    expect(first).toEqual(repeated);
    expect(first.ok).toBe(true);
    if (!first.ok || first.value.nextCursor === undefined) return;

    await expect(
      provider.listRecords({
        collection: 'products',
        limit: 2,
        cursor: first.value.nextCursor,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid_request' },
    });

    const evolvedData = structuredClone(data);
    evolvedData.revision = 'e'.repeat(64);
    const evolved = createPvcfcPublicDataProvider(() => evolvedData);
    await expect(
      evolved.listRecords({
        ...request,
        cursor: first.value.nextCursor,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'cursor_stale' },
    });
  });

  it('returns compact bounded search pages with deterministic opaque cursors', async () => {
    const provider = loadBundledPvcfcPublicDataProvider();
    const request = { query: 'cà mau', limit: 2 } as const;
    const [first, repeated] = await Promise.all([
      provider.searchRecords(request),
      provider.searchRecords(request),
    ]);

    expect(first).toEqual(repeated);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.hits).toHaveLength(2);
    expect(first.value.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/);
    for (const hit of first.value.hits) {
      expect(Object.keys(hit).sort()).toEqual(
        ['collection', 'id', 'sourceUrl', 'summary', 'title'].sort(),
      );
      expect(hit.summary.length).toBeLessThanOrEqual(240);
      expect('record' in hit).toBe(false);
      expect('originRefs' in hit).toBe(false);
    }

    const next = await provider.searchRecords({
      ...request,
      cursor: first.value.nextCursor,
    });
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    expect(next.value.hits).toHaveLength(2);
    expect(
      next.value.hits.some((hit) =>
        first.value.hits.some(
          (firstHit) =>
            firstHit.collection === hit.collection && firstHit.id === hit.id,
        ),
      ),
    ).toBe(false);

    const bounded = await provider.searchRecords({
      query: 'cà mau',
      limit: 999,
    });
    expect(bounded.ok).toBe(true);
    if (bounded.ok) expect(bounded.value.hits.length).toBeLessThanOrEqual(20);
  });

  it('keeps discovery-only inventory out of search while allowing exact retrieval', async () => {
    const provider = loadBundledPvcfcPublicDataProvider();
    const search = await provider.searchRecords({
      query: 'PVCFC corporate website',
      collections: ['source_inventory'],
    });
    expect(search).toEqual({
      ok: false,
      error: {
        code: 'no_match',
        message: 'No public-data records matched the request.',
      },
    });

    const result = await provider.getRecord({
      collection: 'source_inventory',
      id: 'pvcfc-main-website',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.record).toMatchObject({
      id: 'pvcfc-main-website',
      name: 'PVCFC corporate website',
      sourceType: 'official_website',
      originRefs: [expect.stringMatching(/^[a-f0-9]{64}#pvcfc-main-website$/)],
    });
    expect(result.value.record.scope).toContain('Primary Vietnamese corporate');
  });

  it('returns typed invalid-request and no-match outcomes', async () => {
    const provider = loadBundledPvcfcPublicDataProvider();

    await expect(
      provider.searchRecords({ query: '   ' }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid_request' },
    });
    await expect(
      provider.getRecord({ collection: 'products', id: 'missing-product' }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'no_match' } });
    await expect(
      provider.getRecord({ collection: 'not-a-collection', id: 'anything' }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid_request' },
    });
  });

  it('distinguishes unavailable sources, invalid provider data, and stale cursors', async () => {
    const unavailable = createPvcfcPublicDataProvider(() => {
      throw new Error('storage offline');
    });
    await expect(unavailable.listCollections()).resolves.toMatchObject({
      ok: false,
      error: { code: 'provider_unavailable' },
    });

    const invalid = createPvcfcPublicDataProvider(() => ({ collections: [] }));
    await expect(invalid.listCollections()).resolves.toMatchObject({
      ok: false,
      error: { code: 'provider_invalid' },
    });

    const originalData = await readBundledData();
    const original = createPvcfcPublicDataProvider(() => originalData);
    const first = await original.searchRecords({ query: 'ure', limit: 1 });
    expect(first.ok).toBe(true);
    if (!first.ok || first.value.nextCursor === undefined) return;

    const evolvedData = structuredClone(originalData);
    evolvedData.revision = 'f'.repeat(64);
    const evolved = createPvcfcPublicDataProvider(() => evolvedData);
    await expect(
      evolved.searchRecords({
        query: 'ure',
        limit: 1,
        cursor: first.value.nextCursor,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'cursor_stale' },
    });
  });
});
