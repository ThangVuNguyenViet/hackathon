import { z } from 'zod';
import { opaqueProviderIdSchema } from '../domain/opaqueProviderId.js';
import { verifiedRefIdSchema } from '../domain/verifiedRef.js';
import type { ToolName } from './types.js';

const exactNonBlankStringSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim() === value, {
    message: 'value must not contain surrounding whitespace',
  });

export const resolvedFulfillmentAddressSchema = z
  .object({
    label: exactNonBlankStringSchema,
    line1: exactNonBlankStringSchema,
    district: exactNonBlankStringSchema,
    city: exactNonBlankStringSchema,
  })
  .strict();

function lineHasDistinctDetail(input: {
  line1: string;
  district: string | null;
  city: string | null;
}): boolean {
  const line = input.line1.trim();
  return (
    line.length >= 5 &&
    line !== input.district?.trim() &&
    line !== input.city?.trim()
  );
}

const fulfillmentAddressInputSchema = z
  .object({
    label: exactNonBlankStringSchema.nullable().optional().default(null),
    line1: exactNonBlankStringSchema,
    district: exactNonBlankStringSchema.nullable(),
    city: exactNonBlankStringSchema.nullable(),
  })
  .strict()
  .superRefine((address, context) => {
    if (!lineHasDistinctDetail(address)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['line1'],
        message:
          'line1 must contain distinct delivery detail beyond administrative fields',
      });
    }
  });

const agentCollectionScopeSchema = z
  .object({
    scope: z.enum(['all', 'filtered']),
    query: z.string().min(1).nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.scope === 'all' && value.query !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['query'],
        message: 'query must be null when scope is all',
      });
    }
    if (value.scope === 'filtered' && value.query === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['query'],
        message: 'query is required when scope is filtered',
      });
    }
  });

export const agentFulfillmentAddressSchema = z
  .object({
    label: exactNonBlankStringSchema.nullable(),
    line1: exactNonBlankStringSchema,
    district: exactNonBlankStringSchema.nullable(),
    city: exactNonBlankStringSchema.nullable(),
  })
  .strict()
  .superRefine((address, context) => {
    if (!lineHasDistinctDetail(address)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['line1'],
        message:
          'line1 must contain distinct delivery detail beyond administrative fields',
      });
    }
  });

const savedAddressRefSchema = z
  .object({
    id: verifiedRefIdSchema,
    kind: z.literal('saved_address'),
  })
  .strict();

export const toolArgumentSchemas = {
  searchMenu: z
    .object({
      mode: z.enum(['search', 'full']).optional().default('search'),
      queries: z.array(z.string().min(1)).optional().default([]),
      category: z.string().min(1).optional(),
      maxPriceVnd: z.number().int().nonnegative().optional(),
      partySize: z.number().int().positive().optional(),
      modifierQueries: z.array(z.string().min(1)).optional().default([]),
    })
    .strict(),
  getItemDetails: z.object({ code: z.string().min(1) }).strict(),
  getModifierOptions: z.object({ code: z.string().min(1) }).strict(),
  updateCart: z
    .object({
      changes: z
        .array(
          z
            .object({
              itemCode: z.string().min(1),
              quantity: z.number().int().nonnegative(),
              modifiers: z
                .array(
                  z
                    .object({
                      groupId: z.string().min(1),
                      modifierId: z.string().min(1),
                      quantity: z.number().int().positive().optional(),
                      groupName: z.string().min(1).optional(),
                      modifierName: z.string().min(1).optional(),
                      priceDeltaVnd: z.number().int().optional(),
                    })
                    .strict(),
                )
                .optional(),
            })
            .strict(),
        )
        .min(1),
    })
    .strict(),
  previewCart: z.object({}).strict(),
  recommendAddOns: z.object({}).strict(),
  findStores: z
    .object({
      query: z.string().min(1).optional(),
      city: z.string().min(1).optional(),
      district: z.string().min(1).optional(),
    })
    .strict(),
  checkStoreAvailability: z
    .object({
      storeId: z.string().min(1),
      itemCodes: z.array(z.string().min(1)).min(1),
      disposition: z.enum(['pickup', 'delivery']).optional(),
    })
    .strict(),
  quoteFulfillment: z
    .object({
      address: fulfillmentAddressInputSchema,
      method: z.enum(['pickup', 'delivery']),
      itemCodes: z.array(z.string().min(1)).min(1),
    })
    .strict(),
  searchPromotions: z
    .object({ query: z.string().optional().default('') })
    .strict(),
  explainPromotion: z.object({ offerId: z.string().min(1) }).strict(),
  validateVoucher: z
    .object({
      voucherText: z.string().min(1),
      subtotalVnd: z.number().int().nonnegative(),
    })
    .strict(),
  getMembershipProfile: z.object({}).strict(),
  listMembershipRewards: z
    .object({ query: z.string().min(1).optional() })
    .strict(),
  listMembershipWallet: z
    .object({
      status: z.enum(['active', 'expired', 'used', 'unknown']).optional(),
    })
    .strict(),
  getMembershipPointHistory: z
    .object({ days: z.number().int().positive().optional() })
    .strict(),
  listMembershipTools: z
    .object({
      sideEffect: z
        .enum([
          'read',
          'account_mutation',
          'voucher_acquisition',
          'reward_redemption',
        ])
        .optional(),
    })
    .strict(),
  listPaymentMethods: z
    .object({
      query: z.string().min(1).optional(),
      paymentSurface: z.string().min(1).optional(),
    })
    .strict(),
  getSavedAddresses: z.object({}).strict(),
  getRecentOrder: z.object({}).strict(),
  getFavoriteItems: z.object({}).strict(),
  acquireVoucher: z
    .object({
      rewardId: z.string().min(1),
      confirmed: z.boolean().optional().default(false),
    })
    .strict(),
  redeemReward: z
    .object({
      voucherId: z.string().min(1),
      channel: z.string().min(1).optional(),
      confirmed: z.boolean().optional().default(false),
    })
    .strict(),
  searchContentPolicy: z
    .object({
      kind: z.enum(['promotion', 'news', 'allergen', 'policy', 'all']),
      query: z.string().optional().default(''),
    })
    .strict(),
  answerAllergenQuestion: z
    .object({ query: z.string().optional().default('') })
    .strict(),
  previewOrder: z.object({}).strict(),
  placeOrder: z.object({}).strict(),
  getOrderStatus: z.object({ orderId: z.string().min(1) }).strict(),
  createPaymentLink: z.object({ methodId: opaqueProviderIdSchema }).strict(),
  checkPaymentStatus: z.object({ orderId: z.string().min(1) }).strict(),
  collectInvoice: z
    .object({
      companyName: z.string().min(1).optional(),
      taxCode: z.string().min(1).optional(),
      email: z.string().email().optional(),
    })
    .strict(),
  handoff: z.object({ reasons: z.array(z.string().min(1)).min(1) }).strict(),
  resolveHandoff: z.object({ escalationId: z.string().min(1) }).strict(),
} satisfies Record<ToolName, z.ZodTypeAny>;

/**
 * Provider-neutral schemas exposed to the maintained agent loop.
 * Every property is required (nullable where optional) so the same strict JSON
 * schema can be used by OpenAI and Gemini. Execution parses these again.
 */
export const agentToolArgumentSchemas = {
  searchMenu: z
    .object({
      mode: z.enum(['search', 'full']),
      queries: z.array(z.string().min(1)),
      category: z.string().min(1).nullable(),
      maxPriceVnd: z.number().int().nonnegative().nullable(),
      partySize: z.number().int().positive().nullable(),
      modifierQueries: z.array(z.string().min(1)),
    })
    .strict(),
  getItemDetails: z.object({ code: z.string().min(1) }).strict(),
  getModifierOptions: z.object({ code: z.string().min(1) }).strict(),
  updateCart: z
    .object({
      changes: z
        .array(
          z
            .object({
              itemCode: z.string().min(1),
              quantity: z.number().int().nonnegative(),
              modifiers: z.array(
                z
                  .object({
                    groupId: z.string().min(1),
                    modifierId: z.string().min(1),
                    quantity: z.number().int().positive().nullable(),
                  })
                  .strict(),
              ),
            })
            .strict(),
        )
        .min(1),
    })
    .strict(),
  previewCart: z.object({}).strict(),
  recommendAddOns: z.object({}).strict(),
  findStores: z
    .object({
      query: z.string().min(1).nullable(),
      city: z.string().min(1).nullable(),
      district: z.string().min(1).nullable(),
    })
    .strict(),
  checkStoreAvailability: z
    .object({
      storeId: z.string().min(1),
      disposition: z.enum(['pickup', 'delivery']).nullable(),
    })
    .strict(),
  quoteFulfillment: z.union([
    z
      .object({
        address: agentFulfillmentAddressSchema,
        method: z.enum(['pickup', 'delivery']),
      })
      .strict(),
    z
      .object({
        savedAddressRef: savedAddressRefSchema,
        method: z.enum(['pickup', 'delivery']),
      })
      .strict(),
  ]),
  searchPromotions: agentCollectionScopeSchema,
  explainPromotion: z.object({ offerId: z.string().min(1) }).strict(),
  validateVoucher: z.object({ voucherText: z.string().min(1) }).strict(),
  getMembershipProfile: z.object({}).strict(),
  listMembershipRewards: agentCollectionScopeSchema,
  listMembershipWallet: z
    .object({
      status: z.enum(['active', 'expired', 'used', 'unknown']).nullable(),
    })
    .strict(),
  getMembershipPointHistory: z
    .object({
      days: z.number().int().positive().nullable(),
    })
    .strict(),
  listMembershipTools: z
    .object({
      sideEffect: z
        .enum([
          'read',
          'account_mutation',
          'voucher_acquisition',
          'reward_redemption',
        ])
        .nullable(),
    })
    .strict(),
  listPaymentMethods: z
    .object({
      query: z.string().min(1).nullable(),
      paymentSurface: z.string().min(1).nullable(),
    })
    .strict(),
  getSavedAddresses: z.object({}).strict(),
  getRecentOrder: z.object({}).strict(),
  getFavoriteItems: z.object({}).strict(),
  acquireVoucher: z
    .object({
      rewardId: z.string().min(1),
    })
    .strict(),
  redeemReward: z
    .object({
      voucherId: z.string().min(1),
      channel: z.string().min(1),
    })
    .strict(),
  searchContentPolicy: z
    .object({
      kind: z.enum(['promotion', 'news', 'allergen', 'policy', 'all']),
      scope: z.enum(['all', 'filtered']),
      query: z.string().min(1).nullable(),
    })
    .strict()
    .superRefine((value, context) => {
      if ((value.scope === 'all') !== (value.query === null)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['query'],
          message:
            value.scope === 'all'
              ? 'query must be null when scope is all'
              : 'query is required when scope is filtered',
        });
      }
    }),
  answerAllergenQuestion: z.object({ query: z.string().min(1) }).strict(),
  previewOrder: z.object({}).strict(),
  placeOrder: z.object({}).strict(),
  getOrderStatus: z.object({}).strict(),
  createPaymentLink: z.object({ methodId: opaqueProviderIdSchema }).strict(),
  checkPaymentStatus: z.object({}).strict(),
  collectInvoice: z
    .object({
      companyName: z.string().min(1).nullable(),
      taxCode: z.string().min(1).nullable(),
      email: z.string().email().nullable(),
    })
    .strict(),
  handoff: z.object({ reasons: z.array(z.string().min(1)).min(1) }).strict(),
  resolveHandoff: z.object({}).strict(),
} satisfies Record<ToolName, z.ZodTypeAny>;

export const agentToolDescriptions: Record<ToolName, string> = {
  searchMenu:
    'Return the complete available menu for full mode, or every verified match for search mode. Put independent product or identifier alternatives in queries; they use OR semantics. Use category for category-wide discovery, maxPriceVnd only as a per-item ceiling, partySize only as catalog-backed ranking evidence, and modifierQueries for exact selectable-option evidence. Multiple targeted searches may be called in one turn.',
  getItemDetails:
    'Return verified details, base price, and current availability for one previously discovered menu item code.',
  getModifierOptions:
    'Return verified modifier groups, exact option identifiers, and exact option price deltas for one menu item code. Do not transfer evidence between options or items.',
  updateCart:
    'Apply every intended reversible cart addition, quantity change, and removal in one changes array using previously verified item and modifier identifiers. Item quantity means menu portions, not pieces described inside the item. Treat the returned cart as authoritative; this permission never extends to irreversible actions.',
  previewCart: 'Return the current verified cart and server-calculated totals.',
  recommendAddOns:
    'Return verified add-on candidates for the current cart without mutating it.',
  findStores:
    'Return verified stores matching the supplied structured location filters.',
  checkStoreAvailability:
    'Check the exact current cart at one store and one pickup or delivery disposition; cart item codes are injected by the server.',
  quoteFulfillment:
    'Quote pickup or delivery for the exact current cart using either an explicit address or the exact pendingSavedAddressRef from verified model state. For an explicit address, send a real line1 and only administrative fields explicitly supplied in model-visible evidence; use null for a missing district or city so the fulfillment provider can resolve it. Cart item codes are injected by the server.',
  searchPromotions:
    'Return a complete promotion collection for the requested scope.',
  explainPromotion:
    'Return verified details and provenance for one promotion offer identifier.',
  validateVoucher:
    'Validate voucher text against the authoritative current cart subtotal.',
  getMembershipProfile: 'Return the authenticated customer membership profile.',
  listMembershipRewards:
    'Return a complete authenticated reward collection for the requested scope.',
  listMembershipWallet:
    'Return the authenticated wallet collection for the requested status filter.',
  getMembershipPointHistory:
    'Return authenticated membership point history for the requested day window.',
  listMembershipTools:
    'Return authenticated membership capabilities for the requested side-effect class.',
  listPaymentMethods:
    'Return verified payment methods for the requested filters.',
  getSavedAddresses:
    'Return the authenticated customer saved-address records as read-only evidence for this tool loop.',
  getRecentOrder:
    'Return the authenticated customer most recent order, or null when none exists, as read-only evidence for this tool loop.',
  getFavoriteItems:
    'Return the authenticated customer favorite menu items as read-only evidence for this tool loop.',
  acquireVoucher: 'Acquire one previously verified membership reward.',
  redeemReward: 'Redeem one previously verified wallet voucher.',
  searchContentPolicy:
    'Return complete governed content evidence for the requested kind and scope.',
  answerAllergenQuestion:
    'Return governed allergen evidence with official-source provenance.',
  previewOrder:
    'Preview an order only after a successful fresh availability check for the exact current cart, active store, and pickup or delivery disposition.',
  placeOrder: 'Place the exact order represented by the current order preview.',
  getOrderStatus:
    'Return status for the authenticated customer current verified order.',
  createPaymentLink:
    'Create a payment link using the methodId from the active payment-method collection.',
  checkPaymentStatus:
    'Return payment status for the authenticated customer current verified order.',
  collectInvoice:
    'Collect available invoice fields without inventing missing values.',
  handoff: 'Escalate the current session to a human with structured reasons.',
  resolveHandoff:
    'Withdraw the active human-support escalation when the customer no longer wants it. Do not call this merely because the customer starts another commerce task.',
};

export const toolNames = Object.keys(toolArgumentSchemas) as ToolName[];

export function parseToolArguments(
  toolName: ToolName,
  args: Record<string, unknown>,
) {
  return toolArgumentSchemas[toolName].safeParse(args);
}

export function parseAgentToolArguments(
  toolName: ToolName,
  args: Record<string, unknown>,
) {
  return agentToolArgumentSchemas[toolName].safeParse(args);
}
