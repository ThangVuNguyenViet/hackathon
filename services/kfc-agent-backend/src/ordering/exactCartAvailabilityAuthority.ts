import { z } from 'zod';
import type { Cart } from '../domain/types.js';
import { digestCommerceAction } from './approvalReceipt.js';
import type { Disposition } from './types.js';

export const EXACT_CART_AVAILABILITY_OBSERVATION_V2_SCHEMA_VERSION =
  'kfc-exact-cart-availability-observation-v2' as const;

const nonBlankString = z.string().min(1).refine(
  (value) => value.trim().length > 0,
);

const exactCartAvailabilityObservationRowV2Schema = z.object({
  itemCode: nonBlankString,
  quantity: z.number().int().positive(),
  status: z.enum(['available', 'unavailable', 'blocked']),
}).strict();

export const inventoryAvailabilityProviderRevisionV2Schema = z.object({
  authority: z.literal('inventory_availability'),
  revision: nonBlankString,
}).strict();

export type InventoryAvailabilityProviderRevisionV2 = z.infer<
  typeof inventoryAvailabilityProviderRevisionV2Schema
>;

export const exactCartAvailabilityObservationV2Schema = z.object({
  schemaVersion: z.literal(
    EXACT_CART_AVAILABILITY_OBSERVATION_V2_SCHEMA_VERSION,
  ),
  observationId: nonBlankString,
  cartRevision: nonBlankString,
  storeId: nonBlankString,
  disposition: z.enum(['pickup', 'delivery']),
  inventoryProviderRevision: inventoryAvailabilityProviderRevisionV2Schema,
  observedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  complete: z.boolean(),
  rows: z.array(exactCartAvailabilityObservationRowV2Schema),
}).strict();

export type ExactCartAvailabilityObservationV2 = z.infer<
  typeof exactCartAvailabilityObservationV2Schema
>;

export type ExactCartAvailabilityProtectedAction =
  | 'previewOrder'
  | 'placeOrder';

export type ExactCartAvailabilityErrorCode =
  | 'cart_availability_action_invalid'
  | 'cart_availability_cart_required'
  | 'cart_availability_cart_invalid'
  | 'cart_availability_observation_missing'
  | 'cart_availability_observation_invalid'
  | 'cart_availability_active_store_required'
  | 'cart_availability_active_disposition_required'
  | 'cart_availability_active_disposition_invalid'
  | 'cart_availability_active_inventory_provider_required'
  | 'cart_availability_active_inventory_provider_invalid'
  | 'cart_availability_cart_revision_mismatch'
  | 'cart_availability_store_mismatch'
  | 'cart_availability_disposition_mismatch'
  | 'cart_availability_inventory_provider_mismatch'
  | 'cart_availability_observation_not_yet_valid'
  | 'cart_availability_observation_expired'
  | 'cart_availability_incomplete'
  | 'cart_availability_unavailable'
  | 'cart_availability_blocked';

export interface ExactCartAvailabilityGrant {
  readonly schemaVersion:
    typeof EXACT_CART_AVAILABILITY_OBSERVATION_V2_SCHEMA_VERSION;
  readonly action: ExactCartAvailabilityProtectedAction;
  readonly observationId: string;
  readonly cartRevision: string;
  readonly storeId: string;
  readonly disposition: Disposition;
  readonly inventoryProviderRevision:
    InventoryAvailabilityProviderRevisionV2;
  readonly observedAt: string;
  readonly expiresAt: string;
  readonly complete: true;
  readonly rows: readonly {
    readonly itemCode: string;
    readonly quantity: number;
    readonly status: 'available';
  }[];
}

export type ExactCartAvailabilityDecision =
  | {
      readonly ok: true;
      readonly grant: ExactCartAvailabilityGrant;
    }
  | {
      readonly ok: false;
      readonly errorCode: ExactCartAvailabilityErrorCode;
    };

export interface ExactCartAvailabilityAuthorityInput {
  readonly action: ExactCartAvailabilityProtectedAction;
  readonly cart: Cart | null | undefined;
  readonly observation: unknown;
  readonly activeStoreId: string | null | undefined;
  readonly activeDisposition: Disposition | null | undefined;
  readonly activeInventoryProviderRevision:
    | InventoryAvailabilityProviderRevisionV2
    | null
    | undefined;
  readonly nowMs: number;
}

function failure(
  errorCode: ExactCartAvailabilityErrorCode,
): ExactCartAvailabilityDecision {
  return { ok: false, errorCode };
}

function hasNonBlankValue(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isDisposition(value: unknown): value is Disposition {
  return value === 'pickup' || value === 'delivery';
}

function exactCartQuantities(
  cart: Cart | null | undefined,
): ReadonlyMap<string, number> | undefined {
  if (
    !cart ||
    !hasNonBlankValue(cart.id) ||
    !Array.isArray(cart.items) ||
    cart.items.length === 0
  ) {
    return undefined;
  }
  const quantities = new Map<string, number>();
  for (const item of cart.items) {
    if (
      !hasNonBlankValue(item.itemCode) ||
      !Number.isInteger(item.quantity) ||
      item.quantity < 1 ||
      quantities.has(item.itemCode)
    ) {
      return undefined;
    }
    quantities.set(item.itemCode, item.quantity);
  }
  return quantities;
}

function observationHasUniqueRows(
  observation: ExactCartAvailabilityObservationV2,
): boolean {
  return new Set(observation.rows.map(({ itemCode }) => itemCode)).size ===
    observation.rows.length;
}

function observationHasExactCartRows(
  expected: ReadonlyMap<string, number>,
  observation: ExactCartAvailabilityObservationV2,
): boolean {
  if (!observation.complete || observation.rows.length !== expected.size) {
    return false;
  }
  return observation.rows.every(
    ({ itemCode, quantity }) => expected.get(itemCode) === quantity,
  );
}

function sortedAvailableRows(
  observation: ExactCartAvailabilityObservationV2,
): ExactCartAvailabilityGrant['rows'] {
  return observation.rows
    .map(({ itemCode, quantity }) => ({
      itemCode,
      quantity,
      status: 'available' as const,
    }))
    .sort((left, right) => {
      if (left.itemCode < right.itemCode) return -1;
      if (left.itemCode > right.itemCode) return 1;
      return 0;
    });
}

export async function exactCartAvailabilityRevision(
  cart: Cart,
): Promise<string> {
  return digestCommerceAction(cart);
}

export async function authorizeExactCartAvailability(
  input: ExactCartAvailabilityAuthorityInput,
): Promise<ExactCartAvailabilityDecision> {
  if (input.action !== 'previewOrder' && input.action !== 'placeOrder') {
    return failure('cart_availability_action_invalid');
  }
  if (!input.cart) {
    return failure('cart_availability_cart_required');
  }
  const currentQuantities = exactCartQuantities(input.cart);
  if (!currentQuantities) {
    return failure('cart_availability_cart_invalid');
  }
  if (input.observation === null || input.observation === undefined) {
    return failure('cart_availability_observation_missing');
  }
  const parsed = exactCartAvailabilityObservationV2Schema.safeParse(
    input.observation,
  );
  if (
    !parsed.success ||
    !observationHasUniqueRows(parsed.data) ||
    !Number.isFinite(input.nowMs)
  ) {
    return failure('cart_availability_observation_invalid');
  }
  if (!hasNonBlankValue(input.activeStoreId)) {
    return failure('cart_availability_active_store_required');
  }
  if (input.activeDisposition === null || input.activeDisposition === undefined) {
    return failure('cart_availability_active_disposition_required');
  }
  if (!isDisposition(input.activeDisposition)) {
    return failure('cart_availability_active_disposition_invalid');
  }
  if (
    input.activeInventoryProviderRevision === null ||
    input.activeInventoryProviderRevision === undefined
  ) {
    return failure('cart_availability_active_inventory_provider_required');
  }
  const activeInventoryProviderRevision =
    inventoryAvailabilityProviderRevisionV2Schema.safeParse(
      input.activeInventoryProviderRevision,
    );
  if (!activeInventoryProviderRevision.success) {
    return failure('cart_availability_active_inventory_provider_invalid');
  }

  const observation = parsed.data;
  if (
    observation.cartRevision !==
    await exactCartAvailabilityRevision(input.cart)
  ) {
    return failure('cart_availability_cart_revision_mismatch');
  }
  if (observation.storeId !== input.activeStoreId) {
    return failure('cart_availability_store_mismatch');
  }
  if (observation.disposition !== input.activeDisposition) {
    return failure('cart_availability_disposition_mismatch');
  }
  if (
    observation.inventoryProviderRevision.revision !==
    activeInventoryProviderRevision.data.revision
  ) {
    return failure('cart_availability_inventory_provider_mismatch');
  }

  const observedAtMs = Date.parse(observation.observedAt);
  const expiresAtMs = Date.parse(observation.expiresAt);
  if (observedAtMs >= expiresAtMs) {
    return failure('cart_availability_observation_invalid');
  }
  if (observedAtMs > input.nowMs) {
    return failure('cart_availability_observation_not_yet_valid');
  }
  if (expiresAtMs <= input.nowMs) {
    return failure('cart_availability_observation_expired');
  }
  if (!observationHasExactCartRows(currentQuantities, observation)) {
    return failure('cart_availability_incomplete');
  }
  if (observation.rows.some(({ status }) => status === 'blocked')) {
    return failure('cart_availability_blocked');
  }
  if (observation.rows.some(({ status }) => status === 'unavailable')) {
    return failure('cart_availability_unavailable');
  }

  return {
    ok: true,
    grant: {
      schemaVersion: EXACT_CART_AVAILABILITY_OBSERVATION_V2_SCHEMA_VERSION,
      action: input.action,
      observationId: observation.observationId,
      cartRevision: observation.cartRevision,
      storeId: observation.storeId,
      disposition: observation.disposition,
      inventoryProviderRevision: {
        ...observation.inventoryProviderRevision,
      },
      observedAt: observation.observedAt,
      expiresAt: observation.expiresAt,
      complete: true,
      rows: sortedAvailableRows(observation),
    },
  };
}
