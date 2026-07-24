import { describe, expect, it } from 'vitest';
import { customerCommandFromVerifiedAction } from '../../src/domain/customerCommand.js';

describe('customerCommandFromVerifiedAction', () => {
  it('maps one complete cart draft to one atomic command', () => {
    const items = [
      { itemCode: 'combo-zinger', quantity: 2 },
      { itemCode: 'pepsi-large', quantity: 0 },
    ];

    expect(
      customerCommandFromVerifiedAction({
        actionId: 'update_cart',
        payload: { items },
      }),
    ).toEqual({
      kind: 'cart_draft_commit',
      items,
      continueToFulfillment: false,
    });
    expect(
      customerCommandFromVerifiedAction({
        actionId: 'continue_to_fulfillment',
        payload: { items },
      }),
    ).toEqual({
      kind: 'cart_draft_commit',
      items,
      continueToFulfillment: true,
    });
  });

  it('rejects duplicate cart lines and an empty fulfillment draft', () => {
    expect(
      customerCommandFromVerifiedAction({
        actionId: 'update_cart',
        payload: {
          items: [
            { itemCode: 'combo-zinger', quantity: 1 },
            { itemCode: 'combo-zinger', quantity: 0 },
          ],
        },
      }),
    ).toBeUndefined();
    expect(
      customerCommandFromVerifiedAction({
        actionId: 'continue_to_fulfillment',
        payload: {
          items: [{ itemCode: 'combo-zinger', quantity: 0 }],
        },
      }),
    ).toBeUndefined();
  });

  it('maps one atomic modifier draft and rejects duplicate groups', () => {
    expect(
      customerCommandFromVerifiedAction({
        actionId: 'apply_modifiers',
        payload: {
          itemCode: 'combo',
          selections: [
            { groupId: 'main', modifierId: 'burger' },
            { groupId: 'sauce', modifierId: 'chili' },
          ],
        },
      }),
    ).toEqual({
      kind: 'modifier_batch_selection',
      itemCode: 'combo',
      selections: [
        { groupId: 'main', modifierId: 'burger' },
        { groupId: 'sauce', modifierId: 'chili' },
      ],
    });
    expect(
      customerCommandFromVerifiedAction({
        actionId: 'apply_modifiers',
        payload: {
          itemCode: 'combo',
          selections: [
            { groupId: 'main', modifierId: 'burger' },
            { groupId: 'main', modifierId: 'chicken' },
          ],
        },
      }),
    ).toBeUndefined();
  });

  it('maps a complete structured delivery address without accepting extras', () => {
    const address = {
      recipientName: 'Nguyễn An',
      phone: '0909123456',
      addressLine: '54/2 Nguyễn Hồng Đào',
      provinceCode: '79',
      provinceName: 'Thành phố Hồ Chí Minh',
      communeCode: '26740',
      communeName: 'Phường Tân Bình',
      deliveryInstructions: null,
      rawAddress: null,
      legacyDistrictText: null,
    };

    expect(
      customerCommandFromVerifiedAction({
        actionId: 'submit_address',
        payload: address,
      }),
    ).toEqual({ kind: 'submit_address', address });
    expect(
      customerCommandFromVerifiedAction({
        actionId: 'submit_address',
        payload: { ...address, internal: 'not allowed' },
      }),
    ).toBeUndefined();
  });
});
