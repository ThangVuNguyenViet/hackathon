import { describe, expect, it } from 'vitest';
import { buildServer } from '../../src/api/server.js';
import { StaticToolPlanner } from '../../src/llm/toolPlanner.js';
import {
  KFC_GENUI_WIDGET_KINDS,
  isKfcGenUiAttachment,
  normalizeGenUiActionToText,
} from '../../src/genui/kfcGenUi.js';
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
    ]);
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

describe('POST /chat/genui-action', () => {
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
            { toolName: 'searchMenu', arguments: { query: 'Combo Hợp Gu 99K' } },
            { toolName: 'updateCart', arguments: { itemCode: '20751', quantity: 1 } },
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
      ]),
    });
    const sessionId = 'genui_action_session';

    await server.inject({
      method: 'POST',
      url: '/chat/mock',
      payload: {
        sessionId,
        customerId: 'customer_1',
        channel: 'web_mock',
        text: 'Cho mình 1 Combo Hợp Gu 99K',
      },
    });
    await server.inject({
      method: 'POST',
      url: '/chat/mock',
      payload: {
        sessionId,
        customerId: 'customer_1',
        channel: 'web_mock',
        text: 'Giao tới Big C Đồng Nai, Biên Hòa, Đồng Nai',
      },
    });

    const response = await server.inject({
      method: 'POST',
      url: '/chat/genui-action',
      payload: {
        sessionId,
        customerId: 'customer_1',
        channel: 'web_mock',
        action: {
          attachmentId: 'att_review',
          actionId: 'confirm_order',
          value: 'confirmed',
        },
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.state.userConfirmedOrder).toBe(true);
    expect(body.state.order).toMatchObject({ status: 'created' });
    expect(body.state.toolTrace.map((entry: { toolName: string }) => entry.toolName)).toEqual(
      expect.arrayContaining(['previewOrder', 'placeOrder']),
    );
  });
});
