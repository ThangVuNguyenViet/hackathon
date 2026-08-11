import { describe, expect, it } from 'vitest';
import {
  buildCommerceApprovalBinding,
  digestCommerceAction,
} from '../../src/ordering/approvalReceipt.js';
import { authenticatedCommerceApprovalPrincipal } from '../../src/ordering/commerceApprovalPrincipal.js';
import type {
  CommitConfirmationTurnIfRunCurrentInput,
  ConversationStore,
  RunCommitFence,
} from '../../src/persistence/contracts.js';
import { D1Store } from '../../src/persistence/d1Store.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import { commitPostgresConfirmationTurnIfRunCurrent } from '../../src/persistence/postgresStoreConfirmationTurnCommit.js';
import { FakeD1Database } from '../support/fakeD1Database.js';

const sessionId = 'messenger:atomic-confirmation-turn';
const customerId = 'atomic-confirmation-turn';

async function operation(
  fence: RunCommitFence,
  requestId = '00000000-0000-4000-8000-000000000091',
): Promise<CommitConfirmationTurnIfRunCurrentInput> {
  const action = {
    toolName: 'placeOrder' as const,
    arguments: {},
  };
  const principal = authenticatedCommerceApprovalPrincipal({
    sessionId,
    customerId,
    channel: 'messenger',
    authenticatedSubject: customerId,
    authenticationEvidenceRef: 'atomic-confirmation-evidence',
  });
  const approvalBinding = await buildCommerceApprovalBinding({
    capability: 'placeOrder',
    principal,
    action,
    revisions: {
      cartRevision: 'cart-r1',
      fulfillmentRevision: 'fulfillment-r1',
      paymentRevision: 'payment-r1',
      collectionRevision: 'collection-r1',
      providerRevision: 'provider-r1',
    },
  });
  return {
    fence,
    notAfter: '2099-08-12T00:10:00.000Z',
    stateEvent: {
      sessionId,
      sourceType: 'graph:verified_state',
      payload: { verifiedState: { cart: { id: 'cart-atomic' } } },
    },
    assistantTurn: {
      id: `turn_${requestId}`,
      sessionId,
      channel: 'messenger',
      role: 'assistant',
      text: 'Please confirm this exact order.',
      externalMessageId: null,
      externalUserId: customerId,
      deliveryStatus: 'pending',
      metadata: null,
    },
    pause: {
      schemaVersion: 'kfc-confirmation-pause-v1',
      requestId,
      sourceTurnId: 'turn-source-atomic',
      actionScope: '',
      actionId: 'tool-place-order-atomic',
      sessionId,
      customerId,
      channel: 'messenger',
      action,
      actionDigest: await digestCommerceAction(action),
      approvalBinding,
      approvalBindingDigest: await digestCommerceAction(approvalBinding),
      principal,
      createdAt: '2026-08-12T00:00:00.000Z',
      expiresAt: '2099-08-12T00:10:00.000Z',
    },
  };
}

async function currentAgentFence(
  store: ConversationStore,
): Promise<RunCommitFence> {
  const run = await store.createAgentRun({
    id: 'run_atomic_confirmation_turn',
    sessionId,
    generation: 1,
    channel: 'messenger',
    externalUserId: customerId,
    status: 'scheduled',
    coalescedInputText: 'Place this order',
    deliveryStatus: 'pending',
    scheduledAt: '2026-08-12T00:00:00.000Z',
  });
  await store.setSessionAgentState({
    sessionId,
    currentRunId: run.id,
    generation: 1,
    debounceDeadlineAt: null,
  });
  const claimedAt = new Date();
  const claimed = await store.claimAgentRunExecution({
    runId: run.id,
    sessionId,
    generation: 1,
    sessionAuthorityGeneration: run.sessionAuthorityGeneration,
    claimedAt: claimedAt.toISOString(),
    executionLeaseToken: '00000000-0000-4000-8000-000000000092',
    executionLeaseExpiresAt: new Date(
      claimedAt.getTime() + 60_000,
    ).toISOString(),
  });
  if (claimed.status !== 'claimed') throw new Error('test claim failed');
  return {
    kind: 'agent_run',
    runId: run.id,
    generation: 1,
    sessionAuthorityGeneration: claimed.run.sessionAuthorityGeneration,
    executionAttempt: claimed.run.executionAttempt,
    executionLeaseToken: claimed.run.executionLeaseToken!,
  };
}

const harnesses = [
  {
    name: 'MemoryStore',
    async create() {
      return new MemoryStore() as ConversationStore;
    },
  },
  {
    name: 'D1Store',
    async create() {
      const store = new D1Store(new FakeD1Database());
      await store.initialize();
      return store as ConversationStore;
    },
  },
];

for (const harness of harnesses) {
  describe(`${harness.name} atomic confirmation turn`, () => {
    it('commits and exactly replays the pause with its assistant turn', async () => {
      const store = await harness.create();
      const input = await operation(await currentAgentFence(store));

      await expect(
        store.commitConfirmationTurnIfRunCurrent(input),
      ).resolves.toMatchObject({ status: 'created' });
      await expect(
        store.commitConfirmationTurnIfRunCurrent(input),
      ).resolves.toMatchObject({ status: 'replay' });
      await expect(store.listTurns(sessionId)).resolves.toHaveLength(1);
      await expect(
        store.getConfirmationPause(input.pause.requestId),
      ).resolves.toMatchObject({
        requestId: input.pause.requestId,
        status: 'pending',
      });
    });

    it('writes neither pause nor assistant turn for a stale owner', async () => {
      const store = await harness.create();
      const fence = await currentAgentFence(store);
      await store.advanceSessionAgentGeneration({
        sessionId,
        debounceDeadlineAt: null,
      });
      const input = await operation(fence);

      await expect(
        store.commitConfirmationTurnIfRunCurrent(input),
      ).resolves.toEqual({ status: 'stale' });
      await expect(store.listTurns(sessionId)).resolves.toEqual([]);
      await expect(
        store.getConfirmationPause(input.pause.requestId),
      ).resolves.toBeUndefined();
    });
  });
}

describe('D1 atomic confirmation turn failure', () => {
  it('publishes verified references in the same batch', async () => {
    const database = new FakeD1Database();
    const store = new D1Store(database);
    await store.initialize();
    const input = await operation(await currentAgentFence(store));
    input.verifiedRefs = [
      {
        schemaVersion: 'kfc-verified-ref-v1',
        ref: {
          id: '00000000-0000-4000-8000-000000000094',
          kind: 'saved_address',
        },
        principal: authenticatedCommerceApprovalPrincipal({
          sessionId,
          customerId,
          channel: 'messenger',
          authenticatedSubject: customerId,
          authenticationEvidenceRef: 'atomic-confirmation-evidence',
        }),
        verifiedRevision: 'a'.repeat(64),
        payload: { addressId: 'address-atomic' },
        lifecycle: 'replayable',
        createdAt: '2026-08-12T00:00:00.000Z',
        expiresAt: '2099-08-12T00:10:00.000Z',
      },
    ];

    await expect(
      store.commitConfirmationTurnIfRunCurrent(input),
    ).resolves.toMatchObject({ status: 'created' });
    expect(database.tables.verified_refs).toHaveLength(1);
  });

  it('rolls back a partial batch when assistant storage fails', async () => {
    const database = new FakeD1Database();
    const store = new D1Store(database);
    await store.initialize();
    const input = await operation(await currentAgentFence(store));
    database.failNextBatchAtStatement = 4;

    await expect(
      store.commitConfirmationTurnIfRunCurrent(input),
    ).rejects.toThrow('fake_d1_batch_storage_failure');
    expect(database.tables.confirmation_pauses).toEqual([]);
    expect(database.tables.conversation_turns).toEqual([]);
    expect(database.tables.conversation_events).toEqual([]);
  });
});

class FaultInjectingPostgres {
  readonly durable = {
    pauses: [] as unknown[][],
    turns: [] as unknown[][],
    events: [] as unknown[][],
  };
  failAssistantTurn = false;

  async connect() {
    let staged = structuredClone(this.durable);
    return {
      query: async (sql: string, values: unknown[] = []) => {
        const normalized = sql.replace(/\s+/gu, ' ').trim();
        if (normalized === 'BEGIN') staged = structuredClone(this.durable);
        else if (normalized === 'COMMIT') Object.assign(this.durable, staged);
        else if (normalized === 'ROLLBACK')
          staged = structuredClone(this.durable);
        else if (normalized.includes('pg_advisory_xact_lock'))
          return { rows: [], rowCount: 1 };
        else if (normalized.startsWith('SELECT * FROM session_controls'))
          return { rows: [], rowCount: 0 };
        else if (normalized.startsWith('SELECT id FROM customer_runs'))
          return { rows: [{ id: 'customer-run-postgres' }], rowCount: 1 };
        else if (
          normalized.startsWith('INSERT INTO confirmation_pause_sessions')
        )
          return { rows: [{ generation: 0 }], rowCount: 1 };
        else if (normalized.startsWith('SELECT pause.*'))
          return { rows: [], rowCount: 0 };
        else if (normalized.startsWith('INSERT INTO confirmation_pauses'))
          staged.pauses.push(values);
        else if (normalized.startsWith('INSERT INTO conversation_turns')) {
          if (this.failAssistantTurn)
            throw new Error('postgres_assistant_storage_failure');
          staged.turns.push(values);
        } else if (normalized.startsWith('INSERT INTO conversation_events'))
          staged.events.push(values);
        return { rows: [], rowCount: 1 };
      },
      release() {},
    };
  }
}

describe('Postgres atomic confirmation turn transaction', () => {
  it('commits the pause and assistant publication together', async () => {
    const db = new FaultInjectingPostgres();
    const input = await operation(
      {
        kind: 'customer_run',
        runId: 'customer-run-postgres',
        sessionAuthorityGeneration: 0,
      },
      '00000000-0000-4000-8000-000000000093',
    );

    await expect(
      commitPostgresConfirmationTurnIfRunCurrent({
        // The fake implements only the transaction methods exercised here.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        db: db as never,
        operation: input,
      }),
    ).resolves.toMatchObject({ status: 'created' });
    expect(db.durable.pauses).toHaveLength(1);
    expect(db.durable.turns).toHaveLength(1);
    expect(db.durable.events).toHaveLength(3);
  });

  it('rolls back the pause when assistant storage fails', async () => {
    const db = new FaultInjectingPostgres();
    db.failAssistantTurn = true;
    const input = await operation(
      {
        kind: 'customer_run',
        runId: 'customer-run-postgres',
        sessionAuthorityGeneration: 0,
      },
      '00000000-0000-4000-8000-000000000094',
    );

    await expect(
      commitPostgresConfirmationTurnIfRunCurrent({
        // The fake implements only the transaction methods exercised here.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        db: db as never,
        operation: input,
      }),
    ).rejects.toThrow('postgres_assistant_storage_failure');
    expect(db.durable.pauses).toEqual([]);
    expect(db.durable.turns).toEqual([]);
    expect(db.durable.events).toEqual([]);
  });
});
