import { cp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

const GENERATED_FIXTURE_FILES = [
  'menu-items.json',
  'menu-modifiers.json',
  'stores.json',
  'store-availability.json',
  'promotions.json',
  'content-pages.json',
] as const;

export interface BuildFixturesOptions {
  repoRoot: string;
  backendRoot: string;
}

export async function buildFixtures(options: BuildFixturesOptions): Promise<void> {
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

  const sourceOkf = join(sourceBackendRoot, 'knowledge/kfc-okf');
  const targetOkf = join(options.backendRoot, 'knowledge/kfc-okf');
  if (sourceOkf !== targetOkf) {
    await rm(targetOkf, { recursive: true, force: true });
    await cp(sourceOkf, targetOkf, { recursive: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await buildFixtures({
    repoRoot: join(process.cwd(), '../..'),
    backendRoot: process.cwd(),
  });
}
