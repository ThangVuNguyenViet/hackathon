import { z } from 'zod';
import { officialSourceAuthoritySchema } from '../../domain/officialSourceAuthority.js';
import { selectedPaymentMethodAuthoritySchema } from '../../domain/opaqueProviderId.js';
import { orderStatusDeliveryEstimateSchema } from '../../domain/orderStatusEvidence.js';
import { verifiedRefSchema } from '../../domain/verifiedRef.js';
import {
  generatedMembershipRewardOfferSchema,
  generatedMembershipToolDefinitionSchema,
  generatedMembershipWalletVoucherSchema,
  generatedMenuModifierSchema,
  generatedPaymentMethodSchema,
  generatedPromotionVoucherOfferSchema,
} from '../../fixtures/schema.js';
import { exactCartAvailabilityObservationV2Schema } from '../../ordering/exactCartAvailabilityAuthority.js';
import { resolvedFulfillmentAddressSchema } from '../../ordering/toolCatalog.js';
import { TOOL_NAMES } from '../../ordering/types.js';

const nonBlankStringSchema = z.string().min(1);
const nonNegativeIntegerSchema = z.number().int().nonnegative();

const cartItemModifierSchema = z
  .object({
    groupId: nonBlankStringSchema,
    groupName: z.string(),
    modifierId: nonBlankStringSchema,
    modifierName: z.string(),
    quantity: z.number().int().positive(),
    priceDeltaVnd: z.number().int(),
  })
  .strict();

const cartItemSchema = z
  .object({
    itemCode: nonBlankStringSchema,
    name: z.string(),
    quantity: z.number().int().positive(),
    unitPriceVnd: nonNegativeIntegerSchema,
    modifiers: z.array(cartItemModifierSchema).optional(),
    imageUrl: z.string().optional(),
    category: z.string().optional(),
  })
  .strict();

const cartSchema = z
  .object({
    id: nonBlankStringSchema,
    items: z.array(cartItemSchema),
    subtotalVnd: nonNegativeIntegerSchema,
    discountVnd: nonNegativeIntegerSchema,
    deliveryFeeVnd: nonNegativeIntegerSchema,
    totalVnd: nonNegativeIntegerSchema,
    voucherCode: z.string().nullable(),
  })
  .strict();

const addressDraftSchema = resolvedFulfillmentAddressSchema.partial().strict();

const commerceProviderProvenanceSchema = z.record(
  z
    .object({
      implementation: nonBlankStringSchema,
      source: nonBlankStringSchema,
    })
    .strict(),
);

const orderSchema = z
  .object({
    id: nonBlankStringSchema,
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
    assignedStoreId: nonBlankStringSchema,
    createdAt: nonBlankStringSchema,
    deliveryEstimate: orderStatusDeliveryEstimateSchema.optional(),
    posTicketId: z.string().optional(),
    posStatus: z
      .enum(['accepted', 'preparing', 'ready', 'cancelled', 'rejected'])
      .optional(),
    commerceOrderId: z.string().optional(),
    omsOrderId: z.string().optional(),
    commerceOutcome: z.string().optional(),
    commerceCustomerStatus: z.string().optional(),
    commerceEnvironment: z.enum(['sandbox', 'production']).optional(),
    commerceProviderProvenance: commerceProviderProvenanceSchema.optional(),
  })
  .strict();

const serverPolicySchema = z
  .object({
    policyId: nonBlankStringSchema,
    revision: nonBlankStringSchema,
  })
  .strict();

const sourceProvenanceSchema = z
  .object({
    fixtureMode: z.enum([
      'public_crawl_seed',
      'authenticated_chrome_seed',
      'mock_external_state',
      'test_only',
      'demo_mock_seed',
      'provider_runtime',
    ]),
    sourceFile: nonBlankStringSchema,
    sourceUrl: z.string().optional(),
    sourceApi: z.string().optional(),
    serverPolicy: serverPolicySchema.optional(),
    officialAuthority: officialSourceAuthoritySchema.optional(),
  })
  .strict();

const persistedToolTraceProvenanceSchema = sourceProvenanceSchema
  .partial()
  .required({ fixtureMode: true })
  .strict();

const fulfillmentStateSchema = z
  .object({
    method: z.enum(['pickup', 'delivery']),
    disposition: z.enum(['pickup', 'delivery']),
    storeId: nonBlankStringSchema,
    storeName: z.string(),
    resolvedAddress: resolvedFulfillmentAddressSchema.optional(),
    feeVnd: nonNegativeIntegerSchema,
    etaMinutes: nonNegativeIntegerSchema,
    availability: z
      .object({
        ok: z.boolean(),
        checkedItemIds: z.array(z.string()),
        unavailableItemIds: z.array(z.string()),
        blockedTimeslotItemIds: z.array(z.string()),
        source: sourceProvenanceSchema,
      })
      .strict(),
  })
  .strict();

const promotionValidationSchema = z
  .object({
    ok: z.boolean(),
    reason: z.enum([
      'validated',
      'not_found',
      'minimum_not_met',
      'expired',
      'public_code_not_exposed',
      'not_redeemable_publicly',
    ]),
    publicCode: z.string(),
    discountVnd: nonNegativeIntegerSchema,
    source: sourceProvenanceSchema,
  })
  .strict();

const promotionContextSchema = z
  .object({
    matchedOfferIds: z.array(z.string()),
    validation: promotionValidationSchema.optional(),
    caveats: z.array(z.string()),
  })
  .strict();

const contentEvidenceSchema = z
  .object({
    id: z.string().optional(),
    kind: z.enum(['promotion', 'news', 'allergen', 'policy']),
    title: z.string(),
    snippet: z.string(),
    sourceUrl: nonBlankStringSchema,
    sourceFile: nonBlankStringSchema,
    tags: z.array(z.string()).optional(),
    retrievedAt: z.string().optional(),
    approvedAt: z.string().optional(),
    approvalStatus: z.literal('approved').optional(),
    audience: z.literal('customer_public').optional(),
    contentHash: z.string().optional(),
    officialAuthority: officialSourceAuthoritySchema.optional(),
  })
  .strict();

const menuModifierOptionSchema: z.ZodTypeAny = z.lazy(() =>
  z
    .object({
      modifierId: nonBlankStringSchema,
      name: z.string(),
      priceDeltaVnd: z.number().int(),
      default: z.boolean(),
      quantity: z.number().int().nullable(),
      modifierGroups: z.array(menuModifierGroupSchema),
    })
    .strict(),
);

const menuModifierGroupSchema: z.ZodTypeAny = z.lazy(() =>
  z
    .object({
      groupId: nonBlankStringSchema,
      name: z.string(),
      min: z.number().int().nullable(),
      max: z.number().int().nullable(),
      depth: nonNegativeIntegerSchema,
      options: z.array(menuModifierOptionSchema),
    })
    .strict(),
);

const menuItemSchema = z
  .object({
    code: nonBlankStringSchema,
    itemId: z.string().optional(),
    productCode: z.string().optional(),
    category: z.string(),
    categoryId: z.string(),
    name: z.string(),
    description: z.string(),
    priceVnd: nonNegativeIntegerSchema,
    originalPriceVnd: nonNegativeIntegerSchema.nullable(),
    imageUrl: z.string(),
    available: z.boolean(),
    isCustomize: z.boolean().optional(),
    isQuickCombo: z.boolean().optional(),
    hasModifiers: z.boolean().optional(),
    modifierGroups: z.array(menuModifierGroupSchema).optional(),
  })
  .strict();

const customerContextSchema = z
  .object({
    savedAddresses: z.array(resolvedFulfillmentAddressSchema),
    recentOrders: z.array(orderSchema),
    favorites: z.array(menuItemSchema),
    loyaltyPoints: nonNegativeIntegerSchema.optional(),
  })
  .strict();

const paymentAttemptSchema = z
  .object({
    orderId: z.string().optional(),
    method: z.string().optional(),
    status: z.enum(['pending', 'paid', 'failed']),
    paymentUrl: z.string().optional(),
  })
  .strict();

const invoiceRequestSchema = z
  .object({
    companyName: z.string(),
    taxCode: z.string(),
    email: z.string(),
  })
  .strict();

const handoffStateSchema = z
  .object({
    escalationId: nonBlankStringSchema,
    reasons: z.array(nonBlankStringSchema),
  })
  .strict();

const collectionScopeSchema = z.union([
  z.object({ scope: z.literal('all') }).strict(),
  z
    .object({
      scope: z.literal('filtered'),
      query: z.string(),
    })
    .strict(),
]);

function verifiedCollectionSnapshotSchema(itemSchema: z.ZodTypeAny) {
  return z
    .object({
      key: nonBlankStringSchema,
      revision: nonBlankStringSchema,
      providerRevision: nonBlankStringSchema,
      result: z
        .object({
          items: z.array(itemSchema),
          total: nonNegativeIntegerSchema,
          returned: nonNegativeIntegerSchema,
          complete: z.boolean(),
          scope: collectionScopeSchema,
          cursor: z.string().optional(),
        })
        .strict(),
    })
    .strict();
}

const storeCollectionItemSchema = z
  .object({
    storeId: nonBlankStringSchema,
    name: z.string(),
    address: z.string(),
    city: z.string(),
  })
  .strict();

const verifiedCollectionStoreSchema = z
  .object({
    searchMenu: z
      .record(verifiedCollectionSnapshotSchema(menuItemSchema))
      .optional(),
    recommendAddOns: z
      .record(verifiedCollectionSnapshotSchema(menuItemSchema))
      .optional(),
    findStores: z
      .record(verifiedCollectionSnapshotSchema(storeCollectionItemSchema))
      .optional(),
    searchPromotions: z
      .record(
        verifiedCollectionSnapshotSchema(
          generatedPromotionVoucherOfferSchema.strict(),
        ),
      )
      .optional(),
    listMembershipRewards: z
      .record(
        verifiedCollectionSnapshotSchema(
          generatedMembershipRewardOfferSchema.strict(),
        ),
      )
      .optional(),
    listMembershipWallet: z
      .record(
        verifiedCollectionSnapshotSchema(
          generatedMembershipWalletVoucherSchema.strict(),
        ),
      )
      .optional(),
    listMembershipTools: z
      .record(
        verifiedCollectionSnapshotSchema(
          generatedMembershipToolDefinitionSchema.strict(),
        ),
      )
      .optional(),
    listPaymentMethods: z
      .record(
        verifiedCollectionSnapshotSchema(generatedPaymentMethodSchema.strict()),
      )
      .optional(),
    searchContentPolicy: z
      .record(verifiedCollectionSnapshotSchema(contentEvidenceSchema))
      .optional(),
    answerAllergenQuestion: z
      .record(verifiedCollectionSnapshotSchema(contentEvidenceSchema))
      .optional(),
  })
  .strict();

const collectionToolNames = [
  'searchMenu',
  'recommendAddOns',
  'findStores',
  'searchPromotions',
  'listMembershipRewards',
  'listMembershipWallet',
  'listMembershipTools',
  'listPaymentMethods',
  'searchContentPolicy',
  'answerAllergenQuestion',
] as const;

const activeCollectionKeysSchema = z
  .object(
    Object.fromEntries(
      collectionToolNames.map((name) => [name, z.string().optional()]),
    ) as Record<
      (typeof collectionToolNames)[number],
      z.ZodOptional<z.ZodString>
    >,
  )
  .partial()
  .strict();

const toolTracePublicationAuditBase = {
  currentTurnId: nonBlankStringSchema,
  traceIndex: nonNegativeIntegerSchema,
  traceDigest: nonBlankStringSchema,
  argumentsDigest: nonBlankStringSchema,
  toolCallId: nonBlankStringSchema,
  toolName: z.enum(TOOL_NAMES),
  executionOutcome: z.enum(['success', 'error']),
  evidenceId: nonBlankStringSchema,
  evidenceDigest: nonBlankStringSchema,
  membershipActionOutcome: z
    .object({
      actionId: nonBlankStringSchema,
      status: z.enum(['previewed', 'completed']),
      requiresUserConfirmation: z.boolean(),
      targetId: nonBlankStringSchema,
    })
    .strict()
    .optional(),
} as const;

const toolTracePublicationAuditSchema = z.discriminatedUnion('schemaVersion', [
  z
    .object({
      ...toolTracePublicationAuditBase,
      schemaVersion: z.literal('kfc-tool-trace-publication-audit-v1'),
    })
    .strict(),
  z
    .object({
      ...toolTracePublicationAuditBase,
      schemaVersion: z.literal('kfc-tool-trace-publication-audit-v2'),
      authorityDigest: nonBlankStringSchema,
      currentTurnRevision: nonBlankStringSchema,
    })
    .strict(),
]);

const toolTraceEntrySchema = z
  .object({
    toolName: z.enum(TOOL_NAMES),
    arguments: z.record(z.unknown()),
    ok: z.boolean(),
    resultSummary: z.string(),
    provenance: z.array(persistedToolTraceProvenanceSchema),
    publicationEvidenceAudit: toolTracePublicationAuditSchema.optional(),
  })
  .strict();

export const kfcVerifiedStateSnapshotSchema = z
  .object({
    cart: cartSchema.optional(),
    address: resolvedFulfillmentAddressSchema.optional(),
    addressDraft: addressDraftSchema.optional(),
    orderPreview: orderSchema.optional(),
    order: orderSchema.optional(),
    cancellationStatusChecked: z.boolean().optional(),
    selectedModifiers: z.record(z.array(cartItemModifierSchema)).optional(),
    fulfillment: fulfillmentStateSchema.optional(),
    exactCartAvailabilityObservation:
      exactCartAvailabilityObservationV2Schema.optional(),
    promotionContext: promotionContextSchema.optional(),
    promotionOffers: z
      .array(generatedPromotionVoucherOfferSchema.strict())
      .optional(),
    contentEvidence: z.array(contentEvidenceSchema).optional(),
    menuSearchResults: z.array(menuItemSchema).optional(),
    verifiedCollections: verifiedCollectionStoreSchema.optional(),
    activeCollectionKeys: activeCollectionKeysSchema.optional(),
    activeMenuCollection:
      verifiedCollectionSnapshotSchema(menuItemSchema).optional(),
    menuItemDetail: menuItemSchema.optional(),
    menuModifierOptions: generatedMenuModifierSchema.strict().optional(),
    customerContext: customerContextSchema.optional(),
    pendingSavedAddressRef: verifiedRefSchema.optional(),
    paymentAttempt: paymentAttemptSchema.optional(),
    selectedPaymentMethod: selectedPaymentMethodAuthoritySchema.optional(),
    paymentMethodEvidence: z
      .array(generatedPaymentMethodSchema.strict())
      .optional(),
    invoiceRequest: invoiceRequestSchema.optional(),
    handoff: handoffStateSchema.optional(),
    toolTrace: z.array(toolTraceEntrySchema).optional(),
  })
  .strict();
