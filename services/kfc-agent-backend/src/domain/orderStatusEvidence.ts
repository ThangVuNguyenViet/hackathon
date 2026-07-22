import { z } from 'zod';
import type { Order } from './types.js';

const remainingDeliveryMinutesSchema = z.number().int().min(1).max(24 * 60);

export const orderStatusDeliveryEstimateSchema = z.object({
  kind: z.literal('remaining_delivery_window'),
  minMinutes: remainingDeliveryMinutesSchema,
  maxMinutes: remainingDeliveryMinutesSchema,
  observedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  providerRevision: z.string().min(1).max(512).refine(
    (value) => value.trim().length > 0,
    'providerRevision must contain a non-whitespace value',
  ),
}).strict().superRefine((estimate, context) => {
  if (estimate.minMinutes > estimate.maxMinutes) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'minMinutes must be less than or equal to maxMinutes',
      path: ['minMinutes'],
    });
  }
  if (Date.parse(estimate.observedAt) >= Date.parse(estimate.expiresAt)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'observedAt must be earlier than expiresAt',
      path: ['expiresAt'],
    });
  }
});

export type OrderStatusDeliveryEstimate = z.infer<
  typeof orderStatusDeliveryEstimateSchema
>;

export function currentOrderStatusDeliveryEstimate(
  value: unknown,
  nowMs = Date.now(),
): OrderStatusDeliveryEstimate | undefined {
  const parsed = orderStatusDeliveryEstimateSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const observedAtMs = Date.parse(parsed.data.observedAt);
  const expiresAtMs = Date.parse(parsed.data.expiresAt);
  return observedAtMs <= nowMs && nowMs < expiresAtMs
    ? parsed.data
    : undefined;
}

export function orderWithCurrentDeliveryEstimate(
  order: Order | null | undefined,
  nowMs = Date.now(),
): Order | null | undefined {
  if (!order || order.deliveryEstimate === undefined) return order;
  const deliveryEstimate = currentOrderStatusDeliveryEstimate(
    order.deliveryEstimate,
    nowMs,
  );
  return deliveryEstimate
    ? { ...order, deliveryEstimate }
    : orderWithoutDeliveryEstimate(order);
}

export function orderWithoutDeliveryEstimate(order: Order): Order {
  if (order.deliveryEstimate === undefined) return order;
  const projected = { ...order };
  delete projected.deliveryEstimate;
  return projected;
}
