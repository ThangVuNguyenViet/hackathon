import { beforeAll, describe, expect, it } from 'vitest';
import type { ExternalClients } from '../../src/clients/interfaces.js';
import type { GeneratedFixtures } from '../../src/fixtures/schema.js';
import { loadGeneratedFixtures } from '../../src/fixtures/loadFixtures.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import { executeToolCall } from '../../src/ordering/toolExecutor.js';

const externalCallContext = {
  signal: new AbortController().signal,
  deadlineAt: Date.now() + 60_000,
};

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
  matchesAllModifierQueries?: boolean;
  matchedModifiers?: Array<{
    query: string;
    groupId: string;
    groupName: string;
    groupMin: number | null;
    groupMax: number | null;
    modifierId: string;
    name: string;
    priceDeltaVnd: number;
    default: boolean;
    quantity: number | null;
  }>;
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

  async function search(
    arguments_: Record<string, unknown>,
  ): Promise<SearchEnvelope> {
    const result = await executeToolCall(
      clients,
      {
        toolName: 'searchMenu',
        arguments: arguments_,
      },
      { externalCallContext },
    );
    expect(result.ok).toBe(true);
    if (!result.ok || result.toolName !== 'searchMenu') {
      throw new Error('searchMenu did not return a successful result');
    }
    return result.value;
  }

  it('returns the complete available menu in stable fixture order for full mode', async () => {
    const output = await search({ mode: 'full' });
    const available = fixtures.menuItems.filter((item) => item.available);

    expect(output).toMatchObject({
      mode: 'full',
      query: '',
      total: available.length,
    });
    expect(output.items.map((item) => item.code)).toEqual(
      available.map((item) => item.code),
    );
  });

  it('normalizes Vietnamese search text with and without diacritics', async () => {
    const accented = await search({ query: 'gà rán' });
    const plain = await search({ query: 'ga ran' });

    expect(accented.items.length).toBeGreaterThan(0);
    expect(plain.items.map((item) => item.code)).toEqual(
      accented.items.map((item) => item.code),
    );
  });

  it('surfaces fixture-backed combo candidates for a group intent without hard-coded products', async () => {
    const output = await search({
      query: 'combo gà rán pepsi',
      partySize: 4,
      maxPriceVnd: 300000,
    });
    const fixtureByCode = new Map(
      fixtures.menuItems.map((item) => [item.code, item]),
    );
    const best = fixtureByCode.get(output.items[0]!.code);
    const bestText = normalized(
      `${best?.name ?? ''} ${best?.category ?? ''} ${best?.description ?? ''}`,
    );

    expect(output.items.length).toBeGreaterThan(0);
    expect(bestText).toContain('combo');
    expect(bestText).toMatch(/4 mieng ga ran/);
    expect(bestText).toMatch(/4 ly pepsi/);
  });

  it('uses model-supplied party size as deterministic ranking evidence', async () => {
    const output = await search({
      query: 'combo gà rán pepsi',
      partySize: 4,
      maxPriceVnd: 300000,
    });
    const bestText = normalized(
      `${output.items[0]?.name ?? ''} ${output.items[0]?.description ?? ''}`,
    );

    expect(output.items.every((item) => item.priceVnd <= 300000)).toBe(true);
    expect(bestText).toMatch(/4 mieng ga ran/);
    expect(bestText).toMatch(/4 ly pepsi/);
  });

  it('applies model-supplied price and category filters', async () => {
    const budget = await search({ maxPriceVnd: 300000 });
    const drinks = await search({ category: 'thuc uong' });

    expect(budget.items.length).toBeGreaterThan(0);
    expect(budget.items.every((item) => item.priceVnd <= 300000)).toBe(true);
    expect(drinks.items.length).toBeGreaterThan(0);
    expect(
      drinks.items.every((item) => item.category === 'Thức Uống & Tráng Miệng'),
    ).toBe(true);
  });

  it('excludes products above maxPriceVnd', async () => {
    const output = await search({ query: 'combo', maxPriceVnd: 100000 });

    expect(output.items.length).toBeGreaterThan(0);
    expect(output.items.every((item) => item.priceVnd <= 100000)).toBe(true);
  });

  it('filters by normalized category', async () => {
    const category = fixtures.menuItems.find(
      (item) => item.available,
    )?.category;
    expect(category).toBeDefined();

    const output = await search({
      mode: 'full',
      category: normalized(category!),
    });

    expect(output.items.length).toBeGreaterThan(0);
    expect(output.items.every((item) => item.category === category)).toBe(true);
  });

  it('matches model-supplied category wording by normalized token overlap', async () => {
    const output = await search({ mode: 'full', category: 'đồ uống' });
    const expected = fixtures.menuItems.filter(
      (item) => item.available && item.category === 'Thức Uống & Tráng Miệng',
    );

    expect(output.items.map((item) => item.code)).toEqual(
      expected.map((item) => item.code),
    );
  });

  it('rejects an over-specified category instead of broadening semantic qualifiers', async () => {
    const output = await search({
      mode: 'search',
      category: 'Combo gà cay',
      maxPriceVnd: 200000,
    });

    expect(output.items).toEqual([]);
  });

  it('treats a repeated category phrase as category browsing rather than a second text filter', async () => {
    const output = await search({
      mode: 'search',
      query: 'đồ uống',
      category: 'đồ uống',
    });
    const expected = fixtures.menuItems.filter(
      (item) => item.available && item.category === 'Thức Uống & Tráng Miệng',
    );

    expect(output.items.map((item) => item.code)).toEqual(
      expected.map((item) => item.code),
    );
  });

  it('ranks an item by a verified non-spicy modifier option', async () => {
    const output = await search({ query: 'Burger Gà Yo không cay' });

    expect(output.items[0]?.code).toBe('41042');
  });

  it('lets the model decompose separate modifier needs into efficient searches', async () => {
    const nonSpicy = await search({ query: 'gà không cay' });
    const cheese = await search({ query: 'gà phô mai' });

    expect(nonSpicy.items.map((item) => item.code)).toContain('41042');
    expect(cheese.items.map((item) => item.code)).toContain('41043');
  });

  it('ranks partial matches from a combined model-supplied modifier query without interpreting its semantics', async () => {
    const output = await search({ query: 'gà không cay phô mai' });

    expect(output.items.map((item) => item.code)).toEqual(
      expect.arrayContaining(['41042', '41043']),
    );
  });

  it('searches menu items and requested modifiers in one canonical tool call', async () => {
    const output = await search({
      query: 'gà',
      modifierQueries: ['không cay', 'pepsi'],
    });
    const combo = output.items.find((item) => item.code === '20702');

    expect(combo?.matchedModifiers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          query: 'không cay',
          name: expect.stringContaining('Không Cay'),
        }),
        expect.objectContaining({
          query: 'pepsi',
          name: expect.stringContaining('Pepsi'),
        }),
      ]),
    );
    expect(combo?.matchedModifiers).toHaveLength(2);
    expect(
      output.items.every((item) => item.matchesAllModifierQueries === true),
    ).toBe(true);
  });

  it('keeps candidates when product terms are mistakenly supplied as modifier queries without fabricating selectable-modifier evidence', async () => {
    const output = await search({
      query: 'combo 4 người',
      partySize: 4,
      maxPriceVnd: 300000,
      modifierQueries: ['gà rán', 'nước'],
    });
    const bestText = normalized(
      `${output.items[0]?.name ?? ''} ${output.items[0]?.category ?? ''} ${output.items[0]?.description ?? ''}`,
    );

    expect(output.items.length).toBeGreaterThan(0);
    expect(bestText).toContain('combo');
    expect(bestText).toContain('ga ran');
    expect(bestText).toMatch(/pepsi|nuoc/);
    expect(
      output.items.some(
        (item) =>
          item.matchesAllModifierQueries === false &&
          (item.matchedModifiers?.length ?? 0) <
            (['gà rán', 'nước'] as const).length,
      ),
    ).toBe(true);
  });

  it('requires all modifier queries to match the same item', async () => {
    const output = await search({
      query: 'gà',
      modifierQueries: ['không cay', 'phô mai'],
    });

    expect(output.total).toBe(0);
    expect(output.items).toEqual([]);
  });

  it('ranks broad fried-chicken matches deterministically with direct names first', async () => {
    const first = await search({ query: 'gà rán' });
    const second = await search({ query: 'gà rán' });
    const directNameIndex = first.items.findIndex((item) =>
      normalized(item.name).includes('ga ran'),
    );
    const descriptionOnlyIndex = first.items.findIndex(
      (item) =>
        !normalized(item.name).includes('ga ran') &&
        normalized(item.description).includes('ga ran'),
    );

    expect(first.items.map((item) => item.code)).toEqual(
      second.items.map((item) => item.code),
    );
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
      expect(Object.keys(item).sort()).toEqual(
        [
          'available',
          'category',
          'code',
          'description',
          'hasModifiers',
          'imageUrl',
          'isCustomize',
          'name',
          ...(item.matchedModifiers === undefined ? [] : ['matchedModifiers']),
          ...(item.matchesAllModifierQueries === undefined
            ? []
            : ['matchesAllModifierQueries']),
          ...(item.originalPriceVnd === undefined ? [] : ['originalPriceVnd']),
          'priceVnd',
        ].sort(),
      );
    }

    const itemWithModifiers = fixtures.menuModifiers.find(
      (item) => item.modifierGroups.length > 0,
    );
    expect(itemWithModifiers).toBeDefined();
    const details = await executeToolCall(
      clients,
      {
        toolName: 'getModifierOptions',
        arguments: { code: itemWithModifiers!.itemId },
      },
      { externalCallContext },
    );
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
