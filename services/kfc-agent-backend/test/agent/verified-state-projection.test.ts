import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import {
  loadVerifiedStateProjection,
  persistVerifiedStateProjection,
} from '../../src/agent/verifiedState.js';

const kfcRef = { packId: 'kfc-vietnam', version: '1.0.0' } as const;
const parseState = (value: unknown): { cartId?: string } => {
  if (
    typeof value !== 'object' ||
    value === null ||
    ('cartId' in value && typeof value.cartId !== 'string')
  ) {
    throw new Error('state_invalid');
  }
  return value as { cartId?: string };
};

describe('verified state projection', () => {
  it('round-trips validated typed state through the pack projection', async () => {
    const store = new MemoryStore();
    await persistVerifiedStateProjection({
      store,
      sessionId: 'session-a',
      packRef: kfcRef,
      schemaVersion: '1',
      state: { cartId: 'cart-a' },
    });

    await expect(
      loadVerifiedStateProjection({
        store,
        sessionId: 'session-a',
        packRef: kfcRef,
        schemaVersion: '1',
        parseState,
        allowLegacyKfcV1Fallback: true,
      }),
    ).resolves.toEqual({ cartId: 'cart-a' });
  });

  it('allows the legacy event fallback only for kfc-vietnam v1', async () => {
    const store = new MemoryStore();
    await store.appendEvent('session-a', 'agent:verified_state', {
      verifiedState: { cartId: 'legacy-cart' },
    });

    await expect(
      loadVerifiedStateProjection({
        store,
        sessionId: 'session-a',
        packRef: kfcRef,
        schemaVersion: '1',
        parseState,
        allowLegacyKfcV1Fallback: true,
      }),
    ).resolves.toEqual({ cartId: 'legacy-cart' });
    await expect(
      loadVerifiedStateProjection({
        store,
        sessionId: 'session-a',
        packRef: { packId: 'pvcfc-public', version: '1.0.0' },
        schemaVersion: '1',
        parseState,
        allowLegacyKfcV1Fallback: true,
      }),
    ).rejects.toThrow('pack_state_legacy_fallback_forbidden');
  });
});
