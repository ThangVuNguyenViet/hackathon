import { readFileSync } from 'node:fs';
import {
  DatabaseSync,
  type SQLInputValue,
  type StatementSync,
} from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  D1Store,
  type D1DatabaseLike,
} from '../../src/persistence/d1Store.js';
import type {
  D1PreparedStatement,
  D1Result,
} from '../../src/persistence/d1StoreSupport.js';
import { FakeD1Database } from '../support/fakeD1Database.js';

const sessionId = 'messenger:non-agent-d1';
const agentId = 'human-agent-private';
const recipientId = 'recipient-private';
const presentationText = 'A private human-authored response';
const requestKey = 'a'.repeat(64);
const createdAt = '2026-07-20T00:00:00.000Z';

describe('D1 non-agent text-delivery persistence', () => {
  it('reserves a digest-only pending record under exact human authority', async () => {
    const { db, store, authorityGeneration } = await createHarness();
    const reserved = await store.reserveNonAgentTextDelivery(
      reservation({ authorityGeneration }),
    );
    const replay = await store.reserveNonAgentTextDelivery(
      reservation({ authorityGeneration }),
    );
    const conflict = await store.reserveNonAgentTextDelivery({
      ...reservation({ authorityGeneration }),
      presentationText: 'A different presentation',
    });
    const prepared = await store.prepareNonAgentTextDeliveryTurn(
      preparation({ authorityGeneration }),
    );
    const preparedReplay = await store.prepareNonAgentTextDeliveryTurn(
      preparation({ authorityGeneration }),
    );

    expect(reserved).toMatchObject({
      status: 'reserved',
      record: {
        requestKey,
        status: 'pending',
        deliveryAttempt: 0,
        channel: 'messenger',
      },
    });
    expect(replay).toMatchObject({
      status: 'replay',
      record: { deliveryBindingDigest: reserved.status === 'reserved'
        ? reserved.record.deliveryBindingDigest
        : undefined },
    });
    expect(conflict).toEqual({ status: 'conflict' });
    expect(prepared).toMatchObject({
      status: 'prepared',
      turn: { id: 'human-turn-d1' },
    });
    expect(preparedReplay).toMatchObject({
      status: 'replay',
      turn: { id: 'human-turn-d1' },
    });
    expect(db.tables.conversation_turns).toHaveLength(1);
    expect(db.tables.conversation_events).toHaveLength(1);
    expect(db.tables.webhook_deliveries).toEqual([]);
    const persisted = JSON.stringify(db.tables.non_agent_text_deliveries);
    expect(persisted).not.toContain(recipientId);
    expect(persisted).not.toContain(presentationText);
    expect(persisted).not.toContain(agentId);
    expect(persisted).not.toContain(sessionId);
  });

  it('rejects a new reservation and begin after exact authority drifts', async () => {
    const { store, authorityGeneration } = await createHarness();
    await expect(
      store.reserveNonAgentTextDelivery(
        reservation({
          authorityGeneration: authorityGeneration + 1,
          requestKey: 'b'.repeat(64),
        }),
      ),
    ).resolves.toEqual({ status: 'stale_authority' });

    await store.reserveNonAgentTextDelivery(
      reservation({ authorityGeneration }),
    );
    await store.transitionSessionAuthority({
      sessionId,
      expectedGeneration: authorityGeneration,
      agentMode: 'human_paused',
      assignedAgentId: 'different-human-agent',
      updatedAt: '2026-07-20T00:00:00.500Z',
    });
    await expect(
      store.beginNonAgentTextDeliveryAttempt(
        beginInput({ authorityGeneration }),
      ),
    ).resolves.toMatchObject({
      status: 'dispatch_blocked',
      reason: 'stale_authority',
      record: { status: 'pending' },
    });
  });

  it('rejects an ABA revival under a later pause by the same agent', async () => {
    const { store, authorityGeneration } = await createHarness();
    await store.reserveNonAgentTextDelivery(
      reservation({ authorityGeneration }),
    );
    const released = await store.transitionSessionAuthority({
      sessionId,
      expectedGeneration: authorityGeneration,
      agentMode: 'ai_active',
      assignedAgentId: null,
      updatedAt: '2026-07-20T00:00:00.500Z',
    });
    const repaused = await store.transitionSessionAuthority({
      sessionId,
      expectedGeneration:
        released.control.sessionAuthorityGeneration,
      agentMode: 'human_paused',
      assignedAgentId: agentId,
      updatedAt: '2026-07-20T00:00:00.750Z',
    });

    await expect(
      store.beginNonAgentTextDeliveryAttempt(
        beginInput({
          authorityGeneration:
            repaused.control.sessionAuthorityGeneration,
        }),
      ),
    ).resolves.toMatchObject({
      status: 'dispatch_blocked',
      reason: 'stale_authority',
      record: {
        status: 'pending',
        reservedSessionAuthorityGeneration: authorityGeneration,
      },
    });
  });

  it('recovers a pre-dispatch pending crash but never redispatches a sending crash', async () => {
    const { store, authorityGeneration } = await createHarness();
    await store.reserveNonAgentTextDelivery(
      reservation({ authorityGeneration }),
    );

    const begun = await store.beginNonAgentTextDeliveryAttempt(
      beginInput({ authorityGeneration }),
    );
    expect(begun).toMatchObject({
      status: 'dispatch_authorized',
      record: {
        status: 'sending',
        deliveryAttempt: 1,
        deliveryAttemptToken: 'attempt-token-1',
      },
    });
    await expect(
      store.beginNonAgentTextDeliveryAttempt(
        beginInput({ authorityGeneration }),
      ),
    ).resolves.toMatchObject({
      status: 'dispatch_blocked',
      reason: 'sending_in_progress',
    });
    await expect(
      store.reconcileNonAgentTextDelivery({
        requestKey,
        sessionId,
        deliveryAttempt: 1,
        deliveryAttemptToken: 'attempt-token-1',
        reason: 'sending_lease_expired',
        reconciledAt: '2026-07-20T00:00:05.000Z',
      }),
    ).resolves.toMatchObject({
      status: 'reconciliation_blocked',
      reason: 'sending_lease_active',
    });
    const reconciled = await store.reconcileNonAgentTextDelivery({
      requestKey,
      sessionId,
      deliveryAttempt: 1,
      deliveryAttemptToken: 'attempt-token-1',
      reason: 'sending_lease_expired',
      reconciledAt: '2026-07-20T00:00:11.000Z',
    });
    expect(reconciled).toMatchObject({
      status: 'reconciled',
      record: {
        status: 'outcome_unknown',
        outcomeCode: 'non_agent_delivery_sending_lease_expired',
      },
    });
    await expect(
      store.beginNonAgentTextDeliveryAttempt({
        ...beginInput({ authorityGeneration }),
        nextDeliveryAttempt: 2,
        deliveryAttemptToken: 'attempt-token-2',
        updatedAt: '2026-07-20T00:00:12.000Z',
        leaseExpiresAt: '2026-07-20T00:00:20.000Z',
      }),
    ).resolves.toMatchObject({
      status: 'dispatch_blocked',
      reason: 'outcome_unknown',
    });
  });

  it('retries only confirmed-not-sent and completes by exact attempt token CAS', async () => {
    const { db, store, authorityGeneration } = await createHarness();
    await store.reserveNonAgentTextDelivery(
      reservation({ authorityGeneration }),
    );
    await store.beginNonAgentTextDeliveryAttempt(
      beginInput({ authorityGeneration }),
    );
    await expect(
      store.completeNonAgentTextDeliveryAttempt({
        requestKey,
        sessionId,
        deliveryAttempt: 1,
        deliveryAttemptToken: 'wrong-token',
        outcome: {
          status: 'confirmed_not_sent',
          errorCode: 'provider_rejected',
          message: 'provider private diagnostic',
        },
        updatedAt: '2026-07-20T00:00:02.000Z',
      }),
    ).resolves.toMatchObject({
      status: 'transition_blocked',
      reason: 'delivery_attempt_mismatch',
    });
    await store.completeNonAgentTextDeliveryAttempt({
      requestKey,
      sessionId,
      deliveryAttempt: 1,
      deliveryAttemptToken: 'attempt-token-1',
      outcome: {
        status: 'confirmed_not_sent',
        errorCode: 'provider_rejected',
        message: 'provider private diagnostic',
      },
      updatedAt: '2026-07-20T00:00:02.000Z',
    });
    const retry = await store.beginNonAgentTextDeliveryAttempt({
      ...beginInput({ authorityGeneration }),
      nextDeliveryAttempt: 2,
      deliveryAttemptToken: 'attempt-token-2',
      updatedAt: '2026-07-20T00:00:03.000Z',
      leaseExpiresAt: '2026-07-20T00:00:13.000Z',
    });
    expect(retry).toMatchObject({
      status: 'dispatch_authorized',
      record: { status: 'sending', deliveryAttempt: 2 },
    });
    const completed = await store.completeNonAgentTextDeliveryAttempt({
      requestKey,
      sessionId,
      deliveryAttempt: 2,
      deliveryAttemptToken: 'attempt-token-2',
      outcome: {
        status: 'confirmed_sent',
        messageId: 'provider-message-2',
      },
      updatedAt: '2026-07-20T00:00:04.000Z',
    });
    expect(completed).toMatchObject({
      status: 'transitioned',
      record: {
        status: 'confirmed_sent',
        providerMessageId: 'provider-message-2',
      },
    });
    await expect(
      store.beginNonAgentTextDeliveryAttempt({
        ...beginInput({ authorityGeneration }),
        nextDeliveryAttempt: 3,
        deliveryAttemptToken: 'attempt-token-3',
        updatedAt: '2026-07-20T00:00:05.000Z',
        leaseExpiresAt: '2026-07-20T00:00:15.000Z',
      }),
    ).resolves.toMatchObject({
      status: 'dispatch_blocked',
      reason: 'confirmed_sent',
    });
    expect(JSON.stringify(db.tables.non_agent_text_deliveries))
      .not.toContain('provider private diagnostic');
  });

  it('executes the same CAS statements against real SQLite', async () => {
    const database = new SqliteD1Database();
    try {
      const store = new D1Store(database);
      await store.initialize();
      const authority = await store.transitionSessionAuthority({
        sessionId,
        expectedGeneration: 0,
        agentMode: 'human_paused',
        assignedAgentId: agentId,
        updatedAt: createdAt,
      });
      expect(authority.status).toBe('transitioned');
      const authorityGeneration =
        authority.control.sessionAuthorityGeneration;
      await expect(
        store.reserveNonAgentTextDelivery(
          reservation({ authorityGeneration }),
        ),
      ).resolves.toMatchObject({ status: 'reserved' });
      await expect(
        store.prepareNonAgentTextDeliveryTurn(
          preparation({ authorityGeneration }),
        ),
      ).resolves.toMatchObject({
        status: 'prepared',
        turn: { id: 'human-turn-d1' },
      });
      await expect(
        store.beginNonAgentTextDeliveryAttempt(
          beginInput({ authorityGeneration }),
        ),
      ).resolves.toMatchObject({
        status: 'dispatch_authorized',
        record: { status: 'sending' },
      });
      await expect(
        store.completeNonAgentTextDeliveryAttempt({
          requestKey,
          sessionId,
          deliveryAttempt: 1,
          deliveryAttemptToken: 'attempt-token-1',
          outcome: {
            status: 'confirmed_sent',
            messageId: 'provider-message-sqlite',
          },
          updatedAt: '2026-07-20T00:00:02.000Z',
        }),
      ).resolves.toMatchObject({
        status: 'transitioned',
        record: { status: 'confirmed_sent' },
      });
    } finally {
      database.close();
    }
  });

  it('does not append a false event for a conflicting prepared turn in real SQLite', async () => {
    const database = new SqliteD1Database();
    try {
      const store = new D1Store(database);
      await store.initialize();
      const authority = await store.transitionSessionAuthority({
        sessionId,
        expectedGeneration: 0,
        agentMode: 'human_paused',
        assignedAgentId: agentId,
        updatedAt: createdAt,
      });
      const authorityGeneration =
        authority.control.sessionAuthorityGeneration;
      await store.appendTurn({
        ...preparation({ authorityGeneration }).turn,
        text: 'conflicting durable text',
      });
      await store.reserveNonAgentTextDelivery(
        reservation({ authorityGeneration }),
      );
      const eventsBefore = await store.listEvents(sessionId);

      await expect(store.prepareNonAgentTextDeliveryTurn(
        preparation({ authorityGeneration }),
      )).resolves.toMatchObject({
        status: 'prepare_blocked',
        reason: 'turn_binding_conflict',
      });
      expect(await store.listEvents(sessionId)).toHaveLength(
        eventsBefore.length,
      );
      expect(await store.getNonAgentTextDelivery(requestKey))
        .toMatchObject({ status: 'pending', deliveryAttempt: 0 });
    } finally {
      database.close();
    }
  });

  it('atomically reconciles pending and expired sending during real SQLite reset', async () => {
    const database = new SqliteD1Database();
    try {
      const store = new D1Store(database);
      await store.initialize();
      const authority = await store.transitionSessionAuthority({
        sessionId,
        expectedGeneration: 0,
        agentMode: 'human_paused',
        assignedAgentId: agentId,
        updatedAt: new Date(Date.now() - 60_000).toISOString(),
      });
      const authorityGeneration =
        authority.control.sessionAuthorityGeneration;
      const pendingKey = 'e'.repeat(64);
      const expiredKey = 'f'.repeat(64);
      const reservedAt = new Date(Date.now() - 50_000).toISOString();
      await store.reserveNonAgentTextDelivery({
        ...reservation({
          authorityGeneration,
          requestKey: pendingKey,
        }),
        createdAt: reservedAt,
      });
      await store.prepareNonAgentTextDeliveryTurn(
        preparation({
          authorityGeneration,
          requestKey: pendingKey,
          createdAt: reservedAt,
        }),
      );
      await store.reserveNonAgentTextDelivery({
        ...reservation({
          authorityGeneration,
          requestKey: expiredKey,
        }),
        assistantTurnId: 'human-turn-d1-expired',
        createdAt: reservedAt,
      });
      await store.beginNonAgentTextDeliveryAttempt({
        requestKey: expiredKey,
        sessionId,
        expectedSessionAuthorityGeneration: authorityGeneration,
        expectedAgentId: agentId,
        nextDeliveryAttempt: 1,
        deliveryAttemptToken: 'real-reset-expired-token',
        updatedAt: new Date(Date.now() - 40_000).toISOString(),
        leaseExpiresAt: new Date(Date.now() - 30_000).toISOString(),
      });

      await expect(store.resetSession(sessionId)).resolves.toMatchObject({
        agentMode: 'ai_active',
      });
      await expect(
        store.getNonAgentTextDelivery(pendingKey),
      ).resolves.toMatchObject({
        status: 'confirmed_not_sent',
        deliveryAttempt: 0,
        outcomeCode: 'non_agent_delivery_abandoned_by_reset',
      });
      await expect(
        store.getNonAgentTextDelivery(expiredKey),
      ).resolves.toMatchObject({
        status: 'outcome_unknown',
        deliveryAttemptToken: 'real-reset-expired-token',
        outcomeCode:
          'non_agent_delivery_reset_sending_lease_expired',
      });
      expect(await store.listTurns(sessionId)).toEqual([]);
    } finally {
      database.close();
    }
  });

  it('caps confirmed-not-sent redispatch at three attempts', async () => {
    const { store, authorityGeneration } = await createHarness();
    await store.reserveNonAgentTextDelivery(
      reservation({ authorityGeneration }),
    );
    for (const attempt of [1, 2, 3]) {
      const updatedAt =
        `2026-07-20T00:00:0${attempt * 2 - 1}.000Z`;
      const leaseExpiresAt =
        `2026-07-20T00:00:1${attempt}.000Z`;
      await expect(
        store.beginNonAgentTextDeliveryAttempt({
          requestKey,
          sessionId,
          expectedSessionAuthorityGeneration: authorityGeneration,
          expectedAgentId: agentId,
          nextDeliveryAttempt: attempt,
          deliveryAttemptToken: `attempt-token-${attempt}`,
          updatedAt,
          leaseExpiresAt,
        }),
      ).resolves.toMatchObject({
        status: 'dispatch_authorized',
        record: { deliveryAttempt: attempt },
      });
      await expect(
        store.completeNonAgentTextDeliveryAttempt({
          requestKey,
          sessionId,
          deliveryAttempt: attempt,
          deliveryAttemptToken: `attempt-token-${attempt}`,
          outcome: {
            status: 'confirmed_not_sent',
            errorCode: 'provider_rejected',
            message: 'controlled test diagnostic',
          },
          updatedAt:
            `2026-07-20T00:00:0${attempt * 2}.000Z`,
        }),
      ).resolves.toMatchObject({
        status: 'transitioned',
        record: { status: 'confirmed_not_sent' },
      });
    }
    await expect(
      store.beginNonAgentTextDeliveryAttempt({
        requestKey,
        sessionId,
        expectedSessionAuthorityGeneration: authorityGeneration,
        expectedAgentId: agentId,
        nextDeliveryAttempt: 4,
        deliveryAttemptToken: 'attempt-token-4',
        updatedAt: '2026-07-20T00:00:07.000Z',
        leaseExpiresAt: '2026-07-20T00:00:17.000Z',
      }),
    ).resolves.toMatchObject({
      status: 'dispatch_blocked',
      reason: 'attempts_exhausted',
      record: { deliveryAttempt: 3 },
    });
  });

  it('rolls back begin when an attempt token was already used', async () => {
    const { db, store, authorityGeneration } = await createHarness();
    await store.reserveNonAgentTextDelivery(
      reservation({ authorityGeneration }),
    );
    await store.beginNonAgentTextDeliveryAttempt(
      beginInput({ authorityGeneration }),
    );
    const secondRequestKey = 'b'.repeat(64);
    await store.reserveNonAgentTextDelivery(
      reservation({ authorityGeneration, requestKey: secondRequestKey }),
    );

    await expect(
      store.beginNonAgentTextDeliveryAttempt({
        ...beginInput({ authorityGeneration }),
        requestKey: secondRequestKey,
      }),
    ).resolves.toMatchObject({
      status: 'dispatch_blocked',
      reason: 'delivery_attempt_token_reused',
    });
    await expect(
      store.getNonAgentTextDelivery(secondRequestKey),
    ).resolves.toMatchObject({
      status: 'pending',
      deliveryAttempt: 0,
    });
    expect(db.tables.non_agent_text_delivery_attempts).toHaveLength(1);
  });
});

describe('D1 non-agent text-delivery schema', () => {
  it('defines the dedicated bounded state machine without raw message fields', () => {
    const source = readFileSync(
      'migrations/0018_non_agent_text_deliveries.sql',
      'utf8',
    );
    expect(source).toContain('CREATE TABLE IF NOT EXISTS non_agent_text_deliveries');
    expect(source).toMatch(/delivery_attempt\s+BETWEEN\s+0\s+AND\s+3/iu);
    expect(source).toContain("'pending'");
    expect(source).toContain("'sending'");
    expect(source).toContain("'confirmed_sent'");
    expect(source).toContain("'confirmed_not_sent'");
    expect(source).toContain("'outcome_unknown'");
    expect(source).toContain(
      'CREATE TABLE IF NOT EXISTS non_agent_text_delivery_attempts',
    );
    expect(source).toMatch(
      /delivery_attempt_token\s+TEXT\s+NOT\s+NULL\s+UNIQUE/iu,
    );
    expect(source).not.toMatch(
      /\b(recipient_id|agent_id|last_error|presentation_text)\b/iu,
    );
    const database = new DatabaseSync(':memory:');
    try {
      database.exec(source);
      expect(
        database.prepare(
          `SELECT name FROM sqlite_master
           WHERE type = 'table' AND name = 'non_agent_text_deliveries'`,
        ).get(),
      ).toEqual({ name: 'non_agent_text_deliveries' });
    } finally {
      database.close();
    }
  });
});

async function createHarness(): Promise<{
  db: FakeD1Database;
  store: D1Store;
  authorityGeneration: number;
}> {
  const db = new FakeD1Database();
  const store = new D1Store(db);
  await store.initialize();
  const transitioned = await store.transitionSessionAuthority({
    sessionId,
    expectedGeneration: 0,
    agentMode: 'human_paused',
    assignedAgentId: agentId,
    updatedAt: createdAt,
  });
  if (transitioned.status !== 'transitioned') {
    throw new Error('d1_non_agent_test_authority_setup_failed');
  }
  return {
    db,
    store,
    authorityGeneration:
      transitioned.control.sessionAuthorityGeneration,
  };
}

function reservation(input: {
  authorityGeneration: number;
  requestKey?: string;
}) {
  return {
    requestKey: input.requestKey ?? requestKey,
    sessionId,
    expectedSessionAuthorityGeneration: input.authorityGeneration,
    expectedAgentId: agentId,
    channel: 'messenger' as const,
    assistantTurnId: 'human-turn-d1',
    recipientId,
    presentationText,
    createdAt,
  };
}

function beginInput(input: { authorityGeneration: number }) {
  return {
    requestKey,
    sessionId,
    expectedSessionAuthorityGeneration: input.authorityGeneration,
    expectedAgentId: agentId,
    nextDeliveryAttempt: 1,
    deliveryAttemptToken: 'attempt-token-1',
    updatedAt: '2026-07-20T00:00:01.000Z',
    leaseExpiresAt: '2026-07-20T00:00:10.000Z',
  };
}

function preparation(input: {
  authorityGeneration: number;
  requestKey?: string;
  createdAt?: string;
}) {
  return {
    requestKey: input.requestKey ?? requestKey,
    sessionId,
    expectedSessionAuthorityGeneration: input.authorityGeneration,
    expectedAgentId: agentId,
    turn: {
      id: 'human-turn-d1',
      sessionId,
      channel: 'messenger' as const,
      role: 'assistant' as const,
      text: presentationText,
      externalMessageId: null,
      externalUserId: recipientId,
      deliveryStatus: 'pending' as const,
      metadata: { authorType: 'human_agent' as const, agentId },
      createdAt: input.createdAt ?? createdAt,
    },
  };
}

class SqliteD1Database implements D1DatabaseLike {
  private readonly database = new DatabaseSync(':memory:');

  constructor() {
    this.database.exec('PRAGMA foreign_keys = ON');
  }

  prepare(query: string): D1PreparedStatement {
    return new SqliteD1Statement(this.database, query);
  }

  async batch(statements: D1PreparedStatement[]): Promise<D1Result[]> {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const results: D1Result[] = [];
      for (const statement of statements) {
        results.push(await statement.run());
      }
      this.database.exec('COMMIT');
      return results;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  close(): void {
    this.database.close();
  }
}

class SqliteD1Statement implements D1PreparedStatement {
  private values: unknown[] = [];

  constructor(
    private readonly database: DatabaseSync,
    private readonly query: string,
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    this.values = values;
    return this;
  }

  async run(): Promise<D1Result> {
    const statement = this.statement();
    const values = sqliteValues(this.values);
    if (statement.columns().length > 0) {
      const results = statement.all(...values) as Record<string, unknown>[];
      return {
        success: true,
        results,
        meta: { changes: results.length },
      };
    }
    const result = statement.run(...values);
    return {
      success: true,
      meta: { changes: Number(result.changes) },
    };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (
      this.statement().get(...sqliteValues(this.values)) as T | undefined
    ) ?? null;
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return {
      success: true,
      results: this.statement().all(...sqliteValues(this.values)) as T[],
      meta: {},
    };
  }

  private statement(): StatementSync {
    return this.database.prepare(this.query);
  }
}

function sqliteValues(values: readonly unknown[]): SQLInputValue[] {
  return values.map((value) => {
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'bigint'
    ) {
      return value;
    }
    throw new Error('d1_non_agent_test_sql_value_invalid');
  });
}
