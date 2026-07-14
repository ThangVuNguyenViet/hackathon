import { describe, expect, it } from 'vitest';
import { buildServer } from '../../src/api/server.js';
import { loadGeneratedFixtures } from '../../src/fixtures/loadFixtures.js';
import { StaticToolPlanner } from '../../src/llm/toolPlanner.js';
import { KFC_GENUI_WIDGET_KINDS, isKfcGenUiAttachment, normalizeGenUiActionToText } from '../../src/genui/kfcGenUi.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';

describe('KFC GenUI contract', () => {
  it('defines the MVP widget kinds', () => {
    expect(KFC_GENUI_WIDGET_KINDS).toEqual([
      'smartMenuPicker',
      'productDetailCard',
      'modifierPicker',
      'promotionGallery',
      'allergenEvidence',
      'cartBuilder',
      'addressFulfillmentCheck',
      'orderReviewConfirm',
      'paymentOrderStatus',
      'orderTrackingStatus',
      'supportHandoff',
      'paymentMethodPicker',
    ]);
  });

  it('normalizes item quantity and payment method actions with trusted values', () => {
    expect(normalizeGenUiActionToText({
      attachmentId: 'att_cart_1', actionId: 'update_item_quantity', value: 'Combo Zinger',
      payload: { itemCode: '41141', quantity: 3 },
    })).toBe('Đổi số lượng Combo Zinger thành 3');
    expect(normalizeGenUiActionToText({
      attachmentId: 'att_payment_1', actionId: 'select_payment_method', value: 'Ví ZaloPay',
      payload: { methodId: 'zalopay_wallet' },
    })).toBe('Chọn phương thức thanh toán Ví ZaloPay');
  });

  it('normalizes confirm_order into explicit confirmation text', () => {
    expect(
      normalizeGenUiActionToText({
        attachmentId: 'att_review_1',
        actionId: 'confirm_order',
        value: 'confirmed',
        payload: { paymentMethod: 'momo' },
      }),
    ).toBe('Xác nhận đơn');
  });

  it('normalizes the trusted SmartMenu batch action', () => {
    expect(normalizeGenUiActionToText({
      attachmentId: 'att_menu_1', actionId: 'add_items',
      payload: { items: [{ itemCode: '20751', quantity: 2 }] },
    })).toBe('Xác nhận món');
  });

  it('rejects unknown widget kinds from transcript metadata', () => {
    expect(
      isKfcGenUiAttachment({
        id: 'att_bad',
        lifecycleStage: 'ordering',
        widgetKind: 'unknownWidget',
        status: 'active',
        title: 'Bad',
        data: {},
        actions: [],
      }),
    ).toBe(false);
  });
});

describe('POST /chat/kfc/genui-action', () => {
  it('applies trusted modifier selections by group and preserves previous selections', async () => {
    const server = buildServer({
      fixtures: await loadGeneratedFixtures(process.cwd()),
      toolPlanner: new StaticToolPlanner([
        {
          intent: 'ordering',
          entities: { cartMutationConfirmed: true },
          responseClaims: [],
          toolCalls: [
            { toolName: 'updateCart', arguments: { itemCode: '20752', quantity: 2 } },
            { toolName: 'getModifierOptions', arguments: { code: '20752' } },
            { toolName: 'previewCart', arguments: {} },
          ],
        },
      ]),
    });
    const sessionId = 'kfc:genui_modifier_selection';

    const modifierResponse = await server.inject({
      method: 'POST',
      url: '/chat/kfc/message',
      payload: {
        sessionId,
        customerId: 'customer_1',
        clientMessageId: 'kfc_genui_modifier_message_1',
        text: 'Cho mình 2 Combo Đẫy Đà và tùy chỉnh nước',
      },
    });

    expect(modifierResponse.statusCode, modifierResponse.body).toBe(200);
    expect(modifierResponse.json().genUi).toMatchObject({ widgetKind: 'modifierPicker' });
    const actions = modifierResponse.json().genUi.actions as Array<{
      id: string;
      payload: { groupId: string; modifierId: string };
    }>;
    const select = async (groupId: string, modifierId: string, clientMessageId: string) => {
      const action = actions.find(
        (candidate) => candidate.payload.groupId === groupId && candidate.payload.modifierId === modifierId,
      );
      expect(action).toBeDefined();
      return server.inject({
        method: 'POST',
        url: '/chat/kfc/genui-action',
        payload: {
          sessionId,
          customerId: 'customer_1',
          clientMessageId,
          action: {
            attachmentId: modifierResponse.json().genUi.id,
            actionId: action!.id,
          },
        },
      });
    };

    const firstDrink = await select('2', '41091', 'kfc_genui_modifier_action_1');
    expect(firstDrink.statusCode, firstDrink.body).toBe(200);
    expect(firstDrink.json().responseText).toBe('Đã đổi Drink 1 sang Pepsi (Đại).');
    expect(firstDrink.json().state.cart).toMatchObject({
      items: [{
        itemCode: '20752',
        quantity: 2,
        unitPriceVnd: 136000,
        modifiers: [{ groupId: '2', modifierId: '41091', priceDeltaVnd: 7000 }],
      }],
      totalVnd: 272000,
    });

    const secondDrink = await select('3', '41091', 'kfc_genui_modifier_action_2');
    expect(secondDrink.statusCode, secondDrink.body).toBe(200);
    expect(secondDrink.json().state.cart).toMatchObject({
      items: [{
        itemCode: '20752',
        quantity: 2,
        unitPriceVnd: 143000,
        modifiers: [
          { groupId: '2', modifierId: '41091', priceDeltaVnd: 7000 },
          { groupId: '3', modifierId: '41091', priceDeltaVnd: 7000 },
        ],
      }],
      totalVnd: 286000,
    });

    const changeFirstDrink = await select('2', '41090', 'kfc_genui_modifier_action_3');
    expect(changeFirstDrink.statusCode, changeFirstDrink.body).toBe(200);
    expect(changeFirstDrink.json().state.cart).toMatchObject({
      items: [{
        itemCode: '20752',
        quantity: 2,
        unitPriceVnd: 140000,
        modifiers: [
          { groupId: '2', modifierId: '41090', priceDeltaVnd: 4000 },
          { groupId: '3', modifierId: '41091', priceDeltaVnd: 7000 },
        ],
      }],
      totalVnd: 280000,
    });
    expect(changeFirstDrink.json().state.escalationReasons).not.toContain('tool_execution_failed');
  });

  it('places the ready order when confirm_order GenUI action is submitted', async () => {
    const server = buildServer({
      fixtures: createTestFixtures(),
      mockClientOptions: {
        fulfillmentQuoteProvider: async (input) => ({
          ok: true,
          value: {
            storeId: input.storeId,
            feeVnd: 31000,
            etaMinutes: 42,
          },
          message: 'quoted',
        }),
      },
      toolPlanner: new StaticToolPlanner([
        {
          intent: 'ordering',
          entities: {},
          responseClaims: [],
          toolCalls: [
            {
              toolName: 'searchMenu',
              arguments: { query: 'Combo Hợp Gu 99K' },
            },
            {
              toolName: 'updateCart',
              arguments: { itemCode: '20751', quantity: 1 },
            },
          ],
        },
        {
          intent: 'ordering',
          entities: {
            addressDraft: {
              line1: 'Big C Đồng Nai',
              district: 'Biên Hòa',
              city: 'Đồng Nai',
            },
          },
          responseClaims: [],
          toolCalls: [{
            toolName: 'quoteFulfillment',
            arguments: {
              address: {
                line1: 'Big C Đồng Nai',
                district: 'Biên Hòa',
                city: 'Đồng Nai',
              },
              method: 'delivery',
              itemCodes: ['20751'],
            },
          }],
        },
        {
          intent: 'ordering',
          entities: {},
          responseClaims: [],
          toolCalls: [],
        },
      ]),
    });
    const sessionId = 'kfc:genui_action_session';

    await server.inject({
      method: 'POST',
      url: '/chat/kfc/message',
      payload: {
        sessionId,
        customerId: 'customer_1',
        clientMessageId: 'kfc_genui_message_1',
        text: 'Cho mình 1 Combo Hợp Gu 99K',
      },
    });
    const fulfillmentResponse = await server.inject({
      method: 'POST',
      url: '/chat/kfc/message',
      payload: {
        sessionId,
        customerId: 'customer_1',
        clientMessageId: 'kfc_genui_message_2',
        text: 'Giao tới Big C Đồng Nai, Biên Hòa, Đồng Nai',
      },
    });

    expect(fulfillmentResponse.json().genUi).toMatchObject({
      widgetKind: 'addressFulfillmentCheck',
    });

    const acceptedFulfillmentResponse = await server.inject({
      method: 'POST',
      url: '/chat/kfc/genui-action',
      payload: {
        sessionId,
        customerId: 'customer_1',
        clientMessageId: 'kfc_genui_accept_fulfillment_1',
        action: {
          attachmentId: fulfillmentResponse.json().genUi.id,
          actionId: 'accept_fulfillment',
          value: 'accepted',
        },
      },
    });
    expect(acceptedFulfillmentResponse.json().genUi).toMatchObject({
      widgetKind: 'orderReviewConfirm',
    });

    const response = await server.inject({
      method: 'POST',
      url: '/chat/kfc/genui-action',
      payload: {
        sessionId,
        customerId: 'customer_1',
        clientMessageId: 'kfc_genui_action_1',
        action: {
          attachmentId: acceptedFulfillmentResponse.json().genUi.id,
          actionId: 'confirm_order',
          value: 'confirmed',
        },
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.state.userConfirmedOrder).toBe(true);
    expect(body.state.order).toMatchObject({ status: 'created' });
    expect(body.genUi).toMatchObject({ widgetKind: 'paymentOrderStatus' });
    expect(body.state.toolTrace.map((entry: { toolName: string }) => entry.toolName)).toEqual(
      expect.arrayContaining(['previewOrder', 'placeOrder']),
    );
  });

  it('adds the selected menu quantities from one trusted smartMenuPicker confirmation', async () => {
    const server = buildServer({
      fixtures: createTestFixtures(),
      toolPlanner: new StaticToolPlanner([
        {
          intent: 'ordering',
          entities: {},
          responseClaims: [],
          toolCalls: [
            {
              toolName: 'searchMenu',
              arguments: { query: 'Combo Hợp Gu 99K' },
            },
          ],
        },
        {
          intent: 'unclear',
          entities: {},
          responseClaims: [],
          toolCalls: [],
        },
      ]),
    });
    const sessionId = 'kfc:genui_menu_quantity_session';

    const menuResponse = await server.inject({
      method: 'POST',
      url: '/chat/kfc/message',
      payload: {
        sessionId,
        customerId: 'customer_1',
        clientMessageId: 'kfc_genui_menu_1',
        text: 'Gợi ý combo',
      },
    });

    expect(menuResponse.statusCode).toBe(200);
    expect(menuResponse.json().genUi).toMatchObject({
      widgetKind: 'smartMenuPicker',
    });

    const actionResponse = await server.inject({
      method: 'POST',
      url: '/chat/kfc/genui-action',
      payload: {
        sessionId,
        customerId: 'customer_1',
        clientMessageId: 'kfc_genui_menu_action_1',
        action: {
          attachmentId: menuResponse.json().genUi.id,
          actionId: 'add_items',
          payload: {
            items: [{ itemCode: '20751', quantity: 2 }],
          },
        },
      },
    });

    expect(actionResponse.statusCode).toBe(200);
    const body = actionResponse.json();
    expect(body.state.cart?.items).toEqual([
      expect.objectContaining({
        itemCode: '20751',
        name: 'Combo Hợp Gu 99K',
        quantity: 2,
        imageUrl: 'https://static.kfcvietnam.com.vn/images/items/lg/HOPGU.jpg?v=LNN7PL',
      }),
    ]);
    expect(body.genUi).toMatchObject({
      widgetKind: 'cartBuilder',
      data: {
        cart: {
          items: [
            expect.objectContaining({
              itemCode: '20751',
              imageUrl: 'https://static.kfcvietnam.com.vn/images/items/lg/HOPGU.jpg?v=LNN7PL',
            }),
          ],
        },
      },
    });
    expect(body.state.toolTrace.map((entry: { toolName: string }) => entry.toolName)).toContain('updateCart');
  });

  it('acknowledges only the trusted menu selection instead of an unrelated composed cart summary', async () => {
    const baseFixtures = createTestFixtures();
    const fixtures = createTestFixtures({
      menuItems: [
        ...baseFixtures.menuItems,
        {
          ...baseFixtures.menuItems[0]!,
          code: '41174',
          itemId: '41174',
          posItemId: '150080',
          productCode: 'BUCKET-5-COB_HDE',
          name: 'Xô Zòn Zã 179K',
          description: 'Xô 5 Miếng Gà',
          priceVnd: 179000,
          imageUrl: 'https://static.kfcvietnam.com.vn/images/items/lg/BUCKET-5-COB_HDE.jpg?v=LNN7PL',
          productUrlSlug: 'xozonza5co_179',
          builderUrl: 'https://www.kfcvietnam.com.vn/order/delivery/hot-deal/xozonza5co_179/builder',
          isQuickCombo: false,
        },
      ],
    });
    const server = buildServer({
      fixtures,
      toolPlanner: new StaticToolPlanner([
        {
          intent: 'ordering',
          entities: {},
          responseClaims: [],
          toolCalls: [
            {
              toolName: 'searchMenu',
              arguments: { query: '' },
            },
          ],
        },
      ]),
      responseComposer: {
        async composeResponse() {
          return 'Bạn đã xác nhận đơn gồm Xô Zui Zẻ, Combo Hợp Gu và Combo Chanh Sang Chảnh.';
        },
      },
    });
    const sessionId = 'kfc:genui_exact_menu_acknowledgement';

    const menuResponse = await server.inject({
      method: 'POST',
      url: '/chat/kfc/message',
      payload: {
        sessionId,
        customerId: 'customer_1',
        clientMessageId: 'kfc_genui_exact_menu_1',
        text: 'Cho tôi xem menu',
      },
    });

    expect(menuResponse.statusCode).toBe(200);
    expect(menuResponse.json().genUi).toMatchObject({ widgetKind: 'smartMenuPicker' });

    const actionResponse = await server.inject({
      method: 'POST',
      url: '/chat/kfc/genui-action',
      payload: {
        sessionId,
        customerId: 'customer_1',
        clientMessageId: 'kfc_genui_exact_menu_action_1',
        action: {
          attachmentId: menuResponse.json().genUi.id,
          actionId: 'add_items',
          payload: {
            items: [{ itemCode: '41174', quantity: 2 }],
          },
        },
      },
    });

    expect(actionResponse.statusCode, actionResponse.body).toBe(200);
    expect(actionResponse.json().responseText).toBe('Đã cập nhật giỏ với 2 × Xô Zòn Zã 179K.');
    expect(actionResponse.json().responseText).not.toContain('Xô Zui Zẻ');
    expect(actionResponse.json().state.cart?.items).toEqual([
      expect.objectContaining({ itemCode: '41174', name: 'Xô Zòn Zã 179K', quantity: 2 }),
    ]);
  });
});
