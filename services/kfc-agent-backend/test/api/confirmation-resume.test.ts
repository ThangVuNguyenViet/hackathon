import { MemorySaver } from '@langchain/langgraph';
import { fakeModel } from '@langchain/core/testing';
import { describe, expect, it } from 'vitest';
import { buildServer } from '../../src/api/server.js';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import { runAgentTurn } from '../fixtures/runAgentTurn.js';
import { StaticToolPlanner } from '../../src/llm/toolPlanner.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';
import { testResponseComposer } from '../fixtures/testResponseComposer.js';

describe('opaque confirmation resume route', () => {
  it('fails closed for the maintained agent until authenticated receipt authority is wired', async () => {
    const store = new MemoryStore();
    const requestId = '65ca3184-3cca-46e3-9e96-aa71f3728855';
    await store.appendEvent('kfc:pending_agent_approval', 'confirmation_pause_created', {
      requestId,
      customerId: 'pending_agent_approval',
      channel: 'kfc',
    });
    const server = buildServer({
      store,
      agent: {
        model: fakeModel(),
        identity: {
          provider: 'openai',
          model: 'gpt-4.1-mini',
          profile: 'openai-gpt-4.1-mini',
        },
      },
    });

    const response = await server.inject({
      method: 'POST',
      url: '/chat/kfc/confirmations/resume',
      payload: { requestId, decision: 'approve' },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      errorCode: 'agent_approval_authority_unconfigured',
    });
  });

  it('atomically resumes one trusted decision under concurrent duplicate and conflicting requests', async () => {
    const store = new MemoryStore();
    const dashboard = new DashboardEventBus();
    const checkpointer = new MemorySaver();
    const fixtures = createTestFixtures();
    const mockClientOptions = {
      mockedUpstreamApiProvider: () => ({}),
      fulfillmentQuoteProvider: async (input: { storeId: string }) => ({ ok: true as const, value: { storeId: input.storeId, feeVnd: 18_000, etaMinutes: 25 }, message: 'quoted' }),
    };
    const clients = createMockClients(fixtures, mockClientOptions);
    const sessionId = 'kfc:resume_customer';
    const customerId = 'resume_customer';
    await runAgentTurn({
      sessionId, customerId, channel: 'kfc', text: 'Cho mình Combo Hợp Gu 99K giao Big C Đồng Nai', externalMessageId: 'prepare',
      clients, store, dashboard, checkpointer,
      toolPlanner: new StaticToolPlanner([{ intent: 'ordering', entities: { cartMutationRequested: true, addressDraft: { line1: 'Big C Đồng Nai', district: 'Biên Hòa', city: 'Đồng Nai' } }, toolCalls: [
        { toolName: 'searchMenu', arguments: { query: 'Combo Hợp Gu 99K' } },
        { toolName: 'updateCart', arguments: { itemCode: '20751', quantity: 1 } },
        { toolName: 'quoteFulfillment', arguments: { method: 'delivery', itemCodes: ['20751'], address: { label: 'Big C Đồng Nai', line1: 'Big C Đồng Nai', district: 'Biên Hòa', city: 'Đồng Nai' } } },
      ], responseClaims: [] }]),
    });
    const paused = await runAgentTurn({ sessionId, customerId, channel: 'kfc', text: 'Xác nhận', externalMessageId: 'confirm', metadata: { customerCommand: { kind: 'confirm_order' } }, clients, store, dashboard, checkpointer });
    const requestId = paused.pause!.requestId;
    await store.appendEvent(sessionId, 'confirmation_pause_created', { requestId, customerId, channel: 'kfc' });
    const server = buildServer({ store, dashboard, checkpointer, fixtures, mockClientOptions, responseComposer: testResponseComposer });

    const rejectedShape = await server.inject({ method: 'POST', url: '/chat/kfc/confirmations/resume', payload: { requestId, decision: 'approve', sessionId } });
    expect(rejectedShape.statusCode).toBe(400);
    const duplicates = await Promise.all([
      server.inject({ method: 'POST', url: '/chat/kfc/confirmations/resume', payload: { requestId, decision: 'approve' } }),
      server.inject({ method: 'POST', url: '/chat/kfc/confirmations/resume', payload: { requestId, decision: 'approve' } }),
    ]);
    const resumed = duplicates.find(({ statusCode }) => statusCode === 200)!;
    expect(duplicates.map(({ statusCode }) => statusCode).sort()).toEqual(expect.arrayContaining([200]));
    expect(duplicates.every(({ statusCode }) => statusCode === 200 || statusCode === 409)).toBe(true);
    expect(resumed.json()).toMatchObject({ status: 'completed', state: { userConfirmedOrder: true } });
    expect(resumed.json().pause).toBeUndefined();
    const conflict = await server.inject({ method: 'POST', url: '/chat/kfc/confirmations/resume', payload: { requestId, decision: 'reject' } });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toEqual({ errorCode: 'confirmation_decision_conflict' });
    expect((await store.listEvents(sessionId)).filter(({ sourceType }) => sourceType === 'confirmation_resume_completed')).toHaveLength(1);
  });
});
