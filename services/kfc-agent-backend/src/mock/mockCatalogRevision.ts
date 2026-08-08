import { createHash } from 'node:crypto';
import type { GeneratedFixtures } from '../fixtures/schema.js';

export function mockCatalogRevision(
  fixtures: Pick<GeneratedFixtures, 'menuItems'>,
): string {
  const payload = JSON.stringify(
    fixtures.menuItems.map((item) => [
      item.code,
      item.priceVnd,
      item.available,
    ]),
  );
  return `fixture-${createHash('sha256').update(payload).digest('hex')}`;
}
