import { z } from 'zod';
import { activeCartSupersedesSubmittedOrder } from '../../agent/activeCheckout.js';
import type { Cart, Order } from '../../domain/types.js';
import { digestCommerceAction } from '../../ordering/commerceDigest.js';
import { orderingJourneyIdSchema } from '../domain/identities.js';

export const productOrderFlowBindingSchema = z
  .object({
    schemaVersion: z.literal('kfc-product-order-flow-v1'),
    orderFlowId: orderingJourneyIdSchema,
    cartId: z.string().min(1),
    predecessorOrderId: z.string().min(1).nullable(),
  })
  .strict();

export type ProductOrderFlowBinding = z.infer<
  typeof productOrderFlowBindingSchema
>;

export async function bindProductOrderFlow(input: {
  sessionId: string;
  cart: Cart;
  order?: Order;
  prior?: ProductOrderFlowBinding;
}): Promise<ProductOrderFlowBinding> {
  const prior = input.prior
    ? productOrderFlowBindingSchema.parse(input.prior)
    : undefined;
  const predecessorOrderId = activeCartSupersedesSubmittedOrder({
    cart: input.cart,
    order: input.order,
  })
    ? input.order!.id
    : null;
  const beginsAfterNewOrder =
    predecessorOrderId !== null &&
    predecessorOrderId !== prior?.predecessorOrderId;
  if (prior && prior.cartId === input.cart.id && !beginsAfterNewOrder) {
    return prior;
  }
  const digest = await digestCommerceAction({
    sessionId: input.sessionId,
    cartId: input.cart.id,
    predecessorOrderId,
  });
  return productOrderFlowBindingSchema.parse({
    schemaVersion: 'kfc-product-order-flow-v1',
    orderFlowId: `product-order-flow:${digest.slice(0, 24)}`,
    cartId: input.cart.id,
    predecessorOrderId,
  });
}
