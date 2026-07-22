import type { Cart, Order } from '../domain/types.js';
import type { AgentState } from './agentState.js';
import { hasCartChanged } from './verifiedState.js';

type CheckoutRelationState = Pick<AgentState, 'cart' | 'order'>;

export function cartMatchesSubmittedOrder(
  cart: Cart | undefined,
  order: Order | undefined,
): boolean {
  return Boolean(
    cart &&
    order &&
    cart.id === order.cart.id &&
    !hasCartChanged(order.cart, cart),
  );
}

/**
 * The submitted order remains durable history, but a structurally different
 * active cart is a separate checkout. This relation is derived only from
 * verified commerce state; customer prose never selects it.
 */
export function activeCartSupersedesSubmittedOrder(
  state: CheckoutRelationState,
): boolean {
  return Boolean(
    state.cart &&
    state.order &&
    !cartMatchesSubmittedOrder(state.cart, state.order),
  );
}
