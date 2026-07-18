import { z } from 'zod';
import type {
  CapabilityId,
  WorkflowId,
  WorkflowRoute,
} from '../domain/workflow.js';
import type { ToolName } from './types.js';
import { defaultCommerceAgentPolicy } from '../config/commerceAgentPolicy.js';

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

export const toolNames = Object.keys(toolArgumentSchemas) as ToolName[];

export type ToolRiskLevel = 'read' | 'protected' | 'irreversible';

export interface ToolMetadata {
  workflows: readonly WorkflowId[];
  capabilities: readonly CapabilityId[];
  riskLevel: ToolRiskLevel;
  requiresConfirmation: boolean;
}

const route = (
  workflows: readonly WorkflowId[],
  capabilities: readonly CapabilityId[] = [],
  riskLevel: ToolRiskLevel = 'read',
): Omit<ToolMetadata, 'requiresConfirmation'> => ({ workflows, capabilities, riskLevel });

const routedTools = {
  searchMenu: route(['catalog_cart']),
  getItemDetails: route(['catalog_cart']),
  getModifierOptions: route(['catalog_cart'], ['food_safety']),
  updateCart: route(['catalog_cart'], [], 'protected'),
  previewCart: route(['catalog_cart']),
  recommendAddOns: route(['catalog_cart']),
  findStores: route(['fulfillment']),
  checkStoreAvailability: route(['fulfillment'], [], 'protected'),
  quoteFulfillment: route(['fulfillment'], [], 'protected'),
  searchPromotions: route([], ['promotions_content']),
  explainPromotion: route([], ['promotions_content']),
  validateVoucher: route(['checkout_payment'], ['promotions_content'], 'protected'),
  getMembershipProfile: route([], ['membership']),
  listMembershipRewards: route([], ['membership']),
  listMembershipWallet: route([], ['membership']),
  getMembershipPointHistory: route([], ['membership']),
  listMembershipTools: route([], ['membership']),
  listPaymentMethods: route(['checkout_payment']),
  acquireVoucher: route([], ['membership'], 'protected'),
  redeemReward: route([], ['membership'], 'protected'),
  searchContentPolicy: route([], ['promotions_content', 'food_safety']),
  answerAllergenQuestion: route([], ['food_safety']),
  previewOrder: route(['checkout_payment'], [], 'protected'),
  placeOrder: route(['checkout_payment'], [], 'irreversible'),
  getOrderStatus: route(['post_order_support']),
  createPaymentLink: route(['checkout_payment'], [], 'protected'),
  checkPaymentStatus: route(['checkout_payment', 'post_order_support']),
  collectInvoice: route(['checkout_payment', 'post_order_support'], [], 'protected'),
  handoff: route([], ['human_support'], 'protected'),
} satisfies Record<ToolName, Omit<ToolMetadata, 'requiresConfirmation'>>;

export const toolMetadata = Object.fromEntries(
  Object.entries(routedTools).map(([toolName, metadata]) => [
    toolName,
    {
      ...metadata,
      requiresConfirmation:
        defaultCommerceAgentPolicy.confirmationRequiredTools.includes(toolName as ToolName),
    },
  ]),
) as Record<ToolName, ToolMetadata>;

export const toolRouteMetadata = toolMetadata;

export function toolMatchesWorkflowRoute(toolName: ToolName, workflowRoute: WorkflowRoute): boolean {
  if (workflowRoute.needsClarification) return false;
  const metadata = toolMetadata[toolName];
  return metadata.workflows.some((workflow) => workflowRoute.primaryWorkflows.includes(workflow)) ||
    metadata.capabilities.some((capability) => workflowRoute.capabilities.includes(capability));
}

export function parseToolArguments(toolName: ToolName, args: Record<string, unknown>) {
  return toolArgumentSchemas[toolName].safeParse(args);
}
