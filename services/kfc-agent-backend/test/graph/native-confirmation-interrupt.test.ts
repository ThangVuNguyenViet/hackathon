import { describe, expect, it } from 'vitest';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import { runAgentTurn, type AgentTurnInput } from '../../src/graph/buildGraph.js';
import { StaticToolPlanner } from '../../src/llm/toolPlanner.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import { D1CheckpointSaver } from '../../src/persistence/d1CheckpointSaver.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';
import { FakeD1Database } from '../support/fakeD1Database.js';

async function readyConfirmation(profile: { unavailableItemCodes?: string[] } = {}) {
  const db = new FakeD1Database();
  const store = new MemoryStore();
  const dashboard = new DashboardEventBus();
  const clients = createMockClients(createTestFixtures(), {
    mockedUpstreamApiProvider: () => profile,
    fulfillmentQuoteProvider: async (input) => ({
      ok: true,
      value: { storeId: input.storeId, feeVnd: 18_000, etaMinutes: 25 },
      message: 'quoted',
    }),
  });
  let placeOrderCalls = 0;
  const placeOrder = clients.oms.placeOrder.bind(clients.oms);
  clients.oms.placeOrder = async (input) => {
    placeOrderCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return placeOrder(input);
  };

  await runAgentTurn({
    sessionId: 'native-confirmation',
    customerId: 'customer-1',
    channel: 'kfc',
    text: 'Cho mình Combo Hợp Gu 99K giao tới Big C Đồng Nai, Biên Hòa, Đồng Nai',
    externalMessageId: 'prepare-1',
    clients,
    store,
    dashboard,
    checkpointer: new D1CheckpointSaver(db),
    toolPlanner: new StaticToolPlanner([{
      intent: 'ordering',
      entities: {
        cartMutationRequested: true,
        addressDraft: { line1: 'Big C Đồng Nai', district: 'Biên Hòa', city: 'Đồng Nai' },
      },
      toolCalls: [
        { toolName: 'searchMenu', arguments: { query: 'Combo Hợp Gu 99K' } },
        { toolName: 'updateCart', arguments: { itemCode: '20751', quantity: 1 } },
        {
          toolName: 'quoteFulfillment',
          arguments: {
            method: 'delivery',
            itemCodes: ['20751'],
            address: { label: 'Big C Đồng Nai', line1: 'Big C Đồng Nai', district: 'Biên Hòa', city: 'Đồng Nai' },
          },
        },
      ],
      responseClaims: [],
    }]),
  });

  const base: AgentTurnInput = {
    sessionId: 'native-confirmation',
    customerId: 'customer-1',
    channel: 'kfc',
    text: 'Xác nhận đơn',
    externalMessageId: 'confirm-1',
    metadata: { customerCommand: { kind: 'confirm_order' } },
    clients,
    store,
    dashboard,
    checkpointer: new D1CheckpointSaver(db),
  };
  const paused = await runAgentTurn(base);
  expect(paused).toMatchObject({
    status: 'paused',
    pause: { capability: 'confirm_order', requestId: expect.any(String) },
  });
  expect(paused.state.userConfirmedOrder).toBe(false);
  expect(placeOrderCalls).toBe(0);
  return { base, db, paused, profile, placeOrderCalls: () => placeOrderCalls };
}

describe('native confirm_order interrupt', () => {
  it('resumes from a new graph instance and replays one result for concurrent duplicate resumes', async () => {
    const fixture = await readyConfirmation();
    const resume = { requestId: fixture.paused.pause!.requestId, approved: true };
    const [left, right] = await Promise.all([
      runAgentTurn({ ...fixture.base, externalMessageId: 'resume-a', confirmationResume: resume, checkpointer: new D1CheckpointSaver(fixture.db) }),
      runAgentTurn({ ...fixture.base, externalMessageId: 'resume-b', confirmationResume: resume, checkpointer: new D1CheckpointSaver(fixture.db) }),
    ]);

    expect(fixture.placeOrderCalls()).toBe(1);
    expect(left.state.order).toMatchObject({ status: 'created' });
    expect(right.state.order).toEqual(left.state.order);
  });

  it('fails closed before placeOrder when the provider binding changes while paused', async () => {
    const profile: { unavailableItemCodes?: string[] } = {};
    const fixture = await readyConfirmation(profile);
    profile.unavailableItemCodes = ['20751'];
    const output = await runAgentTurn({
      ...fixture.base,
      confirmationResume: { requestId: fixture.paused.pause!.requestId, approved: true },
      checkpointer: new D1CheckpointSaver(fixture.db),
    });

    expect(output.status).toBe('completed');
    expect(output.state.order).toBeUndefined();
    expect(output.replyIntent).toBe('ask_clarification');
    expect(fixture.placeOrderCalls()).toBe(0);
  });
});
