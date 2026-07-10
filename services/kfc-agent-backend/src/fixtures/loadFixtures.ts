import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { generatedFixturesSchema, type GeneratedFixtures } from './schema.js';

async function readJson(rootDir: string, fileName: string): Promise<unknown> {
  const raw = await readFile(join(rootDir, 'fixtures/generated', fileName), 'utf8');
  return JSON.parse(raw) as unknown;
}

export async function loadGeneratedFixtures(rootDir: string): Promise<GeneratedFixtures> {
  return generatedFixturesSchema.parse({
    menuItems: await readJson(rootDir, 'menu-items.json'),
    menuModifiers: await readJson(rootDir, 'menu-modifiers.json'),
    stores: await readJson(rootDir, 'stores.json'),
    storeAvailability: await readJson(rootDir, 'store-availability.json'),
    promotions: await readJson(rootDir, 'promotions.json'),
    promotionVoucherOffers: await readJson(rootDir, 'promotion-voucher-offers.json'),
    paymentMethods: await readJson(rootDir, 'payment-methods.json'),
    contentPages: await readJson(rootDir, 'content-pages.json'),
    membershipPages: await readJson(rootDir, 'membership-pages.json'),
    membershipRewardOffers: await readJson(rootDir, 'membership-reward-offers.json'),
    membershipWalletVouchers: await readJson(rootDir, 'membership-wallet-vouchers.json'),
    membershipProfileSnapshots: await readJson(rootDir, 'membership-profile-snapshots.json'),
    membershipPointHistorySnapshots: await readJson(rootDir, 'membership-point-history-snapshots.json'),
    membershipToolDefinitions: await readJson(rootDir, 'membership-tool-definitions.json'),
  });
}
