import { z } from 'zod';
import { orderStatusDeliveryEstimateSchema } from '../domain/orderStatusEvidence.js';
import { generatedPaymentMethodSchema } from '../fixtures/schema.js';

const providerProvenanceSchema = z
  .array(
    z.object({
      fixtureMode: z.enum([
        'public_crawl_seed',
        'authenticated_chrome_seed',
        'mock_external_state',
        'test_only',
        'demo_mock_seed',
        'provider_runtime',
      ]),
      sourceFile: z.string(),
      sourceUrl: z.string().optional(),
      sourceApi: z.string().optional(),
    }),
  )
  .optional();

const cartItemModifierSchema = z.object({
  groupId: z.string(),
  groupName: z.string(),
  modifierId: z.string(),
  modifierName: z.string(),
  quantity: z.number().int(),
  priceDeltaVnd: z.number(),
});

const cartItemSchema = z.object({
  itemCode: z.string().min(1),
  name: z.string(),
  quantity: z.number().int().positive(),
  unitPriceVnd: z.number(),
  modifiers: z.array(cartItemModifierSchema).optional(),
  imageUrl: z.string().optional(),
  category: z.string().optional(),
});

const cartSchema = z.object({
  id: z.string().min(1),
  items: z.array(cartItemSchema),
  subtotalVnd: z.number(),
  discountVnd: z.number(),
  deliveryFeeVnd: z.number(),
  totalVnd: z.number(),
  voucherCode: z.string().nullable(),
});

const commerceProviderProvenanceEntrySchema = z.object({
  implementation: z.string().min(1),
  source: z.string().min(1),
});

const providerOrderIdSchema = z
  .string()
  .min(1)
  .refine((value) => value !== '.' && value !== '..', {
    message: 'Provider order identifier must not be a URL dot segment',
  });

export const providerOrderSchema = z.object({
  id: providerOrderIdSchema,
  cart: cartSchema,
  status: z.enum([
    'previewed',
    'created',
    'preparing',
    'delivering',
    'completed',
    'cancelled',
  ]),
  paymentStatus: z.enum(['not_started', 'pending', 'paid', 'failed']),
  assignedStoreId: z.string().min(1),
  createdAt: z.string().min(1),
  posTicketId: z.string().min(1).optional(),
  posStatus: z
    .enum(['accepted', 'preparing', 'ready', 'cancelled', 'rejected'])
    .optional(),
  commerceOrderId: z.string().min(1).optional(),
  omsOrderId: z.string().min(1).optional(),
  commerceOutcome: z.string().min(1).optional(),
  commerceCustomerStatus: z.string().min(1).optional(),
  commerceEnvironment: z.enum(['sandbox', 'production']).optional(),
  commerceProviderProvenance: z
    .record(commerceProviderProvenanceEntrySchema)
    .optional(),
});

export const providerOrderStatusSchema = providerOrderSchema.extend({
  deliveryEstimate: orderStatusDeliveryEstimateSchema.optional(),
});

export const providerPosTicketSchema = z.object({
  id: z.string().min(1),
  omsOrderId: z.string().min(1),
  storeId: z.string().min(1),
  status: z.enum(['accepted', 'preparing', 'ready', 'cancelled', 'rejected']),
  createdAt: z.string().min(1),
});

export const providerPaymentMethodsSchema = z.array(
  generatedPaymentMethodSchema,
);

const governedCashOnDeliveryMarker = 'cod://pay-on-delivery';

function isSafePaymentLink(value: string): boolean {
  if (value === governedCashOnDeliveryMarker) return true;
  if (
    value.length === 0 ||
    [...value].some((character) => {
      const codePoint = character.codePointAt(0)!;
      return (
        codePoint <= 0x0020 ||
        codePoint === 0x0085 ||
        codePoint === 0x00a0 ||
        codePoint === 0x1680 ||
        (codePoint >= 0x2000 && codePoint <= 0x200a) ||
        codePoint === 0x2028 ||
        codePoint === 0x2029 ||
        codePoint === 0x202f ||
        codePoint === 0x205f ||
        codePoint === 0x3000 ||
        codePoint === 0xfeff
      );
    })
  ) {
    return false;
  }
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === 'https:' &&
      parsed.hostname.length > 0 &&
      parsed.username.length === 0 &&
      parsed.password.length === 0
    );
  } catch {
    return false;
  }
}

export const providerPaymentLinkSchema = z.object({
  url: z.string().refine(isSafePaymentLink, {
    message:
      'Payment link must be an absolute credential-free HTTPS URL or the governed cash-on-delivery marker',
  }),
  status: z.literal('pending'),
});

export const providerPaymentStatusSchema = z.object({
  status: z.enum(['pending', 'paid', 'failed']),
});

export const providerHandoffResolutionSchema = z
  .object({
    escalationId: z.string().min(1),
    status: z.literal('resolved'),
  })
  .strict();

export const providerToolFailureSchema = z
  .object({
    ok: z.literal(false),
    errorCode: z.string().min(1),
    message: z.string(),
    provenance: providerProvenanceSchema,
  })
  .passthrough();

export function providerToolResultSchema<ValueSchema extends z.ZodTypeAny>(
  valueSchema: ValueSchema,
) {
  return z.discriminatedUnion('ok', [
    z
      .object({
        ok: z.literal(true),
        value: valueSchema,
        message: z.string(),
        provenance: providerProvenanceSchema,
      })
      .passthrough(),
    providerToolFailureSchema,
  ]);
}

export const providerOrderResultSchema =
  providerToolResultSchema(providerOrderSchema);

export const providerOrderStatusResultSchema = providerToolResultSchema(
  providerOrderStatusSchema,
);

export const providerPosTicketResultSchema = providerToolResultSchema(
  providerPosTicketSchema,
);

export const providerPaymentMethodsResultSchema = providerToolResultSchema(
  providerPaymentMethodsSchema,
);

export const providerPaymentLinkResultSchema = providerToolResultSchema(
  providerPaymentLinkSchema,
);

export const providerPaymentStatusResultSchema = providerToolResultSchema(
  providerPaymentStatusSchema,
);

export const providerHandoffResolutionResultSchema = providerToolResultSchema(
  providerHandoffResolutionSchema,
);
