import { describe, expect, it, vi } from 'vitest';
import { D1Store } from '../../src/persistence/d1Store.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import { FakeD1Database } from '../support/fakeD1Database.js';

const sessionId = 'messenger:reset-me';

describe('complete session reset', () => {
  it('clears every MemoryStore record owned by the session and invokes the external reset hook', async () => {
    const hook = vi.fn(async () => undefined);
    const store = new MemoryStore(hook);
    const customerRun = {
      id: 'customer-run', schemaVersion: 1 as const, sessionId, customerId: 'reset-me',
      clientMessageId: 'mid-1', requestFingerprint: 'fingerprint', generation: 1,
      status: 'accepted' as const, phase: 'queued' as const, nextEventSequence: 1,
      clientSchemaVersion: 1, acceptedAt: '2026-07-15T00:00:00.000Z', startedAt: null,
      terminalAt: null, updatedAt: '2026-07-15T00:00:00.000Z',
    };
    await store.createCustomerRun(customerRun);
    await store.appendCustomerRunEvent({
      eventId: 'event-1', runId: customerRun.id, expectedSequence: 1, schemaVersion: 1,
      type: 'run_accepted', occurredAt: customerRun.acceptedAt, payload: {},
    });
    await store.appendTurn({
      sessionId, channel: 'messenger', role: 'user', text: 'Xin chào', externalMessageId: 'mid-1',
      externalUserId: 'reset-me', deliveryStatus: 'received', metadata: null,
    });
    await store.reserveWebhookDelivery({
      channel: 'messenger', externalEventId: 'mid-1', externalThreadId: 'reset-me',
      externalUserId: 'reset-me', sessionId, receivedAt: customerRun.acceptedAt, payload: {},
    });
    const pending = await store.upsertPendingCustomerTurn({
      turnId: 'pending-1', sessionId, channel: 'messenger', externalMessageId: 'mid-1',
      externalUserId: 'reset-me', text: 'Xin chào', steerMode: 'steering', status: 'pending',
      claimedRunId: null, receivedAt: customerRun.acceptedAt,
    });
    await store.createAgentRun({
      id: 'agent-run', sessionId, generation: 1, channel: 'messenger', externalUserId: 'reset-me',
      status: 'scheduled', coalescedInputText: 'Xin chào', deliveryStatus: 'pending',
      scheduledAt: customerRun.acceptedAt,
    });
    await store.linkAgentRunTurn({ runId: 'agent-run', turnId: pending.turn.turnId, sequence: 0 });
    await store.setSessionAgentState({ sessionId, currentRunId: 'agent-run', generation: 1, debounceDeadlineAt: null });
    const irreversible = { requestId: 'place-order-1', sessionId, operation: 'placeOrder', bindingFingerprint: 'binding-1' };
    const reservation =
      await store.reserveIrreversibleOperation(irreversible);
    expect(reservation).toMatchObject({
      status: 'reserved',
      sessionAuthorityGeneration: 0,
    });
    await expect(
      store.transitionSessionAuthority({
        sessionId,
        expectedGeneration: 0,
        agentMode: 'human_paused',
        assignedAgentId: 'agent-1',
      }),
    ).resolves.toMatchObject({
      status: 'transitioned',
      control: {
        sessionAuthorityGeneration: 1,
      },
    });

    await expect(store.resetSession(sessionId)).resolves.toMatchObject({
      agentMode: 'ai_active',
      assignedAgentId: null,
      sessionAuthorityGeneration: 2,
    });

    expect(hook).toHaveBeenCalledWith(sessionId);
    await expect(store.listTurns(sessionId)).resolves.toEqual([]);
    await expect(store.listEvents(sessionId)).resolves.toEqual([]);
    await expect(store.listPendingCustomerTurns(sessionId)).resolves.toEqual([]);
    await expect(store.listAgentRuns(sessionId)).resolves.toEqual([]);
    await expect(store.listAgentRunTurns('agent-run')).resolves.toEqual([]);
    await expect(store.getCustomerRun('customer-run')).resolves.toBeUndefined();
    await expect(store.listCustomerRunEvents('customer-run')).resolves.toEqual([]);
    await expect(store.getWebhookDelivery('messenger', 'mid-1')).resolves.toBeUndefined();
    await expect(store.getIrreversibleOperation(irreversible)).resolves.toBeUndefined();
    await expect(store.getSessionControl(sessionId)).resolves.toMatchObject({
      agentMode: 'ai_active',
      assignedAgentId: null,
      sessionAuthorityGeneration: 2,
    });
    await expect(store.getSessionAgentState(sessionId)).resolves.toMatchObject({ currentRunId: null, generation: 0 });
  });

  it('leaves zero D1 rows for the session and current child tables', async () => {
    const db = new FakeD1Database();
    const hook = vi.fn(async () => undefined);
    const store = new D1Store(db, hook);
    await store.initialize();
    const directSessionTables = [
      'agent_session_items', 'conversation_turns', 'conversation_events', 'dashboard_events', 'webhook_deliveries',
      'pending_customer_turns', 'agent_runs', 'session_agent_state',
      'customer_runs', 'irreversible_operations',
    ] as const;
    for (const table of directSessionTables) {
      db.tables[table].push({ id: `${table}-owned`, session_id: sessionId });
      db.tables[table].push({ id: `${table}-other`, session_id: 'messenger:keep-me' });
    }
    db.tables.session_controls.push(
      {
        session_id: sessionId,
        agent_mode: 'human_paused',
        assigned_agent_id: 'agent-1',
        session_authority_generation: 4,
        updated_at: '2026-07-15T00:00:00.000Z',
      },
      {
        session_id: 'messenger:keep-me',
        agent_mode: 'ai_active',
        assigned_agent_id: null,
        session_authority_generation: 3,
        updated_at: '2026-07-15T00:00:00.000Z',
      },
    );
    db.tables.customer_run_events.push({ run_id: 'customer_runs-owned' }, { run_id: 'customer_runs-other' });
    db.tables.agent_run_turns.push({ run_id: 'agent_runs-owned' }, { run_id: 'agent_runs-other' });

    await store.resetSession(sessionId);

    expect(hook).toHaveBeenCalledWith(sessionId);
    for (const table of directSessionTables) {
      expect(db.tables[table].filter((row) => row.session_id === sessionId), table).toEqual([]);
      expect(db.tables[table].filter((row) => row.session_id === 'messenger:keep-me'), table).toHaveLength(1);
    }
    expect(db.tables.session_controls).toHaveLength(2);
    expect(db.tables.session_controls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          session_id: 'messenger:keep-me',
          session_authority_generation: 3,
        }),
        expect.objectContaining({
          session_id: sessionId,
          agent_mode: 'ai_active',
          assigned_agent_id: null,
          session_authority_generation: 5,
        }),
      ]),
    );
    expect(db.tables.customer_run_events).toEqual([{ run_id: 'customer_runs-other' }]);
    expect(db.tables.agent_run_turns).toEqual([{ run_id: 'agent_runs-other' }]);
  });

  it('abandons pending D1 non-agent delivery without redispatch and preserves its journal', async () => {
    const db = new FakeD1Database();
    const store = new D1Store(db);
    await store.initialize();
    await store.transitionSessionAuthority({
      sessionId,
      expectedGeneration: 0,
      agentMode: 'human_paused',
      assignedAgentId: 'agent-1',
    });
    await store.reserveNonAgentTextDelivery({
      requestKey: 'a'.repeat(64),
      sessionId,
      expectedSessionAuthorityGeneration: 1,
      expectedAgentId: 'agent-1',
      channel: 'messenger',
      assistantTurnId: 'turn_human_pending',
      recipientId: 'reset-me',
      presentationText: 'Human reply',
      createdAt: '2026-07-20T00:00:00.000Z',
    });
    await store.appendTurn({
      id: 'turn_human_pending',
      sessionId,
      channel: 'messenger',
      role: 'assistant',
      text: 'Human reply',
      externalMessageId: null,
      externalUserId: 'reset-me',
      deliveryStatus: 'pending',
      metadata: { authorType: 'human_agent', agentId: 'agent-1' },
    });

    await expect(store.resetSession(sessionId)).resolves.toMatchObject({
      agentMode: 'ai_active',
    });
    await expect(store.listTurns(sessionId)).resolves.toEqual([]);
    await expect(
      store.getNonAgentTextDelivery('a'.repeat(64)),
    ).resolves.toMatchObject({
      status: 'confirmed_not_sent',
      deliveryAttempt: 0,
      deliveryAttemptToken: null,
      outcomeCode: 'non_agent_delivery_abandoned_by_reset',
    });
  });

  it('blocks D1 reset while a non-agent send lease is active', async () => {
    const db = new FakeD1Database();
    const store = new D1Store(db);
    await store.initialize();
    await store.transitionSessionAuthority({
      sessionId,
      expectedGeneration: 0,
      agentMode: 'human_paused',
      assignedAgentId: 'agent-1',
    });
    await store.reserveNonAgentTextDelivery({
      requestKey: 'b'.repeat(64),
      sessionId,
      expectedSessionAuthorityGeneration: 1,
      expectedAgentId: 'agent-1',
      channel: 'messenger',
      assistantTurnId: 'turn_human_active',
      recipientId: 'reset-me',
      presentationText: 'Human active reply',
      createdAt: '2026-07-20T00:00:00.000Z',
    });
    await store.beginNonAgentTextDeliveryAttempt({
      requestKey: 'b'.repeat(64),
      sessionId,
      expectedSessionAuthorityGeneration: 1,
      expectedAgentId: 'agent-1',
      nextDeliveryAttempt: 1,
      deliveryAttemptToken: 'reset-active-token',
      updatedAt: '2026-07-20T00:00:01.000Z',
      leaseExpiresAt: '2999-07-20T00:00:00.000Z',
    });

    await expect(store.resetSession(sessionId)).rejects.toMatchObject({
      code: 'session_reset_conflict',
    });
    await expect(
      store.getNonAgentTextDelivery('b'.repeat(64)),
    ).resolves.toMatchObject({
      status: 'sending',
      deliveryAttemptToken: 'reset-active-token',
    });
    expect(db.tables.non_agent_text_delivery_attempts).toHaveLength(1);
  });

  it('reconciles expired D1 sending to unknown and preserves dedicated journals while deleting inbound webhooks', async () => {
    const db = new FakeD1Database();
    const store = new D1Store(db);
    await store.initialize();
    await store.transitionSessionAuthority({
      sessionId,
      expectedGeneration: 0,
      agentMode: 'human_paused',
      assignedAgentId: 'agent-1',
    });
    await store.reserveNonAgentTextDelivery({
      requestKey: 'c'.repeat(64),
      sessionId,
      expectedSessionAuthorityGeneration: 1,
      expectedAgentId: 'agent-1',
      channel: 'messenger',
      assistantTurnId: 'turn_human_expired',
      recipientId: 'reset-me',
      presentationText: 'Human expired reply',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    await store.beginNonAgentTextDeliveryAttempt({
      requestKey: 'c'.repeat(64),
      sessionId,
      expectedSessionAuthorityGeneration: 1,
      expectedAgentId: 'agent-1',
      nextDeliveryAttempt: 1,
      deliveryAttemptToken: 'reset-expired-token',
      updatedAt: '2026-01-01T00:00:01.000Z',
      leaseExpiresAt: '2026-01-01T00:00:02.000Z',
    });
    await store.reserveWebhookDelivery({
      channel: 'messenger',
      externalEventId: 'inbound-complete',
      externalThreadId: 'thread',
      externalUserId: 'user',
      sessionId,
      receivedAt: '2026-07-20T00:00:00.000Z',
      payload: { message: { mid: 'inbound-complete' } },
    });
    await store.markWebhookDeliveryProcessed('messenger', 'inbound-complete');

    await expect(store.resetSession(sessionId)).resolves.toMatchObject({
      agentMode: 'ai_active',
    });
    await expect(
      store.getNonAgentTextDelivery('c'.repeat(64)),
    ).resolves.toMatchObject({
      status: 'outcome_unknown',
      deliveryAttempt: 1,
      deliveryAttemptToken: 'reset-expired-token',
      outcomeCode:
        'non_agent_delivery_reset_sending_lease_expired',
    });
    expect(db.tables.non_agent_text_delivery_attempts).toEqual([
      expect.objectContaining({
        request_key: 'c'.repeat(64),
        delivery_attempt_token: 'reset-expired-token',
      }),
    ]);
    await expect(
      store.getWebhookDelivery('messenger', 'inbound-complete'),
    ).resolves.toBeUndefined();
    await expect(
      store.reserveNonAgentTextDelivery({
        requestKey: 'd'.repeat(64),
        sessionId,
        expectedSessionAuthorityGeneration: 1,
        expectedAgentId: 'agent-1',
        channel: 'messenger',
        assistantTurnId: 'turn_human_stale',
        recipientId: 'reset-me',
        presentationText: 'Stale reply',
        createdAt: '2026-07-20T00:01:00.000Z',
      }),
    ).resolves.toEqual({ status: 'stale_authority' });
  });
});
