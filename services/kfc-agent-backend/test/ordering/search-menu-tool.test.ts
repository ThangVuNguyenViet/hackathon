import { beforeAll, describe, expect, it } from 'vitest';
import type { ExternalClients } from '../../src/clients/interfaces.js';
import type { GeneratedFixtures } from '../../src/fixtures/schema.js';
import { loadGeneratedFixtures } from '../../src/fixtures/loadFixtures.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import { executeToolCall } from '../../src/ordering/toolExecutor.js';

interface CompactSearchItem {
  code: string;
  name: string;
  category: string;
  description: string;
  priceVnd: number;
  originalPriceVnd?: number;
  imageUrl: string;
  available: boolean;
  isCustomize: boolean;
  hasModifiers: boolean;
}

interface SearchEnvelope {
  mode: 'search' | 'full';
  query: string;
  total: number;
  items: CompactSearchItem[];
}

function normalized(value: string): string {
  return value
    .toLowerCase()
    .replace(/đ/g, 'd')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

describe('canonical searchMenu tool', () => {
  let fixtures: GeneratedFixtures;
  let clients: ExternalClients;

  beforeAll(async () => {
    fixtures = await loadGeneratedFixtures(process.cwd());
    clients = createMockClients(fixtures);
  });

  async function search(arguments_: Record<string, unknown>): Promise<SearchEnvelope> {
    const result = await executeToolCall(clients, {
      toolName: 'searchMenu',
      arguments: arguments_,
    });
    expect(result.ok).toBe(true);
    return result.value as unknown as SearchEnvelope;
  }

  it('returns the complete available menu in stable fixture order for full mode', async () => {
    const output = await search({ mode: 'full' });
    const available = fixtures.menuItems.filter((item) => item.available);

    expect(output).toMatchObject({ mode: 'full', query: '', total: available.length });
    expect(output.items.map((item) => item.code)).toEqual(available.map((item) => item.code));
  });

  it('normalizes Vietnamese search text with and without diacritics', async () => {
    const accented = await search({ query: 'gà rán' });
    const plain = await search({ query: 'ga ran' });

    expect(accented.items.length).toBeGreaterThan(0);
    expect(plain.items.map((item) => item.code)).toEqual(accented.items.map((item) => item.code));
  });

  it('surfaces fixture-backed combo candidates for a group intent without hard-coded products', async () => {
    const output = await search({
      query: 'combo 4 người có gà rán và nước dưới 300k',
      partySize: 4,
      maxPriceVnd: 300000,
    });
    const fixtureByCode = new Map(fixtures.menuItems.map((item) => [item.code, item]));
    const best = fixtureByCode.get(output.items[0]!.code);
    const bestText = normalized(`${best?.name ?? ''} ${best?.category ?? ''} ${best?.description ?? ''}`);

    expect(output.items.length).toBeGreaterThan(0);
    expect(bestText).toContain('combo');
    expect(bestText).toMatch(/4 mieng ga ran/);
    expect(bestText).toMatch(/4 ly pepsi/);
  });

  it('derives party size and a k-price ceiling from the natural-language query', async () => {
    const output = await search({ query: 'combo 4 người dưới 300k có gà rán và nước' });
    const bestText = normalized(`${output.items[0]?.name ?? ''} ${output.items[0]?.description ?? ''}`);

    expect(output.items.every((item) => item.priceVnd <= 300000)).toBe(true);
    expect(bestText).toMatch(/4 mieng ga ran/);
    expect(bestText).toMatch(/4 ly pepsi/);
  });

  it('treats price-only and drink-only terms as meaningful intent', async () => {
    const budget = await search({ query: 'dưới 300k' });
    const drinks = await search({ query: 'có nước' });

    expect(budget.items.length).toBeGreaterThan(0);
    expect(budget.items.every((item) => item.priceVnd <= 300000)).toBe(true);
    expect(drinks.items.length).toBeGreaterThan(0);
    expect(drinks.items.every((item) =>
      normalized(`${item.name} ${item.category} ${item.description}`).match(/pepsi|thuc uong/),
    )).toBe(true);
  });

  it('excludes products above maxPriceVnd', async () => {
    const output = await search({ query: 'combo', maxPriceVnd: 100000 });

    expect(output.items.length).toBeGreaterThan(0);
    expect(output.items.every((item) => item.priceVnd <= 100000)).toBe(true);
  });

  it('filters by normalized category', async () => {
    const category = fixtures.menuItems.find((item) => item.available)?.category;
    expect(category).toBeDefined();

    const output = await search({ mode: 'full', category: normalized(category!) });

    expect(output.items.length).toBeGreaterThan(0);
    expect(output.items.every((item) => item.category === category)).toBe(true);
  });

  it('ranks broad fried-chicken matches deterministically with direct names first', async () => {
    const first = await search({ query: 'gà rán' });
    const second = await search({ query: 'gà rán' });
    const directNameIndex = first.items.findIndex((item) => normalized(item.name).includes('ga ran'));
    const descriptionOnlyIndex = first.items.findIndex((item) =>
      !normalized(item.name).includes('ga ran') && normalized(item.description).includes('ga ran'),
    );

    expect(first.items.map((item) => item.code)).toEqual(second.items.map((item) => item.code));
    expect(directNameIndex).toBe(0);
    expect(descriptionOnlyIndex).toBeGreaterThan(directNameIndex);
  });

  it('returns compact search items while getModifierOptions retains full modifier data', async () => {
    const output = await search({ mode: 'full' });
    expect(output.items.length).toBeGreaterThan(0);
    for (const item of output.items) {
      expect(item).not.toHaveProperty('modifierGroups');
      expect(item).not.toHaveProperty('provenance');
      expect(item).not.toHaveProperty('orderingMetadata');
      expect(item).not.toHaveProperty('itemId');
      expect(item).not.toHaveProperty('productCode');
      expect(item).not.toHaveProperty('isQuickCombo');
      expect(Object.keys(item).sort()).toEqual([
        'available',
        'category',
        'code',
        'description',
        'hasModifiers',
        'imageUrl',
        'isCustomize',
        'name',
        ...(item.originalPriceVnd === undefined ? [] : ['originalPriceVnd']),
        'priceVnd',
      ].sort());
    }

    const itemWithModifiers = fixtures.menuModifiers.find((item) => item.modifierGroups.length > 0);
    expect(itemWithModifiers).toBeDefined();
    const details = await executeToolCall(clients, {
      toolName: 'getModifierOptions',
      arguments: { code: itemWithModifiers!.itemId },
    });
    expect(details).toMatchObject({
      ok: true,
      value: {
        itemId: itemWithModifiers!.itemId,
        modifierGroups: expect.arrayContaining([
          expect.objectContaining({ options: expect.any(Array) }),
        ]),
      },
    });
  });
});
