import { describe, expect, it } from 'vitest';
import { liveScenarioActionPayloadMatchesRenderedAttachment } from '../../src/liveEvidence/liveScenarioActionPayload.js';

function attachment(
  widgetKind: string,
  data: Record<string, unknown>,
  actionId: string,
) {
  return {
    id: `attachment-${actionId}`,
    widgetKind,
    status: 'active',
    data,
    actions: [{ id: actionId, label: actionId }],
  };
}

describe('live scenario action payload validation', () => {
  it('keeps recommendation actions reference-only', () => {
    const offer = attachment(
      'recommendationOffer',
      {},
      'recommendation_select:server-action',
    );

    expect(
      liveScenarioActionPayloadMatchesRenderedAttachment({
        attachment: offer,
        actionId: 'recommendation_select:server-action',
      }),
    ).toBe(true);
    expect(
      liveScenarioActionPayloadMatchesRenderedAttachment({
        attachment: offer,
        actionId: 'recommendation_select:server-action',
        payload: { items: [{ itemCode: 'forged', quantity: 1 }] },
      }),
    ).toBe(false);
  });

  it.each([
    {
      name: 'menu',
      actionId: 'add_items',
      rendered: attachment(
        'smartMenuPicker',
        { items: [{ code: '41173' }, { code: '41174' }] },
        'add_items',
      ),
      payload: { items: [{ itemCode: '41174', quantity: 1 }] },
      invalidPayload: { items: [{ itemCode: 'not-rendered', quantity: 1 }] },
    },
    {
      name: 'modifier',
      actionId: 'apply_modifiers',
      rendered: attachment(
        'modifierPicker',
        {
          modifierTree: {
            itemCode: '41173',
            modifierGroups: [
              {
                groupId: 'drink',
                min: 1,
                options: [
                  { modifierId: 'pepsi', modifierGroups: [] },
                  { modifierId: 'water', modifierGroups: [] },
                ],
              },
            ],
          },
        },
        'apply_modifiers',
      ),
      payload: {
        itemCode: '41173',
        selections: [{ groupId: 'drink', modifierId: 'water' }],
      },
      invalidPayload: {
        itemCode: '41173',
        selections: [{ groupId: 'drink', modifierId: 'not-rendered' }],
      },
    },
    {
      name: 'cart',
      actionId: 'update_cart',
      rendered: attachment(
        'cartBuilder',
        {
          cart: {
            items: [
              { itemCode: '41173', quantity: 1 },
              { itemCode: '41174', quantity: 1 },
            ],
          },
        },
        'update_cart',
      ),
      payload: {
        items: [
          { itemCode: '41173', quantity: 2 },
          { itemCode: '41174', quantity: 0 },
        ],
      },
      invalidPayload: { items: [{ itemCode: '41173', quantity: 2 }] },
    },
    {
      name: 'address',
      actionId: 'submit_address',
      rendered: attachment(
        'addressFulfillmentCheck',
        { addressDraft: {} },
        'submit_address',
      ),
      payload: {
        recipientName: null,
        phone: null,
        addressLine: null,
        provinceCode: null,
        provinceName: null,
        communeCode: null,
        communeName: null,
        deliveryInstructions: null,
        rawAddress: '121 Phạm Văn Thuận',
        legacyDistrictText: null,
      },
      invalidPayload: { rawAddress: 'missing required nullable fields' },
    },
  ])(
    'accepts exact client-generated $name input and rejects mismatched input',
    ({ actionId, rendered, payload, invalidPayload }) => {
      expect(
        liveScenarioActionPayloadMatchesRenderedAttachment({
          attachment: rendered,
          actionId,
          payload,
        }),
      ).toBe(true);
      expect(
        liveScenarioActionPayloadMatchesRenderedAttachment({
          attachment: rendered,
          actionId,
          payload: invalidPayload,
        }),
      ).toBe(false);
    },
  );
});
