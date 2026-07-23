import { describe, expect, it } from 'vitest';
import { loadGeneratedFixtures } from '../../src/fixtures/loadFixtures.js';
import { OrderingDataService } from '../../src/ordering/orderingDataService.js';

describe('OrderingDataService menu search', () => {
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
