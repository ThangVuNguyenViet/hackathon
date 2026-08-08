import { describe, expect, it } from 'vitest';
import {
  KFC_GENUI_WIDGET_KINDS,
  isKfcGenUiAttachment,
} from '../../src/genui/kfcGenUi.js';

describe('KFC GenUI schema contract', () => {
  it('defines the complete supported widget-kind allowlist', () => {
    expect(KFC_GENUI_WIDGET_KINDS).toEqual([
      'smartMenuPicker',
      'fullMenuBrowser',
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
      'fertilizerSchedule',
      'dosageCalculator',
      'diagnosticProtocol',
      'dealerLocator',
      'capabilitiesOverview',
    ]);
  });

  it.each(KFC_GENUI_WIDGET_KINDS)(
    'accepts a valid representative %s attachment',
    (widgetKind) => {
      expect(isKfcGenUiAttachment({
        id: `att_${widgetKind}`,
        lifecycleStage: 'contract_fixture',
        widgetKind,
        status: 'active',
        title: `Representative ${widgetKind}`,
        data: { contractFixture: true },
        actions: [],
      })).toBe(true);
    },
  );

  it('rejects attachments with a widget kind outside the allowlist', () => {
    expect(
      isKfcGenUiAttachment({
        id: 'att_unknown_widget',
        lifecycleStage: 'ordering',
        widgetKind: 'unknownWidget',
        status: 'active',
        title: 'Unsupported widget',
        data: {},
        actions: [],
      }),
    ).toBe(false);
  });
});
