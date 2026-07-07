import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildFixtures } from '../../scripts/build-fixtures.js';
import { loadGeneratedFixtures } from '../../src/fixtures/loadFixtures.js';

describe('buildFixtures', () => {
  it('generates menu fixtures and OKF concepts from the public crawl', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'kfc-fixtures-'));

    await buildFixtures({
      repoRoot: join(process.cwd(), '../..'),
      backendRoot: outDir,
    });

    const fixtures = await loadGeneratedFixtures(outDir);
    expect(fixtures.menuItems.length).toBe(88);
    expect(fixtures.menuItems[0]).toMatchObject({
      code: 'HOPGU',
      name: 'Combo 99K',
      priceVnd: 99000,
      available: true,
    });

    const okfIndex = await readFile(join(outDir, 'knowledge/kfc-okf/index.md'), 'utf8');
    expect(okfIndex).toContain('# KFC Vietnam Mock Knowledge');
    expect(okfIndex).toContain('menu/items/HOPGU.md');

    await rm(outDir, { recursive: true, force: true });
  });
});
