import { z } from 'zod';
import {
  selectedPaymentMethodAuthoritySchema,
} from './opaqueProviderId.js';
import {
  verifiedRefIdSchema,
} from './verifiedRef.js';

const identifierSchema = z.string().trim().min(1).max(128);
const quantitySchema = z.number().int().min(1).max(99);
const addressValueSchema = z.string().trim().min(1).max(500);
const voucherValueSchema = z.string().trim().min(1).max(64);
const supportDetailSchema = z.string().trim().min(1).max(1_000);
const sourceUrlSchema = z.string().trim().min(1).max(2_048).url();
const digestSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const envelopeIdentifierSchema = z.string().trim().min(1).max(256);
const emptyPayloadSchema = z.object({}).strict();
const savedAddressRefSchema = z.object({
  id: verifiedRefIdSchema,
  kind: z.literal('saved_address'),
}).strict();

const cartUpdateCommandSchema = z.object({
  kind: z.literal('cart_update'),
  itemCode: identifierSchema,
  quantity: z.number().int().min(0).max(99),
}).strict();

const cartBatchItemsSchema = z.array(
  z.object({
    itemCode: identifierSchema,
    quantity: quantitySchema,
  }).strict(),
)
  .min(1)
  .max(5)
  .superRefine((items, context) => {
    const seen = new Set<string>();
    items.forEach((item, index) => {
      if (seen.has(item.itemCode)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['items', index, 'itemCode'],
          message: 'Item codes must be unique',
        });
      }
      seen.add(item.itemCode);
    });
  });

const cartBatchUpdateCommandSchema = z.object({
  kind: z.literal('cart_batch_update'),
  items: cartBatchItemsSchema,
}).strict();

const modifierSelectionCommandSchema = z.object({
  kind: z.literal('modifier_selection'),
  itemCode: identifierSchema,
  groupId: identifierSchema,
  modifierId: identifierSchema,
}).strict();

const acceptFulfillmentCommandSchema = z.object({
  kind: z.literal('accept_fulfillment'),
  savedAddressRef: savedAddressRefSchema.optional(),
}).strict();

const customerCommandSchema = z.discriminatedUnion('kind', [
  cartUpdateCommandSchema,
  cartBatchUpdateCommandSchema,
  modifierSelectionCommandSchema,
  z.object({ kind: z.literal('confirm_order') }).strict(),
  z.object({ kind: z.literal('start_fulfillment') }).strict(),
  acceptFulfillmentCommandSchema,
  z.object({
    kind: z.literal('select_payment_method'),
    selection: selectedPaymentMethodAuthoritySchema,
  }).strict(),
  z.object({ kind: z.literal('edit_cart') }).strict(),
  z.object({
    kind: z.literal('submit_address'),
    value: addressValueSchema.optional(),
  }).strict(),
  z.object({
    kind: z.literal('apply_voucher'),
    value: voucherValueSchema.optional(),
  }).strict(),
  z.object({ kind: z.literal('change_payment_method') }).strict(),
  z.object({ kind: z.literal('continue_payment') }).strict(),
  z.object({ kind: z.literal('track_order') }).strict(),
  z.object({ kind: z.literal('request_support') }).strict(),
  z.object({
    kind: z.literal('add_support_detail'),
    value: supportDetailSchema.optional(),
  }).strict(),
  z.object({
    kind: z.literal('open_allergen_evidence'),
    sourceUrl: sourceUrlSchema,
  }).strict(),
]);

export type CustomerCommand = z.infer<typeof customerCommandSchema>;

/**
 * Internal authority passed separately from persisted conversation metadata.
 * Request JSON and model output must never be parsed directly into this type.
 */
export const trustedCustomerActionEnvelopeSchema = z.object({
  source: z.literal('kfc_genui_action'),
  assistantTurnId: envelopeIdentifierSchema,
  attachmentId: envelopeIdentifierSchema,
  actionDigest: digestSchema,
  verifiedRevision: digestSchema,
  lifecycle: z.enum(['one_shot', 'replayable']),
  command: customerCommandSchema,
}).strict();

export type TrustedCustomerActionEnvelope = z.infer<
  typeof trustedCustomerActionEnvelopeSchema
>;

export interface VerifiedStructuredAction {
  actionId: string;
  value?: string;
  payload?: Record<string, unknown>;
}

export function customerCommandFromVerifiedAction(
  action: VerifiedStructuredAction,
): CustomerCommand | undefined {
  const payload = action.payload ?? {};
  switch (action.actionId) {
    case 'add_item': {
      const parsed = z.object({
        itemCode: identifierSchema,
        quantity: quantitySchema,
      }).strict().safeParse(payload);
      return parsed.success
        ? {
            kind: 'cart_update',
            itemCode: parsed.data.itemCode,
            quantity: parsed.data.quantity,
          }
        : undefined;
    }
    case 'update_item_quantity': {
      const parsed = z.object({
        itemCode: identifierSchema,
        quantity: quantitySchema,
      }).strict().safeParse(payload);
      return parsed.success
        ? {
            kind: 'cart_update',
            itemCode: parsed.data.itemCode,
            quantity: parsed.data.quantity,
          }
        : undefined;
    }
    case 'remove_item': {
      const parsed = z.object({
        itemCode: identifierSchema,
      }).strict().safeParse(payload);
      return parsed.success
        ? {
            kind: 'cart_update',
            itemCode: parsed.data.itemCode,
            quantity: 0,
          }
        : undefined;
    }
    case 'add_items': {
      const parsed = z.object({
        items: cartBatchItemsSchema,
      }).strict().safeParse(payload);
      return parsed.success
        ? {
            kind: 'cart_batch_update',
            items: parsed.data.items,
          }
        : undefined;
    }
    case 'confirm_order':
      return commandWithoutPayload(payload, { kind: 'confirm_order' });
    case 'continue_to_fulfillment':
      return commandWithoutPayload(payload, { kind: 'start_fulfillment' });
    case 'accept_fulfillment': {
      if (!emptyPayloadSchema.safeParse(payload).success) return undefined;
      const refId = verifiedRefIdSchema.safeParse(action.value);
      return refId.success
        ? {
            kind: 'accept_fulfillment',
            savedAddressRef: {
              id: refId.data,
              kind: 'saved_address',
            },
          }
        : { kind: 'accept_fulfillment' };
    }
    case 'select_payment_method': {
      const parsed = z.object({
        selection: selectedPaymentMethodAuthoritySchema,
      }).strict().safeParse(payload);
      return parsed.success
        ? {
            kind: 'select_payment_method',
            selection: parsed.data.selection,
          }
        : undefined;
    }
    case 'edit_cart':
      return commandWithoutPayload(payload, { kind: 'edit_cart' });
    case 'submit_address':
      return commandWithOptionalValue(
        payload,
        action.value,
        addressValueSchema,
        'submit_address',
      );
    case 'apply_voucher':
      return commandWithOptionalValue(
        payload,
        action.value,
        voucherValueSchema,
        'apply_voucher',
      );
    case 'change_payment_method':
      return commandWithoutPayload(payload, {
        kind: 'change_payment_method',
      });
    case 'open_payment':
      return commandWithoutPayload(payload, { kind: 'continue_payment' });
    case 'track_order':
      return commandWithoutPayload(payload, { kind: 'track_order' });
    case 'request_human':
      return commandWithoutPayload(payload, { kind: 'request_support' });
    case 'send_issue_summary':
      return commandWithOptionalValue(
        payload,
        action.value,
        supportDetailSchema,
        'add_support_detail',
      );
    case 'open_allergen_chart': {
      const parsed = z.object({
        sourceUrl: sourceUrlSchema,
      }).strict().safeParse(payload);
      return parsed.success
        ? {
            kind: 'open_allergen_evidence',
            sourceUrl: parsed.data.sourceUrl,
          }
        : undefined;
    }
    default:
      return modifierCommand(action, payload);
  }
}

export function createTrustedCustomerActionEnvelope(
  input: z.input<typeof trustedCustomerActionEnvelopeSchema>,
): TrustedCustomerActionEnvelope {
  return trustedCustomerActionEnvelopeSchema.parse(input);
}

function modifierCommand(
  action: VerifiedStructuredAction,
  payload: Record<string, unknown>,
): CustomerCommand | undefined {
  if (!action.actionId.startsWith('customize_item:')) return undefined;
  const parsed = z.object({
    itemCode: identifierSchema,
    groupId: identifierSchema,
    modifierId: identifierSchema,
  }).strict().safeParse(payload);
  if (!parsed.success) return undefined;
  const expectedActionId =
    `customize_item:${encodeURIComponent(parsed.data.groupId)}:${encodeURIComponent(parsed.data.modifierId)}`;
  return action.actionId === expectedActionId
    ? {
        kind: 'modifier_selection',
        itemCode: parsed.data.itemCode,
        groupId: parsed.data.groupId,
        modifierId: parsed.data.modifierId,
      }
    : undefined;
}

function commandWithoutPayload<Command extends CustomerCommand>(
  payload: Record<string, unknown>,
  command: Command,
): Command | undefined {
  return emptyPayloadSchema.safeParse(payload).success ? command : undefined;
}

function commandWithOptionalValue(
  payload: Record<string, unknown>,
  value: string | undefined,
  schema: z.ZodString,
  kind: 'submit_address' | 'apply_voucher' | 'add_support_detail',
): CustomerCommand | undefined {
  if (!emptyPayloadSchema.safeParse(payload).success) return undefined;
  if (value === undefined) {
    switch (kind) {
      case 'submit_address':
        return { kind: 'submit_address' };
      case 'apply_voucher':
        return { kind: 'apply_voucher' };
      case 'add_support_detail':
        return { kind: 'add_support_detail' };
    }
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) return undefined;
  switch (kind) {
    case 'submit_address':
      return { kind: 'submit_address', value: parsed.data };
    case 'apply_voucher':
      return { kind: 'apply_voucher', value: parsed.data };
    case 'add_support_detail':
      return { kind: 'add_support_detail', value: parsed.data };
  }
}
