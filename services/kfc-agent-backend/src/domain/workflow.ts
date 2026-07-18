import { z } from 'zod';

export const workflowIds = [
  'catalog_cart',
  'fulfillment',
  'checkout_payment',
  'post_order_support',
] as const;

export const capabilityIds = [
  'membership',
  'promotions_content',
  'food_safety',
  'human_support',
] as const;

export type WorkflowId = (typeof workflowIds)[number];
export type CapabilityId = (typeof capabilityIds)[number];

export const workflowRouteSchema = z
  .object({
    primaryWorkflows: z.array(z.enum(workflowIds)).max(workflowIds.length),
    capabilities: z.array(z.enum(capabilityIds)).max(capabilityIds.length),
    needsClarification: z.boolean(),
  })
  .strict()
  .transform((route) => ({
    primaryWorkflows: [...new Set(route.primaryWorkflows)],
    capabilities: [...new Set(route.capabilities)],
    needsClarification: route.needsClarification,
  }));

export type WorkflowRoute = z.infer<typeof workflowRouteSchema>;

export function isSocialWorkflowRoute(route: WorkflowRoute): boolean {
  return !route.needsClarification &&
    route.primaryWorkflows.length === 0 &&
    route.capabilities.length === 0;
}
