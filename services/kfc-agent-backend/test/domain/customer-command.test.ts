import { describe, expect, it } from 'vitest';
import {
  createTrustedCustomerActionEnvelope,
  customerCommandFromVerifiedAction,
  trustedCustomerActionEnvelopeSchema,
} from '../../src/domain/customerCommand.js';

const digest = 'a'.repeat(64);
const revision = 'b'.repeat(64);

describe('trusted customer action contract', () => {
  it('constructs the server-only provenance envelope around a strict command', () => {
    expect(
      createTrustedCustomerActionEnvelope({
        source: 'kfc_genui_action',
        assistantTurnId: ' assistant-turn-1 ',
        attachmentId: ' attachment-1 ',
        actionDigest: digest,
        verifiedRevision: revision,
        lifecycle: 'one_shot',
        command: {
          kind: 'cart_update',
          itemCode: ' 20751 ',
          quantity: 2,
        },
      }),
    ).toEqual({
      source: 'kfc_genui_action',
      assistantTurnId: 'assistant-turn-1',
      attachmentId: 'attachment-1',
      actionDigest: digest,
      verifiedRevision: revision,
      lifecycle: 'one_shot',
      command: {
        kind: 'cart_update',
        itemCode: '20751',
        quantity: 2,
      },
    });
  });

  it('rejects missing provenance, malformed digests, extra fields, and unbounded values', () => {
    const valid = {
      source: 'kfc_genui_action',
      assistantTurnId: 'assistant-turn-1',
      attachmentId: 'attachment-1',
      actionDigest: digest,
      verifiedRevision: revision,
      lifecycle: 'replayable',
      command: { kind: 'confirm_order' },
    } as const;

    expect(
      trustedCustomerActionEnvelopeSchema.safeParse({
        metadata: { customerCommand: { kind: 'confirm_order' } },
      }).success,
    ).toBe(false);
    expect(
      trustedCustomerActionEnvelopeSchema.safeParse({
        ...valid,
        actionDigest: 'not-a-digest',
      }).success,
    ).toBe(false);
    expect(
      trustedCustomerActionEnvelopeSchema.safeParse({
        ...valid,
        command: {
          kind: 'cart_update',
          itemCode: 'i'.repeat(129),
          quantity: 1,
        },
      }).success,
    ).toBe(false);
    expect(
      trustedCustomerActionEnvelopeSchema.safeParse({
        ...valid,
        unexpected: true,
      }).success,
    ).toBe(false);
  });

  it('accepts only exact action-specific payloads and bounded quantities', () => {
    expect(
      customerCommandFromVerifiedAction({
        actionId: 'add_item',
        payload: { itemCode: '20751', quantity: 1 },
      }),
    ).toEqual({
      kind: 'cart_update',
      itemCode: '20751',
      quantity: 1,
    });
    expect(
      customerCommandFromVerifiedAction({
        actionId: 'update_item_quantity',
        payload: { itemCode: '20751', quantity: 99 },
      }),
    ).toEqual({
      kind: 'cart_update',
      itemCode: '20751',
      quantity: 99,
    });
    expect(
      customerCommandFromVerifiedAction({
        actionId: 'remove_item',
        payload: { itemCode: '20751' },
      }),
    ).toEqual({
      kind: 'cart_update',
      itemCode: '20751',
      quantity: 0,
    });

    expect(
      customerCommandFromVerifiedAction({
        actionId: 'add_item',
        payload: { itemCode: '20751' },
      }),
    ).toBeUndefined();
    expect(
      customerCommandFromVerifiedAction({
        actionId: 'update_item_quantity',
        payload: { itemCode: '20751', quantity: 100 },
      }),
    ).toBeUndefined();
    expect(
      customerCommandFromVerifiedAction({
        actionId: 'remove_item',
        payload: { itemCode: '20751', quantity: 0 },
      }),
    ).toBeUndefined();
    expect(
      customerCommandFromVerifiedAction({
        actionId: 'confirm_order',
        payload: { orderId: 'untrusted' },
      }),
    ).toBeUndefined();
  });

  it('preserves one exact opaque payment selection authority tuple', () => {
    const selection = {
      methodId: `ví.điện-tử/α?provider=opaque#${'長'.repeat(512)}`,
      collectionKey: 'payment-methods:all/東京',
      collectionRevision: 'collection-revision:Σ',
      providerRevision: 'provider-revision:版本',
    };
    expect(
      customerCommandFromVerifiedAction({
        actionId: 'select_payment_method',
        payload: { selection },
      }),
    ).toEqual({
      kind: 'select_payment_method',
      selection,
    });
    expect(
      customerCommandFromVerifiedAction({
        actionId: 'select_payment_method',
        payload: { methodId: selection.methodId },
      }),
    ).toBeUndefined();

    for (const invalidSelection of [
      { ...selection, methodId: ` ${selection.methodId}` },
      { ...selection, collectionKey: ` ${selection.collectionKey}` },
      {
        ...selection,
        collectionRevision: `${selection.collectionRevision} `,
      },
      { ...selection, providerRevision: ' '.repeat(3) },
    ]) {
      expect(
        customerCommandFromVerifiedAction({
          actionId: 'select_payment_method',
          payload: { selection: invalidSelection },
        }),
      ).toBeUndefined();
    }
  });

  it('binds saved-address acceptance only to an opaque server ref', () => {
    const refId = '00000000-0000-4000-8000-000000000001';
    expect(
      customerCommandFromVerifiedAction({
        actionId: 'accept_fulfillment',
        value: refId,
      }),
    ).toEqual({
      kind: 'accept_fulfillment',
      savedAddressRef: {
        id: refId,
        kind: 'saved_address',
      },
    });
    expect(
      customerCommandFromVerifiedAction({
        actionId: 'accept_fulfillment',
        value: '123 Nguyễn Trãi, Quận 5',
      }),
    ).toEqual({ kind: 'accept_fulfillment' });
    expect(
      customerCommandFromVerifiedAction({
        actionId: 'accept_fulfillment',
        value: refId,
        payload: {
          address: {
            line1: '123 Nguyễn Trãi',
          },
        },
      }),
    ).toBeUndefined();
    expect(
      trustedCustomerActionEnvelopeSchema.safeParse({
        source: 'kfc_genui_action',
        assistantTurnId: 'assistant-turn-1',
        attachmentId: 'attachment-1',
        actionDigest: digest,
        verifiedRevision: revision,
        lifecycle: 'one_shot',
        command: {
          kind: 'accept_fulfillment',
          savedAddressRef: {
            id: refId,
            kind: 'fulfillment_address',
          },
        },
      }).success,
    ).toBe(false);
  });

  it('rejects duplicate or oversized batches and mismatched modifier action IDs', () => {
    expect(
      customerCommandFromVerifiedAction({
        actionId: 'add_items',
        payload: {
          items: [
            { itemCode: '20751', quantity: 1 },
            { itemCode: '20751', quantity: 2 },
          ],
        },
      }),
    ).toBeUndefined();
    expect(
      customerCommandFromVerifiedAction({
        actionId: 'add_items',
        payload: {
          items: Array.from({ length: 6 }, (_, index) => ({
            itemCode: `item-${index}`,
            quantity: 1,
          })),
        },
      }),
    ).toBeUndefined();
    expect(
      customerCommandFromVerifiedAction({
        actionId: 'customize_item:drink:small',
        payload: {
          itemCode: '20751',
          groupId: 'drink',
          modifierId: 'large',
        },
      }),
    ).toBeUndefined();
    expect(
      customerCommandFromVerifiedAction({
        actionId: 'customize_item:drink:large',
        payload: {
          itemCode: '20751',
          groupId: 'drink',
          modifierId: 'large',
        },
      }),
    ).toEqual({
      kind: 'modifier_selection',
      itemCode: '20751',
      groupId: 'drink',
      modifierId: 'large',
    });
  });

  it('maps one complete cart draft for update or fulfillment continuation', () => {
    const items = [
      { itemCode: '20751', quantity: 2 },
      { itemCode: '20692', quantity: 0 },
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
    expect(
      customerCommandFromVerifiedAction({
        actionId: 'update_cart',
        payload: {
          items: [
            { itemCode: '20751', quantity: 1 },
            { itemCode: '20751', quantity: 0 },
          ],
        },
      }),
    ).toBeUndefined();
  });

  it('maps one atomic modifier draft across distinct groups', () => {
    expect(
      customerCommandFromVerifiedAction({
        actionId: 'apply_modifiers',
        payload: {
          itemCode: '20751',
          selections: [
            { groupId: 'size', modifierId: 'large' },
            { groupId: 'sauce', modifierId: 'chili' },
          ],
        },
      }),
    ).toEqual({
      kind: 'modifier_batch_selection',
      itemCode: '20751',
      selections: [
        { groupId: 'size', modifierId: 'large' },
        { groupId: 'sauce', modifierId: 'chili' },
      ],
    });
    expect(
      customerCommandFromVerifiedAction({
        actionId: 'apply_modifiers',
        payload: {
          itemCode: '20751',
          selections: [
            { groupId: 'size', modifierId: 'large' },
            { groupId: 'size', modifierId: 'medium' },
          ],
        },
      }),
    ).toBeUndefined();
  });

  it('maps one atomic structured delivery-address draft', () => {
    expect(
      customerCommandFromVerifiedAction({
        actionId: 'submit_address',
        payload: {
          recipientName: 'Nguyễn An',
          phone: '0901234567',
          addressLine: '54/2 Nguyễn Hồng Đào',
          provinceCode: null,
          provinceName: 'TP Hồ Chí Minh',
          communeCode: null,
          communeName: 'Phường 14',
          deliveryInstructions: 'Gọi khi đến',
          rawAddress: '54/2 Nguyễn Hồng Đào p14 q tân bình tp HCM',
          legacyDistrictText: 'Quận Tân Bình',
        },
      }),
    ).toEqual({
      kind: 'submit_address',
      address: {
        recipientName: 'Nguyễn An',
        phone: '0901234567',
        addressLine: '54/2 Nguyễn Hồng Đào',
        provinceCode: null,
        provinceName: 'TP Hồ Chí Minh',
        communeCode: null,
        communeName: 'Phường 14',
        deliveryInstructions: 'Gọi khi đến',
        rawAddress: '54/2 Nguyễn Hồng Đào p14 q tân bình tp HCM',
        legacyDistrictText: 'Quận Tân Bình',
      },
    });
  });

  it('bounds free-form command values and preserves exact official evidence URLs', () => {
    expect(
      customerCommandFromVerifiedAction({
        actionId: 'submit_address',
        value: '  123 Nguyễn Huệ, Quận 1  ',
      }),
    ).toEqual({
      kind: 'submit_address',
      value: '123 Nguyễn Huệ, Quận 1',
    });
    expect(
      customerCommandFromVerifiedAction({
        actionId: 'apply_voucher',
        value: 'v'.repeat(65),
      }),
    ).toBeUndefined();
    expect(
      customerCommandFromVerifiedAction({
        actionId: 'send_issue_summary',
        value: 's'.repeat(1_001),
      }),
    ).toBeUndefined();
    expect(
      customerCommandFromVerifiedAction({
        actionId: 'open_allergen_chart',
        value: 'https://example.com/ignored-presentation-value',
        payload: { sourceUrl: 'https://official.example/allergens' },
      }),
    ).toEqual({
      kind: 'open_allergen_evidence',
      sourceUrl: 'https://official.example/allergens',
    });
    expect(
      customerCommandFromVerifiedAction({
        actionId: 'open_allergen_chart',
        payload: { sourceUrl: 'not-a-url' },
      }),
    ).toBeUndefined();
  });
});
