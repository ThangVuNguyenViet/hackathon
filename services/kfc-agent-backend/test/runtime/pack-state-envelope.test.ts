import { describe, expect, it } from 'vitest';
import {
  createPackStateEnvelope,
  validatePackStateEnvelope,
  type PackRef,
} from '../../src/runtime/businessPack.js';

const kfcRef: PackRef = {
  packId: 'kfc-vietnam',
  version: '1.0.0',
};

describe('pack state envelope', () => {
  it('round-trips typed state only when its integrity binding is intact', async () => {
    const envelope = await createPackStateEnvelope({
      packRef: kfcRef,
      schemaVersion: '1',
      state: { cartId: 'cart-1' },
    });

    await expect(
      validatePackStateEnvelope(envelope, {
        packRef: kfcRef,
        schemaVersion: '1',
        parseState(value) {
          const state = value as { cartId?: unknown };
          if (typeof state.cartId !== 'string') {
            throw new Error('invalid_kfc_state');
          }
          return { cartId: state.cartId };
        },
      }),
    ).resolves.toEqual({ cartId: 'cart-1' });

    await expect(
      validatePackStateEnvelope(
        {
          ...envelope,
          state: { cartId: 'cart-tampered' },
        },
        {
          packRef: kfcRef,
          schemaVersion: '1',
          parseState: (value) => value,
        },
      ),
    ).rejects.toThrow('pack_state_integrity_mismatch');
  });

  it('rejects pack-ref and schema mismatches before parsing state', async () => {
    const envelope = await createPackStateEnvelope({
      packRef: kfcRef,
      schemaVersion: '1',
      state: { cartId: 'cart-1' },
    });
    let parseCount = 0;
    const parseState = (value: unknown): unknown => {
      parseCount += 1;
      return value;
    };

    await expect(
      validatePackStateEnvelope(envelope, {
        packRef: { packId: 'pvcfc-public', version: '1.0.0' },
        schemaVersion: '1',
        parseState,
      }),
    ).rejects.toThrow('pack_state_ref_mismatch');
    await expect(
      validatePackStateEnvelope(envelope, {
        packRef: kfcRef,
        schemaVersion: '2',
        parseState,
      }),
    ).rejects.toThrow('pack_state_schema_mismatch');
    expect(parseCount).toBe(0);
  });
});
