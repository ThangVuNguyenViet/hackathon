import { describe, expect, it } from 'vitest';
import { loadGeneratedFixtures } from '../../src/fixtures/loadFixtures.js';
import { OrderingDataService } from '../../src/ordering/orderingDataService.js';

describe('OrderingDataService menu search', () => {
  it('returns the complete available menu without truncation for full scope', async () => {
    const fixtures = await loadGeneratedFixtures(process.cwd());
    const service = new OrderingDataService(fixtures);

    const result = service.searchMenuTool({
      mode: 'full',
      queries: [],
    });
    const available = fixtures.menuItems.filter((item) => item.available);

    expect(result.total).toBe(available.length);
    expect(result.items.map((item) => item.code)).toEqual(
      available.map((item) => item.code),
    );
    expect(result.items.length).toBeGreaterThan(10);
  });

  it('treats targeted queries as independent alternatives', async () => {
    const fixtures = await loadGeneratedFixtures(process.cwd());
    const service = new OrderingDataService(fixtures);
    const requested = fixtures.menuItems
      .filter((item) => item.available)
      .slice(0, 2);

    const result = service.searchMenuTool({
      queries: requested.map((item) => item.code),
    });

    expect(new Set(result.items.map((item) => item.code))).toEqual(
      new Set(requested.map((item) => item.code)),
    );
  });

  it('uses category, price ceiling, and party size as catalog-backed discovery evidence', async () => {
    const fixtures = await loadGeneratedFixtures(process.cwd());
    const service = new OrderingDataService(fixtures);

    const drinks = service.searchMenuTool({
      queries: [],
      category: 'do uong',
      maxPriceVnd: 50_000,
    });
    const party = service.searchMenuTool({
      queries: ['combo gà rán pepsi'],
      partySize: 4,
      maxPriceVnd: 300_000,
    });

    expect(drinks.items.length).toBeGreaterThan(0);
    expect(
      drinks.items.every(
        (item) =>
          item.category === 'Thức Uống & Tráng Miệng' &&
          item.priceVnd <= 50_000,
      ),
    ).toBe(true);
    expect(
      `${party.items[0]?.name ?? ''} ${party.items[0]?.description ?? ''}`,
    ).toMatch(/4/);
  });

  it('returns exact selectable-option evidence for requested modifiers', async () => {
    const fixtures = await loadGeneratedFixtures(process.cwd());
    const service = new OrderingDataService(fixtures);

    const result = service.searchMenuTool({
      queries: ['gà'],
      modifierQueries: ['không cay', 'pepsi'],
    });
    const matchingItem = result.items.find((item) => item.code === '20702');

    expect(matchingItem?.matchesAllModifierQueries).toBe(true);
    expect(matchingItem?.matchedModifiers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ query: 'không cay' }),
        expect.objectContaining({ query: 'pepsi' }),
      ]),
    );
  });

  it('matches normalized Vietnamese menu text and returns the strongest name match first', async () => {
    const fixtures = await loadGeneratedFixtures(process.cwd());
    const service = new OrderingDataService(fixtures);

    const results = service.searchMenu('combo day da');

    expect(results[0]?.name).toBe('Combo Đẫy Đà 129K');
    expect(results[0]?.provenance.sourceFile).toBeTruthy();
  });

  it('can retrieve a menu item through a verified modifier alias', async () => {
    const fixtures = await loadGeneratedFixtures(process.cwd());
    const service = new OrderingDataService(fixtures);

    const results = service.searchMenu('khong cay');

    expect(results.length).toBeGreaterThan(0);
    expect(results.some((item) => item.hasModifiers)).toBe(true);
  });
});
