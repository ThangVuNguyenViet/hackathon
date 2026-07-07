import { z } from 'zod';
import type { ToolName } from './types.js';

const addressSchema = z
  .object({
    label: z.string().min(1).default('Địa chỉ giao hàng'),
    line1: z.string().min(1),
    district: z.string().min(1),
    city: z.string().min(1),
  })
  .strict();

export const toolArgumentSchemas = {
  searchMenu: z.object({ query: z.string().min(1) }).strict(),
  getItemDetails: z.object({ code: z.string().min(1) }).strict(),
  getModifierOptions: z.object({ code: z.string().min(1) }).strict(),
  updateCart: z
    .object({
      itemCode: z.string().min(1),
      quantity: z.number().int().nonnegative(),
      modifiers: z
        .array(
          z
            .object({
              groupId: z.string().min(1),
              groupName: z.string().min(1),
              modifierId: z.string().min(1),
              modifierName: z.string().min(1),
              quantity: z.number().int().positive(),
              priceDeltaVnd: z.number().int(),
            })
            .strict(),
        )
        .optional(),
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
      address: addressSchema,
      method: z.enum(['pickup', 'delivery']),
      itemCodes: z.array(z.string().min(1)).min(1),
    })
    .strict(),
  searchPromotions: z.object({ query: z.string().min(1) }).strict(),
  explainPromotion: z.object({ offerId: z.string().min(1) }).strict(),
  validateVoucher: z
    .object({
      voucherText: z.string().min(1),
      subtotalVnd: z.number().int().nonnegative(),
    })
    .strict(),
  searchContentPolicy: z
    .object({
      kind: z.enum(['promotion', 'news', 'allergen', 'policy', 'all']),
      query: z.string().min(1),
    })
    .strict(),
  answerAllergenQuestion: z.object({ query: z.string().min(1) }).strict(),
  previewOrder: z.object({}).strict(),
  placeOrder: z.object({}).strict(),
  getOrderStatus: z.object({ orderId: z.string().min(1) }).strict(),
  createPaymentLink: z.object({ method: z.enum(['momo', 'card', 'cod']) }).strict(),
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

export const toolNames = Object.keys(toolArgumentSchemas) as ToolName[];

export function parseToolArguments(toolName: ToolName, args: Record<string, unknown>) {
  return toolArgumentSchemas[toolName].safeParse(args);
}
