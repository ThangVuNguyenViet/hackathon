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
    await store.setSessionControl(sessionId, { agentMode: 'human_paused', assignedAgentId: 'agent-1' });
    const irreversible = { requestId: 'place-order-1', sessionId, operation: 'placeOrder', bindingFingerprint: 'binding-1' };
    await store.reserveIrreversibleOperation(irreversible);

    await expect(store.resetSession(sessionId)).resolves.toMatchObject({ agentMode: 'ai_active', assignedAgentId: null });

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
    await expect(store.getSessionControl(sessionId)).resolves.toMatchObject({ agentMode: 'ai_active', assignedAgentId: null });
    await expect(store.getSessionAgentState(sessionId)).resolves.toMatchObject({ currentRunId: null, generation: 0 });
  });

  it('leaves zero D1 rows for the session, including checkpoint and child tables', async () => {
    const db = new FakeD1Database();
    const hook = vi.fn(async () => undefined);
    const store = new D1Store(db, hook);
    await store.initialize();
    const directSessionTables = [
      'conversation_turns', 'conversation_events', 'dashboard_events', 'webhook_deliveries',
      'session_controls', 'pending_customer_turns', 'agent_runs', 'session_agent_state',
      'customer_runs', 'irreversible_operations',
    ] as const;
    for (const table of directSessionTables) {
      db.tables[table].push({ id: `${table}-owned`, session_id: sessionId });
      db.tables[table].push({ id: `${table}-other`, session_id: 'messenger:keep-me' });
    }
    db.tables.customer_run_events.push({ run_id: 'customer_runs-owned' }, { run_id: 'customer_runs-other' });
    db.tables.agent_run_turns.push({ run_id: 'agent_runs-owned' }, { run_id: 'agent_runs-other' });
    db.tables.langgraph_checkpoints.push({ thread_id: sessionId }, { thread_id: 'messenger:keep-me' });
    db.tables.langgraph_checkpoint_writes.push({ thread_id: sessionId }, { thread_id: 'messenger:keep-me' });

    await store.resetSession(sessionId);

    expect(hook).toHaveBeenCalledWith(sessionId);
    for (const table of directSessionTables) {
      expect(db.tables[table].filter((row) => row.session_id === sessionId), table).toEqual([]);
      expect(db.tables[table].filter((row) => row.session_id === 'messenger:keep-me'), table).toHaveLength(1);
    }
    expect(db.tables.customer_run_events).toEqual([{ run_id: 'customer_runs-other' }]);
    expect(db.tables.agent_run_turns).toEqual([{ run_id: 'agent_runs-other' }]);
    expect(db.tables.langgraph_checkpoints).toEqual([{ thread_id: 'messenger:keep-me' }]);
    expect(db.tables.langgraph_checkpoint_writes).toEqual([{ thread_id: 'messenger:keep-me' }]);
  });
});
