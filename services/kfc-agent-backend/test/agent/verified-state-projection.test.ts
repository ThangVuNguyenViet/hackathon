import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import {
  loadVerifiedStateProjection,
  persistVerifiedStateProjection,
} from '../../src/agent/verifiedState.js';
import { kfcVerifiedStateSnapshotSchema } from '../../src/businessPacks/kfcVietnam/kfcVerifiedStateSchema.js';
import { initialRecommendationState } from '../../src/recommendations/state/state-machine.js';

const kfcRef = { packId: 'kfc-vietnam', version: '1.0.0' } as const;
const parseState = (value: unknown) => {
  const parsed = kfcVerifiedStateSnapshotSchema.safeParse(value);
  if (!parsed.success) throw new Error('state_invalid');
  return parsed.data;
};

describe('verified state projection', () => {
  it('round-trips durable recommendation state through the version-1 KFC pack projection', async () => {
    const store = new MemoryStore();
    const recommendationState = initialRecommendationState('order-flow-001');
    await persistVerifiedStateProjection({
      store,
      sessionId: 'session-a',
      packRef: kfcRef,
      schemaVersion: '1',
      state: { recommendationState },
    });

    await expect(
      loadVerifiedStateProjection({
        store,
        sessionId: 'session-a',
        packRef: kfcRef,
        schemaVersion: '1',
        parseState,
      }),
    ).resolves.toEqual({ recommendationState });
  });

  it('parses old version-1 KFC envelopes that lack recommendation state', async () => {
    const store = new MemoryStore();
    await persistVerifiedStateProjection({
      store,
      sessionId: 'session-a',
      packRef: kfcRef,
      schemaVersion: '1',
      state: {},
    });

    await expect(
      loadVerifiedStateProjection({
        store,
        sessionId: 'session-a',
        packRef: kfcRef,
        schemaVersion: '1',
        parseState,
      }),
    ).resolves.toEqual({});
  });

  it('does not recover business state from a legacy event bag', async () => {
    const store = new MemoryStore();

    await expect(
      loadVerifiedStateProjection({
        store,
        sessionId: 'session-a',
        packRef: kfcRef,
        schemaVersion: '1',
        parseState,
      }),
    ).resolves.toBeUndefined();
  });
});
