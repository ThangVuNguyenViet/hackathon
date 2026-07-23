import { cp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { validateCatalogBaselineCorpus } from '../src/fixtures/catalogBaselineCorpus.js';

const GENERATED_FIXTURE_FILES = [
  'menu-items.json',
  'menu-modifiers.json',
  'stores.json',
  'store-availability.json',
  'administrative-divisions.json',
  'administrative-legacy-mappings.json',
  'fulfillment-service-areas.json',
  'fulfillment-quotes.json',
  'promotions.json',
  'promotion-voucher-offers.json',
  'payment-methods.json',
  'content-pages.json',
  'membership-pages.json',
  'membership-reward-offers.json',
  'membership-wallet-vouchers.json',
  'membership-profile-snapshots.json',
  'membership-point-history-snapshots.json',
  'membership-tool-definitions.json',
] as const;

export interface BuildFixturesOptions {
  repoRoot: string;
  backendRoot: string;
}

export async function buildFixtures(options: BuildFixturesOptions): Promise<void> {
  const catalogBaselines = await validateCatalogBaselineCorpus(options.repoRoot);
  const sourceBackendRoot = join(options.repoRoot, 'services/kfc-agent-backend');
  const sourceGenerated = join(sourceBackendRoot, 'fixtures/generated');
  const targetGenerated = join(options.backendRoot, 'fixtures/generated');

  if (sourceGenerated !== targetGenerated) {
    await rm(targetGenerated, { recursive: true, force: true });
    await mkdir(targetGenerated, { recursive: true });
    for (const file of GENERATED_FIXTURE_FILES) {
      await cp(join(sourceGenerated, file), join(targetGenerated, file));
    }
  }

  const targetCatalogBaselines = join(options.backendRoot, 'fixtures/catalog-baselines');
  const sourceCatalogBaselines = join(sourceBackendRoot, 'fixtures/catalog-baselines');
  if (sourceCatalogBaselines !== targetCatalogBaselines) {
    await rm(targetCatalogBaselines, { recursive: true, force: true });
    await mkdir(targetCatalogBaselines, { recursive: true });
    await cp(join(sourceCatalogBaselines, 'manifest.json'), join(targetCatalogBaselines, 'manifest.json'));
    for (const observation of catalogBaselines.observations) {
      if (observation.format === 'raw_api') {
        await cp(
          join(options.repoRoot, observation.sourcePath),
          join(targetCatalogBaselines, `${observation.id}.raw.json`),
        );
        continue;
      }
      await cp(
        join(options.repoRoot, observation.itemSourcePath),
        join(targetCatalogBaselines, `${observation.id}.items.json`),
      );
      await cp(
        join(options.repoRoot, observation.modifierSourcePath),
        join(targetCatalogBaselines, `${observation.id}.modifiers.json`),
      );
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await buildFixtures({
    repoRoot: join(process.cwd(), '../..'),
    backendRoot: process.cwd(),
  });
}
