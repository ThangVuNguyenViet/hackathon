import { describe, expect, it, vi } from 'vitest';
import { createCatalogDiscoveryCache, type SharedResponseCache } from '../../src/catalog/catalogDiscoveryCache.js';
import { sha256, type CatalogObservation } from '../../src/catalog/catalogObservation.js';

function observation(expiresAt = '2026-07-16T01:00:00.000Z'): Promise<CatalogObservation> {
  const sourceUrl = 'https://menu.kfc.test/catalog';
  return sha256(sourceUrl).then((providerFingerprint) => ({
    id: `production:${providerFingerprint}:v1`,
    environment: 'production',
    sourceUrl,
    providerFingerprint,
    observedAt: '2026-07-16T00:00:00.000Z',
    expiresAt,
    sha256: 'catalog-hash',
    itemCount: 0,
    modifierTreeCount: 0,
    items: [],
  }));
}

describe('catalog discovery cache', () => {
  it('shares an environment-bound catalog read while direct revalidation remains outside the cache', async () => {
    const responses = new Map<string, Response>();
    const sharedCache: SharedResponseCache = {
      match: vi.fn(async (request) => responses.get(request.url)?.clone()),
      put: vi.fn(async (request, response) => { responses.set(request.url, response.clone()); }),
    };
    const load = vi.fn(async () => observation());
    const firstInstance = createCatalogDiscoveryCache({
      sharedCache,
      now: () => Date.parse('2026-07-16T00:10:00.000Z'),
    });
    const secondInstance = createCatalogDiscoveryCache({
      sharedCache,
      now: () => Date.parse('2026-07-16T00:20:00.000Z'),
    });

    const first = await firstInstance.get({
      environment: 'production', sourceUrl: 'https://menu.kfc.test/catalog', load,
    });
    await vi.waitFor(() => expect(sharedCache.put).toHaveBeenCalledOnce());
    const second = await secondInstance.get({
      environment: 'production', sourceUrl: 'https://menu.kfc.test/catalog', load,
    });

    expect(first.id).toBe(second.id);
    expect(load).toHaveBeenCalledOnce();
    expect(sharedCache.match).toHaveBeenCalledTimes(2);
  });

  it('does not reuse an expired observation', async () => {
    const load = vi.fn()
      .mockResolvedValueOnce(await observation('2026-07-16T00:05:00.000Z'))
      .mockResolvedValueOnce(await observation('2026-07-16T01:00:00.000Z'));
    const cache = createCatalogDiscoveryCache({
      now: () => Date.parse('2026-07-16T00:10:00.000Z'),
    });

    await cache.get({ environment: 'production', sourceUrl: 'https://menu.kfc.test/catalog', load });
    await cache.get({ environment: 'production', sourceUrl: 'https://menu.kfc.test/catalog', load });

    expect(load).toHaveBeenCalledTimes(2);
  });
});
