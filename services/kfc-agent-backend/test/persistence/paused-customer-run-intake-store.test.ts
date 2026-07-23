import { describe, expect, it } from 'vitest';
import {
  CustomerRunIdempotencyConflictError,
} from '../../src/customerRuns/contracts.js';
import type {
  CommitPausedCustomerRunIntakeInput,
  ConversationStore,
} from '../../src/persistence/contracts.js';
import { D1Store } from '../../src/persistence/d1Store.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import { FakeD1Database } from '../support/fakeD1Database.js';

const sessionId = 'kfc:paused-customer';
const customerId = 'paused-customer';
const clientMessageId = 'paused-message-1';
const pausedAt = '2026-07-20T08:00:00.000Z';

function pausedIntake(
  overrides: {
    runId?: string;
    requestFingerprint?: string;
    expectedSessionAuthorityGeneration?: number;
  } = {},
): CommitPausedCustomerRunIntakeInput {
  const runId = overrides.runId ?? 'paused-run-1';
  return {
    expectedSessionAuthorityGeneration:
      overrides.expectedSessionAuthorityGeneration ?? 1,
    run: {
      id: runId,
      schemaVersion: 1,
      sessionId,
      customerId,
      clientMessageId,
      requestFingerprint:
        overrides.requestFingerprint ?? 'sha256:paused-message-1',
      generation: 1,
      status: 'superseded',
      phase: 'finalizing',
      nextEventSequence: 1,
      clientSchemaVersion: 1,
      acceptedAt: pausedAt,
      startedAt: null,
      terminalAt: pausedAt,
      updatedAt: pausedAt,
    },
    userTurn: {
      sessionId,
      channel: 'kfc',
      role: 'user',
      text: 'Cho mình xem thực đơn',
      externalMessageId: clientMessageId,
      externalUserId: customerId,
      deliveryStatus: 'received',
      metadata: {
        rawEvent: {
          source: 'kfc_customer_run',
          intake: 'human_paused',
        },
      },
      createdAt: pausedAt,
    },
    events: [{
      schemaVersion: 1,
      eventId: `${runId}-superseded`,
      runId,
      expectedSequence: 1,
      type: 'run_superseded',
      occurredAt: pausedAt,
      payload: {
        status: 'superseded',
        suppressed: true,
        agentMode: 'human_paused',
      },
    }],
  };
}

async function pauseSession(store: ConversationStore): Promise<number> {
  const result = await store.transitionSessionAuthority({
    sessionId,
    expectedGeneration: 0,
    agentMode: 'human_paused',
    assignedAgentId: 'human-agent-1',
    updatedAt: pausedAt,
  });
  expect(result.status).toBe('transitioned');
  expect(result.control.sessionAuthorityGeneration).toBe(1);
  return result.control.sessionAuthorityGeneration;
}

function verifyPausedCustomerRunIntakeContract(
  storeName: string,
  createStore: () => ConversationStore | Promise<ConversationStore>,
) {
  describe(storeName, () => {
    it('atomically commits one terminal run, canonical user turn, and exact superseded event', async () => {
      const store = await createStore();
      const generation = await pauseSession(store);
      const input = pausedIntake({
        expectedSessionAuthorityGeneration: generation,
      });

      const result = await store.commitPausedCustomerRunIntake(input);

      if (result.status === 'stale') {
        throw new Error('paused intake unexpectedly became stale');
      }
      expect(result).toEqual({
        status: 'committed',
        run: {
          ...input.run,
          sessionAuthorityGeneration: generation,
          nextEventSequence: 2,
        },
        turn: {
          ...input.userTurn,
          id: expect.any(String),
          metadata: input.userTurn.metadata,
        },
        events: [{
          schemaVersion: 1,
          eventId: 'paused-run-1-superseded',
          runId: 'paused-run-1',
          sequence: 1,
          type: 'run_superseded',
          occurredAt: pausedAt,
          payload: {
            status: 'superseded',
            suppressed: true,
            agentMode: 'human_paused',
          },
        }],
      });
      await expect(
        store.getCustomerRun(input.run.id),
      ).resolves.toEqual(result.run);
      await expect(store.listTurns(sessionId)).resolves.toEqual([
        result.turn,
      ]);
      await expect(
        store.listCustomerRunEvents(input.run.id),
      ).resolves.toEqual(result.events);
    });

    it('replays the same fingerprint without duplicating any durable record', async () => {
      const store = await createStore();
      const generation = await pauseSession(store);
      const input = pausedIntake({
        expectedSessionAuthorityGeneration: generation,
      });

      const committed = await store.commitPausedCustomerRunIntake(input);
      const replayed = await store.commitPausedCustomerRunIntake({
        ...input,
        run: { ...input.run, id: 'ignored-replay-run-id' },
        events: [{
          ...input.events[0]!,
          eventId: 'ignored-replay-event-id',
          runId: 'ignored-replay-run-id',
        }],
      });

      expect(committed.status).toBe('committed');
      expect(replayed.status).toBe('replayed');
      if (committed.status === 'stale' || replayed.status === 'stale') {
        throw new Error('paused intake unexpectedly became stale');
      }
      expect(replayed.run).toEqual(committed.run);
      expect(replayed.turn).toEqual(committed.turn);
      expect(replayed.events).toEqual(committed.events);
      await expect(store.listTurns(sessionId)).resolves.toHaveLength(1);
      await expect(
        store.listCustomerRunEvents(committed.run.id),
      ).resolves.toHaveLength(1);
      await expect(
        store.getCustomerRun('ignored-replay-run-id'),
      ).resolves.toBeUndefined();
    });

    it('serializes concurrent duplicate intake into one commit and one replay', async () => {
      const store = await createStore();
      const generation = await pauseSession(store);
      const input = pausedIntake({
        expectedSessionAuthorityGeneration: generation,
      });

      const results = await Promise.all([
        store.commitPausedCustomerRunIntake(input),
        store.commitPausedCustomerRunIntake(input),
      ]);

      expect(
        results.map(({ status }) => status).sort(),
      ).toEqual(['committed', 'replayed']);
      await expect(store.listTurns(sessionId)).resolves.toHaveLength(1);
      await expect(
        store.listCustomerRunEvents(input.run.id),
      ).resolves.toHaveLength(1);
    });

    it('rejects a reused request identity with a conflicting fingerprint', async () => {
      const store = await createStore();
      const generation = await pauseSession(store);
      const input = pausedIntake({
        expectedSessionAuthorityGeneration: generation,
      });
      await store.commitPausedCustomerRunIntake(input);

      await expect(
        store.commitPausedCustomerRunIntake(pausedIntake({
          runId: 'conflicting-run',
          requestFingerprint: 'sha256:different-message',
          expectedSessionAuthorityGeneration: generation,
        })),
      ).rejects.toBeInstanceOf(CustomerRunIdempotencyConflictError);
      await expect(store.listTurns(sessionId)).resolves.toHaveLength(1);
      await expect(
        store.listCustomerRunEvents(input.run.id),
      ).resolves.toHaveLength(1);
      await expect(
        store.getCustomerRun('conflicting-run'),
      ).resolves.toBeUndefined();
    });

    it('returns stale while AI authority is active', async () => {
      const store = await createStore();
      const input = pausedIntake({
        expectedSessionAuthorityGeneration: 0,
      });

      await expect(
        store.commitPausedCustomerRunIntake(input),
      ).resolves.toEqual({ status: 'stale' });
      await expect(store.getCustomerRun(input.run.id)).resolves.toBeUndefined();
      await expect(store.listTurns(sessionId)).resolves.toEqual([]);
      await expect(
        store.listCustomerRunEvents(input.run.id),
      ).resolves.toEqual([]);
    });

    it('returns stale for a wrong generation while still human-paused', async () => {
      const store = await createStore();
      await pauseSession(store);
      const input = pausedIntake({
        expectedSessionAuthorityGeneration: 0,
      });

      await expect(
        store.commitPausedCustomerRunIntake(input),
      ).resolves.toEqual({ status: 'stale' });
      await expect(store.getCustomerRun(input.run.id)).resolves.toBeUndefined();
      await expect(store.listTurns(sessionId)).resolves.toEqual([]);
    });

    it('loses a pause-to-resume race without persisting partial intake', async () => {
      const store = await createStore();
      const pausedGeneration = await pauseSession(store);
      const resumed = await store.transitionSessionAuthority({
        sessionId,
        expectedGeneration: pausedGeneration,
        agentMode: 'ai_active',
        assignedAgentId: null,
        updatedAt: '2026-07-20T08:00:01.000Z',
      });
      expect(resumed).toMatchObject({
        status: 'transitioned',
        control: {
          agentMode: 'ai_active',
          sessionAuthorityGeneration: 2,
        },
      });
      const input = pausedIntake({
        expectedSessionAuthorityGeneration: pausedGeneration,
      });

      await expect(
        store.commitPausedCustomerRunIntake(input),
      ).resolves.toEqual({ status: 'stale' });
      await expect(store.getCustomerRun(input.run.id)).resolves.toBeUndefined();
      await expect(store.listTurns(sessionId)).resolves.toEqual([]);
      await expect(
        store.listCustomerRunEvents(input.run.id),
      ).resolves.toEqual([]);
    });

    it('rejects invalid payload and turn bindings before any persistence', async () => {
      const store = await createStore();
      const generation = await pauseSession(store);
      const input = pausedIntake({
        expectedSessionAuthorityGeneration: generation,
      });

      await expect(
        store.commitPausedCustomerRunIntake({
          ...input,
          events: [{
            ...input.events[0]!,
            payload: {
              ...input.events[0]!.payload,
              extra: 'must-not-be-accepted',
            },
          }],
        }),
      ).rejects.toThrow('paused_customer_run_intake_invalid');
      await expect(
        store.commitPausedCustomerRunIntake({
          ...input,
          userTurn: {
            ...input.userTurn,
            externalMessageId: 'different-message',
          },
        }),
      ).rejects.toThrow('paused_customer_run_intake_invalid');
      await expect(store.getCustomerRun(input.run.id)).resolves.toBeUndefined();
      await expect(store.listTurns(sessionId)).resolves.toEqual([]);
      await expect(
        store.listCustomerRunEvents(input.run.id),
      ).resolves.toEqual([]);
    });

    it.each([
      [
        'run that already started',
        (input: CommitPausedCustomerRunIntakeInput) => ({
          ...input,
          run: {
            ...input.run,
            startedAt: input.run.acceptedAt,
          },
        }),
      ],
      [
        'run with prior event history',
        (input: CommitPausedCustomerRunIntakeInput) => ({
          ...input,
          run: {
            ...input.run,
            nextEventSequence: 2,
          },
          events: [{
            ...input.events[0]!,
            expectedSequence: 2,
          }],
        }),
      ],
    ] satisfies Array<[
      string,
      (
        input: CommitPausedCustomerRunIntakeInput,
      ) => CommitPausedCustomerRunIntakeInput,
    ]>)(
      'rejects a %s before persisting any intake artifact',
      async (_description, makeInvalid) => {
        const store = await createStore();
        const generation = await pauseSession(store);
        const input = pausedIntake({
          expectedSessionAuthorityGeneration: generation,
        });

        await expect(
          store.commitPausedCustomerRunIntake(makeInvalid(input)),
        ).rejects.toThrow('paused_customer_run_intake_invalid');
        await expect(
          store.getCustomerRun(input.run.id),
        ).resolves.toBeUndefined();
        await expect(store.listTurns(sessionId)).resolves.toEqual([]);
        await expect(
          store.listCustomerRunEvents(input.run.id),
        ).resolves.toEqual([]);
      },
    );

    it('fails closed when the external message identity belongs to a different durable turn', async () => {
      const conflicts = [
        { text: 'Nội dung đã lưu khác' },
        { channel: 'messenger' as const },
        { role: 'assistant' as const },
        { externalUserId: 'different-customer' },
        { deliveryStatus: 'sent' as const },
        { metadata: { rawEvent: { source: 'different-source' } } },
      ];
      for (const conflict of conflicts) {
        const store = await createStore();
        const generation = await pauseSession(store);
        const input = pausedIntake({
          expectedSessionAuthorityGeneration: generation,
        });
        await store.appendTurn({
          ...input.userTurn,
          ...conflict,
        });

        await expect(
          store.commitPausedCustomerRunIntake(input),
        ).rejects.toThrow(
          'paused_customer_run_intake_turn_conflict',
        );
        await expect(
          store.getCustomerRun(input.run.id),
        ).resolves.toBeUndefined();
        await expect(
          store.listCustomerRunEvents(input.run.id),
        ).resolves.toEqual([]);
        await expect(store.listTurns(sessionId)).resolves.toHaveLength(1);
      }
    });

    it('reuses an exact durable turn whose metadata keys have a different order', async () => {
      const store = await createStore();
      const generation = await pauseSession(store);
      const input = pausedIntake({
        expectedSessionAuthorityGeneration: generation,
      });
      await store.appendTurn({
        ...input.userTurn,
        metadata: {
          rawEvent: {
            intake: 'human_paused',
            source: 'kfc_customer_run',
          },
        },
      });

      await expect(
        store.commitPausedCustomerRunIntake(input),
      ).resolves.toMatchObject({ status: 'committed' });
      await expect(store.listTurns(sessionId)).resolves.toHaveLength(1);
      await expect(
        store.listCustomerRunEvents(input.run.id),
      ).resolves.toHaveLength(1);
    });
  });
}

describe('commitPausedCustomerRunIntake', () => {
  verifyPausedCustomerRunIntakeContract(
    'MemoryStore',
    () => new MemoryStore(),
  );
  verifyPausedCustomerRunIntakeContract(
    'D1Store',
    async () => {
      const store = new D1Store(new FakeD1Database());
      await store.initialize();
      return store;
    },
  );

  it.each([
    [
      'non-terminal run state',
      (db: FakeD1Database) => {
        const run = db.tables.customer_runs[0];
        if (!run) throw new Error('test paused run missing');
        run.status = 'completed';
      },
    ],
    [
      'non-canonical superseded event',
      (db: FakeD1Database) => {
        const event = db.tables.customer_run_events[0];
        if (!event) throw new Error('test paused event missing');
        event.payload = JSON.stringify({
          status: 'superseded',
          suppressed: false,
          agentMode: 'human_paused',
        });
      },
    ],
  ] satisfies Array<[
    string,
    (db: FakeD1Database) => void,
  ]>)(
    'D1 fails closed instead of replaying a %s',
    async (_corruption, corrupt) => {
      const db = new FakeD1Database();
      const store = new D1Store(db);
      await store.initialize();
      const generation = await pauseSession(store);
      const input = pausedIntake({
        expectedSessionAuthorityGeneration: generation,
      });
      await store.commitPausedCustomerRunIntake(input);
      corrupt(db);

      await expect(
        store.commitPausedCustomerRunIntake(input),
      ).rejects.toThrow(
        'paused_customer_run_intake_replay_invalid',
      );
      expect(db.tables.customer_runs).toHaveLength(1);
      expect(db.tables.customer_run_events).toHaveLength(1);
      expect(db.tables.conversation_turns).toHaveLength(1);
    },
  );
});
