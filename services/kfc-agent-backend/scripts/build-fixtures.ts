import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { MenuItem } from '../src/domain/types.js';

const SOURCE_FILE = 'ai-talent-tracks/fnb/data/kfcvietnam-ordering-crawl/kfcvietnam-menu-items.json';

interface RawMenuItem {
  category: string;
  code: string;
  name: string;
  description: string;
  priceVnd: number;
  originalPriceVnd: number | null;
  imageUrl: string;
}

interface RawMenuFile {
  items: RawMenuItem[];
}

export interface BuildFixturesOptions {
  repoRoot: string;
  backendRoot: string;
}

function conceptPathFor(code: string): string {
  return `menu/items/${code}.md`;
}

function conceptIdFor(code: string): string {
  return conceptPathFor(code).replace(/\.md$/, '');
}

function renderMenuConcept(item: RawMenuItem): string {
  const conceptId = conceptIdFor(item.code);
  return `---
type: Menu Item
title: ${JSON.stringify(item.name)}
description: ${JSON.stringify(item.description)}
resource: https://www.kfcvietnam.com.vn/en/menu
tags: [menu, mock-fixture, ${JSON.stringify(item.category)}]
source_file: ${SOURCE_FILE}
code: ${JSON.stringify(item.code)}
price_vnd: ${item.priceVnd}
original_price_vnd: ${item.originalPriceVnd === null ? 'null' : item.originalPriceVnd}
timestamp: 2026-07-07
---

# Mock Behavior

Available by default unless a scenario override changes availability.

# Tool Mapping

Used by \`searchMenu\`, \`getItemDetails\`, \`updateCart\`, and \`previewCart\`.

# Provenance

Concept ID: \`${conceptId}\`.
`;
}

export async function buildFixtures(options: BuildFixturesOptions): Promise<void> {
  const crawlFile = join(options.repoRoot, SOURCE_FILE);
  const raw = JSON.parse(await readFile(crawlFile, 'utf8')) as RawMenuFile;

  const generated = raw.items.map((item): MenuItem & {
    provenance: {
      sourceFile: string;
      okfConceptId: string;
      fixtureMode: 'public_crawl_seed';
    };
  } => ({
    ...item,
    available: true,
    provenance: {
      sourceFile: SOURCE_FILE,
      okfConceptId: conceptIdFor(item.code),
      fixtureMode: 'public_crawl_seed',
    },
  }));

  const fixturePath = join(options.backendRoot, 'fixtures/generated/menu-items.json');
  await mkdir(dirname(fixturePath), { recursive: true });
  await writeFile(fixturePath, `${JSON.stringify(generated, null, 2)}\n`);

  const okfRoot = join(options.backendRoot, 'knowledge/kfc-okf');
  await mkdir(join(okfRoot, 'menu/items'), { recursive: true });
  const indexLines = [
    '# KFC Vietnam Mock Knowledge',
    '',
    '* [Menu Items](menu/items/index.md) - Public crawl seeded KFC Vietnam menu items.',
    '',
    '## Menu Item Concepts',
    '',
  ];

  const itemIndex = ['# Menu Items', ''];
  for (const item of raw.items) {
    const relativePath = `${item.code}.md`;
    const conceptPath = conceptPathFor(item.code);
    indexLines.push(`* [${item.name}](${conceptPath}) - ${item.description}`);
    itemIndex.push(`* [${item.name}](${relativePath}) - ${item.description}`);
    await writeFile(join(okfRoot, conceptPath), renderMenuConcept(item));
  }

  await writeFile(join(okfRoot, 'index.md'), `${indexLines.join('\n')}\n`);
  await writeFile(join(okfRoot, 'menu/items/index.md'), `${itemIndex.join('\n')}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await buildFixtures({
    repoRoot: join(process.cwd(), '../..'),
    backendRoot: process.cwd(),
  });
}
