import { describe, expect, it } from 'vitest';
import { loadGeneratedFixtures } from '../../src/fixtures/loadFixtures.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import { OrderingDataService } from '../../src/ordering/orderingDataService.js';
import { executeToolCall } from '../../src/ordering/toolExecutor.js';

const externalCallContext = {
  signal: new AbortController().signal,
  deadlineAt: Date.now() + 60_000,
};

describe('OrderingDataService menu search', () => {
  it('preserves exact provider identifiers and fixture aliases through client tool execution', async () => {
    const fixtures = await loadGeneratedFixtures(process.cwd());
    const clients = createMockClients(fixtures);

    const byPosItemId = await executeToolCall(
      clients,
      {
        toolName: 'searchMenu',
        arguments: {
          mode: 'search',
          queries: ['150078'],
          modifierQueries: [],
        },
      },
      { externalCallContext },
    );
    const byAlias = await executeToolCall(
      clients,
      {
        toolName: 'searchMenu',
        arguments: {
          mode: 'search',
          queries: ['pesi'],
          modifierQueries: [],
        },
      },
      { externalCallContext },
    );

    expect(byPosItemId).toMatchObject({
      ok: true,
      value: {
        items: [expect.objectContaining({ code: '41172' })],
      },
    });
    expect(byAlias).toMatchObject({
      ok: true,
      value: {
        items: expect.arrayContaining([
          expect.objectContaining({ name: expect.stringContaining('Pepsi') }),
        ]),
      },
    });
  });

  it('does not certify a capped upstream menu collection as complete', async () => {
    const fixtures = await loadGeneratedFixtures(process.cwd());
    const baseClients = createMockClients(fixtures);
    const upstream = await baseClients.menu.searchMenu('', externalCallContext);
    if (!upstream.ok || !upstream.value) {
      throw new Error('Expected fixture menu');
    }
    const upstreamCollection = upstream.value;
    const partialClients = {
      ...baseClients,
      menu: {
        ...baseClients.menu,
        async searchMenu() {
          return {
            ok: true as const,
            value: {
              items: upstreamCollection.items.slice(0, 2),
              total: upstreamCollection.total,
              returned: 2,
              complete: false,
              scope: { scope: 'all' as const },
              cursor: 'menu-page-2',
            },
            message: 'partial_menu',
          };
        },
      },
    };

    const result = await executeToolCall(
      partialClients,
      {
        toolName: 'searchMenu',
        arguments: {
          mode: 'full',
          queries: [],
          modifierQueries: [],
        },
      },
      { externalCallContext },
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        total: upstreamCollection.total,
        returned: 2,
        complete: false,
        cursor: 'menu-page-2',
      },
    });
  });

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

  it('excludes an item priced exactly at a strict below-price boundary', async () => {
    const fixtures = await loadGeneratedFixtures(process.cwd());
    const service = new OrderingDataService(fixtures);
    const boundary = fixtures.menuItems.find(
      (item) => item.available && item.priceVnd > 0,
    )!.priceVnd;

    const result = service.searchMenuTool({
      queries: [],
      maxPriceExclusiveVnd: boundary,
    });

    expect(result.items.every((item) => item.priceVnd < boundary)).toBe(true);
    expect(
      result.items.some((item) => item.priceVnd === boundary),
    ).toBe(false);
  });

  it('narrows candidates to a model-supplied price interval', async () => {
    const fixtures = await loadGeneratedFixtures(process.cwd());
    const service = new OrderingDataService(fixtures);
    const clients = createMockClients(fixtures);

    const localResult = service.searchMenuTool({
      queries: [],
      minPriceVnd: 150_000,
      maxPriceVnd: 161_000,
    });
    const providerResult = await executeToolCall(
      clients,
      {
        toolName: 'searchMenu',
        arguments: {
          mode: 'search',
          queries: [],
          minPriceVnd: 150_000,
          maxPriceVnd: 161_000,
          modifierQueries: [],
        },
      },
      { externalCallContext },
    );

    expect(localResult.items.length).toBeGreaterThan(0);
    expect(
      localResult.items.every(
        (item) => item.priceVnd >= 150_000 && item.priceVnd <= 161_000,
      ),
    ).toBe(true);
    expect(providerResult).toMatchObject({
      ok: true,
      value: {
        items: expect.arrayContaining([
          expect.objectContaining({ priceVnd: 159_000 }),
        ]),
      },
    });
    expect(
      (
        providerResult.value as
          | { items: Array<{ priceVnd: number }> }
          | undefined
      )?.items.every(
        (item) => item.priceVnd >= 150_000 && item.priceVnd <= 161_000,
      ),
    ).toBe(true);
  });

  it('rejects an over-specified category instead of dropping its qualifier', async () => {
    const fixtures = await loadGeneratedFixtures(process.cwd());
    const service = new OrderingDataService(fixtures);

    const result = service.searchMenuTool({
      mode: 'search',
      queries: [],
      category: 'Combo gà cay',
      maxPriceVnd: 200_000,
    });

    expect(result.items).toEqual([]);
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
