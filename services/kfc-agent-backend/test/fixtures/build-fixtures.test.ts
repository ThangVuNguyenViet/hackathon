import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildFixtures } from '../../scripts/build-fixtures.js';
import { loadGeneratedFixtures } from '../../src/fixtures/loadFixtures.js';

describe('buildFixtures', () => {
  it('generates backend-ready ordering fixtures and OKF concepts from the public crawl', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'kfc-fixtures-'));

    await buildFixtures({
      repoRoot: join(process.cwd(), '../..'),
      backendRoot: outDir,
    });

    const fixtures = await loadGeneratedFixtures(outDir);
    expect(fixtures.menuItems.length).toBe(120);
    expect(fixtures.menuModifiers.length).toBe(58);
    expect(fixtures.stores.length).toBe(265);
    expect(fixtures.storeAvailability.length).toBe(265);
    expect(fixtures.promotions.length).toBe(5);
    expect(fixtures.promotionVoucherOffers.length).toBe(28);
    expect(fixtures.promotionVoucherOffers.every((offer) => !offer.actualCodeExposed && offer.publicCode === '')).toBe(true);
    expect(fixtures.contentPages.length).toBe(2);
    expect(fixtures.membershipPages.length).toBe(8);
    expect(fixtures.membershipRewardOffers.length).toBe(3);
    expect(fixtures.membershipWalletVouchers.length).toBe(2);
    expect(fixtures.membershipProfileSnapshots.length).toBe(1);
    expect(fixtures.membershipPointHistorySnapshots.length).toBe(1);
    expect(fixtures.membershipToolDefinitions.length).toBe(7);
    expect(fixtures.membershipToolDefinitions.map((tool) => tool.toolName)).toEqual(
      expect.arrayContaining(['acquireVoucher', 'redeemReward']),
    );
    expect(fixtures.menuItems[0]).toMatchObject({
      code: '20751',
      productCode: 'HOPGU',
      name: 'Combo Hợp Gu 99K',
      priceVnd: 99000,
      available: true,
    });

    const okfIndex = await readFile(join(outDir, 'knowledge/kfc-okf/index.md'), 'utf8');
    expect(okfIndex).toContain('# KFC Vietnam Mock Knowledge');
    expect(okfIndex).toContain('menu/items/20751.md');

    await rm(outDir, { recursive: true, force: true });
  });
});
