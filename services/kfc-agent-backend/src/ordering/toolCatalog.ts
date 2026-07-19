import { z } from 'zod';
import type { ToolName } from './types.js';

function normalizedAddressTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/đ/g, 'd')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .match(/[a-z0-9]+/g) ?? [];
}

const addressSchema = z
  .object({
    label: z.string().min(1).optional(),
    line1: z.string().min(1),
    district: z.string().min(1),
    city: z.string().min(1),
  })
  .strict()
  .superRefine((address, context) => {
    const lineTokens = normalizedAddressTokens(address.line1);
    const administrativeTokens = new Set([
      ...normalizedAddressTokens(address.district),
      ...normalizedAddressTokens(address.city),
    ]);
    if (lineTokens.length === 0 || lineTokens.every((token) => administrativeTokens.has(token))) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['line1'],
        message: 'line1 must contain a street, building, or other detail beyond district and city',
      });
    }
  })
  .transform((address) => ({
    ...address,
    // A display label is not location evidence. Reusing the customer's exact
    // line1 avoids inventing a saved/default address when the model omits it.
    label: address.label ?? address.line1,
  }));

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

const agentAddressSchema = z
  .object({
    label: z.string().min(1).nullable(),
    line1: z.string().min(1),
    district: z.string().min(1),
    city: z.string().min(1),
  })
  .strict()
  .superRefine((address, context) => {
    const lineTokens = normalizedAddressTokens(address.line1);
    const administrativeTokens = new Set([
      ...normalizedAddressTokens(address.district),
      ...normalizedAddressTokens(address.city),
    ]);
    if (lineTokens.length === 0 || lineTokens.every((token) => administrativeTokens.has(token))) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['line1'],
        message: 'line1 must contain a street, building, or other detail beyond district and city',
      });
    }
  });

export const toolArgumentSchemas = {
  searchMenu: z.object({ query: z.string().optional().default('') }).strict(),
  getItemDetails: z.object({ code: z.string().min(1) }).strict(),
  getModifierOptions: z.object({ code: z.string().min(1) }).strict(),
  updateCart: z.union([
    z.object({
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
    }).strict(),
    z.object({
      changes: z.array(z.object({
        itemCode: z.string().min(1),
        quantity: z.number().int().nonnegative(),
        modifiers: z.array(z.object({
          groupId: z.string().min(1),
          modifierId: z.string().min(1),
          quantity: z.number().int().positive().optional(),
          groupName: z.string().min(1).optional(),
          modifierName: z.string().min(1).optional(),
          priceDeltaVnd: z.number().int().optional(),
        }).strict()).optional(),
      }).strict()).min(1),
    }).strict(),
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
      address: addressSchema,
      method: z.enum(['pickup', 'delivery']),
      itemCodes: z.array(z.string().min(1)).min(1),
    })
    .strict(),
  searchPromotions: z.object({ query: z.string().optional().default('') }).strict(),
  explainPromotion: z.object({ offerId: z.string().min(1) }).strict(),
  validateVoucher: z
    .object({
      voucherText: z.string().min(1),
      subtotalVnd: z.number().int().nonnegative(),
    })
    .strict(),
  getMembershipProfile: z.object({}).strict(),
  listMembershipRewards: z.object({ query: z.string().min(1).optional() }).strict(),
  listMembershipWallet: z.object({ status: z.enum(['active', 'expired', 'used', 'unknown']).optional() }).strict(),
  getMembershipPointHistory: z.object({ days: z.number().int().positive().optional() }).strict(),
  listMembershipTools: z
    .object({
      sideEffect: z.enum(['read', 'account_mutation', 'voucher_acquisition', 'reward_redemption']).optional(),
    })
    .strict(),
  listPaymentMethods: z
    .object({
      query: z.string().min(1).optional(),
      paymentSurface: z.string().min(1).optional(),
    })
    .strict(),
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
  answerAllergenQuestion: z.object({ query: z.string().optional().default('') }).strict(),
  previewOrder: z.object({}).strict(),
  placeOrder: z.object({}).strict(),
  getOrderStatus: z.object({ orderId: z.string().min(1) }).strict(),
  createPaymentLink: z.object({ method: z.enum(['momo', 'zalopay', 'card', 'cod']) }).strict(),
  checkPaymentStatus: z.object({ orderId: z.string().min(1) }).strict(),
  collectInvoice: z
    .object({
      companyName: z.string().min(1).optional(),
      taxCode: z.string().min(1).optional(),
      email: z.string().email().optional(),
    })
    .strict(),
  handoff: z.object({ reasons: z.array(z.string().min(1)).min(1) }).strict(),
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
  updateCart: z.object({
    changes: z.array(z.object({
      itemCode: z.string().min(1),
      quantity: z.number().int().nonnegative(),
      modifiers: z.array(z.object({
        groupId: z.string().min(1),
        modifierId: z.string().min(1),
        quantity: z.number().int().positive().nullable(),
      }).strict()),
    }).strict()).min(1),
  }).strict(),
  previewCart: z.object({}).strict(),
  recommendAddOns: z.object({}).strict(),
  findStores: z.object({
    query: z.string().min(1).nullable(),
    city: z.string().min(1).nullable(),
    district: z.string().min(1).nullable(),
  }).strict(),
  checkStoreAvailability: z.object({
    storeId: z.string().min(1),
    disposition: z.enum(['pickup', 'delivery']).nullable(),
  }).strict(),
  quoteFulfillment: z.object({
    address: agentAddressSchema,
    method: z.enum(['pickup', 'delivery']),
  }).strict(),
  searchPromotions: agentCollectionScopeSchema,
  explainPromotion: z.object({ offerId: z.string().min(1) }).strict(),
  validateVoucher: z.object({ voucherText: z.string().min(1) }).strict(),
  getMembershipProfile: z.object({}).strict(),
  listMembershipRewards: agentCollectionScopeSchema,
  listMembershipWallet: z.object({
    status: z.enum(['active', 'expired', 'used', 'unknown']).nullable(),
  }).strict(),
  getMembershipPointHistory: z.object({
    days: z.number().int().positive().nullable(),
  }).strict(),
  listMembershipTools: z.object({
    sideEffect: z.enum(['read', 'account_mutation', 'voucher_acquisition', 'reward_redemption']).nullable(),
  }).strict(),
  listPaymentMethods: z.object({
    query: z.string().min(1).nullable(),
    paymentSurface: z.string().min(1).nullable(),
  }).strict(),
  acquireVoucher: z.object({ rewardId: z.string().min(1) }).strict(),
  redeemReward: z.object({ voucherId: z.string().min(1) }).strict(),
  searchContentPolicy: z.object({
    kind: z.enum(['promotion', 'news', 'allergen', 'policy', 'all']),
    scope: z.enum(['all', 'filtered']),
    query: z.string().min(1).nullable(),
  }).strict().superRefine((value, context) => {
    if ((value.scope === 'all') !== (value.query === null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['query'],
        message: value.scope === 'all'
          ? 'query must be null when scope is all'
          : 'query is required when scope is filtered',
      });
    }
  }),
  answerAllergenQuestion: z.object({ query: z.string().min(1) }).strict(),
  previewOrder: z.object({}).strict(),
  placeOrder: z.object({}).strict(),
  getOrderStatus: z.object({}).strict(),
  createPaymentLink: z.object({ method: z.enum(['momo', 'zalopay', 'card', 'cod']) }).strict(),
  checkPaymentStatus: z.object({}).strict(),
  collectInvoice: z.object({
    companyName: z.string().min(1).nullable(),
    taxCode: z.string().min(1).nullable(),
    email: z.string().email().nullable(),
  }).strict(),
  handoff: z.object({ reasons: z.array(z.string().min(1)).min(1) }).strict(),
} satisfies Record<ToolName, z.ZodTypeAny>;

export const agentToolDescriptions: Record<ToolName, string> = {
  searchMenu: 'Return the complete menu for scope all, or the complete matching menu collection for scope filtered.',
  getItemDetails: 'Return verified details for one previously discovered menu item code.',
  getModifierOptions: 'Return verified modifier groups and identifiers for one menu item code.',
  updateCart: 'Apply customer-requested quantities using previously verified item and modifier identifiers.',
  previewCart: 'Return the current verified cart and server-calculated totals.',
  recommendAddOns: 'Return verified add-on candidates for the current cart without mutating it.',
  findStores: 'Return verified stores matching the supplied structured location filters.',
  checkStoreAvailability: 'Check the exact current cart at one store; cart item codes are injected by the server.',
  quoteFulfillment: 'Quote pickup or delivery for the exact current cart; cart item codes are injected by the server.',
  searchPromotions: 'Return a complete promotion collection for the requested scope.',
  explainPromotion: 'Return verified details and provenance for one promotion offer identifier.',
  validateVoucher: 'Validate voucher text against the authoritative current cart subtotal.',
  getMembershipProfile: 'Return the authenticated customer membership profile.',
  listMembershipRewards: 'Return a complete authenticated reward collection for the requested scope.',
  listMembershipWallet: 'Return the authenticated wallet collection for the requested status filter.',
  getMembershipPointHistory: 'Return authenticated membership point history for the requested day window.',
  listMembershipTools: 'Return authenticated membership capabilities for the requested side-effect class.',
  listPaymentMethods: 'Return verified payment methods for the requested filters.',
  acquireVoucher: 'Request acquisition of one previously verified reward; execution requires server approval.',
  redeemReward: 'Request redemption of one previously verified wallet voucher; execution requires server approval.',
  searchContentPolicy: 'Return complete governed content evidence for the requested kind and scope.',
  answerAllergenQuestion: 'Return governed allergen evidence with official-source provenance.',
  previewOrder: 'Preview an order from the exact verified cart and fulfillment state.',
  placeOrder: 'Place the verified previewed order after server-authenticated approval.',
  getOrderStatus: 'Return status for the authenticated customer current verified order.',
  createPaymentLink: 'Request a payment link for the verified created order and selected method; execution requires server approval.',
  checkPaymentStatus: 'Return payment status for the authenticated customer current verified order.',
  collectInvoice: 'Collect available invoice fields without inventing missing values.',
  handoff: 'Request escalation of the current session to a human with structured reasons; execution requires server approval.',
};

export const toolNames = Object.keys(toolArgumentSchemas) as ToolName[];

export function parseToolArguments(toolName: ToolName, args: Record<string, unknown>) {
  return toolArgumentSchemas[toolName].safeParse(args);
}

export function parseAgentToolArguments(toolName: ToolName, args: Record<string, unknown>) {
  return agentToolArgumentSchemas[toolName].safeParse(args);
}
