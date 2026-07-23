import {
  emptyCheckpoint,
  type BaseCheckpointSaver,
  type CheckpointTuple,
} from '@langchain/langgraph';
import { describe, expect, it, vi } from 'vitest';
import type {
  CheckpointIdentifier,
  ConversationStore,
} from '../../src/persistence/contracts.js';
import {
  createKfcStateGraphProofSource,
} from '../../src/proof/kfcStateGraphProofSource.js';

const identity: CheckpointIdentifier = {
  checkpointThreadId: 'agent:["session-proof","run:request-proof"]',
  checkpointNamespace: '',
  checkpointId: 'checkpoint-leaf',
  parentCheckpointId: 'checkpoint-parent',
};

function tupleFor(input: {
  tupleThreadId?: string;
  tupleNamespace?: string;
  tupleCheckpointId?: string;
  checkpointId?: string;
  parentThreadId?: string;
  parentNamespace?: string;
  parentCheckpointId?: string;
  includeParent?: boolean;
} = {}): CheckpointTuple {
  const tupleThreadId =
    input.tupleThreadId ?? identity.checkpointThreadId;
  const tupleNamespace =
    input.tupleNamespace ?? identity.checkpointNamespace;
  const tupleCheckpointId =
    input.tupleCheckpointId ?? identity.checkpointId;
  const includeParent = input.includeParent ?? true;
  return {
    config: {
      configurable: {
        thread_id: tupleThreadId,
        checkpoint_ns: tupleNamespace,
        checkpoint_id: tupleCheckpointId,
      },
    },
    checkpoint: {
      ...emptyCheckpoint(),
      id: input.checkpointId ?? identity.checkpointId,
      channel_values: { phase: 'complete' },
    },
    metadata: {
      source: 'loop',
      step: 1,
      parents: {},
    },
    ...(includeParent
      ? {
          parentConfig: {
            configurable: {
              thread_id:
                input.parentThreadId ?? identity.checkpointThreadId,
              checkpoint_ns:
                input.parentNamespace ?? identity.checkpointNamespace,
              checkpoint_id:
                input.parentCheckpointId ??
                identity.parentCheckpointId ??
                undefined,
            },
          },
        }
      : {}),
  };
}

function proofSourceForTuple(tuple: CheckpointTuple | undefined) {
  const getTuple = vi.fn<BaseCheckpointSaver['getTuple']>(
    async () => tuple,
  );
  const listTurns = vi.fn<
    Pick<ConversationStore, 'listTurns'>['listTurns']
  >(async () => []);
  const listEvents = vi.fn<
    Pick<ConversationStore, 'listEvents'>['listEvents']
  >(async () => []);
  const listCheckpointIdentifiers = vi.fn<
    Pick<
      ConversationStore,
      'listCheckpointIdentifiers'
    >['listCheckpointIdentifiers']
  >(async () => [identity]);
  return {
    getTuple,
    listTurns,
    listEvents,
    listCheckpointIdentifiers,
    source: createKfcStateGraphProofSource({
      store: {
        listTurns,
        listEvents,
        listCheckpointIdentifiers,
      },
      checkpointer: { getTuple },
    }),
  };
}

describe('KFC StateGraph proof source', () => {
  it('requests the exact checkpoint and accepts an exact parent binding', async () => {
    const fixture = proofSourceForTuple(tupleFor());

    const read = await fixture.source.readExactCheckpoint(identity);

    expect(fixture.getTuple).toHaveBeenCalledWith({
      configurable: {
        thread_id: identity.checkpointThreadId,
        checkpoint_ns: identity.checkpointNamespace,
        checkpoint_id: identity.checkpointId,
      },
    });
    expect(read).toMatchObject({
      identity,
      channelValues: { phase: 'complete' },
    });
    expect(read?.sourceDigest).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('loads the three durable evidence inventories for the same session', async () => {
    const fixture = proofSourceForTuple(tupleFor());

    await expect(
      fixture.source.readSessionEvidence('session-proof'),
    ).resolves.toEqual({
      turns: [],
      events: [],
      checkpointIdentifiers: [identity],
    });
    expect(fixture.listTurns).toHaveBeenCalledWith('session-proof');
    expect(fixture.listEvents).toHaveBeenCalledWith('session-proof');
    expect(
      fixture.listCheckpointIdentifiers,
    ).toHaveBeenCalledWith('session-proof');
  });

  it.each([
    ['tuple thread', { tupleThreadId: 'agent:["other","run:x"]' }],
    ['tuple namespace', { tupleNamespace: 'unexpected' }],
    ['tuple checkpoint config', { tupleCheckpointId: 'other' }],
    ['checkpoint payload id', { checkpointId: 'other' }],
    ['missing parent', { includeParent: false }],
    ['parent thread', { parentThreadId: 'agent:["other","run:x"]' }],
    ['parent namespace', { parentNamespace: 'unexpected' }],
    ['parent checkpoint', { parentCheckpointId: 'other' }],
  ])('rejects a mismatched %s', async (_label, override) => {
    const fixture = proofSourceForTuple(tupleFor(override));

    await expect(
      fixture.source.readExactCheckpoint(identity),
    ).resolves.toBeUndefined();
  });

  it('accepts only an absent parentConfig for a root checkpoint', async () => {
    const rootIdentity: CheckpointIdentifier = {
      ...identity,
      checkpointId: 'checkpoint-root',
      parentCheckpointId: null,
    };
    const rootTuple = tupleFor({
      tupleCheckpointId: rootIdentity.checkpointId,
      checkpointId: rootIdentity.checkpointId,
      includeParent: false,
    });
    const rootFixture = proofSourceForTuple(rootTuple);

    await expect(
      rootFixture.source.readExactCheckpoint(rootIdentity),
    ).resolves.toMatchObject({ identity: rootIdentity });

    const unexpectedParentFixture = proofSourceForTuple({
      ...rootTuple,
      parentConfig: {
        configurable: {
          thread_id: rootIdentity.checkpointThreadId,
          checkpoint_ns: rootIdentity.checkpointNamespace,
          checkpoint_id: 'unexpected-parent',
        },
      },
    });
    await expect(
      unexpectedParentFixture.source.readExactCheckpoint(rootIdentity),
    ).resolves.toBeUndefined();
  });

  it('fails closed when no checkpointer is configured', async () => {
    const source = createKfcStateGraphProofSource({
      store: {
        async listTurns() {
          return [];
        },
        async listEvents() {
          return [];
        },
        async listCheckpointIdentifiers() {
          return [];
        },
      },
    });

    await expect(
      source.readExactCheckpoint(identity),
    ).resolves.toBeUndefined();
  });
});
