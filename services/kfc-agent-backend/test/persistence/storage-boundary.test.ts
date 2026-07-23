import { describe, expect, it } from 'vitest';
import type { CatalogObservation } from '../../src/catalog/catalogObservation.js';
import type {
  ConversationStore,
  SandboxProofSession,
} from '../../src/persistence/contracts.js';
import { D1Store } from '../../src/persistence/d1Store.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import { createPackStateEnvelope } from '../../src/runtime/businessPack.js';
import { SqliteD1Database } from '../support/sqlite-d1.js';

const observation: CatalogObservation = {
  id: 'catalog-a',
  environment: 'sandbox',
  sourceUrl: 'https://example.test/menu',
  providerFingerprint: 'provider-a',
  observedAt: '2026-07-24T00:00:00.000Z',
  sha256: 'a'.repeat(64),
  itemCount: 0,
  modifierTreeCount: 0,
  items: [],
};

const proof: SandboxProofSession = {
  sessionId: 'session-a',
  customerId: 'customer-a',
  authenticated: true,
  expiresAt: '2026-07-24T01:00:00.000Z',
  orderId: 'order-a',
  providerProfile: { deliveryEtaMinutes: 20 },
  createdAt: '2026-07-24T00:00:00.000Z',
};

async function storeFixtures(): Promise<
  Array<{ name: string; store: ConversationStore; close: () => void }>
> {
  const database = new SqliteD1Database();
  const d1 = new D1Store(database);
  await d1.initialize();
  return [
    { name: 'memory', store: new MemoryStore(), close: () => undefined },
    { name: 'd1', store: d1, close: () => database.close() },
  ];
}

describe('Memory and D1 storage boundary parity', () => {
  it('searches the canonical transcript without an event copy', async () => {
    for (const fixture of await storeFixtures()) {
      try {
        await fixture.store.appendTurn({
          sessionId: 'session-a',
          channel: 'kfc',
          role: 'user',
          text: 'Tôi muốn gà giòn',
          externalMessageId: null,
          externalUserId: 'customer-a',
          deliveryStatus: 'received',
          metadata: null,
        });
        await fixture.store.appendTurn({
          sessionId: 'session-b',
          channel: 'kfc',
          role: 'user',
          text: 'gà giòn ở phiên khác',
          externalMessageId: null,
          externalUserId: 'customer-b',
          deliveryStatus: 'received',
          metadata: null,
        });

        expect(await fixture.store.searchHistory('session-a', 'GÀ GIÒN')).toMatchObject([
          { sessionId: 'session-a', ordinal: 1, text: 'Tôi muốn gà giòn' },
        ]);
      } finally {
        fixture.close();
      }
    }
  });

  it('round-trips explicit catalog and sandbox proof projections', async () => {
    for (const fixture of await storeFixtures()) {
      try {
        await fixture.store.putCatalogPin({
          sessionId: 'session-a',
          observation,
          updatedAt: observation.observedAt,
        });
        await fixture.store.putSandboxProofSession(proof);

        await expect(
          fixture.store.getCatalogPin('session-a'),
        ).resolves.toEqual({
          sessionId: 'session-a',
          observation,
          updatedAt: observation.observedAt,
        });
        await expect(
          fixture.store.getSandboxProofSession('session-a'),
        ).resolves.toEqual(proof);
      } finally {
        fixture.close();
      }
    }
  });

  it('reset clears summaries, typed state, catalog pins, and proof sessions', async () => {
    for (const fixture of await storeFixtures()) {
      try {
        const envelope = await createPackStateEnvelope({
          packRef: { packId: 'kfc-vietnam', version: '1.0.0' },
          schemaVersion: '1',
          state: { cartId: 'cart-a' },
        });
        await fixture.store.compareAndSwapConversationSummary({
          sessionId: 'session-a',
          expectedRevision: null,
          expectedThroughOrdinal: 0,
          text: 'summary',
          throughOrdinal: 2,
          updatedAt: '2026-07-24T00:00:00.000Z',
        });
        await fixture.store.putPackState('session-a', envelope);
        await fixture.store.putCatalogPin({
          sessionId: 'session-a',
          observation,
          updatedAt: observation.observedAt,
        });
        await fixture.store.putSandboxProofSession(proof);

        await fixture.store.resetSession('session-a');

        await expect(
          fixture.store.getConversationSummary('session-a'),
        ).resolves.toBeUndefined();
        await expect(
          fixture.store.getPackState('session-a', envelope.packRef),
        ).resolves.toBeUndefined();
        await expect(
          fixture.store.getCatalogPin('session-a'),
        ).resolves.toBeUndefined();
        await expect(
          fixture.store.getSandboxProofSession('session-a'),
        ).resolves.toBeUndefined();
      } finally {
        fixture.close();
      }
    }
  });
});
