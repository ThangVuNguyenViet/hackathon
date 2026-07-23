import { describe, expect, it } from 'vitest';
import {
  createPackStateEnvelope,
  validatePackStateEnvelope,
} from '../../src/runtime/businessPack.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';

const kfcRef = { packId: 'kfc-vietnam', version: '1.0.0' } as const;

describe('pack-state projection', () => {
  it('stores one isolated current envelope per session and pack ref', async () => {
    const store = new MemoryStore();
    const envelope = await createPackStateEnvelope({
      packRef: kfcRef,
      schemaVersion: '1',
      state: { cartId: 'cart-a' },
    });
    await store.putPackState('session-a', envelope);

    expect(await store.getPackState('session-a', kfcRef)).toEqual(envelope);
    expect(
      await store.getPackState('session-a', {
        packId: 'pvcfc-public',
        version: '1.0.0',
      }),
    ).toBeUndefined();
    expect(await store.getPackState('session-b', kfcRef)).toBeUndefined();
  });

  it('does not make a stored hash, ref, or schema mismatch authoritative', async () => {
    const store = new MemoryStore();
    const envelope = await createPackStateEnvelope({
      packRef: kfcRef,
      schemaVersion: '1',
      state: { cartId: 'cart-a' },
    });
    await store.putPackState('session-a', envelope);
    const stored = await store.getPackState('session-a', kfcRef);

    await expect(
      validatePackStateEnvelope(
        { ...stored, state: { cartId: 'tampered' } },
        {
          packRef: kfcRef,
          schemaVersion: '1',
          parseState: (value) => value,
        },
      ),
    ).rejects.toThrow('pack_state_integrity_mismatch');
    await expect(
      validatePackStateEnvelope(stored, {
        packRef: { packId: 'kfc-vietnam', version: '2.0.0' },
        schemaVersion: '1',
        parseState: (value) => value,
      }),
    ).rejects.toThrow('pack_state_ref_mismatch');
    await expect(
      validatePackStateEnvelope(stored, {
        packRef: kfcRef,
        schemaVersion: '2',
        parseState: (value) => value,
      }),
    ).rejects.toThrow('pack_state_schema_mismatch');
  });
});
