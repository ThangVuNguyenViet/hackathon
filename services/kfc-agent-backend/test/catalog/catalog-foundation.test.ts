import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  fetchCatalogObservation,
  parseCatalogPayload,
  revalidateCatalogPin,
} from '../../src/catalog/catalogObservation.js';
import {
  assertVerifiedCommerceProjectionCurrent,
  createVerifiedCommerceProjection,
} from '../../src/commerce/verifiedCommerceProjection.js';
import { validateCatalogBaselineCorpus } from '../../src/fixtures/catalogBaselineCorpus.js';
import { createCatalogObservationClients } from '../../src/clients/catalogObservationClients.js';
import { loadBundledGeneratedFixtures } from '../../src/fixtures/bundledFixtures.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import { rankEligibleRecommendations, safetyRerank } from '../../src/ordering/recommendationRanking.js';

const item = (id: string, price: number) => ({
  id,
  name: `item-${id}`,
  dname: [{ lang: 'vn', value: `Món ${id}` }],
  description: [{ lang: 'vn', value: `Mô tả ${id}` }],
  imageName: [{ lang: 'vn', value: `image-${id}` }],
  price,
  categoryId: 'category-1',
  categoryName: 'Category',
  daysOfWeekAvailable: [0, 1, 2, 3, 4, 5, 6],
  isCustomize: false,
  posItemId: id,
  url: `item-${id}`,
  modgrps: [],
});

const menu = (...items: ReturnType<typeof item>[]) => ({
  id: 'kfcvn-generic-menu',
  name: 'kfcvn-generic-menu',
  categories: [{
    name: 'menu',
    products: items.map((candidate, index) => ({
      id: index + 1,
      dname: [{ lang: 'vn', value: candidate.name }],
      description: candidate.description,
      items: [candidate],
    })),
  }],
});

describe('catalog foundation', () => {
  it('refreshes expired observations before serving discovery results', async () => {
    const pinned = await fetchCatalogObservation({
      environment: 'sandbox',
      sourceUrl: 'https://catalog.example/menu',
      now: new Date('2026-07-14T00:00:00.000Z'),
      fallbackTtlSeconds: 30,
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(menu(item('old', 10))))),
    });
    const current = await fetchCatalogObservation({
      environment: 'sandbox',
      sourceUrl: 'https://catalog.example/menu',
      now: new Date('2026-07-14T00:01:00.000Z'),
      fallbackTtlSeconds: 30,
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(menu(item('new', 20))))),
    });
    const provider = createMockClients(loadBundledGeneratedFixtures());
    const fetchCurrent = vi.fn().mockResolvedValue(current);
    const clients = createCatalogObservationClients({
      sessionId: 'catalog-refresh',
      pinned,
      fetchCurrent,
      cart: provider.cart,
      oms: provider.oms,
      now: () => new Date('2026-07-14T00:01:00.000Z'),
    });

    await expect(clients.menu.searchMenu('')).resolves.toMatchObject({
      ok: true,
      value: [expect.objectContaining({ code: 'new' })],
    });
    expect(fetchCurrent).toHaveBeenCalledOnce();
  });

  it('validates every item and modifier tree in the preserved July 7 baseline', async () => {
    const repoRoot = join(process.cwd(), '../..');
    const manifest = await validateCatalogBaselineCorpus(repoRoot);
    const july7 = manifest.observations[0]!;
    const july10 = manifest.observations[1]!;
    if (july7.format !== 'generated_pair' || july10.format !== 'raw_api') throw new Error('Unexpected fixture formats');
    const items = JSON.parse(await readFile(join(repoRoot, july7.itemSourcePath), 'utf8')) as Array<{ code: string; priceVnd: number }>;
    const modifiers = JSON.parse(await readFile(join(repoRoot, july7.modifierSourcePath), 'utf8')) as Array<{
      itemCode: string;
      itemId: string;
      modifierGroups: Array<{ depth: number; options: Array<{ modifierGroups: unknown[] }> }>;
    }>;
    const currentItems = parseCatalogPayload(JSON.parse(
      await readFile(join(repoRoot, july10.sourcePath), 'utf8'),
    ) as unknown);

    expect(manifest.observations).toHaveLength(2);
    expect(items).toHaveLength(120);
    expect(modifiers).toHaveLength(58);
    expect(items.map((candidate) => candidate.code)).toEqual(
      expect.arrayContaining(['20751', '20752']),
    );
    expect(currentItems).toHaveLength(118);
    expect(currentItems.filter((candidate) => candidate.modifierGroups.length > 0)).toHaveLength(56);
    expect(currentItems.map((candidate) => candidate.itemCode)).not.toEqual(
      expect.arrayContaining(['20751', '20752']),
    );
    expect(items.find((candidate) => candidate.code === '41160')?.priceVnd).toBe(7_000);
    expect(currentItems.find((candidate) => candidate.itemCode === '41160')?.priceVnd).toBe(5_000);
    const itemCodes = new Map(items.map((candidate) => [candidate.code, candidate.code]));
    const expectDepth = (groups: Array<{ depth: number; options: Array<{ modifierGroups: unknown[] }> }>, depth: number): void => {
      for (const group of groups) {
        expect(group.depth).toBe(depth);
        for (const option of group.options) {
          expectDepth(option.modifierGroups as typeof groups, depth + 1);
        }
      }
    };
    for (const modifier of modifiers) {
      expect(modifier.itemCode).toBe(modifier.itemId);
      expect(itemCodes.has(modifier.itemCode)).toBe(true);
      expectDepth(modifier.modifierGroups, 0);
    }
  });

  it('fetches, pins, and revalidates current provider facts without fixture fallback', async () => {
    const sourceUrl = 'https://catalog.example/menu';
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify(menu(item('20702', 129_000))),
      { headers: { etag: 'catalog-v1', 'cache-control': 'max-age=60' } },
    ));
    const pinned = await fetchCatalogObservation({
      environment: 'sandbox',
      sourceUrl,
      fetchImpl,
      now: new Date('2026-07-14T00:00:00.000Z'),
    });
    const changed = await fetchCatalogObservation({
      environment: 'sandbox',
      sourceUrl,
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response(
        JSON.stringify(menu(item('20702', 135_000))),
        { headers: { etag: 'catalog-v2', 'cache-control': 'max-age=60' } },
      )),
      now: new Date('2026-07-14T00:01:00.000Z'),
    });

    expect(pinned).toMatchObject({
      id: expect.stringContaining(':catalog-v1:'),
      itemCount: 1,
      modifierTreeCount: 0,
      expiresAt: '2026-07-14T00:01:00.000Z',
    });
    expect(revalidateCatalogPin(pinned, changed, ['20702'])).toEqual({
      ok: false,
      changedItemCodes: ['20702'],
    });
    expect(fetchImpl).toHaveBeenCalledWith(sourceUrl, { headers: { accept: 'application/json' } });

    const reformatted = await fetchCatalogObservation({
      environment: 'sandbox',
      sourceUrl,
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response(
        JSON.stringify(menu(item('20702', 129_000)), null, 2),
        { headers: { etag: 'catalog-v1', 'cache-control': 'max-age=60' } },
      )),
    });
    expect(reformatted.sha256).toBe(pinned.sha256);
    expect(reformatted.providerFingerprint).toBe(pinned.providerFingerprint);
    const otherProvider = { ...pinned, providerFingerprint: 'another-provider' };
    expect(revalidateCatalogPin(pinned, otherProvider, ['20702']).ok).toBe(false);
    expect(() => parseCatalogPayload(menu())).toThrow('Empty catalog category');
    expect(() => parseCatalogPayload({ ...menu(item('1', 10)), unexpected: true })).toThrow('Unrecognized key');
    await expect(fetchCatalogObservation({
      environment: 'sandbox',
      sourceUrl,
      now: new Date('2026-07-14T00:00:00.000Z'),
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(menu(item('1', 10))))),
    })).resolves.toMatchObject({ expiresAt: '2026-07-14T00:05:00.000Z' });
    await expect(fetchCatalogObservation({
      environment: 'sandbox',
      sourceUrl,
      fallbackTtlSeconds: 3601,
      fetchImpl,
    })).rejects.toThrow('between 30 and 3600 seconds');
  });

  it('keeps projections environment-bound and recommendations deterministic and safe', async () => {
    const observation = await fetchCatalogObservation({
      environment: 'sandbox',
      sourceUrl: 'https://catalog.example/menu',
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response(
        JSON.stringify(menu(item('1', 10))),
        { headers: { etag: 'catalog-v1', 'cache-control': 'max-age=600' } },
      )),
    });
    const projection = createVerifiedCommerceProjection({
      environment: 'sandbox',
      observation,
      subjectId: 'customer-1',
      journeyId: 'journey-1',
      now: new Date('2026-07-14T00:01:00.000Z'),
      factGroups: [
        {
          key: 'cart',
          environment: 'sandbox',
          providerFingerprint: observation.providerFingerprint,
          subjectId: 'customer-1',
          journeyId: 'journey-1',
          revision: 'cart-7',
          verifiedAt: '2026-07-14T00:00:00.000Z',
          expiresAt: '2026-07-14T00:05:00.000Z',
          dependencies: [],
          value: { totalVnd: 10 },
        },
        {
          key: 'fulfillment',
          environment: 'sandbox',
          providerFingerprint: observation.providerFingerprint,
          subjectId: 'customer-1',
          journeyId: 'journey-1',
          revision: 'quote-3',
          verifiedAt: '2026-07-14T00:00:30.000Z',
          expiresAt: '2026-07-14T00:04:00.000Z',
          dependencies: [{ key: 'cart', revision: 'cart-7' }],
          value: { feeVnd: 18_000 },
        },
      ],
    });

    expect(() => assertVerifiedCommerceProjectionCurrent(projection, {
      environment: 'production',
      providerFingerprint: observation.providerFingerprint,
      subjectId: 'customer-1',
      journeyId: 'journey-1',
      catalogObservationId: observation.id,
      factRevisions: { cart: 'cart-7', fulfillment: 'quote-3' },
      now: new Date('2026-07-14T00:02:00.000Z'),
    })).toThrow('stale or environment-conflicted');
    expect(projection).toMatchObject({
      verifiedAt: '2026-07-14T00:00:30.000Z',
      expiresAt: '2026-07-14T00:04:00.000Z',
    });
    expect(rankEligibleRecommendations([
      { itemCode: 'b', eligible: true, value: 'b', score: { requestMatch: 2, partySizeFit: 0, budgetFit: 0, preferenceMatch: 0, cartDisruption: 0 } },
      { itemCode: 'a', eligible: true, value: 'a', score: { requestMatch: 2, partySizeFit: 0, budgetFit: 0, preferenceMatch: 0, cartDisruption: 0 } },
      { itemCode: 'unsafe', eligible: true, safetyBlocked: true, value: 'unsafe', score: { requestMatch: 100, partySizeFit: 0, budgetFit: 0, preferenceMatch: 0, cartDisruption: 0 } },
      { itemCode: 'ineligible', eligible: false, value: 'ineligible', score: { requestMatch: 100, partySizeFit: 0, budgetFit: 0, preferenceMatch: 0, cartDisruption: 0 } },
    ]).map((candidate) => candidate.itemCode)).toEqual(['a', 'b']);
    expect(rankEligibleRecommendations([
      { itemCode: 'd', eligible: true, value: 'd' },
      { itemCode: 'b', eligible: true, value: 'b' },
      { itemCode: 'c', eligible: true, value: 'c' },
      { itemCode: 'a', eligible: true, value: 'a' },
    ], 99).map((candidate) => candidate.itemCode)).toEqual(['a', 'b', 'c']);
    expect(safetyRerank([
      { itemCode: 'safe', eligible: true, value: 'safe' },
      { itemCode: 'blocked', eligible: true, safetyBlocked: true, value: 'blocked' },
    ]).map((candidate) => candidate.itemCode)).toEqual(['safe']);
    expect(() => createVerifiedCommerceProjection({
      environment: 'sandbox',
      observation,
      subjectId: 'customer-1',
      journeyId: 'journey-1',
      now: new Date('2026-07-14T00:01:00.000Z'),
      factGroups: [{
        key: 'cart',
        environment: 'production',
        providerFingerprint: observation.providerFingerprint,
        subjectId: 'customer-1',
        journeyId: 'journey-1',
        revision: 'cart-7',
        verifiedAt: '2026-07-14T00:00:00.000Z',
        expiresAt: '2026-07-14T00:05:00.000Z',
        dependencies: [],
        value: { totalVnd: 10 },
      }],
    })).toThrow('conflicting bindings');
    expect(() => createVerifiedCommerceProjection({
      environment: 'sandbox',
      observation: { ...observation, expiresAt: '2026-07-14T00:00:30.000Z' },
      subjectId: 'customer-1',
      journeyId: 'journey-1',
      now: new Date('2026-07-14T00:01:00.000Z'),
      factGroups: [projection.facts.cart!],
    })).toThrow('observation is expired');
    expect(() => createVerifiedCommerceProjection({
      environment: 'sandbox',
      observation,
      subjectId: 'customer-1',
      journeyId: 'journey-1',
      now: new Date('2026-07-14T00:01:00.000Z'),
      factGroups: [{
        ...projection.facts.cart!,
        verifiedAt: '2026-07-14T00:02:00.000Z',
      }],
    })).toThrow('future-dated');
    expect(() => createVerifiedCommerceProjection({
      environment: 'sandbox',
      observation,
      subjectId: 'customer-1',
      journeyId: 'journey-1',
      now: new Date('2026-07-14T00:01:00.000Z'),
      factGroups: [{
        ...projection.facts.cart!,
        verifiedAt: 'July 14, 2026',
      }],
    })).toThrow('ISO timestamp');

    const independentlyCurrent = createVerifiedCommerceProjection({
      environment: 'sandbox',
      observation,
      subjectId: 'customer-1',
      journeyId: 'journey-1',
      now: new Date('2026-07-14T00:01:00.000Z'),
      factGroups: [
        { ...projection.facts.cart!, expiresAt: '2026-07-14T00:02:00.000Z' },
        { ...projection.facts.fulfillment!, expiresAt: '2026-07-14T00:04:00.000Z' },
        {
          ...projection.facts.cart!,
          key: 'membership',
          revision: 'membership-2',
          expiresAt: '2026-07-14T00:10:00.000Z',
          dependencies: [],
        },
      ],
    });
    expect(Object.keys(assertVerifiedCommerceProjectionCurrent(independentlyCurrent, {
      environment: 'sandbox',
      providerFingerprint: observation.providerFingerprint,
      subjectId: 'customer-1',
      journeyId: 'journey-1',
      catalogObservationId: observation.id,
      factRevisions: { cart: 'cart-7', fulfillment: 'quote-3', membership: 'membership-2' },
      now: new Date('2026-07-14T00:03:00.000Z'),
    }).facts)).toEqual(['membership']);
  });
});
