import { describe, expect, it } from 'vitest';
import { buildServer } from '../../src/api/server.js';
import {
  KFC_GENUI_WIDGET_KINDS,
  isKfcGenUiAttachment,
  normalizeGenUiActionToText,
} from '../../src/genui/kfcGenUi.js';

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

  it('normalizes confirm_order into customer order placement text', () => {
    expect(
      normalizeGenUiActionToText({
        attachmentId: 'att_review_1',
        actionId: 'confirm_order',
        value: 'confirmed',
        payload: { paymentMethod: 'momo' },
      }),
    ).toBe('Tôi đặt đơn này');
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
  it('normalizes a confirm_order GenUI action into an agent turn', async () => {
    const server = buildServer();

    const response = await server.inject({
      method: 'POST',
      url: '/chat/genui-action',
      payload: {
        sessionId: 'genui_action_session',
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
    expect(response.json().responseText).toBeTruthy();
  });
});
