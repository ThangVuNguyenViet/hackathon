import { describe, expect, it } from 'vitest';
import { selectKfcGenUiAttachment } from '../../src/genui/kfcGenUiSelector.js';
import type { AgentGraphState } from '../../src/graph/state.js';

function state(partial: Partial<AgentGraphState>): AgentGraphState {
  return {
    sessionId: 'session_1',
    customerId: 'customer_1',
    channel: 'web_mock',
    latestUserMessage: '',
    intent: 'unclear',
    toolTrace: [],
    escalationReasons: [],
    retrievedEvidence: [],
    userConfirmedOrder: false,
    ...partial,
  } as AgentGraphState;
}

describe('selectKfcGenUiAttachment', () => {
  it('selects SmartMenuPicker after menu recommendation evidence', () => {
    const attachment = selectKfcGenUiAttachment({
      state: state({
        latestUserMessage: 'Không biết ăn gì',
        intent: 'ordering',
        toolTrace: [
          {
            toolName: 'searchMenu',
            arguments: {},
            ok: true,
            resultSummary: '3 items',
            provenance: [],
          },
        ],
      }),
      turnToolNames: ['searchMenu'],
    });

    expect(attachment?.widgetKind).toBe('smartMenuPicker');
    expect(attachment?.actions.map((action) => action.id)).toContain('add_item');
  });

  it('selects OrderReviewConfirm only when cart and fulfillment are ready and order is not placed', () => {
    const attachment = selectKfcGenUiAttachment({
      state: state({
        cart: {
          id: 'cart_1',
          items: [{ itemCode: '41141', name: 'Zinger Burger', quantity: 1, unitPriceVnd: 55000 }],
          subtotalVnd: 55000,
          discountVnd: 0,
          deliveryFeeVnd: 18000,
          totalVnd: 73000,
          voucherCode: null,
        },
        fulfillment: {
          method: 'delivery',
          disposition: 'delivery',
          storeId: 'store_1',
          storeName: 'KFC Quận 7',
          feeVnd: 18000,
          etaMinutes: 25,
          availability: {
            ok: true,
            checkedItemIds: ['41141'],
            unavailableItemIds: [],
            blockedTimeslotItemIds: [],
            source: { fixtureMode: 'mock_external_state', sourceFile: 'test' },
          },
        },
      }),
      turnToolNames: ['quoteFulfillment'],
    });

    expect(attachment?.widgetKind).toBe('orderReviewConfirm');
    expect(attachment?.actions.map((action) => action.id)).toContain('confirm_order');
  });

  it('selects SupportHandoff for escalation state', () => {
    const attachment = selectKfcGenUiAttachment({
      state: state({
        handoff: { escalationId: 'esc_1', reasons: ['abnormal_order'] },
        escalationReasons: ['abnormal_order'],
      }),
      turnToolNames: ['handoff'],
    });

    expect(attachment?.widgetKind).toBe('supportHandoff');
  });
});
