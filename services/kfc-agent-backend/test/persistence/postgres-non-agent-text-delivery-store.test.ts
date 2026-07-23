import type { Pool, PoolClient, QueryResult } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { PostgresStore } from '../../src/persistence/postgresStore.js';

const requestKey = 'a'.repeat(64);
const sessionId = 'messenger:non-agent-postgres';

describe('Postgres non-agent text delivery state machine', () => {
  it('claims dispatch before sending and reconciles a crashed attempt to unknown', async () => {
    const harness = postgresDeliveryHarness();
    const store = new PostgresStore(harness.db);

    const reserved = await store.reserveNonAgentTextDelivery(
      reservationInput(),
    );
    expect(reserved).toMatchObject({
      status: 'reserved',
      record: {
        status: 'pending',
        deliveryAttempt: 0,
      },
    });
    expect(JSON.stringify(harness.row)).not.toContain('agent-secret');
    expect(JSON.stringify(harness.row)).not.toContain('recipient-secret');
    expect(JSON.stringify(harness.row)).not.toContain('presentation-secret');
    expect(JSON.stringify(harness.row)).not.toContain(sessionId);
    expect(harness.queries.some((text) =>
      text.includes('INSERT INTO non_agent_text_deliveries')
    )).toBe(true);
    expect(harness.queries.some((text) =>
      text.includes('webhook_deliveries')
    )).toBe(false);
    await expect(store.prepareNonAgentTextDeliveryTurn(
      preparationInput(),
    )).resolves.toMatchObject({
      status: 'prepared',
      turn: { id: 'turn_human_postgres' },
    });

    // A process restart after reservation but before dispatch safely resumes
    // from the durable pending record.
    const restartedStore = new PostgresStore(harness.db);
    const sending = await restartedStore.beginNonAgentTextDeliveryAttempt({
      requestKey,
      sessionId,
      expectedSessionAuthorityGeneration: 4,
      expectedAgentId: 'agent-secret',
      nextDeliveryAttempt: 1,
      deliveryAttemptToken: 'attempt-token-1',
      leaseExpiresAt: '2026-07-20T00:00:10.000Z',
      updatedAt: '2026-07-20T00:00:01.000Z',
    });
    expect(sending).toMatchObject({
      status: 'dispatch_authorized',
      record: {
        status: 'sending',
        deliveryAttempt: 1,
        deliveryAttemptToken: 'attempt-token-1',
      },
    });

    await expect(
      restartedStore.beginNonAgentTextDeliveryAttempt({
        requestKey,
        sessionId,
        expectedSessionAuthorityGeneration: 4,
        expectedAgentId: 'agent-secret',
        nextDeliveryAttempt: 2,
        deliveryAttemptToken: 'attempt-token-2',
        leaseExpiresAt: '2026-07-20T00:00:20.000Z',
        updatedAt: '2026-07-20T00:00:02.000Z',
      }),
    ).resolves.toMatchObject({
      status: 'dispatch_blocked',
      reason: 'sending_in_progress',
    });

    await expect(
      restartedStore.reconcileNonAgentTextDelivery({
        requestKey,
        sessionId,
        deliveryAttempt: 1,
        deliveryAttemptToken: 'attempt-token-1',
        reason: 'sending_lease_expired',
        reconciledAt: '2026-07-20T00:00:09.000Z',
      }),
    ).resolves.toMatchObject({
      status: 'reconciliation_blocked',
      reason: 'sending_lease_active',
    });

    await expect(
      restartedStore.reconcileNonAgentTextDelivery({
        requestKey,
        sessionId,
        deliveryAttempt: 1,
        deliveryAttemptToken: 'attempt-token-1',
        reason: 'sending_lease_expired',
        reconciledAt: '2026-07-20T00:00:10.000Z',
      }),
    ).resolves.toMatchObject({
      status: 'reconciled',
      record: {
        status: 'outcome_unknown',
        outcomeCode: 'non_agent_delivery_sending_lease_expired',
      },
    });

    await expect(
      restartedStore.beginNonAgentTextDeliveryAttempt({
        requestKey,
        sessionId,
        expectedSessionAuthorityGeneration: 4,
        expectedAgentId: 'agent-secret',
        nextDeliveryAttempt: 2,
        deliveryAttemptToken: 'attempt-token-2',
        leaseExpiresAt: '2026-07-20T00:00:30.000Z',
        updatedAt: '2026-07-20T00:00:11.000Z',
      }),
    ).resolves.toMatchObject({
      status: 'dispatch_blocked',
      reason: 'outcome_unknown',
    });
  });

  it('retries only confirmed-not-sent and token-binds completion', async () => {
    const harness = postgresDeliveryHarness();
    const store = new PostgresStore(harness.db);
    await store.reserveNonAgentTextDelivery(reservationInput());
    await begin(store, 1, 'attempt-token-1', '2026-07-20T00:00:01.000Z');

    await expect(
      store.completeNonAgentTextDeliveryAttempt({
        requestKey,
        sessionId,
        deliveryAttempt: 1,
        deliveryAttemptToken: 'wrong-token',
        outcome: {
          status: 'confirmed_not_sent',
          errorCode: 'provider_rejected',
          message: 'provider secret must not persist',
        },
        updatedAt: '2026-07-20T00:00:02.000Z',
      }),
    ).resolves.toMatchObject({
      status: 'transition_blocked',
      reason: 'delivery_attempt_mismatch',
    });

    await expect(
      store.completeNonAgentTextDeliveryAttempt({
        requestKey,
        sessionId,
        deliveryAttempt: 1,
        deliveryAttemptToken: 'attempt-token-1',
        outcome: {
          status: 'confirmed_not_sent',
          errorCode: 'provider_rejected',
          message: 'provider secret must not persist',
        },
        updatedAt: '2026-07-20T00:00:02.000Z',
      }),
    ).resolves.toMatchObject({
      status: 'transitioned',
      record: {
        status: 'confirmed_not_sent',
        deliveryAttempt: 1,
        outcomeCode: 'non_agent_delivery_confirmed_not_sent',
      },
    });
    expect(JSON.stringify(harness.row)).not.toContain(
      'provider secret must not persist',
    );

    await expect(
      begin(store, 2, 'attempt-token-1', '2026-07-20T00:00:03.000Z'),
    ).resolves.toMatchObject({
      status: 'dispatch_blocked',
      reason: 'delivery_attempt_token_reused',
    });
    await expect(
      begin(store, 2, 'attempt-token-2', '2026-07-20T00:00:03.000Z'),
    ).resolves.toMatchObject({
      status: 'dispatch_authorized',
      record: { status: 'sending', deliveryAttempt: 2 },
    });
    await expect(
      store.completeNonAgentTextDeliveryAttempt({
        requestKey,
        sessionId,
        deliveryAttempt: 2,
        deliveryAttemptToken: 'attempt-token-2',
        outcome: {
          status: 'confirmed_sent',
          messageId: 'provider-message-2',
        },
        updatedAt: '2026-07-20T00:00:04.000Z',
      }),
    ).resolves.toMatchObject({
      status: 'transitioned',
      record: {
        status: 'confirmed_sent',
        providerMessageId: 'provider-message-2',
      },
    });
    await expect(
      begin(store, 3, 'attempt-token-3', '2026-07-20T00:00:05.000Z'),
    ).resolves.toMatchObject({
      status: 'dispatch_blocked',
      reason: 'confirmed_sent',
    });
  });

  it('requires the exact human authority and replays only the same binding', async () => {
    const harness = postgresDeliveryHarness();
    const store = new PostgresStore(harness.db);
    await expect(
      store.reserveNonAgentTextDelivery({
        ...reservationInput(),
        expectedSessionAuthorityGeneration: 3,
      }),
    ).resolves.toEqual({ status: 'stale_authority' });
    expect(harness.row).toBeUndefined();

    const first = await store.reserveNonAgentTextDelivery(reservationInput());
    expect(first.status).toBe('reserved');
    harness.setAuthority(5, 'agent-b');
    await expect(
      store.beginNonAgentTextDeliveryAttempt({
        requestKey,
        sessionId,
        expectedSessionAuthorityGeneration: 5,
        expectedAgentId: 'agent-b',
        nextDeliveryAttempt: 1,
        deliveryAttemptToken: 'agent-b-attempt',
        leaseExpiresAt: '2026-07-20T00:00:10.000Z',
        updatedAt: '2026-07-20T00:00:01.000Z',
      }),
    ).resolves.toMatchObject({
      status: 'dispatch_blocked',
      reason: 'stale_authority',
    });
    await expect(
      store.reserveNonAgentTextDelivery(reservationInput()),
    ).resolves.toMatchObject({ status: 'replay' });
    await expect(
      store.reserveNonAgentTextDelivery({
        ...reservationInput(),
        presentationText: 'a different presentation',
      }),
    ).resolves.toEqual({ status: 'conflict' });
  });

  it('caps confirmed-not-sent retries at three dispatch attempts', async () => {
    const harness = postgresDeliveryHarness();
    const store = new PostgresStore(harness.db);
    await store.reserveNonAgentTextDelivery(reservationInput());
    for (const attempt of [1, 2, 3]) {
      const updatedAt = `2026-07-20T00:00:0${attempt * 2 - 1}.000Z`;
      await expect(
        begin(
          store,
          attempt,
          `attempt-token-${attempt}`,
          updatedAt,
        ),
      ).resolves.toMatchObject({ status: 'dispatch_authorized' });
      await expect(
        store.completeNonAgentTextDeliveryAttempt({
          requestKey,
          sessionId,
          deliveryAttempt: attempt,
          deliveryAttemptToken: `attempt-token-${attempt}`,
          outcome: {
            status: 'confirmed_not_sent',
            errorCode: 'provider_rejected',
            message: 'not persisted',
          },
          updatedAt:
            `2026-07-20T00:00:0${attempt * 2}.000Z`,
        }),
      ).resolves.toMatchObject({ status: 'transitioned' });
    }
    await expect(
      begin(store, 4, 'attempt-token-4', '2026-07-20T00:00:07.000Z'),
    ).resolves.toMatchObject({
      status: 'dispatch_blocked',
      reason: 'attempts_exhausted',
    });
  });
});

function reservationInput() {
  return {
    requestKey,
    sessionId,
    expectedSessionAuthorityGeneration: 4,
    expectedAgentId: 'agent-secret',
    channel: 'messenger' as const,
    assistantTurnId: 'turn_human_postgres',
    recipientId: 'recipient-secret',
    presentationText: 'presentation-secret',
    createdAt: '2026-07-20T00:00:00.000Z',
  };
}

function preparationInput() {
  return {
    requestKey,
    sessionId,
    expectedSessionAuthorityGeneration: 4,
    expectedAgentId: 'agent-secret',
    turn: {
      id: 'turn_human_postgres',
      sessionId,
      channel: 'messenger' as const,
      role: 'assistant' as const,
      text: 'presentation-secret',
      externalMessageId: null,
      externalUserId: 'recipient-secret',
      deliveryStatus: 'pending' as const,
      metadata: {
        authorType: 'human_agent' as const,
        agentId: 'agent-secret',
      },
      createdAt: '2026-07-20T00:00:00.000Z',
    },
  };
}

function begin(
  store: PostgresStore,
  attempt: number,
  token: string,
  updatedAt: string,
) {
  return store.beginNonAgentTextDeliveryAttempt({
    requestKey,
    sessionId,
    expectedSessionAuthorityGeneration: 4,
    expectedAgentId: 'agent-secret',
    nextDeliveryAttempt: attempt,
    deliveryAttemptToken: token,
    leaseExpiresAt: new Date(
      Date.parse(updatedAt) + 10_000,
    ).toISOString(),
    updatedAt,
  });
}

function postgresDeliveryHarness() {
  let row: Record<string, unknown> | undefined;
  let turnRow: Record<string, unknown> | undefined;
  const attemptTokens = new Set<string>();
  const attempts = new Set<string>();
  const queries: string[] = [];
  let control = {
    session_id: sessionId,
    agent_mode: 'human_paused',
    assigned_agent_id: 'agent-secret',
    session_authority_generation: 4,
    updated_at: '2026-07-20T00:00:00.000Z',
  };
  const query = vi.fn(
    async (text: string, values: readonly unknown[] = []) => {
      queries.push(text);
      if (
        text === 'BEGIN' ||
        text === 'COMMIT' ||
        text === 'ROLLBACK' ||
        text.includes('pg_advisory_xact_lock')
      ) {
        return result([]);
      }
      if (text.includes('FROM session_controls')) {
        return result([control]);
      }
      if (
        text.includes('SELECT') &&
        text.includes('FROM non_agent_text_deliveries')
      ) {
        return result(
          row && row.request_key === values[0] ? [row] : [],
        );
      }
      if (text.includes('SELECT * FROM conversation_turns')) {
        return result(
          turnRow && turnRow.id === values[0] ? [turnRow] : [],
        );
      }
      if (text.includes('INSERT INTO conversation_turns')) {
        turnRow = {
          id: values[0],
          session_id: values[1],
          channel: values[2],
          role: values[3],
          text: values[4],
          external_message_id: values[5],
          external_user_id: values[6],
          delivery_status: values[7],
          metadata: values[8],
          created_at: values[9],
        };
        return result([turnRow]);
      }
      if (text.includes('INSERT INTO conversation_events')) {
        return result([]);
      }
      if (text.includes('INSERT INTO non_agent_text_delivery_attempts')) {
        const attemptKey = `${String(values[0])}:${String(values[1])}`;
        const token = String(values[2]);
        if (attemptTokens.has(token) || attempts.has(attemptKey)) {
          return result([]);
        }
        attemptTokens.add(token);
        attempts.add(attemptKey);
        return result([{ request_key: values[0] }]);
      }
      if (text.includes('INSERT INTO non_agent_text_deliveries')) {
        row = {
          schema_version: values[0],
          request_key: values[1],
          session_binding_digest: values[2],
          reserved_session_authority_generation: values[3],
          channel: values[4],
          assistant_turn_id: values[5],
          agent_binding_digest: values[6],
          recipient_binding_digest: values[7],
          presentation_binding_digest: values[8],
          delivery_binding_digest: values[9],
          status: values[10],
          delivery_attempt: values[11],
          delivery_attempt_token: values[12],
          sending_lease_expires_at: values[13],
          provider_message_id: values[14],
          outcome_code: values[15],
          created_at: values[16],
          updated_at: values[17],
        };
        return result([row]);
      }
      if (text.includes('UPDATE non_agent_text_deliveries')) {
        if (!row) return result([]);
        row = {
          ...row,
          status: values[2],
          delivery_attempt: values[3],
          delivery_attempt_token: values[4],
          sending_lease_expires_at: values[5],
          provider_message_id: values[6],
          outcome_code: values[7],
          updated_at: values[8],
        };
        return result([{ request_key: row.request_key }]);
      }
      throw new Error(`Unexpected Postgres query: ${text}`);
    },
  );
  const client = {
    query,
    release: vi.fn(),
  } as unknown as PoolClient;
  const db = {
    connect: vi.fn(async () => client),
    query,
  } as unknown as Pool;
  return {
    db,
    get row() {
      return row;
    },
    queries,
    setAuthority(generation: number, agentId: string) {
      control = {
        ...control,
        assigned_agent_id: agentId,
        session_authority_generation: generation,
      };
    },
  };
}

function result(rows: Record<string, unknown>[]): QueryResult {
  return {
    command: '',
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows,
  };
}
