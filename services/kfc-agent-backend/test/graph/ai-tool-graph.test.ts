import { describe, expect, it } from 'vitest';
import { DashboardEventBus } from '../../src/dashboard/eventBus.js';
import { runAgentTurn } from '../../src/graph/buildGraph.js';
import { StaticToolPlanner } from '../../src/llm/toolPlanner.js';
import { createMockClients } from '../../src/mock/createMockClients.js';
import { MemoryStore } from '../../src/persistence/memoryStore.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';

describe('AI tool graph', () => {
  it('adds a menu item through planned fixture-backed tools', async () => {
    const output = await runAgentTurn({
      sessionId: 'session_ai_menu',
      customerId: 'customer_1',
      channel: 'web_mock',
      text: 'Cho mình Combo Hợp Gu 99K',
      clients: createMockClients(createTestFixtures()),
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      toolPlanner: new StaticToolPlanner([
        {
          intent: 'ordering',
          entities: { itemText: 'Combo Hợp Gu 99K' },
          toolCalls: [
            { toolName: 'searchMenu', arguments: { query: 'Combo Hợp Gu 99K' } },
            { toolName: 'updateCart', arguments: { itemCode: '20751', quantity: 1 } },
          ],
          responseClaims: [],
        },
      ]),
    });

    expect(output.state.cart?.items[0]).toMatchObject({ itemCode: '20751', name: 'Combo Hợp Gu 99K' });
    expect(output.state.toolTrace?.map((entry) => entry.toolName)).toEqual(['searchMenu', 'updateCart']);
  });

  it('blocks order placement without explicit confirmation even when planner asks for placeOrder', async () => {
    const output = await runAgentTurn({
      sessionId: 'session_ai_no_confirm',
      customerId: 'customer_1',
      channel: 'web_mock',
      text: 'Đặt luôn đi',
      clients: createMockClients(createTestFixtures()),
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      toolPlanner: new StaticToolPlanner([
        {
          intent: 'ordering',
          entities: {},
          toolCalls: [{ toolName: 'placeOrder', arguments: {} }],
          responseClaims: [],
        },
      ]),
    });

    expect(output.state.order).toBeUndefined();
    expect(output.state.escalationReasons).toContain('order_confirmation_required');
  });

  it('does not apply hardcoded KFC50 as a valid public voucher', async () => {
    const output = await runAgentTurn({
      sessionId: 'session_ai_voucher',
      customerId: 'customer_1',
      channel: 'web_mock',
      text: 'Mình có mã KFC50',
      clients: createMockClients(createTestFixtures()),
      store: new MemoryStore(),
      dashboard: new DashboardEventBus(),
      toolPlanner: new StaticToolPlanner([
        {
          intent: 'voucher',
          entities: { voucherText: 'KFC50' },
          toolCalls: [{ toolName: 'validateVoucher', arguments: { voucherText: 'KFC50', subtotalVnd: 250000 } }],
          responseClaims: ['promotion'],
        },
      ]),
    });

    expect(output.state.promotionContext?.validation?.ok).toBe(false);
    expect(output.state.promotionContext?.validation?.reason).toBe('public_code_not_exposed');
    expect(output.state.cart?.voucherCode).not.toBe('KFC50');
  });
});
