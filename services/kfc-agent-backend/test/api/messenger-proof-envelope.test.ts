import { describe, expect, it } from 'vitest';
import { buildServer } from '../../src/api/server.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';

describe('Messenger proof envelope', () => {
  it('is authenticated and fails closed when durable evidence is missing', async () => {
    const server = buildServer({ demoAdminToken: 'proof-token', store: new MemoryStore() });
    const url = '/admin/proof/messenger/sessions/messenger%3Apsid/envelope';

    expect((await server.inject({ method: 'GET', url })).statusCode).toBe(401);
    const response = await server.inject({ method: 'GET', url, headers: { authorization: 'Bearer proof-token' } });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ complete: false, missing: expect.arrayContaining(['webhook_deliveries', 'checkpoint_identifiers', 'lifecycle_audit']) });
  });

  it('correlates inbound delivery, run generation, checkpoint, lifecycle, provider, and outbound Graph API evidence', async () => {
    const sessionId = 'messenger:psid';
    const store = new MemoryStore();
    store.listTurns = async () => [
      { id: 'user-1', sessionId, channel: 'messenger', role: 'user', text: 'hello', externalMessageId: 'mid-in', externalUserId: 'psid', deliveryStatus: 'received', metadata: null, createdAt: '2026-07-15T00:00:00Z' },
      { id: 'assistant-1', sessionId, channel: 'messenger', role: 'assistant', text: 'hi', externalMessageId: 'mid-out', externalUserId: 'psid', deliveryStatus: 'sent', metadata: null, createdAt: '2026-07-15T00:00:01Z' },
    ];
    store.listWebhookDeliveries = async () => [{ channel: 'messenger', externalEventId: 'mid-in', externalThreadId: 'thread', externalUserId: 'psid', sessionId, status: 'processed', payload: {}, receivedAt: '2026-07-15T00:00:00Z', processedAt: '2026-07-15T00:00:01Z', failedAt: null, lastError: null, createdAt: '2026-07-15T00:00:00Z', updatedAt: '2026-07-15T00:00:01Z' }];
    store.listPendingCustomerTurns = async () => [{ turnId: 'user-1', sessionId, channel: 'messenger', externalMessageId: 'mid-in', externalUserId: 'psid', text: 'hello', steerMode: 'record_only', status: 'claimed', claimedRunId: 'run-1', receivedAt: '2026-07-15T00:00:00Z', updatedAt: '2026-07-15T00:00:00Z' }];
    store.listAgentRuns = async () => [{ id: 'run-1', sessionId, generation: 1, sessionAuthorityGeneration: 0, channel: 'messenger', externalUserId: 'psid', status: 'completed', executionAttempt: 1, executionLeaseToken: '00000000-0000-4000-8000-000000000001', executionLeaseExpiresAt: '2026-07-15T00:01:00Z', coalescedInputText: 'hello', supersededByRunId: null, irreversibleSideEffectAt: null, irreversibleToolName: null, assistantTurnId: 'assistant-1', deliveryStatus: 'sent', deliveryExternalMessageId: 'mid-out', errorCode: null, errorMessage: null, scheduledAt: '2026-07-15T00:00:00Z', startedAt: '2026-07-15T00:00:00Z', completedAt: '2026-07-15T00:00:01Z', updatedAt: '2026-07-15T00:00:01Z' }];
    store.listAgentRunTurns = async () => [{ runId: 'run-1', turnId: 'user-1', sequence: 1 }];
    store.getSessionAgentState = async () => ({ sessionId, currentRunId: 'run-1', generation: 1, debounceDeadlineAt: null, updatedAt: '2026-07-15T00:00:01Z' });
    store.listCheckpointIdentifiers = async () => [{
      checkpointThreadId: 'messenger:psid-proof',
      checkpointNamespace: '',
      checkpointId: 'checkpoint-1',
      parentCheckpointId: null,
    }];
    store.listEvents = async () => [{ id: 'event-1', sessionId, sourceType: 'catalog_observation_pinned', payload: { observation: { id: 'catalog-1' } }, createdAt: '2026-07-15T00:00:00Z' }];
    const lifecycle = {
      environment: 'sandbox', controls: {}, createInput: async () => ({}), binding: async () => ({}),
      proofForSession: async () => ({ instance: { instanceId: 'lifecycle-1', revision: 1 }, audit: [{ revision: 1, eventId: 'lifecycle-event-1' }] }),
    } as never;
    const server = buildServer({ demoAdminToken: 'proof-token', store, lifecycle });
    const response = await server.inject({ method: 'GET', url: '/admin/proof/messenger/sessions/messenger%3Apsid/envelope', headers: { authorization: 'Bearer proof-token' } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ complete: true, missing: [], outbound: [{ graphApiExternalMessageId: 'mid-out', persistedExternalMessageId: 'mid-out' }] });
  });
});
