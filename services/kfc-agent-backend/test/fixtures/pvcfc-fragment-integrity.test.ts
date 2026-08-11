import { createHash } from 'node:crypto';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildFixtures } from '../../scripts/build-fixtures.js';
import { buildPvcfcPublicData } from '../../scripts/build-pvcfc-public-data.js';

const manifestSchema = z.object({
  schemaVersion: z.string(),
  businessId: z.string(),
  capturedAt: z.string(),
  organization: z.object({
    collection: z.string(),
    recordId: z.string(),
  }),
  collections: z.array(
    z.object({
      name: z.string(),
      access: z.enum(['searchable', 'discovery_only']),
      recordCount: z.number().int().nonnegative(),
    }),
  ),
  fragments: z.array(
    z.object({
      path: z.string(),
      kind: z.string(),
      schemaVersion: z.string(),
      rawSha256: z.string(),
      recordCount: z.number().int().nonnegative(),
      recordKeysSha256: z.string(),
    }),
  ),
});

const fragmentSchema = z.object({
  schemaVersion: z.string(),
  kind: z.string(),
  records: z.array(z.object({ id: z.string() }).passthrough()),
});

const hashableBundleSchema = z
  .object({
    revision: z.string(),
  })
  .passthrough();

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  return `{${entries
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
    .join(',')}}`;
}

describe('PVCFC fragment manifest integrity', () => {
  it('pins every fragment byte and declares collection policy in fixture data', async () => {
    const fixtureRoot = join(process.cwd(), 'fixtures/pvcfc');
    const manifest = manifestSchema.parse(
      JSON.parse(await readFile(join(fixtureRoot, 'manifest.json'), 'utf8')),
    );
    const diskPaths = (await readdir(join(fixtureRoot, 'fragments')))
      .filter((path) => path.endsWith('.json'))
      .map((path) => `fixtures/pvcfc/fragments/${path}`)
      .sort();

    expect(manifest.schemaVersion).toBe('pvcfc_fragment_manifest_v1');
    expect(manifest.businessId).toBe('pvcfc');
    expect(manifest.fragments.map((entry) => entry.path).sort()).toEqual(
      diskPaths,
    );
    expect(manifest.fragments).toHaveLength(15);

    let productCount = 0;
    for (const entry of manifest.fragments) {
      const raw = await readFile(join(process.cwd(), entry.path));
      const fragment = fragmentSchema.parse(JSON.parse(raw.toString('utf8')));
      const sortedRecordIds = fragment.records
        .map((record) => record.id)
        .sort();

      expect(entry.rawSha256).toBe(sha256(raw));
      expect(entry.schemaVersion).toBe(fragment.schemaVersion);
      expect(entry.kind).toBe(fragment.kind);
      expect(entry.recordCount).toBe(fragment.records.length);
      expect(new Set(sortedRecordIds)).toHaveLength(sortedRecordIds.length);
      expect(entry.recordKeysSha256).toBe(
        sha256(JSON.stringify(sortedRecordIds)),
      );
      if (entry.kind === 'products') productCount += entry.recordCount;
    }

    expect(productCount).toBe(67);
    expect(
      manifest.collections.find(
        (collection) => collection.name === 'source_inventory',
      ),
    ).toEqual({
      name: 'source_inventory',
      access: 'discovery_only',
      recordCount: 79,
    });
    expect(
      manifest.collections.reduce(
        (total, collection) => total + collection.recordCount,
        0,
      ),
    ).toBe(497);
  });

  it('copies the committed PVCFC pack byte-for-byte into a backend build', async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), 'pvcfc-fixtures-'));
    const sourcePath = join(
      process.cwd(),
      'fixtures/generated/pvcfc-public-data.json',
    );

    try {
      await buildFixtures({
        repoRoot: join(process.cwd(), '../..'),
        backendRoot: outputRoot,
      });

      const [source, copied] = await Promise.all([
        readFile(sourcePath),
        readFile(join(outputRoot, 'fixtures/generated/pvcfc-public-data.json')),
      ]);
      expect(sha256(copied)).toBe(sha256(source));
      expect(copied.equals(source)).toBe(true);
    } finally {
      await rm(outputRoot, { recursive: true, force: true });
    }
  });

  it('recomputes the committed pack hash and rejects a tampered generated pack', async () => {
    const sourceFixtureRoot = join(process.cwd(), 'fixtures');
    const bundlePath = join(
      sourceFixtureRoot,
      'generated/pvcfc-public-data.json',
    );
    const bundle = hashableBundleSchema.parse(
      JSON.parse(await readFile(bundlePath, 'utf8')),
    );
    const revision = bundle.revision;
    expect(revision).toBe(sha256(canonicalJson({ ...bundle, revision: '' })));

    const outputRoot = await mkdtemp(join(tmpdir(), 'pvcfc-tamper-'));
    try {
      await cp(
        join(sourceFixtureRoot, 'pvcfc'),
        join(outputRoot, 'fixtures/pvcfc'),
        { recursive: true },
      );
      await mkdir(join(outputRoot, 'fixtures/generated'), { recursive: true });
      const tampered = structuredClone(bundle);
      tampered.revision = '0'.repeat(64);
      await writeFile(
        join(outputRoot, 'fixtures/generated/pvcfc-public-data.json'),
        `${JSON.stringify(tampered, null, 2)}\n`,
        'utf8',
      );

      await expect(
        buildPvcfcPublicData({ backendRoot: outputRoot, check: true }),
      ).rejects.toThrow(/pvcfc-public-data\.json is stale/u);
    } finally {
      await rm(outputRoot, { recursive: true, force: true });
    }
  });

  it('builds an added product, new collection, and unknown payload without TypeScript changes', async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), 'pvcfc-evolution-'));
    try {
      await cp(
        join(process.cwd(), 'fixtures/pvcfc'),
        join(outputRoot, 'fixtures/pvcfc'),
        {
          recursive: true,
        },
      );
      await mkdir(join(outputRoot, 'fixtures/generated'), { recursive: true });

      const manifestPath = join(outputRoot, 'fixtures/pvcfc/manifest.json');
      const manifest = manifestSchema.parse(
        JSON.parse(await readFile(manifestPath, 'utf8')),
      );
      manifest.collections.push({
        name: 'research_trials',
        access: 'searchable',
        recordCount: 1,
      });
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

      const productPath = join(
        outputRoot,
        'fixtures/pvcfc/fragments/products-pages-01-02.json',
      );
      const productFragment = fragmentSchema.parse(
        JSON.parse(await readFile(productPath, 'utf8')),
      );
      const baseProduct = productFragment.records[0]!;
      productFragment.records.push({
        ...baseProduct,
        id: 'synthetic-future-product',
        name: 'Synthetic future product',
        sourceUrl: 'https://www.pvcfc.com.vn/synthetic-future-product',
        futurePayload: { dosageModel: 'vNext', confidence: 0.9 },
      });
      await writeFile(
        productPath,
        `${JSON.stringify(productFragment, null, 2)}\n`,
      );

      await writeFile(
        join(outputRoot, 'fixtures/pvcfc/fragments/research-trials.json'),
        `${JSON.stringify(
          {
            schemaVersion: 'pvcfc-public-fixture-fragment-v1',
            kind: 'research_trials',
            records: [
              {
                id: 'trial-2027-alpha',
                name: 'Future field trial',
                sourceUrl: 'https://www.pvcfc.com.vn/future-field-trial',
                futurePayload: { plots: 12, telemetry: ['soil', 'rain'] },
                provenance: {
                  sourceUrl: 'https://www.pvcfc.com.vn/future-field-trial',
                  retrievedAt: '2026-08-11',
                },
              },
            ],
          },
          null,
          2,
        )}\n`,
      );

      await buildPvcfcPublicData({ backendRoot: outputRoot });
      const evolved = z
        .object({
          collections: z.array(
            z.object({
              name: z.string(),
              count: z.number(),
              records: z.array(z.record(z.unknown())),
            }),
          ),
        })
        .parse(
          JSON.parse(
            await readFile(
              join(outputRoot, 'fixtures/generated/pvcfc-public-data.json'),
              'utf8',
            ),
          ),
        );

      expect(
        evolved.collections.find(
          (collection) => collection.name === 'products',
        ),
      ).toMatchObject({ count: 68 });
      const research = evolved.collections.find(
        (collection) => collection.name === 'research_trials',
      );
      expect(research).toMatchObject({ count: 1 });
      expect(research?.records[0]).toMatchObject({
        id: 'trial-2027-alpha',
        futurePayload: { plots: 12, telemetry: ['soil', 'rain'] },
        originRefs: [expect.stringMatching(/^[a-f0-9]{64}#trial-2027-alpha$/)],
      });
      expect(
        evolved.collections.reduce(
          (count, collection) => count + collection.count,
          0,
        ),
      ).toBe(499);
    } finally {
      await rm(outputRoot, { recursive: true, force: true });
    }
  });
});
