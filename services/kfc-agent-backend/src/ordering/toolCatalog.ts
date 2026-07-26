import { z } from 'zod';
import { opaqueProviderIdSchema } from '../domain/opaqueProviderId.js';
import { paymentSurfaceSchema } from '../domain/paymentSurface.js';
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
      query: z
        .string()
        .optional()
        .default('')
        .describe(
          'Concise product, identifier, alias, or product-composition terms selected from the customer intent. Put components named in an item or description here, not in modifierQueries. Leave empty for category-wide browsing and put the category wording only in category. Do not pass the full customer sentence.',
        ),
      mode: z
        .enum(['search', 'full'])
        .optional()
        .default('search')
        .describe(
          'Use full only when the customer asks to see the complete menu; otherwise use search.',
        ),
      category: z
        .string()
        .min(1)
        .optional()
        .describe(
          'Optional normalized partial or complete fixture category wording selected by the model.',
        ),
      maxPriceVnd: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe(
          'Per-item price ceiling in VND. This is not an aggregate cart limit; for a total recommendation budget, combine returned priceVnd values.',
        ),
      partySize: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          'Number of people used as ranking evidence for a group recommendation. It does not guarantee serving size; verify quantities from returned descriptions or item details.',
        ),
      modifierQueries: z
        .array(z.string().min(1))
        .min(1)
        .optional()
        .describe(
          'Independent terms using wording exposed by the selectable option, all intended to match the same item. Keep negation when it is part of the desired option name, such as không cay; for an omitted optional add-on, pass its target wording, such as phô mai. Use this for selectable choices, not product components named in an item or description. Only matchedModifiers is verified selectable-option evidence.',
        ),
    })
    .strict(),
  getItemDetails: z.object({ code: z.string().min(1) }).strict(),
  getModifierOptions: z.object({ code: z.string().min(1) }).strict(),
  updateCart: z.union([
    z
      .object({
        itemCode: z.string().min(1),
        quantity: z
          .number()
          .int()
          .nonnegative()
          .describe(
            'Line-item quantity in menu portions; for a product containing N pieces, use 1 for one portion, not the embedded piece count.',
          ),
        modifiers: z
          .array(
            z
              .object({
                groupId: z.string().min(1),
                modifierId: z.string().min(1),
                quantity: z
                  .number()
                  .int()
                  .positive()
                  .optional()
                  .describe(
                    'Selected modifier quantity per menu portion, using the verified modifier option contract.',
                  ),
                groupName: z.string().min(1).optional(),
                modifierName: z.string().min(1).optional(),
                priceDeltaVnd: z.number().int().optional(),
              })
              .strict(),
          )
          .optional(),
      })
      .strict(),
    z
      .object({
        mode: z
          .enum(['patch', 'replace'])
          .default('patch')
          .describe(
            'patch changes only the listed item codes; replace treats positive-quantity changes as the complete desired cart and removes all unlisted current items.',
          ),
        changes: z
          .array(
            z
              .object({
                itemCode: z.string().min(1),
                quantity: z
                  .number()
                  .int()
                  .nonnegative()
                  .describe(
                    'Line-item quantity in menu portions; for a product containing N pieces, use 1 for one portion, not the embedded piece count.',
                  ),
                modifiers: z
                  .array(
                    z
                      .object({
                        groupId: z.string().min(1),
                        modifierId: z.string().min(1),
                        quantity: z
                          .number()
                          .int()
                          .positive()
                          .optional()
                          .describe(
                            'Selected modifier quantity per menu portion, using the verified modifier option contract.',
                          ),
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
  ]),
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
      paymentSurface: paymentSurfaceSchema.optional(),
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
  searchMenu: agentCollectionScopeSchema,
  getItemDetails: z.object({ code: z.string().min(1) }).strict(),
  getModifierOptions: z.object({ code: z.string().min(1) }).strict(),
  updateCart: z
    .object({
      mode: z.enum(['patch', 'replace']).default('patch'),
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
      paymentSurface: paymentSurfaceSchema.nullable(),
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
    'Return the complete menu for scope all, or the complete matching menu collection for scope filtered. For filtered scope, pass only concise product names or exact identifiers needed for matching; combine independent alternatives with OR. Do not copy the full customer sentence into query.',
  getItemDetails:
    'Return verified details for one previously discovered menu item code.',
  getModifierOptions:
    'Return verified modifier groups and identifiers for one menu item code.',
  updateCart:
    'Apply customer-requested quantities using previously verified item and modifier identifiers. After a catalog read uniquely verifies every explicitly requested item and required modifier, use this tool to perform the requested cart change instead of only describing or promising it.',
  previewCart: 'Return the current verified cart and server-calculated totals.',
  recommendAddOns:
    'Return verified add-on candidates for the current cart without mutating it.',
  findStores:
    'Return verified stores only when the customer explicitly asks to discover, locate, or compare stores. Do not use this tool to infer delivery coverage, select a fulfillment store, or answer a delivery-fee question from an incomplete location such as a district alone; those require the cart and a complete delivery address through the fulfillment tools.',
  checkStoreAvailability:
    'Check the exact current cart at one store and one pickup or delivery disposition; cart item codes are injected by the server.',
  quoteFulfillment:
    'Quote pickup or delivery for the exact current cart using either an explicit address or the exact pendingSavedAddressRef from verified model state. For an explicit address, send a real line1 and only administrative fields explicitly supplied in model-visible evidence; use null for a missing district or city so the fulfillment provider can resolve it. Cart item codes are injected by the server.',
  searchPromotions:
    'Return a complete promotion collection for the requested scope.',
  explainPromotion:
    'Return verified details and provenance for one promotion offer identifier.',
  validateVoucher:
    'Validate customer-supplied voucher text against the authoritative current cart subtotal. Use this tool before claiming that a voucher applies or changes the total.',
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
    'Return the currently verified payment-method policy for the requested filters. Use fresh tool evidence for each current payment-support or payment-listing question, including follow-up questions about whether a named method is listed; prior conversation text is not current provider authority.',
  getSavedAddresses:
    'Return the authenticated customer saved-address records as read-only evidence for this tool loop.',
  getRecentOrder:
    'Return the authenticated customer most recent order, or null when none exists, as read-only evidence for this tool loop.',
  getFavoriteItems:
    'Return the authenticated customer favorite menu items as read-only evidence for this tool loop.',
  acquireVoucher:
    'Request acquisition of one previously verified reward; execution requires server approval.',
  redeemReward:
    'Request redemption of one previously verified wallet voucher; execution requires server approval.',
  searchContentPolicy:
    'Return complete governed content evidence for the requested kind and scope.',
  answerAllergenQuestion:
    'Return governed allergen evidence with official-source provenance.',
  previewOrder:
    'Preview an order only after a successful fresh availability check for the exact current cart, active store, and pickup or delivery disposition.',
  placeOrder:
    'Place the exact verified order only while its fresh exact-cart availability check remains valid and after server-authenticated approval.',
  getOrderStatus:
    'Return status for the authenticated customer current verified order.',
  createPaymentLink:
    'Request a payment link using the exact methodId from the active verified payment-method collection; execution requires server approval.',
  checkPaymentStatus:
    'Return payment status for the authenticated customer current verified order.',
  collectInvoice:
    'Collect available invoice fields without inventing missing values.',
  handoff:
    'Request escalation of the current session to a human with structured reasons; execution requires server approval.',
  resolveHandoff:
    'Withdraw the exact active verified human-support escalation when the customer no longer wants that escalation; execution requires server approval. Do not call this merely because the customer starts another commerce task.',
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
