import { z } from 'zod';
import {
  orderStatusDeliveryEstimateSchema,
  orderWithoutDeliveryEstimate,
} from '../domain/orderStatusEvidence.js';
import type { GeneratedFixtures } from '../fixtures/schema.js';
import {
  generatedMenuItemSchema,
  generatedMenuModifierSchema,
} from '../fixtures/schema.js';
import type { MockClientOptions } from './mockClientOptions.js';

const addressSchema = z.object({
  label: z.string(),
  line1: z.string(),
  district: z.string(),
  city: z.string(),
}).strict();

const cartItemModifierSchema = z.object({
  groupId: z.string(),
  groupName: z.string(),
  modifierId: z.string(),
  modifierName: z.string(),
  quantity: z.number().int().positive(),
  priceDeltaVnd: z.number().int(),
}).strict();

const cartItemSchema = z.object({
  itemCode: z.string(),
  name: z.string(),
  quantity: z.number().int().positive(),
  unitPriceVnd: z.number().int().nonnegative(),
  modifiers: z.array(cartItemModifierSchema).optional(),
  imageUrl: z.string().optional(),
  category: z.string().optional(),
}).strict();

const cartSchema = z.object({
  id: z.string(),
  items: z.array(cartItemSchema),
  subtotalVnd: z.number().int().nonnegative(),
  discountVnd: z.number().int().nonnegative(),
  deliveryFeeVnd: z.number().int().nonnegative(),
  totalVnd: z.number().int().nonnegative(),
  voucherCode: z.string().nullable(),
}).strict();

const orderSchema = z.object({
  id: z.string(),
  cart: cartSchema,
  status: z.enum(['previewed', 'created', 'preparing', 'delivering', 'completed', 'cancelled']),
  paymentStatus: z.enum(['not_started', 'pending', 'paid', 'failed']),
  assignedStoreId: z.string(),
  createdAt: z.string(),
  deliveryEstimate: orderStatusDeliveryEstimateSchema.optional(),
  posTicketId: z.string().optional(),
  posStatus: z.enum(['accepted', 'preparing', 'ready', 'cancelled', 'rejected']).optional(),
  commerceOrderId: z.string().optional(),
  omsOrderId: z.string().optional(),
  commerceOutcome: z.string().optional(),
  commerceCustomerStatus: z.string().optional(),
  commerceEnvironment: z.enum(['sandbox', 'production']).optional(),
  commerceProviderProvenance: z.record(z.object({
    implementation: z.string().min(1),
    source: z.string().min(1),
  })).optional(),
}).strict();

const menuItemSchema = z.object({
  code: z.string(),
  itemId: z.string().optional(),
  productCode: z.string().optional(),
  category: z.string(),
  categoryId: z.string().min(1),
  name: z.string(),
  description: z.string(),
  priceVnd: z.number().int().nonnegative(),
  originalPriceVnd: z.number().int().nonnegative().nullable(),
  imageUrl: z.string(),
  available: z.boolean(),
  isCustomize: z.boolean().optional(),
  isQuickCombo: z.boolean().optional(),
  hasModifiers: z.boolean().optional(),
}).strict();

export const mockedUpstreamApiProfileSchema = z.object({
  unavailableItemCodes: z.array(z.string()).optional(),
  deliveryFeeVnd: z.number().int().nonnegative().optional(),
  deliveryEtaMinutes: z.number().int().positive().optional(),
  savedAddresses: z.array(addressSchema).optional(),
  favoriteItems: z.array(menuItemSchema).optional(),
  orders: z.array(orderSchema).optional(),
  recentOrderId: z.string().optional(),
  paymentStatuses: z.record(z.enum(['pending', 'paid', 'failed'])).optional(),
  paymentFailureOrderIds: z.array(z.string()).optional(),
  menuItems: z.array(generatedMenuItemSchema).optional(),
  menuModifiers: z.array(generatedMenuModifierSchema).optional(),
}).strict();

export type MockedUpstreamApiProfile = z.infer<typeof mockedUpstreamApiProfileSchema>;

export function applyMockedUpstreamFixtureOverrides(
  fixtures: GeneratedFixtures,
  profile: MockedUpstreamApiProfile | undefined,
): GeneratedFixtures {
  if (!profile) return fixtures;
  let next = fixtures;
  if (profile.menuItems) {
    const replacements = new Map(profile.menuItems.map((item) => [item.code, item]));
    const existingCodes = new Set(fixtures.menuItems.map((item) => item.code));
    next = {
      ...next,
      menuItems: [
        ...fixtures.menuItems.map((item) => replacements.get(item.code) ?? item),
        ...profile.menuItems.filter((item) => !existingCodes.has(item.code)),
      ],
    };
  }
  if (profile.menuModifiers) {
    const replacements = new Map(profile.menuModifiers.map((modifier) => [modifier.itemCode, modifier]));
    const existingCodes = new Set(fixtures.menuModifiers.map((modifier) => modifier.itemCode));
    next = {
      ...next,
      menuModifiers: [
        ...fixtures.menuModifiers.map((modifier) => replacements.get(modifier.itemCode) ?? modifier),
        ...profile.menuModifiers.filter((modifier) => !existingCodes.has(modifier.itemCode)),
      ],
    };
  }
  return next;
}

export function mockedUpstreamClientOptions(
  profile: MockedUpstreamApiProfile | undefined,
): MockClientOptions {
  if (!profile) return {};
  const orders = profile.orders ?? [];
  const orderById = new Map(orders.map((order) => [order.id, order]));
  const failedPayments = new Set(profile.paymentFailureOrderIds ?? []);
  return {
    ...(profile.orders ? { initialOrders: orders } : {}),
    ...(profile.savedAddresses
      ? {
          savedAddressesProvider: () => ({
            ok: true as const,
            value: profile.savedAddresses!,
            message: 'mocked_upstream_saved_addresses',
          }),
        }
      : {}),
    ...(profile.favoriteItems
      ? {
          favoriteItemsProvider: () => ({
            ok: true as const,
            value: profile.favoriteItems!,
            message: 'mocked_upstream_favorite_items',
          }),
        }
      : {}),
    ...(profile.recentOrderId
      ? {
          recentOrderProvider: () => ({
            ok: true as const,
            value: orderById.has(profile.recentOrderId!)
              ? orderWithoutDeliveryEstimate(
                  orderById.get(profile.recentOrderId!)!,
                )
              : null,
            message: 'mocked_upstream_recent_order',
          }),
        }
      : {}),
    ...(profile.orders
      ? {
          orderStatusProvider: (orderId: string) => {
            const order = orderById.get(orderId);
            return order
              ? { ok: true as const, value: order, message: 'mocked_upstream_order_status' }
              : { ok: false as const, errorCode: 'order_not_found', message: `Order ${orderId} was not found` };
          },
        }
      : {}),
    ...(profile.paymentStatuses || profile.paymentFailureOrderIds
      ? {
          paymentStatusProvider: (orderId: string) => {
            if (failedPayments.has(orderId)) {
              return { ok: false as const, errorCode: 'payment_failed', message: 'mocked_upstream_payment_failed' };
            }
            const status = profile.paymentStatuses?.[orderId];
            return status
              ? { ok: true as const, value: { status }, message: 'mocked_upstream_payment_status' }
              : { ok: false as const, errorCode: 'payment_not_found', message: `Payment ${orderId} was not found` };
          },
        }
      : {}),
  };
}
