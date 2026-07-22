import { z } from 'zod';
import { opaqueProviderIdSchema } from '../domain/opaqueProviderId.js';

export const commerceContractVersion = 'kfc-commerce-proof-v2' as const;

export const omsStatusSchema = z.enum([
  'previewed',
  'created',
  'cancelled',
  'cancellation_failed',
]);

export const posStatusSchema = z.enum([
  'accepted',
  'preparing',
  'ready',
  'cancelled',
  'rejected',
  'cancellation_failed',
  'unknown',
]);

export const customerStatusSchema = z.enum([
  'awaiting_confirmation',
  'submitting',
  'accepted',
  'preparing',
  'ready',
  'cancelled',
  'failed',
]);

const identifierSchema = opaqueProviderIdSchema;
const bindingFingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const pathSafeIdentifierSchema = identifierSchema.refine(
  (value) => value !== '.' && value !== '..',
  { message: 'Identifier must not be a URL dot segment' },
);

const providerProvenanceEntrySchema = z
  .object({
    implementation: identifierSchema,
    source: identifierSchema,
  })
  .strict();

export const commerceProviderProvenanceSchema = z
  .object({
    catalog: providerProvenanceEntrySchema,
    cart: providerProvenanceEntrySchema,
    inventory: providerProvenanceEntrySchema,
    store: providerProvenanceEntrySchema,
    fulfillment: providerProvenanceEntrySchema,
    gateway: providerProvenanceEntrySchema,
    oms: providerProvenanceEntrySchema,
    pos: providerProvenanceEntrySchema,
  })
  .strict();

export const sandboxCommerceProofProviderProvenance = {
  catalog: {
    implementation: 'http-catalog-observation',
    source: 'bundled-catalog-snapshot',
  },
  cart: {
    implementation: 'in-process-fixture-provider',
    source: 'bundled-generated-fixtures',
  },
  inventory: {
    implementation: 'in-process-fixture-provider',
    source: 'bundled-generated-fixtures',
  },
  store: {
    implementation: 'in-process-fixture-provider',
    source: 'bundled-generated-fixtures',
  },
  fulfillment: {
    implementation: 'in-process-fixture-provider',
    source: 'bundled-generated-fixtures',
  },
  gateway: { implementation: 'http-adapter', source: 'local-proof-gateway' },
  oms: { implementation: 'http-adapter', source: 'local-proof-oms' },
  pos: { implementation: 'http-adapter', source: 'local-proof-pos' },
} as const;

export const commerceCommandSchema = z
  .object({
    contractVersion: z.literal(commerceContractVersion),
    traceId: identifierSchema,
    scenarioId: identifierSchema,
    sessionId: identifierSchema,
    clientMessageId: identifierSchema,
    idempotencyKey: identifierSchema,
    bindingFingerprint: bindingFingerprintSchema,
    toolName: z.literal('placeOrder'),
    order: z
      .object({
        previewId: identifierSchema,
        storeId: identifierSchema,
        items: z
          .array(
            z
              .object({
                itemCode: identifierSchema,
                quantity: z.number().int().positive().safe(),
              })
              .strict(),
          )
          .min(1),
        totalVnd: z.number().int().nonnegative().safe(),
        paymentMethod: identifierSchema,
        userConfirmed: z.literal(true),
      })
      .strict(),
  })
  .strict();

export const commerceResultSchema = z
  .object({
    contractVersion: z.literal(commerceContractVersion),
    traceId: identifierSchema,
    scenarioId: identifierSchema,
    outcome: z.enum([
      'accepted',
      'deduplicated',
      'pos_rejected',
      'ambiguous_pos_submission',
      'cancelled',
      'partial_cancellation',
      'status_conflict',
      'failed',
    ]),
    commerceOrderId: pathSafeIdentifierSchema.optional(),
    omsOrderId: identifierSchema.optional(),
    posTicketId: identifierSchema.optional(),
    omsStatus: omsStatusSchema.optional(),
    posStatus: posStatusSchema.optional(),
    customerStatus: customerStatusSchema,
    deduplicated: z.boolean().default(false),
    originalTraceId: identifierSchema.optional(),
    compensationStatus: z
      .enum(['not_required', 'succeeded', 'failed'])
      .optional(),
    conflictType: identifierSchema.optional(),
    commerceEnvironment: z.literal('sandbox'),
    providerProvenance: commerceProviderProvenanceSchema,
  })
  .strict();

export type CommerceCommand = z.infer<typeof commerceCommandSchema>;
export type CommerceResult = z.infer<typeof commerceResultSchema>;
export type OmsStatus = z.infer<typeof omsStatusSchema>;
export type PosStatus = z.infer<typeof posStatusSchema>;
export type CustomerStatus = z.infer<typeof customerStatusSchema>;
