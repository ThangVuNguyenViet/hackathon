import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  parseCatalogPayload,
  sha256,
} from '../src/catalog/catalogObservation.js';

export async function captureCatalogBaseline(input: {
  sourceUrl: string;
  targetPath: string;
  expectedSha256: string;
  expectedItemCount: number;
  expectedModifierTreeCount: number;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const response = await (input.fetchImpl ?? fetch)(input.sourceUrl, {
    headers: { accept: 'application/json' },
  });
  if (!response.ok)
    throw new Error(`Catalog provider returned HTTP ${response.status}`);
  const raw = await response.text();
  if ((await sha256(raw)) !== input.expectedSha256)
    throw new Error('Catalog capture hash mismatch');
  const items = parseCatalogPayload(JSON.parse(raw) as unknown);
  if (
    items.length !== input.expectedItemCount ||
    items.filter((item) => item.modifierGroups.length > 0).length !==
      input.expectedModifierTreeCount
  ) {
    throw new Error('Catalog capture count mismatch');
  }
  await mkdir(dirname(input.targetPath), { recursive: true });
  await writeFile(input.targetPath, raw);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await captureCatalogBaseline({
    sourceUrl: 'https://api.kfcvietnam.com.vn/menu/kfcvn-generic-menu',
    targetPath:
      'fixtures/catalog-baselines/kfcvn-generic-menu@2026-07-10.raw.json',
    expectedSha256:
      'a681130fc630f4cc37a0c102337c393e551ee53e2f028a53a3fb79483a886bcd',
    expectedItemCount: 118,
    expectedModifierTreeCount: 56,
  });
}
