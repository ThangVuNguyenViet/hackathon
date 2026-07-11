import { describe, expect, it } from 'vitest';
import { buildServer } from '../../src/api/server.js';
import { StaticToolPlanner } from '../../src/llm/toolPlanner.js';
import { KFC_GENUI_WIDGET_KINDS, isKfcGenUiAttachment, normalizeGenUiActionToText } from '../../src/genui/kfcGenUi.js';
import { createTestFixtures } from '../fixtures/testFixtures.js';

describe('KFC GenUI contract', () => {
  it('defines the MVP widget kinds', () => {
    expect(KFC_GENUI_WIDGET_KINDS).toEqual([
      'smartMenuPicker',
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
          entities: {},
          responseClaims: [],
          toolCalls: [
            {
              toolName: 'quoteFulfillment',
              arguments: {
                method: 'delivery',
                itemCodes: ['20751'],
                address: {
                  label: 'Big C Đồng Nai',
                  line1: 'Big C Đồng Nai',
                  district: 'Biên Hòa',
                  city: 'Đồng Nai',
                },
              },
            },
          ],
        },
        {
          intent: 'ordering',
          entities: {},
          responseClaims: [],
          toolCalls: [],
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
    const reviewResponse = await server.inject({
      method: 'POST',
      url: '/chat/kfc/genui-action',
      payload: {
        sessionId,
        customerId: 'customer_1',
        clientMessageId: 'kfc_genui_action_accept_fulfillment',
        action: {
          attachmentId: fulfillmentResponse.json().genUi.id,
          actionId: 'accept_fulfillment',
        },
      },
    });
    expect(reviewResponse.statusCode).toBe(200);
    expect(reviewResponse.json().genUi).toMatchObject({
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
          attachmentId: reviewResponse.json().genUi.id,
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

  it('adds the selected menu item quantity from a smartMenuPicker action payload', async () => {
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
          actionId: 'add_item',
          value: 'Combo Hợp Gu 99K',
          payload: {
            itemCode: '20751',
            quantity: 2,
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
      }),
    ]);
    expect(body.genUi).toMatchObject({ widgetKind: 'cartBuilder' });
    expect(body.state.toolTrace.map((entry: { toolName: string }) => entry.toolName)).toContain('updateCart');
  });
});
