import { describe, expect, it } from 'vitest';
import {
  customerSafeProgressLabels,
  projectToolProgressFamily,
} from '../../src/customerRuns/progressProjection.js';
import type { ToolCallRequest } from '../../src/ordering/types.js';

function family(
  toolName: ToolCallRequest['toolName'],
  arguments_: Record<string, unknown> = {},
) {
  return projectToolProgressFamily({ toolName, arguments: arguments_ });
}

describe('customer-safe progress projection', () => {
  it('projects validated tools into the documented semantic families', () => {
    expect(family('searchMenu', { query: 'combo' })).toBe('checking_menu');
    expect(family('validateVoucher', { voucherText: 'KFC', subtotalVnd: 99000 }))
      .toBe('checking_promotions');
    expect(family('quoteFulfillment', {
      address: { label: 'Nhà', line1: '1 Lê Lợi', district: 'Quận 1', city: 'TP.HCM' },
      method: 'delivery',
      itemCodes: ['20751'],
    })).toBe('checking_fulfillment');
    expect(family('updateCart', { itemCode: '20751', quantity: 1 }))
      .toBe('updating_cart');
    expect(family('placeOrder')).toBe('submitting_order');
  });

  it('keeps unapproved or non-food policy tools under the broader status', () => {
    expect(family('previewCart')).toBeUndefined();
    expect(family('getMembershipProfile')).toBeUndefined();
    expect(family('searchContentPolicy', { kind: 'policy' })).toBeUndefined();
    expect(family('searchContentPolicy', { kind: 'allergen' }))
      .toBe('checking_food_information');
  });

  it('contains only fixed concise Vietnamese customer copy', () => {
    expect(customerSafeProgressLabels.checking_menu).toBe('Đang kiểm tra menu…');
    expect(JSON.stringify(customerSafeProgressLabels)).not.toMatch(
      /searchMenu|tool|planner|argument|trace|http/i,
    );
  });
});
