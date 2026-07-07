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
    contentPages: await readJson(rootDir, 'content-pages.json'),
  });
}
