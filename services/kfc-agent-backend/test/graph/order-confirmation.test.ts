import { describe, expect, it } from 'vitest';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import type { GeneratedFixtures } from '../../src/fixtures/schema.js';
import { runAgentTurn } from '../../src/graph/buildGraph.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';

const fixtures: GeneratedFixtures = {
  menuItems: [
    {
      code: 'HOPGU',
      category: 'Hot Deals',
      name: 'Combo 99K',
      description: '3 Fried Chicken + 1 Shrimp Burger',
      priceVnd: 99000,
      originalPriceVnd: null,
      imageUrl: 'https://static.kfcvietnam.com.vn/images/items/lg/HOPGU.jpg?v=LNN7PL',
      available: true,
      provenance: { sourceFile: 'crawl.json', okfConceptId: 'menu/items/HOPGU', fixtureMode: 'public_crawl_seed' },
    },
  ],
};

describe('runAgentTurn', () => {
  it('does not place an order before explicit confirmation', async () => {
    const store = new MemoryStore();
    const dashboard = new DashboardEventBus();
    const clients = createMockClients(fixtures);

    const output = await runAgentTurn({
      sessionId: 'session_1',
      customerId: 'customer_1',
      channel: 'messenger_mock',
      text: 'Cho mình 1 Combo 99K',
      clients,
      store,
      dashboard,
    });

    expect(output.state.cart?.items[0]?.itemCode).toBe('HOPGU');
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
      clients: createMockClients({ menuItems: [] }),
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
});
