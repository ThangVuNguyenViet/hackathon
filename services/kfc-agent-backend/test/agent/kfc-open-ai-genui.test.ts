import { describe, expect, it } from 'vitest';
import { selectKfcOpenAiGenUi } from '../../src/agent/kfcOpenAiGenUi.js';
import type { KfcToolSession } from '../../src/agent/kfcOpenAiTools.js';

function session(): KfcToolSession {
  return {
    sessionId: 'kfc:full-menu',
    customerId: 'full-menu',
    channel: 'kfc',
    cart: {
      id: 'cart_full_menu',
      items: [],
      subtotalVnd: 0,
      discountVnd: 0,
      deliveryFeeVnd: 0,
      totalVnd: 0,
      voucherCode: null,
    },
    externalCallContext: {
      signal: new AbortController().signal,
      deadlineAt: Date.now() + 1_000,
    },
    toolCallSequence: 0,
  };
}

function menuItem(code: string, category: string) {
  return {
    code,
    name: `Item ${code}`,
    category,
    description: '',
    priceVnd: 50_000,
    imageUrl: '',
    available: true,
    isCustomize: false,
    hasModifiers: false,
  };
}

describe('selectKfcOpenAiGenUi', () => {
  it('presents a complete direct Responses full-menu result as a full menu browser', () => {
    const attachment = selectKfcOpenAiGenUi({
      session: session(),
      latestUserMessage: 'Cho mình xem toàn bộ thực đơn',
      toolCalls: [
        {
          name: 'searchMenu',
          arguments: { mode: 'full' },
          result: {
            ok: true,
            toolName: 'searchMenu',
            value: {
              mode: 'full',
              query: '',
              total: 2,
              items: [
                menuItem('combo-1', 'Combo'),
                menuItem('drink-1', 'Nước uống'),
              ],
            },
            message: 'Found 2 menu items',
          },
        },
      ],
    });

    expect(attachment?.widgetKind).toBe('fullMenuBrowser');
    expect(attachment?.title).toBe('Toàn bộ thực đơn');
    expect(attachment?.data).toMatchObject({
      total: 2,
      returned: 2,
      complete: true,
    });
  });

  it('keeps a filtered direct Responses result in the compact menu picker', () => {
    const attachment = selectKfcOpenAiGenUi({
      session: session(),
      latestUserMessage: 'Gợi ý combo',
      toolCalls: [
        {
          name: 'searchMenu',
          arguments: { query: 'combo' },
          result: {
            ok: true,
            toolName: 'searchMenu',
            value: {
              mode: 'search',
              query: 'combo',
              total: 1,
              items: [menuItem('combo-1', 'Combo')],
            },
            message: 'Found 1 menu item',
          },
        },
      ],
    });

    expect(attachment?.widgetKind).toBe('smartMenuPicker');
  });

  it('does not label a category-scoped full-mode result as the entire menu', () => {
    const attachment = selectKfcOpenAiGenUi({
      session: session(),
      latestUserMessage: 'Cho mình xem các món burger',
      toolCalls: [
        {
          name: 'searchMenu',
          arguments: { mode: 'full', category: 'burger' },
          result: {
            ok: true,
            toolName: 'searchMenu',
            value: {
              mode: 'full',
              query: '',
              total: 1,
              items: [menuItem('burger-1', 'Burger')],
            },
            message: 'Found 1 menu item',
          },
        },
      ],
    });

    expect(attachment?.widgetKind).toBe('smartMenuPicker');
  });
});
