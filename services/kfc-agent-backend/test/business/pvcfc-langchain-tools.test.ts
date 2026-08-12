import { describe, expect, it, vi } from 'vitest';
import { createPvcfcTools } from '../../src/businesses/pvcfc/tools.js';
import type { PvcfcPublicDataProvider } from '../../src/businesses/pvcfc/public-data/pvcfcPublicDataProvider.js';

function provider(): PvcfcPublicDataProvider {
  return {
    listSourceUrls: vi.fn(async () => ({ ok: true as const, value: [] })),
    listCollections: vi.fn(async () => ({
      ok: true as const,
      value: {
        revision: 'revision-1',
        capturedAt: '2026-08-12T00:00:00.000Z',
        organization: { name: 'PVCFC', sourceRecordId: 'organization' },
        collections: [
          { name: 'products', access: 'searchable' as const, count: 1 },
        ],
      },
    })),
    listRecords: vi.fn(async (request) => ({
      ok: true as const,
      value: {
        revision: 'revision-1',
        collection: request.collection,
        records: [
          {
            collection: request.collection,
            id: 'product-1',
            title: 'Urê Cà Mau',
            sourceUrl: 'https://example.test/products/ure',
          },
        ],
      },
    })),
    searchRecords: vi.fn(async () => ({
      ok: true as const,
      value: {
        revision: 'revision-1',
        hits: [
          {
            collection: 'products',
            id: 'product-1',
            title: 'Urê Cà Mau',
            summary: 'Compact evidence',
            sourceUrl: 'https://example.test/products/ure',
          },
        ],
      },
    })),
    getRecord: vi.fn(async () => ({
      ok: true as const,
      value: {
        revision: 'revision-1',
        collection: 'products',
        record: {
          id: 'product-1',
          originRefs: ['origin#product-1'],
          dosage: { rice: { kilogramsPerHectare: 120 } },
          providerExtension: { nested: ['kept', { exactly: true }] },
        },
      },
    })),
  };
}

describe('PVCFC LangChain evidence tools', () => {
  it('exposes the four PVCFC-owned tools with Zod-bounded inputs', async () => {
    const tools = createPvcfcTools(provider());

    expect(tools.map(({ name }) => name)).toEqual([
      'listPvcfcCollections',
      'listPvcfcRecords',
      'searchPvcfcRecords',
      'getPvcfcRecord',
    ]);
    await expect(tools[0]!.invoke({ limit: 21 })).rejects.toThrow();
    await expect(tools[2]!.invoke({ query: '', limit: 1 })).rejects.toThrow();
  });

  it('delegates compact discovery and exact detail retrieval without dropping unknown fields', async () => {
    const dataProvider = provider();
    const tools = createPvcfcTools(dataProvider);

    const listed = await tools[1]!.invoke({ collection: 'products', limit: 8 });
    const searched = await tools[2]!.invoke({ query: 'Urê', limit: 8 });
    const exact = await tools[3]!.invoke({
      collection: 'products',
      id: 'product-1',
    });

    expect(dataProvider.listRecords).toHaveBeenCalledWith({
      collection: 'products',
      limit: 8,
    });
    expect(dataProvider.searchRecords).toHaveBeenCalledWith({
      query: 'Urê',
      limit: 8,
    });
    expect(listed).not.toHaveProperty('value.records.0.providerExtension');
    expect(searched).not.toHaveProperty('value.hits.0.providerExtension');
    expect(exact).toMatchObject({
      ok: true,
      value: {
        record: {
          providerExtension: { nested: ['kept', { exactly: true }] },
        },
      },
    });
  });

  it('can expand one bounded collection page without requiring one model tool call per record', async () => {
    const dataProvider = provider();
    const tools = createPvcfcTools(dataProvider);

    const listed = await tools[1]!.invoke({
      collection: 'urban_agriculture',
      limit: 15,
      includeDetails: true,
    });

    expect(dataProvider.listRecords).toHaveBeenCalledWith({
      collection: 'urban_agriculture',
      limit: 15,
    });
    expect(dataProvider.getRecord).toHaveBeenCalledWith({
      collection: 'urban_agriculture',
      id: 'product-1',
    });
    expect(listed).toMatchObject({
      ok: true,
      value: {
        collection: 'urban_agriculture',
        details: [
          {
            ok: true,
            value: {
              record: {
                providerExtension: { nested: ['kept', { exactly: true }] },
              },
            },
          },
        ],
      },
    });
  });
});
