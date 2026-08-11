import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePvcfcPublicDataBundle } from '../../src/businesses/pvcfc/public-data/pvcfcPublicDataBundle.js';

describe('PVCFC consolidated public-data bundle', () => {
  it('preserves all 497 provenance-bearing source records without silent drops', async () => {
    const raw = await readFile(
      join(process.cwd(), 'fixtures/generated/pvcfc-public-data.json'),
      'utf8',
    );
    const bundle = parsePvcfcPublicDataBundle(JSON.parse(raw) as unknown);
    const records = bundle.collections.flatMap((collection) =>
      collection.records.map((record) => ({
        collection: collection.name,
        record,
      })),
    );

    expect(records).toHaveLength(497);
    expect(
      bundle.collections.find((collection) => collection.name === 'products')
        ?.records,
    ).toHaveLength(67);
    expect(
      bundle.collections.find(
        (collection) => collection.name === 'source_inventory',
      ),
    ).toMatchObject({ access: 'discovery_only', count: 79 });
    for (const { collection, record } of records) {
      expect(record.originRefs, `${collection}/${record.id}`).toEqual([
        expect.stringMatching(/^[a-f0-9]{64}#[^#]+$/),
      ]);
    }
  });
});
