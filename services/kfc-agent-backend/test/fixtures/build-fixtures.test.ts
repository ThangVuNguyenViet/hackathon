import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildFixtures } from '../../scripts/build-fixtures.js';
import { loadGeneratedFixtures } from '../../src/fixtures/loadFixtures.js';

describe('buildFixtures', () => {
  it('copies backend-ready generated ordering fixtures', async () => {
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
    expect(fixtures.fulfillmentServiceAreas).toHaveLength(4);
    expect(fixtures.promotions.length).toBe(5);
    expect(fixtures.promotionVoucherOffers.length).toBeGreaterThanOrEqual(28);
    expect(fixtures.paymentMethods).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          methodId: 'zalopay_wallet',
          displayName: 'Ví ZaloPay',
          supported: true,
          sourceUrl: 'https://kfcvietnam.com.vn/privacy-policy',
        }),
        expect.objectContaining({
          methodId: 'momo_wallet',
          displayName: 'Ví MoMo',
          supported: false,
          evidenceText: expect.stringContaining('not listed'),
        }),
      ]),
    );
    expect(
      fixtures.promotionVoucherOffers
        .filter((offer) => !offer.actualCodeExposed)
        .every((offer) => offer.publicCode === ''),
    ).toBe(true);
    expect(fixtures.contentPages.filter((page) => page.kind === 'policy')).toHaveLength(12);
    expect(fixtures.contentPages.filter((page) => page.kind === 'allergen')).toHaveLength(1);
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
    const catalogManifest = JSON.parse(
      await readFile(join(outDir, 'fixtures/catalog-baselines/manifest.json'), 'utf8'),
    ) as { observations: Array<{ id: string; itemCount: number; modifierTreeCount: number }> };
    expect(catalogManifest.observations).toEqual([
      expect.objectContaining({
        id: 'kfcvn-generic-menu@2026-07-07',
        itemCount: 120,
        modifierTreeCount: 58,
      }),
      expect.objectContaining({
        id: 'kfcvn-generic-menu@2026-07-10',
        itemCount: 118,
        modifierTreeCount: 56,
      }),
    ]);
    await expect(
      readFile(
        join(outDir, 'fixtures/catalog-baselines/kfcvn-generic-menu@2026-07-07.items.json'),
        'utf8',
      ),
    ).resolves.toContain('20751');
    await expect(
      readFile(
        join(outDir, 'fixtures/catalog-baselines/kfcvn-generic-menu@2026-07-07.modifiers.json'),
        'utf8',
      ),
    ).resolves.toContain('20751');
    await expect(
      readFile(
        join(outDir, 'fixtures/catalog-baselines/kfcvn-generic-menu@2026-07-10.raw.json'),
        'utf8',
      ),
    ).resolves.toContain('41160');

    await rm(outDir, { recursive: true, force: true });
  });
});
