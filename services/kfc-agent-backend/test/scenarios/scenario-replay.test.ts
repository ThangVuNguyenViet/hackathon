import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseScenarioFile } from '../../src/scenarios/parser.js';
import { runScenario } from '../../src/scenarios/runner.js';

const scenariosRoot = join(process.cwd(), '../../ai-talent-tracks/fnb/conversations');

async function replay(fileName: string) {
  const script = await parseScenarioFile(join(scenariosRoot, fileName));
  return { script, result: await runScenario(script) };
}

function eventPayloads(result: Awaited<ReturnType<typeof runScenario>>, type: string) {
  return result.dashboardEvents.filter((event) => event.type === type).map((event) => event.payload);
}

describe('documented conversation scenario replay', () => {
  it('scenario 01 creates an order only after final confirmation', async () => {
    const { script, result } = await replay('01-dat-mon-ro-rang-giao-hang.md');

    expect(result.finalState).toBe('order_created');
    expect(result.coveredUseCases).toEqual(script.useCases);
    expect(result.transcript).toHaveLength(script.turns.length);
    expect(eventPayloads(result, 'order_created')).toHaveLength(1);
    expect(result.eventsBeforeFinalUserTurn.some((event) => event.type === 'order_created')).toBe(false);
    expect(eventPayloads(result, 'voucher_applied')[0]).toMatchObject({ voucherCode: 'KFC50' });
    expect(eventPayloads(result, 'payment_link_created')[0]).toMatchObject({ method: 'momo' });
    expect(eventPayloads(result, 'session_updated')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ updateType: 'delivery_quote', feeVnd: 18000 }),
        expect.objectContaining({ updateType: 'store_assigned' }),
        expect.objectContaining({ updateType: 'delivery_note', note: expect.stringContaining('không bấm chuông') }),
        expect.objectContaining({ updateType: 'invoice_requested', taxCode: '0312345678' }),
      ]),
    );
    expect(result.order?.id).toBe('KFC-MOCK-1001');
  });

  it('scenario 02 handles recommendation, budget, upsell acceptance, and rejection', async () => {
    const { script, result } = await replay('02-tu-van-combo-va-upsell.md');

    expect(result.finalState).toBe('cart_ready');
    expect(result.coveredUseCases).toEqual(script.useCases);
    expect(eventPayloads(result, 'session_updated')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ updateType: 'recommendation_question', dimension: 'group_size_budget' }),
        expect.objectContaining({ updateType: 'promotion_answered' }),
        expect.objectContaining({ updateType: 'upsell_accepted', item: 'burger' }),
        expect.objectContaining({ updateType: 'upsell_rejected', item: 'burger' }),
      ]),
    );
    expect(result.cart?.items.some((item) => /burger/i.test(item.name))).toBe(false);
  });

  it('scenario 03 blocks unavailable/out-of-zone order and keeps address change open', async () => {
    const { script, result } = await replay('03-ton-kho-dia-chi-va-cua-hang.md');

    expect(result.finalState).toBe('needs_customer_decision');
    expect(result.coveredUseCases).toEqual(script.useCases);
    expect(eventPayloads(result, 'session_updated')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ updateType: 'item_unavailable' }),
        expect.objectContaining({ updateType: 'delivery_area_uncertain' }),
        expect.objectContaining({ updateType: 'saved_address_confirmation' }),
        expect.objectContaining({ updateType: 'peak_eta', etaMinutes: 45 }),
        expect.objectContaining({ updateType: 'pre_confirmation_stockout' }),
        expect.objectContaining({ updateType: 'address_change_allowed', orderCreated: false }),
      ]),
    );
    expect(result.order).toBeUndefined();
  });

  it('scenario 04 handles post-order status, cancellation guard, add-on check, and reorder cart', async () => {
    const { script, result } = await replay('04-sau-khi-dat-don.md');

    expect(result.finalState).toBe('post_order_handled');
    expect(result.coveredUseCases).toEqual(script.useCases);
    expect(eventPayloads(result, 'session_updated')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ updateType: 'order_status_lookup' }),
        expect.objectContaining({ updateType: 'eta_lookup' }),
        expect.objectContaining({ updateType: 'add_after_order_check' }),
        expect.objectContaining({ updateType: 'cancel_confirmation_required' }),
        expect.objectContaining({ updateType: 'post_creation_cancel_handoff' }),
        expect.objectContaining({ updateType: 'reorder_cart_created', preservesCurrentOrder: true }),
      ]),
    );
    expect(result.order?.status).not.toBe('cancelled');
  });

  it('scenario 05 escalates complaint with structured feedback', async () => {
    const { script, result } = await replay('05-khieu-nai-va-human-handoff.md');

    expect(result.finalState).toBe('human_handoff_created');
    expect(result.coveredUseCases).toEqual(script.useCases);
    expect(result.escalationReasons).toEqual(expect.arrayContaining(['missing_item', 'wrong_item', 'late_delivery', 'angry_customer', 'human_requested']));
    expect(eventPayloads(result, 'handoff_required')[0]).toMatchObject({
      reasons: expect.arrayContaining(['missing_item', 'wrong_item', 'late_delivery', 'angry_customer', 'human_requested']),
      priority: 'high',
    });
    expect(eventPayloads(result, 'session_updated')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ updateType: 'complaint_recorded', issues: expect.arrayContaining(['missing_item', 'wrong_item', 'late_delivery']) }),
        expect.objectContaining({ updateType: 'feedback_recorded' }),
      ]),
    );
  });

  it('scenario 06 clarifies slang, handles safety, and refuses private information', async () => {
    const { script, result } = await replay('06-ngon-ngu-tu-nhien-va-an-toan.md');

    expect(result.finalState).toBe('clarification_needed');
    expect(result.coveredUseCases).toEqual(script.useCases);
    expect(eventPayloads(result, 'session_updated')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ updateType: 'slang_clarified' }),
        expect.objectContaining({ updateType: 'allergy_safety_disclaimer' }),
        expect.objectContaining({ updateType: 'spam_redirected' }),
        expect.objectContaining({ updateType: 'ambiguous_reference_clarified' }),
        expect.objectContaining({ updateType: 'recent_order_reference' }),
        expect.objectContaining({ updateType: 'privacy_refusal' }),
      ]),
    );
    expect(result.order).toBeUndefined();
  });

  it('scenario 07 updates cart through personalization and loyalty without creating order', async () => {
    const { script, result } = await replay('07-ca-nhan-hoa-va-loyalty.md');

    expect(result.finalState).toBe('cart_updated');
    expect(result.coveredUseCases).toEqual(script.useCases);
    expect(eventPayloads(result, 'session_updated')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ updateType: 'reorder_confirmation_required' }),
        expect.objectContaining({ updateType: 'favorite_confirmation_required' }),
        expect.objectContaining({ updateType: 'loyalty_lookup', points: 120 }),
        expect.objectContaining({ updateType: 'cart_item_swapped', removed: 'Pepsi', added: 'trà đào' }),
      ]),
    );
    expect(result.cart?.items.some((item) => /pepsi/i.test(item.name))).toBe(false);
    expect(result.cart?.items.some((item) => /trà đào|tra dao/i.test(item.name))).toBe(true);
    expect(result.order).toBeUndefined();
  });

  it('scenario 08 routes payment failures and abnormal order to human review', async () => {
    const { script, result } = await replay('08-thanh-toan-loi-va-don-bat-thuong.md');

    expect(result.finalState).toBe('human_review_required');
    expect(result.coveredUseCases).toEqual(script.useCases);
    expect(eventPayloads(result, 'payment_failed')).toHaveLength(2);
    expect(eventPayloads(result, 'handoff_required')[0]).toMatchObject({
      reasons: expect.arrayContaining(['payment_failed', 'abnormal_large_order']),
    });
    expect(result.escalationReasons).toEqual(expect.arrayContaining(['payment_failed', 'abnormal_large_order']));
    expect(result.order?.paymentStatus).not.toBe('paid');
  });
});
