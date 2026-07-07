import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { generatedFixturesSchema, type GeneratedFixtures } from './schema.js';

export async function loadGeneratedFixtures(rootDir: string): Promise<GeneratedFixtures> {
  const raw = await readFile(join(rootDir, 'fixtures/generated/menu-items.json'), 'utf8');
  const menuItems = JSON.parse(raw) as unknown;
  return generatedFixturesSchema.parse({ menuItems });
}
