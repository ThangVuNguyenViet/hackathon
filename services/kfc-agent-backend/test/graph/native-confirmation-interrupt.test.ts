import { describe, expect, it } from 'vitest';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import { runAgentTurn, type AgentTurnInput } from '../fixtures/runAgentTurn.js';
import { StaticToolPlanner } from '../../src/llm/toolPlanner.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import { D1CheckpointSaver } from '../../src/persistence/d1CheckpointSaver.js';
import { D1Store } from '../../src/persistence/d1Store.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';
import { FakeD1Database } from '../support/fakeD1Database.js';

async function readyConfirmation(
  profile: { unavailableItemCodes?: string[] } = {},
  useD1Store = false,
) {
  const db = new FakeD1Database();
  const store = useD1Store ? new D1Store(db) : new MemoryStore();
  if (store instanceof D1Store) await store.initialize();
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
    const fixture = await readyConfirmation({}, true);
    const resume = { requestId: fixture.paused.pause!.requestId, approved: true };
    const [left, right] = await Promise.all([
      runAgentTurn({ ...fixture.base, externalMessageId: 'resume-a', confirmationResume: resume, checkpointer: new D1CheckpointSaver(fixture.db) }),
      runAgentTurn({ ...fixture.base, externalMessageId: 'resume-b', confirmationResume: resume, checkpointer: new D1CheckpointSaver(fixture.db) }),
    ]);

    expect(fixture.placeOrderCalls()).toBe(1);
    expect(left.state.order).toMatchObject({ status: 'created' });
    expect(right.state.order).toEqual(left.state.order);
  });

  it('reclaims an expired long call without applying its late stale result', async () => {
    const fixture = await readyConfirmation({}, true);
    const resume = { requestId: fixture.paused.pause!.requestId, approved: true };
    let providerCalls = 0;
    let enteredFirst!: () => void;
    let releaseFirst!: () => void;
    const firstEntered = new Promise<void>((resolve) => { enteredFirst = resolve; });
    const firstRelease = new Promise<void>((resolve) => { releaseFirst = resolve; });
    fixture.base.clients.oms.placeOrder = async (input) => {
      providerCalls += 1;
      const call = providerCalls;
      if (call === 1) {
        enteredFirst();
        await firstRelease;
      }
      return {
        ok: true,
        value: { ...input.preview, id: `ORDER-${call}`, status: 'created' },
        message: `placed-${call}`,
      };
    };

    const first = runAgentTurn({
      ...fixture.base,
      externalMessageId: 'long-resume-1',
      confirmationResume: resume,
      checkpointer: new D1CheckpointSaver(fixture.db),
    });
    await firstEntered;
    const row = fixture.db.tables.irreversible_operations.find((candidate) => candidate.request_id === resume.requestId)!;
    row.lease_expires_at = '2000-01-01T00:00:00.000Z';
    const second = await runAgentTurn({
      ...fixture.base,
      externalMessageId: 'long-resume-2',
      confirmationResume: resume,
      checkpointer: new D1CheckpointSaver(fixture.db),
    });
    releaseFirst();
    const late = await first;

    expect(providerCalls).toBe(2);
    expect(second.state.order?.id).toBe('ORDER-2');
    expect(late.state.order).toEqual(second.state.order);
    expect(row.status).toBe('completed');
    expect(JSON.parse(String(row.result_json)).value.id).toBe('ORDER-2');
  });

  it('reconciles an unknown provider outcome with the same downstream idempotency identity', async () => {
    const fixture = await readyConfirmation();
    const delegate = fixture.base.clients.oms.placeOrder.bind(fixture.base.clients.oms);
    const downstreamRequestIds: string[] = [];
    let disconnect = true;
    fixture.base.clients.oms.placeOrder = async (input) => {
      downstreamRequestIds.push(input.context?.clientMessageId ?? 'missing');
      if (disconnect) {
        disconnect = false;
        throw new Error('connection_lost_after_submit');
      }
      return delegate(input);
    };
    const resume = { requestId: fixture.paused.pause!.requestId, approved: true };

    await expect(runAgentTurn({ ...fixture.base, confirmationResume: resume, checkpointer: new D1CheckpointSaver(fixture.db) }))
      .rejects.toThrow('connection_lost_after_submit');
    const recovered = await runAgentTurn({
      ...fixture.base,
      externalMessageId: 'different-resume-message',
      confirmationResume: resume,
      checkpointer: new D1CheckpointSaver(fixture.db),
    });

    expect(recovered.state.order).toMatchObject({ status: 'created' });
    expect(downstreamRequestIds).toEqual([resume.requestId, resume.requestId]);
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

  it('fails closed when trusted environment or scenario authority no longer matches the checkpoint', async () => {
    const fixture = await readyConfirmation();
    fixture.base.clients.confirmationAuthority!.scenarioId = 'other-scenario';
    const output = await runAgentTurn({
      ...fixture.base,
      confirmationResume: { requestId: fixture.paused.pause!.requestId, approved: true },
      checkpointer: new D1CheckpointSaver(fixture.db),
    });

    expect(output.state.order).toBeUndefined();
    expect(output.replyIntent).toBe('ask_clarification');
    expect(fixture.placeOrderCalls()).toBe(0);
  });
});
