import { describe, expect, it } from 'vitest';
import { D1Store } from '../../src/persistence/d1Store.js';
import {
  MemoryStore,
  type ConversationStore,
} from '../../src/persistence/memoryStore.js';
import { SqliteD1Database } from '../support/sqlite-d1.js';

type StoreFixture = {
  store: ConversationStore;
  close(): void;
};

const stores: Array<{
  name: string;
  create(): Promise<StoreFixture>;
}> = [
  {
    name: 'MemoryStore',
    create: async () => ({
      store: new MemoryStore(),
      close: () => undefined,
    }),
  },
  {
    name: 'D1Store',
    create: async () => {
      const database = new SqliteD1Database();
      const store = new D1Store(database);
      await store.initialize();
      return {
        store,
        close: () => database.close(),
      };
    },
  },
];

describe.each(stores)(
  '$name irreversible operation finalization',
  ({ create }) => {
    it('replays a safe receipt before final response and the final response afterward', async () => {
      const fixture = await create();
      try {
        const input = {
          requestId: 'trusted-action-finalization',
          sessionId: 'kfc:trusted-action-finalization',
          operation: 'genui_action:recommendation_select:action-1',
          bindingFingerprint: 'a'.repeat(64),
        };
        const reserved =
          await fixture.store.reserveIrreversibleOperation?.(input);
        if (!reserved || reserved.status !== 'reserved') {
          throw new Error('Expected irreversible reservation');
        }
        const fallback = {
          status: 200,
          body: {
            responseText: 'Đã cập nhật lựa chọn gợi ý của bạn.',
            trustedActionResult: { status: 'succeeded' },
          },
        };
        const final = {
          status: 200,
          body: {
            responseText: 'Đã thêm món.',
            genUi: { id: 'cart-after-action', widgetKind: 'cartBuilder' },
            trustedActionResult: { status: 'succeeded' },
          },
        };

        await expect(
          fixture.store.completeIrreversibleOperation?.(
            input,
            reserved,
            fallback,
          ),
        ).resolves.toEqual({ status: 'completed', result: fallback });
        await expect(
          fixture.store.reserveIrreversibleOperation?.(input),
        ).resolves.toEqual({ status: 'completed', result: fallback });

        await expect(
          fixture.store.finalizeIrreversibleOperation?.(
            input,
            reserved,
            final,
          ),
        ).resolves.toEqual({ status: 'finalized', result: final });
        await expect(
          fixture.store.reserveIrreversibleOperation?.(input),
        ).resolves.toEqual({ status: 'completed', result: final });
        await expect(
          fixture.store.finalizeIrreversibleOperation?.(
            input,
            { ...reserved, leaseToken: 'forged-owner-token' },
            {
              status: 200,
              body: { responseText: 'forged replacement' },
            },
          ),
        ).resolves.toEqual({ status: 'lost' });
        await expect(
          fixture.store.reserveIrreversibleOperation?.(input),
        ).resolves.toEqual({ status: 'completed', result: final });
      } finally {
        fixture.close();
      }
    });
  },
);
