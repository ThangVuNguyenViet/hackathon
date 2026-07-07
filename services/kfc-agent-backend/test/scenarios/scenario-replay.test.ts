import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { StaticToolPlanner } from '../../src/llm/toolPlanner.js';
import { parseScenarioFile } from '../../src/scenarios/parser.js';
import { runScenario } from '../../src/scenarios/runner.js';

const scenariosRoot = join(process.cwd(), '../../ai-talent-tracks/fnb/conversations');

async function replay(fileName: string, toolPlanner: StaticToolPlanner) {
  const script = await parseScenarioFile(join(scenariosRoot, fileName));
  return {
    script,
    result: await runScenario(script, {
      toolPlanner,
      testFulfillmentQuoteProvider: async () => ({
        ok: true,
        value: { feeVnd: 18000, etaMinutes: 25 },
        message: 'scenario_quote_fixture',
      }),
    }),
  };
}

function toolNames(result: Awaited<ReturnType<typeof runScenario>>) {
  return result.toolTrace.map((entry) => entry.toolName);
}

function eventPayloads(result: Awaited<ReturnType<typeof runScenario>>, type: string) {
  return result.dashboardEvents.filter((event) => event.type === type).map((event) => event.payload);
}

function createScenario01Planner() {
  return new StaticToolPlanner([
    {
      intent: 'ordering',
      entities: {
        itemText: 'Combo Hợp Gu 99K, Burger Gà Zinger, Pepsi (Lon)',
        fulfillmentMethod: 'delivery',
      },
      toolCalls: [
        { toolName: 'searchMenu', arguments: { query: 'Combo Hợp Gu 99K Burger Gà Zinger Pepsi' } },
        { toolName: 'updateCart', arguments: { itemCode: '20751', quantity: 1 } },
        { toolName: 'updateCart', arguments: { itemCode: '41141', quantity: 1 } },
        { toolName: 'updateCart', arguments: { itemCode: '41086', quantity: 2 } },
      ],
      responseClaims: [],
    },
    {
      intent: 'ordering',
      entities: {
        fulfillmentMethod: 'delivery',
        addressText: '1239 Tỉnh Lộ 8, Củ Chi, Hồ Chí Minh',
      },
      toolCalls: [
        {
          toolName: 'quoteFulfillment',
          arguments: {
            method: 'delivery',
            address: {
              label: 'Centre Mall Củ Chi',
              line1: '1239 Tỉnh Lộ 8',
              district: 'Củ Chi',
              city: 'Hồ Chí Minh',
            },
            itemCodes: ['20751', '41141', '41086'],
          },
        },
      ],
      responseClaims: [],
    },
    {
      intent: 'voucher',
      entities: { voucherText: 'KFC50' },
      toolCalls: [{ toolName: 'validateVoucher', arguments: { voucherText: 'KFC50', subtotalVnd: 195000 } }],
      responseClaims: [],
    },
    {
      intent: 'payment',
      entities: { paymentMethod: 'momo' },
      toolCalls: [],
      responseClaims: [],
    },
    {
      intent: 'ordering',
      entities: {
        invoice: {
          companyName: 'Công ty ABC',
          taxCode: '0312345678',
          email: 'finance@abc.test',
        },
      },
      toolCalls: [
        {
          toolName: 'collectInvoice',
          arguments: {
            companyName: 'Công ty ABC',
            taxCode: '0312345678',
            email: 'finance@abc.test',
          },
        },
      ],
      responseClaims: [],
    },
    {
      intent: 'ordering',
      entities: { paymentMethod: 'momo' },
      toolCalls: [
        { toolName: 'previewOrder', arguments: {} },
        { toolName: 'placeOrder', arguments: {} },
        { toolName: 'createPaymentLink', arguments: { method: 'momo' } },
      ],
      responseClaims: [],
    },
  ]);
}

function createScenario05Planner() {
  return new StaticToolPlanner([
    {
      intent: 'complaint',
      entities: { issues: ['missing_item'] },
      toolCalls: [],
      responseClaims: [],
    },
    {
      intent: 'complaint',
      entities: { issues: ['missing_item', 'wrong_item'] },
      toolCalls: [],
      responseClaims: [],
    },
    {
      intent: 'complaint',
      entities: { issues: ['missing_item', 'wrong_item', 'late_delivery', 'angry_customer'] },
      toolCalls: [],
      responseClaims: [],
    },
    {
      intent: 'handoff',
      entities: { reasons: ['missing_item', 'wrong_item', 'late_delivery', 'angry_customer', 'human_requested'] },
      toolCalls: [
        {
          toolName: 'handoff',
          arguments: {
            reasons: ['missing_item', 'wrong_item', 'late_delivery', 'angry_customer', 'human_requested'],
          },
        },
      ],
      responseClaims: [],
    },
    {
      intent: 'feedback',
      entities: { sentiment: 'mixed' },
      toolCalls: [],
      responseClaims: [],
    },
  ]);
}

describe('documented conversation scenario replay', () => {
  it('test-mode replay uses production tool traces instead of injected business events', async () => {
    const { script, result } = await replay('01-dat-mon-ro-rang-giao-hang.md', createScenario01Planner());

    expect(result.finalState).toBe('order_created');
    expect(result.coveredUseCases).toEqual(script.useCases);
    expect(result.transcript).toHaveLength(script.turns.length);
    expect(toolNames(result)).toEqual(
      expect.arrayContaining([
        'searchMenu',
        'updateCart',
        'quoteFulfillment',
        'validateVoucher',
        'collectInvoice',
        'previewOrder',
        'placeOrder',
        'createPaymentLink',
      ]),
    );
    expect(result.dashboardEvents.every((event) => !event.id.includes('scenario_'))).toBe(true);
    expect(result.eventsBeforeFinalUserTurn.some((event) => event.type === 'order_created')).toBe(false);
    expect(eventPayloads(result, 'order_created')).toHaveLength(1);
    expect(eventPayloads(result, 'payment_link_created')[0]).toMatchObject({ method: 'momo', status: 'pending' });
    expect(eventPayloads(result, 'voucher_rejected')[0]).toMatchObject({
      validation: expect.objectContaining({ ok: false }),
    });
    expect(eventPayloads(result, 'session_updated')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ updateType: 'store_assigned' }),
        expect.objectContaining({ updateType: 'delivery_quote', feeVnd: 18000, etaMinutes: 25 }),
        expect.objectContaining({ updateType: 'invoice_requested', taxCode: '0312345678', email: 'finance@abc.test' }),
      ]),
    );
    expect(result.order).toMatchObject({
      status: 'created',
      paymentStatus: 'pending',
      assignedStoreId: expect.any(String),
    });
    expect(eventPayloads(result, 'order_created')[0]).toMatchObject({
      order: expect.objectContaining({
        status: 'created',
        paymentStatus: 'pending',
      }),
    });
  });

  it('test-mode replay reaches human handoff through the production handoff tool', async () => {
    const { script, result } = await replay('05-khieu-nai-va-human-handoff.md', createScenario05Planner());

    expect(result.finalState).toBe('human_handoff_created');
    expect(result.coveredUseCases).toEqual(script.useCases);
    expect(result.transcript).toHaveLength(script.turns.length);
    expect(toolNames(result)).toEqual(['handoff']);
    expect(result.dashboardEvents.every((event) => !event.id.includes('scenario_'))).toBe(true);
    expect(eventPayloads(result, 'handoff_required')[0]).toMatchObject({
      escalationId: expect.stringContaining('handoff_'),
      reasons: expect.arrayContaining(['missing_item', 'wrong_item', 'late_delivery', 'angry_customer', 'human_requested']),
    });
  });
});
