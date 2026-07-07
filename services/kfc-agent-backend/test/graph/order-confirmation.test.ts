import { describe, expect, it } from 'vitest';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import { runAgentTurn } from '../../src/graph/buildGraph.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';

const fixtures = createTestFixtures();

describe('runAgentTurn', () => {
  it('does not place an order before explicit confirmation', async () => {
    const store = new MemoryStore();
    const dashboard = new DashboardEventBus();
    const clients = createMockClients(fixtures);

    const output = await runAgentTurn({
      sessionId: 'session_1',
      customerId: 'customer_1',
      channel: 'messenger_mock',
      text: 'Cho mình 1 Combo Hợp Gu 99K',
      clients,
      store,
      dashboard,
    });

    expect(output.state.cart?.items[0]?.itemCode).toBe('20751');
    expect(output.state.order).toBeUndefined();
    expect(output.replyIntent).toBe('ask_fulfillment_method');
  });

  it('does not treat negated confirmation text as an explicit confirmation', async () => {
    const output = await runAgentTurn({
      sessionId: 'session_negated',
      customerId: 'customer_1',
      channel: 'messenger_mock',
      text: 'Mình chưa xác nhận đơn nha',
      clients: createMockClients(fixtures),
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
    });

    expect(output.state.userConfirmedOrder).toBe(false);
    expect(output.state.order).toBeUndefined();
  });

  it('asks for clarification instead of claiming cart success when no item matches', async () => {
    const dashboard = new DashboardEventBus();
    const output = await runAgentTurn({
      sessionId: 'session_unknown',
      customerId: 'customer_1',
      channel: 'messenger_mock',
      text: 'Cho mình 1 combo không tồn tại',
      clients: createMockClients(createTestFixtures({ menuItems: [] })),
      store: new MemoryStore(),
      dashboard,
    });

    expect(output.state.cart).toBeUndefined();
    expect(output.replyIntent).toBe('ask_clarification');
    expect(dashboard.getEvents('session_unknown')).toHaveLength(0);
  });

  it('does not retrieve the current long-range reference as prior evidence', async () => {
    const output = await runAgentTurn({
      sessionId: 'session_empty_history',
      customerId: 'customer_1',
      channel: 'messenger_mock',
      text: 'Giao tới chỗ cũ nha',
      clients: createMockClients(fixtures),
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
    });

    expect(output.state.retrievedEvidence).toEqual([]);
  });

  it('uses an injected response composer without changing graph business state', async () => {
    const store = new MemoryStore();
    const output = await runAgentTurn({
      sessionId: 'session_composer',
      customerId: 'customer_1',
      channel: 'messenger_mock',
      text: 'Cho mình 1 Combo Hợp Gu 99K',
      clients: createMockClients(fixtures),
      store,
      dashboard: new DashboardEventBus(),
      responseComposer: {
        async composeResponse(input) {
          expect(input.replyIntent).toBe('ask_fulfillment_method');
          expect(input.state.cart?.items[0]?.itemCode).toBe('20751');
          expect(input.fallbackText).toContain('giao hàng');
          return 'Dạ mình đã thêm Combo Hợp Gu 99K vào giỏ. Bạn muốn giao hàng hay nhận tại cửa hàng ạ?';
        },
      },
    });

    const turns = await store.listTurns('session_composer');
    expect(output.responseText).toBe('Dạ mình đã thêm Combo Hợp Gu 99K vào giỏ. Bạn muốn giao hàng hay nhận tại cửa hàng ạ?');
    expect(output.state.cart?.items[0]?.itemCode).toBe('20751');
    expect(turns.at(-1)?.text).toBe(output.responseText);
  });

  it('falls back to deterministic text and records an event when response composition fails', async () => {
    const store = new MemoryStore();
    const output = await runAgentTurn({
      sessionId: 'session_composer_failed',
      customerId: 'customer_1',
      channel: 'messenger_mock',
      text: 'Cho mình 1 Combo Hợp Gu 99K',
      clients: createMockClients(fixtures),
      store,
      dashboard: new DashboardEventBus(),
      responseComposer: {
        async composeResponse() {
          throw new Error('OpenAI timeout');
        },
      },
    });

    const events = await store.listEvents('session_composer_failed');
    expect(output.responseText).toBe('Mình đã thêm món vào giỏ. Bạn muốn giao hàng hay đến cửa hàng nhận?');
    expect(events).toContainEqual(
      expect.objectContaining({
        sourceType: 'llm:response_composer_failed',
        payload: expect.objectContaining({ message: 'OpenAI timeout' }),
      }),
    );
  });
});
