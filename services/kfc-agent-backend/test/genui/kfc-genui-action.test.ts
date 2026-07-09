import { describe, expect, it } from 'vitest';
import {
  KFC_GENUI_WIDGET_KINDS,
  isKfcGenUiAttachment,
  normalizeGenUiActionToText,
} from '../../src/genui/kfcGenUi.js';

describe('KFC GenUI contract', () => {
  it('defines the six MVP widget kinds', () => {
    expect(KFC_GENUI_WIDGET_KINDS).toEqual([
      'smartMenuPicker',
      'cartBuilder',
      'addressFulfillmentCheck',
      'orderReviewConfirm',
      'paymentOrderStatus',
      'supportHandoff',
    ]);
  });

  it('normalizes confirm_order into explicit customer confirmation text', () => {
    expect(
      normalizeGenUiActionToText({
        attachmentId: 'att_review_1',
        actionId: 'confirm_order',
        value: 'confirmed',
        payload: { paymentMethod: 'momo' },
      }),
    ).toContain('xác nhận đơn');
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
