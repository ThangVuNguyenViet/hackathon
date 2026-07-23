import { afterEach, describe, expect, it } from 'vitest';
import { D1Store } from '../../src/persistence/d1Store.js';
import { createPackStateEnvelope } from '../../src/runtime/businessPack.js';
import { SqliteD1Database } from '../support/sqlite-d1.js';

const databases: SqliteD1Database[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

async function storeFixture(): Promise<{
  database: SqliteD1Database;
  store: D1Store;
}> {
  const database = new SqliteD1Database();
  databases.push(database);
  const store = new D1Store(database);
  await store.initialize();
  return { database, store };
}

describe('D1 context and state contract', () => {
  it('allocates unique monotonic ordinals under concurrent append calls', async () => {
    const { store } = await storeFixture();

    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        store.appendTurn({
          sessionId: 'session-a',
          channel: 'kfc',
          role: index % 2 === 0 ? 'user' : 'assistant',
          text: `turn-${index}`,
          externalMessageId: null,
          externalUserId: 'customer-a',
          deliveryStatus: 'received',
          metadata: null,
        }),
      ),
    );

    expect(
      (await store.listTurns('session-a')).map((turn) => turn.ordinal),
    ).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
  });

  it('rolls back compatibility and pack state when assistant insertion fails', async () => {
    const { database, store } = await storeFixture();
    database.sqlite.exec(`
      CREATE TRIGGER fail_assistant_turn
      BEFORE INSERT ON conversation_turns
      WHEN NEW.role = 'assistant'
      BEGIN
        SELECT RAISE(ABORT, 'injected assistant failure');
      END;
    `);
    const envelope = await createPackStateEnvelope({
      packRef: { packId: 'kfc-vietnam', version: '1.0.0' },
      schemaVersion: '1',
      state: { cartId: 'cart-a' },
    });

    await expect(
      store.commitAssistantTurn({
        stateEvent: {
          sessionId: 'session-a',
          sourceType: 'agent:verified_state',
          payload: { verifiedState: { cartId: 'cart-a' } },
        },
        packState: { sessionId: 'session-a', envelope },
        assistantTurn: {
          sessionId: 'session-a',
          channel: 'kfc',
          role: 'assistant',
          text: 'Ready',
          externalMessageId: null,
          externalUserId: 'customer-a',
          deliveryStatus: 'pending',
          metadata: null,
        },
      }),
    ).rejects.toThrow('injected assistant failure');

    expect(await store.listTurns('session-a')).toEqual([]);
    expect(await store.listEvents('session-a')).toEqual([]);
    expect(
      await store.getPackState('session-a', envelope.packRef),
    ).toBeUndefined();
  });
});
