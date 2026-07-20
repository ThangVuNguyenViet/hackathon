import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../../src/persistence/memoryStore.js';

const sessionId = 'messenger:memory-non-agent-delivery';
const agentId = 'agent-memory-1';

async function pausedStore(): Promise<MemoryStore> {
  const store = new MemoryStore();
  await store.transitionSessionAuthority({
    sessionId,
    expectedGeneration: 0,
    agentMode: 'human_paused',
    assignedAgentId: agentId,
  });
  return store;
}

function requestKey(character: string): string {
  return character.repeat(64);
}

function reservationInput(
  key: string,
  createdAt = '2026-07-20T00:00:00.000Z',
) {
  return {
    requestKey: key,
    sessionId,
    expectedSessionAuthorityGeneration: 1,
    expectedAgentId: agentId,
    channel: 'messenger' as const,
    assistantTurnId: `turn_${key.slice(0, 8)}`,
    recipientId: 'psid-private-recipient',
    presentationText: 'Private human-authored reply',
    createdAt,
  };
}

function beginInput(
  key: string,
  token: string,
  nextDeliveryAttempt: number,
  updatedAt = '2026-07-20T00:00:01.000Z',
  leaseExpiresAt = '2026-07-20T00:00:31.000Z',
) {
  return {
    requestKey: key,
    sessionId,
    expectedSessionAuthorityGeneration: 1,
    expectedAgentId: agentId,
    nextDeliveryAttempt,
    deliveryAttemptToken: token,
    leaseExpiresAt,
    updatedAt,
  };
}

describe('MemoryStore non-agent text delivery state machine', () => {
  it('serializes the pending-to-sending CAS and fences completion by attempt token', async () => {
    const store = await pausedStore();
    const key = requestKey('a');
    const reservation = await store.reserveNonAgentTextDelivery(
      reservationInput(key),
    );
    expect(reservation).toMatchObject({
      status: 'reserved',
      record: {
        status: 'pending',
        deliveryAttempt: 0,
        deliveryAttemptToken: null,
      },
    });
    expect(JSON.stringify(reservation)).not.toContain(
      'psid-private-recipient',
    );
    expect(JSON.stringify(reservation)).not.toContain(
      'Private human-authored reply',
    );
    expect(JSON.stringify(reservation)).not.toContain(agentId);
    expect(JSON.stringify(reservation)).not.toContain(sessionId);
    await expect(
      store.reserveNonAgentTextDelivery(reservationInput(key)),
    ).resolves.toMatchObject({
      status: 'replay',
    });
    await expect(
      store.reserveNonAgentTextDelivery({
        ...reservationInput(key),
        presentationText: 'Conflicting human-authored reply',
      }),
    ).resolves.toEqual({
      status: 'conflict',
    });

    const starts = await Promise.all([
      store.beginNonAgentTextDeliveryAttempt(
        beginInput(key, 'attempt-token-a', 1),
      ),
      store.beginNonAgentTextDeliveryAttempt(
        beginInput(key, 'attempt-token-b', 1),
      ),
    ]);
    expect(
      starts.filter((result) => result.status === 'dispatch_authorized'),
    ).toHaveLength(1);
    expect(starts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: 'dispatch_authorized' }),
        expect.objectContaining({
          status: 'dispatch_blocked',
          reason: 'sending_in_progress',
        }),
      ]),
    );
    const authorized = starts.find(
      (result) => result.status === 'dispatch_authorized',
    );
    if (authorized?.status !== 'dispatch_authorized') {
      throw new Error('dispatch owner missing');
    }

    await expect(
      store.completeNonAgentTextDeliveryAttempt({
        requestKey: key,
        sessionId,
        deliveryAttempt: 1,
        deliveryAttemptToken: 'not-the-owner-token',
        outcome: { status: 'confirmed_sent', messageId: 'message-1' },
        updatedAt: '2026-07-20T00:00:02.000Z',
      }),
    ).resolves.toMatchObject({
      status: 'transition_blocked',
      reason: 'delivery_attempt_mismatch',
      record: { status: 'sending' },
    });
    await expect(
      store.completeNonAgentTextDeliveryAttempt({
        requestKey: key,
        sessionId,
        deliveryAttempt: 1,
        deliveryAttemptToken: authorized.record.deliveryAttemptToken,
        outcome: { status: 'confirmed_sent', messageId: 'message-1' },
        updatedAt: '2026-07-20T00:00:02.000Z',
      }),
    ).resolves.toMatchObject({
      status: 'transitioned',
      record: {
        status: 'confirmed_sent',
        providerMessageId: 'message-1',
      },
    });
    await expect(
      store.beginNonAgentTextDeliveryAttempt(
        beginInput(key, 'must-not-redispatch', 2),
      ),
    ).resolves.toMatchObject({
      status: 'dispatch_blocked',
      reason: 'confirmed_sent',
    });
  });

  it('allows only confirmed-not-sent retries and enforces three attempts', async () => {
    const store = await pausedStore();
    const key = requestKey('b');
    await store.reserveNonAgentTextDelivery(reservationInput(key));

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const token = `attempt-token-${attempt}`;
      const beginSecond = attempt * 2 - 1;
      const completionSecond = attempt * 2;
      await expect(
        store.beginNonAgentTextDeliveryAttempt(
          beginInput(
            key,
            token,
            attempt,
            `2026-07-20T00:00:0${beginSecond}.000Z`,
            `2026-07-20T00:01:0${beginSecond}.000Z`,
          ),
        ),
      ).resolves.toMatchObject({
        status: 'dispatch_authorized',
        record: {
          status: 'sending',
          deliveryAttempt: attempt,
          deliveryAttemptToken: token,
        },
      });
      await expect(
        store.completeNonAgentTextDeliveryAttempt({
          requestKey: key,
          sessionId,
          deliveryAttempt: attempt,
          deliveryAttemptToken: token,
          outcome: {
            status: 'confirmed_not_sent',
            errorCode: 'messenger_send_rejected',
            message: 'Provider rejected before accepting the message',
          },
          updatedAt: `2026-07-20T00:00:0${completionSecond}.000Z`,
        }),
      ).resolves.toMatchObject({
        status: 'transitioned',
        record: {
          status: 'confirmed_not_sent',
          deliveryAttempt: attempt,
          outcomeCode: 'non_agent_delivery_confirmed_not_sent',
        },
      });
      if (attempt === 1) {
        await expect(
          store.beginNonAgentTextDeliveryAttempt(
            beginInput(
              key,
              token,
              2,
              '2026-07-20T00:00:03.000Z',
              '2026-07-20T00:01:03.000Z',
            ),
          ),
        ).resolves.toMatchObject({
          status: 'dispatch_blocked',
          reason: 'delivery_attempt_token_reused',
          record: {
            status: 'confirmed_not_sent',
            deliveryAttempt: 1,
          },
        });
      }
    }

    await expect(
      store.beginNonAgentTextDeliveryAttempt(
        beginInput(key, 'attempt-token-4', 4),
      ),
    ).resolves.toMatchObject({
      status: 'dispatch_blocked',
      reason: 'attempts_exhausted',
    });

    const secondKey = requestKey('9');
    await store.reserveNonAgentTextDelivery(reservationInput(secondKey));
    await expect(
      store.beginNonAgentTextDeliveryAttempt(
        beginInput(secondKey, 'attempt-token-1', 1),
      ),
    ).resolves.toMatchObject({
      status: 'dispatch_blocked',
      reason: 'delivery_attempt_token_reused',
      record: { status: 'pending' },
    });
  });

  it('reconciles an expired sending lease to outcome unknown and never redispatches it', async () => {
    const store = await pausedStore();
    const key = requestKey('c');
    await store.reserveNonAgentTextDelivery(
      reservationInput(key, '2020-01-01T00:00:00.000Z'),
    );
    await store.beginNonAgentTextDeliveryAttempt(
      beginInput(
        key,
        'crashed-attempt-token',
        1,
        '2020-01-01T00:00:01.000Z',
        '2020-01-01T00:00:31.000Z',
      ),
    );

    await expect(
      store.reconcileNonAgentTextDelivery({
        requestKey: key,
        sessionId,
        deliveryAttempt: 1,
        deliveryAttemptToken: 'crashed-attempt-token',
        reason: 'sending_lease_expired',
        reconciledAt: '2020-01-01T00:00:30.000Z',
      }),
    ).resolves.toMatchObject({
      status: 'reconciliation_blocked',
      reason: 'sending_lease_active',
    });
    await expect(
      store.reconcileNonAgentTextDelivery({
        requestKey: key,
        sessionId,
        deliveryAttempt: 1,
        deliveryAttemptToken: 'crashed-attempt-token',
        reason: 'sending_lease_expired',
        reconciledAt: '2020-01-01T00:00:31.000Z',
      }),
    ).resolves.toMatchObject({
      status: 'reconciled',
      record: {
        status: 'outcome_unknown',
        outcomeCode: 'non_agent_delivery_sending_lease_expired',
      },
    });
    await expect(
      store.beginNonAgentTextDeliveryAttempt(
        beginInput(key, 'must-not-redispatch', 2),
      ),
    ).resolves.toMatchObject({
      status: 'dispatch_blocked',
      reason: 'outcome_unknown',
    });
  });

  it('resolves pre-dispatch and stale-sending records safely during reset', async () => {
    const store = await pausedStore();
    const pendingKey = requestKey('d');
    const expiredSendingKey = requestKey('e');
    const sentKey = requestKey('f');
    await store.reserveNonAgentTextDelivery(
      reservationInput(pendingKey, '2020-01-01T00:00:00.000Z'),
    );
    await store.reserveNonAgentTextDelivery(
      reservationInput(expiredSendingKey, '2020-01-01T00:00:00.000Z'),
    );
    await store.beginNonAgentTextDeliveryAttempt(
      beginInput(
        expiredSendingKey,
        'expired-attempt-token',
        1,
        '2020-01-01T00:00:01.000Z',
        '2020-01-01T00:00:31.000Z',
      ),
    );
    await store.reserveNonAgentTextDelivery(
      reservationInput(sentKey, '2020-01-01T00:00:00.000Z'),
    );
    await store.beginNonAgentTextDeliveryAttempt(
      beginInput(
        sentKey,
        'sent-attempt-token',
        1,
        '2020-01-01T00:00:01.000Z',
        '2020-01-01T00:00:31.000Z',
      ),
    );
    await store.completeNonAgentTextDeliveryAttempt({
      requestKey: sentKey,
      sessionId,
      deliveryAttempt: 1,
      deliveryAttemptToken: 'sent-attempt-token',
      outcome: { status: 'confirmed_sent', messageId: 'provider-message-1' },
      updatedAt: '2020-01-01T00:00:02.000Z',
    });

    await expect(store.resetSession(sessionId)).resolves.toMatchObject({
      agentMode: 'ai_active',
      sessionAuthorityGeneration: 2,
    });
    await expect(
      store.getNonAgentTextDelivery(pendingKey),
    ).resolves.toMatchObject({
      status: 'confirmed_not_sent',
      deliveryAttempt: 0,
      deliveryAttemptToken: null,
      outcomeCode: 'non_agent_delivery_abandoned_by_reset',
    });
    await expect(
      store.beginNonAgentTextDeliveryAttempt(
        beginInput(pendingKey, 'must-not-revive-reset-request', 1),
      ),
    ).resolves.toMatchObject({
      status: 'dispatch_blocked',
      reason: 'stale_authority',
    });
    await store.transitionSessionAuthority({
      sessionId,
      expectedGeneration: 2,
      agentMode: 'human_paused',
      assignedAgentId: agentId,
    });
    await expect(
      store.beginNonAgentTextDeliveryAttempt({
        ...beginInput(pendingKey, 'must-not-survive-authority-aba', 1),
        expectedSessionAuthorityGeneration: 3,
      }),
    ).resolves.toMatchObject({
      status: 'dispatch_blocked',
      reason: 'stale_authority',
    });
    await expect(
      store.getNonAgentTextDelivery(expiredSendingKey),
    ).resolves.toMatchObject({
      status: 'outcome_unknown',
      outcomeCode: 'non_agent_delivery_reset_sending_lease_expired',
    });
    await expect(
      store.getNonAgentTextDelivery(sentKey),
    ).resolves.toMatchObject({
      status: 'confirmed_sent',
      providerMessageId: 'provider-message-1',
    });
  });

  it('blocks reset while a sending lease is active and preserves all records', async () => {
    const store = await pausedStore();
    const pendingKey = requestKey('1');
    const activeSendingKey = requestKey('2');
    await store.reserveNonAgentTextDelivery(
      reservationInput(pendingKey, '2026-07-20T00:00:00.000Z'),
    );
    await store.reserveNonAgentTextDelivery(
      reservationInput(activeSendingKey, '2026-07-20T00:00:00.000Z'),
    );
    await store.beginNonAgentTextDeliveryAttempt(
      beginInput(
        activeSendingKey,
        'active-attempt-token',
        1,
        '2026-07-20T00:00:01.000Z',
        '2099-01-01T00:00:00.000Z',
      ),
    );

    await expect(store.resetSession(sessionId)).rejects.toMatchObject({
      code: 'session_reset_conflict',
    });
    await expect(
      store.getNonAgentTextDelivery(pendingKey),
    ).resolves.toMatchObject({ status: 'pending' });
    await expect(
      store.getNonAgentTextDelivery(activeSendingKey),
    ).resolves.toMatchObject({ status: 'sending' });
  });
});
