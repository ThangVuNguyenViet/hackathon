import { describe, expect, it } from 'vitest';
import {
  projectKfcOpenAiGenUiState,
  selectKfcOpenAiGenUi,
} from '../../src/agent/kfcOpenAiGenUi.js';
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

function addCartItem(activeSession: KfcToolSession): void {
  activeSession.cart = {
    ...activeSession.cart,
    items: [
      {
        itemCode: 'combo-1',
        name: 'Combo 1',
        quantity: 1,
        unitPriceVnd: 71_000,
      },
    ],
    subtotalVnd: 71_000,
    totalVnd: 71_000,
  };
}

describe('selectKfcOpenAiGenUi', () => {
  it('keeps a queued handoff visible on a later no-tool turn', () => {
    const activeSession = session();
    activeSession.handoff = {
      escalationId: 'handoff_existing',
      reasons: ['abnormal_large_order'],
    };

    const attachment = selectKfcOpenAiGenUi({
      session: activeSession,
      latestUserMessage: 'Có ai nhận yêu cầu chưa?',
      toolCalls: [],
    });

    expect(attachment).toMatchObject({
      widgetKind: 'supportHandoff',
      data: {
        handoff: activeSession.handoff,
        handoffStatus: 'queued',
      },
    });
  });

  it('projects an incomplete address draft into a prefilled fulfillment widget', () => {
    const activeSession = session();
    addCartItem(activeSession);
    activeSession.deliveryAddressDraft = {
      addressLine: '54/2 Nguyễn Hồng Đào',
      communeName: 'Phường 14',
      provinceName: 'TP Hồ Chí Minh',
      rawAddress: '54/2 Nguyễn Hồng Đào p14 tp HCM',
    };

    const attachment = selectKfcOpenAiGenUi({
      session: activeSession,
      latestUserMessage: '54/2 Nguyễn Hồng Đào p14 tp HCM',
      toolCalls: [
        {
          name: 'quoteFulfillment',
          arguments: {},
          result: {
            ok: true,
            toolName: 'quoteFulfillment',
            value: {
              status: 'incomplete',
              addressDraft: activeSession.deliveryAddressDraft,
              missingFields: ['recipientName', 'phone'],
            },
            message: 'Delivery address draft saved',
          },
        },
      ],
    });

    expect(attachment).toMatchObject({
      widgetKind: 'addressFulfillmentCheck',
      data: {
        addressStatus: 'incomplete',
        addressDraft: activeSession.deliveryAddressDraft,
        missingFields: ['recipientName', 'phone'],
      },
      actions: [
        expect.objectContaining({
          id: 'submit_address',
          label: 'Cập nhật địa chỉ',
        }),
      ],
    });
  });

  it('keeps a complete unsupported draft editable without calling it incomplete', () => {
    const activeSession = session();
    addCartItem(activeSession);
    activeSession.deliveryAddressDraft = {
      recipientName: 'Nguyễn An',
      phone: '0901234567',
      addressLine: '1 Đường Ngoài Vùng Giao',
      communeName: 'Phường Tân Bình',
      provinceName: 'TP Hồ Chí Minh',
    };

    const attachment = selectKfcOpenAiGenUi({
      session: activeSession,
      latestUserMessage: 'Giao đến địa chỉ trên',
      toolCalls: [
        {
          name: 'quoteFulfillment',
          arguments: {},
          result: {
            ok: true,
            toolName: 'quoteFulfillment',
            value: {
              status: 'unsupported',
              addressDraft: activeSession.deliveryAddressDraft,
              missingFields: [],
            },
            message: 'Outside mock coverage',
          },
        },
      ],
    });

    expect(attachment).toMatchObject({
      widgetKind: 'addressFulfillmentCheck',
      data: {
        addressStatus: 'unsupported',
        addressDraft: activeSession.deliveryAddressDraft,
        missingFields: [],
      },
    });
    expect(attachment?.actions).toEqual([
      expect.objectContaining({ id: 'submit_address' }),
    ]);
  });

  it('presents a complete direct Responses full-menu result as a full menu browser', () => {
    const fullMenuItems = Array.from({ length: 8 }, (_, index) =>
      menuItem(`full-${index + 1}`, 'Combo'),
    );
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
              total: fullMenuItems.length,
              items: fullMenuItems,
            },
            message: `Found ${fullMenuItems.length} menu items`,
          },
        },
      ],
    });

    expect(attachment?.widgetKind).toBe('fullMenuBrowser');
    expect(attachment?.title).toBe('Toàn bộ thực đơn');
    expect(attachment?.data).toMatchObject({
      items: fullMenuItems,
      total: 8,
      returned: 8,
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

  it('round-robins the ranked results from broad search calls into a compact picker', () => {
    const duplicate = menuItem('burger-shared', 'Burger');
    const attachment = selectKfcOpenAiGenUi({
      session: session(),
      latestUserMessage: 'Tìm hai lựa chọn khác nhau',
      toolCalls: [
        {
          name: 'searchMenu',
          arguments: { query: 'first facet' },
          result: {
            ok: true,
            toolName: 'searchMenu',
            value: {
              mode: 'search',
              query: 'first facet',
              total: 5,
              items: [
                menuItem('first-1', 'Burger'),
                duplicate,
                menuItem('first-3', 'Burger'),
                menuItem('first-4', 'Burger'),
                menuItem('first-5', 'Burger'),
              ],
            },
            message: 'Found 5 first-facet items',
          },
        },
        {
          name: 'searchMenu',
          arguments: { query: 'second facet' },
          result: {
            ok: true,
            toolName: 'searchMenu',
            value: {
              mode: 'search',
              query: 'second facet',
              total: 5,
              items: [
                menuItem('second-1', 'Burger'),
                duplicate,
                menuItem('second-3', 'Burger'),
                menuItem('second-4', 'Burger'),
                menuItem('second-5', 'Burger'),
              ],
            },
            message: 'Found 5 second-facet items',
          },
        },
      ],
    });

    expect(attachment).toMatchObject({
      widgetKind: 'smartMenuPicker',
      data: {
        items: [
          expect.objectContaining({ code: 'first-1' }),
          expect.objectContaining({ code: 'second-1' }),
          expect.objectContaining({ code: 'burger-shared' }),
          expect.objectContaining({ code: 'first-3' }),
          expect.objectContaining({ code: 'second-3' }),
        ],
      },
    });
    expect(attachment?.data.items).toHaveLength(5);
  });

  it('presents multiple item details as one comparison picker', () => {
    const detail = (code: string, name: string) => ({
      ...menuItem(code, 'Burger'),
      name,
      itemId: `internal-${code}`,
      productCode: `product-${code}`,
      modifierGroups: [
        {
          groupId: 'internal-group',
          name: 'Internal modifier tree',
          min: 0,
          max: 1,
          depth: 0,
          options: [],
        },
      ],
      provenance: {
        sourceFile: 'private-catalog.json',
        fixtureMode: 'provider_runtime',
      },
    });
    const attachment = selectKfcOpenAiGenUi({
      session: session(),
      latestUserMessage: 'So sánh hai burger này',
      toolCalls: [
        {
          name: 'searchMenu',
          arguments: { query: 'burger' },
          result: {
            ok: true,
            toolName: 'searchMenu',
            value: {
              mode: 'search',
              query: 'burger',
              total: 2,
              items: [
                menuItem('broad-result-1', 'Burger'),
                menuItem('broad-result-2', 'Burger'),
              ],
            },
            message: 'Found broad burger results',
          },
        },
        {
          name: 'getItemDetails',
          arguments: { code: 'burger-1' },
          result: {
            ok: true,
            toolName: 'getItemDetails',
            value: detail('burger-1', 'Burger 1'),
            message: 'Found Burger 1',
          },
        },
        {
          name: 'getItemDetails',
          arguments: { code: 'burger-2' },
          result: {
            ok: true,
            toolName: 'getItemDetails',
            value: detail('burger-2', 'Burger 2'),
            message: 'Found Burger 2',
          },
        },
        {
          name: 'getModifierOptions',
          arguments: { code: 'burger-2' },
          result: {
            ok: true,
            toolName: 'getModifierOptions',
            value: {
              itemCode: 'burger-2',
              itemId: 'internal-burger-2',
              productCode: 'product-burger-2',
              name: 'Burger 2',
              modifierGroups: [
                {
                  groupId: 'internal-group',
                  name: 'Internal modifier tree',
                  min: 0,
                  max: 1,
                  depth: 0,
                  options: [],
                },
              ],
              provenance: {
                sourceFile: 'private-modifiers.json',
                fixtureMode: 'provider_runtime',
              },
            },
            message: 'Found modifier options',
          },
        },
      ],
    });

    expect(attachment).toMatchObject({
      widgetKind: 'smartMenuPicker',
      data: {
        items: [
          expect.objectContaining({ code: 'burger-1', name: 'Burger 1' }),
          expect.objectContaining({ code: 'burger-2', name: 'Burger 2' }),
        ],
      },
    });
    expect(JSON.stringify(attachment)).not.toContain('modifierGroups');
    expect(JSON.stringify(attachment)).not.toContain('private-catalog.json');
    expect(JSON.stringify(attachment)).not.toContain('internal-burger');
  });

  it('keeps a single item detail card compact', () => {
    const attachment = selectKfcOpenAiGenUi({
      session: session(),
      latestUserMessage: 'Xem món này',
      toolCalls: [
        {
          name: 'getItemDetails',
          arguments: { code: 'burger-1' },
          result: {
            ok: true,
            toolName: 'getItemDetails',
            value: {
              ...menuItem('burger-1', 'Burger'),
              itemId: 'internal-burger-1',
              modifierGroups: [
                {
                  groupId: 'internal-group',
                  name: 'Internal modifier tree',
                  min: 0,
                  max: 1,
                  depth: 0,
                  options: [],
                },
              ],
            },
            message: 'Found Burger 1',
          },
        },
      ],
    });

    expect(attachment?.widgetKind).toBe('productDetailCard');
    expect(JSON.stringify(attachment)).not.toContain('modifierGroups');
    expect(JSON.stringify(attachment)).not.toContain('internal-burger-1');
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

  it('preserves the verified cart while presenting modifier options', () => {
    const activeSession = session();
    activeSession.cart = {
      id: 'cart_modifier',
      items: [
        {
          itemCode: 'combo-1',
          name: 'Combo 1',
          quantity: 1,
          unitPriceVnd: 71_000,
        },
      ],
      subtotalVnd: 71_000,
      discountVnd: 0,
      deliveryFeeVnd: 0,
      totalVnd: 71_000,
      voucherCode: null,
    };

    const projection = projectKfcOpenAiGenUiState({
      session: activeSession,
      latestUserMessage: 'Tùy chỉnh combo 1',
      toolCalls: [
        {
          name: 'getModifierOptions',
          arguments: { code: 'combo-1' },
          result: {
            ok: true,
            toolName: 'getModifierOptions',
            value: {
              itemCode: 'combo-1',
              itemId: 'combo-1',
              productCode: 'combo-1',
              name: 'Combo 1',
              modifierGroups: [],
              provenance: {
                sourceFile: 'fixture.json',
                fixtureMode: 'public_crawl_seed',
              },
            },
            message: 'Found modifier options',
          },
        },
      ],
    });

    expect(projection.state.cart).toEqual(activeSession.cart);
  });

  it('persists an empty verified cart without presenting an empty cart widget', () => {
    const activeSession = session();

    const projection = projectKfcOpenAiGenUiState({
      session: activeSession,
      latestUserMessage: 'Cảm ơn',
      toolCalls: [],
    });
    const attachment = selectKfcOpenAiGenUi({
      session: activeSession,
      latestUserMessage: 'Cảm ơn',
      toolCalls: [],
    });

    expect(projection.state.cart).toEqual(activeSession.cart);
    expect(attachment).toBeUndefined();
  });

  it('does not turn a store lookup into an address form when the cart is empty', () => {
    const attachment = selectKfcOpenAiGenUi({
      session: session(),
      latestUserMessage: 'Chỉ kiểm tra khả năng phục vụ, chưa tạo đơn',
      toolCalls: [
        {
          name: 'findStores',
          arguments: { city: 'Thành phố Hồ Chí Minh' },
          result: {
            ok: true,
            toolName: 'findStores',
            value: [],
            message: 'No verified store result',
          },
        },
      ],
    });

    expect(attachment).toBeUndefined();
  });
});
