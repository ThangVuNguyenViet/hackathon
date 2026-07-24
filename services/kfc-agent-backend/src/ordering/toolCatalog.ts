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
      itemCodes: z.array(z.string().min(1)).optional().default([]),
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
  updateCart: z.object({}).strict(),
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
    'Return the complete available menu for full mode, or every verified match for search mode. Always send all six fields: mode, queries, category, maxPriceVnd, partySize, and modifierQueries; use null for unused nullable fields and [] for unused arrays. Put independent product or identifier alternatives in queries; they use OR semantics. Use the exact category text already returned by the menu and leave queries empty for category-wide discovery; do not translate or invent a category. Use concise Vietnamese product names in queries and omit category for an exact product query unless the exact category is already verified and genuinely needed. Use maxPriceVnd only as a per-item ceiling, partySize only as catalog-backed ranking evidence, and modifierQueries only for selectable options of the searched product. Search a requested standalone drink, side, or other add-on independently instead of putting it in modifierQueries for another product. When a constrained search is empty, retry the same product or category search without modifierQueries or other unrelated constraints before considering alternatives; an empty constrained result does not prove that the product is absent. Multiple targeted searches may be called in one turn.',
  getItemDetails:
    'Return the verified customer-facing name, description, category, base price, and current availability for one previously discovered menu item code. Treat available false as unavailable to order.',
  getModifierOptions:
    'Return the verified selectable modifier tree, exact option identifiers, and exact option price deltas for one menu item code. Every name, attribute, and price belongs only to its exact option and branch. Do not transfer evidence between options, branches, or items. Missing modifier evidence means unknown, not proof of an ingredient, taste, or allergen property.',
  updateCart:
    'Apply the current verified GenUI cart action. The server derives the authorized item identifiers, quantities, and modifiers from that typed action and ignores wider model-authored changes. Plain-text messages, including explicit requests, can prepare a proposal but do not authorize this tool. Item quantity means menu portions, not pieces described inside the item. Treat the returned cart as authoritative; this permission never extends to irreversible actions.',
  previewCart: 'Return the current verified cart and server-calculated totals.',
  recommendAddOns:
    'Return verified add-on candidates for the current cart without mutating it. If a requested add-on is not returned, that does not prove that item is absent from the full menu; searchMenu can check for a standalone item.',
  findStores:
    'Return store candidates for the supplied structured location filters. Treat each returned row only as evidence for its own address. Empty results or rows outside the requested location do not prove either a matching store or exhaustive absence. This query does not prove that no KFC store exists in the location. A nearby or named store does not verify inventory or capacity and does not verify delivery coverage, fee, ETA, or item serviceability; use quoteFulfillment with complete delivery details for fulfillment facts.',
  checkStoreAvailability:
    'Check the exact current cart at one store and one pickup or delivery disposition; cart item codes are injected by the server. This verifies item availability only and does not verify delivery fee or ETA.',
  quoteFulfillment:
    'Quote pickup or delivery for an explicit address. This may be used before the customer chooses any items to verify the demo delivery address, fee, and ETA. Send a real line1 and only administrative fields explicitly supplied in model-visible evidence; use null for a missing district or city so the fulfillment provider can resolve it. Exact current cart item codes are injected by the server when present.',
  searchPromotions:
    'Return a complete promotion collection for the requested scope. Use a broad unfiltered request for the current catalog when a targeted search is empty; an empty filtered result does not prove that no promotion exists.',
  explainPromotion:
    'Return verified details and provenance for one promotion offer identifier.',
  validateVoucher:
    'Validate voucher text against the authoritative current cart subtotal.',
  getMembershipProfile: 'Return the authenticated customer membership profile.',
  listMembershipRewards:
    'Return a complete authenticated reward collection for the requested scope. Catalog presence alone does not prove that the customer has enough current points; use getMembershipProfile for the verified current balance.',
  listMembershipWallet:
    'Return the authenticated wallet collection for the requested status filter.',
  getMembershipPointHistory:
    'Return authenticated membership point history for the requested day window.',
  listMembershipTools:
    'Return authenticated membership capabilities for the requested side-effect class.',
  listPaymentMethods:
    'Return verified payment methods for the requested filters. When the customer names a payment method, query that customer-facing name and use only the exact supported methodId returned by the active collection; never infer support or invent a methodId.',
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
    'Return status for the authenticated customer current verified order. Describe status, timing, and fulfillment progress only from fields returned by this call.',
  createPaymentLink:
    'Create a payment link using the methodId from the active payment-method collection.',
  checkPaymentStatus:
    'Return payment status for the authenticated customer current verified order.',
  collectInvoice:
    'Collect only invoice fields supplied by the customer without inventing missing values. Ask naturally for required missing information; this does not place or modify the order.',
  handoff:
    'Queue the current session for a human only when the customer explicitly requests human support or verified provider or policy evidence requires escalation. Include the business facts the human must verify and preserve relevant customer consent and action-authority constraints, such as support sharing being allowed while ordering or payment remains unauthorized. Never use handoff merely because a cart proposal still needs GenUI confirmation; prepare the verified proposal for customer confirmation instead. A successful result means the request is queued and awaiting a human; it does not mean a human accepted or joined, and it does not verify response time. If a handoff is already queued, return that same verified escalation without creating another.',
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
